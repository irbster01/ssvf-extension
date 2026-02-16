import React from 'react';
import ReactDOM from 'react-dom/client';
import { PublicClientApplication, EventType } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import App from './App';
import { msalConfig } from './auth/msalConfig';
import './index.css';

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
  try {
    const response = await msalInstance.handleRedirectPromise();
    if (response) {
      msalInstance.setActiveAccount(response.account);
    } else {
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length > 0) {
        msalInstance.setActiveAccount(accounts[0]);
      }
    }
  } catch (error) {
    console.error('[MSAL] handleRedirectPromise failed:', error);
  }

  // Listen for login events
  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_FAILURE) {
      console.error('[MSAL] Login failure:', event.error);
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
