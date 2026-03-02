import { useState, useRef, useEffect } from 'react';
import { Submission, SubmissionStatus, AttachmentMeta, UserRole, isElevatedRole } from '../types';
import { NetSuiteVendor, ClientRecord } from '../api/submissions';
import ClientAutocomplete from './ClientAutocomplete';

interface EditModalProps {
  submission: Submission;
  vendors: NetSuiteVendor[];
  vendorsLoading: boolean;
  clients: ClientRecord[];
  clientsLoading: boolean;
  currentUsername?: string;
  userRole: UserRole;
  onSave: (updates: Partial<Submission>) => Promise<void>;
  onClose: () => void;
  onUploadFile: (file: File) => Promise<AttachmentMeta>;
  onDownloadFile: (blobName: string) => Promise<void>;
  onClientAdded?: (client: ClientRecord) => void;
}

const STATUS_OPTIONS: SubmissionStatus[] = ['New', 'Corrections', 'In Review', 'Submitted'];
const REGION_OPTIONS = ['Shreveport', 'Monroe', 'Arkansas'] as const;
const PROGRAM_OPTIONS = ['Homeless Prevention', 'Rapid Rehousing'] as const;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function EditModal({ submission, vendors, vendorsLoading, clients, clientsLoading, currentUsername, userRole, onSave, onClose, onUploadFile, onDownloadFile, onClientAdded }: EditModalProps) {
  const elevated = isElevatedRole(userRole);
  const [clientId, setClientId] = useState(submission.client_id || '');
  const [clientName, setClientName] = useState(submission.client_name || '');
  const [serviceAmount, setServiceAmount] = useState(submission.service_amount?.toString() || '');
  const [region, setRegion] = useState(submission.region || '');
  const [programCategory, setProgramCategory] = useState(submission.program_category || '');
  const [status, setStatus] = useState<SubmissionStatus>(submission.status || 'New');
  const [notes, setNotes] = useState(submission.notes || '');
  const [tfaDate, setTfaDate] = useState(submission.tfa_date || '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>(submission.attachments || []);
  const [enteredInSystem, setEnteredInSystem] = useState(submission.entered_in_system || false);
  const [clientSeedProgram, setClientSeedProgram] = useState<string | null>(null);

  // Vendor autocomplete state
  const [vendorSearch, setVendorSearch] = useState(submission.vendor || '');
  const [selectedVendor, setSelectedVendor] = useState<NetSuiteVendor | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-match vendor from submission when vendors list loads
  useEffect(() => {
    if (vendors.length > 0 && !selectedVendor) {
      if (submission.vendor_id) {
        const match = vendors.find(v => v.id === submission.vendor_id);
        if (match) { setSelectedVendor(match); setVendorSearch(match.companyName); return; }
      }
      if (submission.vendor) {
        const match = vendors.find(v => v.companyName.toLowerCase() === submission.vendor!.toLowerCase());
        if (match) { setSelectedVendor(match); setVendorSearch(match.companyName); }
      }
    }
  }, [vendors, submission.vendor_id, submission.vendor]);

  const filteredVendors = vendorSearch.length >= 1
    ? vendors.filter(v =>
        v.companyName.toLowerCase().includes(vendorSearch.toLowerCase()) ||
        v.entityId.toLowerCase().includes(vendorSearch.toLowerCase())
      ).slice(0, 50)
    : [];

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
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIndex(prev => Math.min(prev + 1, filteredVendors.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIndex(prev => Math.max(prev - 1, 0)); }
    else if (e.key === 'Enter' && highlightIndex >= 0) { e.preventDefault(); handleVendorSelect(filteredVendors[highlightIndex]); }
    else if (e.key === 'Escape') { setShowDropdown(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Warn if program doesn't match seed data
    if (clientSeedProgram && programCategory !== clientSeedProgram) {
      const ok = window.confirm(
        `The selected program "${programCategory || '(none)'}" doesn't match the client's program on file ("${clientSeedProgram}"). Continue anyway?`
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const updates: Partial<Submission> = {
        client_id: clientId || undefined,
        client_name: clientName || undefined,
        vendor: selectedVendor?.companyName || vendorSearch || undefined,
        vendor_id: selectedVendor?.id || undefined,
        service_amount: serviceAmount ? parseFloat(serviceAmount) : undefined,
        region: (region as any) || undefined,
        program_category: (programCategory as any) || undefined,
        notes: notes || undefined,
        tfa_date: tfaDate || undefined,
      };
      // Only include elevated-only fields when user has permission
      if (elevated) {
        updates.status = status;
        updates.entered_in_system = enteredInSystem;
        updates.entered_in_system_by = enteredInSystem ? (submission.entered_in_system_by || currentUsername || undefined) : undefined;
        updates.entered_in_system_at = enteredInSystem ? (submission.entered_in_system_at || new Date().toISOString()) : undefined;
      }
      await onSave(updates);

      // If client is not in the autocomplete list, persist as new client
      if (clientId && clientName && !clients.find(c => c.id === clientId)) {
        onClientAdded?.({ id: clientId, clientName, region, program: programCategory });
      } else if (clientId && region) {
        // Save region back to client record if it was missing
        const existing = clients.find(c => c.id === clientId);
        if (existing && !existing.region) {
          onClientAdded?.({ ...existing, region, program: programCategory || existing.program });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploading(true);
    try {
      for (const file of files) {
        const meta = await onUploadFile(file);
        setAttachments(prev => [...prev, meta]);
      }
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Edit Submission</h2>
        <form onSubmit={handleSubmit} className="receipt-edit-form">
          {elevated && (
          <div className="form-group">
            <label>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as SubmissionStatus)}>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          )}

          {/* Row 1: Date */}
          <div className="form-group">
            <label>TFA Date</label>
            <input
              type="date"
              value={tfaDate}
              onChange={e => setTfaDate(e.target.value)}
            />
          </div>

          {/* Row 2: Vendor */}
          <div className="form-group" style={{ position: 'relative' }} ref={dropdownRef}>
            <label>Vendor</label>
            {selectedVendor ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 12px', backgroundColor: '#e8f5e9',
                borderRadius: '6px', border: '1px solid #a5d6a7',
              }}>
                <span style={{ flex: 1, fontWeight: 500 }}>
                  {selectedVendor.companyName}
                  <span style={{ color: '#666', fontSize: '0.85em', marginLeft: '8px' }}>NS #{selectedVendor.entityId}</span>
                </span>
                <button type="button" onClick={() => { setSelectedVendor(null); setVendorSearch(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1em', color: '#666' }}>✕</button>
              </div>
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={vendorSearch}
                onChange={e => { setVendorSearch(e.target.value); setShowDropdown(true); setHighlightIndex(0); }}
                onFocus={() => setShowDropdown(true)}
                onKeyDown={handleVendorKeyDown}
                placeholder={vendorsLoading ? 'Loading vendors…' : 'Search NetSuite vendors…'}
                autoComplete="off"
              />
            )}
            {showDropdown && !selectedVendor && vendorSearch.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
                backgroundColor: '#fff', border: '1px solid #d1d5db', borderRadius: '6px',
                maxHeight: '200px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}>
                {filteredVendors.length === 0 ? (
                  <div style={{ padding: '10px 14px', color: '#999', fontSize: '0.9em' }}>No matching vendors</div>
                ) : (
                  filteredVendors.map((v, idx) => (
                    <div key={v.id}
                      onClick={() => handleVendorSelect(v)}
                      style={{
                        padding: '8px 14px', cursor: 'pointer', fontSize: '0.9em',
                        backgroundColor: idx === highlightIndex ? '#e3f2fd' : '#fff',
                      }}
                      onMouseEnter={() => setHighlightIndex(idx)}
                    >{v.companyName}</div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Row 3: Client | Region | Program */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="form-group" style={{ flex: 2 }}>
              <ClientAutocomplete
                clients={clients}
                clientsLoading={clientsLoading}
                clientName={clientName}
                clientId={clientId}
                onChange={(name, id, rec) => {
                  setClientName(name);
                  setClientId(id);
                  if (rec) {
                    if (rec.program) { setProgramCategory(rec.program); setClientSeedProgram(rec.program); }
                    if (rec.region) { setRegion(rec.region); }
                  } else {
                    setClientSeedProgram(null);
                  }
                }}
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Region</label>
              <select value={region} onChange={e => setRegion(e.target.value)}>
                <option value="">— Select —</option>
                {REGION_OPTIONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Program</label>
              <select value={programCategory} onChange={e => setProgramCategory(e.target.value)}>
                <option value="">— Select —</option>
                {PROGRAM_OPTIONS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 4: Notes | Amount */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional notes"
                rows={2}
                style={{ resize: 'vertical' }}
              />
            </div>
            <div className="form-group receipt-amount-group" style={{ flex: 1 }}>
              <label>Amount</label>
              <div className="receipt-amount-wrapper">
                <span className="receipt-amount-symbol">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={serviceAmount}
                  onChange={e => setServiceAmount(e.target.value)}
                  placeholder="0.00"
                  className="receipt-amount-input"
                />
              </div>
            </div>
          </div>

          {elevated && (
          <div className="form-group">
            <label>Entered in System</label>
            <div
              onClick={() => setEnteredInSystem(!enteredInSystem)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 14px',
                backgroundColor: enteredInSystem ? '#ecfdf5' : '#fff7ed',
                border: `1px solid ${enteredInSystem ? '#a7f3d0' : '#fed7aa'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                userSelect: 'none' as const,
                transition: 'all 0.2s',
              }}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEnteredInSystem(!enteredInSystem); } }}
            >
              <span style={{
                width: '10px', height: '10px', borderRadius: '50%',
                backgroundColor: enteredInSystem ? '#10b981' : '#e8916e',
                boxShadow: enteredInSystem ? '0 0 4px rgba(16,185,129,0.4)' : '0 0 3px rgba(232,145,110,0.3)',
                flexShrink: 0,
              }} />
              <span style={{ fontWeight: 500, color: enteredInSystem ? '#065f46' : '#9a3412', fontSize: '0.9em' }}>
                {enteredInSystem ? 'Entered in ServicePoint / LSNDC' : 'Not yet entered'}
              </span>
              {enteredInSystem && submission.entered_in_system_by && (
                <span style={{ fontSize: '0.8em', color: '#6b7280', marginLeft: 'auto' }}>
                  by {submission.entered_in_system_by}
                </span>
              )}
            </div>
          </div>
          )}

          {/* Attachments */}
          <div className="form-group">
            <label>Attachments</label>
            {attachments.length > 0 && (
              <div className="attachment-list">
                {attachments.map((att, idx) => (
                  <div key={idx} className="attachment-item" style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 10px',
                    backgroundColor: '#f3f4f6',
                    borderRadius: '6px',
                    marginBottom: '4px',
                    fontSize: '0.85em',
                  }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      📎 {att.fileName} ({formatFileSize(att.size)})
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => onDownloadFile(att.blobName)}
                      style={{ marginLeft: '8px', fontSize: '0.8em' }}
                    >
                      Download
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label className="file-upload-label" style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              border: '1px dashed #d1d5db',
              borderRadius: '6px',
              cursor: uploading ? 'not-allowed' : 'pointer',
              fontSize: '0.9em',
              color: '#667eea',
              backgroundColor: '#f9fafb',
              marginTop: '6px',
              opacity: uploading ? 0.6 : 1,
            }}>
              {uploading ? '⏳ Uploading...' : '📎 Add files'}
              <input
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt"
                onChange={handleFileUpload}
                disabled={uploading}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditModal;
