# Content Script

## Overview

`src/content/content-script.js` is injected into **every web page** the user visits (configured via `manifest.json`). It runs after the DOM is fully built (`document_end`) and has direct access to the page's DOM but not to the popup or service worker's memory.

It has two responsibilities:

1. **Price scraping** — detect the product price on supported stores and save it to storage
2. **Cashback notifications** — display a small in-page UI when the user is on a partner store

---

## Execution Flow

```text
Page finishes loading
        │
        ▼
  Detect current domain (strip "www.")
        │
        ▼
  sendMessage CHECK_STORE → background.js
        │
        ├── not a partner → do nothing
        └── is a partner
              ├── on a cart page + logged in → showCartNotification()
              └── otherwise → showSilentNotification()
        │
        ▼
  Run price scraper for known domains
  (amazon.com.mx or walmart.com.mx)
        │
        ├── price found → chrome.storage.local.set({ detectedPrice })
        └── price not found → chrome.storage.local.remove("detectedPrice")
        │
        ▼
  Start MutationObserver (watchPriceChanges)
  → re-runs scraper whenever DOM changes (debounced 500ms)
```

---

## Cart Page Detection

The script checks whether the current path matches any common cart/checkout route:

```js
const CART_PATHS = ["/cart", "/carrito", "/bolsa", "/cesta", "/checkout", "/bag"];
const isCartPage = CART_PATHS.some(p => window.location.pathname.toLowerCase().includes(p));
```

If the user is on a cart page **and** is logged in, the cart notification is shown. Otherwise, the silent (pill) notification is shown.

---

## Price Scraping

### Supported Stores

| Domain | Scraper function |
| --- | --- |
| `amazon.com.mx` | `scrapeAmazon()` |
| `walmart.com.mx` | `scrapeWalmart()` |

### `parsePrice(raw)`

Shared helper that strips currency symbols, spaces, and thousand separators, then parses the result as a float:

```js
function parsePrice(raw) {
  if (!raw) return null;
  const num = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return isNaN(num) || num <= 0 ? null : num;
}
```

### `scrapeAmazon()`

Tries multiple CSS selectors in order of reliability — Amazon changes its DOM structure frequently:

```js
const selectors = [
  ".sc-price",
  "#corePrice_desktop .a-price .a-offscreen",
  "#corePriceDisplay_desktop_feature_div .a-offscreen",
  '.a-price[data-a-color="price"] .a-offscreen',
  ".a-price .a-offscreen",
  "#price_inside_buybox",
  "#priceblock_ourprice",
];
```

Returns the first non-null price found, or `null` if none match.

### `scrapeWalmart()`

Prefers the `[itemprop="price"]` meta attribute (schema.org structured data — more stable than visual selectors), then falls back to visual selectors:

```js
const meta = document.querySelector('[itemprop="price"]');
// fallbacks: span.price-characteristic, [data-automation="product-price"], etc.
```

### MutationObserver (`watchPriceChanges`)

Product pages often update the price in the DOM without a full page reload (e.g., when selecting a variant). The `MutationObserver` re-runs the scraper whenever the DOM changes, with a 500ms debounce to avoid excessive calls:

```js
function watchPriceChanges(scrapeFunc) {
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const price = scrapeFunc();
      price
        ? chrome.storage.local.set({ detectedPrice: price })
        : chrome.storage.local.remove("detectedPrice");
    }, 500);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
```

---

## Notifications

Both notifications are injected into the page using the **Shadow DOM** (`attachShadow({ mode: "open" })`). This isolates their styles from the host page so that the page's CSS cannot accidentally override the notification's appearance.

### Silent Notification (`showSilentNotification`)

A pill-shaped badge that appears in the **top-right corner** of the page.

- Slides in from the right on entry
- Auto-dismisses after **3 seconds** with a fade-out animation
- Has a manual close button (`×`)

Shown when the user is on **any page** of a partner store (not just cart pages), or when they are not logged in.

```text
┌─────────────────────────────────────┐
│ [logo]  ✓  Cashback del 2.50% activo  × │
└─────────────────────────────────────┘
```

### Cart Notification (`showCartNotification`)

A card that appears in the **bottom-right corner** of the page. Shown only on cart/checkout pages for logged-in users.

- Clicking the card sends `OPEN_SIMULATE` to the background, which opens the popup directly on the simulate view
- Has a manual close button
- Does not auto-dismiss

```text
┌──────────────────────────────────┐
│ [logo]  ¡Simula tu compra!       │
│         Gana 2.50% de cashback   │
└──────────────────────────────────┘
```

---

## Shadow DOM Isolation

Each notification is created as follows:

```js
const container = document.createElement("div");
container.id = "kueski-cart-root"; // or kueski-silent-root
const shadow = container.attachShadow({ mode: "open" });
shadow.innerHTML = `<style>...</style><div class="...">...</div>`;
document.body.appendChild(container);
```

This prevents:
- The page's CSS from breaking the notification layout
- The notification's CSS from leaking into the host page
- ID/class name conflicts
