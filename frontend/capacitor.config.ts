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
    // Auth now happens in system browser (SFSafariViewController),
    // so we no longer need allowNavigation for Microsoft domains.
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
