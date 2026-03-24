import React, { useState, useEffect } from 'react';
import { signIn, signOut, getCurrentAccount, silentTokenRefresh, getValidToken } from '../auth/authService';
import { API_URL, SWA_URL } from '../config';
import { NetSuiteVendor, ClientRecord, Stats, Submission, ThreadMessage, TabType } from './popupTypes';
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

  // Client list state (shared with ManualTFATab)
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);

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

  // Fetch client list when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchClients = async () => {
      setClientsLoading(true);
      try {
        const token = await getValidToken();
        if (!token) return;
        const clientsUrl = API_URL.replace('/captures', '/clients');
        const response = await fetch(clientsUrl, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setClients(data.clients || []);
        }
      } catch (err) {
        console.error('Failed to fetch clients:', err);
      } finally {
        setClientsLoading(false);
      }
    };
    fetchClients();
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
      // API returns { submissions: [...], role } or raw array
      const list = Array.isArray(data) ? data : (data.submissions || []);
      setSubmissions(list.slice(0, 50));

      // Also fetch unread counts
      try {
        const ucToken = await getValidToken();
        if (ucToken) {
          const ucResp = await fetch(`${API_URL.replace('/captures', '/messages/unread-count')}`, {
            headers: { 'Authorization': `Bearer ${ucToken}` },
          });
          if (ucResp.ok) {
            const ucData = await ucResp.json();
            const perSub: Record<string, number> = ucData.perSubmission || {};
            setUnreadCounts(perSub);

            // Fetch any submissions with unread messages that aren't already loaded
            const loadedIds = new Set(list.map((s: Submission) => s.id));
            const missingIds = Object.keys(perSub).filter(id => !loadedIds.has(id));
            if (missingIds.length > 0) {
              console.log(`[Messages] Fetching ${missingIds.length} missing submissions with unread messages`);
              const fetched: Submission[] = [];
              for (const id of missingIds) {
                try {
                  const subResp = await fetch(`${API_URL.replace('/captures', `/submissions/${id}`)}`, {
                    headers: { 'Authorization': `Bearer ${ucToken}` },
                  });
                  if (subResp.ok) {
                    const subData = await subResp.json();
                    if (subData) fetched.push(subData);
                  }
                } catch { /* skip */ }
              }
              if (fetched.length > 0) {
                setSubmissions(prev => [...prev, ...fetched]);
              }
            }
          }
        }
      } catch { /* non-critical */ }

    } catch (err) {
      setSubmissionsError(err instanceof Error ? err.message : 'Failed to load submissions');
    } finally {
      setLoadingSubmissions(false);
    }
  };

  /** Track which submissions have been read but thread is still open */
  const [readButOpen, setReadButOpen] = useState<Set<string>>(new Set());

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
        // Mark thread as read on server, but keep it visible until collapsed
        await fetch(`${API_URL.replace('/captures', '/messages/read-thread')}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ submissionId }),
        });
        setReadButOpen(prev => new Set(prev).add(submissionId));
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
                const unreadSubs = submissions.filter(s => (unreadCounts[s.id] || 0) > 0 || readButOpen.has(s.id));
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
                                // Now remove from visible list since user is done
                                setReadButOpen(prev => { const next = new Set(prev); next.delete(sub.id); return next; });
                                setUnreadCounts(prev => { const next = { ...prev }; delete next[sub.id]; return next; });
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
            clients={clients}
            clientsLoading={clientsLoading}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {submissions.filter(s => !s.entered_in_system).map(sub => {
                  const assistanceType = sub.form_data?.assistance_type || sub.service_type || '—';
                  const programCategory = sub.form_data?.program_category || sub.program_category || null;
                  const region = sub.form_data?.region || sub.region || null;
                  const tfaDateStr = sub.tfa_date || sub.captured_at_utc;
                  const tfaDateFmt = (() => {
                    const d = new Date(tfaDateStr);
                    return isNaN(d.getTime()) ? '—' : `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
                  })();
                  return (
                    <div
                      key={sub.id}
                      style={{
                        background: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        transition: 'box-shadow 0.15s, border-color 0.15s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = '#c7d2fe';
                        e.currentTarget.style.boxShadow = '0 1px 4px rgba(99,102,241,0.10)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = '#e5e7eb';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      {/* Row 1: Client name + check-off */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {sub.client_name || 'Unknown Client'}
                          </div>
                          {sub.client_id && (
                            <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '1px' }}>
                              ID: {sub.client_id}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={(e) => handleToggleEntered(sub, e)}
                          disabled={togglingEnteredId === sub.id}
                          title="Mark as entered in ServicePoint"
                          style={{
                            width: '24px', height: '24px',
                            borderRadius: '6px',
                            border: '2px solid #d1d5db',
                            background: 'white',
                            cursor: togglingEnteredId === sub.id ? 'wait' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '13px', color: '#d1d5db',
                            transition: 'all 0.15s',
                            opacity: togglingEnteredId === sub.id ? 0.5 : 1,
                            padding: 0, flexShrink: 0, marginLeft: '8px',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.borderColor = '#10b981';
                            e.currentTarget.style.color = '#10b981';
                            e.currentTarget.style.background = '#ecfdf5';
                            e.currentTarget.textContent = '✓';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.borderColor = '#d1d5db';
                            e.currentTarget.style.color = '#d1d5db';
                            e.currentTarget.style.background = 'white';
                            e.currentTarget.textContent = '';
                          }}
                        />
                      </div>

                      {/* Row 2: Vendor */}
                      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sub.vendor || 'No vendor'}
                      </div>

                      {/* Row 3: Chips — amount, type, date, region, program */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                        {/* Amount */}
                        <span style={{
                          fontSize: '11px', fontWeight: 700, color: '#059669',
                          background: '#ecfdf5', borderRadius: '6px', padding: '2px 8px',
                        }}>
                          {sub.service_amount != null ? `$${sub.service_amount.toFixed(2)}` : '—'}
                        </span>
                        {/* Assistance type */}
                        <span style={{
                          fontSize: '10px', fontWeight: 600, color: '#4338ca',
                          background: '#eef2ff', borderRadius: '6px', padding: '2px 8px',
                          maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {assistanceType}
                        </span>
                        {/* Date */}
                        <span style={{
                          fontSize: '10px', fontWeight: 600, color: '#6366f1',
                          background: '#f5f3ff', borderRadius: '6px', padding: '2px 8px',
                        }}>
                          {tfaDateFmt}
                        </span>
                        {/* Region */}
                        {region && (
                          <span style={{
                            fontSize: '10px', fontWeight: 500, color: '#b45309',
                            background: '#fffbeb', borderRadius: '6px', padding: '2px 8px',
                          }}>
                            {region}
                          </span>
                        )}
                        {/* Program */}
                        {programCategory && (
                          <span style={{
                            fontSize: '10px', fontWeight: 500, color: '#0f766e',
                            background: '#f0fdfa', borderRadius: '6px', padding: '2px 8px',
                          }}>
                            {programCategory}
                          </span>
                        )}
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
