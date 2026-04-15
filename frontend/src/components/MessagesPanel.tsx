import { useState } from 'react';
import { Submission } from '../types';

interface UnreadSubInfo {
  client_name?: string;
  status?: string;
  service_amount?: number;
  service_type?: string;
}

interface MessagesPanelProps {
  submissions: Submission[];
  unreadCounts: Record<string, number>;
  submissionInfo?: Record<string, UnreadSubInfo>;
  onOpenThread: (submission: Submission) => void;
  onMarkAllRead?: () => void;
  markingAllRead?: boolean;
}

function MessagesPanel({ submissions, unreadCounts, submissionInfo, onOpenThread, onMarkAllRead, markingAllRead }: MessagesPanelProps) {
  const [collapsed, setCollapsed] = useState(true);

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  if (totalUnread === 0) return null;

  // Build display list: prefer full submission data, fall back to API-provided info
  const submissionMap = new Map(submissions.map(s => [s.id, s]));
  const unreadEntries = Object.entries(unreadCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([id, count]) => {
      const sub = submissionMap.get(id);
      const info = submissionInfo?.[id];
      return {
        id,
        count,
        client_name: sub?.client_name || info?.client_name,
        status: sub?.status || info?.status,
        service_amount: sub?.service_amount ?? info?.service_amount,
        service_type: sub?.service_type || info?.service_type || 'TFA',
        submission: sub, // may be undefined
      };
    });

  return (
    <div style={{
      margin: '0 0 16px',
      border: '1px solid #fecaca',
      borderRadius: '10px',
      backgroundColor: '#fef2f2',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 4px 0 0',
      }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: 600,
            color: '#991b1b',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.1em' }}>💬</span>
            Unread Messages
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '20px',
              height: '20px',
              padding: '0 6px',
              borderRadius: '10px',
              backgroundColor: '#dc2626',
              color: '#fff',
              fontSize: '0.75rem',
              fontWeight: 700,
            }}>
              {totalUnread}
            </span>
          </span>
          <span style={{ fontSize: '0.8em', color: '#9ca3af' }}>
            {collapsed ? '▼' : '▲'}
          </span>
        </button>
        {onMarkAllRead && (
          <button
            onClick={onMarkAllRead}
            disabled={markingAllRead}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid #dc2626',
              backgroundColor: markingAllRead ? '#fca5a5' : '#fff',
              color: '#991b1b',
              fontSize: '0.72rem',
              fontWeight: 600,
              cursor: markingAllRead ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
              opacity: markingAllRead ? 0.6 : 1,
            }}
          >
            {markingAllRead ? 'Clearing…' : 'Mark All Read'}
          </button>
        )}
      </div>

      {/* Thread list */}
      {!collapsed && (
        <div style={{
          padding: '0 12px 12px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
        }}>
          {unreadEntries.map(entry => (
            <button
              key={entry.id}
              onClick={() => {
                if (entry.submission) {
                  onOpenThread(entry.submission);
                } else {
                  // Create a minimal stub submission so the modal can open the thread
                  onOpenThread({
                    id: entry.id,
                    user_id: '',
                    source_url: '',
                    captured_at_utc: '',
                    received_at_utc: '',
                    service_type: entry.service_type,
                    form_data: {},
                    client_name: entry.client_name,
                    status: (entry.status as any) || 'New',
                    service_amount: entry.service_amount,
                  });
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
                backgroundColor: '#fff',
                cursor: 'pointer',
                fontSize: '0.82rem',
                textAlign: 'left',
                transition: 'box-shadow 0.15s',
                maxWidth: '320px',
              }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
            >
              <span style={{
                minWidth: '22px',
                height: '22px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                backgroundColor: '#dc2626',
                color: '#fff',
                fontSize: '0.7rem',
                fontWeight: 700,
                flexShrink: 0,
              }}>
                {entry.count}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>{entry.client_name || 'Unknown'}</strong>
                {entry.service_amount != null && (
                  <span style={{ color: '#6b7280', marginLeft: '6px' }}>
                    ${entry.service_amount.toFixed(2)}
                  </span>
                )}
              </span>
              <span style={{
                flexShrink: 0,
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '0.65rem',
                fontWeight: 600,
                color: '#fff',
                backgroundColor:
                  entry.status === 'Corrections' ? '#ef4444' :
                  entry.status === 'In Review' ? '#f59e0b' :
                  entry.status === 'Submitted' ? '#10b981' : '#3b82f6',
              }}>
                {entry.status || 'New'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MessagesPanel;
