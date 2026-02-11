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
    // Controls the WKWebView URL scheme.
    // Default is "capacitor" → capacitor://localhost
    // Set to "http" → http://localhost (accepted by Azure AD as SPA redirect URI)
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
