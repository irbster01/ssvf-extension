import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.voanla.ssvftfa',
  appName: 'SSVF TFA Tracker',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#f5f5f5',
    preferredContentMode: 'mobile',
    allowsLinkPreview: false,
  },
  server: {
    // Allow navigation to ALL Microsoft auth/MFA domains within the WKWebView.
    // MFA uses additional domains beyond login.microsoftonline.com (e.g.,
    // msftauth.net for Authenticator prompts, msauth.net for MFA pages).
    // If any domain is missing, WKWebView opens it externally and breaks the flow.
    allowNavigation: [
      '*.microsoftonline.com',     // AAD login, device login, etc.
      '*.microsoftonline-p.com',   // AAD proxy/partner redirects
      '*.msftauth.net',            // MFA / Authenticator prompts
      '*.msauth.net',              // MFA auth pages
      '*.microsoft.com',           // account pages, device auth
      '*.live.com',                // Microsoft live auth
      '*.windows.net',             // AAD endpoints
      '*.microsoftazuread-sso.com', // SSO autologon
    ],
  },
  plugins: {
    // Route fetch/XHR through native HTTP layer — bypasses CORS restrictions
    // in WKWebView. Without this, MSAL's token exchange POST to Azure AD
    // fails because the capacitor:// origin isn't allowed by Azure's CORS policy.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
