import {
	login,
	verifyToken,
	getDashboard,
	getLoans,
	checkBenefits,
	simulateTransaction,
	trackIntent,
	confirmTransaction,
} from "../api.js";

// It's just an allias for avoid write getElementById many different times
const $ = (id) => document.getElementById(id);

const storage = {
	get: (key) =>
		new Promise((resolve) =>
			chrome.storage.local.get(key, (r) => resolve(r[key] ?? null)),
		),
	set: (obj) =>
		new Promise((resolve) => chrome.storage.local.set(obj, resolve)),
	remove: (keys) =>
		new Promise((resolve) => chrome.storage.local.remove(keys, resolve)),
};

const state = {
	user: null,
	dashboard: null,
	currentTabUrl: null,
	currentPartner: null, // { domain, is_partner, id_partner?, cashback_percentage }
	selectedPlan: null, // { monto, plan: { cuotas, monto_cuota, total }, cashback_to_earn }
	pendingTx: null, // { id, cashback_a_ganar, ...selectedPlan }
};

// Funcion de ayuda para mostrar la pantalla correcta y ocultar el resto
async function loadView(id) {
	document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
	$(id).classList.remove("hidden");
}

// ─── Init ─────────────────────────────────────────────────────────

async function init() {
	loadView("view-loading");

	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	state.currentTabUrl = tab?.url ?? "";

	const token = await storage.get("token");
	if (!token) {
		loadLogin();
		return;
	}

	try {
		await verifyToken();
		state.user = await storage.get("user");
		await loadMain();
	} catch (err) {
		loadLogin();
	}
}

// ─── Show different sections and load data from DB ────────────────────────────────────

async function loadLogin() {
	loadView("view-login");
}

async function loadMain() {
	loadView("view-main");

	try {
		const res = await getDashboard();
		// const res = {
		// 	data: {
		// 		balance: { available: 10 },
		// 		cashback: { available: 10 },
		// 	},
		// };
		state.dashboard = res.data;

		$("balance-amount").textContent = res.data.balance.available;
		$("cashback-amount").textContent = res.data.cashback.available;
		$("user-name").textContent = state.user?.nombre;

		await checkCurrentParner();
		console.log(state);
		if (state.currentPartner?.is_partner) showPartnerSection();
	} catch (err) {
		console.log(err);
	}
}

async function checkCurrentParner() {
	if (!state.currentTabUrl?.startsWith("http")) return;
	const { hostname } = new URL(state.currentTabUrl);
	const domain = hostname.replace(/^www\./, "");
	try {
		const res = await checkBenefits(domain);
		// const res = {
		// 	data: {
		// 		is_partner: true,
		// 		id_partner: 1,
		// 		cashback_percentage: 3,
		// 	},
		// };
		state.currentPartner = { domain, ...res.data };
	} catch {
		// Offline o no partner
	}
}

function showPartnerSection() {
	const p = state.currentPartner;
	$("cashback-pct").textContent = `${p.cashback_percentage}%`;
	$("partner-section").classList.remove("hidden");
	$("non-partner-section").classList.add("hidden");
}

async function loadSimulate() {
	loadView("view-simulate");
}

async function loadPlans() {
	loadView("view-plans");
}

// ─── Login & Logout ────────────────────────────────────────────────────────────────────

// Add login functionallity to button
$("form-login").addEventListener("submit", async (e) => {
	e.preventDefault();
	const btn = $("btn-login");
	const errEl = $("login-error");
	errEl.classList.add("hidden");
	btn.disabled = true;
	btn.textContent = "Iniciando sesión...";

	try {
		const res = await login($("email").value, $("password").value);
		// const res = {
		// 	data: {
		// 		token: "1213213123",
		// 		user: "Aaron",
		// 	},
		// };

		console.log(res);

		await storage.set({ token: res.data.token, user: res.data.user });
		state.user = res.data.user;
		console.log("Incio exitoso...");
		loadMain();
	} catch (err) {
		errEl.textContent = err.message;
		errEl.classList.remove("hidden");
		btn.disabled = false;
		btn.textContent = "Iniciar sesión";
	}
});

// Add logout functionallity to button
$("btn-logout").addEventListener("click", async () => {
	// Remove credentials from the browser storage
	await storage.remove(["token", "user"]);
	state.user = null;
	state.currentPartner = null;
	state.dashboard = null;
	$("partner-section").classList.add("hidden");
	$("non-partner-section").classList.remove("hidden");

	// Reactivate login button
	const btn = $("btn-login");
	btn.disabled = false;
	btn.textContent = "Iniciar sesión";

	loadLogin();
});

document.querySelectorAll(".close-btn").forEach((button) => {
	button.addEventListener("click", () => {
		window.close();
	});
});

init();
//loadMain();
//loadSimulate();
//loadPlans();
