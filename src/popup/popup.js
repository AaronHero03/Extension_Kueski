import {
	login,
	verifyToken,
	getDashboard,
	getLoans,
	checkBenefits,
	simulateTransaction,
} from "../api.js";

const $ = (id) => document.getElementById(id);

const formatAmount = (n) =>
	parseFloat(n).toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

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
	simulationPreview: null, // { monto, cashback_to_earn, payment_plans, is_approved }
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

	try {
		const res = await getDashboard();
		state.dashboard = res.data;

		$("balance-amount").innerHTML =
			`${formatAmount(res.data.balance.available)} <span class="currency">MXN</span>`;
		$("cashback-amount").innerHTML =
			`${formatAmount(res.data.cashback.available)} <span class="currency">MXN</span>`;
		$("user-name").textContent = state.user?.nombre ?? state.user;

		if (state.simulationPreview) {
			const { monto, cashback_to_earn, is_approved } = state.simulationPreview;
			const balance = parseFloat(res.data.balance.available);
			const cashback = parseFloat(res.data.cashback.available);

			if (is_approved) {
				$("balance-preview").textContent = `(- $${formatAmount(monto)} MXN)`;
				$("balance-preview").classList.remove("hidden");
				$("balance-result").textContent =
					`$${formatAmount(balance - monto)} MXN`;
				$("balance-result").classList.remove("hidden");

				// Actualizar totales directamente en las columnas
				$("cashback-amount").innerHTML =
					`${formatAmount(cashback + parseFloat(cashback_to_earn))} <span class="currency">MXN</span>`;
			} else {
				$("balance-preview").classList.add("hidden");
				$("balance-result").classList.add("hidden");
				$("balance-warning").textContent =
					`⚠ Te faltan $${formatAmount(monto - balance - cashback)} MXN para completar esta compra`;
			}
		} else {
			$("balance-preview").classList.add("hidden");
			$("balance-result").classList.add("hidden");
		}

		await checkCurrentPartner();
		if (state.currentPartner?.is_partner) showPartnerSection();

		const pendingView = await storage.get("pendingView");
		if (pendingView) {
			await storage.remove(["pendingView"]);
			if (pendingView === "simulate" && state.currentPartner?.is_partner) {
				loadSimulate();
			}
		}
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
	$("cashback-pct").textContent =
		`${parseFloat(p.cashback_percentage).toFixed(2)}%`;
	$("cashback-pct").classList.remove("text-earned");
	$("benefit-col-title").textContent = "Gana % de cashback";
	$("partner-section").classList.remove("hidden");
	$("non-partner-section").classList.add("hidden");
	$("simulate-store-name").textContent = p.domain;

	if (state.simulationPreview) {
		const { cashback_to_earn, is_approved } = state.simulationPreview;

		$("btn-pay").textContent = "Cambiar monto";

		if (is_approved) {
			$("cashback-pct").textContent = `+$${formatAmount(cashback_to_earn)}`;
			$("cashback-pct").classList.add("text-earned");
			$("benefit-col-title").textContent = "Ganado en tu compra";
			$("simulation-result").classList.add("hidden");
			$("balance-warning").classList.add("hidden");
			$("btn-see-details").classList.remove("hidden");
		} else {
			$("simulation-result").classList.add("hidden");
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

async function loadSimulate() {
	loadView("view-simulate");
	$("simulate-amount").value = "";
	$("simulate-error").classList.add("hidden");
	$("btn-simulate").disabled = false;
	$("btn-simulate").textContent = "Ver planes de pago";

	const detectedPrice = await storage.get("detectedPrice");
	if (detectedPrice) {
		$("simulate-amount").value = detectedPrice;
	}
}

// ─── Plans ────────────────────────────────────────────────────────────────────

function loadPlans() {
	loadView("view-plans");
	$("plans-error").classList.add("hidden");

	const { monto, cashback_to_earn, payment_plans } = state.simulationPreview;
	$("plans-total-amount").textContent = `$${formatAmount(monto)} MXN`;

	const list = $("plans-list");
	list.innerHTML = "";
	payment_plans.forEach((plan) => {
		const card = document.createElement("div");
		card.className = "plan-card";
		card.innerHTML = `
			<div class="plan-info">
				<span class="plan-title">${plan.cuotas} pagos mensuales</span>
				<span class="plan-subtitle">$${formatAmount(plan.monto_cuota)} MXN / mes · Total $${formatAmount(plan.total)} MXN</span>
				<span class="plan-cashback">Cashback a ganar: $${formatAmount(cashback_to_earn)} MXN</span>
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
			<div class="loan-row"><span>Total pendiente</span><strong>$${formatAmount(summary.total_pending)} MXN</strong></div>
			<div class="loan-row"><span>Próximo vencimiento</span><strong>${new Date(summary.next_due_date).toLocaleDateString("es-MX")}</strong></div>
		`;

		const list = $("loans-list");
		list.innerHTML = "";
		active_loans.forEach((loan) => {
			const card = document.createElement("div");
			card.className = "loan-card";
			card.innerHTML = `
				<div class="loan-header">Préstamo #${loan.id_prestamo}</div>
				<div class="loan-row"><span>Monto</span><strong>$${formatAmount(loan.cantidad)} MXN</strong></div>
				<div class="loan-row"><span>Cuotas</span><strong>${loan.cuotas}</strong></div>
				<div class="loan-row"><span>Tasa anual</span><strong>${(loan.tasa * 100).toFixed(2)}%</strong></div>
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
		const res = await simulateTransaction(
			monto,
			state.currentPartner.id_partner,
		);
		state.simulationPreview = { monto, ...res.data };
		await loadMain();
	} catch (err) {
		errEl.textContent = err.message;
		errEl.classList.remove("hidden");
		btn.disabled = false;
		btn.textContent = "Simular compra";
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
