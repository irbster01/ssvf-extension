import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.voanla.ssvftfa',
  appName: 'SSVF TFA Tracker',
  webDir: 'dist',
  // Note: Do NOT use server.url for App Store builds - Apple may reject apps
  // that are just "website wrappers". The app bundles the web assets locally.
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#f5f5f5',
    preferredContentMode: 'mobile',
    scheme: 'SSVF TFA',
  },
  plugins: {
    // Add plugin configs as needed
  },
};

export default config;
