# Chrome Web Store Submission Guide

## Required Files Checklist

### Already Created
- [x] `manifest.json` - Extension manifest (version 3)
- [x] `icons/icon16.png` - 16x16 toolbar icon
- [x] `icons/icon48.png` - 48x48 extension management icon
- [x] `icons/icon128.png` - 128x128 Chrome Web Store icon
- [x] `PRIVACY_POLICY.md` - Privacy policy

### Need to Create for Store
- [ ] Promotional tile image (440x280 PNG)
- [ ] Screenshot 1 (1280x800 or 640x400 PNG)
- [ ] Screenshot 2 (1280x800 or 640x400 PNG)

---

## Store Listing Information

### Extension Name (45 chars max)
```
VOANLA TFA to SharePoint
```

### Short Description (132 chars max)
```
Captures SSVF service data from WellSky and submits to SharePoint for TFA tracking and accounting.
```

### Detailed Description (up to 16,000 chars)
```
VOANLA TFA to SharePoint streamlines Temporary Financial Assistance (TFA) tracking for the SSVF (Supportive Services for Veteran Families) program.

🎯 PURPOSE
This extension automatically captures service data when case managers submit services in WellSky Community Services, eliminating the need for duplicate data entry and ensuring accurate TFA tracking for grant reporting.

✨ FEATURES
• Automatic data capture when "Save & Exit" is clicked
• Captures service dates, financial assistance types, and costs
• Secure Microsoft Entra ID (Azure AD) authentication
• Real-time submission to Azure backend
• Toast notifications confirming successful submissions
• Works exclusively on wscs.wellsky.com

🔒 SECURITY
• Enterprise authentication via Microsoft Entra ID
• Only authorized VOANLA employees can use this extension
• Data transmitted securely via HTTPS to Azure
• No passwords or client PII stored locally

📋 WHO THIS IS FOR
This extension is for VOANLA case managers working with the SSVF program who need to track TFA services for grant compliance and accounting purposes.

⚠️ REQUIREMENTS
• Must have a valid VOANLA Microsoft account
• Must be accessing WellSky Community Services (wscs.wellsky.com)
• Extension only activates on approved domains

📧 SUPPORT
For issues or questions, contact your IT department or email support@voanorthla.org

Developed by Volunteers of America of Greater Los Angeles for internal use.
```

---

## Category
Select: **Productivity**

## Language
Select: **English (United States)**

---

## Privacy Section

### Single Purpose Description (required, explain what your extension does)
```
This extension captures SSVF service data from WellSky forms when case managers click "Save & Exit" and submits it to a secure Azure backend for TFA tracking and accounting purposes.
```

### Permission Justifications

#### storage
```
Used to store the user's authentication session token locally so they don't have to sign in every time they use the extension.
```

#### identity
```
Required to authenticate users with Microsoft Entra ID (Azure AD). This ensures only authorized VOANLA employees can use the extension.
```

#### Host permission: https://wscs.wellsky.com/*
```
The extension needs access to WellSky Community Services to capture service form data when users submit services. This is the core functionality of the extension.
```

#### Host permission: https://graph.microsoft.com/*
```
Used to retrieve the user's profile information (name, email) from Microsoft Graph after authentication to display in the extension popup.
```

---

## Privacy Practices

### Data Usage (checkboxes)
- [x] Personally identifiable information (user's email from Microsoft account)
- [ ] Health information
- [ ] Financial and payment information
- [x] Authentication information (Microsoft auth tokens)
- [ ] Personal communications
- [x] Location (no - but form data includes service location context)
- [x] Web history (only wscs.wellsky.com pages where services are submitted)
- [x] User activity (captures form submissions)
- [ ] Website content

### Certified Uses
- [x] This extension does NOT sell user data
- [x] This extension does NOT use data for creditworthiness or lending
- [x] This extension does NOT use data for purposes unrelated to the extension's single purpose

---

## Privacy Policy URL
Host your PRIVACY_POLICY.md file and provide the URL. Suggested locations:
1. GitHub Pages: `https://irbster01.github.io/ssvf-extension/PRIVACY_POLICY`
2. Your organization's website: `https://www.voanorthla.org/ssvf-extension-privacy`

---

## Distribution

### Visibility
Select: **Unlisted** (recommended for internal organization use)
- Unlisted means only people with the direct link can install it
- This is appropriate for internal organizational tools

OR

Select: **Private** 
- If you have Google Workspace, you can make it available only to your organization

### Regions
Select: **All regions** or just **United States**

---

## Pricing
Select: **Free**

---

## Mature Content
Select: **No** for all options

---

## Additional Requirements

### Developer Account
- One-time $5 registration fee (you mentioned you have this)
- Developer account must be verified

### Review Time
- First submission: 1-3 business days typically
- Can take longer if additional review is needed

---

## How to Package and Submit

1. Build the extension:
   ```bash
   cd extension
   npm run build
   ```

2. Create the ZIP file (see PACKAGE_FOR_STORE.md)

3. Go to https://chrome.google.com/webstore/devconsole

4. Click "New Item"

5. Upload the ZIP file

6. Fill in all the fields above

7. Upload promotional images

8. Submit for review

---

## Screenshots to Create

### Screenshot 1: Extension Popup (signed in)
Show the popup with:
- User signed in
- Stats visible
- "Signed in as [email]" visible

### Screenshot 2: Toast Notification
Show the WellSky page with:
- The success toast "✓ Service saved & submitted for TFA"
- The form in the background

### Promotional Tile (440x280)
Create a simple graphic with:
- VOANLA logo
- Extension name
- Brief tagline like "Streamline TFA Tracking"

---

## Quick Reference - Required Images

| Image | Size | Format | Required |
|-------|------|--------|----------|
| Icon | 128x128 | PNG | ✅ Yes (in manifest) |
| Promo Tile | 440x280 | PNG/JPEG | ✅ Yes |
| Screenshot 1 | 1280x800 or 640x400 | PNG/JPEG | ✅ Yes (min 1) |
| Screenshot 2 | 1280x800 or 640x400 | PNG/JPEG | Recommended |
| Marquee | 1400x560 | PNG/JPEG | Optional |
