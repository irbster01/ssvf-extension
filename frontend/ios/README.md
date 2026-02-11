# iOS App Build Instructions

This folder contains the Capacitor iOS project for the SSVF TFA Tracker app.

## Requirements

- **Mac with Xcode 15+** (iOS development requires macOS)
- **Apple Developer Program membership** ($99/year) - [enroll here](https://developer.apple.com/programs/)
- **CocoaPods** - Install with: `sudo gem install cocoapods`

## Build Steps (on Mac)

### 1. Clone/Copy the project to your Mac

```bash
git clone <your-repo-url>
cd ssvf-extension/frontend
```

### 2. Install dependencies

```bash
npm install
npm run build
```

### 3. Install iOS CocoaPods dependencies

```bash
cd ios/App
pod install
cd ../..
```

### 4. Open in Xcode

```bash
npx cap open ios
```

Or manually open: `frontend/ios/App/App.xcworkspace`

### 5. Configure Signing in Xcode

1. Select the **App** target in the project navigator
2. Go to **Signing & Capabilities** tab
3. Select your **Team** (your Apple Developer account)
4. Let Xcode create/manage signing certificates

### 6. Update App Assets

Replace these placeholder icons in `ios/App/App/Assets.xcassets/AppIcon.appiconset/`:

| Size | Filename |
|------|----------|
| 20pt @2x | AppIcon-20x20@2x.png (40x40) |
| 20pt @3x | AppIcon-20x20@3x.png (60x60) |
| 29pt @2x | AppIcon-29x29@2x.png (58x58) |
| 29pt @3x | AppIcon-29x29@3x.png (87x87) |
| 40pt @2x | AppIcon-40x40@2x.png (80x80) |
| 40pt @3x | AppIcon-40x40@3x.png (120x120) |
| 60pt @2x | AppIcon-60x60@2x.png (120x120) |
| 60pt @3x | AppIcon-60x60@3x.png (180x180) |
| 1024pt | AppIcon-1024x1024.png (1024x1024) - App Store |

Pro tip: Use [App Icon Generator](https://appicon.co/) to generate all sizes from a single 1024x1024 source.

### 7. Test on Simulator

1. Select a simulator device (e.g., iPhone 15)
2. Press **Cmd+R** or click the Play button
3. The app should launch in the simulator

### 8. Test on Physical Device

1. Connect your iPhone via USB
2. Select it as the target device
3. Trust the developer certificate on your iPhone: **Settings → General → VPN & Device Management**
4. Run the app

### 9. Archive for App Store

1. Select **Any iOS Device** as the target
2. **Product → Archive**
3. In the Organizer, click **Distribute App**
4. Choose **App Store Connect** → **Upload**
5. Follow the prompts to upload to App Store Connect

## App Store Connect Setup

Before uploading, create your app in [App Store Connect](https://appstoreconnect.apple.com/):

1. Click **My Apps → + → New App**
2. Fill in:
   - **Platform**: iOS
   - **Name**: SSVF TFA Tracker
   - **Primary Language**: English (U.S.)
   - **Bundle ID**: org.voanla.ssvftfa
   - **SKU**: ssvf-tfa-tracker
3. Prepare required assets:
   - Screenshots for iPhone (6.7", 6.5", 5.5")
   - App description
   - Privacy policy URL (use: https://ssvf.northla.app/privacy or the one in extension/PRIVACY_POLICY.md)

## Updating the App

When you make changes to the web app:

```bash
npm run build
npx cap sync ios
npx cap open ios
```

Then archive and upload a new version.

## Troubleshooting

**"Pod install failed"**
```bash
cd ios/App
pod repo update
pod install
```

**Signing issues**
- Ensure your Apple Developer membership is active
- Check that the Bundle ID matches what's registered in your Apple Developer account

**White screen on launch**
- Run `npx cap sync ios` to ensure web assets are copied
- Check Xcode console for JavaScript errors
