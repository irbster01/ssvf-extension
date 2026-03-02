import { useState, useEffect, useCallback, useRef } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { Capacitor } from '@capacitor/core';
import { Submission, SubmissionStatus, UserRole, isElevatedRole } from '../types';
import { fetchSubmissions, updateSubmission, uploadAttachment, getAttachmentDownloadUrl, createNetSuitePO, fetchNetSuiteVendors, NetSuiteVendor, fetchUnreadCount, sendMessage, fetchClients, addClient, ClientRecord } from '../api/submissions';
import { nativeAuth } from '../auth/nativeAuth';
import { useSignalR } from '../hooks/useSignalR';
import EditModal from './EditModal';
import MessageModal from './MessageModal';
import CorrectionModal from './CorrectionModal';
import PurchaseOrderModal, { PurchaseOrderData } from './PurchaseOrderModal';
import SubmitTFA from './SubmitTFA';
import AnalyticsModal from './AnalyticsModal';
import TimelineModal from './TimelineModal';
import SubmissionRow from './SubmissionRow';
import SubmissionCard from './SubmissionCard';

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

const STATUS_OPTIONS: SubmissionStatus[] = ['New', 'Corrections', 'In Review', 'Submitted'];
const isNative = Capacitor.isNativePlatform();

type SortKey = 'date' | 'client' | 'region' | 'program' | 'vendor' | 'amount' | 'status';
type SortDir = 'asc' | 'desc';

