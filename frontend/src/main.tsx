import React from 'react';
import ReactDOM from 'react-dom/client';
import { PublicClientApplication, EventType } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import App from './App';
import { msalConfig } from './auth/msalConfig';
import './index.css';

// Debug: log URL info on load (helps diagnose redirect issues in Capacitor)
console.log('[App Boot] location:', JSON.stringify({
  href: window.location.href,
  hash: window.location.hash,
  search: window.location.search,
  origin: window.location.origin,
  pathname: window.location.pathname,
}));

// Store auth debug info for on-screen display in Capacitor
(window as any).__authDebug = { status: 'initializing', details: '' };

const msalInstance = new PublicClientApplication(msalConfig);
const root = ReactDOM.createRoot(document.getElementById('root')!);

// Show loading state while MSAL initializes and processes any redirect
root.render(
  <React.StrictMode>
    <div className="app">
      <div className="loading">Initializing...</div>
    </div>
  </React.StrictMode>
);

// Initialize MSAL and handle redirect BEFORE rendering the full app
msalInstance.initialize().then(async () => {
  console.log('[MSAL] Initialized, handling redirect promise...');

  try {
    const response = await msalInstance.handleRedirectPromise();
    if (response) {
      console.log('[MSAL] Redirect response received, account:', response.account?.username);
      (window as any).__authDebug = { status: 'redirect-success', details: `Account: ${response.account?.username}` };
      msalInstance.setActiveAccount(response.account);
    } else {
      console.log('[MSAL] No redirect response (normal page load)');
      // Set active account from cache if available
      const accounts = msalInstance.getAllAccounts();
      console.log('[MSAL] Cached accounts:', accounts.length);
      (window as any).__authDebug = { status: 'no-redirect', details: `Hash: ${window.location.hash.substring(0, 80)} | Cached accounts: ${accounts.length}` };
      if (accounts.length > 0) {
        msalInstance.setActiveAccount(accounts[0]);
      }
    }
  } catch (error) {
    console.error('[MSAL] handleRedirectPromise failed:', error);
    (window as any).__authDebug = { status: 'redirect-error', details: String(error) };
  }

  // Listen for login success events
  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
      const payload = event.payload as { account?: { username: string } };
      console.log('[MSAL] Login success event:', payload.account?.username);
    }
    if (event.eventType === EventType.LOGIN_FAILURE) {
      console.error('[MSAL] Login failure event:', event.error);
    }
  });

  // Now render the actual app
  root.render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </React.StrictMode>
  );
}).catch((error) => {
  console.error('[MSAL] Initialization failed:', error);
  // Render error state
  root.render(
    <React.StrictMode>
      <div className="app">
        <div className="login-container">
          <h2>Authentication Error</h2>
          <p>Failed to initialize authentication: {String(error)}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    </React.StrictMode>
  );
});
