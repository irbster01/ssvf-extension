import React, { useState, useRef, useEffect } from 'react';
import { getValidToken, silentTokenRefresh } from '../auth/authService';
import { API_URL } from '../config';
import {
  NetSuiteVendor,
  ManualTFAForm,
  Stats,
  SSVFRegion,
  ProgramCategory,
  FinancialAssistanceType,
  FINANCIAL_ASSISTANCE_TYPES,
  INITIAL_MANUAL_FORM,
} from './popupTypes';
import { popupStyles as styles } from './popupStyles';

interface ManualTFATabProps {
  isAuthenticated: boolean;
  vendors: NetSuiteVendor[];
  vendorsLoading: boolean;
  stats: Stats;
  onStatsUpdate: (stats: Stats) => void;
  onAuthExpired: () => void;
}

const ManualTFATab: React.FC<ManualTFATabProps> = ({
  isAuthenticated,
  vendors,
  vendorsLoading,
  stats,
  onStatsUpdate,
  onAuthExpired,
}) => {
  const [manualForm, setManualForm] = useState<ManualTFAForm>(INITIAL_MANUAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // Vendor autocomplete state
  const [vendorSearch, setVendorSearch] = useState('');
  const [selectedVendor, setSelectedVendor] = useState<NetSuiteVendor | null>(null);
  const [showVendorDropdown, setShowVendorDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const vendorDropdownRef = useRef<HTMLDivElement>(null);
  const vendorInputRef = useRef<HTMLInputElement>(null);

  const filteredVendors = vendorSearch.length >= 1
    ? vendors.filter(v =>
        v.companyName.toLowerCase().includes(vendorSearch.toLowerCase()) ||
        v.entityId.toLowerCase().includes(vendorSearch.toLowerCase())
      ).slice(0, 30)
    : [];

  // Close vendor dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (vendorDropdownRef.current && !vendorDropdownRef.current.contains(e.target as Node)) {
        setShowVendorDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleVendorSelect = (vendor: NetSuiteVendor) => {
    setSelectedVendor(vendor);
    setVendorSearch(vendor.companyName);
    setManualForm(prev => ({ ...prev, vendor: vendor.companyName }));
    setShowVendorDropdown(false);
    setHighlightIndex(-1);
  };

  const clearVendor = () => {
    setSelectedVendor(null);
    setVendorSearch('');
    setManualForm(prev => ({ ...prev, vendor: '' }));
    vendorInputRef.current?.focus();
  };

  const handleVendorKeyDown = (e: React.KeyboardEvent) => {
    if (!showVendorDropdown || filteredVendors.length === 0) return;
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
      setShowVendorDropdown(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const maxSize = 10 * 1024 * 1024;
    const validFiles = files.filter(f => f.size <= maxSize);
    if (validFiles.length < files.length) {
      setSubmitMessage({ type: 'error', text: 'Some files were too large (max 10MB each)' });
    }
    setSelectedFiles(prev => [...prev, ...validFiles]);
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.clientId || !manualForm.amount) {
      setSubmitMessage({ type: 'error', text: 'Client ID and Amount are required' });
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage(null);

    try {
      let token = await getValidToken();

      if (!token) {
        setSubmitMessage({ type: 'error', text: 'Please sign in first' });
        setIsSubmitting(false);
        return;
      }

      const payload = {
        user_id: 'unknown',
        source_url: 'manual-entry',
        captured_at_utc: new Date().toISOString(),
        form_data: {
          client_id: manualForm.clientId,
          client_name: manualForm.clientName,
          vendor: manualForm.vendor,
          vendor_id: selectedVendor?.id || undefined,
          service_cost_amount: manualForm.amount,
          region: manualForm.region,
          program_category: manualForm.programCategory,
          assistance_type: manualForm.assistanceType,
          tfa_date: manualForm.tfaDate || undefined,
          notes: manualForm.notes,
          manual_entry: true,
        },
      };

      let response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        const newToken = await silentTokenRefresh();
        if (newToken) {
          token = newToken;
          response = await fetch(API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          });
        } else {
          onAuthExpired();
          setSubmitMessage({ type: 'error', text: 'Session expired. Please sign in again.' });
          setIsSubmitting(false);
          return;
        }
      }

      if (response.ok) {
        const result = await response.json().catch(() => null);
        const submissionId = result?.id;

        // Upload attachments if any
        if (selectedFiles.length > 0 && submissionId) {
          setUploadProgress(`Uploading ${selectedFiles.length} file(s)...`);
          for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            setUploadProgress(`Uploading ${i + 1}/${selectedFiles.length}: ${file.name}`);
            try {
              const base64 = await fileToBase64(file);
              await fetch(API_URL.replace('/captures', `/submissions/${submissionId}/attachments`), {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                  fileName: file.name,
                  contentType: file.type || 'application/octet-stream',
                  data: base64,
                  serviceType: 'TFA',
                }),
              });
            } catch (err) {
              console.error(`Failed to upload ${file.name}:`, err);
            }
          }
          setUploadProgress(null);
        }

        setSubmitMessage({ type: 'success', text: 'TFA submitted successfully!' });
        setManualForm(INITIAL_MANUAL_FORM);
        setSelectedFiles([]);
        setSelectedVendor(null);
        setVendorSearch('');

        // Update local stats
        const newStats = { ...stats };
        newStats.totalCaptures++;
        newStats.successfulCaptures++;
        newStats.lastCaptureTime = new Date().toISOString();
        newStats.recentLogs.unshift({
          timestamp: newStats.lastCaptureTime,
          status: 'success',
          url: 'Manual Entry',
          fieldCount: Object.keys(payload.form_data).length,
          clientId: manualForm.clientId,
        });
        if (newStats.recentLogs.length > 10) {
          newStats.recentLogs = newStats.recentLogs.slice(0, 10);
        }
        onStatsUpdate(newStats);
        chrome.storage.local.set({ captureStats: newStats });
      } else {
        setSubmitMessage({ type: 'error', text: 'Failed to submit. Please try again.' });
      }
    } catch {
      setSubmitMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleManualSubmit}>
      {submitMessage && <div style={styles.message(submitMessage.type)}>{submitMessage.text}</div>}

      <div style={styles.card}>
        <div style={{ marginBottom: '12px' }}>
          <label style={styles.label}>Client ID *</label>
          <input
            type="text"
            placeholder="e.g., 8542657"
            value={manualForm.clientId}
            onChange={(e) => setManualForm({ ...manualForm, clientId: e.target.value })}
            style={styles.input}
            required
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={styles.label}>Client Name</label>
          <input
            type="text"
            placeholder="e.g., John Smith"
            value={manualForm.clientName}
            onChange={(e) => setManualForm({ ...manualForm, clientName: e.target.value })}
            style={styles.input}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Region *</label>
            <select
              value={manualForm.region}
              onChange={(e) => setManualForm({ ...manualForm, region: e.target.value as SSVFRegion })}
              style={styles.input}
              required
            >
              <option value="Shreveport">Shreveport</option>
              <option value="Monroe">Monroe</option>
              <option value="Arkansas">Arkansas</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Program *</label>
            <select
              value={manualForm.programCategory}
              onChange={(e) => setManualForm({ ...manualForm, programCategory: e.target.value as ProgramCategory })}
              style={styles.input}
              required
            >
              <option value="Homeless Prevention">Homeless Prevention</option>
              <option value="Rapid Rehousing">Rapid Rehousing</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={styles.label}>Assistance Type *</label>
          <select
            value={manualForm.assistanceType}
            onChange={(e) => setManualForm({ ...manualForm, assistanceType: e.target.value as FinancialAssistanceType })}
            style={styles.input}
            required
          >
            {FINANCIAL_ASSISTANCE_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={styles.label}>TFA Date</label>
          <input
            type="date"
            value={manualForm.tfaDate}
            onChange={(e) => setManualForm({ ...manualForm, tfaDate: e.target.value })}
            style={styles.input}
          />
        </div>

        <div style={{ marginBottom: '12px', position: 'relative' }} ref={vendorDropdownRef}>
          <label style={styles.label}>Vendor *</label>
          <div style={{ position: 'relative' }}>
            <input
              ref={vendorInputRef}
              type="text"
              placeholder={vendorsLoading ? 'Loading vendors...' : 'Type to search vendors...'}
              value={vendorSearch}
              onChange={(e) => {
                setVendorSearch(e.target.value);
                setSelectedVendor(null);
                setManualForm(prev => ({ ...prev, vendor: e.target.value }));
                setShowVendorDropdown(true);
                setHighlightIndex(-1);
              }}
              onFocus={() => vendorSearch.length >= 1 && setShowVendorDropdown(true)}
              onKeyDown={handleVendorKeyDown}
              disabled={vendorsLoading}
              autoComplete="off"
              style={styles.input}
              required
            />
            {selectedVendor && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                backgroundColor: '#eef2ff',
                borderRadius: '10px',
                fontSize: '10px',
                color: '#667eea',
                fontWeight: 600,
                marginTop: '-6px',
                marginBottom: '4px',
              }}>
                <span>NS #{selectedVendor.id}</span>
                <button
                  type="button"
                  onClick={clearVendor}
                  style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '12px', padding: '0 2px' }}
                  aria-label="Clear vendor"
                >×</button>
              </div>
            )}
          </div>
          {showVendorDropdown && !selectedVendor && filteredVendors.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              backgroundColor: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              maxHeight: '160px',
              overflowY: 'auto',
              zIndex: 100,
            }}>
              {filteredVendors.map((v, idx) => (
                <div
                  key={v.id}
                  onClick={() => handleVendorSelect(v)}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: idx === highlightIndex ? '#eef2ff' : 'white',
                    borderBottom: idx < filteredVendors.length - 1 ? '1px solid #f3f4f6' : 'none',
                    fontSize: '12px',
                  }}
                >
                  <span style={{ color: '#374151', fontWeight: 500 }}>{v.companyName}</span>
                  <span style={{ color: '#9ca3af', fontSize: '10px' }}>#{v.entityId}</span>
                </div>
              ))}
              {filteredVendors.length === 30 && (
                <div style={{ padding: '6px 12px', fontSize: '10px', color: '#9ca3af', textAlign: 'center', borderTop: '1px solid #f3f4f6' }}>
                  Type more to narrow results...
                </div>
              )}
            </div>
          )}
          {showVendorDropdown && !selectedVendor && vendorSearch.length >= 1 && filteredVendors.length === 0 && !vendorsLoading && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              backgroundColor: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              padding: '10px 12px',
              fontSize: '12px',
              color: '#9ca3af',
              zIndex: 100,
            }}>
              No vendors match "{vendorSearch}"
            </div>
          )}
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={styles.label}>Amount *</label>
          <input
            type="text"
            placeholder="e.g., 150.00"
            value={manualForm.amount}
            onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
            style={styles.input}
            required
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={styles.label}>Notes</label>
          <input
            type="text"
            placeholder="Optional notes"
            value={manualForm.notes}
            onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
            style={styles.input}
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={styles.label}>Attachments</label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              border: '1px dashed #d1d5db',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              color: '#667eea',
              backgroundColor: '#f9fafb',
            }}
          >
            <span>📎 Add files (PDF, images, docs — max 10MB)</span>
            <input
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </label>
          {selectedFiles.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              {selectedFiles.map((file, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '4px 8px',
                    backgroundColor: '#f3f4f6',
                    borderRadius: '4px',
                    marginBottom: '4px',
                    fontSize: '11px',
                  }}
                >
                  <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {file.name} ({(file.size / 1024).toFixed(0)}KB)
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {uploadProgress && (
            <div style={{ fontSize: '11px', color: '#667eea', marginTop: '4px' }}>{uploadProgress}</div>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !isAuthenticated}
          style={{
            ...styles.btn('primary'),
            opacity: isSubmitting || !isAuthenticated ? 0.7 : 1,
            cursor: isSubmitting || !isAuthenticated ? 'not-allowed' : 'pointer',
          }}
        >
          {isSubmitting ? 'Submitting...' : 'Submit TFA Record'}
        </button>

        {!isAuthenticated && (
          <div style={{ fontSize: '11px', color: '#9ca3af', textAlign: 'center', marginTop: '8px' }}>
            Please sign in to submit TFA records
          </div>
        )}
      </div>
    </form>
  );
};

export default ManualTFATab;
