import { useState, useEffect, useCallback, useRef } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { Capacitor } from '@capacitor/core';
import { Submission, SubmissionStatus } from '../types';
import { fetchSubmissions, updateSubmission, uploadAttachment, getAttachmentDownloadUrl, createNetSuitePO, fetchNetSuiteVendors, NetSuiteVendor } from '../api/submissions';
import { nativeAuth } from '../auth/nativeAuth';
import EditModal from './EditModal';
import PurchaseOrderModal, { PurchaseOrderData } from './PurchaseOrderModal';
import SubmitTFA from './SubmitTFA';

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
  const [editingSubmission, setEditingSubmission] = useState<Submission | null>(null);
  const [poSubmission, setPoSubmission] = useState<Submission | null>(null);
  const [vendors, setVendors] = useState<NetSuiteVendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

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

  const filteredSubmissions = statusFilter === 'all'
    ? submissions
    : submissions.filter(s => s.status === statusFilter);

  const stats = {
    new: submissions.filter(s => s.status === 'New').length,
    submitted: submissions.filter(s => s.status === 'Submitted').length,
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const h = d.getHours();
    const ampm = h >= 12 ? 'p' : 'a';
    const hr = h % 12 || 12;
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd}/${yy} ${hr}:${min}${ampm}`;
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
          </div>
          <button className="btn btn-primary" onClick={loadSubmissions} aria-label="Refresh submissions">
            Refresh
          </button>
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
                <tr key={submission.id}>
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
                  <td className="cell-date">{formatDate(submission.captured_at_utc)}</td>
                  <td title={`${submission.client_name || ''} (${submission.client_id || ''})`}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}><strong>{submission.client_name || '-'}</strong></div>
                    <div style={{ fontSize: '0.8em', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {submission.client_id || ''}
                    </div>
                  </td>
                  <td>{submission.region || '-'}</td>
                  <td>{submission.program_category || '-'}</td>
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
                        📎{submission.attachments.length}
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
              <article key={submission.id} className="mobile-card" role="listitem">
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
                    <span>{formatDate(submission.captured_at_utc)}</span>
                  </div>
                  <div className="mobile-card-detail">
                    <span className="mobile-card-label">Region</span>
                    <span>{submission.region || '-'}</span>
                  </div>
                  <div className="mobile-card-detail">
                    <span className="mobile-card-label">Program</span>
                    <span>{submission.program_category || '-'}</span>
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
                      <span>📎 {submission.attachments.length}</span>
                    </div>
                  )}
                </div>
                <div className="mobile-card-actions" style={{ display: 'flex', gap: '10px' }}>
                  <button
                    className="btn btn-primary mobile-card-edit"
                    onClick={() => setPoSubmission(submission)}
                    aria-label={`Create PO for ${submission.client_name || submission.client_id || 'unknown'}`}
                    style={{ flex: 1 }}
                  >
                    Create PO
                  </button>
                  <button
                    className="btn btn-secondary mobile-card-edit"
                    onClick={() => setEditingSubmission(submission)}
                    aria-label={`Edit submission for ${submission.client_name || submission.client_id || 'unknown'}`}
                    style={{ flex: 1 }}
                  >
                    Edit
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
          onSave={handleSaveEdit}
          onClose={() => setEditingSubmission(null)}
          onUploadFile={handleUploadFile}
          onDownloadFile={handleDownloadFile}
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
    </>
  );
}

export default Dashboard;
