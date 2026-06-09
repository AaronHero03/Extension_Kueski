# Extension Architecture

## Overview

KueskiPay is a **Chrome Extension (Manifest V3)** that lets users check their balance, simulate purchases, and view active loans — all from a popup — while they shop on partner stores.

---

## Components

The extension has four distinct parts that each run in a different context:

| Component | File | Context | Runs when |
| --- | --- | --- | --- |
| Popup | `src/popup/popup.{html,js,css}` | Isolated popup window | User clicks the extension icon |
| Background | `src/background.js` | Service worker (background) | Browser starts; reactivated by events |
| Content Script | `src/content/content-script.js` | Injected into web pages | Every page load |
| API Client | `src/api.js` | Imported by popup | When popup makes HTTP requests |

---

## Communication Map

The four components cannot share memory — they communicate through Chrome APIs:

```text
                    ┌─────────────────────────────────┐
                    │         Web Page (DOM)           │
                    │   content-script.js (injected)   │
                    │                                  │
                    │  • scrapes product price         │
                    │  • shows cashback notifications  │
                    └────────────┬───────────┬─────────┘
                                 │ sendMessage│ storage.set
                                 ▼            ▼
                    ┌────────────────────────────────┐
                    │       background.js            │
                    │       (service worker)         │
                    │                                │
                    │  • handles CHECK_STORE msg     │
                    │  • manages extension badge     │
                    │  • sets pendingView in storage │
                    │  • calls chrome.action.openPopup│
                    └────────────────────────────────┘
                                 │ storage.get / set
                                 ▼
                    ┌────────────────────────────────┐
                    │         popup.js               │
                    │                                │
                    │  • reads token, user,          │
                    │    detectedPrice, pendingView  │
                    │  • calls api.js for HTTP       │
                    └────────────────────────────────┘
                                 │ fetch
                                 ▼
                    ┌────────────────────────────────┐
                    │        KueskiPay API           │
                    │  (Render.com / localhost:3000) │
                    └────────────────────────────────┘
```

---

## Chrome Storage Keys

All shared state lives in `chrome.storage.local`. No component stores persistent state in memory.

| Key | Type | Set by | Read by | Purpose |
| --- | --- | --- | --- | --- |
| `token` | `string` | popup (on login) | popup, background | JWT for API requests |
| `user` | `object` | popup (on login) | popup, background | `{ id_cliente, nombre, email }` |
| `detectedPrice` | `number` | content-script | popup | Product price scraped from the current page |
| `pendingView` | `string` | background | popup | Tells popup which view to open (`"simulate"`) |

---

## File Structure

```text
Extension/
├── manifest.json                  # Extension configuration (Manifest V3)
├── src/
│   ├── api.js                     # HTTP client — all API calls go through here
│   ├── background.js              # Service worker — badge, messaging, session
│   ├── content/
│   │   ├── content-script.js      # Injected into every page
│   │   └── kueski.png             # Logo used in in-page notifications
│   └── popup/
│       ├── popup.html             # HTML for all six views
│       ├── popup.js               # View logic and event listeners
│       ├── popup.css              # All popup styles
│       ├── normalize.css          # CSS reset
│       └── kueski.png             # Logo used in popup header
└── docs/                          # This documentation
```

---

## Manifest Summary (`manifest.json`)

```json
{
  "manifest_version": 3,
  "permissions": ["storage", "activeTab", "tabs"],
  "action": { "default_popup": "src/popup/popup.html" },
  "background": { "service_worker": "src/background.js", "type": "module" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["src/content/content-script.js"],
    "run_at": "document_end"
  }]
}
```

- `storage` — read/write `chrome.storage.local`
- `activeTab` — access the URL of the current tab without broad host permissions
- `tabs` — query all tabs (needed for badge updates on tab switches)
- Content scripts run on `<all_urls>` at `document_end` (after the DOM is ready)

---

## API Client (`src/api.js`)

All HTTP communication is centralized in `api.js`. It exposes named functions that popup.js and background.js import directly.

```js
const BASE_URL = local ? "http://localhost:3000" : "https://rest-api-kueski.onrender.com";
```

Toggle `local = true` to point the extension at a local API server during development.

Every request automatically reads the stored JWT and attaches it as `Authorization: Bearer <token>`.

| Exported function | HTTP call |
| --- | --- |
| `login(email, password)` | `POST /auth/login` |
| `verifyToken()` | `GET /auth/verify` |
| `getDashboard()` | `GET /users/me/dashboard` |
| `getLoans()` | `GET /users/loans` |
| `checkBenefits(domain)` | `GET /commerce/benefits?domain=` |
| `simulateTransaction(monto, id_partner)` | `POST /transactions/simulate` |
| `trackIntent(monto, id_partner, url)` | `POST /transactions` |
| `confirmTransaction(id)` | `POST /transactions/:id/confirm` |

---

## Further Reading

- [POPUP.md](./POPUP.md) — Views, state management, and navigation logic
- [BACKGROUND.md](./BACKGROUND.md) — Service worker, badge, and message handling
- [CONTENT_SCRIPT.md](./CONTENT_SCRIPT.md) — Price scraping and in-page notifications
