import { useState, useRef, useEffect } from 'react';
import { Submission } from '../types';
import { NetSuiteVendor } from '../api/submissions';

interface PurchaseOrderModalProps {
  submission: Submission;
  vendors: NetSuiteVendor[];
  vendorsLoading: boolean;
  onClose: () => void;
  onSubmitPO: (poData: PurchaseOrderData) => void;
}

export interface PurchaseOrderData {
  submissionId: string;
  vendorId: string;
  vendorName: string;
  vendorAccount: string;
  clientId: string;
  clientName: string;
  region: string;
  programCategory: string;
  amount: number;
  memo: string;
  clientTypeId?: string;
  financialAssistanceTypeId?: string;
  assistanceMonthId?: string;
  lineItems: POLineItem[];
}

export interface POLineItem {
  itemId: string;
  departmentId: string;
  classId: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

// NetSuite departments relevant to SSVF
const NETSUITE_DEPARTMENTS = [
  { id: '7', name: '3031 SSVF' },
  { id: '617', name: '3035 SSVF - ARKANSAS' },
  { id: '618', name: '3036 SSVF - MONROE' },
] as const;

// NetSuite "Sites" (classification) values
const NETSUITE_SITES = [
  { id: '1', name: '000 N/A' },
  { id: '18', name: '081 Bossier' },
  { id: '19', name: '083 Travis' },
  { id: '8', name: '011 Broadmoor' },
  { id: '7', name: '009 Creswell' },
  { id: '5', name: '007 Fair Park' },
  { id: '17', name: '021 Midway' },
  { id: '6', name: '008 Oak Park' },
  { id: '16', name: '019 Queensborough' },
  { id: '15', name: '018 Sunset Acres' },
  { id: '9', name: '012 Westwood' },
  { id: '10', name: '013 Woodlawn' },
] as const;

// NetSuite "Client:" items available for TFA PO line items
const NETSUITE_ITEMS = [
  { id: '226', name: 'Client:  Cash Subsidy' },
  { id: '227', name: 'Client:  Incentives' },
  { id: '228', name: 'Client:  Moving' },
  { id: '267', name: 'Client:  Room & Board' },
  { id: '231', name: 'Client: Clothing & Personal Needs' },
  { id: '640', name: 'Client: Linen & Bedding' },
  { id: '229', name: 'Client: Transportation' },
  { id: '230', name: 'Client: Utilities' },
] as const;

// Auto-map assistance type keywords to NetSuite item IDs
function guessItemId(assistanceType: string): string {
  const lower = (assistanceType || '').toLowerCase();
  if (lower.includes('rent') || lower.includes('housing')) return '267'; // Room & Board
  if (lower.includes('util')) return '230'; // Utilities
  if (lower.includes('moving') || lower.includes('relocation')) return '228'; // Moving
  if (lower.includes('transport')) return '229'; // Transportation
  if (lower.includes('cloth') || lower.includes('personal')) return '231'; // Clothing & Personal
  if (lower.includes('linen') || lower.includes('bedding')) return '640'; // Linen & Bedding
  if (lower.includes('incentive')) return '227'; // Incentives
  return '226'; // Default: Cash Subsidy
}

// NetSuite Client Type list (custbody8)
const CLIENT_TYPES = [
  { id: '1', name: 'Rapid Rehousing' },
  { id: '2', name: 'Homeless Prevention' },
] as const;

// NetSuite Financial Assistance Type list (custbody11)
const FINANCIAL_ASSISTANCE_TYPES = [
  { id: '1', name: 'Rental Assistance' },
  { id: '5', name: 'Moving Cost Assistance' },
  { id: '4', name: 'Utility Deposit' },
  { id: '3', name: 'Security Deposit' },
  { id: '9', name: 'Other as approved by VA' },
  { id: '2', name: 'Utility Assistance' },
  { id: '10', name: 'Motel/Hotel Voucher' },
  { id: '6', name: 'Purchase of emergency supplies' },
  { id: '7', name: 'Transportation' },
  { id: '8', name: 'Child Care' },
] as const;

// Auto-map program_category to Client Type ID
function guessClientTypeId(programCategory: string): string {
  const lower = (programCategory || '').toLowerCase();
  if (lower.includes('rapid')) return '1';
  if (lower.includes('prevention')) return '2';
  return '';
}

// Auto-map assistance type text to Financial Assistance Type ID
function guessFinancialAssistanceTypeId(assistanceType: string): string {
  const lower = (assistanceType || '').toLowerCase();
  if (lower.includes('rental') || lower === 'rent') return '1';
  if (lower.includes('moving')) return '5';
  if (lower.includes('utility deposit')) return '4';
  if (lower.includes('security deposit') || lower.includes('security')) return '3';
  if (lower.includes('utility') && !lower.includes('deposit')) return '2';
  if (lower.includes('motel') || lower.includes('hotel') || lower.includes('voucher')) return '10';
  if (lower.includes('emergency') || lower.includes('supplies')) return '6';
  if (lower.includes('transport')) return '7';
  if (lower.includes('child') || lower.includes('care')) return '8';
  if (lower.includes('other') || lower.includes('va')) return '9';
  return '';
}

// Get the month ID (1-12) from a date string
function getAssistanceMonthId(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return String(d.getMonth() + 1); // 1=January … 12=December
}

function PurchaseOrderModal({ submission, vendors, vendorsLoading, onClose, onSubmitPO }: PurchaseOrderModalProps) {
  const [memo, setMemo] = useState(submission.notes || '');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string; payload?: any; response?: any } | null>(null);
  const [showPayload, setShowPayload] = useState(false);

