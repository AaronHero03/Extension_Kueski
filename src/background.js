import { checkBenefits, login, verifyToken } from "./api.js";

// ─── Badge ────────────────────────────────────────────────────────────────────

function getToken() {
	return new Promise((resolve) =>
		chrome.storage.local.get("token", (r) => resolve(r.token ?? null)),
	);
}

function getUser() {
	return new Promise((resolve) =>
		chrome.storage.local.get("user", (r) => resolve(r.user ?? null)),
	);
}

async function updateBadge(tabId, url) {
	try {
		if (!url?.startsWith("http")) {
			chrome.action.setBadgeText({ text: "", tabId });
			return;
		}
		const token = await getToken();
		if (!token) {
			chrome.action.setBadgeText({ text: "", tabId });
			return;
		}
		const { hostname } = new URL(url);
		const domain = hostname.replace(/^www\./, "");
		const res = await checkBenefits(domain);
		if (res.data?.is_partner) {
			chrome.action.setBadgeText({ text: "CB", tabId });
			chrome.action.setBadgeBackgroundColor({ color: "#f97316", tabId });
		} else {
			chrome.action.setBadgeText({ text: "", tabId });
		}
	} catch {
		chrome.action.setBadgeText({ text: "", tabId });
	}
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.status === "complete" && tab.url) {
		updateBadge(tabId, tab.url);
	}
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
	try {
		const tab = await chrome.tabs.get(tabId);
		if (tab.url) updateBadge(tabId, tab.url);
	} catch {
		// Pestaña no accesible (chrome://, etc.)
	}
});

// ─── Mensajes ─────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	handleMessage(message)
		.then(sendResponse)
		.catch((err) => sendResponse({ error: err.message }));
	return true; // Mantiene el canal abierto para respuestas asíncronas
});

async function handleMessage({ type, payload }) {
	switch (type) {
		case "CHECK_STORE": {
			const token = await getToken();
			const user = await getUser();
			try {
				const res = await checkBenefits(payload.domain);
				return { ...res.data, isLoggedIn: !!token, user };
			} catch {
				return { is_partner: false, isLoggedIn: !!token, user };
			}
		}

		case "GET_SESSION": {
			const token = await getToken();
			if (!token) return { isLoggedIn: false };
			try {
				await verifyToken();
				const user = await getUser();
				return { isLoggedIn: true, user };
			} catch {
				await new Promise((resolve) =>
					chrome.storage.local.remove(["token", "user"], resolve),
				);
				return { isLoggedIn: false };
			}
		}

		case "LOGIN": {
			const res = await login(payload.email, payload.password);
			const { token, user } = res.data;
			await new Promise((resolve) =>
				chrome.storage.local.set({ token, user }, resolve),
			);
			return { success: true, user };
		}

		case "LOGOUT": {
			await new Promise((resolve) =>
				chrome.storage.local.remove(["token", "user"], resolve),
			);
			return { success: true };
		}

		case "OPEN_SIMULATE": {
			await new Promise((resolve) =>
				chrome.storage.local.set({ pendingView: "simulate" }, resolve),
			);
			try {
				await chrome.action.openPopup();
			} catch {
				// openPopup() requiere gesto de usuario directo en algunas versiones de Chrome.
				// El flag pendingView ya fue guardado: cuando el usuario abra el popup manualmente navegará directo a simulate.
			}
			return { success: true };
		}

		default:
			return { error: "Tipo de mensaje desconocido" };
	}
}
