import { Configuration, LogLevel } from '@azure/msal-browser';
import { Capacitor } from '@capacitor/core';

// Redirect URI depends on platform:
// - Capacitor iOS/Android: capacitor://localhost (registered as Mobile/Desktop app in Azure AD)
// - SWA: https://wonderful-sand-00129870f.1.azurestaticapps.net (registered as SPA)
// - Local dev: http://localhost:5173 (registered as SPA)
const redirectUri = Capacitor.isNativePlatform()
  ? 'capacitor://localhost'
  : window.location.origin;

export const msalConfig: Configuration = {
  auth: {
    // Same Azure AD app registration used by the extension
    clientId: '848ba96c-9617-48c7-b8fd-e22c4388fab6',
    
    // Your Azure AD tenant ID
    authority: 'https://login.microsoftonline.com/38c1626e-b75d-40a6-b21b-0aae1191c730',
    
    // Redirect URI - capacitor://localhost for iOS app, SWA URL for web
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
