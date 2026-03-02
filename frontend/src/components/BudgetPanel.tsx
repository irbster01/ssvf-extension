import { useState, useEffect, useCallback } from 'react';
import { fetchBudgetEstimates, BudgetSummary, BudgetLineItem } from '../api/submissions';

interface Props {
  getToken: () => Promise<string>;
}

type ViewMode = 'tfa' | 'all';
type RegionFilter = '' | 'Shreveport' | 'Monroe' | 'Arkansas';
type GroupBy = 'account' | 'region';

function formatCurrency(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  }
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function getStatusColor(percentUsed: number, hasBudget: boolean): string {
  if (!hasBudget) return 'budget-status-none';
  if (percentUsed >= 100) return 'budget-status-over';
  if (percentUsed >= 85) return 'budget-status-warning';
  if (percentUsed >= 60) return 'budget-status-caution';
  return 'budget-status-good';
}

function ProgressBar({ percent, hasBudget }: { percent: number; hasBudget: boolean }) {
  const clampedPercent = Math.min(percent, 100);
  const colorClass = getStatusColor(percent, hasBudget);

  return (
    <div className="budget-progress-track">
      <div
        className={`budget-progress-fill ${colorClass}`}
        style={{ width: `${clampedPercent}%` }}
      />
      {percent > 100 && (
        <div className="budget-progress-overflow" style={{ width: `${Math.min(percent - 100, 50)}%` }} />
      )}
    </div>
  );
}

