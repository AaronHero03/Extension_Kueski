# KueskiPay Browser Extension

A Chrome (Manifest V3) extension that integrates KueskiPay into any online shopping experience. It detects partner stores, surfaces cashback benefits in real time, lets users simulate purchases, and shows payment plans — all from a popup or a contextual in-page notification.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Architecture Overview](#2-architecture-overview)
3. [Manifest V3 and the Three Execution Contexts](#3-manifest-v3-and-the-three-execution-contexts)
4. [Background Service Worker (`background.js`)](#4-background-service-worker-backgroundjs)
5. [Content Script (`content-script.js`)](#5-content-script-content-scriptjs)
6. [Popup (`popup.html` / `popup.js`)](#6-popup-popuphtml--popupjs)
7. [API Client (`api.js`)](#7-api-client-apijs)
8. [Communication Flows — Step by Step](#8-communication-flows--step-by-step)
9. [Data Stored in `chrome.storage.local`](#9-data-stored-in-chromestoragelocal)
10. [UI Views and State Machine](#10-ui-views-and-state-machine)
11. [In-Page Notifications (Shadow DOM)](#11-in-page-notifications-shadow-dom)
12. [Badge System](#12-badge-system)
13. [Price Scraping](#13-price-scraping)
14. [Loading the Extension Locally](#14-loading-the-extension-locally)

---

## 1. Project Structure

```
Extension/
├── manifest.json                  # Extension metadata & permission declarations
├── package.json
└── src/
    ├── api.js                     # Shared HTTP client (used by background AND popup)
    ├── background.js              # Service worker: badge, session, message router
    ├── content/
    │   ├── content-script.js      # Injected into every page
    │   ├── styles.css             # (unused by content-script, kept for reference)
    │   ├── notification.html      # (reference template, not loaded at runtime)
    │   └── kueski.png             # Logo accessible from page context
    └── popup/
        ├── popup.html             # Full popup SPA with 5 views
        ├── popup.js               # Popup controller
        ├── popup.css              # Popup styles
        └── normalize.css
```

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        BROWSER TAB                           │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Web Page (any domain)                   │    │
│  │                                                      │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │           content-script.js                 │    │    │
│  │  │  • Detects if page is a partner store        │    │    │
│  │  │  • Scrapes product price (Amazon/Walmart)    │    │    │
│  │  │  • Renders in-page notification (Shadow DOM) │    │    │
│  │  │  • Sends: CHECK_STORE, OPEN_SIMULATE         │    │    │
│  │  └──────────────────┬──────────────────────────┘    │    │
│  └─────────────────────│──────────────────────────────-┘    │
│                        │ chrome.runtime.sendMessage          │
└────────────────────────│─────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────────┐
│                 background.js (Service Worker)                  │
│                                                                 │
│  • Owns chrome.storage.local  (token, user, detectedPrice,     │
│    pendingView)                                                 │
│  • Calls REST API via api.js                                    │
│  • Updates extension badge (tab icon "CB" indicator)           │
│  • Message handler: CHECK_STORE | GET_SESSION | LOGIN |        │
│    LOGOUT | OPEN_SIMULATE                                       │
└──────────────┬─────────────────────────┬───────────────────────┘
               │ chrome.runtime.sendMessage│ chrome.storage.local
               │ (response)               │ (direct read/write)
               ▼                          ▼
┌──────────────────────────┐    ┌──────────────────────────────┐
│   popup.js (Popup)       │    │  chrome.storage.local        │
│                          │    │                              │
│  • SPA with 5 views      │◄───│  token, user, detectedPrice, │
│  • Calls api.js directly │    │  pendingView                 │
│    (no proxy needed)     │    └──────────────────────────────┘
│  • Reads detectedPrice   │
│    for auto-fill         │
└──────────────────────────┘
```

> **Key insight:** The popup calls `api.js` directly for most operations (dashboard, loans, simulate). It only needs to communicate with the background for a few things that require background-level privileges (session verification via `GET_SESSION`). For everything else — login, logout, API calls — the popup handles them independently.

---

## 3. Manifest V3 and the Three Execution Contexts

Chrome extensions in Manifest V3 have three isolated JavaScript contexts:

| Context | File | Lifecycle | DOM Access | `fetch` | `chrome.tabs` |
|---|---|---|---|---|---|
| **Service Worker** | `background.js` | Ephemeral, event-driven | No | Yes | Yes |
| **Content Script** | `content-script.js` | Lives as long as the tab | Yes (host page DOM) | Yes (but CORS-limited by page) | No (only `chrome.runtime`) |
| **Popup** | `popup.js` | Lives while popup is open | Yes (popup's own DOM) | Yes | Yes |

Because they are isolated, they communicate via **`chrome.runtime.sendMessage`** (for one-time requests) and **`chrome.storage.local`** (for shared persistent state).

### Module System

`background.js` and `popup.js` use **ES Modules** (`import`/`export`). This is declared in `manifest.json`:

```json
"background": {
  "service_worker": "src/background.js",
  "type": "module"
}
```

And in the popup HTML:

```html
<script type="module" src="popup.js"></script>
```

The content script does **not** use modules — it runs as a plain script injected by the browser.

---

## 4. Background Service Worker (`background.js`)

[src/background.js](src/background.js)

The service worker is the **central coordinator**. It wakes up on events (tab updates, messages) and goes to sleep when idle.

### 4.1 Badge Logic

Two tab events trigger `updateBadge(tabId, url)`:

- `chrome.tabs.onUpdated` — fires when a tab finishes loading (`changeInfo.status === "complete"`)
- `chrome.tabs.onActivated` — fires when the user switches to a different tab

```
updateBadge(tabId, url)
  │
  ├─ url does not start with "http"? → clear badge
  ├─ no token in storage?            → clear badge
  └─ call checkBenefits(domain)
       ├─ is_partner = true  → set badge text "CB", color #f97316 (orange)
       └─ is_partner = false → clear badge
```

The badge is a small overlay on the extension icon in Chrome's toolbar. When the user is on a partner store while logged in, the icon shows **"CB"** (Cashback) in orange.

### 4.2 Message Handler

The background acts as a **message router** for privileged operations. All messages follow the pattern `{ type: string, payload?: object }`.

```javascript
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true; // IMPORTANT: keeps the channel open for async responses
});
```

`return true` is critical — without it, Chrome closes the response channel before the async `handleMessage` resolves.

#### Handled Message Types

| Type | Sender | What it does |
|---|---|---|
| `CHECK_STORE` | Content Script | Calls `checkBenefits(domain)`, returns store data + `isLoggedIn` + `user` |
| `GET_SESSION` | Popup | Verifies token with API, clears storage on failure |
| `LOGIN` | (available but popup calls api.js directly) | Calls `login()`, persists token+user |
| `LOGOUT` | Popup | Removes `token` and `user` from storage |
| `OPEN_SIMULATE` | Content Script | Sets `pendingView: "simulate"` in storage, tries `chrome.action.openPopup()` |

---

## 5. Content Script (`content-script.js`)

[src/content/content-script.js](src/content/content-script.js)

Injected into **every page** (`"matches": ["<all_urls>"]`) at `document_end` (after the DOM is fully parsed).

### 5.1 Initialization Sequence

```
1. Read current domain (strip "www.")
2. Check if current path matches a cart/checkout URL
3. Send CHECK_STORE to background
4. In callback:
   ├─ is_partner = false → do nothing
   ├─ is_partner = true AND isCartPage AND isLoggedIn → showCartNotification()
   └─ is_partner = true AND (not cart OR not logged in) → showSilentNotification()
5. If domain matches a known scraper → run scraper + start MutationObserver
```

### 5.2 Cart Page Detection

The path is checked against a hardcoded list:

```javascript
const CART_PATHS = ["/cart", "/carrito", "/bolsa", "/cesta", "/checkout", "/bag"];
```

### 5.3 Communication with Background

The content script can only communicate outward via `chrome.runtime.sendMessage`. It **cannot** call the REST API directly with auth because it doesn't own the token — the token lives in `chrome.storage.local`, which in theory is accessible from content scripts, but the design centralizes API calls in the background and popup to keep concerns clean.

```javascript
// Sends to background, receives enriched store data
chrome.runtime.sendMessage(
  { type: "CHECK_STORE", payload: { domain: currentDomain } },
  (response) => {
    // response = { is_partner, cashback_percentage, id_partner, isLoggedIn, user }
  }
);

// Sends to background to open the simulate view
chrome.runtime.sendMessage({ type: "OPEN_SIMULATE" });
```

---

## 6. Popup (`popup.html` / `popup.js`)

[src/popup/popup.html](src/popup/popup.html) · [src/popup/popup.js](src/popup/popup.js)

The popup is a **single-page application** (SPA). All 5 views exist in the DOM at all times; only one is visible at a time by toggling the `.hidden` CSS class.

### 6.1 View Structure

```
view-loading   → Shown during init() while token is verified
view-login     → Email + password form
view-main      → Dashboard: balance, cashback, partner section, loans link
view-simulate  → Amount input for purchase simulation
view-plans     → Payment plans returned by the API
view-loans     → Active loans summary + list
```

### 6.2 Init Flow

```
init()
  │
  ├─ Show view-loading
  ├─ Query active tab URL  (chrome.tabs.query)
  ├─ Read token from storage
  │    ├─ no token → show view-login
  │    └─ token found:
  │         ├─ verifyToken() (direct API call)
  │         │    ├─ success → loadMain()
  │         │    └─ failure → show view-login
  │         └─ read user from storage
```

### 6.3 Main View Flow (`loadMain`)

```
loadMain()
  │
  ├─ show view-main
  ├─ getDashboard() → populate balance & cashback cards
  ├─ if simulationPreview exists → show delta previews on balance/cashback cards
  ├─ checkCurrentPartner() → calls checkBenefits(domain) for active tab
  │    └─ is_partner → showPartnerSection()
  └─ check pendingView in storage
       └─ pendingView === "simulate" AND is_partner → loadSimulate()
```

### 6.4 Simulate Flow

```
User clicks "Simular compra"
  │
  ├─ loadSimulate()
  │    └─ read detectedPrice from storage → pre-fill amount input
  │
  └─ User clicks "Ver planes de pago"
       ├─ validate monto > 0
       ├─ simulateTransaction(monto, id_partner)  (API call)
       ├─ store result in state.simulationPreview
       └─ loadMain()  ← balance/cashback cards now show simulation deltas
            └─ showPartnerSection() shows "Ganarás $X MXN" + "Ver planes de pago" button
```

### 6.5 Popup ↔ Background Communication

The popup rarely needs to talk to the background. The only case is **session verification at startup**:

```javascript
// popup.js init() — calls API directly, no background needed
await verifyToken();
```

Logout is also handled entirely within the popup:

```javascript
await storage.remove(["token", "user"]);
loadView("view-login");
```

The popup **does not** send `LOGIN` or `LOGOUT` messages to the background — it calls `api.js` and `chrome.storage.local` directly. The background only handles those message types if another context were to call them.

---

## 7. API Client (`api.js`)

[src/api.js](src/api.js)

Shared module imported by both `background.js` and `popup.js`. It provides a thin wrapper around `fetch`.

### Base URL

```javascript
const RENDER_URL = "https://rest-api-kueski.onrender.com";
const LOCAL_URL  = "http://localhost:3000";
let local = false;  // flip to true to develop against local server

const BASE_URL = local ? LOCAL_URL : RENDER_URL;
```

### The `request()` Helper

```javascript
async function request(path, { auth = true, method = "GET", body } = {})
```

- Reads the token from `chrome.storage.local` for authenticated requests
- Sets `Content-Type: application/json` and `Authorization: Bearer <token>`
- Throws an enriched `Error` with `err.status` on non-2xx responses

### Exported Functions

| Function | Method | Endpoint | Auth |
|---|---|---|---|
| `login(email, password)` | POST | `/auth/login` | No |
| `verifyToken()` | GET | `/auth/verify` | Yes |
| `getDashboard()` | GET | `/users/me/dashboard` | Yes |
| `getLoans()` | GET | `/users/loans` | Yes |
| `checkBenefits(domain)` | GET | `/commerce/benefits?domain=…` | Yes |
| `simulateTransaction(monto, id_partner)` | POST | `/transactions/simulate` | Yes |
| `trackIntent(monto, id_partner, url)` | POST | `/transactions` | Yes |
| `confirmTransaction(id)` | POST | `/transactions/:id/confirm` | Yes |

---

## 8. Communication Flows — Step by Step

### Flow 1: User navigates to a partner store (logged in)

```
Browser loads amazon.com.mx
        │
        ├─► content-script.js executes
        │     └─ sendMessage({ type: "CHECK_STORE", payload: { domain: "amazon.com.mx" } })
        │
        ├─► background.js handleMessage("CHECK_STORE")
        │     ├─ getToken() from storage
        │     ├─ getUser() from storage
        │     ├─ checkBenefits("amazon.com.mx") → GET /commerce/benefits?domain=amazon.com.mx
        │     └─ sendResponse({ is_partner: true, cashback_percentage: 5, id_partner: 3,
        │                        isLoggedIn: true, user: {...} })
        │
        ├─► content-script.js callback
        │     └─ isCartPage? → showCartNotification(5)  OR  showSilentNotification(5)
        │
        └─► background.js tabs.onUpdated listener (fires in parallel)
              └─ updateBadge(tabId, "https://amazon.com.mx/...")
                   └─ set badge "CB" orange
```

### Flow 2: User clicks the cart notification pill → popup opens on Simulate view

```
User clicks cart notification pill
        │
        ├─► content-script.js
        │     └─ sendMessage({ type: "OPEN_SIMULATE" })
        │
        ├─► background.js handleMessage("OPEN_SIMULATE")
        │     ├─ storage.set({ pendingView: "simulate" })
        │     └─ chrome.action.openPopup()  ← may fail without direct user gesture
        │
        └─► popup.js init()
              ├─ verifyToken() → success
              └─ loadMain()
                   ├─ checkCurrentPartner() → is_partner = true
                   ├─ storage.get("pendingView") → "simulate"
                   ├─ storage.remove(["pendingView"])
                   └─ loadSimulate()  ← navigates directly to simulate view
```

### Flow 3: User simulates a purchase

```
User is on view-simulate, enters amount $1500
        │
        ├─► popup.js btn-simulate click handler
        │     ├─ simulateTransaction(1500, id_partner)
        │     │     └─ POST /transactions/simulate { monto: 1500, id_partner: 3 }
        │     ├─ state.simulationPreview = { monto: 1500, cashback_to_earn: 75,
        │     │                               payment_plans: [...], is_approved: true }
        │     └─ loadMain()
        │           ├─ getDashboard() → balance = $5000, cashback = $200
        │           ├─ balance-card shows:
        │           │    "5000 MXN"
        │           │    "(- $1500.00 MXN)"
        │           │    "= $3500.00 MXN"
        │           ├─ cashback-card shows:
        │           │    "200 MXN"
        │           │    "(+ $75 MXN)"
        │           │    "= $275.00 MXN"
        │           └─ partner section shows "Ganarás $75 MXN" + "Ver planes de pago"
```

### Flow 4: Popup opens cold (no prior simulation)

```
User clicks extension icon
        │
        └─► popup.js init()
              ├─ show view-loading
              ├─ chrome.tabs.query → get active tab URL
              ├─ storage.get("token")
              │    ├─ null → loadView("view-login")
              │    └─ found:
              │         ├─ verifyToken() → GET /auth/verify
              │         │    ├─ 200 OK → loadMain()
              │         │    └─ 401 → loadView("view-login")
              │         └─ storage.get("user") → state.user
              └─ loadMain()
                   ├─ getDashboard()
                   ├─ checkCurrentPartner()
                   └─ check pendingView (none) → stay on main
```

---

## 9. Data Stored in `chrome.storage.local`

`chrome.storage.local` is the **shared memory bus** between all contexts. All three contexts (background, content script, popup) can read and write it.

| Key | Type | Written by | Read by | Description |
|---|---|---|---|---|
| `token` | `string` | popup (login), background (LOGIN msg) | background, api.js | JWT auth token |
| `user` | `object` | popup (login), background (LOGIN msg) | popup, background | `{ nombre, email, ... }` |
| `detectedPrice` | `number` | content-script (price scraper) | popup (simulate view) | Auto-detected product price |
| `pendingView` | `string` | background (OPEN_SIMULATE msg) | popup (init) | Deferred navigation intent |

---

## 10. UI Views and State Machine

The popup has an in-memory `state` object that drives the UI:

```javascript
const state = {
  user: null,
  dashboard: null,
  currentTabUrl: null,
  currentPartner: null,       // { domain, is_partner, id_partner, cashback_percentage }
  simulationPreview: null,    // { monto, cashback_to_earn, payment_plans, is_approved }
};
```

View transitions:

```
view-loading ──► view-login
             └─► view-main ──► view-simulate ──► view-main
                          └──► view-plans    ◄── view-main
                          └──► view-loans    ◄── view-main
```

`loadView(id)` hides all views with class `.view` and removes `.hidden` only from the target view. The `hidden` CSS class uses `display: none !important` so no view partially overlaps another.

---

## 11. In-Page Notifications (Shadow DOM)

[src/content/content-script.js](src/content/content-script.js) — `showSilentNotification()` and `showCartNotification()`

Both notifications use the **Shadow DOM** to fully isolate their styles from the host page. This prevents the extension's CSS from leaking into the page and prevents the page's CSS from overriding the notification styles.

```javascript
const container = document.createElement("div");
const shadow = container.attachShadow({ mode: "open" });
shadow.innerHTML = `<style>...</style><div class="...">...</div>`;
document.body.appendChild(container);
```

### Silent Notification (non-cart pages)

- Position: **top-right**, fixed
- Shape: pill (border-radius 50px)
- Content: Kueski logo + checkmark SVG + "Cashback del X% activo"
- Auto-dismisses after **3 seconds** with a `fadeOutRight` animation
- Has a manual close button (×)

### Cart Notification (cart/checkout pages, logged-in users)

- Position: **bottom-right**, fixed
- Shape: rounded card (border-radius 16px)
- Content: "¡Simula tu compra con KueskiPay!" + cashback percentage
- Clicking the card sends `OPEN_SIMULATE` to background → opens popup on simulate view
- Has a separate close button that stops propagation so clicking × doesn't also trigger navigation

---

## 12. Badge System

The extension icon badge shows **"CB"** (orange) when the user is:
1. Logged in (token in storage)
2. Browsing a page whose domain is a KueskiPay partner store

The badge is cleared when:
- The tab URL doesn't start with `http` (e.g., `chrome://`, `about:blank`)
- The user is not logged in
- The domain is not a partner store
- `checkBenefits()` throws any error

Badge updates are triggered both on tab load complete (`onUpdated`) and on tab switch (`onActivated`), so the icon always reflects the currently visible tab.

---

## 13. Price Scraping

[src/content/content-script.js:40-110](src/content/content-script.js)

When the content script detects it is running on a supported domain, it:

1. Runs a **one-time scrape** immediately on load
2. Starts a **`MutationObserver`** to re-scrape whenever the DOM changes (debounced 500ms)
3. Writes the detected price to `chrome.storage.local` key `detectedPrice`
4. The popup's simulate view reads `detectedPrice` on open to pre-fill the amount input

### Supported Scrapers

| Domain | Strategy |
|---|---|
| `amazon.com.mx` | Tries 7 CSS selectors in order of specificity; uses first non-null result |
| `walmart.com.mx` | Tries `[itemprop="price"]` meta attribute first, then 3 fallback selectors |

The `parsePrice()` helper strips non-numeric characters and returns `null` for invalid/zero values.

---

## 14. Loading the Extension Locally

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `Extension/` directory (the one containing `manifest.json`)
5. The extension icon appears in the toolbar

To point at a local API server instead of the deployed one, open [src/api.js](src/api.js) and set:

```javascript
let local = true;
```

The local server must be running on `http://localhost:3000` (declared in `host_permissions` in the manifest so the extension can make requests to it).

> **Note:** `chrome.action.openPopup()` used in the `OPEN_SIMULATE` message handler requires a direct user gesture in most Chrome versions. If the popup doesn't open automatically when clicking the in-page cart notification, the `pendingView: "simulate"` flag saved to storage ensures the popup navigates directly to the simulate view the next time the user opens it manually.
