import { useState, useEffect, useCallback, useRef } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { Capacitor } from '@capacitor/core';
import { Submission, SubmissionStatus } from '../types';
import { fetchSubmissions, updateSubmission, uploadAttachment, getAttachmentDownloadUrl, createNetSuitePO, fetchNetSuiteVendors, NetSuiteVendor, fetchUnreadCount } from '../api/submissions';
import { nativeAuth } from '../auth/nativeAuth';
import { useSignalR } from '../hooks/useSignalR';
import EditModal from './EditModal';
import MessageModal from './MessageModal';
import PurchaseOrderModal, { PurchaseOrderData } from './PurchaseOrderModal';
import SubmitTFA from './SubmitTFA';
import AnalyticsModal from './AnalyticsModal';

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

const STATUS_OPTIONS: SubmissionStatus[] = ['New', 'Submitted'];
const isNative = Capacitor.isNativePlatform();

function Dashboard() {
  const { instance, accounts } = useMsal();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [editingSubmission, setEditingSubmission] = useState<Submission | null>(null);
  const [poSubmission, setPoSubmission] = useState<Submission | null>(null);
  const [messageSubmission, setMessageSubmission] = useState<Submission | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [vendors, setVendors] = useState<NetSuiteVendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

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
      const data = await fetchSubmissions(token);
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

  const filteredSubmissions = submissions.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
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
    return true;
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
    link.download = `SSVF-TFA-Report_${fromLabel}_to_${toLabel}${statusLabel}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const stats = {
    new: submissions.filter(s => s.status === 'New').length,
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

      <SubmitTFA getToken={getToken} onSubmitted={loadSubmissions} vendors={vendors} vendorsLoading={vendorsLoading} />

      <div className="table-container">
        <div className="toolbar">
          <div className="filters">
            <label htmlFor="status-filter">Status:</label>
            <select id="status-filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All ({submissions.length})</option>
              <option value="New">New ({stats.new})</option>
              <option value="Submitted">Submitted ({stats.submitted})</option>
            </select>
            <span className="filter-divider" />
            <label htmlFor="date-from">From:</label>
            <input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="date-input"
            />
            <label htmlFor="date-to">To:</label>
            <input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="date-input"
            />
            {(dateFrom || dateTo) && (
              <button
                className="btn btn-small btn-clear"
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                title="Clear date filter"
              >
                Clear
              </button>
            )}
          </div>
          <div className="toolbar-actions">
            <span className="export-count">{filteredSubmissions.length} record{filteredSubmissions.length !== 1 ? 's' : ''}</span>
            <button
              className="btn btn-secondary"
              onClick={exportCSV}
              disabled={filteredSubmissions.length === 0}
              title={filteredSubmissions.length === 0 ? 'No records to export' : `Export ${filteredSubmissions.length} records to CSV`}
            >
              Export CSV
            </button>
            <button className="btn btn-secondary" onClick={() => setShowAnalytics(true)} aria-label="View analytics">
              Analytics
            </button>
            <button className="btn btn-primary" onClick={loadSubmissions} aria-label="Refresh submissions">
              Refresh
            </button>
          </div>
        </div>

        {/* Desktop table */}
        <table className="desktop-table" aria-label="Submissions">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Date</th>
              <th scope="col">Client</th>
              <th scope="col">Region</th>
              <th scope="col">Program</th>
              <th scope="col">Vendor</th>
              <th scope="col">Amt</th>
              <th scope="col">PO#</th>
              <th scope="col">Files</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSubmissions.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '40px' }}>
                  No submissions found
                </td>
              </tr>
            ) : (
              filteredSubmissions.map(submission => (
                <tr key={submission.id} className={submission.entered_in_system ? 'row-entered' : 'row-not-entered'}>
                  <td>
                    <select
                      className={`status status-${submission.status?.toLowerCase().replace(' ', '-')}`}
                      value={submission.status}
                      onChange={e => handleStatusChange(submission, e.target.value as SubmissionStatus)}
                      aria-label={`Status for ${submission.client_name || submission.client_id || 'submission'}`}
                      style={{ 
                        border: 'none', 
                        cursor: 'pointer',
                        background: 'inherit',
                        color: 'inherit',
                        fontWeight: 600,
                      }}
                    >
                      {STATUS_OPTIONS.map(status => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                  <td className="cell-date">{formatDate(submission.tfa_date || submission.captured_at_utc)}</td>
                  <td title={`${submission.client_name || ''} (${submission.client_id || ''})`}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}><strong>{submission.client_name || '-'}</strong></div>
                    <div style={{ fontSize: '0.8em', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {submission.client_id || ''}
                    </div>
                  </td>
                  <td>{submission.region || '-'}</td>
                  <td title={submission.program_category || ''}>{abbreviateProgram(submission.program_category)}</td>
                  <td title={submission.vendor || ''}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{submission.vendor || '-'}</div>
                  </td>
                  <td className="amount">{formatAmount(submission.service_amount)}</td>
                  <td className="cell-po">
                    {submission.po_number ? (
                      <span className="po-badge">{submission.po_number}</span>
                    ) : (
                      <span style={{ color: '#ccc' }}>—</span>
                    )}
                  </td>
                  <td>
                    {submission.attachments && submission.attachments.length > 0 ? (
                      <span title={submission.attachments.map(a => a.fileName).join(', ')} style={{ cursor: 'help' }}>
                        📎
                      </span>
                    ) : (
                      <span style={{ color: '#ccc' }}>—</span>
                    )}
                  </td>
                  <td className="cell-actions">
                    <div className="actions-wrap">
                      <button
                        className="btn btn-primary btn-small"
                        onClick={() => setPoSubmission(submission)}
                        disabled={!!submission.po_number}
                        aria-label={`Create PO for ${submission.client_name || submission.client_id || 'unknown'}`}
                      >
                        PO
                      </button>
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => setEditingSubmission(submission)}
                        aria-label={`Edit submission for ${submission.client_name || submission.client_id || 'unknown'}`}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-small"
                        onClick={() => setMessageSubmission(submission)}
                        aria-label={`Messages for ${submission.client_name || submission.client_id || 'unknown'}`}
                        style={{
                          backgroundColor: unreadCounts[submission.id] > 0 ? '#fef2f2' : '#f0f9ff',
                          color: unreadCounts[submission.id] > 0 ? '#dc2626' : '#0369a1',
                          border: `1px solid ${unreadCounts[submission.id] > 0 ? '#fca5a5' : '#bae6fd'}`,
                          fontWeight: 600,
                        }}
                      >
                        {unreadCounts[submission.id] > 0 ? `Msg(${unreadCounts[submission.id]})` : 'Msg'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Mobile cards */}
        <div className="mobile-cards" role="list" aria-label="Submissions">
          {filteredSubmissions.length === 0 ? (
            <div className="mobile-card-empty">No submissions found</div>
          ) : (
            filteredSubmissions.map(submission => (
              <article key={submission.id} className={`mobile-card${submission.entered_in_system ? ' card-entered' : ''}`} role="listitem">
                <div className="mobile-card-top">
                  <select
                    className={`status status-${submission.status?.toLowerCase().replace(' ', '-')}`}
                    value={submission.status}
                    onChange={e => handleStatusChange(submission, e.target.value as SubmissionStatus)}
                    aria-label={`Status for ${submission.client_name || submission.client_id || 'submission'}`}
                  >
                    {STATUS_OPTIONS.map(status => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                  <span className="mobile-card-amount">{formatAmount(submission.service_amount)}</span>
                </div>
                <div className="mobile-card-client">
                  <strong>{submission.client_name || 'No Name'}</strong>
                  <span className="mobile-card-id">{submission.client_id || 'No ID'}</span>
                </div>
                <div className="mobile-card-details">
                  <div className="mobile-card-detail">
                    <span className="mobile-card-label">Date</span>
                    <span>{formatDate(submission.tfa_date || submission.captured_at_utc)}</span>
                  </div>
                  <div className="mobile-card-detail">
                    <span className="mobile-card-label">Region</span>
                    <span>{submission.region || '-'}</span>
                  </div>
                  <div className="mobile-card-detail">
                    <span className="mobile-card-label">Program</span>
                    <span>{abbreviateProgram(submission.program_category)}</span>
                  </div>
                  <div className="mobile-card-detail">
                    <span className="mobile-card-label">Vendor</span>
                    <span>{submission.vendor || '-'}</span>
                  </div>
                  {submission.po_number && (
                    <div className="mobile-card-detail">
                      <span className="mobile-card-label">PO #</span>
                      <span className="po-badge">{submission.po_number}</span>
                    </div>
                  )}
                  {submission.attachments && submission.attachments.length > 0 && (
                    <div className="mobile-card-detail">
                      <span className="mobile-card-label">Files</span>
                      <span>📎</span>
                    </div>
                  )}
                </div>
                <div className="mobile-card-actions" style={{ display: 'flex', gap: '10px' }}>
                  <button
                    className="btn btn-primary mobile-card-edit"
                    onClick={() => setPoSubmission(submission)}
                    disabled={!!submission.po_number}
                    aria-label={`Create PO for ${submission.client_name || submission.client_id || 'unknown'}`}
                    style={{ flex: 1 }}
                  >
                    {submission.po_number ? 'PO Sent' : 'Create PO'}
                  </button>
                  <button
                    className="btn btn-secondary mobile-card-edit"
                    onClick={() => setEditingSubmission(submission)}
                    aria-label={`Edit submission for ${submission.client_name || submission.client_id || 'unknown'}`}
                    style={{ flex: 1 }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn mobile-card-edit"
                    onClick={() => setMessageSubmission(submission)}
                    aria-label={`Messages for ${submission.client_name || submission.client_id || 'unknown'}`}
                    style={{
                      flex: 1,
                      backgroundColor: unreadCounts[submission.id] > 0 ? '#fef2f2' : '#f0f9ff',
                      color: unreadCounts[submission.id] > 0 ? '#dc2626' : '#0369a1',
                      border: `1px solid ${unreadCounts[submission.id] > 0 ? '#fca5a5' : '#bae6fd'}`,
                      fontWeight: 600,
                    }}
                  >
                    {unreadCounts[submission.id] > 0 ? `Msg(${unreadCounts[submission.id]})` : 'Msg'}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      {editingSubmission && (
        <EditModal
          submission={editingSubmission}
          vendors={vendors}
          vendorsLoading={vendorsLoading}
          currentUsername={currentUsername}
          onSave={handleSaveEdit}
          onClose={() => setEditingSubmission(null)}
          onUploadFile={handleUploadFile}
          onDownloadFile={handleDownloadFile}
        />
      )}

      {messageSubmission && (
        <MessageModal
          submissionId={messageSubmission.id}
          serviceType={messageSubmission.service_type}
          clientName={messageSubmission.client_name}
          currentUserEmail={currentUsername}
          getToken={getToken}
          onClose={() => setMessageSubmission(null)}
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
    </>
  );
}

export default Dashboard;
