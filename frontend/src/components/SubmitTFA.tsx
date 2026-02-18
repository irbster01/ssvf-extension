import { useState, useRef, useEffect } from 'react';
import { submitCapture, uploadAttachment, TFASubmission, NetSuiteVendor } from '../api/submissions';

const FINANCIAL_ASSISTANCE_TYPES = [
  'Rental Assistance',
  'Moving Cost Assistance',
  'Utility Deposit',
  'Security Deposit',
  'Other as approved by VA',
  'Utility Assistance',
  'Motel/Hotel Voucher',
  'Emergency Supplies',
  'Transportation',
] as const;

interface SubmitTFAProps {
  getToken: () => Promise<string>;
  onSubmitted?: () => void;
  vendors: NetSuiteVendor[];
  vendorsLoading: boolean;
}

const emptyForm: TFASubmission = {
  clientId: '',
  clientName: '',
  vendor: '',
  vendorId: '',
  amount: '',
  region: 'Shreveport',
  programCategory: 'Homeless Prevention',
  assistanceType: 'Rental Assistance',
  tfaDate: '',
  notes: '',
};

export default function SubmitTFA({ getToken, onSubmitted, vendors, vendorsLoading }: SubmitTFAProps) {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState<TFASubmission>({ ...emptyForm });
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Vendor autocomplete state
  const [vendorSearch, setVendorSearch] = useState('');
  const [selectedVendor, setSelectedVendor] = useState<NetSuiteVendor | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const vendorInputRef = useRef<HTMLInputElement>(null);

  // Filter vendors based on search text
  const filteredVendors = vendorSearch.length >= 1
    ? vendors.filter(v =>
        v.companyName.toLowerCase().includes(vendorSearch.toLowerCase()) ||
        v.entityId.toLowerCase().includes(vendorSearch.toLowerCase())
      ).slice(0, 50)
    : [];

  // Close dropdown on outside click
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
    setForm(prev => ({ ...prev, vendor: vendor.companyName, vendorId: vendor.id }));
    setShowDropdown(false);
    setHighlightIndex(-1);
  };

  const clearVendor = () => {
    setSelectedVendor(null);
    setVendorSearch('');
    setForm(prev => ({ ...prev, vendor: '', vendorId: '' }));
    vendorInputRef.current?.focus();
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

  const set = (field: keyof TFASubmission, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const maxSize = 10 * 1024 * 1024;
    const valid = selected.filter(f => f.size <= maxSize);
    if (valid.length < selected.length) {
      setMessage({ type: 'error', text: 'Some files exceeded 10 MB and were skipped.' });
    }
    setFiles(prev => [...prev, ...valid]);
    e.target.value = '';
  };

  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const reset = () => {
    setForm({ ...emptyForm });
    setFiles([]);
    setSelectedVendor(null);
    setVendorSearch('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.clientId || !form.amount) {
      setMessage({ type: 'error', text: 'Client ID and Amount are required.' });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const token = await getToken();
      const result = await submitCapture(token, form);

      // Upload attachments
      if (files.length > 0 && result.id) {
        for (const file of files) {
          try {
            await uploadAttachment(token, result.id, 'TFA', file);
          } catch (err) {
            console.error(`Failed to upload ${file.name}:`, err);
          }
        }
      }

      setMessage({ type: 'success', text: 'TFA submitted successfully!' });
      reset();
      onSubmitted?.();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Submission failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (!expanded) {
    return (
      <div className="submit-tfa-card collapsed" onClick={() => setExpanded(true)}>
        <div className="submit-tfa-icon">＋</div>
        <div>
          <h3>Submit TFA</h3>
          <p>Tap to enter a new Temporary Financial Assistance record</p>
        </div>
      </div>
    );
  }

  return (
    <div className="submit-tfa-card">
      <div className="submit-tfa-header">
        <h3>Submit TFA</h3>
        <button className="btn btn-secondary btn-small" onClick={() => { setExpanded(false); setMessage(null); }}>
          Close
        </button>
      </div>

      {message && (
        <div className={`tfa-msg ${message.type}`}>{message.text}</div>
      )}

      <form onSubmit={handleSubmit} className="tfa-form">
        <div className="form-row">
          <div className="form-group">
            <label>Client ID *</label>
            <input
              type="text"
              placeholder="e.g., 12345"
              value={form.clientId}
              onChange={e => set('clientId', e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Client Name</label>
            <input
              type="text"
              placeholder="e.g., John Smith"
              value={form.clientName}
              onChange={e => set('clientName', e.target.value)}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Region *</label>
            <select
              value={form.region}
              onChange={e => set('region', e.target.value)}
              required
            >
              <option value="Shreveport">Shreveport</option>
              <option value="Monroe">Monroe</option>
              <option value="Arkansas">Arkansas</option>
            </select>
          </div>
          <div className="form-group">
            <label>Program *</label>
            <select
              value={form.programCategory}
              onChange={e => set('programCategory', e.target.value)}
              required
            >
              <option value="Homeless Prevention">Homeless Prevention</option>
              <option value="Rapid Rehousing">Rapid Rehousing</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Assistance Type *</label>
          <select
            value={form.assistanceType}
            onChange={e => set('assistanceType', e.target.value)}
            required
          >
            {FINANCIAL_ASSISTANCE_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>TFA Date</label>
            <input
              type="date"
              value={form.tfaDate}
              onChange={e => set('tfaDate', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Amount *</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g., 150.00"
              value={form.amount}
              onChange={e => set('amount', e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Vendor *</label>
            <div className="vendor-autocomplete" ref={dropdownRef}>
              <input
                ref={vendorInputRef}
                type="text"
                className="vendor-search-input"
                value={vendorSearch}
                onChange={e => {
                  setVendorSearch(e.target.value);
                  setSelectedVendor(null);
                  setForm(prev => ({ ...prev, vendor: e.target.value, vendorId: '' }));
                  setShowDropdown(true);
                  setHighlightIndex(-1);
                }}
                onFocus={() => vendorSearch.length >= 1 && setShowDropdown(true)}
                onKeyDown={handleVendorKeyDown}
                placeholder={vendorsLoading ? 'Loading vendors...' : 'Type to search vendors...'}
                disabled={vendorsLoading}
                autoComplete="off"
                required
              />
              {selectedVendor && (
                <div className="vendor-selected-badge">
                  <span>NS #{selectedVendor.id}</span>
                  <button type="button" onClick={clearVendor} aria-label="Clear vendor">×</button>
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
        </div>

        <div className="form-group">
          <label>Notes</label>
          <input
            type="text"
            placeholder="Optional notes"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Attachments</label>
          <input type="file" multiple onChange={handleFileSelect} className="file-input" />
          {files.length > 0 && (
            <div className="file-list">
              {files.map((f, i) => (
                <span key={i} className="file-chip">
                  {f.name}
                  <button type="button" onClick={() => removeFile(i)} className="file-remove">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="tfa-form-actions">
          <button type="button" className="btn btn-secondary" onClick={reset} disabled={submitting}>
            Clear
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit TFA'}
          </button>
        </div>
      </form>
    </div>
  );
}
