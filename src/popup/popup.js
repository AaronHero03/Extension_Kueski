import {
	login,
	verifyToken,
	getDashboard,
	getLoans,
	checkBenefits,
	simulateTransaction,
} from "../api.js";

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
	currentPartner: null,     // { domain, is_partner, id_partner?, cashback_percentage }
	simulationPreview: null,  // { monto, cashback_to_earn, payment_plans, is_approved }
};

// ─── Utilidades ───────────────────────────────────────────────────────────────

function loadView(id) {
	document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
	$(id).classList.remove("hidden");
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
	loadView("view-loading");

	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	state.currentTabUrl = tab?.url ?? "";

	const token = await storage.get("token");
	if (!token) {
		loadView("view-login");
		return;
	}

	try {
		await verifyToken();
		state.user = await storage.get("user");
		await loadMain();
	} catch {
		loadView("view-login");
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function loadMain() {
	loadView("view-main");

	// Limpiar previews
	$("balance-preview").classList.add("hidden");
	$("cashback-preview").classList.add("hidden");

	try {
		const res = await getDashboard();
		state.dashboard = res.data;

		$("balance-amount").innerHTML =
			`${res.data.balance.available} <span class="currency">MXN</span>`;
		$("cashback-amount").innerHTML =
			`${res.data.cashback.available} <span class="currency">MXN</span>`;
		$("user-name").textContent = state.user?.nombre ?? state.user;

		if (state.simulationPreview) {
			const { monto, cashback_to_earn } = state.simulationPreview;
			const balance = parseFloat(res.data.balance.available);
			const cashback = parseFloat(res.data.cashback.available);

			$("balance-preview").textContent = `(- $${monto.toFixed(2)} MXN)`;
			$("balance-preview").classList.remove("hidden");
			$("balance-result").textContent = `= $${(balance - monto).toFixed(2)} MXN`;
			$("balance-result").classList.remove("hidden");

			$("cashback-preview").textContent = `(+ $${cashback_to_earn} MXN)`;
			$("cashback-preview").classList.remove("hidden");
			$("cashback-result").textContent = `= $${(cashback + parseFloat(cashback_to_earn)).toFixed(2)} MXN`;
			$("cashback-result").classList.remove("hidden");
		} else {
			$("balance-preview").classList.add("hidden");
			$("balance-result").classList.add("hidden");
			$("cashback-preview").classList.add("hidden");
			$("cashback-result").classList.add("hidden");
		}

		await checkCurrentPartner();
		if (state.currentPartner?.is_partner) showPartnerSection();
	} catch (err) {
		console.error(err);
	}
}

async function checkCurrentPartner() {
	if (!state.currentTabUrl?.startsWith("http")) return;
	const { hostname } = new URL(state.currentTabUrl);
	const domain = hostname.replace(/^www\./, "");
	try {
		const res = await checkBenefits(domain);
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
	$("simulate-store-name").textContent = p.domain;

	if (state.simulationPreview) {
		const { cashback_to_earn, is_approved } = state.simulationPreview;

		$("simulation-result").textContent =
			`Ganarás $${cashback_to_earn} MXN en esta compra`;
		$("simulation-result").classList.remove("hidden");
		$("btn-pay").textContent = "Cambiar monto";

		if (is_approved) {
			$("balance-warning").classList.add("hidden");
			$("btn-see-details").classList.remove("hidden");
		} else {
			$("balance-warning").classList.remove("hidden");
			$("btn-see-details").classList.add("hidden");
		}
	} else {
		$("simulation-result").classList.add("hidden");
		$("balance-warning").classList.add("hidden");
		$("btn-see-details").classList.add("hidden");
		$("btn-pay").textContent = "Simular compra";
	}
}

// ─── Simulate ─────────────────────────────────────────────────────────────────

function loadSimulate() {
	loadView("view-simulate");
	$("simulate-amount").value = "";
	$("simulate-error").classList.add("hidden");
	$("btn-simulate").disabled = false;
	$("btn-simulate").textContent = "Ver planes de pago";
}

// ─── Plans ────────────────────────────────────────────────────────────────────

function loadPlans() {
	loadView("view-plans");
	$("plans-error").classList.add("hidden");

	const { monto, cashback_to_earn, payment_plans } = state.simulationPreview;
	$("plans-total-amount").textContent = `$${monto.toFixed(2)} MXN`;

	const list = $("plans-list");
	list.innerHTML = "";
	payment_plans.forEach((plan) => {
		const card = document.createElement("div");
		card.className = "plan-card";
		card.innerHTML = `
			<div class="plan-info">
				<span class="plan-title">${plan.cuotas} pagos mensuales</span>
				<span class="plan-subtitle">$${plan.monto_cuota} MXN / mes · Total $${plan.total} MXN</span>
				<span class="plan-cashback">Cashback a ganar: $${cashback_to_earn} MXN</span>
			</div>
		`;
		list.appendChild(card);
	});
}

// ─── Loans ────────────────────────────────────────────────────────────────────

async function loadLoans() {
	loadView("view-loans");
	$("loans-loading").classList.remove("hidden");
	$("loans-content").classList.add("hidden");
	$("loans-empty").classList.add("hidden");
	$("loans-error").classList.add("hidden");

	try {
		const res = await getLoans();
		const { summary, active_loans } = res.data;

		$("loans-summary").innerHTML = `
			<div class="loan-row"><span>Préstamos activos</span><strong>${summary.total_active}</strong></div>
			<div class="loan-row"><span>Total pendiente</span><strong>$${Number(summary.total_pending).toFixed(2)} MXN</strong></div>
			<div class="loan-row"><span>Próximo vencimiento</span><strong>${new Date(summary.next_due_date).toLocaleDateString("es-MX")}</strong></div>
		`;

		const list = $("loans-list");
		list.innerHTML = "";
		active_loans.forEach((loan) => {
			const card = document.createElement("div");
			card.className = "loan-card";
			card.innerHTML = `
				<div class="loan-header">Préstamo #${loan.id_prestamo}</div>
				<div class="loan-row"><span>Monto</span><strong>$${Number(loan.cantidad).toFixed(2)} MXN</strong></div>
				<div class="loan-row"><span>Cuotas</span><strong>${loan.cuotas}</strong></div>
				<div class="loan-row"><span>Tasa anual</span><strong>${loan.tasa}%</strong></div>
				<div class="loan-row"><span>Vence</span><strong>${new Date(loan.fecha_fin).toLocaleDateString("es-MX")}</strong></div>
			`;
			list.appendChild(card);
		});

		$("loans-loading").classList.add("hidden");
		$("loans-content").classList.remove("hidden");
	} catch (err) {
		$("loans-loading").classList.add("hidden");
		if (err.status === 404) {
			$("loans-empty").classList.remove("hidden");
		} else {
			$("loans-error").textContent = err.message;
			$("loans-error").classList.remove("hidden");
		}
	}
}

// ─── Listeners: Login ─────────────────────────────────────────────────────────

$("form-login").addEventListener("submit", async (e) => {
	e.preventDefault();
	const btn = $("btn-login");
	const errEl = $("login-error");
	errEl.classList.add("hidden");
	btn.disabled = true;
	btn.textContent = "Iniciando sesión...";

	try {
		const res = await login($("email").value, $("password").value);
		await storage.set({ token: res.data.token, user: res.data.user });
		state.user = res.data.user;
		await loadMain();
	} catch (err) {
		errEl.textContent = err.message;
		errEl.classList.remove("hidden");
		btn.disabled = false;
		btn.textContent = "Iniciar sesión";
	}
});

$("btn-logout").addEventListener("click", async () => {
	await storage.remove(["token", "user"]);
	state.user = null;
	state.currentPartner = null;
	state.dashboard = null;
	state.simulationPreview = null;
	const btn = $("btn-login");
	btn.disabled = false;
	btn.textContent = "Iniciar sesión";
	loadView("view-login");
});

// ─── Listeners: Main ──────────────────────────────────────────────────────────

$("btn-pay").addEventListener("click", loadSimulate);
$("btn-see-details").addEventListener("click", loadPlans);
$("btn-loans").addEventListener("click", loadLoans);

// ─── Listeners: Simulate ──────────────────────────────────────────────────────

$("btn-back-simulate").addEventListener("click", loadMain);

$("btn-simulate").addEventListener("click", async () => {
	const monto = parseFloat($("simulate-amount").value);
	const errEl = $("simulate-error");
	const btn = $("btn-simulate");
	errEl.classList.add("hidden");

	if (!monto || monto <= 0) {
		errEl.textContent = "Ingresa un monto válido mayor a $0.";
		errEl.classList.remove("hidden");
		return;
	}

	btn.disabled = true;
	btn.textContent = "Calculando...";

	try {
		const res = await simulateTransaction(monto, state.currentPartner.id_partner);
		state.simulationPreview = { monto, ...res.data };
		await loadMain();
	} catch (err) {
		errEl.textContent = err.message;
		errEl.classList.remove("hidden");
		btn.disabled = false;
		btn.textContent = "Ver planes de pago";
	}
});

// ─── Listeners: Plans ─────────────────────────────────────────────────────────

$("btn-back-plans").addEventListener("click", loadMain);

// ─── Listeners: Loans ────────────────────────────────────────────────────────

$("btn-back-loans").addEventListener("click", loadMain);

document.querySelectorAll(".close-btn").forEach((btn) => {
	btn.addEventListener("click", () => window.close());
});

// ─── Arrancar ────────────────────────────────────────────────────────────────

init();
