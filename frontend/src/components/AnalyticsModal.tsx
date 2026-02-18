import { useMemo } from 'react';
import { ChartPie, MapPin, Users, Wallet, TrendUp, X } from 'phosphor-react';
import { Submission } from '../types';
import './AnalyticsModal.css';

interface AnalyticsModalProps {
  submissions: Submission[];
  onClose: () => void;
}

interface StatCard {
  label: string;
  value: string;
  subtitle?: string;
  icon: JSX.Element;
  color: string;
}

export default function AnalyticsModal({ submissions, onClose }: AnalyticsModalProps) {
  const analytics = useMemo(() => {
    // Filter out submissions without amounts
    const validSubmissions = submissions.filter(s => s.service_amount !== undefined && s.service_amount !== null);

    // Total spending
    const totalSpending = validSubmissions.reduce((sum, s) => sum + (s.service_amount || 0), 0);
    
    // Program category breakdown
    const programCategories: Record<string, { count: number; amount: number }> = {};
    validSubmissions.forEach(s => {
      const category = s.program_category || 'Unknown';
      if (!programCategories[category]) {
        programCategories[category] = { count: 0, amount: 0 };
      }
      programCategories[category].count++;
      programCategories[category].amount += s.service_amount || 0;
    });

    // Regional breakdown
    const regions: Record<string, { count: number; amount: number }> = {};
    validSubmissions.forEach(s => {
      const region = s.region || 'Unknown';
      if (!regions[region]) {
        regions[region] = { count: 0, amount: 0 };
      }
      regions[region].count++;
      regions[region].amount += s.service_amount || 0;
    });

    // Assistance type breakdown
    const assistanceTypes: Record<string, { count: number; amount: number }> = {};
    validSubmissions.forEach(s => {
      const assistanceType = (s.form_data?.assistance_type as string) || 'Unknown';
      if (!assistanceTypes[assistanceType]) {
        assistanceTypes[assistanceType] = { count: 0, amount: 0 };
      }
      assistanceTypes[assistanceType].count++;
      assistanceTypes[assistanceType].amount += s.service_amount || 0;
    });

    // Top vendors
    const vendors: Record<string, { count: number; amount: number }> = {};
    validSubmissions.forEach(s => {
      const vendor = s.vendor || 'Unknown';
      if (!vendors[vendor]) {
        vendors[vendor] = { count: 0, amount: 0 };
      }
      vendors[vendor].count++;
      vendors[vendor].amount += s.service_amount || 0;
    });

    const topVendors = Object.entries(vendors)
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 5);

    // Average transaction
    const avgTransaction = validSubmissions.length > 0 ? totalSpending / validSubmissions.length : 0;

    return {
      totalSpending,
      totalCount: validSubmissions.length,
      avgTransaction,
      programCategories,
      regions,
      assistanceTypes,
      topVendors,
    };
  }, [submissions]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatPercent = (value: number, total: number) => {
    if (total === 0) return '0%';
    return `${((value / total) * 100).toFixed(1)}%`;
  };

  const statCards: StatCard[] = [
    {
      label: 'Total Spending',
      value: formatCurrency(analytics.totalSpending),
      subtitle: `${analytics.totalCount} submissions`,
      icon: <Wallet size={24} weight="duotone" />,
      color: '#667eea',
    },
    {
      label: 'Average Transaction',
      value: formatCurrency(analytics.avgTransaction),
      icon: <TrendUp size={24} weight="duotone" />,
      color: '#10b981',
    },
    {
      label: 'Programs',
      value: Object.keys(analytics.programCategories).length.toString(),
      subtitle: 'categories tracked',
      icon: <ChartPie size={24} weight="duotone" />,
      color: '#f59e0b',
    },
    {
      label: 'Regions',
      value: Object.keys(analytics.regions).length.toString(),
      subtitle: 'locations served',
      icon: <MapPin size={24} weight="duotone" />,
      color: '#ef4444',
    },
  ];

  return (
    <div className="analytics-modal-overlay" onClick={onClose}>
      <div className="analytics-modal" onClick={(e) => e.stopPropagation()}>
        <div className="analytics-modal-header">
          <div>
            <h2>Analytics Dashboard</h2>
            <p>Comprehensive breakdown of TFA submissions</p>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close analytics">
            <X size={24} weight="bold" />
          </button>
        </div>

        <div className="analytics-modal-body">
          {/* Summary Cards */}
          <div className="stat-cards-grid">
            {statCards.map((card, idx) => (
              <div key={idx} className="stat-card" style={{ '--card-color': card.color } as React.CSSProperties}>
                <div className="stat-card-icon" style={{ color: card.color }}>
                  {card.icon}
                </div>
                <div className="stat-card-content">
                  <div className="stat-card-label">{card.label}</div>
                  <div className="stat-card-value">{card.value}</div>
                  {card.subtitle && <div className="stat-card-subtitle">{card.subtitle}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Charts Grid */}
          <div className="charts-grid">
            {/* Program Categories */}
            <div className="chart-card">
              <div className="chart-card-header">
                <Users size={20} weight="duotone" />
                <h3>Program Categories</h3>
              </div>
              <div className="chart-content">
                {Object.entries(analytics.programCategories)
                  .sort((a, b) => b[1].amount - a[1].amount)
                  .map(([category, data]) => (
                    <div key={category} className="chart-item">
                      <div className="chart-item-header">
                        <span className="chart-item-label">{category}</span>
                        <span className="chart-item-value">{formatCurrency(data.amount)}</span>
                      </div>
                      <div className="progress-bar">
                        <div
                          className="progress-bar-fill"
                          style={{
                            width: formatPercent(data.amount, analytics.totalSpending),
                            backgroundColor: category === 'Rapid Rehousing' ? '#3b82f6' : '#10b981',
                          }}
                        />
                      </div>
                      <div className="chart-item-meta">
                        <span>{data.count} submissions</span>
                        <span>{formatPercent(data.amount, analytics.totalSpending)}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Regional Breakdown */}
            <div className="chart-card">
              <div className="chart-card-header">
                <MapPin size={20} weight="duotone" />
                <h3>Regional Distribution</h3>
              </div>
              <div className="chart-content">
                {Object.entries(analytics.regions)
                  .sort((a, b) => b[1].amount - a[1].amount)
                  .map(([region, data]) => (
                    <div key={region} className="chart-item">
                      <div className="chart-item-header">
                        <span className="chart-item-label">{region}</span>
                        <span className="chart-item-value">{formatCurrency(data.amount)}</span>
                      </div>
                      <div className="progress-bar">
                        <div
                          className="progress-bar-fill"
                          style={{
                            width: formatPercent(data.amount, analytics.totalSpending),
                            backgroundColor: '#f59e0b',
                          }}
                        />
                      </div>
                      <div className="chart-item-meta">
                        <span>{data.count} submissions</span>
                        <span>{formatPercent(data.amount, analytics.totalSpending)}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Assistance Types */}
            <div className="chart-card">
              <div className="chart-card-header">
                <ChartPie size={20} weight="duotone" />
                <h3>Assistance Types</h3>
              </div>
              <div className="chart-content scrollable">
                {Object.entries(analytics.assistanceTypes)
                  .sort((a, b) => b[1].amount - a[1].amount)
                  .map(([type, data]) => (
                    <div key={type} className="chart-item compact">
                      <div className="chart-item-header">
                        <span className="chart-item-label">{type}</span>
                        <span className="chart-item-value">{formatCurrency(data.amount)}</span>
                      </div>
                      <div className="progress-bar">
                        <div
                          className="progress-bar-fill"
                          style={{
                            width: formatPercent(data.amount, analytics.totalSpending),
                            backgroundColor: '#667eea',
                          }}
                        />
                      </div>
                      <div className="chart-item-meta">
                        <span>{data.count} submissions</span>
                        <span>{formatPercent(data.amount, analytics.totalSpending)}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Top Vendors */}
            <div className="chart-card">
              <div className="chart-card-header">
                <Wallet size={20} weight="duotone" />
                <h3>Top Vendors</h3>
              </div>
              <div className="chart-content">
                {analytics.topVendors.map(([vendor, data], idx) => (
                  <div key={vendor} className="chart-item">
                    <div className="chart-item-header">
                      <span className="chart-item-label">
                        <span className="rank">#{idx + 1}</span> {vendor}
                      </span>
                      <span className="chart-item-value">{formatCurrency(data.amount)}</span>
                    </div>
                    <div className="progress-bar">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: formatPercent(data.amount, analytics.totalSpending),
                          backgroundColor: '#ef4444',
                        }}
                      />
                    </div>
                    <div className="chart-item-meta">
                      <span>{data.count} transactions</span>
                      <span>{formatPercent(data.amount, analytics.totalSpending)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
