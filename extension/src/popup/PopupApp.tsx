import React, { useState, useEffect } from 'react';
import { signIn, signOut, getCurrentAccount, silentTokenRefresh, getValidToken } from '../auth/authService';
import { API_URL, SWA_URL } from '../config';
import { NetSuiteVendor, Stats, Submission, ThreadMessage, TabType } from './popupTypes';
import { popupStyles as styles } from './popupStyles';
import ManualTFATab from './ManualTFATab';
import PopupMessageThread from './PopupMessageThread';

export const PopupApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('activity');
  const [stats, setStats] = useState<Stats>({
    totalCaptures: 0,
    successfulCaptures: 0,
    lastCaptureTime: null,
    recentLogs: [],
  });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [submissionsError, setSubmissionsError] = useState<string | null>(null);
  const [togglingEnteredId, setTogglingEnteredId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showAuthWarning, setShowAuthWarning] = useState(false);

  // Messaging state
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [expandedMessagesSub, setExpandedMessagesSub] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  // Vendor list state (shared with ManualTFATab)
  const [vendors, setVendors] = useState<NetSuiteVendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);

  useEffect(() => {
    const checkAuthentication = async () => {
      try {
        // getCurrentAccount now checks token expiration — returns null if expired
        const account = await getCurrentAccount();
        if (account) {
          setIsAuthenticated(true);
          setUserName(account.name || 'User');
          setUserEmail(account.username || '');
          setShowAuthWarning(false);
          setAuthError(null);
          return;
        }

        // No valid account — maybe token expired. Try silent refresh.
        const refreshedToken = await silentTokenRefresh();
        if (refreshedToken) {
          // Token refreshed — re-read stored user info
          chrome.storage.local.get(['userName', 'userEmail'], (result) => {
            setIsAuthenticated(true);
            setUserName(result.userName || 'User');
            setUserEmail(result.userEmail || '');
            setShowAuthWarning(false);
            setAuthError(null);
          });
        } else {
          // Silent refresh failed - show warning
          setShowAuthWarning(true);
          setAuthError('Your session has expired. Please sign in again.');
        }
        // If silent refresh also failed, user stays logged out and sees Sign In button
      } catch (err) {
        console.warn('[Auth] checkAuthentication error:', err);
        setAuthError('Authentication error. Please try signing in again.');
      }
    };
    
    checkAuthentication();

    chrome.storage.local.get(['captureStats'], (result) => {
      if (result.captureStats) {
        setStats(result.captureStats);
      }
    });

    const handleMessage = (message: any) => {
      if (message.type === 'CAPTURE_UPDATE') {
        setStats(message.stats);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  // Fetch NetSuite vendors when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchVendors = async () => {
      setVendorsLoading(true);
      try {
        const token = await getValidToken();
        if (!token) return;
        const vendorsUrl = API_URL.replace('/captures', '/netsuite/vendors');
        const response = await fetch(vendorsUrl, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setVendors(data.vendors || []);
        }
      } catch (err) {
        console.error('Failed to fetch vendors:', err);
      } finally {
        setVendorsLoading(false);
      }
    };
    fetchVendors();
  }, [isAuthenticated]);

  const handleAuthenticate = async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const account = await signIn();
      if (account) {
        setIsAuthenticated(true);
        setUserName(account.name || 'User');
        setUserEmail(account.username || '');
        setShowAuthWarning(false);
        setAuthError(null);
      }
    } catch (error: any) {
      if (error?.errorCode !== 'user_cancelled') {
        console.error('Sign in error:', error);
        setAuthError('Failed to sign in. Please try again.');
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {}
    setIsAuthenticated(false);
    setUserName('');
    setUserEmail('');
  };

  const handleAuthExpired = () => {
    setIsAuthenticated(false);
    setUserName('');
    setUserEmail('');
    setShowAuthWarning(true);
    setAuthError('Session expired. Please sign in again.');
  };

  const fetchSubmissions = async () => {
    if (!isAuthenticated) return;
    
    setLoadingSubmissions(true);
    setSubmissionsError(null);
    
    try {
      let token = await getValidToken();

      if (!token) {
        setSubmissionsError('Please sign in to view submissions');
        setIsAuthenticated(false);
        return;
      }

      let response = await fetch(`${API_URL.replace('/captures', '/submissions')}?myOnly=true`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      // Handle 401 - try silent refresh
      if (response.status === 401) {
        const newToken = await silentTokenRefresh();
        
        if (newToken) {
          // Retry with new token
          response = await fetch(`${API_URL.replace('/captures', '/submissions')}?myOnly=true`, {
            headers: {
              'Authorization': `Bearer ${newToken}`,
              'Content-Type': 'application/json',
            },
          });
        } else {
          // Silent refresh failed - user needs to sign in again
          setIsAuthenticated(false);
          setUserName('');
          setUserEmail('');
          setSubmissionsError('Session expired. Please sign in again.');
          return;
        }
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const data = await response.json();
      setSubmissions(data.slice(0, 20)); // Show last 20

      // Also fetch unread counts
      try {
        const ucToken = await getValidToken();
        if (ucToken) {
          const ucResp = await fetch(`${API_URL.replace('/captures', '/messages/unread-count')}`, {
            headers: { 'Authorization': `Bearer ${ucToken}` },
          });
          if (ucResp.ok) {
            const ucData = await ucResp.json();
            setUnreadCounts(ucData.perSubmission || {});
          }
        }
      } catch { /* non-critical */ }

    } catch (err) {
      setSubmissionsError(err instanceof Error ? err.message : 'Failed to load submissions');
    } finally {
      setLoadingSubmissions(false);
    }
  };

  /** Fetch messages for a submission thread */
  const fetchThreadMessages = async (submissionId: string) => {
    setThreadLoading(true);
    try {
      const token = await getValidToken();
      if (!token) return;
      const resp = await fetch(`${API_URL.replace('/captures', `/submissions/${submissionId}/messages`)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (resp.ok) {
        const msgs = await resp.json();
        setThreadMessages(msgs);
        // Mark thread as read
        await fetch(`${API_URL.replace('/captures', '/messages/read-thread')}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ submissionId }),
        });
        setUnreadCounts(prev => { const next = { ...prev }; delete next[submissionId]; return next; });
        // Tell background to refresh badge
        chrome.runtime.sendMessage({ type: 'REFRESH_UNREAD' }).catch(() => {});
      }
    } catch (err) {
      console.warn('[Messages] Failed to fetch thread:', err);
    } finally {
      setThreadLoading(false);
    }
  };

  /** Send a reply message */
  const handleSendReply = async (submissionId: string, serviceType: string) => {
    if (!replyText.trim() || sendingReply) return;
    setSendingReply(true);
    try {
      const token = await getValidToken();
      if (!token) return;
      const resp = await fetch(`${API_URL.replace('/captures', `/submissions/${submissionId}/messages`)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: replyText.trim(), service_type: serviceType }),
      });
      if (resp.ok) {
        const newMsg = await resp.json();
        setThreadMessages(prev => [...prev, newMsg]);
        setReplyText('');
      }
    } catch (err) {
      console.warn('[Messages] Failed to send reply:', err);
    } finally {
      setSendingReply(false);
    }
  };

  const handleToggleEntered = async (sub: Submission, e: React.MouseEvent) => {
    e.stopPropagation();
    const newValue = !sub.entered_in_system;
    setTogglingEnteredId(sub.id);

    // Optimistic update
    setSubmissions(prev => prev.map(s =>
      s.id === sub.id
        ? { ...s, entered_in_system: newValue, entered_in_system_by: newValue ? userEmail : undefined, entered_in_system_at: newValue ? new Date().toISOString() : undefined }
        : s
    ));

    try {
      let token = await getValidToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const patchUrl = API_URL.replace('/captures', `/submissions/${sub.id}`);
      let response = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          service_type: sub.service_type || 'TFA',
          entered_in_system: newValue,
          entered_in_system_by: newValue ? userEmail : '',
          entered_in_system_at: newValue ? new Date().toISOString() : '',
          updated_by: userEmail,
          updated_at: new Date().toISOString(),
        }),
      });

      if (response.status === 401) {
        const newToken = await silentTokenRefresh();
        if (newToken) {
          response = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${newToken}`,
            },
            body: JSON.stringify({
              service_type: sub.service_type || 'TFA',
              entered_in_system: newValue,
              entered_in_system_by: newValue ? userEmail : '',
              entered_in_system_at: newValue ? new Date().toISOString() : '',
              updated_by: userEmail,
              updated_at: new Date().toISOString(),
            }),
          });
        }
      }

      if (!response.ok) {
        throw new Error('Failed to update');
      }
    } catch {
      // Revert on failure
      setSubmissions(prev => prev.map(s =>
        s.id === sub.id ? { ...s, entered_in_system: sub.entered_in_system } : s
      ));
    } finally {
      setTogglingEnteredId(null);
    }
  };

  // Load submissions + unread counts immediately when authenticated (for Activity tab messages + badge)
  useEffect(() => {
    if (isAuthenticated) {
      fetchSubmissions();
      // Also tell background to refresh badge
      chrome.runtime.sendMessage({ type: 'REFRESH_UNREAD' }).catch(() => {});
    }
  }, [isAuthenticated]);

  const formatTime = (isoString: string | null) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.headerTitle}>VOANLA TFA Tracker</h1>
        <p style={styles.headerSubtitle}>Track Temporary Financial Assistance</p>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        <button style={styles.tab(activeTab === 'activity')} onClick={() => setActiveTab('activity')}>
          Messages
          {Object.values(unreadCounts).reduce((a, b) => a + b, 0) > 0 && (
            <span style={{
              backgroundColor: '#dc3545', color: 'white', borderRadius: '10px',
              padding: '0 6px', fontSize: '10px', fontWeight: 700, marginLeft: '5px',
            }}>{Object.values(unreadCounts).reduce((a, b) => a + b, 0)}</span>
          )}
        </button>
        <button style={styles.tab(activeTab === 'manual')} onClick={() => setActiveTab('manual')}>
          Submit
        </button>
        <button style={styles.tab(activeTab === 'submissions')} onClick={() => setActiveTab('submissions')}>
          Queue
          {(() => {
            const pendingCount = submissions.filter(s => !s.entered_in_system).length;
            return pendingCount > 0 ? (
              <span style={{
                backgroundColor: '#f59e0b', color: 'white', borderRadius: '10px',
                padding: '0 6px', fontSize: '10px', fontWeight: 700, marginLeft: '5px',
              }}>{pendingCount}</span>
            ) : null;
          })()}
        </button>
      </div>

      <div style={styles.content}>
        {/* Auth Warning Banner */}
        {showAuthWarning && authError && (
          <div style={{
            backgroundColor: '#fef3c7',
            border: '1px solid #f59e0b',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <div style={{ fontSize: '20px' }}>⚠️</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#92400e', marginBottom: '2px' }}>
                Authentication Required
              </div>
              <div style={{ fontSize: '11px', color: '#78350f' }}>
                {authError}
              </div>
            </div>
            <button
              onClick={handleAuthenticate}
              disabled={isAuthenticating}
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 600,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: isAuthenticating ? 'not-allowed' : 'pointer',
                opacity: isAuthenticating ? 0.7 : 1,
              }}
            >
              {isAuthenticating ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        )}

        {/* Auth Section */}
        {!isAuthenticated ? (
          <div style={{ ...styles.card, textAlign: 'center' }}>
            <div style={{ fontSize: '36px', marginBottom: '8px' }}>🔐</div>
            <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#374151' }}>Sign in Required</h3>
            <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#6b7280' }}>
              Use your organization account
            </p>
            <button
              onClick={handleAuthenticate}
              disabled={isAuthenticating}
              style={{
                ...styles.btn('primary'),
                opacity: isAuthenticating ? 0.7 : 1,
                cursor: isAuthenticating ? 'not-allowed' : 'pointer',
              }}
            >
              {isAuthenticating ? 'Signing in...' : 'Sign in with Microsoft'}
            </button>
          </div>
        ) : (
          <div style={{ ...styles.card, ...styles.userCard }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={styles.avatar}>{userName.charAt(0).toUpperCase()}</div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>{userName}</div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>{userEmail}</div>
              </div>
            </div>
            <button onClick={handleSignOut} style={{ ...styles.btn('danger'), width: 'auto', padding: '6px 12px' }}>
              Sign Out
            </button>
          </div>
        )}

        {/* Activity Tab */}
        {activeTab === 'activity' && (
          <>
            {/* Messages */}
            <div style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>Messages</span>
                  {Object.values(unreadCounts).reduce((a, b) => a + b, 0) > 0 && (
                    <span style={{
                      backgroundColor: '#dc3545',
                      color: 'white',
                      borderRadius: '10px',
                      padding: '1px 7px',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}>
                      {Object.values(unreadCounts).reduce((a, b) => a + b, 0)}
                    </span>
                  )}
                </div>
                <button
                  onClick={fetchSubmissions}
                  disabled={loadingSubmissions}
                  style={{ fontSize: '10px', color: '#667eea', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                >
                  {loadingSubmissions ? '...' : 'Refresh'}
                </button>
              </div>
              {(() => {
                const unreadSubs = submissions.filter(s => (unreadCounts[s.id] || 0) > 0);
                if (loadingSubmissions && submissions.length === 0) {
                  return <div style={{ textAlign: 'center', padding: '16px', color: '#9ca3af', fontSize: '12px' }}>Loading...</div>;
                }
                if (unreadSubs.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '16px', color: '#9ca3af', fontSize: '12px' }}>
                      <div style={{ fontSize: '20px', marginBottom: '4px' }}>✓</div>
                      All caught up — no new messages
                    </div>
                  );
                }
                return (
                  <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                    {unreadSubs.map(sub => {
                      const isExpanded = expandedMessagesSub === sub.id;
                      return (
                        <div key={sub.id} style={{
                          padding: '8px 10px',
                          borderRadius: '6px',
                          backgroundColor: '#fef2f2',
                          border: '1px solid #fecaca',
                          marginBottom: '6px',
                        }}>
                          <div
                            onClick={() => {
                              if (isExpanded) {
                                setExpandedMessagesSub(null);
                                setThreadMessages([]);
                              } else {
                                setExpandedMessagesSub(sub.id);
                                fetchThreadMessages(sub.id);
                              }
                            }}
                            style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                          >
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                              <div style={{ fontSize: '12px', fontWeight: 600, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {sub.client_name || sub.client_id || 'Unknown Client'}
                              </div>
                              <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '1px' }}>
                                {sub.vendor || 'No vendor'} · {formatTime(sub.captured_at_utc)}
                              </div>
                            </div>
                            <span style={{
                              backgroundColor: '#dc3545',
                              color: 'white',
                              borderRadius: '8px',
                              padding: '1px 6px',
                              fontSize: '10px',
                              fontWeight: 700,
                              flexShrink: 0,
                              marginLeft: '8px',
                            }}>
                              {unreadCounts[sub.id]} new
                            </span>
                          </div>
                          {isExpanded && (
                            <div style={{ marginTop: '8px', borderTop: '1px solid #fecaca', paddingTop: '6px' }}>
                              <PopupMessageThread
                                messages={threadMessages}
                                loading={threadLoading}
                                replyText={replyText}
                                onReplyTextChange={setReplyText}
                                onSendReply={() => handleSendReply(sub.id, sub.service_type || 'TFA')}
                                sendingReply={sendingReply}
                                currentUserEmail={userEmail}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </>
        )}

        {/* Manual Entry Tab */}
        {activeTab === 'manual' && (
          <ManualTFATab
            isAuthenticated={isAuthenticated}
            vendors={vendors}
            vendorsLoading={vendorsLoading}
            stats={stats}
            onStatsUpdate={setStats}
            onAuthExpired={handleAuthExpired}
          />
        )}

        {/* Submissions Tab (Queue) — only shows TFAs NOT entered in system */}
        {activeTab === 'submissions' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>ServicePoint Queue</span>
                {(() => {
                  const pending = submissions.filter(s => !s.entered_in_system).length;
                  return pending > 0 ? (
                    <span style={{
                      backgroundColor: '#f59e0b', color: 'white', borderRadius: '10px',
                      padding: '1px 7px', fontSize: '11px', fontWeight: 700,
                    }}>{pending} pending</span>
                  ) : null;
                })()}
              </div>
              <button
                onClick={fetchSubmissions}
                disabled={loadingSubmissions || !isAuthenticated}
                style={{ fontSize: '11px', color: '#667eea', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
              >
                {loadingSubmissions ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {submissionsError && (
              <div style={styles.message('error')}>{submissionsError}</div>
            )}

            {!isAuthenticated ? (
              <div style={{ ...styles.card, textAlign: 'center', padding: '20px' }}>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>Sign in to view queue</div>
              </div>
            ) : loadingSubmissions ? (
              <div style={{ ...styles.card, textAlign: 'center', padding: '20px' }}>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>Loading...</div>
              </div>
            ) : submissions.filter(s => !s.entered_in_system).length === 0 ? (
              <div style={{ ...styles.card, textAlign: 'center', padding: '20px' }}>
                <div style={{ fontSize: '20px', marginBottom: '6px' }}>✓</div>
                <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>All TFAs entered in system</div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>Nothing to do right now</div>
              </div>
            ) : (
              <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
                {/* Table header */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 100px 70px 36px',
                  gap: '4px', padding: '6px 10px',
                  fontSize: '9px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const,
                  letterSpacing: '0.05em', borderBottom: '1px solid #e5e7eb',
                }}>
                  <span>Client / Vendor</span>
                  <span>Type</span>
                  <span style={{ textAlign: 'right' }}>Amount</span>
                  <span></span>
                </div>

                {submissions.filter(s => !s.entered_in_system).map(sub => {
                  const assistanceType = sub.form_data?.assistance_type || '—';
                  return (
                    <div
                      key={sub.id}
                      style={{
                        display: 'grid', gridTemplateColumns: '1fr 100px 70px 36px',
                        gap: '4px', alignItems: 'center',
                        padding: '8px 10px',
                        borderBottom: '1px solid #f3f4f6',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Client / Vendor */}
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {sub.client_name || sub.client_id || 'Unknown'}
                        </div>
                        <div style={{ fontSize: '10px', color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {sub.vendor || 'No vendor'}
                        </div>
                      </div>
                      {/* Type */}
                      <div style={{
                        fontSize: '9px', fontWeight: 600, padding: '2px 6px',
                        borderRadius: '10px', backgroundColor: '#eef2ff', color: '#4338ca',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        textAlign: 'center',
                      }}>
                        {assistanceType}
                      </div>
                      {/* Amount */}
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#059669', textAlign: 'right' }}>
                        {sub.service_amount != null ? `$${sub.service_amount.toFixed(2)}` : '—'}
                      </div>
                      {/* Check off */}
                      <div style={{ textAlign: 'center' }}>
                        <button
                          onClick={(e) => handleToggleEntered(sub, e)}
                          disabled={togglingEnteredId === sub.id}
                          title="Mark as entered in ServicePoint"
                          style={{
                            width: '22px', height: '22px',
                            borderRadius: '4px',
                            border: '2px solid #d1d5db',
                            background: 'white',
                            cursor: togglingEnteredId === sub.id ? 'wait' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '12px', color: '#d1d5db',
                            transition: 'all 0.15s',
                            opacity: togglingEnteredId === sub.id ? 0.5 : 1,
                            padding: 0,
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.borderColor = '#10b981';
                            e.currentTarget.style.color = '#10b981';
                            e.currentTarget.textContent = '✓';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.borderColor = '#d1d5db';
                            e.currentTarget.style.color = '#d1d5db';
                            e.currentTarget.textContent = '';
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div
              onClick={async () => {
                const token = await getValidToken();
                const dashboardUrl = token 
                  ? `${SWA_URL}#token=${encodeURIComponent(token)}`
                  : SWA_URL;
                chrome.tabs.create({ url: dashboardUrl });
              }}
              style={{ marginTop: '10px', fontSize: '11px', color: '#667eea', textAlign: 'center', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Open full dashboard →
            </div>
          </>
        )}
      </div>
    </div>
  );
};
