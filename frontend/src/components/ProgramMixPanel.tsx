import { useState, useMemo } from 'react';
import { CaretRight, CheckCircle, Clock } from 'phosphor-react';
import { Submission } from '../types';

interface ProgramMixPanelProps {
  submissions: Submission[];
}

interface MixBucket {
  rrh: number;
  hp: number;
  total: number;
  rrhPct: number;
  hpPct: number;
  rrhAmount: number;
  hpAmount: number;
  totalAmount: number;
}

interface RegionData {
  region: string;
  inNetSuite: MixBucket;
  pending: MixBucket;
  combined: MixBucket;
}

const TARGET_RRH = 60;
const TARGET_HP = 40;

function buildBucket(rrh: number, hp: number, rrhAmt: number, hpAmt: number): MixBucket {
  const total = rrh + hp;
  const totalAmount = rrhAmt + hpAmt;
  return {
    rrh, hp, total,
    // Percentages based on dollar amounts (contractual 60/40 is by spend)
    rrhPct: totalAmount > 0 ? (rrhAmt / totalAmount) * 100 : 0,
    hpPct: totalAmount > 0 ? (hpAmt / totalAmount) * 100 : 0,
    rrhAmount: rrhAmt,
    hpAmount: hpAmt,
    totalAmount,
  };
}

