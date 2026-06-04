// Obtener el dominio de la pagina sin "www."
const currentDomain = window.location.hostname.replace("www.", "");

// Posibles nombres de las rutas del carrito
const CART_PATHS = [
	"/cart",
	"/carrito",
	"/bolsa",
	"/cesta",
	"/checkout",
	"/bag",
];

// Verificar si el dominio contiene
const isCartPage = CART_PATHS.some((p) =>
	window.location.pathname.toLowerCase().includes(p),
);

// Comunicacion con background.js
chrome.runtime.sendMessage(
	{ type: "CHECK_STORE", payload: { domain: currentDomain } },
	(response) => {
		if (chrome.runtime.lastError || !response?.is_partner) return;

		if (isCartPage && response.isLoggedIn) {
			showCartNotification(response.cashback_percentage);
		} else {
			showSilentNotification(response.cashback_percentage);
		}
	},
);

// ─── Price Scraping ───────────────────────────────────────────────────────────

function parsePrice(raw) {
	if (!raw) return null;
	const num = parseFloat(raw.replace(/[^0-9.]/g, ""));
	return isNaN(num) || num <= 0 ? null : num;
}

function scrapeAmazon() {
	const selectors = [
		".sc-price",
		"#corePrice_desktop .a-price .a-offscreen",
		"#corePriceDisplay_desktop_feature_div .a-offscreen",
		'.a-price[data-a-color="price"] .a-offscreen',
		".a-price .a-offscreen",
		"#price_inside_buybox",
		"#priceblock_ourprice",
	];
	for (const sel of selectors) {
		const price = parsePrice(document.querySelector(sel)?.textContent);
		if (price) return price;
	}
	return null;
}

function scrapeWalmart() {
	const meta = document.querySelector('[itemprop="price"]');
	if (meta) {
		const price = parsePrice(meta.getAttribute("content") || meta.textContent);
		if (price) return price;
	}
	const selectors = [
		"span.price-characteristic",
		"[data-automation='product-price']",
		".price-group .price-characteristic",
	];
	for (const sel of selectors) {
		const price = parsePrice(document.querySelector(sel)?.textContent);
		if (price) return price;
	}
	return null;
}

const PRICE_SCRAPERS = {
	"amazon.com.mx": scrapeAmazon,
	"walmart.com.mx": scrapeWalmart,
};

function watchPriceChanges(scrapeFunc) {
	let debounceTimer = null;
	const observer = new MutationObserver(() => {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			const price = scrapeFunc();
			if (price) {
				chrome.storage.local.set({ detectedPrice: price });
			} else {
				chrome.storage.local.remove("detectedPrice");
			}
		}, 500);
	});
	observer.observe(document.body, {
		childList: true,
		subtree: true,
		characterData: true,
	});
}

const scraper = PRICE_SCRAPERS[currentDomain];
if (scraper) {
	const price = scraper();
	if (price) {
		chrome.storage.local.set({ detectedPrice: price });
	} else {
		chrome.storage.local.remove("detectedPrice");
	}
	watchPriceChanges(scraper);
}

