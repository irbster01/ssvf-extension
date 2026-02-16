// Chrome extension OAuth2 authentication with Microsoft Entra ID
// Uses chrome.identity.launchWebAuthFlow for proper extension support

const CLIENT_ID = '848ba96c-9617-48c7-b8fd-e22c4388fab6';
const TENANT_ID = '38c1626e-b75d-40a6-b21b-0aae1191c730';
const REDIRECT_URL = chrome.identity.getRedirectURL();
const SCOPES = ['openid', 'profile', 'email', 'User.Read'];

// Buffer in seconds — treat token as expired 5 min before actual expiry
const EXPIRY_BUFFER_SECONDS = 300;

interface UserInfo {
  sub: string;
  name: string;
  email: string;
  preferred_username: string;
}

/**
 * Decode a JWT and return the payload (without verifying signature).
 * Returns null if the token is malformed.
 */
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

/**
 * Check whether a stored access token is still valid (not expired).
 * Returns false if the token is missing, malformed, or expired.
 */
function isTokenValid(token: string | undefined | null): boolean {
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.exp) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return payload.exp > nowSeconds + EXPIRY_BUFFER_SECONDS;
}

/**
 * Build the Microsoft authorization URL
 */
function buildAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'token',
    redirect_uri: REDIRECT_URL,
    scope: SCOPES.join(' '),
    response_mode: 'fragment',
    prompt: 'select_account',
  });
  
  return `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?${params.toString()}`;
}

/**
 * Parse the access token from the redirect URL fragment
 */
function parseTokenFromUrl(url: string): string | null {
  try {
    const fragment = new URL(url).hash.substring(1);
    const params = new URLSearchParams(fragment);
    return params.get('access_token');
  } catch {
    return null;
  }
}

/**
 * Get user info from Microsoft Graph using the access token
 */
async function getUserInfo(accessToken: string): Promise<UserInfo | null> {
  try {
    const response = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    
    if (!response.ok) {
      throw new Error('Failed to get user info');
    }
    
    const data = await response.json();
    return {
      sub: data.id,
      name: data.displayName || 'User',
      email: data.mail || data.userPrincipalName || '',
      preferred_username: data.userPrincipalName || '',
    };
  } catch (error) {
    console.error('[Auth] Failed to get user info:', error);
    return null;
  }
}

/**
 * Sign in the user via chrome.identity.launchWebAuthFlow
 */
export async function signIn(): Promise<{ name: string; username: string } | null> {
  return new Promise((resolve, reject) => {
    const authUrl = buildAuthUrl();
    
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl,
        interactive: true,
      },
      async (redirectUrl) => {
        if (chrome.runtime.lastError) {
          console.error('[Auth] Auth flow error:', chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        if (!redirectUrl) {
          reject(new Error('No redirect URL received'));
          return;
        }
        
        const accessToken = parseTokenFromUrl(redirectUrl);
        if (!accessToken) {
          reject(new Error('No access token in response'));
          return;
        }
        
        // Get user info
        const userInfo = await getUserInfo(accessToken);
        if (!userInfo) {
          reject(new Error('Failed to get user info'));
          return;
        }
        
        // Store auth data
        await chrome.storage.local.set({
          authToken: accessToken,
          userId: userInfo.sub,
          userName: userInfo.name,
          userEmail: userInfo.email || userInfo.preferred_username,
        });
        
        resolve({
          name: userInfo.name,
          username: userInfo.email || userInfo.preferred_username,
        });
      }
    );
  });
}

/**
 * Sign out the user
 */
export async function signOut(): Promise<void> {
  await chrome.storage.local.remove(['authToken', 'userId', 'userName', 'userEmail']);
}

/**
 * Get the current account (if signed in with a valid token).
 * Returns null if no token or if the token has expired.
 */
export async function getCurrentAccount(): Promise<{ name: string; username: string } | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['authToken', 'userName', 'userEmail'], (result) => {
      if (result.authToken && isTokenValid(result.authToken) && result.userName) {
        resolve({
          name: result.userName,
          username: result.userEmail || '',
        });
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Check if user is currently authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const account = await getCurrentAccount();
  return account !== null;
}

/**
 * Try to silently refresh the token using cached auth
 * Returns the new token if successful, null if user needs to re-authenticate interactively
 */
export async function silentTokenRefresh(): Promise<string | null> {
  return new Promise((resolve) => {
    const authUrl = buildAuthUrl().replace('prompt=select_account', 'prompt=none');
    
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl,
        interactive: false,
      },
      async (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          console.log('[Auth] Silent refresh failed, user needs to sign in again');
          resolve(null);
          return;
        }
        
        const accessToken = parseTokenFromUrl(redirectUrl);
        if (!accessToken) {
          resolve(null);
          return;
        }
        
        // Update stored token
        await chrome.storage.local.set({ authToken: accessToken });
        console.log('[Auth] Token refreshed silently');
        resolve(accessToken);
      }
    );
  });
}

/**
 * Get a valid token, attempting silent refresh if the stored one is expired.
 * Returns the token or null if user needs to re-authenticate interactively.
 */
export async function getValidToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['authToken'], async (result) => {
      // No token at all — not logged in
      if (!result.authToken) {
        resolve(null);
        return;
      }

      // Token is still valid — return it
      if (isTokenValid(result.authToken)) {
        resolve(result.authToken);
        return;
      }

      // Token expired — try silent refresh
      console.log('[Auth] Stored token expired, attempting silent refresh…');
      const refreshed = await silentTokenRefresh();
      resolve(refreshed);
    });
  });
}

/**
 * Clear the stored auth token (call when 401 received)
 */
export async function clearAuthToken(): Promise<void> {
  await chrome.storage.local.remove(['authToken']);
}
