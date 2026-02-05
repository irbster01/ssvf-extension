import { API_URL } from '../config';

// Prevent duplicate script execution - this is the PROPER way to handle Chrome injecting scripts multiple times
declare global {
  interface Window {
    __serviceLoggerInitialized?: boolean;
    __serviceLoggerCaptured?: boolean;
    __serviceLoggerToken?: string;
  }
}

interface CaptureLog {
  timestamp: string;
  status: 'success' | 'error';
  url: string;
  fieldCount: number;
}

interface Stats {
  totalCaptures: number;
  successfulCaptures: number;
  lastCaptureTime: string | null;
  recentLogs: CaptureLog[];
}

// Get authentication token from storage
async function getAuthToken(): Promise<string | null> {
  // Check memory cache first
  if (window.__serviceLoggerToken) {
    return window.__serviceLoggerToken;
  }
  
  // Try to get from chrome storage
  if (typeof chrome !== 'undefined' && chrome.storage) {
    try {
      const result = await chrome.storage.local.get(['authToken']);
      if (result.authToken) {
        window.__serviceLoggerToken = result.authToken;
        return result.authToken;
      }
    } catch (error) {
      console.error('[Service Logger] Failed to get auth token:', error);
    }
  }
  
  return null;
}

function showToast(message: string, type: 'success' | 'error' = 'success') {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 24px;
    background: ${type === 'success' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'};
    color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    font-weight: 500;
    z-index: 999999;
    animation: slideIn 0.3s ease-out;
    max-width: 300px;
  `;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(400px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function updateStats(success: boolean, fieldCount: number) {
  // Check if chrome.storage is available (it might not be in all contexts)
  if (typeof chrome === 'undefined' || !chrome.storage) {
    return;
  }

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
      };
      
      stats.recentLogs.unshift(log);
      if (stats.recentLogs.length > 10) stats.recentLogs = stats.recentLogs.slice(0, 10);

      chrome.storage.local.set({ captureStats: stats });
      
      // Notify popup if it's open
      chrome.runtime.sendMessage({
        type: 'CAPTURE_UPDATE',
        stats,
      }).catch(() => {});
    });
  } catch (error) {
    console.log('[Service Logger] Error updating stats:', error);
  }
}

if (window.__serviceLoggerInitialized) {
  console.log('[Service Logger] Script already initialized, skipping duplicate injection');
} else {
  window.__serviceLoggerInitialized = true;
  window.__serviceLoggerCaptured = false;
  
  // Debug: Check auth state on load
  getAuthToken().then(token => {
    console.log('[Service Logger] Init - Auth token present:', token ? 'Yes' : 'No');
  });

  interface CapturePayload {
    user_id: string;
    source_url: string;
    captured_at_utc: string;
    form_data: Record<string, any>;
  }

  function captureFormData(): Record<string, any> {
    const formData: Record<string, any> = {};

    // Capture all input fields
    document.querySelectorAll('input').forEach((input) => {
      const name = input.name || input.id || input.getAttribute('aria-label');
      if (!name) return;

      if (input.type === 'checkbox' || input.type === 'radio') {
        formData[name] = input.checked ? input.value : null;
      } else if (input.type !== 'password') { // Skip passwords for security
        formData[name] = input.value;
      }
    });

    // Capture all select dropdowns (only selected values)
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

    // Capture elements with contenteditable (rich text editors)
    document.querySelectorAll('[contenteditable="true"]').forEach((element) => {
      const name = element.id || element.getAttribute('aria-label');
      if (!name) return;
      formData[name] = element.textContent?.trim();
    });

    // Capture custom ARIA-based inputs (common in modern web apps)
    document.querySelectorAll('[role="textbox"], [role="combobox"], [role="spinbutton"]').forEach((element) => {
      const name = element.id || element.getAttribute('aria-label') || element.getAttribute('name');
      if (!name) return;
      
      const value = (element as HTMLElement).textContent?.trim() || 
                    element.getAttribute('aria-valuenow') ||
                    element.getAttribute('value');
      
      if (value) {
        formData[name] = value;
      }
    });

    // SPECIAL: Capture Vendor information
    // Vendor is selected from a picker and displayed as text (not an input)
    console.log('[Service Logger] 🏢 Searching for vendor field...');
    
    // Look for "Vendor" label and find the associated display value
    document.querySelectorAll('div.sp5-Font-Std, table[id^="gwt-uid"]').forEach((element) => {
      const text = element.textContent?.trim();
      if (text === 'Vendor') {
        // Found the Vendor label, now find the value in the same row
        const row = element.closest('tr');
        if (row) {
          // Look for gwt-HTML display element showing the selected vendor
          const allDivs = row.querySelectorAll('div.gwt-HTML, div.gwt-Label');
          allDivs.forEach((div) => {
            const vendorText = div.textContent?.trim();
            console.log(`[Service Logger] 🏢 Checking vendor div: "${vendorText}"`);
            // Skip if it's the label itself, empty, or placeholder text
            if (vendorText && 
                vendorText !== 'Vendor' && 
                vendorText !== 'Please Select a Vendor' &&
                vendorText.length > 3) {
              formData['vendor'] = vendorText;
              console.log(`[Service Logger] 🏢 ✅ Vendor captured: ${vendorText}`);
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
          console.log(`[Service Logger] 🏢 ${labelText}: ${inputElement.value}`);
        }
      }
    });

    // SPECIAL: Capture all fields within "Service Costs" section
    // Look for the groupbox with "Service Costs" label
    const serviceCostsHeaders = document.querySelectorAll('span.sp5-groupbox-legend');
    serviceCostsHeaders.forEach((header) => {
      if (header.textContent?.trim() === 'Service Costs') {
        console.log('[Service Logger] 💰 Found Service Costs section!');
        
        // Get the parent container
        const container = header.closest('.sp5-groupbox, .clientpt-groupbox, div, fieldset');
        if (container) {
          console.log('[Service Logger] 💰 Service Costs container found, searching for fields...');
          
          // Collect all text inputs (skip selects and empty fields)
          const textInputs: HTMLInputElement[] = [];
          container.querySelectorAll('input[type="text"]').forEach((element) => {
            const el = element as HTMLInputElement;
            if (el.value && el.value.trim() !== '') {
              textInputs.push(el);
            }
          });
          
          // Map by position: first text input = unit number, second = cost amount
          if (textInputs.length >= 1) {
            formData['service_cost_unit_number'] = textInputs[0].value;
            console.log(`[Service Logger] 💰 Service Cost Unit Number: ${textInputs[0].value}`);
          }
          
          if (textInputs.length >= 2) {
            formData['service_cost_amount'] = textInputs[1].value;
            console.log(`[Service Logger] 💰 Service Cost Amount: ${textInputs[1].value}`);
          }
          
          if (textInputs.length > 2) {
            // Capture any additional fields with indexed names
            for (let i = 2; i < textInputs.length; i++) {
              formData[`service_cost_field_${i + 1}`] = textInputs[i].value;
              console.log(`[Service Logger] 💰 Additional Service Cost Field ${i + 1}: ${textInputs[i].value}`);
            }
          }
        }
      }
    });

    // SPECIAL: Look for "Service Costs" field specifically
    // Try multiple selectors to find it
    const serviceCostsSelectors = [
      'input[name*="service"][name*="cost" i]',
      'input[id*="service"][id*="cost" i]',
      'input[aria-label*="service"][aria-label*="cost" i]',
      'input[placeholder*="service"][placeholder*="cost" i]',
      'textarea[name*="service"][name*="cost" i]',
      'textarea[id*="service"][id*="cost" i]',
      '[role="textbox"][aria-label*="service costs" i]',
      '[contenteditable="true"][aria-label*="service costs" i]'
    ];

    serviceCostsSelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach((element) => {
          const name = (element as HTMLElement).getAttribute('name') || 
                       (element as HTMLElement).getAttribute('id') || 
                       (element as HTMLElement).getAttribute('aria-label') ||
                       'service_costs';
          
          let value = '';
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            value = element.value;
          } else {
            value = (element as HTMLElement).textContent?.trim() || '';
          }
          
          if (value) {
            formData[name] = value;
            console.log(`[Service Logger] 💰 Found Service Costs: ${name} = ${value}`);
          }
        });
      } catch (e) {
        // Ignore selector errors
      }
    });

    // Log all captured fields for debugging
    console.log('[Service Logger] 📋 Captured fields:', Object.keys(formData));
    console.log('[Service Logger] 🔍 Looking for service costs...');
    
    // DEBUG: Log ALL input fields to help find service costs
    console.log('[Service Logger] 🔍 ALL INPUT FIELDS ON PAGE:');
    document.querySelectorAll('input, textarea').forEach((element) => {
      const el = element as HTMLInputElement | HTMLTextAreaElement;
      const label = el.labels?.[0]?.textContent?.trim() || 
                    el.getAttribute('aria-label') || 
                    el.getAttribute('placeholder') ||
                    el.name || 
                    el.id ||
                    'unknown';
      if (el.value) {
        console.log(`  🔸 ${label}: "${el.value}" (name="${el.name}", id="${el.id}", type="${el.type}")`);
      }
    });
    
    return formData;
  }

  function captureAndSendData(): void {
    // Check global flag to prevent any duplicates across all script injections
    if (window.__serviceLoggerCaptured) {
      return;
    }

    window.__serviceLoggerCaptured = true;

    // Reset flag after 15 seconds to allow another capture
    setTimeout(() => {
      window.__serviceLoggerCaptured = false;
    }, 15000);

    try {
      const payload: CapturePayload = {
        user_id: 'unknown', // Will be replaced by server with authenticated user ID
        source_url: window.location.href,
        captured_at_utc: new Date().toISOString(),
        form_data: captureFormData(),
      };

      const fieldCount = Object.keys(payload.form_data).length;

      // Get auth token before sending
      getAuthToken().then(token => {
        console.log('[Service Logger] Token retrieved:', token ? `Yes (${token.length} chars, starts with ${token.substring(0, 20)}...)` : 'No token');
        
        if (!token) {
          showToast('⚠ Please authenticate in extension popup', 'error');
          updateStats(false, fieldCount);
          return;
        }

        // Show pending notification before sending
        showToast(`📤 Submitting service data for TFA tracking...`, 'success');
        
        fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          keepalive: true,
        })
          .then((response) => {
            if (response.ok) {
              showToast(`✓ Service saved & submitted for TFA (${fieldCount} fields)`, 'success');
              updateStats(true, fieldCount);
            } else if (response.status === 401) {
              console.error('[Service Logger] 401 Unauthorized - Token was rejected by API');
              // DON'T sign out - just show error. Token might still be valid, API issue.
              showToast('⚠ API authentication failed - please try again', 'error');
              updateStats(false, fieldCount);
            } else if (response.status === 429) {
              showToast('⚠ Too many requests - please wait', 'error');
              updateStats(false, fieldCount);
            } else {
              showToast('⚠ Failed to save service data', 'error');
              updateStats(false, fieldCount);
            }
          })
          .catch(() => {
            showToast('⚠ Network error - data not saved', 'error');
            updateStats(false, fieldCount);
          });
      });
    } catch {
      // Silent error - don't expose details
    }
  }

  // Single event listener using event delegation
  document.addEventListener(
    'click',
    (event) => {
      let element = event.target as HTMLElement | null;

      // Walk up DOM to find button
      while (element && element !== document.body) {
        if (element.getAttribute('role') === 'button') {
          const buttonText = element.textContent?.trim() || '';
          
          // Log ALL button clicks to debug
          console.log(`[Service Logger] Button clicked with text: "${buttonText}" (length: ${buttonText.length})`);

          // STRICT check - must be EXACTLY "Save & Exit" with no extra characters
          if (buttonText === 'Save & Exit') {
            console.log('[Service Logger] ✓ EXACT MATCH for "Save & Exit" - capturing data');
            // Don't stop propagation - let the button work normally
            captureAndSendData();
            return;
          } else if (buttonText.includes('Save & Exit')) {
            console.log(`[Service Logger] ⚠ Contains "Save & Exit" but not exact: "${buttonText}"`);
            return;
          } else if (buttonText.includes('Save')) {
            console.log(`[Service Logger] ✗ Contains "Save" but is "${buttonText}" - NOT capturing`);
            return;
          } else {
            console.log(`[Service Logger] ✗ Unrelated button: "${buttonText}"`);
            return;
          }
        }
        element = element.parentElement;
      }
    },
    true // Capture phase
  );

  console.log('[Service Logger] Initialized and listening for "Save & Exit" button');
}