  // Vendor autocomplete state
  const [vendorSearch, setVendorSearch] = useState(submission.vendor || '');
  const [selectedVendor, setSelectedVendor] = useState<NetSuiteVendor | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-inherit vendor from submission when vendors list loads
  useEffect(() => {
    if (vendors.length > 0 && !selectedVendor) {
      // Try matching by vendor_id first (most reliable)
      if (submission.vendor_id) {
        const match = vendors.find(v => v.id === submission.vendor_id);
        if (match) {
          setSelectedVendor(match);
          setVendorSearch(match.companyName);
          return;
        }
      }
      // Fallback: match by vendor name
      if (submission.vendor) {
        const match = vendors.find(v =>
          v.companyName.toLowerCase() === submission.vendor!.toLowerCase()
        );
        if (match) {
          setSelectedVendor(match);
          setVendorSearch(match.companyName);
        }
      }
    }
  }, [vendors, submission.vendor_id, submission.vendor]);

  // Filter vendors based on search text
  const filteredVendors = vendorSearch.length >= 1
    ? vendors.filter(v =>
        v.companyName.toLowerCase().includes(vendorSearch.toLowerCase()) ||
        v.entityId.toLowerCase().includes(vendorSearch.toLowerCase())
      ).slice(0, 50) // Limit visible results for performance
    : [];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleVendorSelect = (vendor: NetSuiteVendor) => {
    setSelectedVendor(vendor);
    setVendorSearch(vendor.companyName);
    setShowDropdown(false);
    setHighlightIndex(-1);
  };

