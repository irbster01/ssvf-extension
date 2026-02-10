import { useState } from 'react';
import { Submission, SubmissionStatus, AttachmentMeta } from '../types';

interface EditModalProps {
  submission: Submission;
  onSave: (updates: Partial<Submission>) => Promise<void>;
  onClose: () => void;
  onUploadFile: (file: File) => Promise<AttachmentMeta>;
  onDownloadFile: (blobName: string) => Promise<void>;
}

const STATUS_OPTIONS: SubmissionStatus[] = ['New', 'In Progress', 'Complete'];
const REGION_OPTIONS = ['Shreveport', 'Monroe', 'Arkansas'] as const;
const PROGRAM_OPTIONS = ['Homeless Prevention', 'Rapid Rehousing'] as const;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function EditModal({ submission, onSave, onClose, onUploadFile, onDownloadFile }: EditModalProps) {
  const [clientId, setClientId] = useState(submission.client_id || '');
  const [clientName, setClientName] = useState(submission.client_name || '');
  const [vendor, setVendor] = useState(submission.vendor || '');
  const [vendorAccount, setVendorAccount] = useState(submission.vendor_account || '');
  const [serviceAmount, setServiceAmount] = useState(submission.service_amount?.toString() || '');
  const [region, setRegion] = useState(submission.region || '');
  const [programCategory, setProgramCategory] = useState(submission.program_category || '');
  const [status, setStatus] = useState<SubmissionStatus>(submission.status || 'New');
  const [notes, setNotes] = useState(submission.notes || '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>(submission.attachments || []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        client_id: clientId || undefined,
        client_name: clientName || undefined,
        vendor: vendor || undefined,
        vendor_account: vendorAccount || undefined,
        service_amount: serviceAmount ? parseFloat(serviceAmount) : undefined,
        region: (region as any) || undefined,
        program_category: (programCategory as any) || undefined,
        status,
        notes: notes || undefined,
      });
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
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as SubmissionStatus)}>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              placeholder="Wellsky Client ID"
            />
          </div>

          <div className="form-group">
            <label>Client Name</label>
            <input
              type="text"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              placeholder="Client display name"
            />
          </div>

          <div className="form-group">
            <label>Region</label>
            <select value={region} onChange={e => setRegion(e.target.value)}>
              <option value="">— Select —</option>
              {REGION_OPTIONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Program Category</label>
            <select value={programCategory} onChange={e => setProgramCategory(e.target.value)}>
              <option value="">— Select —</option>
              {PROGRAM_OPTIONS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Vendor</label>
            <input
              type="text"
              value={vendor}
              onChange={e => setVendor(e.target.value)}
              placeholder="Vendor name"
            />
          </div>

          <div className="form-group">
            <label>Vendor Account #</label>
            <input
              type="text"
              value={vendorAccount}
              onChange={e => setVendorAccount(e.target.value)}
              placeholder="Account number"
            />
          </div>

          <div className="form-group">
            <label>Service Amount</label>
            <input
              type="number"
              step="0.01"
              value={serviceAmount}
              onChange={e => setServiceAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="form-group">
            <label>Notes</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional notes"
            />
          </div>

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
