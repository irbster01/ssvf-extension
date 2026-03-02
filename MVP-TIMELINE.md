# SSVF TFA — MVP Timeline & Readiness Analysis

> Generated: March 2, 2026

---

## TL;DR

**You're ~90% to MVP.** The entire capture-to-PO pipeline works end-to-end across all three platforms (Chrome extension, SWA dashboard, iOS app). What remains is mostly hardening and polish — not core feature work.

**Estimated time to shippable MVP: 3–5 working days** (solo dev pace).

---

## What's Done (Complete & Deployed)

### Core Workflow ✅

- WellSky form auto-capture (extension content script)
- Manual TFA submission (extension popup + SWA dashboard)
- Cosmos DB storage with partition strategy
- Dashboard: filter, sort, search, status tracking
- Full edit modal with vendor autocomplete
- Correction workflow: send back → notify submitter → submitter fixes → notify reviewer
- CSV export with proper escaping

### Authentication ✅

- Entra ID (MSAL) on SWA — redirect flow
- Entra ID on iOS — full PKCE via system browser
- Entra ID on extension — `chrome.identity` web auth flow
- Extension → SWA SSO token pass-through
- API token validation on all endpoints

### Messaging ✅

- Bidirectional message threads per submission
- Read receipts (per-message + bulk thread)
- Unread count badges (extension badge icon + dashboard indicators)
- SignalR real-time push on new messages
- Background polling fallback (extension service worker, 1-min interval)

### Email Notifications ✅ _(just deployed today)_

- New submission → `ssvf-notify@voanorthla.org`
- Correction needed → submitter's email
- Correction completed → `ssvf-notify@voanorthla.org`
- New message → recipient + `ssvf-notify@voanorthla.org`
- Standardized `[SSVF-TFA]` subject prefix for Outlook rules
- 34 unit tests covering all templates + send logic

### NetSuite Integration ✅

- Vendor search/autocomplete (live NetSuite data)
- GL account lookup
- Purchase order creation with line items
- Custom field mapping (assistance type → item, program → client type)
- Dry-run preview mode
- Attachment forwarding to PO

### File Attachments ✅

- Upload to Azure Blob Storage (`tfa-attachments` container)
- Download via time-limited SAS URLs
- Metadata tracked in Cosmos DB
- Forward attachments to NetSuite POs

### iOS App ✅

- Capacitor build with native PKCE auth
- Full Xcode project with signing config
- App Store submission docs written
- Responsive UI (mobile card layout)

### Infrastructure ✅

- Azure Functions v4 (18 endpoints deployed)
- Azure Static Web App with security headers + CSP
- Azure Cosmos DB (submissions + messages containers)
- Azure Blob Storage
- Azure SignalR Service (serverless mode)
- Microsoft Graph API (email)
- Rate limiting (Redis or in-memory fallback)
- Audit logging (Application Insights)
- Test suite: 71 tests across 5 suites, all passing

---

## What Remains — Prioritized

### P0 — Must-Fix Before Handing to Users (1–2 days)

| Item                                                 | Effort | Why                                                                         |
| ---------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| **Verify `.gitignore` covers `local.settings.json`** | 5 min  | Contains every production secret in plaintext                               |
| **Rotate secrets if repo was ever public/shared**    | 1 hr   | Cosmos key, NetSuite OAuth, Graph secret, Blob key, SignalR key             |
| **Verify NetSuite is pointing to production**        | 30 min | Current account ID is `9060623_SB1` — the `_SB1` suffix suggests sandbox    |
| **Remove `localhost` from CORS origins in prod**     | 30 min | Currently allows `http://localhost:*` in deployed functions                 |
| **Smoke-test email notifications end-to-end**        | 1 hr   | Just deployed + fixed env var — needs manual verification of all 4 triggers |

### P1 — Should Ship With MVP (2–3 days)

| Item                                 | Effort   | Why                                                                                                                                        |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Role-based access control**        | 2–3 days | Any authenticated user can currently view all submissions, update any status, create POs. Need at minimum admin vs. caseworker distinction |
| **Centralize CORS origins**          | 1 hr     | Copy-pasted in every function file — one missed update = CORS bug                                                                          |
| **Add pagination to GetSubmissions** | 1 day    | Works fine now but will degrade as submission count grows                                                                                  |