  const handleVendorKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || filteredVendors.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => Math.min(prev + 1, filteredVendors.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      handleVendorSelect(filteredVendors[highlightIndex]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  // Auto-select department based on region
  function guessDepartmentId(region: string): string {
    const r = region.toLowerCase();
    if (r === 'arkansas') return '617';  // 3035 SSVF - ARKANSAS
    if (r === 'monroe') return '618';    // 3036 SSVF - MONROE
    return '7';                          // 3031 SSVF (Shreveport / default)
  }

  const assistanceType = submission.form_data?.assistance_type as string || submission.service_type || 'TFA Service';
  const [selectedItemId, setSelectedItemId] = useState(() => guessItemId(assistanceType));
  const [selectedDeptId, setSelectedDeptId] = useState(() => guessDepartmentId(submission.region || ''));
  const [selectedSiteId, setSelectedSiteId] = useState('1'); // Default: 000 N/A
  const [selectedClientTypeId, setSelectedClientTypeId] = useState(() => guessClientTypeId(submission.program_category || ''));
  const [selectedFATypeId, setSelectedFATypeId] = useState(() => guessFinancialAssistanceTypeId(assistanceType));
  const [selectedMonthId, setSelectedMonthId] = useState(() => getAssistanceMonthId(submission.captured_at_utc));

  const lineItems: POLineItem[] = [
    {
      itemId: selectedItemId,
      departmentId: selectedDeptId,
      classId: selectedSiteId,
      description: assistanceType,
      quantity: 1,
      rate: submission.service_amount || 0,
      amount: submission.service_amount || 0,
    },
  ];

  const handleSubmit = async () => {
    if (!selectedVendor) {
      setResult({ type: 'error', text: 'Please select a vendor from the list.' });
      return;
    }
    setSending(true);
    setResult(null);
    setShowPayload(false);
    try {
      const poData: PurchaseOrderData = {
        submissionId: submission.id,
        vendorId: selectedVendor.id,
        vendorName: selectedVendor.companyName,
        vendorAccount: submission.vendor_account || '',
        clientId: submission.client_id || '',
        clientName: submission.client_name || '',
        region: submission.region || '',
        programCategory: submission.program_category || '',
        amount: submission.service_amount || 0,
        memo,
        clientTypeId: selectedClientTypeId || undefined,
        financialAssistanceTypeId: selectedFATypeId || undefined,
        assistanceMonthId: selectedMonthId || undefined,
        lineItems,
      };
      // Fire and forget — Dashboard handles the async work, toasts, and closing
      onSubmitPO(poData);
    } catch (err) {
      setResult({ type: 'error', text: err instanceof Error ? err.message : 'Failed to build PO data' });
      setSending(false);
    }
  };

  const formatAmount = (val?: number) =>
    val !== undefined && val !== null ? `$${val.toFixed(2)}` : '$0.00';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal po-modal" onClick={e => e.stopPropagation()}>
        <div className="po-header">
          <h2 style={{ margin: 0 }}>Create Purchase Order</h2>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: '0.9rem' }}>
            This will send a PO to NetSuite for processing
          </p>
        </div>

        {result && (
          <div className={`po-result-panel ${result.type}`}>
            <div className="po-result-header">
              <span className={`po-result-icon ${result.type}`}>{result.type === 'success' ? '✓' : '✗'}</span>
              <span className="po-result-text">{result.text}</span>
            </div>
            {result.payload && (
              <div className="po-result-details">
                <button
                  type="button"
                  className="po-payload-toggle"
                  onClick={() => setShowPayload(!showPayload)}
                >
                  {showPayload ? '▾ Hide' : '▸ Show'} PO Payload
                </button>
                {showPayload && (
                  <pre className="po-payload-json">{JSON.stringify(result.payload, null, 2)}</pre>
                )}
              </div>
            )}
            {result.response && (
              <div className="po-result-details">
                <strong>NetSuite Response:</strong>
                <pre className="po-payload-json">{JSON.stringify(result.response, null, 2)}</pre>
              </div>
            )}
          </div>
        )}

        {/* Vendor Autocomplete */}
        <div className="po-section">
          <h3 className="po-section-title">Vendor</h3>
          <div className="vendor-autocomplete" ref={dropdownRef}>
            <input
              ref={inputRef}
              type="text"
              className="vendor-search-input"
              value={vendorSearch}
              onChange={e => {
                setVendorSearch(e.target.value);
                setSelectedVendor(null);
                setShowDropdown(true);
                setHighlightIndex(-1);
              }}
              onFocus={() => vendorSearch.length >= 1 && setShowDropdown(true)}
              onKeyDown={handleVendorKeyDown}
              placeholder={vendorsLoading ? 'Loading vendors...' : 'Type to search vendors...'}
              disabled={vendorsLoading}
              autoComplete="off"
            />
            {selectedVendor && (
              <div className="vendor-selected-badge">
                <span>ID: {selectedVendor.id}</span>
                <button
                  type="button"
                  onClick={() => { setSelectedVendor(null); setVendorSearch(''); inputRef.current?.focus(); }}
                  aria-label="Clear vendor selection"
                >×</button>
              </div>
            )}
            {showDropdown && !selectedVendor && filteredVendors.length > 0 && (
              <div className="vendor-dropdown">
                {filteredVendors.map((v, idx) => (
                  <div
                    key={v.id}
                    className={`vendor-dropdown-item${idx === highlightIndex ? ' highlighted' : ''}`}
                    onClick={() => handleVendorSelect(v)}
                    onMouseEnter={() => setHighlightIndex(idx)}
                  >
                    <span className="vendor-dropdown-name">{v.companyName}</span>
                    <span className="vendor-dropdown-id">#{v.entityId}</span>
                  </div>
                ))}
                {filteredVendors.length === 50 && (
                  <div className="vendor-dropdown-more">Type more to narrow results...</div>
                )}
              </div>
            )}
            {showDropdown && !selectedVendor && vendorSearch.length >= 1 && filteredVendors.length === 0 && !vendorsLoading && (
              <div className="vendor-dropdown">
                <div className="vendor-dropdown-empty">No vendors match "{vendorSearch}"</div>
              </div>
            )}
          </div>
        </div>

