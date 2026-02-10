import { useState, useEffect, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { Submission, SubmissionStatus } from '../types';
import { fetchSubmissions, updateSubmission, uploadAttachment, getAttachmentDownloadUrl } from '../api/submissions';
import EditModal from './EditModal';

const STATUS_OPTIONS: SubmissionStatus[] = ['New', 'In Progress', 'Complete'];

function Dashboard() {
  const { instance, accounts } = useMsal();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingSubmission, setEditingSubmission] = useState<Submission | null>(null);

  const getToken = useCallback(async (): Promise<string> => {
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

  const handleStatusChange = async (submission: Submission, newStatus: SubmissionStatus) => {
    try {
      const token = await getToken();
      const updated = await updateSubmission(token, submission.id, submission.service_type, {
        status: newStatus,
        updated_by: accounts[0]?.username,
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
        updated_by: accounts[0]?.username,
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
            <label>Status:</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All ({submissions.length})</option>
              <option value="New">New ({stats.new})</option>
              <option value="In Progress">In Progress ({stats.inProgress})</option>
              <option value="Complete">Complete ({stats.complete})</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={loadSubmissions}>
            Refresh
          </button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Date</th>
              <th>Client</th>
              <th>Region</th>
              <th>Program</th>
              <th>Vendor</th>
              <th>Amount</th>
              <th>Files</th>
              <th>Captured By</th>
              <th>Actions</th>
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
                  <td>
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => setEditingSubmission(submission)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
    </>
  );
}

export default Dashboard;
