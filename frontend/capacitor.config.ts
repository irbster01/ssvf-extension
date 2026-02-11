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
    // Allow navigation to Microsoft login pages within the WKWebView
    // so auth redirect stays in-app (no Safari popup)
    allowNavigation: [
      'login.microsoftonline.com',
      'login.live.com',
      'login.windows.net',
    ],
  },
  plugins: {},
};

export default config;
