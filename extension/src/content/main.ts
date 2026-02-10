// API URL is inlined at build time via Vite define
declare const __API_URL__: string;
const API_URL = __API_URL__;

// Make this file a module (required for declare global)
export {};

// Prevent duplicate script execution
declare global {
  interface Window {
    __tfaLoggerInitialized?: boolean;
    __tfaModalOpen?: boolean;
    __tfaAuthToken?: string;
  }
}

interface CaptureLog {
  timestamp: string;
  status: 'success' | 'error';
  url: string;
  fieldCount: number;
  clientId?: string;
}

interface Stats {
  totalCaptures: number;
  successfulCaptures: number;
  lastCaptureTime: string | null;
  recentLogs: CaptureLog[];
}

interface CapturePayload {
  user_id: string;
  source_url: string;
  captured_at_utc: string;
  form_data: Record<string, any>;
}

// ============ AUTH ============
async function getAuthToken(): Promise<string | null> {
  if (window.__tfaAuthToken) return window.__tfaAuthToken;
  
  if (typeof chrome !== 'undefined' && chrome.storage) {
    try {
      const result = await chrome.storage.local.get(['authToken']);
      if (result.authToken) {
        window.__tfaAuthToken = result.authToken;
        return result.authToken;
      }
    } catch (error) {
      console.error('[TFA Logger] Failed to get auth token:', error);
    }
  }
  return null;
}

