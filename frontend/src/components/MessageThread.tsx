import { useState, useEffect, useRef } from 'react';
import { Message } from '../types';
import { fetchMessages, sendMessage, markThreadRead } from '../api/submissions';

interface MessageThreadProps {
  submissionId: string;
  serviceType: string;
  currentUserEmail: string;
  getToken: () => Promise<string>;
  onUnreadChange?: (submissionId: string, unreadCount: number) => void;
}

function MessageThread({ submissionId, serviceType, currentUserEmail, getToken, onUnreadChange }: MessageThreadProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newText, setNewText] = useState('');
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await getToken();
      const msgs = await fetchMessages(token, submissionId);
      setMessages(msgs);

      // Mark thread as read
      const unreadCount = msgs.filter(
        m => m.sentBy !== currentUserEmail && !m.readBy.includes(currentUserEmail)
      ).length;

      if (unreadCount > 0) {
        await markThreadRead(token, submissionId);
        onUnreadChange?.(submissionId, 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMessages();
  }, [submissionId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e?: React.FormEvent | React.KeyboardEvent) => {
    e?.preventDefault();
    if (!newText.trim() || sending) return;

    setSending(true);
    try {
      const token = await getToken();
      const msg = await sendMessage(token, submissionId, newText.trim(), serviceType);
      setMessages(prev => [...prev, msg]);
      setNewText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const h = d.getHours();
    const ampm = h >= 12 ? 'p' : 'a';
    const hr = h % 12 || 12;
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hr}:${min}${ampm}`;
  };

  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      overflow: 'hidden',
      backgroundColor: '#f9fafb',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        backgroundColor: '#fff',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontWeight: 600, fontSize: '0.9em', color: '#374151' }}>
          Messages {messages.length > 0 && `(${messages.length})`}
        </span>
        <button
          onClick={loadMessages}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.8em',
            color: '#667eea',
            fontWeight: 500,
          }}
        >
          Refresh
        </button>
      </div>

      {/* Messages */}
      <div style={{
        maxHeight: '260px',
        overflowY: 'auto',
        padding: '10px',
      }}>
        {loading && messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: '#9ca3af', fontSize: '0.85em' }}>
            Loading messages…
          </div>
        ) : error && messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: '#ef4444', fontSize: '0.85em' }}>
            {error}
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: '#9ca3af', fontSize: '0.85em' }}>
            No messages yet. Send the first one below.
          </div>
        ) : (
          messages.map(msg => {
            const isMe = msg.sentBy === currentUserEmail;
            return (
              <div
                key={msg.id}
                style={{
                  marginBottom: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isMe ? 'flex-end' : 'flex-start',
                }}
              >
                <div style={{
                  maxWidth: '85%',
                  backgroundColor: isMe ? '#667eea' : '#ffffff',
                  color: isMe ? '#ffffff' : '#1f2937',
                  padding: '8px 12px',
                  borderRadius: isMe ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  border: isMe ? 'none' : '1px solid #e5e7eb',
                  fontSize: '0.85em',
                  lineHeight: '1.4',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {msg.text}
                </div>
                <div style={{
                  fontSize: '0.7em',
                  color: '#9ca3af',
                  marginTop: '2px',
                  padding: '0 4px',
                }}>
                  {msg.sentByName || msg.sentBy.split('@')[0]} · {formatTime(msg.sentAt)}
                </div>
              </div>
            );
          })
        )}
        <div ref={threadEndRef} />
      </div>

      {/* Input */}
      <div style={{
        display: 'flex',
        gap: '6px',
        padding: '8px 10px',
        borderTop: '1px solid #e5e7eb',
        backgroundColor: '#fff',
      }}>
        <input
          type="text"
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
          placeholder="Type a message…"
          disabled={sending}
          style={{
            flex: 1,
            padding: '8px 10px',
            fontSize: '0.85em',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            outline: 'none',
          }}
          onFocus={e => e.target.style.borderColor = '#667eea'}
          onBlur={e => e.target.style.borderColor = '#e5e7eb'}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !newText.trim()}
          style={{
            padding: '8px 14px',
            fontSize: '0.85em',
            fontWeight: 600,
            backgroundColor: sending || !newText.trim() ? '#d1d5db' : '#667eea',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: sending || !newText.trim() ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.2s',
          }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>

      {error && messages.length > 0 && (
        <div style={{
          padding: '6px 10px',
          fontSize: '0.75em',
          color: '#ef4444',
          backgroundColor: '#fef2f2',
          borderTop: '1px solid #fecaca',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default MessageThread;
