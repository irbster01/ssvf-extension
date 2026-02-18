import MessageThread from './MessageThread';

interface MessageModalProps {
  submissionId: string;
  serviceType: string;
  clientName?: string;
  currentUserEmail: string;
  getToken: () => Promise<string>;
  onClose: () => void;
  onUnreadChange?: (submissionId: string, unreadCount: number) => void;
}

function MessageModal({ submissionId, serviceType, clientName, currentUserEmail, getToken, onClose, onUnreadChange }: MessageModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '520px', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
        }}>
          <h2 style={{ margin: 0 }}>
            Messages
            {clientName && (
              <span style={{ fontWeight: 400, fontSize: '0.75em', color: '#6b7280', marginLeft: '8px' }}>
                — {clientName}
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
        <MessageThread
          submissionId={submissionId}
          serviceType={serviceType}
          currentUserEmail={currentUserEmail}
          getToken={getToken}
          onUnreadChange={onUnreadChange}
        />
      </div>
    </div>
  );
}

export default MessageModal;
