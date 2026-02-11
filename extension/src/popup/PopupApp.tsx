import React, { useState, useEffect } from 'react';
import { signIn, signOut, getCurrentAccount, silentTokenRefresh, getValidToken } from '../auth/authService';
import { API_URL } from '../config';

interface CaptureLog {
  timestamp: string;
  status: 'success' | 'error';
  url: string;
  fieldCount: number;
  clientId?: string;
}

interface Stats {
  totalCaptures: number;
  successfulCaptures: number;
  lastCaptureTime: string | null;
  recentLogs: CaptureLog[];
}

type SSVFRegion = 'Shreveport' | 'Monroe' | 'Arkansas';
type ProgramCategory = 'Homeless Prevention' | 'Rapid Rehousing';
type FinancialAssistanceType = 
  | 'Rental Assistance'
  | 'Moving Cost Assistance'
  | 'Utility Deposit'
  | 'Security Deposit'
  | 'Other as approved by VA'
  | 'Utility Assistance'
  | 'Motel/Hotel Voucher'
  | 'Emergency Supplies'
  | 'Transportation';

const FINANCIAL_ASSISTANCE_TYPES: FinancialAssistanceType[] = [
  'Rental Assistance',
  'Moving Cost Assistance',
  'Utility Deposit',
  'Security Deposit',
  'Other as approved by VA',
  'Utility Assistance',
  'Motel/Hotel Voucher',
  'Emergency Supplies',
  'Transportation',
];

interface ManualTFAForm {
  clientId: string;
  clientName: string;
  vendor: string;
  amount: string;
  region: SSVFRegion;
  programCategory: ProgramCategory;
  assistanceType: FinancialAssistanceType;
  notes: string;
}

interface Submission {
  id: string;
  client_id?: string;
  client_name?: string;
  vendor?: string;
  service_amount?: number;
  status?: 'New' | 'In Progress' | 'Complete';
  captured_at_utc: string;
}

