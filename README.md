# KueskiPay — Project Overview

KueskiPay is a Chrome Extension that lets users manage their KueskiPay credit balance, simulate purchases with cashback, and view active loans — directly in their browser while shopping at partner stores.

The project is split into two independent parts:

| Part          | Technology                     | Location |
| ------------- | ------------------------------ | -------- |
| **API**       | Node.js + Express.js + MySQL   | `API/`   |
| **Extension** | Chrome Extension (Manifest V3) | ``       |

---

## System Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                        Chrome Browser                        │
│                                                              │
│   ┌─────────────────┐      ┌──────────────────────────────┐  │
│   │  Popup (UI)     │      │  Content Script (injected)   │  │
│   │  popup.html/js  │      │  content-script.js           │  │
│   │                 │      │                              │  │
│   │  6 views:       │      │  • scrapes product price     │  │
│   │  login, main,   │      │  • shows cashback badges     │  │
│   │  simulate,      │      │  • triggers simulate flow    │  │
│   │  plans, loans,  │      └──────────┬───────────────────┘  │
│   │  loading        │                 │ sendMessage           │
│   └────────┬────────┘      ┌──────────▼───────────────────┐  │
│            │ import        │  Background (service worker)  │  │
│            ▼               │  background.js               │  │
│   ┌─────────────────┐      │                              │  │
│   │  api.js         │      │  • badge updates             │  │
│   │  HTTP client    │      │  • session management        │  │
│   └────────┬────────┘      │  • OPEN_SIMULATE handler     │  │
│            │               └──────────────────────────────┘  │
└────────────┼─────────────────────────────────────────────────┘
             │ fetch (HTTPS)
             ▼
┌──────────────────────────────────────────────────────────────┐
│                     KueskiPay REST API                       │
│               Node.js + Express.js (Render.com)              │
│                                                              │
│   POST /auth/login          GET /users/me/dashboard          │
│   GET  /auth/verify         GET /users/loans                 │
│   GET  /commerce/benefits   POST /transactions/simulate      │
│   POST /transactions        POST /transactions/:id/confirm   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
             │ mysql2/promise
             ▼
┌──────────────────────────────────────────────────────────────┐
│                      MySQL Database                          │
│                                                              │
│   cliente · cuenta · cashback · prestamo                     │
│   solicitud_prestamo · tiendas_partner                       │
│   transaccion · solicitud_cb · aprobacion_cb                 │
└──────────────────────────────────────────────────────────────┘
```

---

## Core User Flow

```text
1. User installs the extension and logs in via the popup
         ↓
2. User navigates to a partner store (e.g. amazon.com.mx)
         ↓
3. Content script detects the domain → background confirms it's a partner
         ↓
4. A cashback badge appears on the page ("Cashback del 2.50% activo")
         ↓
5. On a cart/checkout page, a card notification appears instead
   "¡Simula tu compra con KueskiPay!"
         ↓
6. User clicks the notification → popup opens directly on the Simulate view
   (or user opens the popup and presses "Simular compra")
         ↓
7. Amount is pre-filled from the scraped product price (Amazon / Walmart)
         ↓
8. User confirms the amount → API calculates payment plans + cashback to earn
         ↓
9. Main view updates: credit card shows new projected balance,
   right column shows earned cashback in green
         ↓
10. User can view the 3 / 6 / 12 installment plans
```

---

## Partner Stores

The following stores are recognized by the extension and registered in the database:

| Store          | Domain              | Cashback |
| -------------- | ------------------- | -------- |
| Liverpool      | liverpool.com.mx    | 3.00%    |
| Amazon México  | amazon.com.mx       | 2.50%    |
| Mercado Libre  | mercadolibre.com.mx | 4.00%    |
| Walmart México | walmart.com.mx      | 2.00%    |
| Coppel         | coppel.com          | 3.50%    |

---

## Quick Start

### API

```bash
cd API
npm install
# Create .env with DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET
npm start
# → http://localhost:3000
```

[API/docs/SETUP.md](https://github.com/AaronHero03/REST_API_Kueski/blob/main/API/docs/SETUP.md) | Installation, schema, seed data, and verification | for the full setup guide including database schema and seed data.

### Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `` folder
4. The KueskiPay icon appears in the toolbar

To point the extension at a local API server, open `src/api.js` and set `local = true`.

---

## Documentation Index

### API

| Document                                                                                                      | Contents                                                  |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [API/docs/ARCHITECTURE.md](https://github.com/AaronHero03/REST_API_Kueski/blob/main/API/docs/ARCHITECTURE.md) | Express structure, route map, request lifecycle, env vars |
| [API/docs/AUTH.md](https://github.com/AaronHero03/REST_API_Kueski/blob/main/API/docs/AUTH.md)                 | JWT authentication flow and middleware                    |
| [API/docs/ENDPOINTS.md](https://github.com/AaronHero03/REST_API_Kueski/blob/main/API/docs/ENDPOINTS.md)       | Full endpoint reference with request/response examples    |
| [API/docs/DATABASE.md](https://github.com/AaronHero03/REST_API_Kueski/blob/main/API/docs/DATABASE.md)         | ER diagram and SQL queries per endpoint                   |
| [API/docs/SETUP.md](https://github.com/AaronHero03/REST_API_Kueski/blob/main/API/docs/SETUP.md)               | Installation, schema, seed data, and verification         |

### Extension

| Document                                         | Contents                                                |
| ------------------------------------------------ | ------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)     | Component overview, communication map, storage keys     |
| [docs/POPUP.md](docs/POPUP.md)                   | Views, state object, navigation logic, CSS architecture |
| [docs/BACKGROUND.md](docs/BACKGROUND.md)         | Service worker, badge management, message types         |
| [docs/CONTENT_SCRIPT.md](docs/CONTENT_SCRIPT.md) | Price scraping, MutationObserver, notifications         |

---

## Key Technical Details

### Authentication

The API uses stateless JWT authentication. The extension stores the token in `chrome.storage.local` after login and attaches it to every API request via `Authorization: Bearer <token>`. Tokens expire after 2 hours.

### Transaction Simulation

Simulation is read-only — no database records are created. The API calculates whether the user's balance + cashback covers the purchase, the cashback to earn, and three payment plan options (3, 6, 12 months at 8% annual interest).

### Atomic Cashback Confirmation

When a purchase is confirmed (`POST /transactions/:id/confirm`), the API runs four SQL statements inside a single database transaction (`BEGIN` / `COMMIT`). If any step fails, the entire operation is rolled back — the user's cashback balance is never partially updated.

### Price Auto-Detection

The content script scrapes the product price from Amazon and Walmart pages using DOM selectors. A `MutationObserver` re-runs the scraper when the DOM changes (e.g., variant selection), with a 500ms debounce. The detected price is stored in `chrome.storage.local` and pre-fills the simulate form automatically.

### Shadow DOM Isolation

In-page notifications are rendered inside a Shadow DOM root. This prevents the host page's styles from breaking the notification layout and avoids CSS class conflicts.
