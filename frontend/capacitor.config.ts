import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.voanla.ssvftfa',
  appName: 'SSVF TFA Tracker',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#f5f5f5',
    preferredContentMode: 'mobile',
    scheme: 'SSVF TFA',
    // Allow WKWebView to navigate to Microsoft login and back
    // without opening external Safari — keeps auth flow in-app
    allowsLinkPreview: false,
  },
  server: {
    // Use http scheme so the app runs at http://localhost
    // This is required because Azure AD only accepts https:// or http://localhost
    // as SPA redirect URIs (not capacitor://)
    iosScheme: 'http',
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