type TabType = 'activity' | 'manual' | 'submissions';

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
  const [manualForm, setManualForm] = useState<ManualTFAForm>({
    clientId: '',
    clientName: '',
    vendor: '',
    amount: '',
    region: 'Shreveport',
    programCategory: 'Homeless Prevention',
    assistanceType: 'Rental Assistance',
    notes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [submissionsError, setSubmissionsError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  useEffect(() => {
    const checkAuthentication = async () => {
      try {
        const account = await getCurrentAccount();
        if (account) {
          setIsAuthenticated(true);
          setUserName(account.name || 'User');
          setUserEmail(account.username || '');
        } else {
          chrome.storage.local.get(['authToken', 'userName', 'userEmail'], (result) => {
            if (result.authToken) {
              setIsAuthenticated(true);
              setUserName(result.userName || 'User');
              setUserEmail(result.userEmail || '');
            }
          });
        }
      } catch {
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

  const handleAuthenticate = async () => {
    setIsAuthenticating(true);
    try {
      const account = await signIn();
      if (account) {
        setIsAuthenticated(true);
        setUserName(account.name || 'User');
        setUserEmail(account.username || '');
      }
    } catch (error: any) {
      if (error?.errorCode !== 'user_cancelled') {
        console.error('Sign in error:', error);
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

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.clientId || !manualForm.amount) {
      setSubmitMessage({ type: 'error', text: 'Client ID and Amount are required' });
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage(null);

    try {
      let token = await getValidToken();

      if (!token) {
        setSubmitMessage({ type: 'error', text: 'Please sign in first' });
        setIsSubmitting(false);
        return;
      }

      const payload = {
        user_id: 'unknown',
        source_url: 'manual-entry',
        captured_at_utc: new Date().toISOString(),
        form_data: {
          client_id: manualForm.clientId,
          client_name: manualForm.clientName,
          vendor: manualForm.vendor,
          service_cost_amount: manualForm.amount,
          region: manualForm.region,
          program_category: manualForm.programCategory,
          assistance_type: manualForm.assistanceType,
          notes: manualForm.notes,
          manual_entry: true,
        },
      };

      let response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      // Handle 401 - try silent refresh
      if (response.status === 401) {
        console.log('[PopupApp] Got 401 on submit, attempting silent token refresh...');
        const newToken = await silentTokenRefresh();
        
        if (newToken) {
          token = newToken;
          // Retry with new token
          response = await fetch(API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          });
        } else {
          // Silent refresh failed - user needs to sign in again
          setIsAuthenticated(false);
          setUserName('');
          setUserEmail('');
          setSubmitMessage({ type: 'error', text: 'Session expired. Please sign in again.' });
          setIsSubmitting(false);
          return;
        }
      }

      if (response.ok) {
        const result = await response.json().catch(() => null);
        const submissionId = result?.id;

        // Upload attachments if any
        if (selectedFiles.length > 0 && submissionId) {
          setUploadProgress(`Uploading ${selectedFiles.length} file(s)...`);
          for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            setUploadProgress(`Uploading ${i + 1}/${selectedFiles.length}: ${file.name}`);
            try {
              const base64 = await fileToBase64(file);
              await fetch(API_URL.replace('/captures', `/submissions/${submissionId}/attachments`), {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                  fileName: file.name,
                  contentType: file.type || 'application/octet-stream',
                  data: base64,
                  serviceType: 'TFA',
                }),
              });
            } catch (err) {
              console.error(`Failed to upload ${file.name}:`, err);
            }
          }
          setUploadProgress(null);
        }

        setSubmitMessage({ type: 'success', text: 'TFA submitted successfully!' });
        setManualForm({ clientId: '', clientName: '', vendor: '', amount: '', region: 'Shreveport', programCategory: 'Homeless Prevention', assistanceType: 'Rental Assistance', notes: '' });
        setSelectedFiles([]);
        
        // Update local stats
        const newStats = { ...stats };
        newStats.totalCaptures++;
        newStats.successfulCaptures++;
        newStats.lastCaptureTime = new Date().toISOString();
        newStats.recentLogs.unshift({
          timestamp: newStats.lastCaptureTime,
          status: 'success',
          url: 'Manual Entry',
          fieldCount: Object.keys(payload.form_data).length,
          clientId: manualForm.clientId,
        });
        if (newStats.recentLogs.length > 10) {
          newStats.recentLogs = newStats.recentLogs.slice(0, 10);
        }
        setStats(newStats);
        chrome.storage.local.set({ captureStats: newStats });
      } else {
        setSubmitMessage({ type: 'error', text: 'Failed to submit. Please try again.' });
      }
    } catch (error) {
      setSubmitMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the data:xxx;base64, prefix
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const maxSize = 10 * 1024 * 1024; // 10MB
    const validFiles = files.filter(f => f.size <= maxSize);
    if (validFiles.length < files.length) {
      setSubmitMessage({ type: 'error', text: 'Some files were too large (max 10MB each)' });
    }
    setSelectedFiles(prev => [...prev, ...validFiles]);
    e.target.value = ''; // Reset input
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
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

      let response = await fetch(`${API_URL.replace('/captures', '/submissions')}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      // Handle 401 - try silent refresh
      if (response.status === 401) {
        console.log('[PopupApp] Got 401, attempting silent token refresh...');
        const newToken = await silentTokenRefresh();
        
        if (newToken) {
          // Retry with new token
          response = await fetch(`${API_URL.replace('/captures', '/submissions')}`, {
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
    } catch (err) {
      setSubmissionsError(err instanceof Error ? err.message : 'Failed to load submissions');
    } finally {
      setLoadingSubmissions(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'submissions' && isAuthenticated) {
      fetchSubmissions();
    }
  }, [activeTab, isAuthenticated]);

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

  const styles = {
    container: {
      width: '380px',
      minHeight: '480px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      backgroundColor: '#f8f9fa',
    },
    header: {
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '16px 20px',
      color: 'white',
    },
    headerTitle: {
      fontSize: '18px',
      margin: 0,
      fontWeight: 600,
    },
    headerSubtitle: {
      fontSize: '12px',
      margin: '4px 0 0 0',
      opacity: 0.9,
    },
    tabs: {
      display: 'flex',
      backgroundColor: 'white',
      borderBottom: '1px solid #e5e7eb',
    },
    tab: (active: boolean) => ({
      flex: 1,
      padding: '12px',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
      border: 'none',
      background: active ? 'white' : '#f9fafb',
      color: active ? '#667eea' : '#6b7280',
      borderBottom: active ? '2px solid #667eea' : '2px solid transparent',
      transition: 'all 0.2s',
    }),
    content: {
      padding: '16px',
    },
    card: {
      backgroundColor: 'white',
      padding: '16px',
      borderRadius: '8px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      marginBottom: '12px',
    },
    userCard: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    avatar: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      fontSize: '14px',
      fontWeight: 600,
    },
    statGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '10px',
      marginBottom: '12px',
    },
    statCard: {
      backgroundColor: 'white',
      padding: '12px',
      borderRadius: '8px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      textAlign: 'center' as const,
    },
    statValue: (color: string) => ({
      fontSize: '22px',
      fontWeight: 700,
      color,
    }),
    statLabel: {
      fontSize: '10px',
      color: '#6b7280',
      marginTop: '2px',
    },
    btn: (variant: 'primary' | 'secondary' | 'danger') => ({
      padding: '10px 16px',
      fontSize: '13px',
      fontWeight: 600,
      borderRadius: '6px',
      cursor: 'pointer',
      border: 'none',
      width: '100%',
      transition: 'all 0.2s',
      ...(variant === 'primary' && {
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
      }),
      ...(variant === 'secondary' && {
        background: '#f3f4f6',
        color: '#4b5563',
        border: '1px solid #e5e7eb',
      }),
      ...(variant === 'danger' && {
        background: 'transparent',
        color: '#ef4444',
        border: '1px solid #fecaca',
      }),
    }),
    input: {
      width: '100%',
      padding: '10px 12px',
      fontSize: '13px',
      border: '1px solid #e5e7eb',
      borderRadius: '6px',
      marginBottom: '10px',
      boxSizing: 'border-box' as const,
    },
    label: {
      fontSize: '12px',
      fontWeight: 600,
      color: '#374151',
      marginBottom: '4px',
      display: 'block',
    },
    message: (type: 'success' | 'error') => ({
      padding: '10px 12px',
      borderRadius: '6px',
      fontSize: '13px',
      marginBottom: '12px',
      backgroundColor: type === 'success' ? '#d1fae5' : '#fee2e2',
      color: type === 'success' ? '#065f46' : '#991b1b',
      border: `1px solid ${type === 'success' ? '#a7f3d0' : '#fecaca'}`,
    }),
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
            <div style={styles.statGrid}>
              <div style={styles.statCard}>
                <div style={styles.statValue('#667eea')}>{stats.totalCaptures}</div>
                <div style={styles.statLabel}>Total</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statValue('#10b981')}>{stats.successfulCaptures}</div>
                <div style={styles.statLabel}>Success</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statValue('#f59e0b')}>
                  {stats.totalCaptures > 0 ? Math.round((stats.successfulCaptures / stats.totalCaptures) * 100) : 0}%
                </div>
                <div style={styles.statLabel}>Rate</div>
              </div>
            </div>

            <div style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>Recent Activity</span>
                {stats.recentLogs.length > 0 && (
                  <button
                    onClick={clearStats}
                    style={{ fontSize: '10px', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                {stats.recentLogs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#9ca3af', fontSize: '13px' }}>
                    No recent activity
                  </div>
                ) : (
                  stats.recentLogs.slice(0, 5).map((log, index) => (
                    <div
                      key={index}
                      style={{
                        padding: '8px 0',
                        borderBottom: index < Math.min(4, stats.recentLogs.length - 1) ? '1px solid #f3f4f6' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
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
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '12px', color: '#374151' }}>
                          {log.clientId ? `Client ${log.clientId}` : `${log.fieldCount} fields`}
                        </div>
                        <div style={{ fontSize: '10px', color: '#9ca3af' }}>{formatTime(log.timestamp)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={styles.card}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
                How it works
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.5 }}>
                When you click <strong>Save &amp; Exit</strong> on a WellSky service, you'll be prompted to submit
                it as a TFA record. Use the <strong>Manual Entry</strong> tab to add TFA records retroactively.
              </div>
            </div>
          </>
        )}

        {/* Manual Entry Tab */}
        {activeTab === 'manual' && (
          <form onSubmit={handleManualSubmit}>
            {submitMessage && <div style={styles.message(submitMessage.type)}>{submitMessage.text}</div>}

            <div style={styles.card}>
              <div style={{ marginBottom: '12px' }}>
                <label style={styles.label}>Client ID *</label>
                <input
                  type="text"
                  placeholder="e.g., 8542657"
                  value={manualForm.clientId}
                  onChange={(e) => setManualForm({ ...manualForm, clientId: e.target.value })}
                  style={styles.input}
                  required
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={styles.label}>Client Name</label>
                <input
                  type="text"
                  placeholder="e.g., John Smith"
                  value={manualForm.clientName}
                  onChange={(e) => setManualForm({ ...manualForm, clientName: e.target.value })}
                  style={styles.input}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>Region *</label>
                  <select
                    value={manualForm.region}
                    onChange={(e) => setManualForm({ ...manualForm, region: e.target.value as SSVFRegion })}
                    style={styles.input}
                    required
                  >
                    <option value="Shreveport">Shreveport</option>
                    <option value="Monroe">Monroe</option>
                    <option value="Arkansas">Arkansas</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>Program *</label>
                  <select
                    value={manualForm.programCategory}
                    onChange={(e) => setManualForm({ ...manualForm, programCategory: e.target.value as ProgramCategory })}
                    style={styles.input}
                    required
                  >
                    <option value="Homeless Prevention">Homeless Prevention</option>
                    <option value="Rapid Rehousing">Rapid Rehousing</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={styles.label}>Assistance Type *</label>
                <select
                  value={manualForm.assistanceType}
                  onChange={(e) => setManualForm({ ...manualForm, assistanceType: e.target.value as FinancialAssistanceType })}
                  style={styles.input}
                  required
                >
                  {FINANCIAL_ASSISTANCE_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={styles.label}>Vendor</label>
                <input
                  type="text"
                  placeholder="e.g., Electric Company"
                  value={manualForm.vendor}
                  onChange={(e) => setManualForm({ ...manualForm, vendor: e.target.value })}
                  style={styles.input}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={styles.label}>Amount *</label>
                <input
                  type="text"
                  placeholder="e.g., 150.00"
                  value={manualForm.amount}
                  onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
                  style={styles.input}
                  required
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={styles.label}>Notes</label>
                <input
                  type="text"
                  placeholder="Optional notes"
                  value={manualForm.notes}
                  onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
                  style={styles.input}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={styles.label}>Attachments</label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    border: '1px dashed #d1d5db',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: '#667eea',
                    backgroundColor: '#f9fafb',
                  }}
                >
                  <span>📎 Add files (PDF, images, docs — max 10MB)</span>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                </label>
                {selectedFiles.length > 0 && (
                  <div style={{ marginTop: '6px' }}>
                    {selectedFiles.map((file, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '4px 8px',
                          backgroundColor: '#f3f4f6',
                          borderRadius: '4px',
                          marginBottom: '4px',
                          fontSize: '11px',
                        }}
                      >
                        <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {file.name} ({(file.size / 1024).toFixed(0)}KB)
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFile(idx)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {uploadProgress && (
                  <div style={{ fontSize: '11px', color: '#667eea', marginTop: '4px' }}>{uploadProgress}</div>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !isAuthenticated}
                style={{
                  ...styles.btn('primary'),
                  opacity: isSubmitting || !isAuthenticated ? 0.7 : 1,
                  cursor: isSubmitting || !isAuthenticated ? 'not-allowed' : 'pointer',
                }}
              >
                {isSubmitting ? 'Submitting...' : 'Submit TFA Record'}
              </button>

              {!isAuthenticated && (
                <div style={{ fontSize: '11px', color: '#9ca3af', textAlign: 'center', marginTop: '8px' }}>
                  Please sign in to submit TFA records
                </div>
              )}
            </div>
          </form>
        )}

        {/* Submissions Tab */}
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
              <div style={{ ...styles.card, padding: '0', overflow: 'hidden' }}>
                <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  {submissions.map((sub) => (
                    <div
                      key={sub.id}
                      onClick={() => chrome.tabs.create({ url: 'https://wonderful-sand-00129870f.1.azurestaticapps.net' })}
                      style={{
                        padding: '10px 12px',
                        borderBottom: '1px solid #f3f4f6',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <div
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor:
                            sub.status === 'Complete' ? '#10b981' :
                            sub.status === 'In Progress' ? '#f59e0b' : '#3b82f6',
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {sub.client_name || sub.client_id || 'Unknown'}
                          </div>
                          {sub.service_amount && (
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#2563eb', flexShrink: 0, marginLeft: '8px' }}>
                              ${sub.service_amount.toFixed(2)}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ fontSize: '10px', color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {sub.vendor || 'No vendor'}
                          </div>
                          <div style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: '10px',
                            backgroundColor:
                              sub.status === 'Complete' ? '#d1fae5' :
                              sub.status === 'In Progress' ? '#fef3c7' : '#dbeafe',
                            color:
                              sub.status === 'Complete' ? '#065f46' :
                              sub.status === 'In Progress' ? '#92400e' : '#1e40af',
                            flexShrink: 0,
                            marginLeft: '8px',
                          }}>
                            {sub.status || 'New'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              onClick={() => chrome.tabs.create({ url: 'https://wonderful-sand-00129870f.1.azurestaticapps.net' })}
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
