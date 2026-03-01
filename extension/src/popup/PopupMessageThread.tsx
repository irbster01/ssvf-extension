import React, { useRef, useEffect } from 'react';
import { ThreadMessage } from './popupTypes';

interface PopupMessageThreadProps {
  messages: ThreadMessage[];
  loading: boolean;
  replyText: string;
  onReplyTextChange: (text: string) => void;
  onSendReply: () => void;
  sendingReply: boolean;
  currentUserEmail: string;
}

/**
 * Inline message thread used in both the Activity tab (unread messages)
 * and the Submissions/Queue tab (per-submission thread).
 */
const PopupMessageThread: React.FC<PopupMessageThreadProps> = ({
  messages,
  loading,
  replyText,
  onReplyTextChange,
  onSendReply,
  sendingReply,
  currentUserEmail,
}) => {
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [messages.length]);

  return (
    <div>
      {loading ? (
        <div style={{ fontSize: '10px', color: '#9ca3af', textAlign: 'center', padding: '8px 0' }}>Loading messages...</div>
      ) : messages.length === 0 ? (
        <div style={{ fontSize: '10px', color: '#9ca3af', textAlign: 'center', padding: '8px 0' }}>No messages yet</div>
      ) : (
        <div style={{ maxHeight: '150px', overflowY: 'auto', marginBottom: '6px' }}>
          {messages.map((msg) => {
            const isMine = msg.sentBy === currentUserEmail;
            return (
              <div key={msg.id} style={{
                display: 'flex',
                justifyContent: isMine ? 'flex-end' : 'flex-start',
                marginBottom: '4px',
              }}>
                <div style={{
                  maxWidth: '80%',
                  padding: '4px 8px',
                  borderRadius: '8px',
                  backgroundColor: isMine ? '#667eea' : '#f3f4f6',
                  color: isMine ? 'white' : '#1f2937',
                  fontSize: '10px',
                }}>
                  {!isMine && (
                    <div style={{ fontSize: '9px', fontWeight: 600, marginBottom: '2px', color: isMine ? '#e0e7ff' : '#6b7280' }}>
                      {msg.sentByName}
                    </div>
                  )}
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.text}</div>
                  <div style={{ fontSize: '8px', opacity: 0.7, textAlign: 'right', marginTop: '2px' }}>
                    {new Date(msg.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={threadEndRef} />
        </div>
      )}
      {/* Reply input */}
      <div style={{ display: 'flex', gap: '4px' }}>
        <input
          type="text"
          value={replyText}
          onChange={(e) => onReplyTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSendReply();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          placeholder="Type a reply..."
          style={{
            flex: 1,
            padding: '4px 8px',
            fontSize: '10px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            outline: 'none',
          }}
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSendReply();
          }}
          disabled={sendingReply || !replyText.trim()}
          style={{
            padding: '4px 10px',
            fontSize: '10px',
            fontWeight: 600,
            background: 'linear-gradient(135deg, #667eea, #764ba2)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: sendingReply ? 'wait' : 'pointer',
            opacity: sendingReply || !replyText.trim() ? 0.6 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default PopupMessageThread;
