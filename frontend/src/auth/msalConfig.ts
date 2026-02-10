import { Configuration, LogLevel } from '@azure/msal-browser';

// Get the current URL for redirect (works for local dev and deployed SWA)
const redirectUri = window.location.origin;

export const msalConfig: Configuration = {
  auth: {
    // Same Azure AD app registration used by the extension
    clientId: '848ba96c-9617-48c7-b8fd-e22c4388fab6',
    
    // Your Azure AD tenant ID
    authority: 'https://login.microsoftonline.com/38c1626e-b75d-40a6-b21b-0aae1191c730',
    
    // Redirect URI - will be the SWA URL
    redirectUri: redirectUri,
    postLogoutRedirectUri: redirectUri,
    navigateToLoginRequestUrl: true,
  },
  cache: {
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
        }
      },
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false,
    },
  },
};

// Scopes for accessing the API
export const loginRequest = {
  scopes: ['User.Read', 'openid', 'profile', 'email'],
};

export const apiRequest = {
  scopes: ['https://graph.microsoft.com/.default'],
};
