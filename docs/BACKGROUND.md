# Background Service Worker

## Overview

`src/background.js` is the extension's **service worker**. It runs in a separate context from the popup and content scripts, and is reactivated by Chrome whenever an event it listens to fires (tab updates, messages, etc.).

Its responsibilities are:

1. **Manage the extension badge** — shows `"CB"` on the icon when the active tab is a partner store
2. **Handle messages** from the content script and popup
3. **Bridge the "simulate" flow** — when the content script triggers the simulate view, the background sets a `pendingView` flag in storage and opens the popup

---

## Badge Management

The badge is the small text overlay on the extension icon. When the user is on a partner store and is logged in, it shows `"CB"` in orange.

```text
Tab updated or activated
        │
        ▼
  updateBadge(tabId, url)
        │
        ├── url not http → clear badge
        ├── no token in storage → clear badge
        └── checkBenefits(domain)
              ├── is_partner: true → badge "CB" (#f97316)
              └── is_partner: false → clear badge
```

Badge updates are triggered by two tab events:

- `chrome.tabs.onUpdated` — fires when a tab finishes loading
- `chrome.tabs.onActivated` — fires when the user switches to a different tab

---

## Message Handling

`background.js` listens for messages sent via `chrome.runtime.sendMessage`. The handler is async and returns the result via `sendResponse`.

```js
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(...);
  return true; // keeps the message channel open for async responses
});
```

### Message Types

| Type | Sender | What it does |
| --- | --- | --- |
| `CHECK_STORE` | Content script | Calls `checkBenefits(domain)`, returns partner data and session status |
| `GET_SESSION` | (available for future use) | Verifies the token and returns `{ isLoggedIn, user }` |
| `LOGIN` | (available for future use) | Calls the login API and stores the token + user |
| `LOGOUT` | (available for future use) | Removes token and user from storage |
| `OPEN_SIMULATE` | Content script (cart notification click) | Sets `pendingView: "simulate"` in storage, then calls `chrome.action.openPopup()` |

---

## `CHECK_STORE` Detail

The content script sends this message on every page load to determine whether to show a cashback notification.

```js
// content-script.js
chrome.runtime.sendMessage(
  { type: "CHECK_STORE", payload: { domain: currentDomain } },
  (response) => {
    // response: { is_partner, cashback_percentage, isLoggedIn, user }
  }
);
```

The background handler calls the API's `/commerce/benefits` endpoint and also reads the stored token and user to include session state in the response.

---

## `OPEN_SIMULATE` Detail

When a logged-in user clicks the cart notification (shown on checkout pages of partner stores), the content script sends `OPEN_SIMULATE`. The background then:

1. Writes `{ pendingView: "simulate" }` to `chrome.storage.local`
2. Calls `chrome.action.openPopup()` to open the extension popup

When the popup initializes, `loadMain()` reads `pendingView` from storage. If it equals `"simulate"` and the current tab is a partner store, `loadSimulate()` is called automatically.

> **Note:** `chrome.action.openPopup()` requires a direct user gesture in some Chrome versions. If it fails (the `try/catch` handles this silently), the `pendingView` flag is still set — when the user manually opens the popup, it will navigate directly to the simulate view.

---

## Helper Functions

```js
function getToken() {
  return new Promise(resolve =>
    chrome.storage.local.get("token", r => resolve(r.token ?? null))
  );
}

function getUser() {
  return new Promise(resolve =>
    chrome.storage.local.get("user", r => resolve(r.user ?? null))
  );
}
```

These are simple wrappers to avoid callback nesting when reading from `chrome.storage.local`.