function Dashboard() {
  const { instance, accounts } = useMsal();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [programFilter, setProgramFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [editingSubmission, setEditingSubmission] = useState<Submission | null>(null);
  const [poSubmission, setPoSubmission] = useState<Submission | null>(null);
  const [messageSubmission, setMessageSubmission] = useState<Submission | null>(null);
  const [correctionSubmission, setCorrectionSubmission] = useState<Submission | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [vendors, setVendors] = useState<NetSuiteVendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('user');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'date' ? 'desc' : 'asc');
    }
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
    return id;
  }, []);

  const updateToast = useCallback((id: number, type: Toast['type'], message: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, type, message } : t));
    // Auto-dismiss after 5s from the update
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const currentUsername = isNative ? (nativeAuth.getAccount()?.username || '') : (accounts[0]?.username || '');

  const getToken = useCallback(async (): Promise<string> => {
    // Check for Chrome extension SSO token first
    const extensionToken = sessionStorage.getItem('extension_sso_token');
    if (extensionToken) {
      // Validate token is not expired (basic check)
      try {
        const payload = JSON.parse(atob(extensionToken.split('.')[1]));
        const exp = payload.exp * 1000;
        if (exp > Date.now()) {
          return extensionToken;
        } else {
          sessionStorage.removeItem('extension_sso_token');
        }
      } catch {
        sessionStorage.removeItem('extension_sso_token');
      }
    }

    if (isNative) {
      // Use native auth service
      let token = nativeAuth.getAccessToken();
      if (!token) {
        // Try refresh
        token = await nativeAuth.refreshAccessToken();
      }
      if (!token) throw new Error('Not authenticated');
      return token;
    }

    // Web: use MSAL
    const account = accounts[0];
    if (!account) throw new Error('No account');

    try {
      const response = await instance.acquireTokenSilent({
        scopes: ['User.Read'],
        account,
      });
      return response.accessToken;
    } catch (err) {
      // If the cached token/refresh token is expired or invalid,
      // fall back to an interactive redirect to re-authenticate
      if (err instanceof InteractionRequiredAuthError) {
        console.warn('[MSAL] Silent token failed, redirecting to login');
        await instance.acquireTokenRedirect({ scopes: ['User.Read'], account });
        // acquireTokenRedirect navigates away; this line won't execute
        throw new Error('Redirecting to login...');
      }
      throw err;
    }
  }, [instance, accounts]);

  const loadSubmissions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await getToken();
      const { submissions: data, role } = await fetchSubmissions(token);
      setUserRole(role);
      // Default status to 'New' if not set
      const withStatus = data.map(s => ({
        ...s,
        status: s.status || 'New' as SubmissionStatus,
      }));
      setSubmissions(withStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load submissions');
    } finally {
      setLoading(false);
      setLastRefreshed(new Date());
    }
  }, [getToken]);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  // Fetch NetSuite vendor list once on mount
  useEffect(() => {
    (async () => {
      try {
        setVendorsLoading(true);
        const token = await getToken();
        const v = await fetchNetSuiteVendors(token);
        setVendors(v);
      } catch {
        // Non-critical — vendor autocomplete degrades gracefully
        console.warn('Could not load NetSuite vendors');
      } finally {
        setVendorsLoading(false);
      }
    })();
  }, [getToken]);

  // Fetch client seed list once on mount
  useEffect(() => {
    (async () => {
      try {
        setClientsLoading(true);
        const token = await getToken();
        const c = await fetchClients(token);
        setClients(c);
      } catch {
        console.warn('Could not load client seed');
      } finally {
        setClientsLoading(false);
      }
    })();
  }, [getToken]);

  // Persist a new/updated client to Cosmos and update local state
  const handleClientAdded = useCallback(async (client: ClientRecord) => {
    setClients(prev => {
      const idx = prev.findIndex(c => c.id === client.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...client };
        return updated;
      }
      return [...prev, client];
    });
    try {
      const token = await getToken();
      await addClient(token, client.id, client.clientName, client.program, client.region);
    } catch {
      console.warn('Could not persist client');
    }
  }, [getToken]);

  // Fetch unread message counts
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const data = await fetchUnreadCount(token);
        setUnreadCounts(data.perSubmission || {});
      } catch {
        // Non-critical
        console.warn('Could not load unread counts');
      }
    })();
  }, [getToken]);

  const handleUnreadChange = useCallback((submissionId: string, unreadCount: number) => {
    setUnreadCounts(prev => {
      const next = { ...prev };
      if (unreadCount === 0) {
        delete next[submissionId];
      } else {
        next[submissionId] = unreadCount;
      }
      return next;
    });
  }, []);

  // Real-time message updates via SignalR
  const handleSignalRUnread = useCallback((submissionId: string, delta: number) => {
    setUnreadCounts(prev => ({
      ...prev,
      [submissionId]: (prev[submissionId] || 0) + delta,
    }));
  }, []);

  const handleSignalRNewMessage = useCallback(() => {
    addToast('info', 'New message received');
  }, [addToast]);

  useSignalR({
    getToken,
    currentUserEmail: currentUsername,
    onNewMessage: handleSignalRNewMessage,
    onUnreadCountUpdate: handleSignalRUnread,
  });

  const handleStatusChange = async (submission: Submission, newStatus: SubmissionStatus) => {
    try {
      const token = await getToken();
      const updated = await updateSubmission(token, submission.id, submission.service_type, {
        status: newStatus,
        updated_by: currentUsername,
        updated_at: new Date().toISOString(),
      });
      setSubmissions(prev => prev.map(s => s.id === submission.id ? { ...s, ...updated, status: newStatus } : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const handleSaveEdit = async (updates: Partial<Submission>) => {
    if (!editingSubmission) return;
    try {
      const token = await getToken();
      const updated = await updateSubmission(token, editingSubmission.id, editingSubmission.service_type, {
        ...updates,
        updated_by: currentUsername,
        updated_at: new Date().toISOString(),
      });
      setSubmissions(prev => prev.map(s => s.id === editingSubmission.id ? { ...s, ...updated, ...updates } : s));
      setEditingSubmission(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    }
  };

  const handleSaveCorrection = async (updates: Partial<Submission>) => {
    if (!correctionSubmission) return;
    try {
      const token = await getToken();
      const updated = await updateSubmission(token, correctionSubmission.id, correctionSubmission.service_type, {
        ...updates,
        updated_by: currentUsername,
        updated_at: new Date().toISOString(),
      });
      setSubmissions(prev => prev.map(s => s.id === correctionSubmission.id ? { ...s, ...updated, ...updates } : s));
      setCorrectionSubmission(null);
      addToast('success', 'Corrections submitted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save corrections');
    }
  };

  const handleUploadFile = async (file: File) => {
    if (!editingSubmission) throw new Error('No submission selected');
    const token = await getToken();
    const meta = await uploadAttachment(token, editingSubmission.id, editingSubmission.service_type, file);
    // Update local state with new attachment
    setSubmissions(prev => prev.map(s => {
      if (s.id === editingSubmission.id) {
        const attachments = [...(s.attachments || []), meta];
        return { ...s, attachments };
      }
      return s;
    }));
    return meta;
  };

  const handleCorrectionUploadFile = async (file: File) => {
    if (!correctionSubmission) throw new Error('No submission selected');
    const token = await getToken();
    const meta = await uploadAttachment(token, correctionSubmission.id, correctionSubmission.service_type, file);
    setSubmissions(prev => prev.map(s => {
      if (s.id === correctionSubmission.id) {
        const attachments = [...(s.attachments || []), meta];
        return { ...s, attachments };
      }
      return s;
    }));
    return meta;
  };

  const handleDownloadFile = async (blobName: string) => {
    try {
      const token = await getToken();
      const url = await getAttachmentDownloadUrl(token, blobName);
      window.open(url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download file');
    }
  };

  const handleCreatePO = async (poData: PurchaseOrderData) => {
    // Close modal immediately and show "sending" toast
    const submissionId = poData.submissionId;
    const serviceType = poSubmission?.service_type || '';
    setPoSubmission(null);
    const toastId = addToast('info', 'Sending PO to NetSuite…');

    try {
      const token = await getToken();
      const result = await createNetSuitePO(token, {
        ...poData,
        dryRun: false,
      });
      if (result.success) {
        const poId = result.response?.poId;
        updateToast(toastId, 'success', poId ? `Created ${poId}` : 'Purchase Order created!');
        if (poId) {
          handlePOCreated(submissionId, poId, serviceType);
        }
      } else {
        updateToast(toastId, 'error', result.message || 'Failed to create PO');
      }
      return result;
    } catch (err) {
      updateToast(toastId, 'error', err instanceof Error ? err.message : 'Failed to create PO');
      return { success: false, message: 'Failed to create PO' };
    }
  };

  const handlePOCreated = useCallback(async (submissionId: string, poNumber: string, serviceType: string) => {
    // Update local state immediately — set PO number AND status to Submitted
    setSubmissions(prev => prev.map(s =>
      s.id === submissionId ? { ...s, po_number: poNumber, status: 'Submitted' as SubmissionStatus } : s
    ));
    // Persist the PO number + status on the submission in Cosmos DB
    try {
      const token = await getToken();
      await updateSubmission(token, submissionId, serviceType, {
        po_number: poNumber,
        status: 'Submitted',
        updated_by: currentUsername,
        updated_at: new Date().toISOString(),
      } as any);
    } catch (err) {
      console.warn('Failed to save PO number to submission:', err);
    }
  }, [getToken, currentUsername]);

  const handleSendBack = useCallback(async (submissionId: string, serviceType: string, message: string) => {
    const token = await getToken();
    // Send the correction-request message
    await sendMessage(token, submissionId, `⚠️ Correction needed: ${message}`, serviceType);
    // Update status to Corrections
    await updateSubmission(token, submissionId, serviceType, {
      status: 'Corrections',
      updated_by: currentUsername,
      updated_at: new Date().toISOString(),
    } as any);
    // Update local state
    setSubmissions(prev => prev.map(s =>
      s.id === submissionId ? { ...s, status: 'Corrections' as SubmissionStatus } : s
    ));
    addToast('info', 'Sent back for corrections');
  }, [getToken, currentUsername, addToast]);

  const hasActiveFilters = statusFilter !== 'all' || regionFilter !== 'all' || programFilter !== 'all' || !!dateFrom || !!dateTo || !!searchQuery;

  const clearAllFilters = () => {
    setStatusFilter('all');
    setRegionFilter('all');
    setProgramFilter('all');
    setDateFrom('');
    setDateTo('');
    setSearchQuery('');
  };

  const filteredSubmissions = submissions.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (regionFilter !== 'all' && s.region !== regionFilter) return false;
    if (programFilter !== 'all' && s.program_category !== programFilter) return false;
    if (dateFrom) {
      const captured = new Date(s.captured_at_utc);
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      if (captured < from) return false;
    }
    if (dateTo) {
      const captured = new Date(s.captured_at_utc);
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      if (captured > to) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const haystack = [s.client_name, s.client_id, s.vendor, s.po_number]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const sortedSubmissions = [...filteredSubmissions].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'date': {
        const da = new Date(a.tfa_date || a.captured_at_utc).getTime();
        const db = new Date(b.tfa_date || b.captured_at_utc).getTime();
        cmp = da - db;
        break;
      }
      case 'client':
        cmp = (a.client_name || '').localeCompare(b.client_name || '');
        break;
      case 'region':
        cmp = (a.region || '').localeCompare(b.region || '');
        break;
      case 'program':
        cmp = (a.program_category || '').localeCompare(b.program_category || '');
        break;
      case 'vendor':
        cmp = (a.vendor || '').localeCompare(b.vendor || '');
        break;
      case 'amount':
        cmp = (a.service_amount || 0) - (b.service_amount || 0);
        break;
      case 'status':
        cmp = (a.status || '').localeCompare(b.status || '');
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const exportCSV = () => {
    const csvField = (val: unknown): string => {
      if (val === undefined || val === null) return '';
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };

    const headers = [
      'Date Captured',
      'TFA Date',
      'Client ID',
      'Client Name',
      'Region',
      'Program Category',
      'Assistance Type',
      'Vendor',
      'Amount',
      'Status',
      'PO Number',
      'Entered in System',
      'Entered By',
      'Entered At',
      'Notes',
    ];

    const rows = filteredSubmissions.map(s => [
      csvField(formatDate(s.captured_at_utc)),
      csvField(s.tfa_date ? formatDate(s.tfa_date) : ''),
      csvField(s.client_id),
      csvField(s.client_name),
      csvField(s.region),
      csvField(s.program_category),
      csvField(s.form_data?.assistance_type as string),
      csvField(s.vendor),
      csvField(s.service_amount !== undefined && s.service_amount !== null ? s.service_amount.toFixed(2) : ''),
      csvField(s.status),
      csvField(s.po_number),
      csvField(s.entered_in_system ? 'Yes' : 'No'),
      csvField(s.entered_in_system_by),
      csvField(s.entered_in_system_at ? formatDate(s.entered_in_system_at) : ''),
      csvField(s.notes),
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    // Build a descriptive filename
    const fromLabel = dateFrom ? dateFrom : 'all';
    const toLabel = dateTo ? dateTo : 'all';
    const statusLabel = statusFilter !== 'all' ? `-${statusFilter}` : '';
    const regionLabel = regionFilter !== 'all' ? `-${regionFilter}` : '';
    const programLabel = programFilter !== 'all' ? `-${abbreviateProgram(programFilter)}` : '';
    link.download = `SSVF-TFA-Report_${fromLabel}_to_${toLabel}${statusLabel}${regionLabel}${programLabel}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const stats = {
    new: submissions.filter(s => s.status === 'New').length,
    corrections: submissions.filter(s => s.status === 'Corrections').length,
    inReview: submissions.filter(s => s.status === 'In Review').length,
    submitted: submissions.filter(s => s.status === 'Submitted').length,
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  };

  const abbreviateProgram = (prog?: string) => {
    if (!prog) return '-';
    if (prog === 'Homeless Prevention') return 'HP';
    if (prog === 'Rapid Rehousing') return 'RR';
    return prog;
  };

  const formatAmount = (amount?: number) => {
    if (amount === undefined || amount === null) return '-';
    return `$${amount.toFixed(2)}`;
  };

  if (loading) {
    return <div className="loading">Loading submissions...</div>;
  }

  return (
    <>
      {error && <div className="error">{error}</div>}

      <SubmitTFA getToken={getToken} onSubmitted={loadSubmissions} vendors={vendors} vendorsLoading={vendorsLoading} clients={clients} clientsLoading={clientsLoading} onClientAdded={handleClientAdded} />

      <div className="table-container">
        <div className="toolbar">
          <div className="status-pills">
            <button
              className={`status-pill status-pill-all${statusFilter === 'all' ? ' active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All <span className="pill-count">{submissions.length}</span>
            </button>
            <button
              className={`status-pill status-pill-new${statusFilter === 'New' ? ' active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === 'New' ? 'all' : 'New')}
            >
              New <span className="pill-count">{stats.new}</span>
            </button>
            <button
              className={`status-pill status-pill-corrections${statusFilter === 'Corrections' ? ' active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === 'Corrections' ? 'all' : 'Corrections')}
            >
              Corrections <span className="pill-count">{stats.corrections}</span>
            </button>
            <button
              className={`status-pill status-pill-in-review${statusFilter === 'In Review' ? ' active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === 'In Review' ? 'all' : 'In Review')}
            >
              In Review <span className="pill-count">{stats.inReview}</span>
            </button>
            <button
              className={`status-pill status-pill-submitted${statusFilter === 'Submitted' ? ' active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === 'Submitted' ? 'all' : 'Submitted')}
            >
              Submitted <span className="pill-count">{stats.submitted}</span>
            </button>
          </div>
          <div className="filter-row">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search client, vendor, ID..."
              className="search-input"
              aria-label="Search submissions"
            />
            <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} aria-label="Filter by region">
              <option value="all">All Regions</option>
              <option value="Shreveport">Shreveport</option>
              <option value="Monroe">Monroe</option>
              <option value="Arkansas">Arkansas</option>
            </select>
            <select value={programFilter} onChange={e => setProgramFilter(e.target.value)} aria-label="Filter by program">
              <option value="all">All Programs</option>
              <option value="Homeless Prevention">HP</option>
              <option value="Rapid Rehousing">RR</option>
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="date-input"
              aria-label="Date from"
              placeholder="From"
            />
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="date-input"
              aria-label="Date to"
              placeholder="To"
            />
            {hasActiveFilters && (
              <button
                className="btn btn-small btn-clear"
                onClick={clearAllFilters}
                title="Clear all filters"
              >
                Clear
              </button>
            )}
          </div>
          <div className="toolbar-actions">
            <span className="export-count">{filteredSubmissions.length} record{filteredSubmissions.length !== 1 ? 's' : ''}</span>
            {isElevatedRole(userRole) && (
              <button
                className="btn btn-secondary"
                onClick={exportCSV}
                disabled={filteredSubmissions.length === 0}
                title={filteredSubmissions.length === 0 ? 'No records to export' : `Export ${filteredSubmissions.length} filtered records to CSV`}
              >
                Export CSV
              </button>
            )}
            {isElevatedRole(userRole) && (
              <button className="btn btn-secondary" onClick={() => setShowAnalytics(true)} aria-label="View analytics">
                Analytics
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => setShowTimeline(true)} aria-label="View MVP timeline">
              Timeline
            </button>
            {lastRefreshed && (
              <span className="last-refreshed" title={lastRefreshed.toLocaleString()}>
                {lastRefreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            <button className="btn btn-primary" onClick={loadSubmissions} aria-label="Refresh submissions">
              Refresh
            </button>
          </div>
        </div>

        {/* Desktop table */}
        <div className="table-scroll">
        <table className="desktop-table" aria-label="Submissions">
          <thead>
            <tr>
              <th scope="col" className="sortable-th" onClick={() => toggleSort('status')}>Status{sortIndicator('status')}</th>
              <th scope="col" className="sortable-th" onClick={() => toggleSort('date')}>Date{sortIndicator('date')}</th>
              <th scope="col" className="sortable-th" onClick={() => toggleSort('client')}>Client{sortIndicator('client')}</th>
              <th scope="col" className="sortable-th" onClick={() => toggleSort('region')}>Region{sortIndicator('region')}</th>
              <th scope="col" className="sortable-th" onClick={() => toggleSort('program')}>Prog{sortIndicator('program')}</th>
              <th scope="col" className="sortable-th" onClick={() => toggleSort('vendor')}>Vendor{sortIndicator('vendor')}</th>
              <th scope="col" className="sortable-th" onClick={() => toggleSort('amount')}>Amt{sortIndicator('amount')}</th>
              <th scope="col">PO#</th>
              <th scope="col">Files</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedSubmissions.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '40px' }}>
                  No submissions found
                </td>
              </tr>
            ) : (
              sortedSubmissions.map(submission => (
                <SubmissionRow
                  key={submission.id}
                  submission={submission}
                  statusOptions={STATUS_OPTIONS}
                  unreadCount={unreadCounts[submission.id] || 0}
                  userRole={userRole}
                  onStatusChange={handleStatusChange}
                  onEdit={setEditingSubmission}
                  onCreatePO={setPoSubmission}
                  onMessage={setMessageSubmission}
                  onCorrection={setCorrectionSubmission}
                  formatDate={formatDate}
                  abbreviateProgram={abbreviateProgram}
                  formatAmount={formatAmount}
                />
              ))
            )}
          </tbody>
        </table>
        </div>

        {/* Mobile cards */}
        <div className="mobile-cards" role="list" aria-label="Submissions">
          {sortedSubmissions.length === 0 ? (
            <div className="mobile-card-empty">No submissions found</div>
          ) : (
            sortedSubmissions.map(submission => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                statusOptions={STATUS_OPTIONS}
                unreadCount={unreadCounts[submission.id] || 0}
                userRole={userRole}
                onStatusChange={handleStatusChange}
                onEdit={setEditingSubmission}
                onCreatePO={setPoSubmission}
                onMessage={setMessageSubmission}
                onCorrection={setCorrectionSubmission}
                formatDate={formatDate}
                abbreviateProgram={abbreviateProgram}
                formatAmount={formatAmount}
              />
            ))
          )}
        </div>
      </div>

      {editingSubmission && (
        <EditModal
          submission={editingSubmission}
          vendors={vendors}
          vendorsLoading={vendorsLoading}
          clients={clients}
          clientsLoading={clientsLoading}
          currentUsername={currentUsername}
          userRole={userRole}
          onSave={handleSaveEdit}
          onClose={() => setEditingSubmission(null)}
          onUploadFile={handleUploadFile}
          onDownloadFile={handleDownloadFile}
          onClientAdded={handleClientAdded}
        />
      )}

      {correctionSubmission && (
        <CorrectionModal
          submission={correctionSubmission}
          vendors={vendors}
          vendorsLoading={vendorsLoading}
          clients={clients}
          clientsLoading={clientsLoading}
          currentUserEmail={currentUsername}
          getToken={getToken}
          onSave={handleSaveCorrection}
          onClose={() => setCorrectionSubmission(null)}
          onUploadFile={handleCorrectionUploadFile}
          onDownloadFile={handleDownloadFile}
          onUnreadChange={handleUnreadChange}
          onClientAdded={handleClientAdded}
        />
      )}

      {messageSubmission && (
        <MessageModal
          submission={messageSubmission}
          currentUserEmail={currentUsername}
          getToken={getToken}
          onClose={() => setMessageSubmission(null)}
          onDownloadFile={handleDownloadFile}
          onUnreadChange={handleUnreadChange}
        />
      )}

      {poSubmission && (
        <PurchaseOrderModal
          submission={poSubmission}
          vendors={vendors}
          vendorsLoading={vendorsLoading}
          onClose={() => setPoSubmission(null)}
          onSubmitPO={handleCreatePO}
          onSendBack={handleSendBack}
        />
      )}

      {/* Toast notifications */}
      <div className="toast-container" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span className="toast-icon">{toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : 'ℹ'}</span>
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}>×</button>
          </div>
        ))}
      </div>

      {/* Analytics Modal */}
      {showAnalytics && (
        <AnalyticsModal
          submissions={submissions}
          onClose={() => setShowAnalytics(false)}
        />
      )}

      {/* Timeline Modal */}
      {showTimeline && (
        <TimelineModal
          onClose={() => setShowTimeline(false)}
        />
      )}
    </>
  );
}

export default Dashboard;