function BudgetPanel({ getToken }: Props) {
  const [data, setData] = useState<BudgetSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('tfa');
  const [regionFilter, setRegionFilter] = useState<RegionFilter>('');
  const [groupBy, setGroupBy] = useState<GroupBy>('account');
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const result = await fetchBudgetEstimates(token, {
        tfaOnly: viewMode === 'tfa',
        region: regionFilter || undefined,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load budget data');
    } finally {
      setLoading(false);
    }
  }, [getToken, viewMode, regionFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleAccount = (acctNum: string) => {
    setExpandedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(acctNum)) next.delete(acctNum);
      else next.add(acctNum);
      return next;
    });
  };

  if (collapsed) {
    return (
      <div className="budget-panel budget-panel-collapsed" onClick={() => setCollapsed(false)}>
        <div className="budget-panel-header">
          <h3>Budget Tracker</h3>
          {data && (
            <span className="budget-quick-stat">
              {formatCurrency(data.totals.totalSpent)} / {formatCurrency(data.totals.totalBudget)}
              <span className={`budget-pct ${getStatusColor(data.totals.percentUsed, true)}`}>
                {data.totals.percentUsed}%
              </span>
            </span>
          )}
          <button className="budget-expand-btn" title="Expand">&#9660;</button>
        </div>
      </div>
    );
  }

  // Group line items
  const groupedItems = groupLineItems(data?.lineItems || [], groupBy);

  return (
    <div className="budget-panel">
      <div className="budget-panel-header">
        <h3>Budget Tracker</h3>
        {data && (
          <span className="budget-fy-label">{data.fiscalYear}</span>
        )}
        <div className="budget-controls">
          <select
            value={viewMode}
            onChange={e => setViewMode(e.target.value as ViewMode)}
            className="budget-select"
            title="Budget view mode"
          >
            <option value="tfa">TFA Categories</option>
            <option value="all">All Budget Lines</option>
          </select>
          <select
            value={regionFilter}
            onChange={e => setRegionFilter(e.target.value as RegionFilter)}
            className="budget-select"
            title="Region filter"
          >
            <option value="">All Regions</option>
            <option value="Shreveport">Shreveport</option>
            <option value="Monroe">Monroe</option>
            <option value="Arkansas">Arkansas</option>
          </select>
          <select
            value={groupBy}
            onChange={e => setGroupBy(e.target.value as GroupBy)}
            className="budget-select"
            title="Group by"
          >
            <option value="account">By Category</option>
            <option value="region">By Region</option>
          </select>
          <button onClick={loadData} className="budget-refresh-btn" disabled={loading} title="Refresh">
            &#8635;
          </button>
          <button onClick={() => setCollapsed(true)} className="budget-collapse-btn" title="Collapse">
            &#9650;
          </button>
        </div>
      </div>

      {error && <div className="budget-error">{error}</div>}

      {loading && !data && <div className="budget-loading">Loading budget data from NetSuite...</div>}

      {data && (
        <>
          {/* Summary cards */}
          <div className="budget-summary-row">
            <div className="budget-summary-card">
              <div className="budget-summary-label">Total Budget</div>
              <div className="budget-summary-value">{formatCurrency(data.totals.totalBudget)}</div>
            </div>
            <div className="budget-summary-card">
              <div className="budget-summary-label">Spent</div>
              <div className="budget-summary-value budget-spent">{formatCurrency(data.totals.totalSpent)}</div>
            </div>
            <div className="budget-summary-card">
              <div className="budget-summary-label">Remaining</div>
              <div className={`budget-summary-value ${data.totals.totalRemaining < 0 ? 'budget-over' : 'budget-under'}`}>
                {formatCurrency(data.totals.totalRemaining)}
              </div>
            </div>
            <div className="budget-summary-card">
              <div className="budget-summary-label">Used</div>
              <div className="budget-summary-value">
                <span className={getStatusColor(data.totals.percentUsed, true)}>
                  {data.totals.percentUsed}%
                </span>
              </div>
              <ProgressBar percent={data.totals.percentUsed} hasBudget={true} />
            </div>
          </div>

          {/* Region breakdown */}
          {Object.keys(data.byRegion).length > 1 && !regionFilter && (
            <div className="budget-region-row">
              {Object.entries(data.byRegion).map(([region, stats]) => (
                <div
                  key={region}
                  className="budget-region-chip"
                  onClick={() => setRegionFilter(region as RegionFilter)}
                >
                  <span className="budget-region-name">{region}</span>
                  <span className={`budget-region-pct ${getStatusColor(stats.percentUsed, true)}`}>
                    {stats.percentUsed}%
                  </span>
                  <span className="budget-region-amt">
                    {formatCurrency(stats.totalSpent)} / {formatCurrency(stats.totalBudget)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Line items table */}
          <div className="budget-table-wrap">
            <table className="budget-table">
              <thead>
                <tr>
                  <th className="budget-th-category">{groupBy === 'account' ? 'Category' : 'Region'}</th>
                  <th className="budget-th-num">Budget</th>
                  <th className="budget-th-num">Spent</th>
                  <th className="budget-th-num">Remaining</th>
                  <th className="budget-th-progress">Progress</th>
                  <th className="budget-th-num">Txns</th>
                </tr>
              </thead>
              <tbody>
                {groupedItems.map(group => (
                  <GroupRow
                    key={group.key}
                    group={group}
                    expanded={expandedAccounts.has(group.key)}
                    onToggle={() => toggleAccount(group.key)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="budget-footer">
            Data from NetSuite &middot; Updated {new Date(data.asOf).toLocaleTimeString()}
            {loading && ' &middot; Refreshing...'}
          </div>
        </>
      )}
    </div>
  );
}

// ============ GROUPING LOGIC ============

interface GroupedRow {
  key: string;
  label: string;
  budgetAnnual: number;
  actualSpent: number;
  remaining: number;
  percentUsed: number;
  transactionCount: number;
  hasBudget: boolean;
  children: BudgetLineItem[];
}

function groupLineItems(items: BudgetLineItem[], groupBy: GroupBy): GroupedRow[] {
  const groups = new Map<string, BudgetLineItem[]>();

  for (const item of items) {
    const key = groupBy === 'account' ? item.accountNumber : item.region;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const result: GroupedRow[] = [];
  for (const [key, children] of groups) {
    const budgetAnnual = children.reduce((s, c) => s + c.budgetAnnual, 0);
    const actualSpent = children.reduce((s, c) => s + c.actualSpent, 0);
    const transactionCount = children.reduce((s, c) => s + c.transactionCount, 0);
    const remaining = budgetAnnual - actualSpent;
    const hasBudget = budgetAnnual > 0;

    result.push({
      key,
      label: groupBy === 'account'
        ? children[0].accountName
        : key,
      budgetAnnual,
      actualSpent,
      remaining,
      percentUsed: hasBudget ? Math.round((actualSpent / budgetAnnual) * 100) : 0,
      transactionCount,
      hasBudget,
      children: children.length > 1 ? children : [],
    });
  }

  return result;
}

// ============ GROUP ROW COMPONENT ============

function GroupRow({ group, expanded, onToggle }: {
  group: GroupedRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasChildren = group.children.length > 0;

  return (
    <>
      <tr
        className={`budget-row ${hasChildren ? 'budget-row-expandable' : ''} ${expanded ? 'budget-row-expanded' : ''}`}
        onClick={hasChildren ? onToggle : undefined}
      >
        <td className="budget-td-category">
          {hasChildren && <span className="budget-expand-arrow">{expanded ? '▾' : '▸'}</span>}
          <span className="budget-acct-name">{group.label}</span>
          {!group.hasBudget && group.actualSpent > 0 && (
            <span className="budget-unbudgeted-tag">No Budget</span>
          )}
        </td>
        <td className="budget-td-num">{group.hasBudget ? formatCurrency(group.budgetAnnual) : '—'}</td>
        <td className="budget-td-num budget-spent">{formatCurrency(group.actualSpent)}</td>
        <td className={`budget-td-num ${group.remaining < 0 ? 'budget-over' : ''}`}>
          {group.hasBudget ? formatCurrency(group.remaining) : '—'}
        </td>
        <td className="budget-td-progress">
          <ProgressBar percent={group.percentUsed} hasBudget={group.hasBudget} />
          <span className={`budget-pct-label ${getStatusColor(group.percentUsed, group.hasBudget)}`}>
            {group.hasBudget ? `${group.percentUsed}%` : '—'}
          </span>
        </td>
        <td className="budget-td-num budget-txn-count">{group.transactionCount}</td>
      </tr>
      {expanded && group.children.map(child => (
        <tr key={`${child.accountNumber}-${child.department}`} className="budget-row budget-child-row">
          <td className="budget-td-category budget-td-child">
            <span className="budget-child-indent">{child.region}</span>
          </td>
          <td className="budget-td-num">{child.budgetAnnual > 0 ? formatCurrency(child.budgetAnnual) : '—'}</td>
          <td className="budget-td-num budget-spent">{formatCurrency(child.actualSpent)}</td>
          <td className={`budget-td-num ${child.remaining < 0 ? 'budget-over' : ''}`}>
            {child.budgetAnnual > 0 ? formatCurrency(child.remaining) : '—'}
          </td>
          <td className="budget-td-progress">
            <ProgressBar percent={child.percentUsed} hasBudget={child.budgetAnnual > 0} />
            <span className={`budget-pct-label ${getStatusColor(child.percentUsed, child.budgetAnnual > 0)}`}>
              {child.budgetAnnual > 0 ? `${child.percentUsed}%` : '—'}
            </span>
          </td>
          <td className="budget-td-num budget-txn-count">{child.transactionCount}</td>
        </tr>
      ))}
    </>
  );
}

export default BudgetPanel;
