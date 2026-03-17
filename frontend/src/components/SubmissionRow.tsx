import { Submission, SubmissionStatus, UserRole, isElevatedRole } from '../types';
import StatusTooltip from './StatusTooltip';

interface SubmissionRowProps {
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

function SubmissionRow({
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
}: SubmissionRowProps) {
  const isDead = !!submission.po_number && !!submission.entered_in_system;
  const elevated = isElevatedRole(userRole);

  return (
    <tr className={`row-status-${(submission.status || 'New').toLowerCase().replace(' ', '-')}${isDead ? ' row-po-sent' : ''}`}>
      <td>
        <StatusTooltip submission={submission}>
          {elevated ? (
            <select
              className={`status status-${submission.status?.toLowerCase().replace(' ', '-')}`}
              value={submission.status}
              onChange={e => onStatusChange(submission, e.target.value as SubmissionStatus)}
              disabled={isDead}
              aria-label={`Status for ${submission.client_name || submission.client_id || 'submission'}`}
              style={{
                border: 'none',
                cursor: isDead ? 'default' : 'pointer',
                background: 'inherit',
                color: 'inherit',
                fontWeight: 600,
                opacity: isDead ? 0.6 : 1,
              }}
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
          {submission.status === 'Corrections' && !elevated ? (
            <button
              className="btn btn-small"
              onClick={() => onCorrection(submission)}
              aria-label={`Fix corrections for ${submission.client_name || submission.client_id || 'unknown'}`}
              style={{
                backgroundColor: '#fff7ed',
                color: '#ea580c',
                border: '1px solid #fed7aa',
                fontWeight: 600,
              }}
            >
              ✎ Fix
            </button>
          ) : elevated ? (
            <button
              className="btn btn-primary btn-small"
              onClick={() => onCreatePO(submission)}
              disabled={isDead}
              aria-label={`Create PO for ${submission.client_name || submission.client_id || 'unknown'}`}
            >
              PO
            </button>
          ) : null}
          <button
            className="btn btn-secondary btn-small"
            onClick={() => onEdit(submission)}
            disabled={isDead}
            aria-label={`Edit submission for ${submission.client_name || submission.client_id || 'unknown'}`}
          >
            Edit
          </button>
          <button
            className={`msg-icon-btn${unreadCount > 0 ? ' msg-unread' : ''}`}
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
      </td>
    </tr>
  );
}

export default SubmissionRow;
