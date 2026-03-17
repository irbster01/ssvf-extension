import { Submission, SubmissionStatus, UserRole, isElevatedRole } from '../types';
import StatusTooltip from './StatusTooltip';

interface SubmissionCardProps {
  submission: Submission;
  statusOptions: SubmissionStatus[];
  unreadCount: number;
  userRole: UserRole;
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
  userRole,
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
  const elevated = isElevatedRole(userRole);

  return (
    <article
      className={`mobile-card card-status-${(submission.status || 'New').toLowerCase().replace(' ', '-')}${isDead ? ' card-po-sent' : ''}`}
      role="listitem"
    >
      <div className="mobile-card-top">
        <StatusTooltip submission={submission}>
          {elevated ? (
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
          ) : (
            <span className={`status status-${submission.status?.toLowerCase().replace(' ', '-')}`} style={{ fontWeight: 600 }}>
              {submission.status || 'New'}
            </span>
          )}
        </StatusTooltip>
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
        {submission.status === 'Corrections' && !elevated ? (
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
        ) : elevated ? (
          <button
            className="btn btn-primary mobile-card-edit"
            onClick={() => onCreatePO(submission)}
            disabled={isDead}
            aria-label={`Create PO for ${submission.client_name || submission.client_id || 'unknown'}`}
          >
            {isDead ? 'PO Sent' : 'Create PO'}
          </button>
        ) : null}
        <button
          className="btn btn-secondary mobile-card-edit"
          onClick={() => onEdit(submission)}
          disabled={isDead}
          aria-label={`Edit submission for ${submission.client_name || submission.client_id || 'unknown'}`}
        >
          Edit
        </button>
        <button
          className={`msg-icon-btn msg-icon-btn-mobile${unreadCount > 0 ? ' msg-unread' : ''}`}
          onClick={() => onMessage(submission)}
          aria-label={`Messages for ${submission.client_name || submission.client_id || 'unknown'}${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          title={unreadCount > 0 ? `${unreadCount} unread` : 'Messages'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {unreadCount > 0 && <span className="msg-badge">{unreadCount}</span>}
        </button>
      </div>
    </article>
  );
}

export default SubmissionCard;
