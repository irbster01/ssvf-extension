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
  const [captureEnabled, setCaptureEnabled] = useState(false);
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

    chrome.storage.local.get(['captureStats', 'captureEnabled'], (result) => {
      if (result.captureStats) {
        setStats(result.captureStats);
      }
      // Default to false (Off) if not set
      setCaptureEnabled(result.captureEnabled === true);
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
          Activity
        </button>
        <button style={styles.tab(activeTab === 'manual')} onClick={() => setActiveTab('manual')}>
          Manual
        </button>
        <button style={styles.tab(activeTab === 'submissions')} onClick={() => setActiveTab('submissions')}>
          Queue
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
            {/* Auto-Capture Toggle */}
            <div style={{
              ...styles.card,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
            }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>Auto-Capture</div>
                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                  {captureEnabled ? 'TFA capture on Save & Exit is active' : 'TFA auto-capture is off'}
                </div>
              </div>
              <button
                onClick={() => {
                  const newVal = !captureEnabled;
                  setCaptureEnabled(newVal);
                  chrome.storage.local.set({ captureEnabled: newVal });
                }}
                style={{
                  position: 'relative',
                  width: '44px',
                  height: '24px',
                  borderRadius: '12px',
                  border: 'none',
                  cursor: 'pointer',
                  background: captureEnabled
                    ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                    : '#d1d5db',
                  transition: 'background 0.3s',
                  flexShrink: 0,
                  padding: 0,
                }}
                aria-label={captureEnabled ? 'Disable auto-capture' : 'Enable auto-capture'}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: captureEnabled ? '22px' : '2px',
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: 'white',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    transition: 'left 0.3s',
                  }}
                />
              </button>
            </div>

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

        {/* Submissions Tab (Queue) */}
        {activeTab === 'submissions' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>TFA Queue</span>
              <button
                onClick={fetchSubmissions}
                disabled={loadingSubmissions || !isAuthenticated}
                style={{ fontSize: '11px', color: '#667eea', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {loadingSubmissions ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {submissionsError && (
              <div style={styles.message('error')}>{submissionsError}</div>
            )}

            {!isAuthenticated ? (
              <div style={{ ...styles.card, textAlign: 'center', padding: '20px' }}>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>Sign in to view submissions</div>
              </div>
            ) : loadingSubmissions ? (
              <div style={{ ...styles.card, textAlign: 'center', padding: '20px' }}>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>Loading...</div>
              </div>
            ) : submissions.length === 0 ? (
              <div style={{ ...styles.card, textAlign: 'center', padding: '20px' }}>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>No submissions yet</div>
              </div>
            ) : (
              <div style={{ maxHeight: '340px', overflowY: 'auto' }}>
                {submissions.map((sub) => {
                  const assistanceType = sub.form_data?.assistance_type || '—';
                  const region = sub.region || sub.form_data?.region || '—';
                  const programCategory = sub.program_category || sub.form_data?.program_category || '—';
                  const dateStr = formatTime(sub.captured_at_utc);
                  const hasUnread = (unreadCounts[sub.id] || 0) > 0;
                  const isExpanded = expandedMessagesSub === sub.id;
                  return (
                    <div
                      key={sub.id}
                      style={{
                        ...styles.card,
                        padding: '10px 12px',
                        marginBottom: '8px',
                        border: hasUnread ? '1px solid #dc3545' : undefined,
                      }}
                    >
                      {/* Clickable card body — opens dashboard */}
                      <div
                        onClick={async () => {
                          const token = await getValidToken();
                          const dashboardUrl = token 
                            ? `${SWA_URL}#token=${encodeURIComponent(token)}`
                            : SWA_URL;
                          chrome.tabs.create({ url: dashboardUrl });
                        }}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                      >
                      {/* Row 1: Client Name + Amount + Unread dot */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, overflow: 'hidden' }}>
                          {hasUnread && (
                            <span style={{
                              width: 8, height: 8, borderRadius: '50%',
                              backgroundColor: '#dc3545', flexShrink: 0,
                            }} />
                          )}
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {sub.client_name || sub.client_id || 'Unknown Client'}
                          </span>
                        </div>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#059669', flexShrink: 0, marginLeft: '8px' }}>
                          {sub.service_amount != null ? `$${sub.service_amount.toFixed(2)}` : '—'}
                        </div>
                      </div>
                      {/* Row 2: Vendor */}
                      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {sub.vendor || 'No vendor'}
                      </div>
                      {/* Row 3: Region + Program Category */}
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                        <div style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: '10px',
                          backgroundColor: '#fef3c7',
                          color: '#92400e',
                          whiteSpace: 'nowrap',
                        }}>
                          {region}
                        </div>
                        <div style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: '10px',
                          backgroundColor: programCategory === 'Rapid Rehousing' ? '#dbeafe' : '#d1fae5',
                          color: programCategory === 'Rapid Rehousing' ? '#1e40af' : '#065f46',
                          whiteSpace: 'nowrap',
                        }}>
                          {programCategory}
                        </div>
                      </div>
                      {/* Row 4: Assistance Type + Date */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <div style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: '10px',
                          backgroundColor: '#eef2ff',
                          color: '#4338ca',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '60%',
                        }}>
                          {assistanceType}
                        </div>
                        <div style={{ fontSize: '10px', color: '#9ca3af', flexShrink: 0 }}>
                          {dateStr}
                        </div>
                      </div>
                      {/* Row 5: Entered in System toggle */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderTop: '1px solid #f3f4f6',
                          paddingTop: '6px',
                        }}
                      >
                        <div style={{ fontSize: '10px', color: '#6b7280' }}>
                          {sub.entered_in_system
                            ? `Entered by ${sub.entered_in_system_by || 'someone'}`
                            : 'Not yet entered in system'}
                        </div>
                        <button
                          onClick={(e) => handleToggleEntered(sub, e)}
                          disabled={togglingEnteredId === sub.id}
                          title={sub.entered_in_system ? 'Mark as NOT entered' : 'Mark as entered in ServicePoint / LSNDC'}
                          style={{
                            background: sub.entered_in_system
                              ? 'linear-gradient(135deg, #10b981, #059669)'
                              : '#e5e7eb',
                            color: sub.entered_in_system ? 'white' : '#6b7280',
                            border: 'none',
                            borderRadius: '12px',
                            padding: '3px 10px',
                            fontSize: '10px',
                            fontWeight: 600,
                            cursor: togglingEnteredId === sub.id ? 'wait' : 'pointer',
                            opacity: togglingEnteredId === sub.id ? 0.6 : 1,
                            transition: 'all 0.2s',
                          }}
                        >
                          {sub.entered_in_system ? '✓ Entered' : 'Mark Entered'}
                        </button>
                      </div>
                      </div>{/* end clickable card body */}

                      {/* Row 6: Messages toggle */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderTop: '1px solid #f3f4f6',
                          paddingTop: '6px',
                          marginTop: '6px',
                        }}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isExpanded) {
                              setExpandedMessagesSub(null);
                              setThreadMessages([]);
                            } else {
                              setExpandedMessagesSub(sub.id);
                              fetchThreadMessages(sub.id);
                            }
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            fontSize: '10px',
                            color: '#667eea',
                            cursor: 'pointer',
                            fontWeight: 600,
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          💬 {isExpanded ? 'Hide Messages' : 'Messages'}
                          {hasUnread && (
                            <span style={{
                              backgroundColor: '#dc3545',
                              color: 'white',
                              borderRadius: '8px',
                              padding: '0 5px',
                              fontSize: '9px',
                              fontWeight: 700,
                            }}>
                              {unreadCounts[sub.id]}
                            </span>
                          )}
                        </button>
                      </div>

                      {/* Expanded message thread */}
                      {isExpanded && (
                        <div style={{
                          borderTop: '1px solid #e5e7eb',
                          marginTop: '6px',
                          paddingTop: '6px',
                        }}>
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
