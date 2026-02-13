# App Store Submission Guide — SSVF TFA Tracker

**Bundle ID:** `org.voanla.ssvftfa`  
**App Name:** SSVF TFA Tracker  

---

## 1. iPad Screenshots (Without an iPad)

You don't need a physical iPad. Here are your options, ranked by easiest:

### Option A — Xcode Simulator (Recommended)
1. Open the project in Xcode.
2. Select an iPad simulator target (e.g. **iPad Pro 13-inch (M4)**).
3. Build & run (`Cmd + R`).
4. Use **File → Screenshot** (or `Cmd + S`) to capture simulator screenshots.
5. Required iPad screenshot sizes for App Store Connect:
   - **12.9" iPad Pro (4th gen+):** 2048 × 2732 px
   - **13" iPad Air / iPad Pro M4:** 2064 × 2752 px

> Apple requires at least **one** iPad screenshot if your app supports iPad (and your Info.plist declares `UISupportedInterfaceOrientations~ipad`, which it does).

### Option B — Chrome DevTools Device Emulation
1. Run `npm run dev` in the frontend folder.
2. Open Chrome → DevTools (`F12`) → Toggle Device Toolbar.
3. Select **iPad Pro** or set custom resolution to 2048 × 2732.
4. Take a full-size screenshot: DevTools menu (⋮) → **Capture screenshot**.
5. This gives you the web view at iPad resolution — works for a Capacitor/web app.

### Option C — Figma / Design Tool Mockup
1. Use a free iPad mockup frame in Figma.
2. Paste your Chrome DevTools screenshots into the iPad frame.
3. Export at the required resolution.

### Screenshot Suggestions (take 3–5 per device size)
1. **Login screen** — "Sign in with Microsoft" button
2. **Dashboard** — Status cards (New / In Progress / Complete) with submissions table
3. **Submit TFA form** — The expanded form with fields filled in
4. **Edit modal** — Editing a submission with attachment upload
5. **Status filter** — Showing filtered view (e.g., "In Progress" only)

---

## 2. App Store Description

### App Name (30 chars max)
```
SSVF TFA Tracker
```

### Subtitle (30 chars max)
```
TFA Tracking for SSVF Programs
```

### Description (4,000 chars max)
```
SSVF TFA Tracker streamlines Temporary Financial Assistance (TFA) tracking for the Supportive Services for Veteran Families (SSVF) program at Volunteers of America of North Louisiana.

KEY FEATURES

• Submit TFA Records — Enter client ID, assistance type, vendor, amount, and region directly from your phone or tablet. No more duplicate data entry.

• Dashboard Overview — View all submissions at a glance with status indicators (New, In Progress, Complete) and real-time statistics.

• Status Tracking — Update submission status with a single tap as items move through your accounting workflow.

• File Attachments — Upload receipts, invoices, and supporting documents directly to each submission. Download attachments anytime.

• Edit & Update — Modify client details, amounts, vendor info, and notes on any submission.

• Filter & Search — Filter submissions by status to quickly find what needs attention.

• Secure Authentication — Sign in with your Microsoft organizational account via Entra ID. Only authorized VOANLA staff can access the app.

DESIGNED FOR SSVF CASE MANAGERS & ACCOUNTING STAFF

Whether you're in the field or at your desk, SSVF TFA Tracker keeps your financial assistance records organized and accessible. Submit new TFA records, attach supporting documents, and track them through completion — all in one place.

SUPPORTED PROGRAMS
• Homeless Prevention
• Rapid Rehousing

SUPPORTED REGIONS
• Shreveport
• Monroe
• Arkansas

SECURITY & COMPLIANCE
• Microsoft Entra ID enterprise authentication
• Encrypted data transmission (HTTPS)
• Cloud-hosted on Microsoft Azure
• Data retained per federal grant requirements

This app is for internal use by Volunteers of America of North Louisiana employees working with SSVF programs. A valid VOANLA Microsoft account is required.
```

---

## 3. Promotional Text (170 chars max, can be updated without a new build)

```
Track SSVF Temporary Financial Assistance submissions, attach receipts, and manage accounting workflows — all from your mobile device.
```

---

## 4. Keywords (100 chars max, comma-separated)

```
SSVF,TFA,veteran,financial assistance,accounting,case management,homeless prevention,VOANLA,tracker
```

---

## 5. Support URL (Required)

Use one of these:

```
https://www.voala.org/contact
```

Or create a simple support page / email alias:

```
mailto:support@voanorthla.org
```

> **Note:** Apple requires a valid HTTPS URL, not a mailto link. If VOALA has no dedicated support page, you can:
> 1. Use your org's main contact page (e.g., `https://www.voala.org/contact`)
> 2. Create a simple static page on your Azure Static Web App at a route like `/support`
> 3. Use a GitHub Pages site with basic support/contact info