// Notifiacion de porcentaje de cashback
function showSilentNotification(cashbackPercentage) {
	if (document.getElementById("kueski-silent-root")) return;

	const container = document.createElement("div");
	container.id = "kueski-silent-root";
	container.style.position = "fixed";
	container.style.top = "20px";
	container.style.right = "20px";
	container.style.zIndex = "99999999";

	const shadow = container.attachShadow({ mode: "open" });
	const logoUrl = chrome.runtime.getURL("src/content/kueski.png");

	const styles = `
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;600;700&display=swap");

      /* Animación de entrada */
      @keyframes slideInRight {
        from { opacity: 0; transform: translateX(50px); }
        to { opacity: 1; transform: translateX(0); }
      }
      
      /* Animación de salida */
      @keyframes fadeOutRight {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(50px); }
      }

      .silent-popup {
        font-family: "Instrument Sans", sans-serif;
        background: #ffffff;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 20px;
        border-radius: 50px; /* Diseño en forma de píldora */
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
        border: 1px solid #eaeaea;
        animation: slideInRight 0.4s ease-out forwards;
      }

      /* Esta clase se agrega con JS para desaparecerla */
      .silent-popup.hiding {
        animation: fadeOutRight 0.4s ease-in forwards;
      }

      .logo { height: 18px; width: auto; }
      
      .message {
        font-size: 15px;
        font-weight: 600;
        color: #111111;
        margin: 0;
      }

      .cashback-badge {
        color: #2b95fa;
        font-weight: 700;
      }

      .check-icon {
        color: #49d233;
        width: 18px;
        height: 18px;
      }

      .close-btn {
        background: none;
        border: none;
        color: #a3a3a3;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        margin-left: 5px;
      }
      .close-btn:hover { color: #666666; }
    </style>
  `;

	const html = `
    <div class="silent-popup" id="silent-card">
      <img src="${logoUrl}" alt="Kueski" class="logo" />
      <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <p class="message">Cashback del <span class="cashback-badge">${cashbackPercentage}%</span> activo</p>
      <button class="close-btn" id="close-silent">&times;</button>
    </div>
  `;

	shadow.innerHTML = styles + html;
	document.body.appendChild(container);

	const silentCard = shadow.getElementById("silent-card");

	// Función para cerrar con animación suave
	const closeNotification = () => {
		silentCard.classList.add("hiding");
		// Esperamos 400ms a que termine la animación CSS antes de borrar el HTML
		setTimeout(() => container.remove(), 400);
	};

	// Escuchar el clic manual de la tachita
	shadow
		.getElementById("close-silent")
		.addEventListener("click", closeNotification);

	// ¡Magia! Auto-destrucción silenciosa después de 5 segundos
	setTimeout(closeNotification, 3000);
}

// Notificacion del carrito
function showCartNotification(cashbackPercentage) {
	if (document.getElementById("kueski-cart-root")) return;

	const container = document.createElement("div");
	container.id = "kueski-cart-root";
	container.style.position = "fixed";
	container.style.bottom = "24px";
	container.style.right = "20px";
	container.style.zIndex = "99999999";

	const shadow = container.attachShadow({ mode: "open" });
	const logoUrl = chrome.runtime.getURL("src/content/kueski.png");

	shadow.innerHTML = `
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;600;700&display=swap");
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(20px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes fadeOutDown {
        from { opacity: 1; transform: translateY(0); }
        to   { opacity: 0; transform: translateY(20px); }
      }
      .cart-pill {
        font-family: "Instrument Sans", sans-serif;
        background: #fff;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 18px;
        border-radius: 16px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.13);
        border: 1px solid #e0f0ff;
        animation: slideUp 0.4s ease-out forwards;
        max-width: 300px;
        cursor: pointer;
        transition: box-shadow 0.2s, border-color 0.2s;
      }
      .cart-pill:hover { box-shadow: 0 6px 28px rgba(43,149,250,0.18); border-color: #b3d9ff; }
      .cart-pill.hiding { animation: fadeOutDown 0.4s ease-in forwards; }
      .logo { height: 18px; width: auto; }
      .text { display: flex; flex-direction: column; gap: 2px; flex: 1; }
      .title { font-size: 14px; font-weight: 700; color: #111; margin: 0; }
      .subtitle { font-size: 12px; color: #6b7280; margin: 0; }
      .badge { color: #2b95fa; font-weight: 700; }
      .close-btn { background: none; border: none; color: #a3a3a3; font-size: 18px; cursor: pointer; padding: 0; line-height: 1; }
      .close-btn:hover { color: #666; }
    </style>
    <div class="cart-pill" id="cart-card">
      <img src="${logoUrl}" alt="Kueski" class="logo" />
      <div class="text">
        <p class="title">¡Simula tu compra con KueskiPay!</p>
        <p class="subtitle">Gana <span class="badge">${cashbackPercentage}%</span> de cashback en esta tienda</p>
      </div>
      <button class="close-btn" id="close-cart">&times;</button>
    </div>
  `;

	document.body.appendChild(container);

	const card = shadow.getElementById("cart-card");
	const close = () => {
		card.classList.add("hiding");
		setTimeout(() => container.remove(), 400);
	};

	shadow.getElementById("close-cart").addEventListener("click", (e) => {
		e.stopPropagation();
		close();
	});

	// Conexion con el background
	card.addEventListener("click", () => {
		chrome.runtime.sendMessage({ type: "OPEN_SIMULATE" });
	});
}
