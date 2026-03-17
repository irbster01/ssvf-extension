import { useState, useRef, useEffect, useCallback } from 'react';
import { Submission, SubmissionStatus } from '../types';

/* ─── Status descriptions (always shown) ─── */
const STATUS_DESCRIPTIONS: Record<SubmissionStatus, string> = {
  New: 'Awaiting review by accounting.',
  Corrections: 'Returned by accounting — submitter must fix and resubmit.',
  'In Review': 'Currently being reviewed by accounting.',
  Submitted: 'Approved and submitted to NetSuite for processing.',
};

/* ─── Build rich, contextual tooltip lines ─── */
function buildTooltipLines(submission: Submission): string[] {
  const status = submission.status || 'New';
  const lines: string[] = [STATUS_DESCRIPTIONS[status]];

  const fmtDate = (iso?: string) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  const fmtName = (email?: string) => {
    if (!email) return null;
    // Show name portion of email (before @), title-cased
    const name = email.split('@')[0].replace(/[._]/g, ' ');
    return name.replace(/\b\w/g, c => c.toUpperCase());
  };

  switch (status) {
    case 'New': {
      const date = fmtDate(submission.captured_at_utc);
      if (date) lines.push(`Captured ${date}.`);
      break;
    }
    case 'Corrections': {
      const who = fmtName(submission.updated_by);
      const when = fmtDate(submission.updated_at);
      if (who && when) lines.push(`Returned by ${who} on ${when}.`);
      else if (who) lines.push(`Returned by ${who}.`);
      else if (when) lines.push(`Returned on ${when}.`);
      if (submission.notes) lines.push(`Note: "${submission.notes}"`);
      break;
    }
    case 'In Review': {
      const who = fmtName(submission.updated_by);
      const when = fmtDate(submission.updated_at);
      if (who && when) lines.push(`Moved to review by ${who} on ${when}.`);
      else if (when) lines.push(`In review since ${when}.`);
      break;
    }
    case 'Submitted': {
      const who = fmtName(submission.updated_by);
      const when = fmtDate(submission.updated_at);
      if (who && when) lines.push(`Submitted by ${who} on ${when}.`);
      else if (when) lines.push(`Submitted on ${when}.`);
      if (submission.po_number) lines.push(`PO # ${submission.po_number}`);
      if (submission.entered_in_system) {
        const docBy = fmtName(submission.entered_in_system_by);
        const docAt = fmtDate(submission.entered_in_system_at);
        const parts = ['Documented'];
        if (docBy) parts.push(`by ${docBy}`);
        if (docAt) parts.push(`on ${docAt}`);
        lines.push(parts.join(' ') + '.');
      }
      break;
    }
  }

  return lines;
}

/* ─── StatusTooltip wrapper component ─── */
interface StatusTooltipProps {
  submission: Submission;
  children: React.ReactNode;
}

function StatusTooltip({ submission, children }: StatusTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<'bottom' | 'top'>('bottom');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const status = (submission.status || 'New') as SubmissionStatus;
  const lines = buildTooltipLines(submission);

  const show = useCallback(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(true), 250);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(false), 150);
  }, []);

  /* Flip to top if tooltip would overflow viewport bottom */
  useEffect(() => {
    if (visible && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setPosition(spaceBelow < 120 ? 'top' : 'bottom');
    }
  }, [visible]);

  /* Cleanup timer on unmount */
  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const statusKey = status.toLowerCase().replace(' ', '-');

  return (
    <div
      ref={wrapperRef}
      className="status-tooltip-wrapper"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={-1} /* allow focus for keyboard accessibility */
    >
      {children}
      {visible && (
        <div
          ref={tooltipRef}
          className={`status-tooltip status-tooltip-${statusKey} status-tooltip-${position}`}
          role="tooltip"
          aria-live="polite"
        >
          <div className="status-tooltip-header">{status}</div>
          {lines.map((line, i) => (
            <div key={i} className="status-tooltip-line">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default StatusTooltip;