### P2 — Nice for MVP, Not Blocking (1–2 days)

| Item                            | Effort | Why                                                                                  |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| **Error boundaries in React**   | 2 hrs  | Unhandled error currently crashes entire popup/dashboard                             |
| **Extension auth → PKCE**       | 1 day  | Currently uses deprecated implicit grant; not a security emergency for internal tool |
| **Chrome Web Store submission** | 2 hrs  | Docs written, just need screenshots + promotional images + submit                    |
| **App Store submission**        | 2 hrs  | Docs written, TestFlight tested, just need screenshots + submit                      |

### P3 — Post-MVP Backlog

| Item                                      | Effort   | Why                                                                       |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------- |
| Frontend/extension unit tests             | 2–3 days | API tests exist; frontend has none                                        |
| Offline support for iOS                   | 2–3 days | No service worker caching or offline queue                                |
| Cryptographic JWT verification            | 1–2 days | Current decode-only is documented trade-off; acceptable for internal tool |
| Dashboard performance (virtualized lists) | 1 day    | Fine for current data volume                                              |

---

## Timeline Options

### Option A: Minimum Viable Launch (3 days)

```
Day 1:  P0 items — secrets audit, NetSuite prod config, CORS cleanup, email smoke test
Day 2:  RBAC — basic admin/caseworker role gate on API endpoints
Day 3:  RBAC frontend integration + pagination + final testing
→ Ship
```

### Option B: Polished Launch (5 days)

```
Days 1–3:  Same as Option A
Day 4:     Error boundaries, centralize CORS, extension → PKCE auth
Day 5:     Chrome Store + App Store submissions, end-to-end regression testing
→ Ship all platforms
```

### Option C: Bulletproof Launch (8 days)

```
Days 1–5:  Same as Option B
Days 6–7:  Frontend test coverage, offline iOS support
Day 8:     Load testing, monitoring dashboard setup, documentation
→ Ship with confidence
```

---

## Architecture Snapshot

```
┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Chrome Ext      │    │  SWA Dashboard   │    │  iOS App         │
│  (MV3)           │    │  (React/Vite)    │    │  (Capacitor)     │
│  - Auto-capture  │    │  - Dashboard     │    │  - Native auth   │
│  - Manual entry  │    │  - Analytics     │    │  - Mobile layout │
│  - Messaging     │    │  - NetSuite PO   │    │  - Push (badge)  │
└───────┬──────────┘    └───────┬──────────┘    └───────┬──────────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Azure Functions v4   │
                    │  18 HTTP endpoints    │
                    │  - Entra ID auth      │
                    │  - Rate limiting      │
                    │  - Audit logging      │
                    └──┬────┬────┬────┬─────┘
                       │    │    │    │
              ┌────────┘    │    │    └────────┐
              ▼             ▼    ▼             ▼
         ┌─────────┐  ┌────────┐ ┌─────────┐ ┌──────────┐
         │Cosmos DB│  │ Blob   │ │ SignalR  │ │ Graph    │
         │ 2 cont. │  │Storage │ │ Service  │ │ (email)  │
         └─────────┘  └────────┘ └─────────┘ └──────────┘
                                                   │
                                          ┌────────┘
                                          ▼
                                    ┌───────────┐
                                    │ NetSuite  │
                                    │ (PO/Acct) │
                                    └───────────┘
```

---

## Risk Register

| Risk                                      | Likelihood          | Impact   | Mitigation                                                |
| ----------------------------------------- | ------------------- | -------- | --------------------------------------------------------- |
| WellSky UI change breaks capture          | Medium              | High     | Content script relies on DOM classes; monitor for changes |
| Secret exposure via `local.settings.json` | Low (if gitignored) | Critical | Audit now, rotate if any doubt                            |
| Cosmos DB costs spike with volume         | Low                 | Medium   | Monitor RUs; pagination will help                         |
| NetSuite sandbox vs production mismatch   | Medium              | High     | Verify `NETSUITE_ACCOUNT_ID` before launch                |
| Single-developer bus factor               | High                | High     | This document + code comments + test suite help           |

---

## Bottom Line

The heavy lifting is done. Every feature in the capture → review → PO pipeline works. The remaining work is security hardening (secrets, RBAC), operational polish (pagination, CORS), and store submissions. **3 days to functional MVP, 5 days to polished multi-platform launch.**
