import MessageThread from './MessageThread';
import { Submission } from '../types';

interface MessageModalProps {
  submission: Submission;
  currentUserEmail: string;
  getToken: () => Promise<string>;
  onClose: () => void;
  onDownloadFile?: (blobName: string) => void;
  onUnreadChange?: (submissionId: string, unreadCount: number) => void;
}

const formatFileSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

function MessageModal({ submission, currentUserEmail, getToken, onClose, onDownloadFile, onUnreadChange }: MessageModalProps) {
  const s = submission;
  const statusColors: Record<string, string> = {
    New: '#3b82f6', 'In Review': '#f59e0b', Corrections: '#ef4444', Submitted: '#10b981',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '900px',
          width: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          flexShrink: 0,
        }}>
          <h2 style={{ margin: 0 }}>
            Messages
            {s.client_name && (
              <span style={{ fontWeight: 400, fontSize: '0.75em', color: '#6b7280', marginLeft: '8px' }}>
                — {s.client_name}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.4em',
              cursor: 'pointer',
              color: '#6b7280',
              padding: '4px 8px',
              lineHeight: 1,
            }}
            aria-label="Close messages"
          >
            ×
          </button>
        </div>

        {/* Two-panel layout */}
        <div style={{
          display: 'flex',
          gap: '16px',
          flex: 1,
          overflow: 'hidden',
          minHeight: 0,
        }}>
          {/* Left: Submission details (read-only) */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            paddingRight: '8px',
            minWidth: 0,
          }}>
            {/* Status badge */}
            <div style={{ marginBottom: '12px' }}>
              <span style={{
                display: 'inline-block',
                padding: '3px 10px',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: statusColors[s.status || 'New'] || '#6b7280',
              }}>
                {s.status || 'New'}
              </span>
            </div>

            {/* Details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.9em' }}>
              <DetailRow label="Client" value={s.client_name} meta={s.client_id ? `ID: ${s.client_id}` : undefined} />
              <DetailRow label="Vendor" value={s.vendor} />
              <DetailRow label="Amount" value={s.service_amount != null ? `$${s.service_amount.toFixed(2)}` : undefined} />
              <DetailRow label="Program" value={[s.region, s.program_category].filter(Boolean).join(' · ') || undefined} />
              <DetailRow label="Service" value={s.service_type} />
              <DetailRow label="TFA Date" value={s.tfa_date} />
              {s.po_number && <DetailRow label="PO #" value={s.po_number} />}
              <DetailRow label="Submitted" value={new Date(s.captured_at_utc).toLocaleDateString()} />
              <DetailRow label="Submitted By" value={s.user_id} />
              {s.notes && (
                <div>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#888', fontWeight: 600 }}>Notes</span>
                  <p style={{ margin: '2px 0 0', color: '#333', whiteSpace: 'pre-wrap', fontSize: '0.85em' }}>{s.notes}</p>
                </div>
              )}
            </div>

            {/* Attachments */}
            {s.attachments && s.attachments.length > 0 && (
              <div style={{ marginTop: '14px' }}>
                <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#888', fontWeight: 600 }}>
                  Attachments ({s.attachments.length})
                </span>
                <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {s.attachments.map((a, idx) => (
                    <div key={idx} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '5px 10px',
                      backgroundColor: '#f3f4f6',
                      borderRadius: '6px',
                      fontSize: '0.82em',
                    }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        📎 {a.fileName} ({formatFileSize(a.size)})
                      </span>
                      {onDownloadFile && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          onClick={() => onDownloadFile(a.blobName)}
                          style={{ marginLeft: '8px', fontSize: '0.8em' }}
                        >
                          Download
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Message thread */}
          <div style={{
            width: '320px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}>
            <MessageThread
              submissionId={s.id}
              serviceType={s.service_type}
              currentUserEmail={currentUserEmail}
              getToken={getToken}
              onUnreadChange={onUnreadChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, meta }: { label: string; value?: string | null; meta?: string }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
      <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#888', fontWeight: 600, minWidth: '72px' }}>{label}</span>
      <span style={{ fontWeight: 500, color: '#333' }}>{value}</span>
      {meta && <span style={{ fontSize: '0.8em', color: '#888' }}>{meta}</span>}
    </div>
  );
}

export default MessageModal;