        <div className="po-section">
          <h3 className="po-section-title">Client</h3>
          <div className="po-info-grid">
            <div className="po-info-item">
              <span className="po-info-label">Name</span>
              <span className="po-info-value">{submission.client_name || '—'}</span>
            </div>
            <div className="po-info-item">
              <span className="po-info-label">Client ID</span>
              <span className="po-info-value">{submission.client_id || '—'}</span>
            </div>
          </div>
        </div>

        <div className="po-section">
          <h3 className="po-section-title">Program</h3>
          <div className="po-info-grid">
            <div className="po-info-item">
              <span className="po-info-label">Region</span>
              <span className="po-info-value">{submission.region || '—'}</span>
            </div>
            <div className="po-info-item">
              <span className="po-info-label">Category</span>
              <span className="po-info-value">{submission.program_category || '—'}</span>
            </div>
          </div>
          <div className="po-form-grid">
            <div className="form-group" style={{ margin: 0 }}>
              <label>Client Type</label>
              <select
                value={selectedClientTypeId}
                onChange={e => setSelectedClientTypeId(e.target.value)}
                className="po-select"
              >
                <option value="">— Select —</option>
                {CLIENT_TYPES.map(ct => (
                  <option key={ct.id} value={ct.id}>{ct.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Financial Assistance Type</label>
              <select
                value={selectedFATypeId}
                onChange={e => setSelectedFATypeId(e.target.value)}
                className="po-select"
              >
                <option value="">— Select —</option>
                {FINANCIAL_ASSISTANCE_TYPES.map(fa => (
                  <option key={fa.id} value={fa.id}>{fa.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group" style={{ marginTop: '12px' }}>
            <label>Assistance Month</label>
            <select
              value={selectedMonthId}
              onChange={e => setSelectedMonthId(e.target.value)}
              className="po-select"
            >
              <option value="">— Select —</option>
              {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                <option key={i+1} value={String(i+1)}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Line Items */}
        <div className="po-section">
          <h3 className="po-section-title">Line Items</h3>
          <div className="form-group" style={{ marginBottom: '12px' }}>
            <label>NetSuite Item Category</label>
            <select
              value={selectedItemId}
              onChange={e => setSelectedItemId(e.target.value)}
              className="po-select"
            >
              {NETSUITE_ITEMS.map(it => (
                <option key={it.id} value={it.id}>{it.name}</option>
              ))}
            </select>
          </div>
          <div className="po-form-grid" style={{ marginBottom: '12px' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Department</label>
              <select
                value={selectedDeptId}
                onChange={e => setSelectedDeptId(e.target.value)}
                className="po-select"
              >
                {NETSUITE_DEPARTMENTS.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Sites</label>
              <select
                value={selectedSiteId}
                onChange={e => setSelectedSiteId(e.target.value)}
                className="po-select"
              >
                {NETSUITE_SITES.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
          <table className="po-line-table">
            <thead>
              <tr>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, idx) => (
                <tr key={idx}>
                  <td>{item.description}</td>
                  <td style={{ textAlign: 'right' }}>{item.quantity}</td>
                  <td style={{ textAlign: 'right' }}>{formatAmount(item.rate)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatAmount(item.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>Total</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: '#0066cc', fontSize: '1.1rem' }}>
                  {formatAmount(submission.service_amount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Memo */}
        <div className="form-group" style={{ marginTop: '16px' }}>
          <label>Memo / Notes</label>
          <input
            type="text"
            value={memo}
            onChange={e => setMemo(e.target.value)}
            placeholder="Optional memo for this PO"
          />
        </div>

        {/* Actions */}
        <div className="modal-actions">
          {result?.type === 'success' ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onClose}
              style={{ minWidth: '140px' }}
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={sending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={sending}
                style={{ minWidth: '180px' }}
              >
                {sending ? 'Sending to NetSuite...' : 'Create Purchase Order'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default PurchaseOrderModal;
