import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { Capacitor } from '@capacitor/core';
import { useState, useEffect, useCallback } from 'react';
import { loginRequest } from './auth/msalConfig';
import { nativeAuth } from './auth/nativeAuth';
import Dashboard from './components/Dashboard';

const isNative = Capacitor.isNativePlatform();

/**
 * Native app: uses system browser OAuth (nativeAuth service)
 * Web app: uses MSAL redirect flow
 */
function App() {
  if (isNative) {
    return <NativeApp />;
  }
  return <WebApp />;
}

/** Native iOS/Android app — uses system browser for OAuth */
function NativeApp() {
  const [authenticated, setAuthenticated] = useState(nativeAuth.isAuthenticated());
  const [account, setAccount] = useState(nativeAuth.getAccount());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if tokens are still valid on mount
  useEffect(() => {
    const checkAuth = async () => {
      if (nativeAuth.isAuthenticated()) {
        setAuthenticated(true);
        setAccount(nativeAuth.getAccount());
      } else if (localStorage.getItem('native_auth_refresh_token')) {
        // Try to refresh silently
        setLoading(true);
        const token = await nativeAuth.refreshAccessToken();
        setLoading(false);
        if (token) {
          setAuthenticated(true);
          setAccount(nativeAuth.getAccount());
        }
      }
    };
    checkAuth();
  }, []);

  const handleLogin = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const acct = await nativeAuth.login();
      setAccount(acct);
      setAuthenticated(true);
    } catch (err) {
      console.error('[NativeApp] Login failed:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await nativeAuth.logout();
    setAuthenticated(false);
    setAccount(null);
  }, []);

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Authenticating...</div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="app">
        <div className="login-container">
          <h2>SSVF Accounting Dashboard</h2>
          <p>Sign in with your Microsoft account to continue</p>
          <button className="btn btn-primary" onClick={handleLogin}>
            Sign in with Microsoft
          </button>
          {error && (
            <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#c00', wordBreak: 'break-all', maxWidth: '300px' }}>
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>SSVF Accounting Dashboard</h1>
        <div className="user-info">
          <span>{account?.name || account?.username}</span>
          <button className="btn btn-secondary" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>
      <Dashboard />
    </div>
  );
}

/** Web app (SWA) — uses MSAL redirect flow */
function WebApp() {
  const isAuthenticated = useIsAuthenticated();
  const { instance, inProgress, accounts } = useMsal();

  const handleLogin = () => {
    instance.loginRedirect(loginRequest).catch((error) => {
      console.error('Login failed:', error);
    });
  };

  const handleLogout = () => {
    instance.logoutRedirect().catch((error) => {
      console.error('Logout failed:', error);
    });
  };

  if (inProgress !== InteractionStatus.None) {
    return (
      <div className="app">
        <div className="loading">Authenticating...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="app">
        <div className="login-container">
          <h2>SSVF Accounting Dashboard</h2>
          <p>Sign in with your Microsoft account to continue</p>
          <button className="btn btn-primary" onClick={handleLogin}>
            Sign in with Microsoft
          </button>
        </div>
      </div>
    );
  }

  const account = accounts[0];

  return (
    <div className="app">
      <header>
        <h1>SSVF Accounting Dashboard</h1>
        <div className="user-info">
          <span>{account?.name || account?.username}</span>
          <button className="btn btn-secondary" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>
      <Dashboard />
    </div>
  );
}

export default App;
