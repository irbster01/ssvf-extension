import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { loginRequest } from './auth/msalConfig';
import Dashboard from './components/Dashboard';

function App() {
  const isAuthenticated = useIsAuthenticated();
  const { instance, inProgress, accounts } = useMsal();

  console.log('[App] Render - isAuthenticated:', isAuthenticated, 'inProgress:', inProgress, 'accounts:', accounts.length);

  const handleLogin = () => {
    console.log('[App] Starting loginRedirect...');
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
        <div className="loading">Authenticating... ({inProgress})</div>
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