// ============ UI HELPERS ============
function injectStyles() {
  if (document.getElementById('tfa-logger-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'tfa-logger-styles';
  style.textContent = `
    @keyframes tfaFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes tfaSlideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes tfaSlideIn {
      from { transform: translateX(400px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes tfaSlideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
    .tfa-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      animation: tfaFadeIn 0.2s ease-out;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .tfa-modal {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      width: 420px;
      max-width: 90vw;
      animation: tfaSlideUp 0.3s ease-out;
      overflow: hidden;
    }
    .tfa-modal-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px 24px;
      color: white;
    }
    .tfa-modal-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 4px 0;
    }
    .tfa-modal-subtitle {
      font-size: 13px;
      opacity: 0.9;
      margin: 0;
    }
    .tfa-modal-body {
      padding: 20px 24px;
    }
    .tfa-field-list {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .tfa-field-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e9ecef;
      font-size: 14px;
    }
    .tfa-field-row:last-child {
      border-bottom: none;
    }
    .tfa-field-label {
      color: #6b7280;
      font-weight: 500;
    }
    .tfa-field-value {
      color: #1f2937;
      font-weight: 600;
      text-align: right;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tfa-field-value.amount {
      color: #059669;
      font-size: 16px;
    }
    .tfa-modal-footer {
      display: flex;
      gap: 12px;
      padding: 16px 24px 24px;
    }
    .tfa-btn {
      flex: 1;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .tfa-btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .tfa-btn-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    .tfa-btn-secondary {
      background: #f3f4f6;
      color: #4b5563;
      border: 1px solid #e5e7eb;
    }
    .tfa-btn-secondary:hover {
      background: #e5e7eb;
    }
    .tfa-toast {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      font-weight: 500;
      z-index: 999999;
      animation: tfaSlideIn 0.3s ease-out;
      max-width: 300px;
    }
    .tfa-toast.success {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .tfa-toast.error {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: white;
    }
    .tfa-toast.closing {
      animation: tfaSlideOut 0.3s ease-in;
    }
    .tfa-warning {
      background: #fef3c7;
      border: 1px solid #fcd34d;
      border-radius: 6px;
      padding: 12px;
      font-size: 13px;
      color: #92400e;
      margin-bottom: 16px;
    }
  `;
  document.head.appendChild(style);
}

function showToast(message: string, type: 'success' | 'error' = 'success') {
  injectStyles();
  
  const toast = document.createElement('div');
  toast.className = `tfa-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('closing');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============ STATS ============
function updateStats(success: boolean, fieldCount: number, clientId?: string) {
  if (typeof chrome === 'undefined' || !chrome.storage) return;

  try {
    chrome.storage.local.get(['captureStats'], (result) => {
      const stats: Stats = result.captureStats || {
        totalCaptures: 0,
        successfulCaptures: 0,
        lastCaptureTime: null,
        recentLogs: [],
      };

      stats.totalCaptures++;
      if (success) stats.successfulCaptures++;
      stats.lastCaptureTime = new Date().toISOString();
      
      const log: CaptureLog = {
        timestamp: stats.lastCaptureTime,
        status: success ? 'success' : 'error',
        url: window.location.href,
        fieldCount,
        clientId,
      };
      
      stats.recentLogs.unshift(log);
      if (stats.recentLogs.length > 10) stats.recentLogs = stats.recentLogs.slice(0, 10);

      chrome.storage.local.set({ captureStats: stats });
      chrome.runtime.sendMessage({ type: 'CAPTURE_UPDATE', stats }).catch(() => {});
    });
  } catch (error) {
    console.log('[TFA Logger] Error updating stats:', error);
  }
}

// ============ FORM DATA CAPTURE ============
function captureFormData(): Record<string, any> {
  const formData: Record<string, any> = {};

  // Extract client ID from URL first
  const urlMatch = window.location.href.match(/clientId=(\d+)/);
  if (urlMatch) {
    formData['client_id'] = urlMatch[1];
    console.log(`[TFA Logger] 👤 Client ID from URL: ${urlMatch[1]}`);
  }

  // Capture all input fields
  document.querySelectorAll('input').forEach((input) => {
    const name = input.name || input.id || input.getAttribute('aria-label');
    if (!name) return;

    if (input.type === 'checkbox' || input.type === 'radio') {
      formData[name] = input.checked ? input.value : null;
    } else if (input.type !== 'password') {
      formData[name] = input.value;
    }
  });

  // Capture all select dropdowns
  document.querySelectorAll('select').forEach((select) => {
    const name = select.name || select.id || select.getAttribute('aria-label');
    if (!name) return;

    if (select.multiple) {
      const selected = Array.from(select.selectedOptions).map(opt => ({
        value: opt.value,
        text: opt.textContent?.trim()
      }));
      formData[name] = selected;
    } else {
      const selectedOption = select.selectedOptions[0];
      formData[name] = {
        value: select.value,
        text: selectedOption?.textContent?.trim()
      };
    }
  });

  // Capture all textareas
  document.querySelectorAll('textarea').forEach((textarea) => {
    const name = textarea.name || textarea.id || textarea.getAttribute('aria-label');
    if (!name) return;
    formData[name] = textarea.value;
  });

  // SPECIAL: Capture Vendor from display text
  document.querySelectorAll('div.sp5-Font-Std, table[id^="gwt-uid"]').forEach((element) => {
    const text = element.textContent?.trim();
    if (text === 'Vendor') {
      const row = element.closest('tr');
      if (row) {
        const allDivs = row.querySelectorAll('div.gwt-HTML, div.gwt-Label');
        allDivs.forEach((div) => {
          const vendorText = div.textContent?.trim();
          if (vendorText && 
              vendorText !== 'Vendor' && 
              vendorText !== 'Please Select a Vendor' &&
              vendorText.length > 3) {
            formData['vendor'] = vendorText;
          }
        });
      }
    }
  });

  // SPECIAL: Capture Vendor's Client Account Number and Name on Bill
  document.querySelectorAll('div.sp5-Font-Std').forEach((label) => {
    const labelText = label.textContent?.trim();
    if (labelText === "Vendor's Client Account Number" || labelText === "Name on Bill") {
      const inputElement = label.closest('tr')?.querySelector('input[type="text"]');
      if (inputElement instanceof HTMLInputElement && inputElement.value) {
        const fieldName = labelText === "Vendor's Client Account Number" 
          ? 'vendor_client_account_number' 
          : 'name_on_bill';
        formData[fieldName] = inputElement.value;
      }
    }
  });

  // SPECIAL: Capture Service Costs section
  const serviceCostsHeaders = document.querySelectorAll('span.sp5-groupbox-legend');
  serviceCostsHeaders.forEach((header) => {
    if (header.textContent?.trim() === 'Service Costs') {
      const container = header.closest('.sp5-groupbox, .clientpt-groupbox, div, fieldset');
      if (container) {
        const textInputs: HTMLInputElement[] = [];
        container.querySelectorAll('input[type="text"]').forEach((element) => {
          const el = element as HTMLInputElement;
          if (el.value && el.value.trim() !== '') {
            textInputs.push(el);
          }
        });
        
        if (textInputs.length >= 1) {
          formData['service_cost_unit_number'] = textInputs[0].value;
        }
        if (textInputs.length >= 2) {
          formData['service_cost_amount'] = textInputs[1].value;
        }
      }
    }
  });

  // Try to get client name from page header
  const clientPatterns = [
    /Client\s*-\s*\((\d+)\)\s*(.+)/i,
    /Client\s*#?\s*:\s*\((\d+)\)\s*(.+)/i,
  ];
  
  const clientTextElements = document.querySelectorAll('h1, h2, h3, .sp5-Font-Std, .gwt-HTML, .gwt-Label');
  for (const element of clientTextElements) {
    const text = element.textContent?.trim();
    if (!text) continue;
    for (const pattern of clientPatterns) {
      const match = text.match(pattern);
      if (match) {
        if (!formData['client_id']) formData['client_id'] = match[1];
        formData['client_name'] = match[2].trim();
        break;
      }
    }
    if (formData['client_name']) break;
  }

  console.log('[TFA Logger] 📋 Captured fields:', Object.keys(formData));
  return formData;
}

// ============ CONFIRMATION MODAL ============
function showConfirmationModal(formData: Record<string, any>): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.__tfaModalOpen) {
      resolve(false);
      return;
    }
    window.__tfaModalOpen = true;

    injectStyles();

    const clientId = formData['client_id'] || 'Unknown';
    const clientName = formData['client_name'] || formData['name_on_bill'] || 'Unknown';
    const vendor = formData['vendor'] || 'Not specified';
    const amount = formData['service_cost_amount'] || 'Not specified';

    const overlay = document.createElement('div');
    overlay.className = 'tfa-modal-overlay';
    overlay.innerHTML = `
      <div class="tfa-modal">
        <div class="tfa-modal-header">
          <h2 class="tfa-modal-title">Submit TFA Record?</h2>
          <p class="tfa-modal-subtitle">Review the captured service data</p>
        </div>
        <div class="tfa-modal-body">
          <div class="tfa-field-list">
            <div class="tfa-field-row">
              <span class="tfa-field-label">Client ID</span>
              <span class="tfa-field-value">${clientId}</span>
            </div>
            <div class="tfa-field-row">
              <span class="tfa-field-label">Client Name</span>
              <span class="tfa-field-value">${clientName}</span>
            </div>
            <div class="tfa-field-row">
              <span class="tfa-field-label">Vendor</span>
              <span class="tfa-field-value">${vendor}</span>
            </div>
            <div class="tfa-field-row">
              <span class="tfa-field-label">Amount</span>
              <span class="tfa-field-value amount">${amount !== 'Not specified' ? '$' + amount : amount}</span>
            </div>
          </div>
          <div class="tfa-warning">
            Click <strong>Yes, Submit TFA</strong> to save this service for TFA tracking, or <strong>Skip</strong> if this service should not be recorded for TFA.
          </div>
        </div>
        <div class="tfa-modal-footer">
          <button class="tfa-btn tfa-btn-secondary" id="tfa-skip-btn">Skip</button>
          <button class="tfa-btn tfa-btn-primary" id="tfa-submit-btn">Yes, Submit TFA</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cleanup = (result: boolean) => {
      window.__tfaModalOpen = false;
      overlay.remove();
      resolve(result);
    };

    document.getElementById('tfa-submit-btn')?.addEventListener('click', () => cleanup(true));
    document.getElementById('tfa-skip-btn')?.addEventListener('click', () => cleanup(false));
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });

    // Close on Escape key
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', handleKey);
        cleanup(false);
      }
    };
    document.addEventListener('keydown', handleKey);
  });
}

