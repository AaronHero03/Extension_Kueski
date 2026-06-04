const RENDER_URL = "https://rest-api-kueski.onrender.com";
const LOCAL_URL = "http://localhost:3000";
let local = false;

const BASE_URL = local ? LOCAL_URL : RENDER_URL;

function getToken() {
	return new Promise((resolve) =>
		chrome.storage.local.get("token", (r) => resolve(r.token ?? null)),
	);
}

// Funcion para facilitar las peticiones html
async function request(path, { auth = true, method = "GET", body } = {}) {
	const headers = { "Content-Type": "application/json" };
	if (auth) {
		const token = await getToken();
		if (token) headers["Authorization"] = `Bearer ${token}`;
	}
	const res = await fetch(`${BASE_URL}${path}`, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const json = await res.json();
	if (!res.ok) {
		const err = new Error(json.message || "Error desconocido");
		err.status = res.status;
		throw err;
	}
	return json;
}

export const login = (email, password) =>
	request("/auth/login", {
		auth: false,
		method: "POST",
		body: { email, password },
	});

export const verifyToken = () => request("/auth/verify");

export const getDashboard = () => request("/users/me/dashboard");

export const getLoans = () => request("/users/loans");

export const checkBenefits = (domain) =>
	request(`/commerce/benefits?domain=${encodeURIComponent(domain)}`);

export const simulateTransaction = (monto, id_partner) =>
	request("/transactions/simulate", {
		method: "POST",
		body: { monto, id_partner },
	});

export const trackIntent = (monto, id_partner, url) =>
	request("/transactions", {
		method: "POST",
		body: { monto, id_partner, url },
	});

export const confirmTransaction = (id) =>
	request(`/transactions/${id}/confirm`, { method: "POST" });
