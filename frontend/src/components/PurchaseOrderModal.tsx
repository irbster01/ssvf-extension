import { useState, useRef, useEffect } from 'react';
import { Submission } from '../types';
import { NetSuiteVendor } from '../api/submissions';

interface PurchaseOrderModalProps {
  submission: Submission;
  vendors: NetSuiteVendor[];
  vendorsLoading: boolean;
  onClose: () => void;
  onSubmitPO: (poData: PurchaseOrderData) => Promise<void>;
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
  lineItems: POLineItem[];
}

export interface POLineItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

function PurchaseOrderModal({ submission, vendors, vendorsLoading, onClose, onSubmitPO }: PurchaseOrderModalProps) {
  const [memo, setMemo] = useState(submission.notes || '');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Vendor autocomplete state
  const [vendorSearch, setVendorSearch] = useState(submission.vendor || '');
  const [selectedVendor, setSelectedVendor] = useState<NetSuiteVendor | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const lineItems: POLineItem[] = [
    {
      description: submission.form_data?.assistance_type as string || submission.service_type || 'TFA Service',
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
        lineItems,
      };
      await onSubmitPO(poData);
      setResult({ type: 'success', text: 'Dry run complete — PO payload validated! Switch to live mode when ready.' });
    } catch (err) {
      setResult({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create PO' });
    } finally {
      setSending(false);
    }
  };

  const formatAmount = (val?: number) =>
    val !== undefined && val !== null ? `$${val.toFixed(2)}` : '$0.00';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal po-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <div className="po-header">
          <h2 style={{ margin: 0 }}>Create Purchase Order</h2>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: '0.9rem' }}>
            This will send a PO to NetSuite for processing
          </p>
        </div>

        {result && (
          <div className={`tfa-msg ${result.type}`}>{result.text}</div>
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
        </div>

        {/* Line Items */}
        <div className="po-section">
          <h3 className="po-section-title">Line Items</h3>
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
        </div>
      </div>
    </div>
  );
}

export default PurchaseOrderModal;
