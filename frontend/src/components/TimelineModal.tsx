import { CheckCircle, Circle, Clock, Warning, X, Rocket, Shield, Code, CloudArrowUp } from 'phosphor-react';
import './TimelineModal.css';

interface TimelineModalProps {
  onClose: () => void;
}

interface Milestone {
  id: string;
  phase: string;
  title: string;
  description: string;
  status: 'completed' | 'in-progress' | 'pending';
  items: string[];
  effort?: string;
}

const MVP_TARGET_DATE = new Date('2026-03-07'); // 5 working days from March 2

const milestones: Milestone[] = [
  {
    id: 'core',
    phase: 'Phase 1',
    title: 'Core Workflow',
    description: 'End-to-end capture and submission pipeline',
    status: 'completed',
    items: [
      'WellSky form auto-capture',
      'Manual TFA submission',
      'Cosmos DB storage',
      'Dashboard filtering & search',
      'Full edit modal with vendor autocomplete',
      'Correction workflow',
      'CSV export',
    ],
  },
  {
    id: 'auth',
    phase: 'Phase 2',
    title: 'Authentication',
    description: 'Secure access across all platforms',
    status: 'completed',
    items: [
      'Entra ID on SWA (redirect flow)',
      'Entra ID on iOS (PKCE)',
      'Entra ID on extension (chrome.identity)',
      'Extension → SWA SSO pass-through',
      'API token validation',
    ],
  },
  {
    id: 'messaging',
    phase: 'Phase 3',
    title: 'Messaging & Notifications',
    description: 'Real-time communication system',
    status: 'completed',
    items: [
      'Bidirectional message threads',
      'Read receipts',
      'Unread count badges',
      'SignalR real-time push',
      'Email notifications (4 triggers)',
    ],
  },
  {
    id: 'netsuite',
    phase: 'Phase 4',
    title: 'NetSuite Integration',
    description: 'Purchase order creation pipeline',
    status: 'completed',
    items: [
      'Vendor search/autocomplete',
      'GL account lookup',
      'PO creation with line items',
      'Custom field mapping',
      'Attachment forwarding',
    ],
  },
  {
    id: 'p0',
    phase: 'Phase 5',
    title: 'P0 Security Hardening',
    description: 'Must-fix before user handoff',
    status: 'in-progress',
    effort: '1-2 days',
    items: [
      'Verify .gitignore covers local.settings.json',
      'Rotate secrets if repo was shared',
      'Verify NetSuite is production (not _SB1)',
      'Remove localhost from CORS origins',
      'Smoke-test email notifications',
    ],
  },
  {
    id: 'p1',
    phase: 'Phase 6',
    title: 'P1 MVP Features',
    description: 'Should ship with MVP',
    status: 'pending',
    effort: '2-3 days',
    items: [
      'Role-based access control (admin vs caseworker)',
      'Centralize CORS origins',
      'Add pagination to GetSubmissions',
    ],
  },
  {
    id: 'polish',
    phase: 'Phase 7',
    title: 'P2 Polish',
    description: 'Nice to have for launch',
    status: 'pending',
    effort: '1-2 days',
    items: [
      'Error boundaries in React',
      'Extension auth → PKCE',
      'Chrome Web Store submission',
      'App Store submission',
    ],
  },
];

function getStatusIcon(status: Milestone['status']) {
  switch (status) {
    case 'completed':
      return <CheckCircle weight="fill" className="status-icon completed" />;
    case 'in-progress':
      return <Clock weight="fill" className="status-icon in-progress" />;
    case 'pending':
      return <Circle weight="regular" className="status-icon pending" />;
  }
}

function getPhaseIcon(phase: string) {
  if (phase.includes('1') || phase.includes('2')) return <Code weight="bold" />;
  if (phase.includes('3') || phase.includes('4')) return <CloudArrowUp weight="bold" />;
  if (phase.includes('5')) return <Shield weight="bold" />;
  return <Rocket weight="bold" />;
}

function calculateProgress(): number {
  const completed = milestones.filter(m => m.status === 'completed').length;
  const inProgress = milestones.filter(m => m.status === 'in-progress').length;
  return Math.round(((completed + inProgress * 0.5) / milestones.length) * 100);
}

function getDaysRemaining(): number {
  const today = new Date();
  const diffTime = MVP_TARGET_DATE.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export default function TimelineModal({ onClose }: TimelineModalProps) {
  const progress = calculateProgress();
  const daysRemaining = getDaysRemaining();
  const completedCount = milestones.filter(m => m.status === 'completed').length;

  return (
    <div className="timeline-modal-overlay" onClick={onClose}>
      <div className="timeline-modal" onClick={(e) => e.stopPropagation()}>
        <div className="timeline-modal-header">
          <div>
            <h2>MVP Timeline & Progress</h2>
            <p>SSVF TFA Tracker — Road to Launch</p>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            <X size={24} />
          </button>
        </div>

        <div className="timeline-modal-body">
          {/* Progress Summary */}
          <div className="progress-summary">
            <div className="progress-stats">
              <div className="stat-item">
                <span className="stat-value">{progress}%</span>
                <span className="stat-label">Complete</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{completedCount}/{milestones.length}</span>
                <span className="stat-label">Phases Done</span>
              </div>
              <div className="stat-item">
                <span className="stat-value highlight">{daysRemaining}</span>
                <span className="stat-label">Days to Target</span>
              </div>
            </div>
            <div className="progress-bar-container">
              <div className="progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <div className="target-date">
              <Rocket weight="fill" />
              <span>Target MVP Launch: <strong>{MVP_TARGET_DATE.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</strong></span>
            </div>
          </div>

          {/* Timeline */}
          <div className="timeline-container">
            {milestones.map((milestone, index) => (
              <div key={milestone.id} className={`timeline-item ${milestone.status}`}>
                <div className="timeline-connector">
                  <div className="connector-line top" />
                  <div className="connector-dot">
                    {getStatusIcon(milestone.status)}
                  </div>
                  <div className="connector-line bottom" style={{ opacity: index === milestones.length - 1 ? 0 : 1 }} />
                </div>

                <div className="timeline-content">
                  <div className="timeline-card">
                    <div className="card-header">
                      <div className="phase-badge">
                        {getPhaseIcon(milestone.phase)}
                        <span>{milestone.phase}</span>
                      </div>
                      <span className={`status-badge ${milestone.status}`}>
                        {milestone.status === 'completed' && 'Completed'}
                        {milestone.status === 'in-progress' && 'In Progress'}
                        {milestone.status === 'pending' && 'Pending'}
                      </span>
                    </div>

                    <h3>{milestone.title}</h3>
                    <p className="milestone-description">{milestone.description}</p>

                    {milestone.effort && (
                      <div className="effort-badge">
                        <Clock size={14} />
                        <span>Est. {milestone.effort}</span>
                      </div>
                    )}

                    <ul className="milestone-items">
                      {milestone.items.map((item, i) => (
                        <li key={i}>
                          {milestone.status === 'completed' ? (
                            <CheckCircle weight="fill" className="item-check completed" />
                          ) : (
                            <Circle weight="regular" className="item-check" />
                          )}
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Risk Callout */}
          <div className="risk-callout">
            <Warning weight="fill" />
            <div>
              <strong>Key Risk:</strong> Single-developer bus factor. This documentation and the test suite (71 tests) are deliberate mitigations.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
