import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.voanla.ssvftfa',
  appName: 'SSVF TFA Tracker',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#f5f5f5',
    preferredContentMode: 'mobile',
    // Use http scheme so the app runs at http://localhost
    // Azure AD only accepts https:// or http://localhost as SPA redirect URIs
    scheme: 'http',
    allowsLinkPreview: false,
  },
  server: {
    // Allow navigation to Microsoft login pages within the WKWebView
    allowNavigation: [
      'login.microsoftonline.com',
      'login.live.com',
      'login.windows.net',
    ],
  },
  plugins: {},
};

export default config;
