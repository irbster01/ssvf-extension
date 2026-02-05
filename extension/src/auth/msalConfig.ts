import { Configuration, PopupRequest, LogLevel } from '@azure/msal-browser';

// MSAL configuration for Microsoft Entra ID authentication
// Replace these values with your actual Azure AD app registration details
export const msalConfig: Configuration = {
  auth: {
    // Your Azure AD app registration client ID
    clientId: '848ba96c-9617-48c7-b8fd-e22c4388fab6',
    
    // Your Azure AD tenant ID
    authority: 'https://login.microsoftonline.com/38c1626e-b75d-40a6-b21b-0aae1191c730',
    
    // Redirect URI - for Chrome extensions, use the extension's popup URL
    redirectUri: chrome.runtime.getURL('src/popup/index.html'),
    
    // Where to redirect after logout
    postLogoutRedirectUri: chrome.runtime.getURL('src/popup/index.html'),
    
    // Navigate to request URL after login (for extensions, usually false)
    navigateToLoginRequestUrl: false,
  },
  cache: {
    // Use localStorage for persistence across browser sessions
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        switch (level) {
          case LogLevel.Error:
            console.error('[MSAL]', message);
            break;
          case LogLevel.Warning:
            console.warn('[MSAL]', message);
            break;
          case LogLevel.Info:
            console.info('[MSAL]', message);
            break;
          case LogLevel.Verbose:
            console.debug('[MSAL]', message);
            break;
        }
      },
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false,
    },
    // Allow popups for Chrome extension context
    allowNativeBroker: false,
  },
};

// Scopes for authentication - basic user info
export const loginRequest: PopupRequest = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
};

// Scopes for API access (if you want to call your own API with the token)
export const apiRequest: PopupRequest = {
  scopes: ['api://YOUR_API_CLIENT_ID/.default'], // TODO: Replace if you have a custom API scope
};
