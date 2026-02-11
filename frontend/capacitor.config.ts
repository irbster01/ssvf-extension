import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.voanla.ssvftfa',
  appName: 'SSVF TFA Tracker',
  webDir: 'dist',
  // iOS app loads from the live SWA URL so MSAL redirect auth
  // works correctly in WKWebView (popups are blocked).
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#f5f5f5',
    preferredContentMode: 'mobile',
    scheme: 'SSVF TFA',
  },
  server: {
    // Load from the live SWA so MSAL redirect auth works in WKWebView
    url: 'https://wonderful-sand-00129870f.1.azurestaticapps.net',
    cleartext: false,
  },
  plugins: {
    // Add plugin configs as needed
  },
};

export default config;