---

## 6. Privacy Policy URL (Required)

Apple requires a publicly accessible privacy policy URL. Options:

### Option A — Host on your Static Web App (Recommended)
Add a `/privacy` route to your frontend. You already have the privacy policy content.

URL: `https://<your-swa-domain>.azurestaticapps.net/privacy`

### Option B — GitHub Pages or any public URL
Host the markdown as an HTML page.

### Privacy Policy Content (adapted for iOS app)

```
PRIVACY POLICY — SSVF TFA Tracker

Last Updated: February 12, 2026

OVERVIEW

SSVF TFA Tracker ("App") is developed by Volunteers of America of North Louisiana ("VOANLA", "we", "us", or "our"). This privacy policy explains how we collect, use, and protect information when you use our App.

INFORMATION WE COLLECT

Authentication Data
We use Microsoft Entra ID for authentication. When you sign in, we receive your name, email address, and a unique user identifier from your organization's Microsoft account. Authentication tokens are stored locally on your device to maintain your session.

Service Data
When you submit a TFA record, the App collects:
- Client ID and name
- Financial assistance type, vendor, and amount
- Region and program category
- Notes and attached files (receipts, invoices)
- Submission timestamps and user identity

What We Do NOT Collect
- Device identifiers or advertising IDs
- Location data
- Contacts, photos, or other personal device data
- Browsing history
- Data from other apps

HOW WE USE INFORMATION

Captured service data is used solely for:
- Tracking TFA services for SSVF program reporting
- Internal accounting and compliance purposes
- Generating reports for grant funders

DATA STORAGE AND SECURITY

- Authentication tokens are stored locally on your device using secure storage.
- Service data is transmitted securely (HTTPS) to Azure Functions and stored in Azure Cosmos DB, hosted in the United States.
- File attachments are stored in Azure Blob Storage with secure access controls.
- Only authenticated VOANLA employees with valid Microsoft Entra ID accounts can access the App.
- Data is retained according to VOANLA's data retention policies and federal grant requirements.

DATA SHARING

We do not sell, trade, or otherwise transfer your information to outside parties. Data may be shared:
- With program funders as required for grant compliance
- When required by law or to protect our rights

YOUR RIGHTS

You may:
- Request access to data associated with your account
- Request correction of inaccurate data
- Request deletion of your data (subject to legal retention requirements)

Contact privacy@voanorthla.org for any requests.

CHILDREN'S PRIVACY

This App is not intended for use by children under 13. We do not knowingly collect information from children.

CHANGES TO THIS POLICY

We may update this privacy policy from time to time. We will notify users of any material changes through the App or via email.

CONTACT US

Volunteers of America of North Louisiana
Email: privacy@voanorthla.org
Address: 360 Jordan Street, Shreveport, LA 71101

By using SSVF TFA Tracker, you consent to this privacy policy.
```

---

## 7. App Store Connect — Other Required Fields

| Field | Value |
|-------|-------|
| **Primary Category** | Business |
| **Secondary Category** | Productivity |
| **Age Rating** | 4+ (no objectionable content) |
| **Copyright** | © 2026 Volunteers of America of North Louisiana |
| **Contact Email** | support@voanorthla.org |
| **Marketing URL** (optional) | https://www.voala.org |
| **Content Rights** | Does not contain third-party content |
| **App Review Notes** | This app is for internal use by VOANLA employees. A valid VOANLA Microsoft (Entra ID) account is required to sign in. You will not be able to test without organizational credentials. If needed, contact support@voanorthla.org for a demo account. |

---

## 8. Distribution — Unlisted App

Since this is an internal tool, set the app as **Unlisted** so it won't appear in App Store search:

1. In App Store Connect, go to your app → **Pricing and Availability**
2. Under **Distribution Methods**, select **Unlisted**
3. After approval, Apple gives you a **direct link** — share that with your VOANLA team

> Unlisted apps go through normal App Review but are only installable via the direct link you distribute.

---

## 9. Checklist Before Submission

- [ ] iPhone screenshots (6.7" and 6.5" displays) — at least 3
- [ ] iPad screenshots (12.9" display) — at least 3 (use Xcode Simulator)
- [ ] App icon (1024×1024 PNG, no alpha) — already in Assets.xcassets
- [ ] Privacy policy hosted at a public URL
- [ ] Support URL is live and accessible
- [ ] Description, promo text, keywords filled in App Store Connect
- [ ] App Review notes explain this is an internal/enterprise tool
- [ ] Build uploaded via Xcode → Archive → Distribute
