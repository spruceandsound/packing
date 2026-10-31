// Applies the saved light/dark choice before the page draws, so there's no flash. "system" (or nothing saved) follows the phone.
try { const t = JSON.parse(localStorage.getItem("pack2.theme") || "null"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch {}
