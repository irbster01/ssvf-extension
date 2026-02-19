import React, { useState, useEffect, useRef } from 'react';
import { signIn, signOut, getCurrentAccount, silentTokenRefresh, getValidToken } from '../auth/authService';
import { API_URL, SWA_URL } from '../config';

interface NetSuiteVendor {
  id: string;
  entityId: string;
  companyName: string;
}

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
  tfaDate: string;
  notes: string;
}

interface Submission {
  id: string;
  client_id?: string;
  client_name?: string;
  vendor?: string;
  service_amount?: number;
  service_type?: string;
  status?: 'New' | 'In Progress' | 'Complete';
  captured_at_utc: string;
  region?: string;
  program_category?: string;
  entered_in_system?: boolean;
  entered_in_system_by?: string;
  entered_in_system_at?: string;
  form_data?: {
    assistance_type?: string;
    region?: string;
    program_category?: string;
    [key: string]: any;
  };
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
    tfaDate: '',
    notes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [submissionsError, setSubmissionsError] = useState<string | null>(null);
  const [togglingEnteredId, setTogglingEnteredId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showAuthWarning, setShowAuthWarning] = useState(false);

  // Messaging state
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [expandedMessagesSub, setExpandedMessagesSub] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<Array<{ id: string; text: string; sentBy: string; sentByName: string; sentAt: string; readBy: string[] }>>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Vendor autocomplete state
  const [vendors, setVendors] = useState<NetSuiteVendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [vendorSearch, setVendorSearch] = useState('');
  const [selectedVendor, setSelectedVendor] = useState<NetSuiteVendor | null>(null);
  const [showVendorDropdown, setShowVendorDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const vendorDropdownRef = useRef<HTMLDivElement>(null);
  const vendorInputRef = useRef<HTMLInputElement>(null);

  // Filter vendors based on search text
  const filteredVendors = vendorSearch.length >= 1
    ? vendors.filter(v =>
        v.companyName.toLowerCase().includes(vendorSearch.toLowerCase()) ||
        v.entityId.toLowerCase().includes(vendorSearch.toLowerCase())
      ).slice(0, 30)
    : [];

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

  // Close vendor dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (vendorDropdownRef.current && !vendorDropdownRef.current.contains(e.target as Node)) {
        setShowVendorDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleVendorSelect = (vendor: NetSuiteVendor) => {
    setSelectedVendor(vendor);
    setVendorSearch(vendor.companyName);
    setManualForm(prev => ({ ...prev, vendor: vendor.companyName }));
    setShowVendorDropdown(false);
    setHighlightIndex(-1);
  };

  const clearVendor = () => {
    setSelectedVendor(null);
    setVendorSearch('');
    setManualForm(prev => ({ ...prev, vendor: '' }));
    vendorInputRef.current?.focus();
  };

  const handleVendorKeyDown = (e: React.KeyboardEvent) => {
    if (!showVendorDropdown || filteredVendors.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => Math.min(prev + 1, filteredVendors.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      handleVendorSelect(filteredVendors[highlightIndex]);
    } else if (e.key === 'Escape') {
      setShowVendorDropdown(false);
    }
  };

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
          vendor_id: selectedVendor?.id || undefined,
          service_cost_amount: manualForm.amount,
          region: manualForm.region,
          program_category: manualForm.programCategory,
          assistance_type: manualForm.assistanceType,
          tfa_date: manualForm.tfaDate || undefined,
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
          setShowAuthWarning(true);
          setAuthError('Session expired. Please sign in again.');
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
        setManualForm({ clientId: '', clientName: '', vendor: '', amount: '', region: 'Shreveport', programCategory: 'Homeless Prevention', assistanceType: 'Rental Assistance', tfaDate: '', notes: '' });
        setSelectedFiles([]);
        setSelectedVendor(null);
        setVendorSearch('');
        
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
        setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
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
                              {threadLoading ? (
                                <div style={{ fontSize: '10px', color: '#9ca3af', textAlign: 'center', padding: '6px 0' }}>Loading...</div>
                              ) : threadMessages.length === 0 ? (
                                <div style={{ fontSize: '10px', color: '#9ca3af', textAlign: 'center', padding: '6px 0' }}>No messages</div>
                              ) : (
                                <div style={{ maxHeight: '150px', overflowY: 'auto', marginBottom: '6px' }}>
                                  {threadMessages.map(msg => {
                                    const isMine = msg.sentBy === userEmail;
                                    return (
                                      <div key={msg.id} style={{
                                        display: 'flex',
                                        justifyContent: isMine ? 'flex-end' : 'flex-start',
                                        marginBottom: '4px',
                                      }}>
                                        <div style={{
                                          maxWidth: '80%',
                                          padding: '4px 8px',
                                          borderRadius: '8px',
                                          backgroundColor: isMine ? '#667eea' : '#fff',
                                          color: isMine ? 'white' : '#1f2937',
                                          fontSize: '10px',
                                          border: isMine ? 'none' : '1px solid #e5e7eb',
                                        }}>
                                          {!isMine && (
                                            <div style={{ fontSize: '9px', fontWeight: 600, marginBottom: '2px', color: '#6b7280' }}>
                                              {msg.sentByName}
                                            </div>
                                          )}
                                          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.text}</div>
                                          <div style={{ fontSize: '8px', opacity: 0.7, textAlign: 'right', marginTop: '2px' }}>
                                            {new Date(msg.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  <div ref={threadEndRef} />
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <input
                                  type="text"
                                  value={replyText}
                                  onChange={e => setReplyText(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      handleSendReply(sub.id, sub.service_type || 'TFA');
                                    }
                                  }}
                                  placeholder="Type a reply..."
                                  style={{
                                    flex: 1,
                                    padding: '4px 8px',
                                    fontSize: '10px',
                                    border: '1px solid #d1d5db',
                                    borderRadius: '6px',
                                    outline: 'none',
                                  }}
                                />
                                <button
                                  onClick={() => handleSendReply(sub.id, sub.service_type || 'TFA')}
                                  disabled={sendingReply || !replyText.trim()}
                                  style={{
                                    padding: '4px 10px',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    background: 'linear-gradient(135deg, #667eea, #764ba2)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: sendingReply ? 'wait' : 'pointer',
                                    opacity: sendingReply || !replyText.trim() ? 0.6 : 1,
                                  }}
                                >
                                  Send
                                </button>
                              </div>
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
                <label style={styles.label}>TFA Date</label>
                <input
                  type="date"
                  value={manualForm.tfaDate}
                  onChange={(e) => setManualForm({ ...manualForm, tfaDate: e.target.value })}
                  style={styles.input}
                />
              </div>

              <div style={{ marginBottom: '12px', position: 'relative' }} ref={vendorDropdownRef}>
                <label style={styles.label}>Vendor *</label>
                <div style={{ position: 'relative' }}>
                  <input
                    ref={vendorInputRef}
                    type="text"
                    placeholder={vendorsLoading ? 'Loading vendors...' : 'Type to search vendors...'}
                    value={vendorSearch}
                    onChange={(e) => {
                      setVendorSearch(e.target.value);
                      setSelectedVendor(null);
                      setManualForm(prev => ({ ...prev, vendor: e.target.value }));
                      setShowVendorDropdown(true);
                      setHighlightIndex(-1);
                    }}
                    onFocus={() => vendorSearch.length >= 1 && setShowVendorDropdown(true)}
                    onKeyDown={handleVendorKeyDown}
                    disabled={vendorsLoading}
                    autoComplete="off"
                    style={styles.input}
                    required
                  />
                  {selectedVendor && (
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      backgroundColor: '#eef2ff',
                      borderRadius: '10px',
                      fontSize: '10px',
                      color: '#667eea',
                      fontWeight: 600,
                      marginTop: '-6px',
                      marginBottom: '4px',
                    }}>
                      <span>NS #{selectedVendor.id}</span>
                      <button
                        type="button"
                        onClick={clearVendor}
                        style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '12px', padding: '0 2px' }}
                        aria-label="Clear vendor"
                      >×</button>
                    </div>
                  )}
                </div>
                {showVendorDropdown && !selectedVendor && filteredVendors.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    maxHeight: '160px',
                    overflowY: 'auto',
                    zIndex: 100,
                  }}>
                    {filteredVendors.map((v, idx) => (
                      <div
                        key={v.id}
                        onClick={() => handleVendorSelect(v)}
                        onMouseEnter={() => setHighlightIndex(idx)}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          backgroundColor: idx === highlightIndex ? '#eef2ff' : 'white',
                          borderBottom: idx < filteredVendors.length - 1 ? '1px solid #f3f4f6' : 'none',
                          fontSize: '12px',
                        }}
                      >
                        <span style={{ color: '#374151', fontWeight: 500 }}>{v.companyName}</span>
                        <span style={{ color: '#9ca3af', fontSize: '10px' }}>#{v.entityId}</span>
                      </div>
                    ))}
                    {filteredVendors.length === 30 && (
                      <div style={{ padding: '6px 12px', fontSize: '10px', color: '#9ca3af', textAlign: 'center', borderTop: '1px solid #f3f4f6' }}>
                        Type more to narrow results...
                      </div>
                    )}
                  </div>
                )}
                {showVendorDropdown && !selectedVendor && vendorSearch.length >= 1 && filteredVendors.length === 0 && !vendorsLoading && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    padding: '10px 12px',
                    fontSize: '12px',
                    color: '#9ca3af',
                    zIndex: 100,
                  }}>
                    No vendors match "{vendorSearch}"
                  </div>
                )}
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
                          {threadLoading ? (
                            <div style={{ fontSize: '10px', color: '#9ca3af', textAlign: 'center', padding: '8px 0' }}>Loading messages...</div>
                          ) : threadMessages.length === 0 ? (
                            <div style={{ fontSize: '10px', color: '#9ca3af', textAlign: 'center', padding: '8px 0' }}>No messages yet</div>
                          ) : (
                            <div style={{ maxHeight: '150px', overflowY: 'auto', marginBottom: '6px' }}>
                              {threadMessages.map((msg) => {
                                const isMine = msg.sentBy === userEmail;
                                return (
                                  <div key={msg.id} style={{
                                    display: 'flex',
                                    justifyContent: isMine ? 'flex-end' : 'flex-start',
                                    marginBottom: '4px',
                                  }}>
                                    <div style={{
                                      maxWidth: '80%',
                                      padding: '4px 8px',
                                      borderRadius: '8px',
                                      backgroundColor: isMine ? '#667eea' : '#f3f4f6',
                                      color: isMine ? 'white' : '#1f2937',
                                      fontSize: '10px',
                                    }}>
                                      {!isMine && (
                                        <div style={{ fontSize: '9px', fontWeight: 600, marginBottom: '2px', color: isMine ? '#e0e7ff' : '#6b7280' }}>
                                          {msg.sentByName}
                                        </div>
                                      )}
                                      <div>{msg.text}</div>
                                      <div style={{ fontSize: '8px', opacity: 0.7, textAlign: 'right', marginTop: '2px' }}>
                                        {new Date(msg.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                              <div ref={threadEndRef} />
                            </div>
                          )}
                          {/* Reply input */}
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <input
                              type="text"
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  handleSendReply(sub.id, sub.service_type || 'TFA');
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              placeholder="Type a reply..."
                              style={{
                                flex: 1,
                                padding: '4px 8px',
                                fontSize: '10px',
                                border: '1px solid #d1d5db',
                                borderRadius: '6px',
                                outline: 'none',
                              }}
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSendReply(sub.id, sub.service_type || 'TFA');
                              }}
                              disabled={sendingReply || !replyText.trim()}
                              style={{
                                padding: '4px 10px',
                                fontSize: '10px',
                                fontWeight: 600,
                                background: 'linear-gradient(135deg, #667eea, #764ba2)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: sendingReply ? 'wait' : 'pointer',
                                opacity: sendingReply || !replyText.trim() ? 0.6 : 1,
                              }}
                            >
                              Send
                            </button>
                          </div>
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
