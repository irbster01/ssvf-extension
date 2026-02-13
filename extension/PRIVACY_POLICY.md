# Privacy Policy for VOANLA TFA to SharePoint Extension

**Last Updated: February 5, 2026**

## Overview

The VOANLA TFA to SharePoint Chrome Extension ("Extension") is developed by Volunteers of America of North Louisiana ("VOANLA", "we", "us", or "our"). This privacy policy explains how we collect, use, and protect information when you use our Extension.

## Information We Collect

### Authentication Data
- **Microsoft Entra ID**: We use Microsoft Entra ID (Azure Active Directory) for authentication. When you sign in, we receive your name, email address, and a unique user identifier from your organization's Microsoft account.
- **Access Tokens**: We store authentication tokens locally in your browser to maintain your session. These tokens expire and are refreshed as needed.

### Service Data Captured
When you submit a service in WellSky Community Services, the Extension captures:
- Service type and dates
- Financial assistance information
- Service costs and units
- Need status and outcomes
- The URL of the page (to identify the client record)

### What We Do NOT Collect
- Passwords or login credentials for WellSky
- Personal client information beyond what's in the service form
- Browsing history outside of WellSky
- Any data from other websites

## How We Use Information

The captured service data is used solely for:
- Tracking TFA (Temporary Financial Assistance) services for SSVF program reporting
- Internal accounting and compliance purposes
- Generating reports for grant funders

## Data Storage and Security

- **Local Storage**: Authentication tokens are stored locally in your Chrome browser using Chrome's secure storage API.
- **Cloud Storage**: Service data is transmitted securely (HTTPS) to Azure Functions and stored in Azure Cosmos DB, hosted in the United States.
- **Access Control**: Only authenticated VOANLA employees with valid Microsoft Entra ID accounts can access the Extension and submit data.
- **Data Retention**: Service records are retained according to VOANLA's data retention policies and federal grant requirements.

## Data Sharing

We do not sell, trade, or otherwise transfer your information to outside parties. Data may be shared:
- With program funders as required for grant compliance
- When required by law or to protect our rights

## Your Rights

You may:
- Request access to data associated with your account
- Request correction of inaccurate data
- Request deletion of your data (subject to legal retention requirements)

Contact privacy@voanorthla.org for any requests.

## Permissions Used

The Extension requires these Chrome permissions:
- **storage**: To save your authentication session locally
- **identity**: To authenticate with Microsoft Entra ID
- **host_permissions (wscs.wellsky.com)**: To capture service data when you submit forms
- **host_permissions (graph.microsoft.com)**: To verify your Microsoft identity

## Changes to This Policy

We may update this privacy policy from time to time. We will notify users of any material changes through the Extension or via email.

## Contact Us

For questions about this privacy policy or the Extension:

**Volunteers of America of North Louisiana**
Email: privacy@voanorthla.org
Address: 360 Jordan Street, Shreveport, LA 71101

## Consent

By using the VOANLA TFA to SharePoint Extension, you consent to this privacy policy.
