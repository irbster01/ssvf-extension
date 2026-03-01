import { Submission, SubmissionStatus } from '../types';

interface SubmissionCardProps {
  submission: Submission;
  statusOptions: SubmissionStatus[];
  unreadCount: number;
  onStatusChange: (submission: Submission, status: SubmissionStatus) => void;
  onEdit: (submission: Submission) => void;
  onCreatePO: (submission: Submission) => void;
  onMessage: (submission: Submission) => void;
  onCorrection: (submission: Submission) => void;
  formatDate: (dateStr?: string) => string;
  abbreviateProgram: (prog?: string) => string;
  formatAmount: (amount?: number) => string;
}

function SubmissionCard({
  submission,
  statusOptions,
  unreadCount,
  onStatusChange,
  onEdit,
  onCreatePO,
  onMessage,
  onCorrection,
  formatDate,
  abbreviateProgram,
  formatAmount,
}: SubmissionCardProps) {
  const isDead = !!submission.po_number && !!submission.entered_in_system;

  return (
    <article
      className={`mobile-card card-status-${(submission.status || 'New').toLowerCase().replace(' ', '-')}${isDead ? ' card-po-sent' : ''}`}
      role="listitem"
    >
      <div className="mobile-card-top">
        <select
          className={`status status-${submission.status?.toLowerCase().replace(' ', '-')}`}
          value={submission.status}
          onChange={e => onStatusChange(submission, e.target.value as SubmissionStatus)}
          disabled={isDead}
          aria-label={`Status for ${submission.client_name || submission.client_id || 'submission'}`}
        >
          {statusOptions.map(status => (
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
      <div className="mobile-card-actions">
        {submission.status === 'Corrections' ? (
          <button
            className="btn mobile-card-edit"
            onClick={() => onCorrection(submission)}
            aria-label={`Fix corrections for ${submission.client_name || submission.client_id || 'unknown'}`}
            style={{
              backgroundColor: '#fff7ed',
              color: '#ea580c',
              border: '1px solid #fed7aa',
              fontWeight: 600,
            }}
          >
            ✎ Fix Corrections
          </button>
        ) : (
          <button
            className="btn btn-primary mobile-card-edit"
            onClick={() => onCreatePO(submission)}
            disabled={isDead}
            aria-label={`Create PO for ${submission.client_name || submission.client_id || 'unknown'}`}
          >
            {isDead ? 'PO Sent' : 'Create PO'}
          </button>
        )}
        <button
          className="btn btn-secondary mobile-card-edit"
          onClick={() => onEdit(submission)}
          disabled={isDead}
          aria-label={`Edit submission for ${submission.client_name || submission.client_id || 'unknown'}`}
        >
          Edit
        </button>
        <button
          className="btn mobile-card-edit"
          onClick={() => onMessage(submission)}
          aria-label={`Messages for ${submission.client_name || submission.client_id || 'unknown'}`}
          style={{
            backgroundColor: unreadCount > 0 ? '#fef2f2' : '#f0f9ff',
            color: unreadCount > 0 ? '#dc2626' : '#0369a1',
            border: `1px solid ${unreadCount > 0 ? '#fca5a5' : '#bae6fd'}`,
            fontWeight: 600,
          }}
        >
          {unreadCount > 0 ? `Msg(${unreadCount})` : 'Msg'}
        </button>
      </div>
    </article>
  );
}

export default SubmissionCard;
