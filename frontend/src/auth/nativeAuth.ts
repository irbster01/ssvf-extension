/**
 * Native Auth Service for Capacitor iOS
 * 
 * Handles OAuth2 Authorization Code flow with PKCE using the system browser
 * (SFSafariViewController on iOS) instead of WKWebView. This avoids all the
 * WKWebView limitations with MSAL redirect flows, MFA, and CORS.
 * 
 * Flow:
 * 1. Generate PKCE code_verifier + code_challenge
 * 2. Open Microsoft login in system browser via @capacitor/browser
 * 3. User completes login + MFA in a real browser context
 * 4. Microsoft redirects to capacitor://localhost?code=...
 * 5. iOS opens our app (registered URL scheme), @capacitor/app fires event
 * 6. We exchange the auth code for tokens via POST to Azure AD
 * 7. Store tokens in localStorage and update React state
 */

import { Browser } from '@capacitor/browser';
import { App as CapApp } from '@capacitor/app';

const CLIENT_ID = '848ba96c-9617-48c7-b8fd-e22c4388fab6';
const TENANT_ID = '38c1626e-b75d-40a6-b21b-0aae1191c730';
const REDIRECT_URI = 'capacitor://localhost';
const AUTHORITY = `https://login.microsoftonline.com/${TENANT_ID}`;
const SCOPES = ['User.Read', 'openid', 'profile', 'email'];

// Storage keys
const TOKEN_KEYS = {
  accessToken: 'native_auth_access_token',
  idToken: 'native_auth_id_token',
  refreshToken: 'native_auth_refresh_token',
  expiresAt: 'native_auth_expires_at',
  account: 'native_auth_account',
  codeVerifier: 'native_auth_code_verifier',
  state: 'native_auth_state',
};

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface AccountInfo {
  name: string;
  username: string;
  localAccountId: string;
}

// PKCE helpers
function generateRandomString(length: number): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => charset[v % charset.length]).join('');
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = generateRandomString(64);
  const hash = await sha256(codeVerifier);
  const codeChallenge = base64urlEncode(hash);
  return { codeVerifier, codeChallenge };
}

// Parse JWT without validation (for extracting claims from id_token)
function parseJwt(token: string): Record<string, any> {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return {};
  }
}

class NativeAuthService {
  private urlListenerRegistered = false;
  private loginResolve: ((value: AccountInfo) => void) | null = null;
  private loginReject: ((reason: any) => void) | null = null;

  constructor() {
    console.log('[NativeAuth] Service created');
  }

  /**
   * Check if user is authenticated (has valid tokens)
   */
  isAuthenticated(): boolean {
    const expiresAt = localStorage.getItem(TOKEN_KEYS.expiresAt);
    const accessToken = localStorage.getItem(TOKEN_KEYS.accessToken);
    if (!accessToken || !expiresAt) return false;
    
    // Check if token is expired (with 5 min buffer)
    const expiry = parseInt(expiresAt, 10);
    const now = Date.now();
    const isValid = now < expiry - 5 * 60 * 1000;
    console.log('[NativeAuth] isAuthenticated:', isValid, 'expiresIn:', Math.round((expiry - now) / 1000), 's');
    return isValid;
  }

  /**
   * Get the current account info
   */
  getAccount(): AccountInfo | null {
    const data = localStorage.getItem(TOKEN_KEYS.account);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Get current access token
   */
  getAccessToken(): string | null {
    if (!this.isAuthenticated()) return null;
    return localStorage.getItem(TOKEN_KEYS.accessToken);
  }

  /**
   * Start the login flow — opens system browser for Microsoft login
   */
  async login(): Promise<AccountInfo> {
    console.log('[NativeAuth] Starting login...');

    // Generate PKCE challenge
    const { codeVerifier, codeChallenge } = await generatePKCE();
    const state = generateRandomString(32);

    // Store PKCE verifier and state for later verification
    localStorage.setItem(TOKEN_KEYS.codeVerifier, codeVerifier);
    localStorage.setItem(TOKEN_KEYS.state, state);

    // Register URL listener before opening browser
    this.registerUrlListener();

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      response_mode: 'query',
      scope: SCOPES.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: state,
      prompt: 'select_account',
    });

    const authUrl = `${AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}`;
    console.log('[NativeAuth] Opening auth URL in system browser...');

    // Open in system browser (SFSafariViewController on iOS)
    await Browser.open({ url: authUrl });