// ============ SUBMIT TO API ============
async function submitTFA(formData: Record<string, any>): Promise<boolean> {
  const token = await getAuthToken();
  
  if (!token) {
    showToast('⚠ Please sign in via the extension popup', 'error');
    return false;
  }

  const payload: CapturePayload = {
    user_id: 'unknown',
    source_url: window.location.href,
    captured_at_utc: new Date().toISOString(),
    form_data: formData,
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });

    if (response.ok) {
      const fieldCount = Object.keys(formData).length;
      showToast(`✓ TFA submitted successfully (${fieldCount} fields)`, 'success');
      updateStats(true, fieldCount, formData['client_id']);
      return true;
    } else if (response.status === 401) {
      showToast('⚠ Authentication failed - please sign in again', 'error');
      updateStats(false, Object.keys(formData).length);
      return false;
    } else if (response.status === 429) {
      showToast('⚠ Too many requests - please wait', 'error');
      return false;
    } else {
      showToast('⚠ Failed to submit TFA', 'error');
      updateStats(false, Object.keys(formData).length);
      return false;
    }
  } catch (error) {
    console.error('[TFA Logger] Submit error:', error);
    showToast('⚠ Network error - TFA not saved', 'error');
    updateStats(false, Object.keys(formData).length);
    return false;
  }
}

