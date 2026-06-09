# Popup — Views, State, and Navigation

## Overview

The popup is a self-contained single-page application rendered in `popup.html`. It has **six views** defined as `<div class="view">` elements. Only one view is visible at a time — the rest have the `hidden` class.

All logic lives in `popup.js` (ES Module). Styles are in `popup.css`.

---

## Views

| View ID | Description | Shown when |
| --- | --- | --- |
| `view-loading` | Spinner while session is verified | App starts |
| `view-login` | Email + password form | No stored token, or token expired |
| `view-main` | Credit card, stats, partner section | User is authenticated |
| `view-simulate` | Amount input field | User clicks "Simular compra" |
| `view-plans` | List of payment plan cards | Simulation is approved |
| `view-loans` | Active loans list | User clicks "Ver mis préstamos" |

Navigation between views is handled by `loadView(id)`:

```js
function loadView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  $(id).classList.remove("hidden");
}
```

---

## State Object

`popup.js` maintains a single in-memory state object for the duration of the popup session:

```js
const state = {
  user: null,            // { id_cliente, nombre, email } — from chrome.storage after login
  dashboard: null,       // full response from GET /users/me/dashboard
  currentTabUrl: null,   // URL of the active browser tab
  currentPartner: null,  // { domain, is_partner, id_partner?, cashback_percentage }
  simulationPreview: null // { monto, cashback_to_earn, payment_plans, is_approved }
};
```

This state is reset each time the popup opens. Persistent data (token, user, detectedPrice) is read from `chrome.storage.local` as needed.

---

## Initialization Flow

```text
init()
  │
  ├── loadView("view-loading")
  ├── query active tab URL → state.currentTabUrl
  ├── storage.get("token")
  │     ├── no token → loadView("view-login")  [stop]
  │     └── token found → verifyToken()
  │           ├── error → loadView("view-login")  [stop]
  │           └── ok → state.user = storage.get("user")
  │                      └── loadMain()
  └── [end]
```

---

## View: Main (`loadMain`)

The main view fetches the dashboard and determines what the current tab is.

```text
loadMain()
  │
  ├── loadView("view-main")
  ├── clear simulation previews from the UI
  ├── getDashboard() → fills balance and cashback columns
  ├── if simulationPreview exists → show preview in credit card + stats
  ├── checkCurrentPartner() → state.currentPartner
  │     └── if is_partner → showPartnerSection()
  └── check pendingView in storage
        └── if "simulate" and is_partner → loadSimulate()
```

### Credit Card + Stats Layout

The main view is divided into:

1. **Credit card** — shows available balance at the bottom. If a simulation preview exists, shows the deducted amount and resulting balance inside the card.
2. **Stats row (two columns):**
   - Left: total cashback available
   - Right: cashback percentage for the current store, or earned cashback after simulation

### Partner Section

Shown only when the active tab is a partner store (`#partner-section`):

- **No simulation:** Shows "Simular compra" button.
- **Simulation approved:** Right column shows earned cashback highlighted in green (`text-earned`), "Ver planes de pago" button appears.
- **Simulation rejected:** Shows a balance warning with the shortfall amount.

---

## View: Simulate (`loadSimulate`)

Loads the amount input view. If `detectedPrice` is stored (price scraped from Amazon/Walmart), pre-fills the input field.

```js
async function loadSimulate() {
  loadView("view-simulate");
  $("simulate-amount").value = "";
  // ...
  const detectedPrice = await storage.get("detectedPrice");
  if (detectedPrice) $("simulate-amount").value = detectedPrice;
}
```

On submit, calls `simulateTransaction(monto, id_partner)` and stores the result in `state.simulationPreview`, then navigates back to `loadMain()` so the preview is rendered.

---

## View: Plans (`loadPlans`)

Reads `state.simulationPreview.payment_plans` (already in memory from the simulate call) and renders a card per plan using `document.createElement`.

Each card shows:
- Number of monthly installments
- Monthly payment amount
- Total amount (installment × count)
- Cashback to earn

---

## View: Loans (`loadLoans`)

Calls `getLoans()` and renders the response dynamically:

- A summary card with total active loans, total pending amount, and next due date
- One card per active loan with ID, amount, rate, installments, and due date

---

## CSS Architecture (`popup.css`)

The stylesheet is organized by section with comment headers:

| Section | Covers |
| --- | --- |
| Reset | `html`, `body`, `*`, `@keyframes` |
| Base popup | `.kueski-popup` |
| Utilities | `.hidden`, `.rounded` |
| Header | `.popup-header`, `.header-logo`, `.close-btn`, `.back-btn` |
| Buttons | `.primary-btn`, `.secondary-btn`, `.secondary-outline-btn` |
| Login | `.popup-head`, `.forms`, `.field`, `.secondary-text` |
| Loading | `.loading-body`, `.spinner` |
| Main — credit card | `.credit-card`, `.credit-card-info`, `.credit-card-balance` |
| Main — stats | `.stats-row`, `.stat-col`, `.stat-divider`, `.stat-amount` |
| Main — partner | `#partner-section`, `.balance-warning`, `.sim-result-text` |
| Main — footer | `.loans-link-btn`, `.loans-arrow` |
| Simulate | `.partner-badge`, `.amount-input-wrapper`, `.amount-field` |
| Plans | `.plans-list`, `.plan-card`, `.plan-info` |
| Loans | `.loans-summary`, `.loans-list`, `.loan-card` |

Key design decisions:

- **Credit card gradient:** `135deg, #1967f0 → #20bdd7 → #53eb56` — mimics a physical card
- **Balance position:** `position: absolute; bottom: 10%` inside the card container
- **Pill buttons:** `.rounded` adds `border-radius: 50px` on top of any button
- **Green cashback text:** `.text-earned` class toggled by JS when a simulation is approved
- **Stats grid:** `grid-template-columns: 1fr 1px 1fr` with a `.stat-divider` column in between
