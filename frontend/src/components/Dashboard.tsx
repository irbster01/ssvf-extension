import { useState, useEffect, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { Capacitor } from '@capacitor/core';
import { Submission, SubmissionStatus } from '../types';
import { fetchSubmissions, updateSubmission, uploadAttachment, getAttachmentDownloadUrl, createNetSuitePO, fetchNetSuiteVendors, NetSuiteVendor } from '../api/submissions';
import { nativeAuth } from '../auth/nativeAuth';
import EditModal from './EditModal';
import PurchaseOrderModal, { PurchaseOrderData } from './PurchaseOrderModal';
import SubmitTFA from './SubmitTFA';

const STATUS_OPTIONS: SubmissionStatus[] = ['New', 'In Progress', 'Complete'];
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

    const response = await instance.acquireTokenSilent({
      scopes: ['User.Read'],
      account,
    });
    return response.accessToken;
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
    const token = await getToken();
    const result = await createNetSuitePO(token, {
      ...poData,
      dryRun: false, // Live mode — sends PO to NetSuite sandbox
    });
    return result;
  };

  const filteredSubmissions = statusFilter === 'all'
    ? submissions
    : submissions.filter(s => s.status === statusFilter);

  const stats = {
    new: submissions.filter(s => s.status === 'New').length,
    inProgress: submissions.filter(s => s.status === 'In Progress').length,
    complete: submissions.filter(s => s.status === 'Complete').length,
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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

      <div className="stats">
        <div className="stat-card new">
          <h3>New</h3>
          <div className="value">{stats.new}</div>
        </div>
        <div className="stat-card in-progress">
          <h3>In Progress</h3>
          <div className="value">{stats.inProgress}</div>
        </div>
        <div className="stat-card complete">
          <h3>Complete</h3>
          <div className="value">{stats.complete}</div>
        </div>
      </div>

      <div className="table-container">
        <div className="toolbar">
          <div className="filters">
            <label htmlFor="status-filter">Status:</label>
            <select id="status-filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All ({submissions.length})</option>
              <option value="New">New ({stats.new})</option>
              <option value="In Progress">In Progress ({stats.inProgress})</option>
              <option value="Complete">Complete ({stats.complete})</option>
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
              <th scope="col">Amount</th>
              <th scope="col">Files</th>
              <th scope="col">Captured By</th>
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
                  <td>{formatDate(submission.captured_at_utc)}</td>
                  <td>
                    <div><strong>{submission.client_name || '-'}</strong></div>
                    <div style={{ fontSize: '0.85em', color: '#666' }}>
                      {submission.client_id || 'No ID'}
                    </div>
                  </td>
                  <td>{submission.region || '-'}</td>
                  <td style={{ fontSize: '0.9em' }}>{submission.program_category || '-'}</td>
                  <td>
                    <div>{submission.vendor || '-'}</div>
                    <div style={{ fontSize: '0.85em', color: '#666' }}>
                      {submission.vendor_account || ''}
                    </div>
                  </td>
                  <td className="amount">{formatAmount(submission.service_amount)}</td>
                  <td>
                    {submission.attachments && submission.attachments.length > 0 ? (
                      <span title={submission.attachments.map(a => a.fileName).join(', ')} style={{ cursor: 'help' }}>
                        📎 {submission.attachments.length}
                      </span>
                    ) : (
                      <span style={{ color: '#ccc' }}>—</span>
                    )}
                  </td>
                  <td>{submission.user_id}</td>
                  <td style={{ display: 'flex', gap: '6px' }}>
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
    </>
  );
}

export default Dashboard;
