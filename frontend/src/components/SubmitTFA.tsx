import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { submitCapture, uploadAttachment, TFASubmission, NetSuiteVendor, ClientRecord } from '../api/submissions';
import ClientAutocomplete from './ClientAutocomplete';

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
  clients: ClientRecord[];
  clientsLoading: boolean;
  onClientAdded?: (client: ClientRecord) => void;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

const emptyForm: TFASubmission = {
  clientId: '',
  clientName: '',
  vendor: '',
  vendorId: '',
  amount: '',
  region: '',
  programCategory: '',
  assistanceType: 'Rental Assistance',
  tfaDate: todayStr(),
  notes: '',
};

export default function SubmitTFA({ getToken, onSubmitted, vendors, vendorsLoading, clients, clientsLoading, onClientAdded }: SubmitTFAProps) {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState<TFASubmission>({ ...emptyForm });
  // Track expected program from client seed for mismatch warning
  const [clientSeedProgram, setClientSeedProgram] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

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

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (dropRef.current && !dropRef.current.contains(e.relatedTarget as Node)) setDragging(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    const maxSize = 10 * 1024 * 1024;
    const valid = dropped.filter(f => f.size <= maxSize);
    if (valid.length < dropped.length) {
      setMessage({ type: 'error', text: 'Some files exceeded 10 MB and were skipped.' });
    }
    setFiles(prev => [...prev, ...valid]);
  }, []);

  // Summary line
  const summaryLine = useMemo(() => {
    const parts: string[] = [];
    if (form.assistanceType) parts.push(form.assistanceType);
    if (form.clientName) parts.push(form.clientName);
    if (form.amount) parts.push(`$${parseFloat(form.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    return parts.length >= 2 ? parts.join(' — ') : '';
  }, [form.assistanceType, form.clientName, form.amount]);

  const reset = () => {
    setForm({ ...emptyForm, tfaDate: todayStr() });
    setFiles([]);
    setSelectedVendor(null);
    setVendorSearch('');
    setShowNotes(false);
    setClientSeedProgram('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.clientId || !form.amount) {
      setMessage({ type: 'error', text: 'Client ID and Amount are required.' });
      return;
    }

    // Warn if program doesn't match what's on file for this client
    if (clientSeedProgram && form.programCategory !== clientSeedProgram) {
      const ok = window.confirm(
        `The program you selected (${form.programCategory}) doesn't match this client's program on file (${clientSeedProgram}). Continue anyway?`
      );
      if (!ok) return;
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

      // If client is not in the autocomplete list, persist as new client
      if (form.clientId && form.clientName && !clients.find(c => c.id === form.clientId)) {
        onClientAdded?.({ id: form.clientId, clientName: form.clientName, region: form.region, program: form.programCategory });
      } else if (form.clientId && form.region) {
        // Save region back to client record if it was missing
        const existing = clients.find(c => c.id === form.clientId);
        if (existing && !existing.region) {
          onClientAdded?.({ ...existing, region: form.region, program: form.programCategory || existing.program });
        }
      }

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
    <div className="submit-tfa-card receipt-card">
      <div className="submit-tfa-header">
        <h3>Submit TFA</h3>
        <button className="btn btn-secondary btn-small" onClick={() => { setExpanded(false); setMessage(null); }}>
          Close
        </button>
      </div>

      {message && (
        <div className={`tfa-msg ${message.type}`}>{message.text}</div>
      )}

      <form onSubmit={handleSubmit} className="tfa-form receipt-form">
        {/* Row 1: Date (full width) */}
        <div className="form-group">
          <label>Date *</label>
          <input
            type="date"
            value={form.tfaDate}
            onChange={e => set('tfaDate', e.target.value)}
            required
          />
        </div>

        {/* Row 2: Vendor | Assistance Type */}
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label>Vendor *</label>
            <div className="vendor-autocomplete" ref={dropdownRef}>
              {selectedVendor ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 12px', backgroundColor: '#e8f5e9',
                  borderRadius: '6px', border: '1px solid #a5d6a7',
                }}>
                  <span style={{ flex: 1, fontWeight: 500 }}>
                    {selectedVendor.companyName}
                    <span style={{ color: '#666', fontSize: '0.85em', marginLeft: '8px' }}>
                      NS #{selectedVendor.entityId}
                    </span>
                  </span>
                  <button type="button" onClick={clearVendor}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1em', color: '#666' }}>✕</button>
                </div>
              ) : (
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
                  placeholder={vendorsLoading ? 'Loading vendors...' : 'Search vendors...'}
                  disabled={vendorsLoading}
                  autoComplete="off"
                  required
                />
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
          <div className="form-group" style={{ flex: 1 }}>
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
        </div>

        {/* Row 3: Client Name+ID | Region | Program */}
        <div className="form-row form-row-3col">
          <div className="form-group" style={{ flex: 2 }}>
            <ClientAutocomplete
              clients={clients}
              clientsLoading={clientsLoading}
              clientName={form.clientName}
              clientId={form.clientId}
              onChange={(name, id, selectedRecord) => {
                setForm(prev => ({
                  ...prev,
                  clientName: name,
                  clientId: id,
                  ...(selectedRecord?.program ? { programCategory: selectedRecord.program } : {}),
                  ...(selectedRecord?.region ? { region: selectedRecord.region } : {}),
                }));
                setClientSeedProgram(selectedRecord?.program || '');
              }}
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Region *</label>
            <select
              value={form.region}
              onChange={e => set('region', e.target.value)}
              required
            >
              <option value="">— Select —</option>
              <option value="Shreveport">Shreveport</option>
              <option value="Monroe">Monroe</option>
              <option value="Arkansas">Arkansas</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Program *</label>
            <select
              value={form.programCategory}
              onChange={e => set('programCategory', e.target.value)}
              required
            >
              <option value="">— Select —</option>
              <option value="Homeless Prevention">Homeless Prevention</option>
              <option value="Rapid Rehousing">Rapid Rehousing</option>
            </select>
          </div>
        </div>

        {/* Row 4: Notes (collapsible) | Amount (prominent) */}
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            {showNotes ? (
              <>
                <label>Description / Notes</label>
                <textarea
                  placeholder="Add notes..."
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  rows={2}
                  className="receipt-notes"
                />
              </>
            ) : (
              <button type="button" className="add-notes-btn" onClick={() => setShowNotes(true)}>
                + Add Notes
              </button>
            )}
          </div>
          <div className="form-group receipt-amount-group" style={{ flex: 1 }}>
            <label>Amount *</label>
            <div className="receipt-amount-wrapper">
              <span className="receipt-amount-symbol">$</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={form.amount}
                onChange={e => set('amount', e.target.value)}
                required
                className="receipt-amount-input"
              />
            </div>
          </div>
        </div>

        {/* Row 5: Receipt Attachments (drag-and-drop) */}
        <div className="form-group">
          <label>Receipt Attachments</label>
          <div
            ref={dropRef}
            className={`receipt-drop-zone${dragging ? ' dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById('tfa-file-input')?.click()}
          >
            <input id="tfa-file-input" type="file" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
            <div className="drop-zone-content">
              <span className="drop-zone-icon">📎</span>
              <span>Drag files here or <strong>click to browse</strong></span>
              <span className="drop-zone-hint">Max 10 MB per file</span>
            </div>
          </div>
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

        {/* Summary strip */}
        {summaryLine && (
          <div className="receipt-summary">
            {summaryLine}
          </div>
        )}

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
