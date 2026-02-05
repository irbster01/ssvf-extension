import React, { useState, useEffect } from 'react';
import { signIn, signOut, getCurrentAccount } from '../auth/authService';

interface CaptureLog {
  timestamp: string;
  status: 'success' | 'error';
  url: string;
  fieldCount: number;
}

interface Stats {
  totalCaptures: number;
  successfulCaptures: number;
  lastCaptureTime: string | null;
  recentLogs: CaptureLog[];
}

export const PopupApp: React.FC = () => {
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
  const isActive = true; // Extension is always active when loaded

  useEffect(() => {
    // Check for existing auth
    const checkAuthentication = async () => {
      try {
        const account = await getCurrentAccount();
        if (account) {
          setIsAuthenticated(true);
          setUserName(account.name || 'User');
          setUserEmail(account.username || '');
        } else {
          // Fall back to stored values
          chrome.storage.local.get(['authToken', 'userName', 'userEmail'], (result) => {
            if (result.authToken) {
              setIsAuthenticated(true);
              setUserName(result.userName || 'User');
              setUserEmail(result.userEmail || '');
            }
          });
        }
      } catch {
        // Check chrome.storage as fallback
        chrome.storage.local.get(['authToken', 'userName', 'userEmail'], (result) => {
          if (result.authToken) {
            setIsAuthenticated(true);
            setUserName(result.userName || 'User');
            setUserEmail(result.userEmail || '');
          }
        });
      }
    };
    
    checkAuthentication();

    // Load stats from storage
    chrome.storage.local.get(['captureStats'], (result) => {
      if (result.captureStats) {
        setStats(result.captureStats);
      }
    });

    // Listen for updates from content script
    const handleMessage = (message: any) => {
      if (message.type === 'CAPTURE_UPDATE') {
        setStats(message.stats);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const handleAuthenticate = async () => {
    setIsAuthenticating(true);

    try {
      const account = await signIn();
      if (account) {
        setIsAuthenticated(true);
        setUserName(account.name || 'User');
        setUserEmail(account.username || '');
      } else {
        alert('Sign in was cancelled or failed.');
      }
    } catch (error: any) {
      if (error?.errorCode === 'user_cancelled') {
        // User closed the popup, don't show error
      } else {
        console.error('Sign in error:', error);
        alert('Sign in failed. Please try again.');
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      // Ignore logout errors
    }
    setIsAuthenticated(false);
    setUserName('');
    setUserEmail('');
  };

  const clearStats = () => {
    const emptyStats: Stats = {
      totalCaptures: 0,
      successfulCaptures: 0,
      lastCaptureTime: null,
      recentLogs: [],
    };
    setStats(emptyStats);
    chrome.storage.local.set({ captureStats: emptyStats });
  };

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

  const getSuccessRate = () => {
    if (stats.totalCaptures === 0) return '0';
    return ((stats.successfulCaptures / stats.totalCaptures) * 100).toFixed(0);
  };

  return (
    <div
      style={{
        width: '380px',
        minHeight: '400px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        backgroundColor: '#f8f9fa',
      }}
    >
      {/* Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: '20px',
          color: 'white',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: '20px', margin: 0, fontWeight: '600' }}>
              VOANLA Service Logger
            </h1>
            <p style={{ fontSize: '12px', margin: '4px 0 0 0', opacity: 0.9 }}>
              Auto-capture for TFA tracking & OneLake
            </p>
          </div>
          <div
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: isActive ? '#4ade80' : '#ef4444',
              boxShadow: isActive ? '0 0 8px #4ade80' : '0 0 8px #ef4444',
            }}
          />
        </div>
      </div>

      <div style={{ padding: '20px' }}>
        {/* Authentication Section */}
        {!isAuthenticated ? (
          <div style={{
            backgroundColor: 'white',
            padding: '24px',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            marginBottom: '20px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔐</div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#374151' }}>
              Sign in with Microsoft
            </h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#6b7280' }}>
              Use your organization account to authenticate
            </p>
            <button
              onClick={handleAuthenticate}
              disabled={isAuthenticating}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '14px',
                fontWeight: '600',
                color: 'white',
                background: isAuthenticating ? '#9ca3af' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                border: 'none',
                borderRadius: '6px',
                cursor: isAuthenticating ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              {isAuthenticating ? (
                'Signing in...'
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 21 21" fill="currentColor">
                    <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                    <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                    <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                  </svg>
                  Sign in with Microsoft
                </>
              )}
            </button>
          </div>
        ) : (
          <div style={{
            backgroundColor: 'white',
            padding: '12px 16px',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            marginBottom: '20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '600',
                }}>
                  {userName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>{userName}</div>
                  <div style={{ fontSize: '11px', color: '#6b7280' }}>{userEmail}</div>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  color: '#ef4444',
                  background: 'transparent',
                  border: '1px solid #fecaca',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        )}

        {/* Statistics Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '16px 12px',
              borderRadius: '8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#667eea' }}>
              {stats.totalCaptures}
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>Total</div>
          </div>
          <div
            style={{
              backgroundColor: 'white',
              padding: '16px 12px',
              borderRadius: '8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#10b981' }}>
              {stats.successfulCaptures}
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>Success</div>
          </div>
          <div
            style={{
              backgroundColor: 'white',
              padding: '16px 12px',
              borderRadius: '8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#f59e0b' }}>
              {getSuccessRate()}%
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>Rate</div>
          </div>
        </div>

        {/* Last Capture Info */}
        <div
          style={{
            backgroundColor: 'white',
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            marginBottom: '16px',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
            Last TFA Submission
          </div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>
            {stats.lastCaptureTime ? (
              <>
                <span style={{ color: '#10b981' }}>✓</span> Submitted for TFA • {formatTime(stats.lastCaptureTime)}
              </>
            ) : (
              <span style={{ color: '#9ca3af' }}>No submissions yet</span>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div
          style={{
            backgroundColor: 'white',
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            marginBottom: '16px',
          }}
        >
          <div
            style={{
              fontSize: '12px',
              fontWeight: '600',
              color: '#374151',
              marginBottom: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Recent Activity</span>
            {stats.recentLogs.length > 0 && (
              <button
                onClick={clearStats}
                style={{
                  fontSize: '10px',
                  color: '#6b7280',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '4px',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f3f4f6')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                Clear
              </button>
            )}
          </div>
          <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
            {stats.recentLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#9ca3af', fontSize: '13px' }}>
                No recent activity
              </div>
            ) : (
              stats.recentLogs.slice(0, 5).map((log, index) => (
                <div
                  key={index}
                  style={{
                    padding: '10px',
                    borderBottom: index < Math.min(4, stats.recentLogs.length - 1) ? '1px solid #f3f4f6' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: log.status === 'success' ? '#10b981' : '#ef4444',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#6b7280',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {log.fieldCount} fields for TFA • {formatTime(log.timestamp)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Supported Sites */}
        <div
          style={{
            backgroundColor: 'white',
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '10px' }}>
            Supported Sites
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ color: '#10b981' }}>✓</span>
              <span>LSNDC (WellSky)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#10b981' }}>✓</span>
              <span>ServicePoint (WellSky)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
