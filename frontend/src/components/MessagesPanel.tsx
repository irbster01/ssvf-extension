import { useState } from 'react';
import { Submission } from '../types';

interface MessagesPanelProps {
  submissions: Submission[];
  unreadCounts: Record<string, number>;
  onOpenThread: (submission: Submission) => void;
}

function MessagesPanel({ submissions, unreadCounts, onOpenThread }: MessagesPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const unreadSubs = submissions
    .filter(s => (unreadCounts[s.id] || 0) > 0)
    .sort((a, b) => (unreadCounts[b.id] || 0) - (unreadCounts[a.id] || 0));

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  if (totalUnread === 0) return null;

  return (
    <div style={{
      margin: '0 0 16px',
      border: '1px solid #fecaca',
      borderRadius: '10px',
      backgroundColor: '#fef2f2',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          width: '100%',
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

      {/* Thread list */}
      {!collapsed && (
        <div style={{
          padding: '0 12px 12px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
        }}>
          {unreadSubs.map(sub => (
            <button
              key={sub.id}
              onClick={() => onOpenThread(sub)}
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
                {unreadCounts[sub.id]}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>{sub.client_name || sub.client_id || 'Unknown'}</strong>
                {sub.service_amount != null && (
                  <span style={{ color: '#6b7280', marginLeft: '6px' }}>
                    ${sub.service_amount.toFixed(2)}
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
                  sub.status === 'Corrections' ? '#ef4444' :
                  sub.status === 'In Review' ? '#f59e0b' :
                  sub.status === 'Submitted' ? '#10b981' : '#3b82f6',
              }}>
                {sub.status || 'New'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MessagesPanel;
