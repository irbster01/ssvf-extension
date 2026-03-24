import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getValidToken, silentTokenRefresh } from '../auth/authService';
import { API_URL, API_BASE } from '../config';
import {
  NetSuiteVendor,
  ClientRecord,
  ReceiptAnalysisResult,
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
  clients: ClientRecord[];
  clientsLoading: boolean;
  stats: Stats;
  onStatsUpdate: (stats: Stats) => void;
  onAuthExpired: () => void;
}

const ManualTFATab: React.FC<ManualTFATabProps> = ({
  isAuthenticated,
  vendors,
  vendorsLoading,
  clients,
  clientsLoading,
  stats,
  onStatsUpdate,
  onAuthExpired,
}) => {
  const [manualForm, setManualForm] = useState<ManualTFAForm>(INITIAL_MANUAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // AI receipt analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());
  const [clientFilledFields, setClientFilledFields] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // Vendor autocomplete state
  const [vendorSearch, setVendorSearch] = useState('');
  const [selectedVendor, setSelectedVendor] = useState<NetSuiteVendor | null>(null);
  const [showVendorDropdown, setShowVendorDropdown] = useState(false);
  const [vendorHighlight, setVendorHighlight] = useState(-1);
  const vendorDropdownRef = useRef<HTMLDivElement>(null);
  const vendorInputRef = useRef<HTMLInputElement>(null);

  // Client autocomplete state
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<ClientRecord | null>(null);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [clientHighlight, setClientHighlight] = useState(-1);
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const clientInputRef = useRef<HTMLInputElement>(null);

  const filteredVendors = vendorSearch.length >= 1
    ? vendors.filter(v =>
        v.companyName.toLowerCase().includes(vendorSearch.toLowerCase()) ||
        v.entityId.toLowerCase().includes(vendorSearch.toLowerCase())
      ).slice(0, 30)
    : [];

  const filteredClients = clientSearch.length >= 1
    ? clients.filter(c =>
        c.clientName.toLowerCase().includes(clientSearch.toLowerCase()) ||
        c.id.includes(clientSearch)
      ).slice(0, 30)
    : [];

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (vendorDropdownRef.current && !vendorDropdownRef.current.contains(e.target as Node)) {
        setShowVendorDropdown(false);
      }
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // --- Vendor handlers ---
  const handleVendorSelect = (vendor: NetSuiteVendor) => {
    setSelectedVendor(vendor);
    setVendorSearch(vendor.companyName);
    setManualForm(prev => ({ ...prev, vendor: vendor.companyName }));
    setShowVendorDropdown(false);
    setVendorHighlight(-1);
  };

  const clearVendor = () => {
    setSelectedVendor(null);
    setVendorSearch('');
    setManualForm(prev => ({ ...prev, vendor: '' }));
    vendorInputRef.current?.focus();
  };

  const handleVendorKeyDown = (e: React.KeyboardEvent) => {
    if (!showVendorDropdown || filteredVendors.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setVendorHighlight(prev => Math.min(prev + 1, filteredVendors.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setVendorHighlight(prev => Math.max(prev - 1, 0)); }
    else if (e.key === 'Enter' && vendorHighlight >= 0) { e.preventDefault(); handleVendorSelect(filteredVendors[vendorHighlight]); }
    else if (e.key === 'Escape') { setShowVendorDropdown(false); }
  };

  // --- Client handlers ---
  const handleClientSelect = (client: ClientRecord) => {
    setSelectedClient(client);
    setClientSearch(client.clientName);
    const filled = new Set<string>();
    const updates: Partial<ManualTFAForm> = {
      clientId: client.id,
      clientName: client.clientName,
    };
    if (client.region) {
      updates.region = client.region as SSVFRegion;
      filled.add('region');
    }
    if (client.program) {
      updates.programCategory = client.program as ProgramCategory;
      filled.add('program');
    }
    setManualForm(prev => ({ ...prev, ...updates }));
    setClientFilledFields(filled);
    setShowClientDropdown(false);
    setClientHighlight(-1);
  };

  const clearClient = () => {
    setSelectedClient(null);
    setClientSearch('');
    setManualForm(prev => ({ ...prev, clientId: '', clientName: '' }));
    setClientFilledFields(new Set());
    clientInputRef.current?.focus();
  };

  const handleClientKeyDown = (e: React.KeyboardEvent) => {
    if (!showClientDropdown || filteredClients.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setClientHighlight(prev => Math.min(prev + 1, filteredClients.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setClientHighlight(prev => Math.max(prev - 1, 0)); }
    else if (e.key === 'Enter' && clientHighlight >= 0) { e.preventDefault(); handleClientSelect(filteredClients[clientHighlight]); }
    else if (e.key === 'Escape') { setShowClientDropdown(false); }
  };

  // --- File / AI helpers ---
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

  const triggerAnalysis = useCallback(async (file: File) => {
    setAnalyzing(true);
    setAiFilledFields(new Set());
    try {
      const token = await getValidToken();
      if (!token) return;

      const base64 = await fileToBase64(file);
      const response = await fetch(`${API_BASE}/receipts/analyze`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          data: base64,
        }),
      });

      if (!response.ok) return;
      const result: ReceiptAnalysisResult = await response.json();
      if (!result.success) return;

      const filled = new Set<string>();

      // Vendor — fuzzy match against loaded vendor list
      if (result.vendorName && (result.confidence.vendorName ?? 0) > 0.5) {
        const name = result.vendorName;
        const exact = vendors.find(v => v.companyName.toLowerCase() === name.toLowerCase());
        const partial = vendors.find(v =>
          v.companyName.toLowerCase().includes(name.toLowerCase()) ||
          name.toLowerCase().includes(v.companyName.toLowerCase())
        );
        const firstWord = vendors.find(v =>
          v.companyName.toLowerCase().split(/\s+/)[0] === name.toLowerCase().split(/\s+/)[0]
        );
        const match = exact || partial || firstWord;
        if (match) {
          setSelectedVendor(match);
          setVendorSearch(match.companyName);
          setManualForm(prev => ({ ...prev, vendor: match.companyName }));
        } else {
          setVendorSearch(name);
          setManualForm(prev => ({ ...prev, vendor: name }));
        }
        filled.add('vendor');
      }

      // Amount
      if (result.amount != null && (result.confidence.amount ?? 0) > 0.5) {
        setManualForm(prev => ({ ...prev, amount: result.amount!.toFixed(2) }));
        filled.add('amount');
      }

      // Date
      if (result.date && (result.confidence.date ?? 0) > 0.5) {
        setManualForm(prev => ({ ...prev, tfaDate: result.date! }));
        filled.add('date');
      }

      // Assistance type (keyword inference)
      if (result.assistanceType) {
        setManualForm(prev => ({ ...prev, assistanceType: result.assistanceType as FinancialAssistanceType }));
        filled.add('assistanceType');
      }

      // Client match (from OCR text matched against client database)
      if (result.clientMatch && result.clientMatch.confidence >= 0.7) {
        const matched = clients.find(c => c.id === result.clientMatch!.clientId);
        if (matched) {
          setSelectedClient(matched);
          setClientSearch(matched.clientName);
        } else {
          setClientSearch(result.clientMatch.clientName);
        }
        setManualForm(prev => ({
          ...prev,
          clientId: result.clientMatch!.clientId,
          clientName: result.clientMatch!.clientName,
          ...(result.clientMatch!.program ? { programCategory: result.clientMatch!.program as ProgramCategory } : {}),
        }));
        filled.add('clientId');
        filled.add('clientName');
        if (result.clientMatch!.program) filled.add('programCategory');
      }

      // Region — prefer client-seeded region over address inference
      const inferredRegion = result.clientMatch?.region || result.region;
      if (inferredRegion) {
        setManualForm(prev => ({ ...prev, region: inferredRegion as SSVFRegion }));
        filled.add('region');
      }

      setAiFilledFields(filled);
    } catch (err) {
      console.warn('[AnalyzeReceipt] Analysis failed:', err);
    } finally {
      setAnalyzing(false);
    }
  }, [vendors, clients]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const maxSize = 10 * 1024 * 1024;
    const validFiles = files.filter(f => f.size <= maxSize);
    if (validFiles.length < files.length) {
      setSubmitMessage({ type: 'error', text: 'Some files were too large (max 10MB each)' });
    }
    // Trigger AI analysis on first file if none attached yet
    if (selectedFiles.length === 0 && validFiles.length > 0) {
      triggerAnalysis(validFiles[0]);
    }
    setSelectedFiles(prev => [...prev, ...validFiles]);
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

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
    if (selectedFiles.length === 0 && valid.length > 0) {
      triggerAnalysis(valid[0]);
    }
    setSelectedFiles(prev => [...prev, ...valid]);
  }, [triggerAnalysis, selectedFiles.length]);

  const resetForm = () => {
    setManualForm(INITIAL_MANUAL_FORM);
    setSelectedFiles([]);
    setSelectedVendor(null);
    setVendorSearch('');
    setSelectedClient(null);
    setClientSearch('');
    setAiFilledFields(new Set());
    setClientFilledFields(new Set());
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
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        const newToken = await silentTokenRefresh();
        if (newToken) {
          token = newToken;
          response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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

        // Upload attachments
        if (selectedFiles.length > 0 && submissionId) {
          setUploadProgress(`Uploading ${selectedFiles.length} file(s)...`);
          for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            setUploadProgress(`Uploading ${i + 1}/${selectedFiles.length}: ${file.name}`);
            try {
              const base64 = await fileToBase64(file);
              await fetch(`${API_BASE}/submissions/${submissionId}/attachments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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
        resetForm();

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

  // --- AI Badge helper ---
  const AiBadge: React.FC = () => (
    <span style={{
      display: 'inline-block', fontSize: '8px', fontWeight: 700,
      padding: '1px 5px', borderRadius: '6px',
      background: 'linear-gradient(135deg, #667eea, #764ba2)',
      color: 'white', marginLeft: '5px', verticalAlign: 'middle',
      letterSpacing: '0.04em',
    }}>AI</span>
  );

  const ClientBadge: React.FC = () => (
    <span style={{
      display: 'inline-block', fontSize: '8px', fontWeight: 700,
      padding: '1px 5px', borderRadius: '6px',
      background: '#43a047',
      color: 'white', marginLeft: '5px', verticalAlign: 'middle',
      letterSpacing: '0.04em',
    }}>AUTO</span>
  );

  // --- Dropdown styles ---
  const dropdownStyle: React.CSSProperties = {
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
  };

  return (
    <form onSubmit={handleManualSubmit}>
      {submitMessage && <div style={styles.message(submitMessage.type)}>{submitMessage.text}</div>}

      <div style={styles.card}>

        {/* Receipt / Invoice — AI auto-fill */}
        <div style={{ marginBottom: '12px' }}>
          <label style={styles.label}>
            Receipt / Invoice
            <span style={{ fontSize: '9px', color: '#667eea', fontWeight: 500, marginLeft: '6px' }}>AI fills your form</span>
          </label>
          <div
            ref={dropRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !analyzing && document.getElementById('ext-file-input')?.click()}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: analyzing ? '12px' : '10px 12px',
              border: `1px dashed ${dragging ? '#667eea' : '#d1d5db'}`,
              borderRadius: '6px',
              cursor: analyzing ? 'wait' : 'pointer',
              fontSize: '12px',
              color: dragging ? '#667eea' : '#6b7280',
              backgroundColor: dragging ? '#eef2ff' : '#f9fafb',
              transition: 'all 0.15s',
            }}
          >
            <input
              id="ext-file-input"
              type="file"
              multiple
              accept="image/*,.pdf"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            {analyzing ? (
              <>
                <span style={{
                  width: '14px', height: '14px', border: '2px solid #667eea',
                  borderTopColor: 'transparent', borderRadius: '50%',
                  display: 'inline-block', animation: 'spin 0.8s linear infinite',
                }} />
                <span style={{ color: '#667eea', fontWeight: 500 }}>Analyzing receipt...</span>
              </>
            ) : (
              <span>📄 Drop receipt or click to browse</span>
            )}
          </div>
          {selectedFiles.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              {selectedFiles.map((file, idx) => (
                <div key={idx} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '4px 8px', backgroundColor: '#f3f4f6', borderRadius: '4px',
                  marginBottom: '4px', fontSize: '11px',
                }}>
                  <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {file.name} ({(file.size / 1024).toFixed(0)}KB)
                  </span>
                  <button type="button" onClick={() => removeFile(idx)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}>
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

        {/* AI filled banner */}
        {!analyzing && (aiFilledFields.size > 0 || clientFilledFields.size > 0) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 10px', marginBottom: '12px',
            backgroundColor: '#fef3c7', borderRadius: '6px',
            fontSize: '11px', color: '#92400e',
          }}>
            {aiFilledFields.size > 0 && (
              <>
                <span style={{
                  fontSize: '8px', fontWeight: 700, padding: '1px 5px', borderRadius: '6px',
                  background: 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white',
                }}>AI</span>
                {aiFilledFields.size} field{aiFilledFields.size > 1 ? 's' : ''}
              </>
            )}
            {aiFilledFields.size > 0 && clientFilledFields.size > 0 && <span>+</span>}
            {clientFilledFields.size > 0 && (
              <>
                <span style={{
                  fontSize: '8px', fontWeight: 700, padding: '1px 5px', borderRadius: '6px',
                  background: '#43a047', color: 'white',
                }}>AUTO</span>
                {clientFilledFields.size} from client
              </>
            )}
            <span style={{ marginLeft: '2px' }}>— review below</span>
          </div>
        )}

        {/* Client search — autocomplete */}
        <div style={{ marginBottom: '12px', position: 'relative' }} ref={clientDropdownRef}>
          <label style={styles.label}>Client *</label>
          {selectedClient ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '7px 10px', backgroundColor: '#e8f5e9',
              borderRadius: '6px', border: '1px solid #a5d6a7', fontSize: '12px',
            }}>
              <span style={{ flex: 1, fontWeight: 500, color: '#1f2937' }}>
                {selectedClient.clientName}
                <span style={{ color: '#6b7280', fontSize: '10px', marginLeft: '6px' }}>
                  ID: {selectedClient.id}
                </span>
              </span>
              <button type="button" onClick={clearClient}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#6b7280', padding: 0 }}>
                ✕
              </button>
            </div>
          ) : (
            <input
              ref={clientInputRef}
              type="text"
              placeholder={clientsLoading ? 'Loading clients...' : 'Search by name or ID...'}
              value={clientSearch}
              onChange={(e) => {
                setClientSearch(e.target.value);
                setSelectedClient(null);
                setManualForm(prev => ({ ...prev, clientName: e.target.value }));
                setShowClientDropdown(true);
                setClientHighlight(0);
              }}
              onFocus={() => clientSearch.length >= 1 && setShowClientDropdown(true)}
              onKeyDown={handleClientKeyDown}
              disabled={clientsLoading}
              autoComplete="off"
              style={styles.input}
              required
            />
          )}
          {showClientDropdown && !selectedClient && clientSearch.length > 0 && (
            <div style={dropdownStyle}>
              {filteredClients.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: '12px', color: '#9ca3af' }}>
                  No match — enter ID below
                </div>
              ) : (
                filteredClients.map((c, idx) => (
                  <div
                    key={c.id}
                    onClick={() => handleClientSelect(c)}
                    onMouseEnter={() => setClientHighlight(idx)}
                    style={{
                      padding: '8px 12px', cursor: 'pointer',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      backgroundColor: idx === clientHighlight ? '#eef2ff' : 'white',
                      borderBottom: idx < filteredClients.length - 1 ? '1px solid #f3f4f6' : 'none',
                      fontSize: '12px',
                    }}
                  >
                    <span style={{ color: '#374151', fontWeight: 500 }}>{c.clientName}</span>
                    <span style={{ color: '#9ca3af', fontSize: '10px', flexShrink: 0, marginLeft: '6px' }}>{c.id}</span>
                  </div>
                ))
              )}
              {filteredClients.length === 30 && (
                <div style={{ padding: '6px 12px', fontSize: '10px', color: '#9ca3af', textAlign: 'center', borderTop: '1px solid #f3f4f6' }}>
                  Type more to narrow results...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Client ID — manual fallback when no record selected */}
        {!selectedClient && (
          <div style={{ marginBottom: '12px' }}>
            <label style={styles.label}>Client ID *</label>
            <input
              type="text"
              placeholder="WellSky Client ID"
              value={manualForm.clientId}
              onChange={(e) => setManualForm({ ...manualForm, clientId: e.target.value })}
              style={styles.input}
              required
            />
          </div>
        )}

        {/* Date */}
        <div style={{ marginBottom: '12px' }}>
          <label style={styles.label}>
            TFA Date
            {aiFilledFields.has('date') && <AiBadge />}
          </label>
          <input
            type="date"
            value={manualForm.tfaDate}
            onChange={(e) => setManualForm({ ...manualForm, tfaDate: e.target.value })}
            style={styles.input}
          />
        </div>

        {/* Region + Program */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>
              Region *
              {aiFilledFields.has('region') && <AiBadge />}
              {clientFilledFields.has('region') && !aiFilledFields.has('region') && <ClientBadge />}
            </label>
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
            <label style={styles.label}>
              Program *
              {clientFilledFields.has('program') && <ClientBadge />}
            </label>
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

        {/* Vendor autocomplete */}
        <div style={{ marginBottom: '12px', position: 'relative' }} ref={vendorDropdownRef}>
          <label style={styles.label}>
            Vendor *
            {aiFilledFields.has('vendor') && <AiBadge />}
          </label>
          {selectedVendor ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '7px 10px', backgroundColor: '#e8f5e9',
              borderRadius: '6px', border: '1px solid #a5d6a7', fontSize: '12px',
            }}>
              <span style={{ flex: 1, fontWeight: 500, color: '#1f2937' }}>
                {selectedVendor.companyName}
                <span style={{ color: '#667eea', fontSize: '10px', marginLeft: '6px' }}>
                  NS #{selectedVendor.entityId}
                </span>
              </span>
              <button type="button" onClick={clearVendor}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#6b7280', padding: 0 }}>
                ✕
              </button>
            </div>
          ) : (
            <input
              ref={vendorInputRef}
              type="text"
              placeholder={vendorsLoading ? 'Loading vendors...' : 'Search vendors...'}
              value={vendorSearch}
              onChange={(e) => {
                setVendorSearch(e.target.value);
                setSelectedVendor(null);
                setManualForm(prev => ({ ...prev, vendor: e.target.value }));
                setShowVendorDropdown(true);
                setVendorHighlight(-1);
              }}
              onFocus={() => vendorSearch.length >= 1 && setShowVendorDropdown(true)}
              onKeyDown={handleVendorKeyDown}
              disabled={vendorsLoading}
              autoComplete="off"
              style={styles.input}
              required
            />
          )}
          {showVendorDropdown && !selectedVendor && filteredVendors.length > 0 && (
            <div style={dropdownStyle}>
              {filteredVendors.map((v, idx) => (
                <div
                  key={v.id}
                  onClick={() => handleVendorSelect(v)}
                  onMouseEnter={() => setVendorHighlight(idx)}
                  style={{
                    padding: '8px 12px', cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    backgroundColor: idx === vendorHighlight ? '#eef2ff' : 'white',
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
            <div style={dropdownStyle}>
              <div style={{ padding: '10px 12px', fontSize: '12px', color: '#9ca3af' }}>
                No vendors match "{vendorSearch}"
              </div>
            </div>
          )}
        </div>

        {/* Assistance Type */}
        <div style={{ marginBottom: '12px' }}>
          <label style={styles.label}>
            Assistance Type *
            {aiFilledFields.has('assistanceType') && <AiBadge />}
          </label>
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

        {/* Amount */}
        <div style={{ marginBottom: '12px' }}>
          <label style={styles.label}>
            Amount *
            {aiFilledFields.has('amount') && <AiBadge />}
          </label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={manualForm.amount}
            onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
            style={styles.input}
            required
          />
        </div>

        {/* Notes */}
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

      {/* Inline keyframe for spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </form>
  );
};

export default ManualTFATab;