    // Return a promise that resolves when the redirect callback is received
    return new Promise<AccountInfo>((resolve, reject) => {
      this.loginResolve = resolve;
      this.loginReject = reject;

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.loginReject) {
          this.loginReject(new Error('Login timed out'));
          this.loginResolve = null;
          this.loginReject = null;
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Register listener for URL scheme callbacks
   */
  private registerUrlListener(): void {
    if (this.urlListenerRegistered) return;
    this.urlListenerRegistered = true;

    console.log('[NativeAuth] Registering URL listener...');
    CapApp.addListener('appUrlOpen', async (event) => {
      console.log('[NativeAuth] URL opened:', event.url);

      // Check if this is our auth callback
      if (!event.url.startsWith('capacitor://localhost')) {
        console.log('[NativeAuth] Ignoring non-auth URL');
        return;
      }

      // Close the browser IMMEDIATELY to dismiss the SFSafariViewController
      // before it shows a "Safari lost connection" error
      Browser.close().catch(() => {});

      try {
        // Parse the URL for auth code
        const url = new URL(event.url);
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        if (error) {
          throw new Error(`Auth error: ${error} - ${errorDescription}`);
        }

        if (!code) {
          throw new Error('No authorization code in callback URL');
        }

        // Verify state
        const savedState = localStorage.getItem(TOKEN_KEYS.state);
        if (returnedState !== savedState) {
          throw new Error('State mismatch - possible CSRF attack');
        }

        // Exchange code for tokens
        const account = await this.exchangeCodeForTokens(code);

        if (this.loginResolve) {
          this.loginResolve(account);
          this.loginResolve = null;
          this.loginReject = null;
        }
      } catch (error) {
        console.error('[NativeAuth] Callback error:', error);
        if (this.loginReject) {
          this.loginReject(error);
          this.loginResolve = null;
          this.loginReject = null;
        }
      }
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(code: string): Promise<AccountInfo> {
    const codeVerifier = localStorage.getItem(TOKEN_KEYS.codeVerifier);
    if (!codeVerifier) {
      throw new Error('No code verifier found');
    }

    console.log('[NativeAuth] Exchanging code for tokens...');

    const tokenUrl = `${AUTHORITY}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      scope: SCOPES.join(' '),
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[NativeAuth] Token exchange failed:', response.status, errorText);
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const tokens: TokenResponse = await response.json();
    console.log('[NativeAuth] Token exchange successful');

    // Parse ID token for account info
    const idClaims = parseJwt(tokens.id_token);
    const account: AccountInfo = {
      name: idClaims.name || idClaims.preferred_username || 'Unknown',
      username: idClaims.preferred_username || idClaims.email || idClaims.upn || '',
      localAccountId: idClaims.oid || idClaims.sub || '',
    };

    // Store tokens
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    localStorage.setItem(TOKEN_KEYS.accessToken, tokens.access_token);
    localStorage.setItem(TOKEN_KEYS.idToken, tokens.id_token);
    if (tokens.refresh_token) {
      localStorage.setItem(TOKEN_KEYS.refreshToken, tokens.refresh_token);
    }
    localStorage.setItem(TOKEN_KEYS.expiresAt, expiresAt.toString());
    localStorage.setItem(TOKEN_KEYS.account, JSON.stringify(account));

    // Clean up PKCE state
    localStorage.removeItem(TOKEN_KEYS.codeVerifier);
    localStorage.removeItem(TOKEN_KEYS.state);

    console.log('[NativeAuth] Login complete:', account.username);
    return account;
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken(): Promise<string | null> {
    const refreshToken = localStorage.getItem(TOKEN_KEYS.refreshToken);
    if (!refreshToken) {
      console.log('[NativeAuth] No refresh token available');
      return null;
    }

    console.log('[NativeAuth] Refreshing access token...');

    try {
      const tokenUrl = `${AUTHORITY}/oauth2/v2.0/token`;
      const body = new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: SCOPES.join(' '),
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        console.error('[NativeAuth] Token refresh failed:', response.status);
        this.clearTokens();
        return null;
      }

      const tokens: TokenResponse = await response.json();
      const expiresAt = Date.now() + tokens.expires_in * 1000;

      localStorage.setItem(TOKEN_KEYS.accessToken, tokens.access_token);
      localStorage.setItem(TOKEN_KEYS.idToken, tokens.id_token);
      if (tokens.refresh_token) {
        localStorage.setItem(TOKEN_KEYS.refreshToken, tokens.refresh_token);
      }
      localStorage.setItem(TOKEN_KEYS.expiresAt, expiresAt.toString());

      console.log('[NativeAuth] Token refreshed successfully');
      return tokens.access_token;
    } catch (error) {
      console.error('[NativeAuth] Token refresh error:', error);
      this.clearTokens();
      return null;
    }
  }

  /**
   * Log out — clear tokens
   */
  async logout(): Promise<void> {
    console.log('[NativeAuth] Logging out...');
    this.clearTokens();

    // Optionally open the logout URL to clear the server session
    try {
      const logoutUrl = `${AUTHORITY}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
      await Browser.open({ url: logoutUrl });
    } catch (e) {
      console.log('[NativeAuth] Logout browser error (ok):', e);
    }
  }

  private clearTokens(): void {
    Object.values(TOKEN_KEYS).forEach((key) => localStorage.removeItem(key));
  }
}

// Singleton instance
export const nativeAuth = new NativeAuthService();