export default function ProgramMixPanel({ submissions }: ProgramMixPanelProps) {
  const [collapsed, setCollapsed] = useState(true);

  const data = useMemo(() => {
    const fyStart = new Date('2025-07-01');
    const fyEnd = new Date('2026-06-30T23:59:59');
    const countedStatuses = new Set(['New', 'In Review', 'Submitted', 'Corrections']);

    const relevant = submissions.filter(s => {
      if (!s.program_category || !s.region) return false;
      if (!countedStatuses.has(s.status || 'New')) return false;
      const d = new Date(s.tfa_date || s.captured_at_utc);
      return d >= fyStart && d <= fyEnd;
    });

    // Accumulator per region, split by NetSuite status
    const byRegion = new Map<string, {
      ns:   { rrh: number; hp: number; rrhAmt: number; hpAmt: number };
      pend: { rrh: number; hp: number; rrhAmt: number; hpAmt: number };
    }>();

    for (const s of relevant) {
      const region = s.region!;
      if (!byRegion.has(region)) {
        byRegion.set(region, {
          ns:   { rrh: 0, hp: 0, rrhAmt: 0, hpAmt: 0 },
          pend: { rrh: 0, hp: 0, rrhAmt: 0, hpAmt: 0 },
        });
      }
      const entry = byRegion.get(region)!;
      const bucket = s.po_number ? entry.ns : entry.pend;
      const amount = s.service_amount || 0;
      if (s.program_category === 'Rapid Rehousing') {
        bucket.rrh++;
        bucket.rrhAmt += amount;
      } else {
        bucket.hp++;
        bucket.hpAmt += amount;
      }
    }

    const regions: RegionData[] = [];
    for (const [region, d] of byRegion.entries()) {
      regions.push({
        region,
        inNetSuite: buildBucket(d.ns.rrh, d.ns.hp, d.ns.rrhAmt, d.ns.hpAmt),
        pending:    buildBucket(d.pend.rrh, d.pend.hp, d.pend.rrhAmt, d.pend.hpAmt),
        combined:   buildBucket(d.ns.rrh + d.pend.rrh, d.ns.hp + d.pend.hp, d.ns.rrhAmt + d.pend.rrhAmt, d.ns.hpAmt + d.pend.hpAmt),
      });
    }

    const order: Record<string, number> = { Shreveport: 0, Arkansas: 1, Monroe: 2 };
    regions.sort((a, b) => (order[a.region] ?? 99) - (order[b.region] ?? 99));

    const sumBuckets = (getBucket: (r: RegionData) => MixBucket) => {
      const allRRH = regions.reduce((s, r) => s + getBucket(r).rrh, 0);
      const allHP = regions.reduce((s, r) => s + getBucket(r).hp, 0);
      const allRRHAmt = regions.reduce((s, r) => s + getBucket(r).rrhAmount, 0);
      const allHPAmt = regions.reduce((s, r) => s + getBucket(r).hpAmount, 0);
      return buildBucket(allRRH, allHP, allRRHAmt, allHPAmt);
    };

    return {
      regions,
      totals: {
        inNetSuite: sumBuckets(r => r.inNetSuite),
        pending:    sumBuckets(r => r.pending),
        combined:   sumBuckets(r => r.combined),
      },
    };
  }, [submissions]);

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const statusColor = (pct: number, target: number) => {
    const diff = Math.abs(pct - target);
    if (diff <= 5) return 'mix-status-good';
    if (diff <= 10) return 'mix-status-warning';
    return 'mix-status-danger';
  };

  const statusLabel = (pct: number, target: number) => {
    const diff = pct - target;
    if (Math.abs(diff) <= 2) return 'On Target';
    if (diff > 0) return `+${diff.toFixed(1)}% over`;
    return `${Math.abs(diff).toFixed(1)}% under`;
  };

  const renderBar = (bucket: MixBucket, height: number, showLabels: boolean) => (
    <div className="mix-bar-container">
      <div className="mix-bar" style={{ height }}>
        <div className="mix-bar-rrh" style={{ width: `${bucket.rrhPct}%` }}>
          {showLabels && bucket.rrhPct >= 15 && <span className="mix-bar-text">{fmt(bucket.rrhAmount)}</span>}
        </div>
        <div className="mix-bar-hp" style={{ width: `${bucket.hpPct}%` }}>
          {showLabels && bucket.hpPct >= 15 && <span className="mix-bar-text">{fmt(bucket.hpAmount)}</span>}
        </div>
      </div>
      <div className="mix-target-line" style={{ left: '60%' }}>
        <span className="mix-target-label">60%</span>
      </div>
    </div>
  );

  return (
    <div className="mix-panel" role="region" aria-label="Program Mix Tracker">
      <button
        className="mix-header"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <div className="mix-header-left">
          <CaretRight className={`mix-chevron${collapsed ? '' : ' mix-chevron-open'}`} size={14} weight="bold" />
          <h3 className="mix-title">Program Mix — RRH / HP Ratio</h3>
        </div>
        <div className="mix-header-right">
          <span className="mix-header-subtitle">Target: 60% RRH / 40% HP</span>
          {data.totals.combined.total > 0 && (
            <span className={`mix-header-badge ${statusColor(data.totals.combined.rrhPct, TARGET_RRH)}`}>
              {data.totals.combined.rrhPct.toFixed(0)}% / {data.totals.combined.hpPct.toFixed(0)}%
            </span>
          )}
        </div>
      </button>

      {!collapsed && (
        <div className="mix-body">
          {data.totals.combined.total === 0 ? (
            <p className="mix-empty">No TFA submissions with program type data found for FY26.</p>
          ) : (
            <>
              {/* Overall combined bar */}
              <div className="mix-summary">
                <div className="mix-summary-title">Combined (All TFAs)</div>
                <div className="mix-summary-labels">
                  <span className="mix-label-rrh">
                    RRH: {fmt(data.totals.combined.rrhAmount)} ({data.totals.combined.rrhPct.toFixed(1)}%) — {data.totals.combined.rrh} TFAs
                  </span>
                  <span className="mix-label-hp">
                    HP: {fmt(data.totals.combined.hpAmount)} ({data.totals.combined.hpPct.toFixed(1)}%) — {data.totals.combined.hp} TFAs
                  </span>
                </div>
                {renderBar(data.totals.combined, 28, true)}
                <div className="mix-bar-legend">
                  <span>0%</span>
                  <span>Total: {fmt(data.totals.combined.totalAmount)} — {data.totals.combined.total} TFAs</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Per-region breakdown */}
              <div className="mix-regions">
                {data.regions.map(r => (
                  <div key={r.region} className="mix-region-card">
                    <div className="mix-region-header">
                      <span className="mix-region-name">{r.region}</span>
                      <div className="mix-region-statuses">
                        <span className={`mix-region-status ${statusColor(r.combined.rrhPct, TARGET_RRH)}`}>
                          RRH {r.combined.rrhPct.toFixed(1)}% — {statusLabel(r.combined.rrhPct, TARGET_RRH)}
                        </span>
                        <span className={`mix-region-status ${statusColor(r.combined.hpPct, TARGET_HP)}`}>
                          HP {r.combined.hpPct.toFixed(1)}% — {statusLabel(r.combined.hpPct, TARGET_HP)}
                        </span>
                      </div>
                    </div>
                    {renderBar(r.combined, 22, true)}
                    <div className="mix-region-details">
                      <span>Total: {r.combined.total} ({fmt(r.combined.totalAmount)})</span>
                    </div>
                    {/* Sub-breakdown: NetSuite vs Pending */}
                    <div className="mix-region-split">
                      {r.inNetSuite.total > 0 && (
                        <div className="mix-region-sub">
                          <span className="mix-sub-label">
                            <CheckCircle className="mix-segment-icon" size={14} weight="fill" /> NetSuite: {r.inNetSuite.total}
                            <span className="mix-sub-ratio">({r.inNetSuite.rrhPct.toFixed(0)}% / {r.inNetSuite.hpPct.toFixed(0)}%)</span>
                          </span>
                          <span className="mix-sub-amounts">{fmt(r.inNetSuite.totalAmount)}</span>
                        </div>
                      )}
                      {r.pending.total > 0 && (
                        <div className="mix-region-sub">
                          <span className="mix-sub-label">
                            <Clock className="mix-segment-icon" size={14} /> Pending: {r.pending.total}
                            <span className="mix-sub-ratio">({r.pending.rrhPct.toFixed(0)}% / {r.pending.hpPct.toFixed(0)}%)</span>
                          </span>
                          <span className="mix-sub-amounts">{fmt(r.pending.totalAmount)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