// ============ MAIN HANDLER ============
async function handleSaveAndExit() {
  console.log('[TFA Logger] Save & Exit clicked - capturing form data...');
  
  const formData = captureFormData();
  
  // Check if user is authenticated first
  const token = await getAuthToken();
  if (!token) {
    showToast('⚠ Sign in to submit TFA records', 'error');
    return;
  }

  // Show confirmation modal
  const shouldSubmit = await showConfirmationModal(formData);
  
  if (shouldSubmit) {
    await submitTFA(formData);
  } else {
    console.log('[TFA Logger] User skipped TFA submission');
  }
}

// ============ BUTTON DETECTION ============
// Only trigger TFA modal on "Save & Exit" - not "Save & Continue"
function isSaveAndExit(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === 'save & exit' || normalized === 'save and exit';
}

// ============ INITIALIZATION ============
if (window.__tfaLoggerInitialized) {
  console.log('[TFA Logger] Already initialized, skipping');
} else {
  window.__tfaLoggerInitialized = true;
  
  injectStyles();

  // Listen for Save & Exit button clicks only
  document.addEventListener('click', (event) => {
    let element = event.target as HTMLElement | null;

    while (element && element !== document.body) {
      // Check for role="button", actual <button>, or clickable elements
      const isButton = element.tagName === 'BUTTON' || 
                       element.getAttribute('role') === 'button' ||
                       element.classList.contains('gwt-Button') ||
                       element.hasAttribute('data-action');
      
      if (isButton) {
        const buttonText = element.textContent?.trim() || '';
        
        if (isSaveAndExit(buttonText)) {
          console.log(`[TFA Logger] ✓ Save & Exit detected: "${buttonText}"`);
          // Don't prevent default - let the save happen
          handleSaveAndExit();
          return;
        }
      }
      element = element.parentElement;
    }
  }, true);

  console.log('[TFA Logger] ✓ Initialized - listening for Save & Exit');
}
