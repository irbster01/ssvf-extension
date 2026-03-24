// Background service worker for SSVF Chrome Extension
// Handles SignalR real-time message notifications and badge updates

import { API_BASE } from '../config';

/** Fetch a valid auth token from storage, or null. */
async function getStoredToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['authToken'], (result) => {
      if (!result.authToken) {
        resolve(null);
        return;
      }
      // Basic expiry check
      try {
        const parts = result.authToken.split('.');
        if (parts.length !== 3) { resolve(null); return; }
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (!payload.exp || payload.exp * 1000 < Date.now()) {
          resolve(null);
          return;
        }
        resolve(result.authToken);
      } catch {
        resolve(null);
      }
    });
  });
}

/** Fetch unread count from API and update badge. */
async function refreshUnreadBadge(): Promise<void> {
  try {
    const token = await getStoredToken();
    if (!token) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }

    const response = await fetch(`${API_BASE}/messages/unread-count`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }

    const data = await response.json();
    const total: number = data.totalUnread || 0;

    if (total > 0) {
      chrome.action.setBadgeText({ text: total > 99 ? '99+' : String(total) });
      chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }

    // Store per-submission counts so the popup can use them
    await chrome.storage.local.set({ unreadCounts: data.perSubmission || {} });
  } catch (err) {
    console.warn('[Background] Failed to refresh unread badge:', err);
  }
}

// --- SignalR polling fallback ---
// In a Manifest V3 service worker we can't maintain a persistent WebSocket.
// Instead we poll for unread counts on a schedule and on certain events.

// Poll every 2 minutes when the service worker is alive
const POLL_INTERVAL_MS = 60 * 1000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
  if (pollTimer) return;
  refreshUnreadBadge();
  pollTimer = setInterval(refreshUnreadBadge, POLL_INTERVAL_MS);
  console.info('[Background] Polling started');
}

// Start polling on install/startup
chrome.runtime.onInstalled.addListener(() => {
  console.info('[Background] Extension installed/updated');
  refreshUnreadBadge();
  startPolling();
});

chrome.runtime.onStartup.addListener(() => {
  startPolling();
});

// Also refresh when storage changes (e.g., user signs in)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.authToken) {
    refreshUnreadBadge();
    startPolling();
  }
});

// Open popup as a persistent window instead of default popup (which closes on focus loss)
const POPUP_WIDTH = 420;
const POPUP_HEIGHT = 600;
let popupWindowId: number | null = null;

chrome.action.onClicked.addListener(async () => {
  // If the window already exists, focus it
  if (popupWindowId !== null) {
    try {
      const existing = await chrome.windows.get(popupWindowId);
      if (existing) {
        chrome.windows.update(popupWindowId, { focused: true });
        return;
      }
    } catch {
      popupWindowId = null;
    }
  }
  // Position near top-right, under the extensions toolbar area
  let top = 0;
  let left = 0;
  try {
    const lastFocused = await chrome.windows.getLastFocused();
    const winLeft = lastFocused.left ?? 0;
    const winWidth = lastFocused.width ?? 1920;
    left = winLeft + winWidth - POPUP_WIDTH - 12;
    top = (lastFocused.top ?? 0) + 80; // below the toolbar
  } catch { /* fallback to 0,0 */ }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('src/popup/index.html'),
    type: 'popup',
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    top,
    left,
  });
  popupWindowId = win.id ?? null;
});

// Clear tracked window ID when the popup window is closed
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popupWindowId) {
    popupWindowId = null;
  }
});

// Listen for messages from popup to trigger a refresh
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'REFRESH_UNREAD') {
    refreshUnreadBadge().then(() => sendResponse({ ok: true }));
    return true; // async response
  }
  if (message.type === 'GET_UNREAD_COUNTS') {
    chrome.storage.local.get(['unreadCounts'], (result) => {
      sendResponse({ unreadCounts: result.unreadCounts || {} });
    });
    return true;
  }
});

// Use chrome.alarms for persistent polling that survives service worker termination
chrome.alarms.create('pollUnread', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pollUnread') {
    refreshUnreadBadge();
  }
});

// Initial badge refresh
refreshUnreadBadge();
