import { useState, useRef, useEffect } from 'react';
import { Submission } from '../types';
import { NetSuiteVendor } from '../api/submissions';

interface PurchaseOrderModalProps {
  submission: Submission;
  vendors: NetSuiteVendor[];
  vendorsLoading: boolean;
  onClose: () => void;
  onSubmitPO: (poData: PurchaseOrderData) => void;
  onSendBack: (submissionId: string, serviceType: string, message: string) => Promise<void>;
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
  tfaNotes: string;
  clientTypeId?: string;
  clientCategoryId?: string;
  financialAssistanceTypeId?: string;
  assistanceMonthId?: string;
  lineItems: POLineItem[];
  attachmentBlobNames?: string[];
}

export interface POLineItem {
  itemId: string;
  departmentId: string;
  classId: string;
  accountId?: string;
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

// NetSuite GL Accounts used for TFA POs (curated from 2-year history)
const NETSUITE_ACCOUNTS = [
  { id: '312', number: '8805', name: 'Room & Board' },
  { id: '314', number: '8815', name: 'Client Utilities' },
  { id: '317', number: '8830', name: 'Clothing & Personal Needs' },
  { id: '318', number: '8835', name: 'Incentives for Clients' },
  { id: '321', number: '8850', name: 'Client Moving Expenses' },
  { id: '322', number: '8855', name: 'Client Furniture' },
  { id: '323', number: '8860', name: 'Transportation' },
  { id: '302', number: '8401', name: 'Repairs & Maintenance Contract' },
  { id: '306', number: '8625', name: 'Agency Vehicle Operating Cost' },
  { id: '307', number: '8630', name: 'Auto Leases' },
  { id: '308', number: '8635', name: 'Mileage & Vehicle Rental' },
  { id: '279', number: '8010', name: 'Computer Expense' },
  { id: '293', number: '8140', name: 'Copier Lease & Supplies' },
  { id: '296', number: '8205', name: 'Telephone Expense' },
  { id: '291', number: '8130', name: 'Office Supplies' },
  { id: '295', number: '8203', name: 'Postage & Shipping Expense' },
  { id: '278', number: '8007', name: 'Other Professional Fees' },
  { id: '292', number: '8135', name: 'Furniture & Equipment' },
  { id: '299', number: '8310', name: 'Rent of Space - Intercompany' },
  { id: '298', number: '8305', name: 'Rent of Space' },
  { id: '290', number: '8125', name: 'Housekeeping Supplies' },
  { id: '303', number: '8501', name: 'Maintenance Services - Inhouse' },
  { id: '309', number: '8640', name: 'Conferences & Meetings - Outside' },
  { id: '283', number: '8080', name: 'Memberships to Other Organizations' },
  { id: '300', number: '8315', name: 'Office Moving Expense' },
  { id: '284', number: '8101', name: 'Program Food & Beverage' },
  { id: '294', number: '8201', name: 'Printing & Printing Supplies' },
  { id: '272', number: '7510', name: 'Employee Training & Development' },
  { id: '271', number: '7203', name: "Worker's Comp & Disability Ins" },
  { id: '932', number: '1285', name: 'Client Receivables' },
  { id: '931', number: '1288', name: 'Travel Advances' },
  { id: '328', number: '9300', name: 'Late Fees & Penalties' },
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

// Default GL account per item (expense sublist requires explicit account)
const ITEM_DEFAULT_ACCOUNT: Record<string, string> = {
  '267': '312', // Room & Board → 8805 Room & Board for Clients
  '226': '320', // Cash Subsidy → 8845 Cash Subsidy for Clients
  '227': '318', // Incentives → 8835 Incentives
  '228': '321', // Moving → 8850 Moving
  '230': '314', // Utilities → 8815 Client Utilities
  '229': '323', // Transportation → 8860 Transportation
  '231': '317', // Clothing → 8830 Clothing / Personal Needs
  '640': '322', // Linen & Bedding → 8855 Furniture / Household
};

// Auto-select GL account based on item selection
function guessAccountId(itemId: string): string {
  return ITEM_DEFAULT_ACCOUNT[itemId] || '320'; // Default: Cash Subsidy for Clients
}

// NetSuite Client Type list (custbody8) — IDs match NetSuite's internal list
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

// Auto-map program_category to Client Type ID (custbody8: 1=RRH, 2=HP in NetSuite)
function guessClientTypeId(programCategory: string): string {
  const lower = (programCategory || '').toLowerCase();
  if (lower.includes('rapid')) return '1';
  if (lower.includes('prevention')) return '2';
  return '';
}

// Derive Client Category SSVF ID (custbody13) from Client Type ID (custbody8)
// custbody8: 1=RRH, 2=HP  →  custbody13: 1=HP (Cat1), 2=RRH (Cat2)
function clientTypeToCategory(clientTypeId: string): string {
  if (clientTypeId === '1') return '2'; // RRH type → Cat 2
  if (clientTypeId === '2') return '1'; // HP type → Cat 1
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

function PurchaseOrderModal({ submission, vendors, vendorsLoading, onClose, onSubmitPO, onSendBack }: PurchaseOrderModalProps) {
  const [memo, setMemo] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string; payload?: any; response?: any } | null>(null);
  const [showPayload, setShowPayload] = useState(false);

  // Send-back-for-corrections state
  const [sendBackMode, setSendBackMode] = useState(false);
  const [sendBackMessage, setSendBackMessage] = useState('');
  const [sendingBack, setSendingBack] = useState(false);

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
  const [selectedAccountId, setSelectedAccountId] = useState(() => guessAccountId(guessItemId(assistanceType)));

  const lineItems: POLineItem[] = [
    {
      itemId: selectedItemId,
      departmentId: selectedDeptId,
      classId: selectedSiteId,
      accountId: selectedAccountId,
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
        tfaNotes: submission.notes || (submission.form_data?.notes as string) || '',
        clientTypeId: selectedClientTypeId || undefined,
        clientCategoryId: clientTypeToCategory(selectedClientTypeId) || undefined,
        financialAssistanceTypeId: selectedFATypeId || undefined,
        assistanceMonthId: selectedMonthId || undefined,
        lineItems,
        attachmentBlobNames: submission.attachments?.map(a => a.blobName) || [],
      };
      // Fire and forget — Dashboard handles the async work, toasts, and closing
      onSubmitPO(poData);
    } catch (err) {
      setResult({ type: 'error', text: err instanceof Error ? err.message : 'Failed to build PO data' });
      setSending(false);
    }
  };

  const handleSendBack = async () => {
    if (!sendBackMessage.trim()) return;
    setSendingBack(true);
    try {
      await onSendBack(submission.id, submission.service_type, sendBackMessage.trim());
      setResult({ type: 'success', text: 'Sent back for corrections' });
      setSendBackMode(false);
    } catch (err) {
      setResult({ type: 'error', text: err instanceof Error ? err.message : 'Failed to send back' });
    } finally {
      setSendingBack(false);
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
              onChange={e => {
                setSelectedItemId(e.target.value);
                setSelectedAccountId(guessAccountId(e.target.value));
              }}
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
          {/* Account selector */}
          <div className="form-group" style={{ marginTop: '12px' }}>
            <label>Account (GL Expense Account)</label>
            <select
              value={selectedAccountId}
              onChange={e => setSelectedAccountId(e.target.value)}
              className="po-select"
            >
              <option value="">— Select account —</option>
              {NETSUITE_ACCOUNTS.map(a => (
                <option key={a.id} value={a.id}>{a.number} — {a.name}</option>
              ))}
            </select>
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

        {/* TFA Notes (read-only, goes to PO header memo) */}
        {(submission.notes || (submission.form_data?.notes as string)) && (
          <div className="form-group" style={{ marginTop: '16px' }}>
            <label>TFA Notes <span style={{ fontWeight: 'normal', fontSize: '0.8em', color: '#888' }}>(→ PO header memo)</span></label>
            <input type="text" value={submission.notes || (submission.form_data?.notes as string) || ''} readOnly style={{ background: '#f5f5f5', color: '#555' }} />
          </div>
        )}

        {/* Line Item Memo (editable, goes to each line item) */}
        <div className="form-group" style={{ marginTop: '8px' }}>
          <label>Line Item Memo <span style={{ fontWeight: 'normal', fontSize: '0.8em', color: '#888' }}>(→ item memo)</span></label>
          <input
            type="text"
            value={memo}
            onChange={e => setMemo(e.target.value)}
            placeholder="Optional memo for line items"
          />
        </div>

        {/* Attachments indicator */}
        {submission.attachments && submission.attachments.length > 0 && (
          <div style={{ margin: '12px 0 4px', padding: '8px 12px', background: '#e8f4fd', borderRadius: '6px', fontSize: '0.85rem', color: '#1a73e8', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>📎</span>
            <span>
              {submission.attachments.length} attachment{submission.attachments.length !== 1 ? 's' : ''} will be uploaded to NetSuite:
            </span>
            <span style={{ color: '#555', fontWeight: 400 }}>
              {submission.attachments.map(a => a.fileName).join(', ')}
            </span>
          </div>
        )}

        {/* Send-back panel */}
        {sendBackMode && !result && (
          <div style={{
            margin: '16px 0 0',
            padding: '14px',
            backgroundColor: '#fff7ed',
            border: '1px solid #fed7aa',
            borderRadius: '8px',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
            }}>
              <label style={{ fontWeight: 600, fontSize: '0.9em', color: '#9a3412' }}>
                What needs to be corrected?
              </label>
              <button
                type="button"
                onClick={() => setSendBackMode(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.1em',
                  color: '#9a3412',
                  padding: '2px 6px',
                }}
                aria-label="Cancel send back"
              >
                ×
              </button>
            </div>
            <textarea
              value={sendBackMessage}
              onChange={e => setSendBackMessage(e.target.value)}
              placeholder="Describe the issue — e.g. wrong amount, missing client ID, vendor doesn't match..."
              rows={3}
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: '0.85em',
                border: '1px solid #fed7aa',
                borderRadius: '6px',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              autoFocus
            />
            <button
              type="button"
              onClick={handleSendBack}
              disabled={sendingBack || !sendBackMessage.trim()}
              style={{
                marginTop: '8px',
                padding: '8px 16px',
                fontSize: '0.85em',
                fontWeight: 600,
                backgroundColor: sendingBack || !sendBackMessage.trim() ? '#d1d5db' : '#ea580c',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: sendingBack || !sendBackMessage.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {sendingBack ? 'Sending…' : 'Send Back for Corrections'}
            </button>
          </div>
        )}

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
                disabled={sending || sendingBack}
              >
                Cancel
              </button>
              {!sendBackMode && (
                <button
                  type="button"
                  onClick={() => setSendBackMode(true)}
                  disabled={sending}
                  style={{
                    padding: '8px 14px',
                    fontSize: '0.85em',
                    fontWeight: 600,
                    backgroundColor: '#fff7ed',
                    color: '#ea580c',
                    border: '1px solid #fed7aa',
                    borderRadius: '6px',
                    cursor: sending ? 'not-allowed' : 'pointer',
                  }}
                >
                  ↩ Send Back
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={sending || sendBackMode}
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
