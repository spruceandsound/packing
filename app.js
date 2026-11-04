// Pack — pack.spruceandsound.com
// Hash-routed home-screen web app. Data lives in Supabase (row-level security keeps each
// person's trips private); smart sorting and weather go through /api on Netlify.
(() => {
  "use strict";

  // ───────────────────────── tiny helpers ─────────────────────────
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $("#app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("pack2." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { v == null ? localStorage.removeItem("pack2." + k) : localStorage.setItem("pack2." + k, JSON.stringify(v)); } catch {} },
  };
  const units = /-(US|LR|MM)$/i.test(navigator.language || "en-US") ? "f" : "c";
  const key = (s) => String(s || "").trim().toLowerCase();
  const fmtDate = (d, o = { month: "short", day: "numeric" }) => d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, o) : "";
  const dateRange = (a, b) => !a ? "" : !b || a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "MXN", "AUD", "NZD", "JPY", "CHF", "SEK", "NOK", "DKK", "ISK", "THB", "SGD", "HKD", "KRW", "INR", "BRL", "ZAR"];
  const curDigits = (c) => { try { return new Intl.NumberFormat("en", { style: "currency", currency: c || "USD" }).resolvedOptions().maximumFractionDigits; } catch { return 2; } };
  // Venmo: accepts "@name", "name", or a profile link (venmo.com/name, venmo.com/u/name, account.venmo.com/u/name).
  // Returns the bare username, "" for empty, or null when it can't be read.
  function parseVenmo(raw) {
    let v = String(raw || "").trim();
    if (!v) return "";
    const m = v.match(/^(?:https?:\/\/)?(?:www\.|account\.)?venmo\.com\/(?:u\/)?([^/?#\s]+)/i);
    if (m) v = m[1]; else if (/[/.]/.test(v) && !/^@/.test(v)) return null;
    v = decodeURIComponent(v).replace(/^@/, "");
    return /^[A-Za-z0-9_-]{2,30}$/.test(v) && !/^(code|u|account|pay|signup|login|paymentlinks)$/i.test(v) ? v : null;
  }
  const isPhone = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function venmoUrls(user, cents, note) {
    const amt = (cents / 100).toFixed(2), n = encodeURIComponent(note.slice(0, 120));
    return {
      app: `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(user)}&amount=${amt}&note=${n}`,
      web: `https://venmo.com/${encodeURIComponent(user)}?txn=pay&amount=${amt}&note=${n}`,
    };
  }
  // Opens the Venmo app with the payment filled in; falls back to Venmo's website if the app doesn't open.
  function openVenmo(user, cents, note, onBack) {
    const u = venmoUrls(user, cents, note);
    let left = false;
    const vis = () => { if (document.hidden) left = true; else if (left) { document.removeEventListener("visibilitychange", vis); onBack && setTimeout(onBack, 400); } };
    document.addEventListener("visibilitychange", vis);
    if (isPhone()) {
      location.href = u.app;
      setTimeout(() => { if (!left && !document.hidden) { document.removeEventListener("visibilitychange", vis); window.open(u.web, "_blank", "noopener"); onBack && setTimeout(onBack, 800); } }, 1600);
    } else {
      document.removeEventListener("visibilitychange", vis);
      window.open(u.web, "_blank", "noopener"); onBack && setTimeout(onBack, 800);
    }
  }
  const money = (cents, c = "USD") => { const d = curDigits(c); try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c || "USD", minimumFractionDigits: d === 0 ? 0 : (cents % 10 ** d ? d : 0), maximumFractionDigits: d }).format(cents / 10 ** d); } catch { return (cents / 100).toFixed(2); } };
  const parseMoney = (str, c = "USD") => { const v = parseFloat(String(str || "").replace(/[^0-9.,-]/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "")); return Number.isFinite(v) && v > 0 ? Math.round(v * 10 ** curDigits(c)) : 0; };
  const COLORS = ["#2F7A5B", "#3E6E8E", "#9A5B2F", "#7A4E8C", "#B0533F", "#4F6B2F", "#2F5E7A"];
  const colorFor = (id) => COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  const initials = (p) => (p?.display_name || p?.email || "?").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
  const avatar = (p, cls = "") => `<span class="av ${cls}" style="background:${colorFor(p?.id)}" title="${esc(p?.display_name || p?.email || "")}">${esc(initials(p))}</span>`;

  const ICON = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    laundry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10h17l-1.7 9.1a2 2 0 0 1-2 1.6H7.2a2 2 0 0 1-2-1.6z"/><path d="M8 10l3-5.5M16 10l-3-5.5"/><path d="M9 14v3M12 14v3M15 14v3"/></svg>',
    plane: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 15.5v-2l-8-5V3.8a1.5 1.5 0 0 0-3 0v4.7l-8 5v2l8-2.5V18l-2.2 1.6V21l3.7-1 3.7 1v-1.4L13 18v-5z" transform="rotate(90 12 12)"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M12 9v6M9 12h6"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    trips: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="7" width="16" height="13" rx="3"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/></svg>',
    closet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6a2 2 0 1 0-2-2"/><path d="M12 6v1.5L3.5 15a1.5 1.5 0 0 0 1 2.6h15a1.5 1.5 0 0 0 1-2.6L12 7.5"/></svg>',
    tpl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5" stroke-linecap="round"/></svg>',
    me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4" stroke-linecap="round"/></svg>',
    google: '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.6-.4-3.5z"/></svg>',
  };
  const WX = (c) => c == null ? "·" : c === 0 ? "☀️" : c <= 2 ? "🌤️" : c === 3 ? "☁️" : c <= 48 ? "🌫️" : c <= 67 ? "🌧️" : c <= 77 ? "❄️" : c <= 82 ? "🌦️" : c <= 86 ? "🌨️" : "⛈️";
  const BAG_PRESETS = ["Carry-on", "Checked bag", "Backpack", "Personal item", "Camera bag", "Toiletry bag"];

  function toast(msg, ms = 2800) {
    const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add("hidden"), ms);
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${label ? `<span>${esc(label)}</span>` : ""}`; }
    else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  }
  const fail = (e, fallback = "Something went wrong.") => {
    const m = e?.message || String(e || "");
    toast(!navigator.onLine || /fetch|network|load failed/i.test(m) ? "You're offline — try again when you have signal." : m || fallback, 4200);
  };

  // ───────────────────────── sheet (bottom drawer) ─────────────────────────
  const sheetBg = $("#sheet"), sheetBody = $("#sheetBody");
  function openSheet(html, onClick) {
    sheetBody.innerHTML = `<div class="grab"></div>${html}`;
    sheetBg.classList.remove("hidden");
    sheetBody.onclick = onClick || null;
    const f = $("input,textarea,select", sheetBody); if (f && f.dataset.autofocus != null) setTimeout(() => f.focus(), 60);
  }
  const closeSheet = () => { sheetBg.classList.add("hidden"); sheetBody.innerHTML = ""; };
  sheetBg.addEventListener("click", (e) => { if (e.target === sheetBg) closeSheet(); });

  // ───────────────────────── Supabase ─────────────────────────
  let sb, session = null, me = null, cfg = {};
  const pendingJoinKey = "joinToken";

  async function boot() {
    try {
      const r = await fetch("/api/config"); cfg = await r.json();
      if (!r.ok) throw new Error(cfg.error || "Setup incomplete");
      store.set("cfg", cfg);
    } catch (e) {
      cfg = store.get("cfg", null);
      if (!cfg && navigator.onLine !== false && !/[?&]retry=1/.test(location.search)) { location.replace("/error"); return; }
      if (!cfg) { app.innerHTML = `<div class="auth"><div class="inner"><img src="/apple-touch-icon.png" alt=""><h1>Pack</h1><p>${esc(e.message || "Can't reach Pack right now.")}</p><a class="go" href="/" style="text-decoration:none">Try again</a></div></div>`; return; }
    }
    if (!window.supabase?.createClient) { await new Promise((r) => setTimeout(r, 400)); }
    if (!window.supabase?.createClient) { app.innerHTML = `<div class="auth"><div class="inner"><h1>Pack</h1><p>Couldn't load. Check your connection.</p><a class="go" href="/" style="text-decoration:none">Try again</a></div></div>`; return; }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    });
    const { data } = await sb.auth.getSession().catch(() => ({ data: {} }));
    session = data?.session || null;
    // Offline with an expired token: keep using the saved session so trips still open.
    // Supabase refreshes it as soon as there's signal again.
    if (!session && !navigator.onLine) session = savedSession();
    sb.auth.onAuthStateChange((ev, s) => {
      if (!s && ev !== "SIGNED_OUT" && !navigator.onLine) return;
      const was = !!session; session = s;
      if (!!s !== was) { me = null; route(); }
      if (s) flush();
    });
    window.addEventListener("hashchange", route);
    window.addEventListener("online", () => { netbar(); flush().then(() => route()); });
    window.addEventListener("offline", netbar);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") flush(); });
    route();
    flush();
  }

  function savedSession() {
    try {
      const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
      const s = k && JSON.parse(localStorage.getItem(k));
      return s?.user?.id ? s : null;
    } catch { return null; }
  }

  async function loadMe() {
    if (me || !session) return me;
    const { data } = await sb.from("profiles").select("id,email,display_name,timezone,reminders,venmo").eq("id", session.user.id).maybeSingle().catch(() => ({}));
    me = data || store.get("me", null) || { id: session.user.id, email: session.user.email, display_name: "" };
    if (data) store.set("me", data);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (data && tz && data.timezone !== tz) sb.from("profiles").update({ timezone: tz }).eq("id", session.user.id).then(() => {});
    return me;
  }

  // ───────────────────────── offline: outbox ─────────────────────────
  // Changes to items save on the phone first when there's no signal, then sync in order.
  let outbox = store.get("outbox", []);
  const isNet = (err) => !navigator.onLine || /fetch|network|load failed|timed? ?out|offline|connection/i.test(String(err?.message || err || ""));
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
  function netbar() {
    const el = $("#netbar"); if (!el) return;
    const n = outbox.length;
    const text = !navigator.onLine ? `You're offline${n ? ` · ${n} change${n === 1 ? "" : "s"} saved on this phone` : " · changes will save on this phone"}`
      : n ? `Syncing ${n} change${n === 1 ? "" : "s"}…` : "";
    el.textContent = text; el.classList.toggle("hidden", !text);
  }
  function saveOutbox() { store.set("outbox", outbox); netbar(); }
  function runOp(op) {
    if (op.type === "insert") return sb.from(op.table).insert(op.rows);
    let q = op.type === "update" ? sb.from(op.table).update(op.patch) : sb.from(op.table).delete();
    for (const [k, v] of Object.entries(op.eq || {})) q = q.eq(k, v);
    if (op.ids) q = q.in("id", op.ids);
    return q;
  }
  async function write(op) {
    if (!outbox.length && navigator.onLine) {
      let error;
      try { ({ error } = await runOp(op)); } catch (e) { error = e; }
      if (!error) return { saved: true };
      if (!isNet(error)) throw new Error(error.message || String(error));
    }
    outbox.push({ ...op, at: Date.now() }); saveOutbox();
    return { queued: true };
  }
  let flushing = null;
  function flush() {
    if (flushing) return flushing;
    if (!outbox.length || !navigator.onLine || !session || !sb) return Promise.resolve();
    flushing = (async () => {
      let done = 0, dropped = 0;
      while (outbox.length && navigator.onLine) {
        let error;
        try { ({ error } = await runOp(outbox[0])); } catch (e) { error = e; }
        if (error && isNet(error)) break;
        error ? dropped++ : done++;   // a rejected change (e.g. the item was deleted elsewhere) is dropped
        outbox.shift(); saveOutbox();
      }
      if (done) toast(`Synced ${done} change${done === 1 ? "" : "s"} you made offline`);
      if (dropped) setTimeout(() => toast(`${dropped} offline change${dropped === 1 ? "" : "s"} couldn't be saved (the item may have been removed)`, 4500), done ? 3000 : 0);
      if (done && T && location.hash === `#/trip/${T.trip.id}/pack`) { const f = await fetchTrip(T.trip.id).catch(() => null); if (f) { T = f; cacheTrip(); drawTrip(); } }
    })().finally(() => { flushing = null; netbar(); });
    return flushing;
  }

  async function api(path, body) {
    const { data } = await sb.auth.getSession();
    const r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(data.session ? { authorization: "Bearer " + data.session.access_token } : {}) },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({ error: r.status === 504 || r.status === 502 ? "Pack took too long to answer. Nothing was lost. Try again in a moment."
      : r.status >= 500 ? "Pack is having trouble right now. Nothing was lost. Try again in a minute." : "No response from Pack. Check your connection and try again." }));
    if (!r.ok || d.error) { const e = new Error(d.error || "Request failed"); e.status = r.status; throw e; }
    return d;
  }
  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  // ───────────────────────── router ─────────────────────────
  let channel = null;
  function unsubscribe() { if (channel) { sb.removeChannel(channel); channel = null; } }

  let lastRoute = null;
  async function route() {
    unsubscribe(); closeSheet();
    if (location.hash !== lastRoute) { lastRoute = location.hash; window.scrollTo(0, 0); }
    const h = location.hash.replace(/^#\/?/, "");
    const [view, id, sub] = h.split("/");
    if (view === "join" && id) store.set(pendingJoinKey, id);
    if (!session) {
      if ($(".auth #email, .auth #code") && view !== "join") return;
      if (view === "signin" || store.get(pendingJoinKey, null)) return renderSignIn();
      return renderLanding();
    }
    if (view === "signin") history.replaceState(null, "", "#/");
    document.title = "Pack";
    await loadMe().catch(() => {});
    if (store.get("activeDay", "") !== today() && navigator.onLine) {
      sb.rpc("touch_activity").then(({ error }) => { if (!error) store.set("activeDay", today()); });
    }
    const join = store.get(pendingJoinKey, null);
    if (join) return acceptInvite(join);
    try {
      if (view === "trip" && id && sub === "edit") return await renderTripForm(id);
      if (view === "trip" && id && sub === "expenses") return await renderExpenses(id);
      if (view === "trip" && id && sub === "pack") return await renderTrip(id);
      if (view === "trip" && id) return await renderOverview(id);
      if (view === "new") return await renderTripForm(null, id);
      if (view === "inventory" || view === "closet") return await renderCloset();
      if (view === "templates") return await renderTemplates();
      if (view === "template" && id) return await renderTemplate(id);
      if (view === "account") return await renderAccount();
      if (view === "admin" && id === "content") return await renderContent();
      if (view === "admin") return await renderAdmin();
      return await renderHome();
    } catch (e) {
      if (!isNet(e)) return fail(e);
      if (!$("main", app)) app.innerHTML = header({ title: "Pack" }) + `<main class="tabbed"><div class="empty"><strong>You're offline</strong>Open Pack once with signal and your trips will be saved on this phone for next time.</div></main>${tabs("trips")}`;
      netbar();
    }
  }
  new MutationObserver(() => { if ($("#netbar") && $("#netbar").dataset.done !== "1") { $("#netbar").dataset.done = "1"; netbar(); } }).observe(app, { childList: true });
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

  function tabs(on) {
    const t = (href, name, label) => `<a href="${href}" class="${on === name ? "on" : ""}">${ICON[name]}<span>${label}</span></a>`;
    return `<nav class="tabs">${t("#/", "trips", "Trips")}${t("#/inventory", "closet", "Inventory")}${t("#/templates", "tpl", "Templates")}${t("#/account", "me", "You")}</nav>`;
  }

  // ───────────────────────── light / dark ─────────────────────────
  const darkMQ = matchMedia("(prefers-color-scheme: dark)");
  const themePref = () => store.get("theme", "system");
  const isDark = () => (themePref() === "system" ? darkMQ.matches : themePref() === "dark");
  const themeIcon = () => (isDark() ? ICON.sun : ICON.moon);
  const themeLabel = () => (isDark() ? "Switch to light mode" : "Switch to dark mode");
  function applyTheme(pref) {
    store.set("theme", pref === "system" ? null : pref);
    if (pref === "light" || pref === "dark") document.documentElement.dataset.theme = pref; else delete document.documentElement.dataset.theme;
    for (const b of document.querySelectorAll("[data-theme-toggle]")) { b.innerHTML = themeIcon(); b.setAttribute("aria-label", themeLabel()); b.title = themeLabel(); }
    for (const b of document.querySelectorAll("[data-theme-pick]")) b.classList.toggle("on", b.dataset.themePick === themePref());
  }
  const themeBtn = (cls = "icon-btn theme-btn") => `<button type="button" class="${cls}" data-theme-toggle aria-label="${themeLabel()}" title="${themeLabel()}">${themeIcon()}</button>`;
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-theme-toggle]")) return applyTheme(isDark() ? "light" : "dark");
    const p = e.target.closest("[data-theme-pick]"); if (p) applyTheme(p.dataset.themePick);
  });
  darkMQ.addEventListener?.("change", () => applyTheme(themePref()));

  // ───────────────────────── add to home screen ─────────────────────────
  // Chrome/Edge/Android hand us an install prompt; iPhone Safari doesn't, so it gets step-by-step help.
  let installEvt = null;
  const UA = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(UA);
  const inAppBrowser = /Instagram|FBAN|FBAV|FB_IAB|musical_ly|TikTok|BytedanceWebview|Snapchat|Pinterest|LinkedInApp|Twitter/i.test(UA);
  const isMacSafari = !isIOS && /Macintosh/.test(UA) && /Version\/\d+.*Safari/.test(UA) && !/Chrome|Chromium|Edg/.test(UA);
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const canInstall = () => !isStandalone() && (!!installEvt || isIOS || isAndroid || inAppBrowser || isMacSafari);
  const showA2hsCard = () => canInstall() && !(store.get("a2hsHide", 0) > Date.now());
  function refreshInstall() {
    for (const el of document.querySelectorAll("[data-install-wrap]")) el.hidden = !(el.dataset.installWrap === "card" ? showA2hsCard() : canInstall());
  }
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; refreshInstall(); });
  addEventListener("appinstalled", () => { installEvt = null; store.set("a2hsHide", Date.now() + 3650 * 864e5); refreshInstall(); closeSheet(); toast("Pack is on your home screen"); });
  const SHARE_IC = '<svg class="ios-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10H16"/></svg>';
  const ADD_IC = '<svg class="ios-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-label="Add"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>';
  const DOTS_IC = '<svg class="ios-ic" viewBox="0 0 24 24" fill="currentColor" aria-label="More"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
  const steps = (list) => `<ol class="a2hs-steps">${list.map((t) => `<li>${t}</li>`).join("")}</ol>`;
  async function startInstall() {
    if (installEvt) {
      const e = installEvt; installEvt = null;
      try { await e.prompt(); const r = await e.userChoice; if (r?.outcome === "accepted") { store.set("a2hsHide", Date.now() + 3650 * 864e5); toast("Adding Pack to your home screen"); } } catch {}
      return refreshInstall();
    }
    const head = `<div class="a2hs-head"><img src="/apple-touch-icon.png" alt="" width="56" height="56"><div><h2>Add Pack to your home screen</h2><p class="muted">Opens full screen like an app, and your lists work offline.</p></div></div>`;
    let body;
    if (inAppBrowser) {
      body = `<p>You're viewing Pack inside ${/Instagram/i.test(UA) ? "Instagram" : /musical_ly|TikTok|Bytedance/i.test(UA) ? "TikTok" : "another app"}, which can't add it to your home screen. Open it in ${isIOS ? "Safari" : "your browser"} first:</p>`
        + steps([`Tap ${DOTS_IC} in the top corner.`, `Choose <strong>Open in ${isIOS ? "external browser" : "browser"}</strong>${isIOS ? " (or Open in Safari)" : ""}.`, "Then tap <strong>Add to Home Screen</strong> in Pack again."])
        + `<button class="secondary" type="button" id="a2hsCopy">Copy link instead</button>`;
    } else if (isIOS) {
      const crios = /CriOS|FxiOS|EdgiOS/.test(UA);
      body = steps([
        crios ? `Tap ${SHARE_IC} <strong>Share</strong> in the address bar.` : `Tap ${SHARE_IC} <strong>Share</strong>. It's in the toolbar, or under ${DOTS_IC} next to the address bar on newer iPhones.`,
        `Scroll down and tap ${ADD_IC} <strong>Add to Home Screen</strong>. If you don't see it, tap <strong>More</strong> or <strong>Edit Actions</strong> at the bottom.`,
        "Tap <strong>Add</strong>. Pack appears on your home screen.",
        typeof session !== "undefined" && session ? "Open Pack from your home screen and sign in once more with your email code." : "Open Pack from your home screen and sign in with your email.",
      ]);
    } else if (isAndroid) {
      body = steps(["Tap <strong>⋮</strong> in your browser's top corner.", "Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.", "Tap <strong>Add</strong> or <strong>Install</strong>."]);
    } else if (isMacSafari) {
      body = steps(["In the menu bar, choose <strong>File → Add to Dock</strong>.", "Click <strong>Add</strong>. Pack opens in its own window from your Dock."]);
    } else {
      body = steps(["Open your browser's menu.", "Choose <strong>Install Pack</strong> or <strong>Add to Home Screen</strong>."]);
    }
    openSheet(head + body + `<button class="primary" type="button" id="a2hsDone">Got it</button>`);
    $("#a2hsDone")?.addEventListener("click", closeSheet);
    $("#a2hsCopy")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.origin + "/"); toast("Link copied. Paste it into Safari."); } catch { toast(location.origin); } });
  }
  const installBtn = (cls = "secondary") => `<button type="button" class="${cls} a2hs-btn" data-install>${ICON.phone}Add to Home Screen</button>`;
  const installCard = () => `<section class="card a2hs-card" data-install-wrap="card"${showA2hsCard() ? "" : " hidden"}>
      <img src="/apple-touch-icon.png" alt="" width="44" height="44"><div class="grow"><strong>Get Pack on your home screen</strong><span class="muted">Opens like an app and works offline.</span></div>
      <button type="button" class="pill a2hs-add" data-install>Add</button><button type="button" class="a2hs-x" data-install-hide aria-label="Not now">×</button></section>`;
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-install]")) return startInstall();
    if (e.target.closest("[data-install-hide]")) { store.set("a2hsHide", Date.now() + 21 * 864e5); refreshInstall(); }
  });

  const header = ({ title, sub = "", back = "", more = false, progress = null }) => `
    <header class="bar"><div class="bar-row">
      ${back ? `<a class="icon-btn" href="${back}" aria-label="Back">${ICON.back}</a>` : ""}
      <h1>${esc(title)}</h1>
      ${themeBtn()}
      ${more ? `<button class="icon-btn" id="moreBtn" aria-label="More">${ICON.more}</button>` : ""}
    </div>${sub ? `<div class="sub">${sub}</div>` : ""}${progress != null ? `<div class="progress"><i style="width:${progress}%"></i></div>` : ""}<div id="netbar" class="netbar hidden" role="status"></div></header>`;

  // ───────────────────────── sign in ─────────────────────────
  // ───────────────────────── landing (signed-out visitors) ─────────────────────────
  function renderLanding() {
    document.title = "Pack — packing lists that sort themselves";
    const feat = (icon, t, d) => `<div class="lp-feat"><div class="lp-ic" aria-hidden="true">${icon}</div><h3>${t}</h3><p>${d}</p></div>`;
    app.innerHTML = `<div class="lp">
      <header class="lp-nav"><div class="lp-wrap lp-navrow">
        <a class="lp-brand" href="#/"><img src="/apple-touch-icon.png" alt="" width="32" height="32">Pack</a>
        <div class="lp-navright">${themeBtn("lp-theme")}<a class="lp-signin" href="#/signin">Sign in</a></div>
      </div></header>

      <section class="lp-hero"><div class="lp-wrap lp-herogrid">
        <div class="lp-copy">
          <p class="lp-eyebrow">Smart, shareable packing lists</p>
          <h1>Dump it all in.<br><span>Pack sorts it out.</span></h1>
          <p class="lp-lede">Type everything you're bringing, in any order and any format. Pack sorts it into categories and bags, checks the forecast for your dates, and keeps your gear ready for the next trip.</p>
          <div class="lp-ctas"><a class="lp-btn" href="#/signin">Start packing. It's free</a><a class="lp-link" href="#/" id="howLink">See how it works ↓</a></div>
          <div data-install-wrap="btn"${canInstall() ? "" : " hidden"}><button type="button" class="lp-a2hs" data-install>${ICON.phone}Add Pack to your home screen</button></div>
          <p class="lp-fine">Works on iPhone, iPad and Android. Add it to your home screen like an app.</p>
        </div>
        <div class="lp-phone lp-tilt"><img src="/img/trip.webp" alt="A Big Sur weekend trip in Pack: the 4-day forecast, filters for clothes, gear and essentials, and smart suggestions like bug spray and a lens cloth" width="780" height="1333" fetchpriority="high"></div>
      </div></section>

      <section class="lp-section" id="how"><div class="lp-wrap">
        <h2>Three steps, about a minute</h2>
        <ol class="lp-steps">
          <li><b>1</b><h3>Dump your list</h3><p>“passport, 3 tshirts, camera + 2 batteries, rain jacket…” Typos and all.</p></li>
          <li><b>2</b><h3>Pack sorts it</h3><p>Categories, bags, clothes vs gear vs essentials, work vs personal, plus what you might forget for this weather.</p></li>
          <li><b>3</b><h3>Check it off</h3><p>Tap as you pack, alone or with friends, even with no signal at the airport.</p></li>
        </ol>
      </div></section>

      <section class="lp-section lp-alt"><div class="lp-wrap lp-show">
        <div class="lp-phone"><img src="/img/bags.webp" alt="Items grouped by bag: daypack, duffel, camera bag, car, with check-offs from two people" width="780" height="1333" loading="lazy"></div>
        <div><p class="lp-eyebrow">Bags</p><h2>Know exactly what goes where</h2>
          <p>Add your daypack, duffel, camera bag or the car, and Pack assigns every item sensibly: documents and chargers in your carry-on, liquids checked. Move anything with one tap, or select a handful and move them together.</p></div>
      </div></section>

      <section class="lp-section"><div class="lp-wrap lp-show lp-flip">
        <div class="lp-phone"><img src="/img/inventory.webp" alt="The Inventory screen showing camera equipment, with items marked Always" width="780" height="1333" loading="lazy"></div>
        <div><p class="lp-eyebrow">Inventory</p><h2>Your gear, remembered</h2>
          <p>Keep personal items and work equipment in one place. Mark the things you never travel without as <b>Always</b>, and they're on every new trip automatically. Heading to a shoot? “Bring my equipment” adds your whole kit in one tap.</p></div>
      </div></section>

      <section class="lp-section lp-alt"><div class="lp-wrap lp-show">
        <div class="lp-phone"><img src="/img/ledger.webp" alt="Trip expenses for three friends: trip total, your share, and who owes whom with Paid back buttons" width="780" height="1333" loading="lazy"></div>
        <div><p class="lp-eyebrow">Split the costs</p><h2>Who paid for what, settled</h2>
          <p>You got coffee, they got the campsite. Log it in a few taps and Pack keeps a running tally of who owes whom. Split evenly or not, mark shares paid back as they come in, and settle up in one tap at the end.</p></div>
      </div></section>

      <section class="lp-section"><div class="lp-wrap lp-show lp-flip">
        <div class="lp-phone"><img src="/img/people.webp" alt="A shared trip grouped by person: what you're bringing, what Sam is bringing and what anyone can bring, with a Pack last section at the top" width="780" height="1333" loading="lazy"></div>
        <div><p class="lp-eyebrow">Traveling together</p><h2>Who's bringing what, sorted</h2>
          <p>Share a trip with one link. Everyone keeps a private <b>My list</b> for their own clothes and gear, so two red shirts never collide, plus a shared <b>Group list</b> for the tent, the cooler and the speaker. Assign who's bringing what, and it shows up in their list too. Check-offs sync live, and last-second things wait in <b>Pack last</b>.</p></div>
      </div></section>

      <section class="lp-section lp-alt"><div class="lp-wrap">
        <h2>Everything a trip needs</h2>
        <div class="lp-feats">
          ${feat("☀️", "Weather-smart", "Forecast for your dates, or typical weather if you're planning far ahead, with suggestions to match.")}
          ${feat("👥", "Pack together", "Share a trip with one link. Check-offs show up live on everyone's phone.")}
          ${feat("🙋", "Who's bringing what", "Assign items to people (“Sam's got the tent”) and see just your own list.")}
          ${feat("💸", "Split the costs", "Log who paid for coffee, dinner or gas. Pack keeps a running tally of who owes whom, and you mark it paid back.")}
          ${feat("⏰", "Pack last", "Things you use until you leave, like your charger or toothbrush, wait in their own last-minute list.")}
          ${feat("📬", "Day-before reminder", "An email the day before you leave with what's left to pack and what to grab last.")}
          ${feat("🧳", "Bags", "Group by carry-on, checked bag, camera bag. Move items with a tap.")}
          ${feat("👕", "Clothes, gear, essentials", "Filter in a tap, and split work kit from personal stuff.")}
          ${feat("🎒", "Inventory & equipment", "Keep your gear in one place and bring your whole work kit to a trip in one tap.")}
          ${feat("📴", "Works offline", "Check things off with no signal. Everything syncs when you're back.")}
          ${feat("🔁", "Templates", "Save a trip you take often and start the next one from it.")}
          ${feat("📊", "Your packing stats", "Trips planned, days away, and the things that come with you every time.")}
        </div>
      </div></section>

      <section class="lp-final"><div class="lp-wrap">
        <h2>Your next trip, sorted.</h2>
        <p>Free to use. Sign in with a code we email you; no password to remember.</p>
        <a class="lp-btn" href="#/signin">Start packing</a>
      </div></section>

      <footer class="lp-foot"><div class="lp-wrap"><a href="/terms">Terms of Use</a> · <a href="/privacy">Privacy Policy</a> · © ${new Date().getFullYear()} Spruce &amp; Sound</div></footer>
    </div>`;
    $("#howLink").addEventListener("click", (e) => { e.preventDefault(); $("#how").scrollIntoView({ behavior: "smooth" }); });
  }

  function renderSignIn(step = "email", email = store.get("lastEmail", "")) {
    document.title = "Pack";
    const invite = store.get(pendingJoinKey, null);
    if (step === "email") {
      app.innerHTML = `${themeBtn("auth-theme")}<section class="auth"><form id="f">
        <img src="/apple-touch-icon.png" alt="">
        <h1>Pack</h1>
        <p>${invite ? "Sign in to join the trip you were invited to." : "Dump everything you're bringing. Pack sorts it into a smart list."}</p>
        <input id="email" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" value="${esc(email)}" required aria-label="Email">
        <button class="go" id="go" type="submit">Email me a sign-in code</button>
        <div class="err" id="err" role="alert"></div>
        <div class="fine">New here? Same steps — your account is created automatically.<br>By continuing you agree to Pack's <a href="/terms" target="_blank" rel="noopener">Terms of Use</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</div>
        ${invite ? "" : `<a class="link" href="#/" style="display:inline-block">← What is Pack?</a>`}
      </form></section>`;
      $("#f").addEventListener("submit", async (e) => {
        e.preventDefault();
        const em = $("#email").value.trim(); store.set("lastEmail", em);
        busy($("#go"), true, "Sending…"); $("#err").textContent = "";
        const { error } = await sb.auth.signInWithOtp({ email: em, options: { shouldCreateUser: true, emailRedirectTo: location.origin + "/" } });
        busy($("#go"), false);
        // A slow mail server can time out here even though the email still goes out, so go to the code screen anyway.
        if (error && !/timeout|timed out|504|deadline|fetch/i.test(`${error.status} ${error.message}`)) { $("#err").textContent = error.message; return; }
        renderSignIn("code", em);
        if (error) $("#err").textContent = "Email is taking longer than usual. Check your inbox in a minute; if nothing arrives, go back and try again.";
      });
    } else {
      app.innerHTML = `${themeBtn("auth-theme")}<section class="auth"><form id="f">
        <img src="/apple-touch-icon.png" alt="">
        <h1>Check your email</h1>
        <p>We sent a code to <strong>${esc(email)}</strong>. Enter it here.</p>
        <input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="••••••" required aria-label="Sign-in code">
        <button class="go" id="go" type="submit">Sign in</button>
        <div class="err" id="err" role="alert"></div>
        <button class="link" id="back" type="button">Use a different email</button>
      </form></section>`;
      setTimeout(() => $("#code")?.focus(), 50);
      $("#back").addEventListener("click", () => renderSignIn("email", email));
      $("#f").addEventListener("submit", async (e) => {
        e.preventDefault();
        busy($("#go"), true, "Signing in…"); $("#err").textContent = "";
        const { error } = await sb.auth.verifyOtp({ email, token: $("#code").value.replace(/\D/g, ""), type: "email" });
        busy($("#go"), false);
        if (error) $("#err").textContent = /expired|invalid/i.test(error.message) ? "That code didn't work or has expired. Try again or request a new one." : error.message;
      });
    }
  }

  async function acceptInvite(token) {
    store.set(pendingJoinKey, null);
    const ok = await new Promise((resolve) => {
      app.innerHTML = `${themeBtn("auth-theme")}<section class="auth"><div class="inner"><img src="/apple-touch-icon.png" alt="">
        <h1>Join a shared trip?</h1><p>Someone invited you to pack together. Joining shows them your name and email, and you'll see theirs.</p>
        <button class="go" id="yes">Join trip</button><button class="link" id="no">Not now</button></div></section>`;
      $("#yes").addEventListener("click", () => resolve(true));
      $("#no").addEventListener("click", () => resolve(false));
    });
    if (!ok) return go("#/");
    app.innerHTML = `<div class="boot"><img src="/apple-touch-icon.png" alt=""><span class="spin"></span></div>`;
    const { data, error } = await sb.rpc("accept_invite", { p_token: token });
    if (error) { toast(error.message, 4500); return go("#/"); }
    toast("You've joined the trip");
    go("#/trip/" + data);
  }

  // ───────────────────────── home (trips) ─────────────────────────
  function ring(p, n) {
    const pct = n ? p / n : 0, R = 18, C = 2 * Math.PI * R;
    return `<svg class="ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="${R}" fill="none" stroke="var(--sunk)" stroke-width="5"/>
      <circle cx="22" cy="22" r="${R}" fill="none" stroke="${pct === 1 ? "var(--ok)" : "var(--amber)"}" stroke-width="5" stroke-linecap="round"
      stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" transform="rotate(-90 22 22)"/></svg>`;
  }
  function tripCard(t) {
    const items = t.items || [], p = items.filter((i) => i.packed).length, n = items.length;
    const shared = (t.trip_members || []).length > 1;
    const bits = [dateRange(t.start_date, t.end_date), t.destination].filter(Boolean).map(esc).join(" · ");
    return `<a class="trip-card" href="#/trip/${t.id}">${ring(p, n)}<div class="grow">
      <div class="t">${esc(t.name)}${shared ? '<span class="badge">Shared</span>' : ""}</div>
      <div class="m">${n ? (p === n ? "All packed" : `${p} of ${n} packed`) : "No items yet"}${bits ? " · " + bits : ""}</div></div></a>`;
  }
  async function renderHome() {
    const draw = (trips) => {
      const t0 = today();
      const upcoming = trips.filter((t) => !t.end_date || t.end_date >= t0);
      const past = trips.filter((t) => t.end_date && t.end_date < t0);
      app.innerHTML = header({ title: "Trips", sub: me?.display_name ? `Hi, ${esc(me.display_name)}` : "" }) +
        `<main class="tabbed">${installCard()}${!trips.length ? `<div class="empty"><strong>No trips yet</strong>Tap “New trip”, dump everything you're bringing, and Pack sorts it — with weather-smart suggestions.</div>` : ""}
        ${upcoming.map(tripCard).join("")}
        ${past.length ? `<h3 class="sec">Past trips</h3>${past.map(tripCard).join("")}` : ""}</main>
        <a class="fab" href="#/new">${ICON.plus}New trip</a>${tabs("trips")}`;
    };
    const cached = store.get("trips", null);
    if (cached) draw(cached);
    const trips = must(await sb.from("trips").select("id,name,destination,start_date,end_date,updated_at,items(packed),trip_members(user_id)")
      .order("start_date", { ascending: true, nullsFirst: false }).order("updated_at", { ascending: false }));
    store.set("trips", trips);
    if (location.hash.replace(/^#\/?/, "") === "") draw(trips);
  }

  // ───────────────────────── new / edit trip ─────────────────────────
  async function renderTripForm(tripId, templateId) {
    const editing = !!tripId;
    let trip = { name: "", destination: "", start_date: "", end_date: "", details: "", bags: [] };
    let tpls = [], always = [], equipment = [], tpl = null;
    if (editing) trip = must(await sb.from("trips").select("*").eq("id", tripId).single());
    else {
      [tpls, always] = await Promise.all([
        sb.from("templates").select("id,name,bags,items").order("created_at", { ascending: false }).then(must),
        sb.from("closet_items").select("name,qty,category,always,purpose").then(must),
      ]);
      equipment = always.filter((i) => i.purpose === "work" && !i.always);
      always = always.filter((i) => i.always);
      tpl = tpls.find((t) => t.id === templateId) || null;
      if (tpl) trip.bags = [...(tpl.bags || [])];
    }
    let bags = [...(trip.bags || [])];

    app.innerHTML = header({ title: editing ? "Edit trip" : "New trip", back: editing ? `#/trip/${tripId}` : "#/" }) + `<main>
      <form id="f" autocomplete="off">
        <label class="f" for="name">Trip name</label>
        <input class="t" id="name" value="${esc(trip.name)}" placeholder="Seattle weekend" required maxlength="120">
        <label class="f" for="dest">Destination <small>(for weather)</small></label>
        <input class="t" id="dest" value="${esc(trip.destination || "")}" placeholder="Seattle, WA" maxlength="160">
        <div class="row2">
          <div><label class="f" for="start">Leave</label><input class="t" id="start" type="date" value="${esc(trip.start_date || "")}"></div>
          <div><label class="f" for="end">Return</label><input class="t" id="end" type="date" value="${esc(trip.end_date || "")}"></div>
        </div>
        <label class="f" for="details">What's the trip? <small>(optional)</small></label>
        <input class="t" id="details" value="${esc(trip.details || "")}" placeholder="Shooting a wedding, one nice dinner, a hike" maxlength="1000">
        <label class="f" for="cur">Currency <small>(for splitting costs)</small></label>
        <select class="t" id="cur">${[...new Set([trip.currency || "USD", ...CURRENCIES])].map((c) => `<option${c === (trip.currency || "USD") ? " selected" : ""}>${c}</option>`).join("")}</select>
        <label class="f">Bags <small>(optional — Pack assigns each item to one)</small></label>
        <div class="chips" id="bags"></div>
        ${editing ? "" : `
        ${tpls.length ? `<label class="f" for="tpl">Start from a template <small>(optional)</small></label>
          <select class="t" id="tpl"><option value="">None</option>${tpls.map((t) => `<option value="${t.id}"${tpl?.id === t.id ? " selected" : ""}>${esc(t.name)} (${(t.items || []).length} items)</option>`).join("")}</select>` : ""}
        ${always.length ? `<label class="check-row"><input type="checkbox" id="always" checked><span class="grow">Add my ${always.length} always-pack item${always.length === 1 ? "" : "s"} from your inventory</span></label>` : ""}
        ${equipment.length ? `<label class="check-row"><input type="checkbox" id="equip"><span class="grow">Bring my equipment (${equipment.length} item${equipment.length === 1 ? "" : "s"})</span></label>` : ""}
        <label class="f" for="items">Everything you're bringing</label>
        <textarea class="t" id="items" placeholder="passport, charger, 3 tshirts, toothbrush, jeans x2, rain jacket, camera + 2 batteries…"></textarea>
        <p class="hint">Any order, any format. Typos are fine.</p>`}
        <button class="primary" id="save" type="submit">${editing ? "Save" : "Create & sort"}</button>
      </form></main>`;

    const drawBags = () => {
      const extra = BAG_PRESETS.filter((b) => !bags.some((x) => key(x) === key(b)));
      $("#bags").innerHTML = bags.map((b, i) => `<button type="button" class="chip on" data-rm="${i}">${esc(b)} <span class="x">×</span></button>`).join("") +
        extra.map((b) => `<button type="button" class="chip dash" data-add="${esc(b)}">+ ${esc(b)}</button>`).join("") +
        `<button type="button" class="chip dash" data-custom>+ Other…</button>`;
    };
    drawBags();
    $("#bags").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.rm != null) bags.splice(+b.dataset.rm, 1);
      else if (b.dataset.add) bags.push(b.dataset.add);
      else if (b.dataset.custom != null) { const n = prompt("Bag name"); if (n && n.trim() && !bags.some((x) => key(x) === key(n))) bags.push(n.trim().slice(0, 40)); }
      drawBags();
    });
    $("#tpl")?.addEventListener("change", (e) => {
      const t = tpls.find((x) => x.id === e.target.value);
      if (t) { for (const b of t.bags || []) if (!bags.some((x) => key(x) === key(b))) bags.push(b); drawBags(); }
    });
    attachInventorySuggest($("#items"), {
      exclude: () => new Set($("#items").value.split(/[,\n]+/).map((x) => key(x.replace(/\s*\([^)]*\)\s*$/, ""))).filter(Boolean)),
      onPick: () => {},
    });
    $("#start").addEventListener("change", () => { if (!$("#end").value || $("#end").value < $("#start").value) $("#end").value = $("#start").value; });

    $("#f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#save");
      const row = {
        name: $("#name").value.trim(), destination: $("#dest").value.trim() || null,
        start_date: $("#start").value || null, end_date: $("#end").value || $("#start").value || null,
        details: $("#details").value.trim() || null, bags, currency: $("#cur").value || "USD",
      };
      if (row.end_date && row.start_date && row.end_date < row.start_date) return toast("Return date is before the leave date.");
      try {
        if (editing) {
          busy(btn, true, "Saving…");
          const placeChanged = row.destination !== trip.destination || row.start_date !== trip.start_date || row.end_date !== trip.end_date;
          must(await sb.from("trips").update(placeChanged ? { ...row, weather: null } : row).eq("id", tripId));
          const removed = (trip.bags || []).filter((b) => !bags.some((x) => key(x) === key(b)));
          if (removed.length) must(await sb.from("items").update({ bag: "" }).eq("trip_id", tripId).in("bag", removed));
          return go(`#/trip/${tripId}`);
        }
        busy(btn, true, "Creating…");
        const created = must(await sb.from("trips").insert({ ...row, owner_id: session.user.id }).select("*").single());
        const chosen = tpls.find((t) => t.id === $("#tpl")?.value);
        const parts = [$("#items").value.trim()];
        if (chosen) parts.push(chosen.items.map((i) => (i.qty ? `${i.name} (${i.qty})` : i.name)).join("\n"));
        const workNames = new Set();
        if ($("#always")?.checked) { parts.push(always.map((i) => (i.qty ? `${i.name} (${i.qty})` : i.name)).join("\n")); always.filter((i) => i.purpose === "work").forEach((i) => workNames.add(key(i.name))); }
        if ($("#equip")?.checked) { parts.push(equipment.map((i) => (i.qty ? `${i.name} (${i.qty})` : i.name)).join("\n")); equipment.forEach((i) => workNames.add(key(i.name))); }
        const text = parts.filter(Boolean).join("\n");
        let weather = null;
        if (row.destination) { busy(btn, true, "Checking the weather…"); weather = await getWeather(created).catch(() => null); }
        if (text) { busy(btn, true, "Sorting your list…"); await sortInto(created, text, [], weather, workNames); }
        go(`#/trip/${created.id}${text ? "/pack" : ""}`);
      } catch (err) { busy(btn, false); fail(err); }
    });
  }

  async function getWeather(trip) {
    const w = await api("/api/weather", { destination: trip.destination, start: trip.start_date, end: trip.end_date, units });
    await sb.from("trips").update({ weather: w }).eq("id", trip.id);
    trip.weather = w;
    return w;
  }

  // Sort raw text with Claude and insert the results. If sorting fails, keep the raw lines so nothing is lost.
  // Items that couldn't be sorted (offline, or out of smart sorts) go in "Unsorted" so nothing is lost.
  async function addUnsorted(trip, text, owner = session.user.id) {
    const lines = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 200);
    if (!lines.length) return;
    const base = T && T.trip.id === trip.id ? T.items.length : 0;
    const rows = lines.map((name, i) => ({ id: newId(), trip_id: trip.id, personal_of: owner, name: name.slice(0, 200), qty: "", note: "", category: "Unsorted", bag: "", kind: "gear", purpose: "personal", packed: false, packed_by: null, position: 1000 + base + i }));
    if (T && T.trip.id === trip.id) { T.items.push(...rows.map((r) => ({ ...r, created_at: new Date().toISOString() }))); cacheTrip(); }
    await write({ type: "insert", table: "items", rows: rows.map(({ packed_by, ...r }) => r) });
  }

  async function sortInto(trip, text, existing, weather, workNames = new Set(), owner = session.user.id) {
    existing = existing.filter((i) => inList(i, owner));
    let res;
    try {
      res = await api("/api/sort", {
        items: text, mode: "trip",
        trip: { name: trip.name, destination: trip.destination, start: trip.start_date, end: trip.end_date, details: trip.details, bags: trip.bags, weather: weather?.summary || trip.weather?.summary || "" },
        categories: [...new Set(existing.map((i) => i.category))],
        have: existing.map((i) => i.name),
      });
    } catch (e) {
      if (e.status === 401) throw e;
      await addUnsorted(trip, text, owner);
      toast(isNet(e) ? "Added — Pack will sort them when you're back online." : (e.status === 429 ? e.message : "Couldn't sort right now.") + " Your items were added unsorted.", 5000);
      return;
    }
    const have = new Set(existing.map((i) => key(i.name)));
    const rows = res.items.filter((i) => !have.has(key(i.name)) && (have.add(key(i.name)), true))
      .map((i, n) => ({ id: newId(), trip_id: trip.id, personal_of: owner, name: i.name, qty: i.qty || "", note: i.note || "", category: i.category || "Other", bag: i.bag || "", kind: i.kind || "gear", purpose: workNames.has(key(i.name)) ? "work" : i.purpose || "personal", pack_last: !!i.last, position: existing.length + n }));
    if (rows.length) must(await sb.from("items").insert(rows));
    const allNames = new Set([...have, ...rows.map((r) => key(r.name))]);
    const prev = Array.isArray(trip.suggestions) ? trip.suggestions : [];
    const merged = [...res.suggestions, ...prev].filter((s, i, a) => !allNames.has(key(s.name)) && a.findIndex((x) => key(x.name) === key(s.name)) === i).slice(0, 6);
    await sb.from("trips").update({ suggestions: merged }).eq("id", trip.id);
    trip.suggestions = merged;
    if (res.remaining != null && res.remaining <= 3) toast(`${res.remaining} smart sort${res.remaining === 1 ? "" : "s"} left today`);
  }

  // ───────────────────────── one trip ─────────────────────────
  const view = { group: store.get("group", "category"), hide: false, kind: "all", purpose: store.get("purpose", "all"), who: store.get("who", "all"), list: store.get("list", "mine"), select: false, picked: new Set(), laundry: false };
  const GROUPMINE = "\u0000groupmine";
  // Which list new items go to: your own list, or the shared group list.
  const targetList = () => (T.members.length > 1 && view.list === "group" ? null : session.user.id);
  const inList = (i, owner) => (owner ? i.personal_of === owner : !i.personal_of);
  const LAST = "\u0000last";
  const firstName = (uid) => nameOf(uid) === "You" ? "you" : String(nameOf(uid)).split(/[\s@]/)[0];
  const VENMO_ICON = `<svg class="vm-ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.5 3c.7 1.1 1 2.3 1 3.8 0 4.7-4 10.8-7.3 15.2H5.7L2.7 4.1l6.6-.6 1.6 12.8c1.5-2.4 3.3-6.2 3.3-8.8 0-1.4-.2-2.4-.6-3.2L19.5 3z"/></svg>`;
  const nameOf = (uid) => uid === session.user.id ? "You" : (profileOf(uid).display_name || profileOf(uid).email || "Someone");
  const KINDS = [["clothes", "Clothes"], ["gear", "Gear"], ["essentials", "Essentials"]];
  const kindOf = (i) => i.kind || "gear";
  const purposeOf = (i) => i.purpose || "personal";
  const inInventory = (i) => (T.inventory || []).includes(key(i.name));
  const isAlways = (i) => (T.always || []).includes(key(i.name));
  // "Always bring": an item in your inventory marked Always is added to every new trip.
  async function setAlways(it, on) {
    const k = key(it.name);
    const rows = must(await sb.from("closet_items").select("id,name").eq("owner_id", session.user.id)).filter((r) => key(r.name) === k);
    if (rows.length) {
      const { error } = await sb.from("closet_items").update({ always: on }).in("id", rows.map((r) => r.id)); if (error) throw error;
    } else if (on) {
      await write({ type: "insert", table: "closet_items", rows: [{ id: newId(), name: it.name, qty: it.qty, note: it.note, category: it.category, kind: kindOf(it), purpose: purposeOf(it), always: true, owner_id: session.user.id }] });
      T.inventory = [...new Set([...(T.inventory || []), k])];
    }
    T.always = on ? [...new Set([...(T.always || []), k])] : (T.always || []).filter((x) => x !== k);
    invCache = null; cacheTrip();
  }
  async function addToInventory(list) {
    const fresh = list.filter((i) => !inInventory(i));
    if (!fresh.length) return toast(list.length > 1 ? "Those are all in your inventory already" : "Already in your inventory");
    invCache = null;
    try { await write({ type: "insert", table: "closet_items", rows: fresh.map((i) => ({ id: newId(), name: i.name, qty: i.qty, note: i.note, category: i.category, kind: kindOf(i), purpose: purposeOf(i), owner_id: session.user.id })) }); }
    catch (err) { return fail(err); }
    T.inventory = [...(T.inventory || []), ...fresh.map((i) => key(i.name))]; cacheTrip();
    const skipped = list.length - fresh.length;
    toast(`${fresh.length === 1 && list.length === 1 ? "Added" : fresh.length + " added"} to your inventory${skipped ? ` (${skipped} already there)` : ""}`);
  }
  const bagOf = (i) => T.trip.bags.find((b) => key(b) === key(i.bag)) || "";
  let T = null; // current trip state: { trip, items, members, profiles }

  async function fetchTrip(id) {
    const [trip, items, members, inv] = await Promise.all([
      sb.from("trips").select("*").eq("id", id).maybeSingle().then(must),
      sb.from("items").select("*").eq("trip_id", id).order("position").order("created_at").then(must),
      sb.from("trip_members").select("user_id,role").eq("trip_id", id).then(must),
      sb.from("closet_items").select("name,always").eq("owner_id", session.user.id).then(must),
    ]);
    if (!trip) return null;
    const ids = members.map((m) => m.user_id);
    const profiles = ids.length ? must(await sb.from("profiles").select("id,email,display_name,venmo").in("id", ids)) : [];
    return applyPending({ trip, items, members, profiles, inventory: inv.map((i) => key(i.name)), always: inv.filter((i) => i.always).map((i) => key(i.name)) });
  }

  async function renderTrip(id) {
    const cached = store.get("trip." + id, null);
    if (cached) { T = cached; drawTrip(); }
    const fresh = await fetchTrip(id);
    if (!fresh) { store.set("trip." + id, null); toast("That trip isn't available."); return go("#/"); }
    T = fresh; cacheTrip(); drawTrip();

    const wx0 = T.trip.weather, t0 = today();
    const notOver = !T.trip.end_date || T.trip.end_date >= t0;
    const underway = notOver && (!T.trip.start_date || T.trip.start_date <= t0);
    const maxAge = (underway ? 1 : wx0?.hours?.length ? 2 : 6) * 3600e3;
    const stale = !wx0 || !("lat" in wx0) || (notOver && (Date.now() - new Date(wx0.fetched || 0) > maxAge
      || (wx0.kind !== "typical" && !("offset" in wx0)) || (underway && wx0.hours?.length && wxNow(wx0).hours.length < 46)));
    if (T.trip.destination && stale) getWeather(T.trip).then(() => { if (T?.trip.id === id) drawTrip(); }).catch(() => {});

    // Live updates from other members
    let h;
    channel = sb.channel("trip-" + id)
      .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `trip_id=eq.${id}` }, () => { clearTimeout(h); h = setTimeout(refresh, 250); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trips", filter: `id=eq.${id}` }, () => { clearTimeout(h); h = setTimeout(refresh, 250); })
      .subscribe();
    async function refresh() {
      if (location.hash !== `#/trip/${id}/pack`) return;
      const f = await fetchTrip(id).catch(() => null);
      if (f) { T = f; cacheTrip(); drawTrip(); }
    }
  }

  // Fresh data from the server doesn't include changes still waiting to sync, so replay them on top.
  function applyPending(t) {
    for (const op of outbox) {
      if (op.table !== "items") continue;
      if (op.type === "insert") for (const r of op.rows) { if (r.trip_id === t.trip.id && !t.items.some((i) => i.id === r.id)) t.items.push({ packed: false, packed_by: null, ...r }); }
      if (op.type === "update") t.items.forEach((i) => { if ((op.ids && op.ids.includes(i.id)) || (op.eq && op.eq.trip_id === t.trip.id)) Object.assign(i, op.patch); });
      if (op.type === "delete" && op.ids) t.items = t.items.filter((i) => !op.ids.includes(i.id));
    }
    return t;
  }
  function cacheTrip() {
    if (!T) return;
    store.set("trip." + T.trip.id, T);
    const list = store.get("trips", []) || [];
    let row = list.find((x) => x.id === T.trip.id);
    if (!row) { row = { id: T.trip.id }; list.push(row); }
    Object.assign(row, { name: T.trip.name, destination: T.trip.destination, start_date: T.trip.start_date, end_date: T.trip.end_date, updated_at: T.trip.updated_at,
      items: T.items.map((i) => ({ packed: i.packed, name: i.name, kind: i.kind })), trip_members: T.members.map((m) => ({ user_id: m.user_id })) });
    store.set("trips", list);
  }
  const profileOf = (uid) => T.profiles.find((p) => p.id === uid) || { id: uid, display_name: "Someone" };

  // ───────────── weather card: days, hour by hour, wind map ─────────────
  const WXN = (c, day) => (!day && c != null && c <= 2 ? (c <= 1 ? "🌙" : "☁️") : WX(c));
  const hourLabel = (t) => { const h = Number(t.slice(11, 13)); return h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : (h - 12) + "p"; };
  const clock = (hm) => { if (!hm) return ""; const [h, m] = hm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`; };
  let wxOpen = { hours: true };
  // Drop hours and days that have already passed at the destination (forecasts are saved, and time moves on).
  function wxNow(wx) {
    const nowH = typeof wx.offset === "number" ? new Date(Date.now() + wx.offset * 1000).toISOString().slice(0, 13)
      : new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 13);
    const hours = (Array.isArray(wx.hours) ? wx.hours : []).filter((h) => String(h.t).slice(0, 13) >= nowH).slice(0, 48);
    const fore = wx.kind !== "typical" && Array.isArray(wx.days);
    const left = fore ? wx.days.filter((d) => String(d.date).slice(0, 10) >= nowH.slice(0, 10)) : wx.days || [];
    return { nowH, hours, days: left.length ? left : wx.days || [] };
  }
  function weatherCard(trip) {
    const wx0 = trip.weather;
    if (!(wx0 && Array.isArray(wx0.days) && wx0.days.length)) {
      return trip.destination ? "" : `<a class="card wx" style="display:block;text-decoration:none;color:inherit;padding:14px 16px" href="#/trip/${trip.id}/edit"><span class="muted">Add a destination and dates to see the weather and get weather-smart suggestions →</span></a>`;
    }
    const now = wxNow(wx0), wx = { ...wx0, days: now.days };
    const windUnit = wx.units === "c" ? "km/h" : "mph";
    const hours = now.hours;
    const startsToday = hours.length && hours[0].t.slice(0, 13) === now.nowH;
    const d0 = wx.days[0];
    return `<section class="card wx">
      <div class="wx-head"><strong>${esc(wx.place)}</strong><span>${wx.kind === "typical" ? "Typical for your dates" : wx.kind === "next7" ? "Next 7 days" : "Forecast"}</span></div>
      <div class="wx-days">${wx.days.map((d) => `<div class="wx-day"><div class="d">${esc(fmtDate(String(d.date).slice(0, 10), { weekday: "short" }))} ${esc(Number(String(d.date).slice(8, 10)))}</div>
        <div class="i">${WX(Number(d.code))}</div><div class="h">${esc(Number(d.hi))}°</div><div class="l">${esc(Number(d.lo))}°</div>
        <div class="p">${wx.kind === "typical" ? (Number(d.rain) > (wx.units === "c" ? 1 : 0.04) ? "rain" : "") : Number(d.rain) >= 20 ? esc(Number(d.rain)) + "%" : ""}</div></div>`).join("")}</div>
      <div class="wx-sum">${esc(wx.summary)}</div>
      ${hours.length ? `<button class="wx-toggle" data-wx="hours" aria-expanded="${wxOpen.hours}">${wxOpen.hours ? "▾" : "▸"} ${startsToday ? `Next ${hours.length >= 48 ? 48 : hours.length} hours` : "Hour by hour, first two days"}</button>
        ${d0?.sunrise && wxOpen.hours ? `<div class="wx-sun">Sunrise ${esc(clock(d0.sunrise))} · Sunset ${esc(clock(d0.sunset))}${d0.wind ? ` · Gusts to ${esc(Number(d0.wind))} ${windUnit}` : ""}</div>` : ""}
        ${wxOpen.hours ? `<div class="wx-hours" role="list">${hours.map((h, i) => `${i && h.t.slice(11, 13) === "00" ? `<div class="wx-sep" role="presentation"><span>${esc(fmtDate(h.t.slice(0, 10), { weekday: "short" }))}</span></div>` : ""}<div class="wx-hour${h.day ? "" : " night"}" role="listitem">
            <div class="t">${i === 0 && startsToday ? "Now" : hourLabel(h.t)}</div>
            <div class="i">${WXN(Number(h.code), h.day)}</div>
            <div class="h">${esc(Number(h.temp))}°</div>
            ${Math.abs(Number(h.feels) - Number(h.temp)) >= 4 ? `<div class="f" title="Feels like">feels ${esc(Number(h.feels))}°</div>` : `<div class="f"></div>`}
            <div class="p">${Number(h.rain) >= 10 ? esc(Number(h.rain)) + "%" : ""}</div>
            <div class="w" title="Wind ${esc(Number(h.wind))} ${windUnit}"><span class="arr" style="transform:rotate(${(Number(h.dir) + 180) % 360}deg)">↑</span>${esc(Number(h.wind))}</div>
          </div>`).join("")}</div>
          <div class="wx-legend">Rain chance in blue · wind in ${windUnit}, arrow shows where it's blowing</div>` : ""}` : ""}
    </section>`;
  }

  function tripTabs(on) {
    const id = T.trip.id;
    return `<nav class="triptabs" aria-label="Trip sections">
      <a href="#/trip/${id}" class="${on === "overview" ? "on" : ""}">Overview</a>
      <a href="#/trip/${id}/pack" class="${on === "packing" ? "on" : ""}">Packing</a>
      <a href="#/trip/${id}/expenses" class="${on === "expenses" ? "on" : ""}">Expenses</a></nav>`;
  }

  function drawTrip() {
    const { trip, items: all } = T;
    const me_ = session.user.id;
    const shared = T.members.length > 1;
    const onGroup = shared && view.list === "group";
    // Solo trips show one list. Shared trips switch between your private list and the group list;
    // your list also shows the group items you've said you'll bring.
    const myItems = all.filter((i) => i.personal_of === me_ || (!shared && !i.personal_of));
    const groupItems = all.filter((i) => !i.personal_of);
    const myGroupJobs = groupItems.filter((i) => i.assigned_to === me_);
    const items = !shared ? all : onGroup ? groupItems : [...myItems, ...myGroupJobs];
    const p = items.filter((i) => i.packed).length, n = items.length;
    const byBag = view.group === "bag";
    const byPerson = view.group === "person" && onGroup;
    const scrollY = window.scrollY;
    const hasWork = items.some((i) => purposeOf(i) === "work");
    const whoOk = (i) => !onGroup || view.who === "all" || (view.who === "mine" ? i.assigned_to === me_ : !i.assigned_to);
    const inPurpose = items.filter((i) => (view.purpose === "all" || purposeOf(i) === view.purpose) && whoOk(i));
    const laundryN = inPurpose.filter((i) => i.laundry && (view.kind === "all" || kindOf(i) === view.kind)).length;
    if (view.laundry && !items.some((i) => i.laundry)) view.laundry = false;
    const shown = inPurpose.filter((i) => (view.kind === "all" || kindOf(i) === view.kind) && (!view.laundry || i.laundry));
    const listStat = (arr) => `${arr.filter((i) => i.packed).length}/${arr.length}`;

    const groupOf = (i) => (shared && !onGroup && !i.personal_of) ? GROUPMINE : (!byBag && i.pack_last) ? LAST : byBag ? bagOf(i) : byPerson ? (i.assigned_to || "") : i.category || "Other";
    const groups = new Map();
    const order = byBag ? [...trip.bags, ""] : byPerson ? [LAST, session.user.id, ...T.members.map((m) => m.user_id).filter((u) => u !== session.user.id), ""] : [];
    for (const i of shown) {
      if (view.hide && i.packed && !view.select) continue;
      const g = groupOf(i);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(i);
    }
    const names = [...(byBag || byPerson ? order.filter((g) => groups.has(g)) : [...(groups.has(LAST) ? [LAST] : []), ...[...groups.keys()].filter((g) => g !== LAST && g !== GROUPMINE)]),
      ...(groups.has(GROUPMINE) ? [GROUPMINE] : [])];
    const groupLabel = (g) => g === GROUPMINE ? "👥 You're bringing for the group" : g === LAST ? "⏰ Pack last" : byBag ? (g || "No bag yet") : byPerson ? (g ? (g === session.user.id ? "You're bringing" : `${nameOf(g)} is bringing`) : "Anyone can bring") : g || "Other";
    const counts = (g) => { const all = shown.filter((i) => groupOf(i) === g); return `${all.filter((i) => i.packed).length}/${all.length}`; };
    const kindCount = (k) => inPurpose.filter((i) => k === "all" || kindOf(i) === k).length;

    const wxHtml = weatherCard(trip);

    const sugg = Array.isArray(trip.suggestions) ? trip.suggestions : [];
    const ownerId = T.members.find((m) => m.role === "owner")?.user_id;

    app.innerHTML = header({
      title: trip.name, back: "#/", more: true, progress: n ? (p / n) * 100 : 0,
      sub: [n ? `${p} of ${n} packed${shared ? (onGroup ? " (group)" : " (yours)") : ""}` : (shared && !onGroup ? "Your list is empty" : "No items yet"), dateRange(trip.start_date, trip.end_date), trip.destination].filter(Boolean).map(esc).join(" · "),
    }) + `<main${view.select ? ' style="padding-bottom:calc(var(--safe-b) + 240px)"' : ""}>
      ${wxHtml}
      <div class="members">
        <span class="avs">${T.members.map((m) => avatar(profileOf(m.user_id))).join("")}</span>
        <span class="grow muted" style="font-size:14px">${shared ? `Packing with ${T.members.length - 1} other${T.members.length > 2 ? "s" : ""}` : "Just you"}</span>
        <button class="pill" id="shareBtn">Share</button>
      </div>
      ${tripTabs("packing")}
      ${shared ? `<div class="listtabs" role="tablist" aria-label="Which list">
          <button role="tab" data-list="mine" class="${!onGroup ? "on" : ""}" aria-selected="${!onGroup}"><span class="lt-t">👤 My list</span><span class="lt-s">Just you · ${listStat([...myItems, ...myGroupJobs])} packed</span></button>
          <button role="tab" data-list="group" class="${onGroup ? "on" : ""}" aria-selected="${onGroup}"><span class="lt-t">👥 Group list</span><span class="lt-s">Everyone · ${listStat(groupItems)} packed</span></button>
        </div>
        <p class="hint listhint">${onGroup ? "Shared stuff for the whole trip. Tap someone's name on an item to say who's bringing it." : "Only you can see this list. Add your own clothes and gear here, even if a friend is bringing the same thing."}</p>
        ${onGroup ? `<div class="seg wide" role="group" aria-label="Whose items" style="margin-bottom:12px">${[["all", "All"], ["mine", "Yours"], ["open", "Unclaimed"]].map(([k, l]) =>
          `<button class="${view.who === k ? "on" : ""}" data-who="${k}">${l} <small>${groupItems.filter((i) => k === "all" || (k === "mine" ? i.assigned_to === me_ : !i.assigned_to)).length}</small></button>`).join("")}</div>` : ""}` : ""}
      <div class="filters" role="group" aria-label="Show">
        ${[["all", "All"], ...KINDS].map(([k, label]) => `<button class="${view.kind === k ? "on" : ""}" data-kind="${k}">${label} <small>${kindCount(k)}</small></button>`).join("")}
      </div>
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Work or personal">${[["all", "Both"], ["personal", "Personal"], ["work", "Work"]].map(([k, l]) => `<button class="${view.purpose === k ? "on" : ""}" data-purpose="${k}">${l}</button>`).join("")}</div>
        <div class="seg" role="group" aria-label="Group by"><button class="${!byBag && !byPerson ? "on" : ""}" data-group="category">Category</button><button class="${byBag ? "on" : ""}" data-group="bag">Bag</button>${onGroup ? `<button class="${byPerson ? "on" : ""}" data-group="person">Person</button>` : ""}</div>
      </div>
      <div class="toolbar">
        <button class="pill ${view.hide ? "on" : ""}" id="hideBtn">Hide packed</button>
        <button class="pill laundry-f ${view.laundry ? "on" : ""}" id="laundryBtn" aria-pressed="${view.laundry}">${ICON.laundry}Laundry <small>${laundryN}</small></button><span class="spacer"></span>
        <button class="pill ${view.select ? "on" : ""}" id="selBtn">${view.select ? "Done" : "Select"}</button>
      </div>
      ${view.laundry ? `<p class="hint laundry-hint">${ICON.laundry}<span>Showing your laundry list: things to wash${trip.end_date && trip.end_date < today() ? "" : " before you go"}. Tap the basket on an item to take it off.</span></p>` : ""}
      ${byBag && !trip.bags.length ? `<button class="card hintcard" id="addBagHint">No bags on this trip yet. <strong>Add bags →</strong></button>` : ""}
      ${view.purpose === "work" && !hasWork ? `<p class="hint" style="margin:0 4px 14px">Nothing is marked as work yet. Tap Select, choose items, then “Work / Personal”.</p>` : ""}
      ${sugg.length && !view.laundry ? `<div class="sugg"><p>You might also want:</p><div class="chips">${sugg.map((s, i) => `<button class="chip dash" data-sug="${i}"><span>+ ${esc(s.name)}</span>${s.why ? `<small>${esc(s.why)}</small>` : ""}</button>`).join("")}</div></div>` : ""}
      <div id="groups" class="${view.select ? "selecting" : ""}">${names.map((g) => `<section class="card cat${g === LAST ? " lastcat" : ""}"><h2>${esc(groupLabel(g))} ${!byBag && g === "Unsorted" && navigator.onLine ? `<button class="pill sortnow" id="sortNow">Sort these</button>` : ""}<span>${counts(g)}</span></h2>${g === LAST ? `<p class="lasthint">Things you'll use until you walk out the door.</p>` : ""}
        ${groups.get(g).map((i) => `<div class="item${i.packed ? " on" : ""}${view.picked.has(i.id) ? " picked" : ""}" data-id="${i.id}">
          ${view.select
            ? `<button class="tick" data-pick="${i.id}" role="checkbox" aria-checked="${view.picked.has(i.id)}" aria-label="Select ${esc(i.name)}"><span class="box round">${ICON.check}</span></button>`
            : `<button class="tick" data-tick="${i.id}" role="checkbox" aria-checked="${i.packed}" aria-label="${esc(i.name)}"><span class="box">${ICON.check}</span></button>`}
          <button class="body" data-${view.select ? "pick" : "edit"}="${i.id}"><span class="grow"><span class="nm">${esc(i.name)}</span>${i.note ? `<span class="note">${esc(i.note)}</span>` : ""}</span>
            ${i.qty ? `<span class="qty">${esc(i.qty)}</span>` : ""}
            ${purposeOf(i) === "work" && view.purpose !== "work" ? `<span class="worktag">Work</span>` : ""}
            ${byBag ? `<span class="cattag">${esc(i.category)}</span>` : ""}
            ${byBag && i.pack_last ? `<span class="lasttag">Last</span>` : ""}
            ${onGroup && i.assigned_to && !byPerson ? avatar(profileOf(i.assigned_to), "by who") : shared && i.packed && i.packed_by && i.packed_by !== session.user.id ? avatar(profileOf(i.packed_by), "by") : ""}
          </button>
          ${!view.select ? `<button class="wash${i.laundry ? " on" : ""}" data-wash="${i.id}" aria-pressed="${!!i.laundry}" aria-label="${i.laundry ? "Take " + esc(i.name) + " off the laundry list" : "Add " + esc(i.name) + " to the laundry list"}" title="${i.laundry ? "On the laundry list" : "Add to laundry"}">${ICON.laundry}</button>` : ""}
          ${!byBag && !view.select ? `<button class="bagtag${i.bag ? "" : " empty"}" data-bag="${i.id}" aria-label="Bag for ${esc(i.name)}">${i.bag ? esc(i.bag) : "+ Bag"}</button>` : ""}
        </div>`).join("")}</section>`).join("") ||
        `<div class="empty"><strong>${view.laundry && !shown.length ? "Laundry's done 🎉" : n && !shown.length ? "Nothing matches" : n ? "All packed 🎉" : "Nothing here yet"}</strong>${view.laundry && !shown.length ? "Nothing left on the laundry list here. Turn off “Hide packed” or try another filter." : n && !shown.length ? "Try a different filter." : n ? "Turn off “Hide packed” to see everything." : "Type or paste items below and Pack will sort them."}</div>`}</div>
    </main>
    ${view.select
      ? `<div class="add selbar"><div class="selrow"><span class="muted" style="font-size:14px">${view.picked.size ? `${view.picked.size} selected` : "Tap items to select"}</span>
          <button class="pill" id="selAll">${view.picked.size === shown.length && shown.length ? "None" : "All"}</button></div>
        <div class="selgrid">
          ${[["bag", "Move to bag"], ...(onGroup ? [["who", "Assign"]] : []), ...(shared ? [["list", onGroup ? "To my list" : "To group list"]] : []), ["last", "Pack last"], ["laundry", "Laundry"], ["kind", "Type"], ["purpose", "Work / Personal"], ["inv", "To inventory"]]
            .map(([a, l]) => `<button class="selact${a === "inv" ? " alt" : ""}" data-act="${a}" ${view.picked.size ? "" : "disabled"}>${l}</button>`).join("")}
        </div></div>`
      : `<div class="add"><form id="addForm"><input class="t" id="addInput" placeholder="${shared ? (onGroup ? "Add to the group list…" : "Add to my list…") : "Add items… (any format)"}" autocomplete="off" enterkeyhint="send"><button type="submit" id="addBtn">Add</button></form></div>`}`;
    window.scrollTo(0, scrollY);

    $$("[data-group]").forEach((b) => b.addEventListener("click", () => { view.group = b.dataset.group; store.set("group", view.group); drawTrip(); }));
    $$("[data-wx]").forEach((b) => b.addEventListener("click", () => { wxOpen[b.dataset.wx] = !wxOpen[b.dataset.wx]; drawTrip(); }));
    $$("[data-kind]").forEach((b) => b.addEventListener("click", () => { view.kind = b.dataset.kind; drawTrip(); }));
    $$("[data-purpose]").forEach((b) => b.addEventListener("click", () => { view.purpose = b.dataset.purpose; store.set("purpose", view.purpose); drawTrip(); }));
    $$("[data-who]").forEach((b) => b.addEventListener("click", () => { view.who = b.dataset.who; store.set("who", view.who); drawTrip(); }));
    $$("[data-list]").forEach((b) => b.addEventListener("click", () => { view.list = b.dataset.list; store.set("list", view.list); view.picked.clear(); if (view.group === "person" && view.list !== "group") view.group = "category"; drawTrip(); }));
    $("#hideBtn").addEventListener("click", () => { view.hide = !view.hide; drawTrip(); });
    $("#laundryBtn").addEventListener("click", () => {
      if (!view.laundry && !items.some((i) => i.laundry)) return toast("Nothing on the laundry list yet. Tap the basket on an item to add it.");
      view.laundry = !view.laundry; drawTrip();
    });
    $("#sortNow")?.addEventListener("click", (e) => { busy(e.currentTarget, true); sortUnsorted(); });
    $("#selBtn").addEventListener("click", () => { view.select = !view.select; view.picked.clear(); drawTrip(); });
    $("#addBagHint")?.addEventListener("click", () => newBag().then((b) => b && drawTrip()));
    $("#selAll")?.addEventListener("click", () => {
      if (view.picked.size === shown.length) view.picked.clear(); else shown.forEach((i) => view.picked.add(i.id));
      drawTrip();
    });
    $$(".selact").forEach((b) => b.addEventListener("click", () => {
      const ids = [...view.picked];
      if (b.dataset.act === "bag") pickBag(ids);
      if (b.dataset.act === "kind") pickKind(ids);
      if (b.dataset.act === "purpose") pickPurpose(ids);
      if (b.dataset.act === "who") pickPerson(ids);
      if (b.dataset.act === "list") moveToList(ids, onGroup ? me_ : null);
      if (b.dataset.act === "last") { const allLast = ids.every((id) => T.items.find((i) => i.id === id)?.pack_last); patchItems(ids, { pack_last: !allLast }, allLast ? "taken out of Pack last" : "moved to Pack last"); }
      if (b.dataset.act === "laundry") { const allL = ids.every((id) => T.items.find((i) => i.id === id)?.laundry); patchItems(ids, { laundry: !allL }, allL ? "taken off the laundry list" : "added to the laundry list"); }
      if (b.dataset.act === "inv") { const list = T.items.filter((i) => view.picked.has(i.id)); view.picked.clear(); view.select = false; drawTrip(); addToInventory(list); }
    }));
    $("#shareBtn").addEventListener("click", shareTrip);
    $("#moreBtn").addEventListener("click", () => tripMenu(ownerId === session.user.id));
    $("#groups").addEventListener("click", async (e) => {
      const pk = e.target.closest("[data-pick]");
      if (pk) { const id = pk.dataset.pick; view.picked.has(id) ? view.picked.delete(id) : view.picked.add(id); drawTrip(); return; }
      const w = e.target.closest("[data-wash]");
      if (w) {
        const it = T.items.find((x) => x.id === w.dataset.wash); if (!it) return;
        it.laundry = !it.laundry; drawTrip(); cacheTrip();
        if (!view.laundry) toast(it.laundry ? `${it.name} added to laundry` : `${it.name} taken off laundry`, 1800);
        try { await write({ type: "update", table: "items", ids: [it.id], patch: { laundry: it.laundry } }); }
        catch (err) { it.laundry = !it.laundry; cacheTrip(); drawTrip(); fail(err); }
        return;
      }
      const bg = e.target.closest("[data-bag]");
      if (bg) return pickBag([bg.dataset.bag]);
      const t = e.target.closest("[data-tick]");
      if (t) {
        const it = T.items.find((x) => x.id === t.dataset.tick); if (!it) return;
        it.packed = !it.packed; it.packed_by = it.packed ? session.user.id : null;
        if (navigator.vibrate) navigator.vibrate(8);
        drawTrip();
        cacheTrip();
        try { await write({ type: "update", table: "items", ids: [it.id], patch: { packed: it.packed, packed_by: it.packed_by } }); }
        catch (err) { it.packed = !it.packed; cacheTrip(); drawTrip(); fail(err); }
        return;
      }
      const ed = e.target.closest("[data-edit]");
      if (ed) editItem(T.items.find((x) => x.id === ed.dataset.edit));
    });
    $(".sugg")?.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-sug]"); if (!b) return;
      const s = sugg[+b.dataset.sug];
      trip.suggestions = sugg.filter((_, i) => i !== +b.dataset.sug); drawTrip();
      await addText(s.name);
    });
    $("#addForm")?.addEventListener("submit", async (e) => {
      e.preventDefault(); const v = $("#addInput").value.trim(); if (!v) return;
      if (await addText(v)) $("#addInput").value = "";
    });
    attachInventorySuggest($("#addInput"), {
      above: true,
      exclude: () => new Set(T.items.filter((i) => inList(i, targetList())).map((i) => key(i.name))),
      onPick: (inv, { only }) => { if (!only) return; $("#addInput").value = ""; addFromInventory(inv); return "handled"; },
    });
  }

  // Change several items at once (bag, type, work/personal)
  async function patchItems(ids, patch, label) {
    const set = new Set(ids);
    const before = T.items.filter((i) => set.has(i.id)).map((i) => ({ ...i }));
    T.items.forEach((i) => { if (set.has(i.id)) Object.assign(i, patch); });
    view.picked.clear(); view.select = false; drawTrip();
    cacheTrip();
    try { await write({ type: "update", table: "items", ids, patch }); }
    catch (err) { before.forEach((b) => Object.assign(T.items.find((i) => i.id === b.id) || {}, b)); cacheTrip(); drawTrip(); return fail(err); }
    if (ids.length > 1) toast(`${ids.length} items ${label}`);
  }
  async function newBag() {
    if (T.trip.bags.length >= 12) { toast("A trip can have up to 12 bags."); return null; }
    const name = (prompt("Name the bag", BAG_PRESETS.find((b) => !T.trip.bags.some((x) => key(x) === key(b))) || "") || "").trim().slice(0, 40);
    if (!name) return null;
    if (T.trip.bags.some((b) => key(b) === key(name))) return T.trip.bags.find((b) => key(b) === key(name));
    const bags = [...T.trip.bags, name];
    const { error } = await sb.from("trips").update({ bags }).eq("id", T.trip.id);
    if (error) { fail(error); return null; }
    T.trip.bags = bags; return name;
  }
  function choice(title, options, current, onPick) {
    openSheet(`<h2>${esc(title)}</h2><div class="menu">${options.map(([v, l], n) =>
      `<button data-v="${n}"${v === current ? ' class="cur"' : ""}>${esc(l)}${v === current ? " ✓" : ""}</button>`).join("")}
      <hr><button data-v="x" style="font-weight:650">Cancel</button></div>`, (e) => {
      const b = e.target.closest("[data-v]"); if (!b) return;
      closeSheet(); if (b.dataset.v !== "x") onPick(options[+b.dataset.v][0]);
    });
  }
  function pickBag(ids) {
    const one = ids.length === 1 ? T.items.find((i) => i.id === ids[0]) : null;
    choice(one ? `Bag for ${one.name}` : `Move ${ids.length} items to…`,
      [...T.trip.bags.map((b) => [b, b]), ["", "No bag"], ["__new", "+ New bag…"]], one ? bagOf(one) : null, async (v) => {
        if (v === "__new") { v = await newBag(); if (v == null) return drawTrip(); }
        patchItems(ids, { bag: v }, v ? `moved to ${v}` : "taken out of bags");
      });
  }
  function moveToList(ids, owner) {
    // Group items assigned to you show in your list too; only move what actually changes lists.
    const move = ids.filter((id) => { const i = T.items.find((x) => x.id === id); return i && (i.personal_of || null) !== owner; });
    if (!move.length) { view.picked.clear(); view.select = false; drawTrip(); return toast(owner ? "Already in your list" : "Already in the group list"); }
    patchItems(move, owner ? { personal_of: owner, assigned_to: null } : { personal_of: null }, owner ? "moved to your list" : "moved to the group list");
  }
  function pickPerson(ids) {
    const one = ids.length === 1 ? T.items.find((i) => i.id === ids[0]) : null;
    const opts = [[session.user.id, "Me"], ...T.members.filter((m) => m.user_id !== session.user.id).map((m) => [m.user_id, nameOf(m.user_id)]), ["", "Anyone"]];
    choice(one ? `Who's bringing ${one.name}?` : `Who's bringing these ${ids.length}?`, opts, one ? (one.assigned_to || "") : null,
      (v) => patchItems(ids, { assigned_to: v || null }, v ? `assigned to ${v === session.user.id ? "you" : nameOf(v)}` : "open to anyone"));
  }
  function pickKind(ids) {
    const one = ids.length === 1 ? T.items.find((i) => i.id === ids[0]) : null;
    choice(`Type for ${one ? one.name : ids.length + " items"}`, KINDS, one ? kindOf(one) : null, (v) => patchItems(ids, { kind: v }, `set to ${v}`));
  }
  function pickPurpose(ids) {
    const one = ids.length === 1 ? T.items.find((i) => i.id === ids[0]) : null;
    choice(`${one ? one.name : ids.length + " items"}: work or personal?`, [["personal", "Personal"], ["work", "Work"]], one ? purposeOf(one) : null, (v) => patchItems(ids, { purpose: v }, `marked ${v}`));
  }

  // ───────────────────────── inventory suggestions while typing ─────────────────────────
  let invCache = null;
  async function inventoryList() {
    if (invCache) return invCache;
    try {
      invCache = must(await sb.from("closet_items").select("name,qty,note,category,kind,purpose").eq("owner_id", session.user.id).order("name"));
      store.set("inv", invCache);
    } catch { invCache = store.get("inv", []); }
    return invCache;
  }
  // Rank inventory items that contain what's being typed: start of name, then start of a word, then anywhere.
  function matchInventory(q, list, exclude) {
    q = key(q); if (!q) return [];
    const out = [];
    for (const it of list) {
      const n = key(it.name); if (exclude.has(n)) continue;
      const at = n.indexOf(q); if (at < 0) continue;
      out.push({ it, at, rank: at === 0 ? 0 : /[\s\-/(]/.test(n[at - 1]) ? 1 : 2 });
    }
    return out.sort((a, b) => a.rank - b.rank || a.it.name.length - b.it.name.length || a.it.name.localeCompare(b.it.name)).slice(0, 6);
  }
  // Attach a suggestion list to an input or textarea. It suggests for the item being typed (the text after the
  // last comma or new line). onPick(item, { only }) decides what happens; "only" is true when the field holds just that item.
  function attachInventorySuggest(field, { above = false, exclude = () => new Set(), onPick }) {
    if (!field || field.dataset.sugg) return; field.dataset.sugg = "1";
    const wrap = document.createElement("div"); wrap.className = "isug-wrap" + (field.tagName === "TEXTAREA" ? " block" : "");
    field.parentNode.insertBefore(wrap, field); wrap.append(field);
    const box = document.createElement("div"); box.className = "isug" + (above ? " above" : ""); box.setAttribute("role", "listbox"); box.hidden = true;
    (above && field.closest("form") || wrap).append(box);
    field.setAttribute("aria-autocomplete", "list");
    let hits = [], sel = -1, list = [];
    inventoryList().then((l) => { list = l; });
    const span = () => {
      const end = field.selectionStart ?? field.value.length, before = field.value.slice(0, end);
      const start = Math.max(before.lastIndexOf(","), before.lastIndexOf("\n")) + 1;
      let stop = field.value.slice(end).search(/[,\n]/); stop = stop < 0 ? field.value.length : end + stop;
      return { start, stop, text: field.value.slice(start, stop) };
    };
    const hide = () => { box.hidden = true; sel = -1; field.setAttribute("aria-expanded", "false"); };
    const draw = () => {
      if (!hits.length) return hide();
      box.innerHTML = `<div class="isug-h">From your inventory</div>` + hits.map(({ it, at }, i) => {
        const q = span().text.trim().length;
        const nm = esc(it.name.slice(0, at)) + "<b>" + esc(it.name.slice(at, at + q)) + "</b>" + esc(it.name.slice(at + q));
        const meta = [it.qty, it.category, it.purpose === "work" ? "Work" : ""].filter(Boolean).map(esc).join(" · ");
        return `<button type="button" role="option" class="isug-o${i === sel ? " on" : ""}" data-i="${i}" aria-selected="${i === sel}"><span class="isug-n">${nm}</span>${meta ? `<span class="isug-m">${meta}</span>` : ""}</button>`;
      }).join("");
      box.hidden = false; field.setAttribute("aria-expanded", "true");
    };
    const update = () => { const t = span().text.trim(); hits = t ? matchInventory(t, list, exclude()) : []; sel = -1; draw(); };
    const pick = (i) => {
      const h = hits[i]; if (!h) return;
      const sp = span(), only = !field.value.slice(0, sp.start).trim() && !field.value.slice(sp.stop).trim();
      hide();
      if (onPick(h.it, { only }) === "handled") return;
      const label = h.it.qty ? `${h.it.name} (${h.it.qty})` : h.it.name;
      const pre = field.value.slice(0, sp.start), lead = sp.start && !/\s$/.test(pre) ? " " : "";
      const rest = field.value.slice(sp.stop).replace(/^[,\s]*/, "");
      field.value = pre + lead + label + ", " + rest;
      const caret = (pre + lead + label + ", ").length; field.focus(); field.setSelectionRange(caret, caret);
    };
    field.addEventListener("input", () => { if (!list.length) inventoryList().then((l) => { list = l; update(); }); else update(); });
    field.addEventListener("keydown", (e) => {
      if (box.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length; draw(); }
      else if (e.key === "Enter" && sel >= 0) { e.preventDefault(); e.stopPropagation(); pick(sel); }
      else if (e.key === "Tab" && hits.length) { e.preventDefault(); pick(sel >= 0 ? sel : 0); }
      else if (e.key === "Escape") hide();
    });
    field.addEventListener("blur", () => setTimeout(hide, 150));
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => { const o = e.target.closest("[data-i]"); if (o) pick(+o.dataset.i); });
  }

  // Add an inventory item straight to the open trip: no smart sort needed, it already has a category and type.
  async function addFromInventory(inv) {
    const owner = targetList();
    if (T.items.some((i) => inList(i, owner) && key(i.name) === key(inv.name))) return toast(`${inv.name} is already on this list`);
    const same = T.items.filter((i) => inList(i, owner) && i.category === inv.category && i.bag);
    const counts = {}; for (const i of same) counts[i.bag] = (counts[i.bag] || 0) + 1;
    const bag = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "";
    const row = { id: newId(), trip_id: T.trip.id, personal_of: owner, name: inv.name, qty: inv.qty || "", note: inv.note || "", category: inv.category || "Other",
      bag, kind: inv.kind || "gear", purpose: inv.purpose || "personal", packed: false, position: T.items.length };
    T.items.push({ ...row, packed_by: null, created_at: new Date().toISOString() }); cacheTrip(); drawTrip();
    toast(`Added ${inv.name} from your inventory`);
    try { await write({ type: "insert", table: "items", rows: [row] }); } catch (e) { fail(e); }
  }

  async function addText(text) {
    const btn = $("#addBtn"); busy(btn, true);
    try {
      if (!navigator.onLine || outbox.length) {
        await addUnsorted(T.trip, text, targetList());
        if (!navigator.onLine) toast("Added — Pack will sort them when you're back online.");
        else flush();
        drawTrip(); return true;
      }
      await sortInto(T.trip, text, T.items, null, new Set(), targetList());
      const f = await fetchTrip(T.trip.id).catch(() => null); if (f) { T = f; cacheTrip(); }
      drawTrip(); return true;
    } catch (e) { busy(btn, false); fail(e); return false; }
  }

  // Sort the items that were added offline (or when sorting was unavailable)
  async function sortUnsorted() {
    const owner = targetList();
    const loose = T.items.filter((i) => i.category === "Unsorted" && inList(i, owner));
    if (!loose.length || !navigator.onLine) return;
    await flush();
    const keep = T.items.filter((i) => i.category !== "Unsorted" && inList(i, owner));
    let res;
    try {
      res = await api("/api/sort", {
        items: loose.map((i) => (i.qty ? `${i.name} (${i.qty})` : i.name)).join("\n"), mode: "trip",
        trip: { name: T.trip.name, destination: T.trip.destination, start: T.trip.start_date, end: T.trip.end_date, details: T.trip.details, bags: T.trip.bags, weather: T.trip.weather?.summary || "" },
        categories: [...new Set(keep.map((i) => i.category))], have: keep.map((i) => i.name),
      });
    } catch (e) { return fail(e); }
    // Match sorted results back to the loose items by name; keep their packed state.
    const byName = new Map(res.items.map((r) => [key(r.name), r]));
    for (const it of loose) {
      const r = byName.get(key(it.name)) || res.items.find((x) => key(it.name).includes(key(x.name)) || key(x.name).includes(key(it.name)));
      if (!r) continue;
      const patch = { name: r.name, qty: r.qty || it.qty, category: r.category || "Other", bag: r.bag || it.bag, kind: r.kind || it.kind, purpose: r.purpose || it.purpose, pack_last: !!r.last || !!it.pack_last };
      Object.assign(it, patch);
      await write({ type: "update", table: "items", ids: [it.id], patch }).catch(() => {});
    }
    cacheTrip(); drawTrip(); toast("Sorted");
  }

  function editItem(it) {
    if (!it) return;
    const cats = [...new Set(T.items.map((i) => i.category))];
    openSheet(`<h2>Edit item</h2><form id="ef">
      <label class="check-row always-row"><input type="checkbox" id="ealw"${isAlways(it) ? " checked" : ""}><span class="grow"><strong>Always bring</strong><br><small class="muted" id="ealwnote">${isAlways(it) ? "Added to every new trip you make." : "Add it to every new trip you make."}</small></span></label>
      <label class="f" for="en">Item</label><input class="t" id="en" value="${esc(it.name)}" required maxlength="200">
      <div class="row2"><div><label class="f" for="eq">Qty</label><input class="t" id="eq" value="${esc(it.qty)}" maxlength="40"></div>
      <div><label class="f" for="ec">Category</label><input class="t" id="ec" value="${esc(it.category)}" list="cats" maxlength="40"><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div></div>
      <label class="f">Type</label><div class="seg wide" id="ek">${KINDS.map(([k, l]) => `<button type="button" data-k="${k}" class="${kindOf(it) === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <label class="f">For</label><div class="seg wide" id="ep">${[["personal", "Personal"], ["work", "Work"]].map(([k, l]) => `<button type="button" data-k="${k}" class="${purposeOf(it) === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${T.members.length > 1 ? `<label class="f">List</label><div class="seg wide" id="elist">${[["mine", "👤 My list"], ["group", "👥 Group list"]].map(([k, l]) => `<button type="button" data-k="${k}" class="${(it.personal_of ? "mine" : "group") === k ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
      ${T.members.length > 1 ? `<div id="ewrap"${it.personal_of ? ' class="hidden"' : ""}><label class="f" for="ew">Who's bringing it</label><select class="t" id="ew"><option value="">Anyone</option>${T.members.map((m) => `<option value="${m.user_id}"${m.user_id === it.assigned_to ? " selected" : ""}>${esc(m.user_id === session.user.id ? "Me" : nameOf(m.user_id))}</option>`).join("")}</select></div>` : ""}
      <label class="check-row"><input type="checkbox" id="el"${it.pack_last ? " checked" : ""}><span class="grow">Pack last <small class="muted">(you'll use it until you leave)</small></span></label>
      <label class="check-row"><input type="checkbox" id="elau"${it.laundry ? " checked" : ""}><span class="grow">On the laundry list <small class="muted">(needs washing)</small></span></label>
      <label class="f" for="eb">Bag</label><select class="t" id="eb"><option value="">No bag</option>${T.trip.bags.map((b) => `<option${key(b) === key(it.bag) ? " selected" : ""}>${esc(b)}</option>`).join("")}<option value="__new">+ New bag…</option></select>
      <label class="f" for="eo">Note</label><input class="t" id="eo" value="${esc(it.note)}" maxlength="200">
      <button class="primary" type="submit">Save</button>
      ${inInventory(it) ? `<p class="hint inv-state" style="text-align:center;margin-top:12px">✓ In your inventory</p>` : `<button class="secondary" type="button" id="toCloset">Add to inventory</button>`}
      <button class="danger-btn" type="button" id="del">Remove from list</button></form>`);
    $("#ealw").addEventListener("change", async (e) => {
      const on = e.target.checked, cb = e.target; cb.disabled = true;
      if (!navigator.onLine) { cb.checked = !on; cb.disabled = false; return toast("Connect to the internet to change this."); }
      try {
        const wasInInv = inInventory(it);
        await setAlways(it, on);
        $("#ealwnote") && ($("#ealwnote").textContent = on ? "Added to every new trip you make." : "Add it to every new trip you make.");
        if (on && !wasInInv) { const h = $("#ef .hint.inv-state"); const b = $("#toCloset"); if (b) b.outerHTML = `<p class="hint inv-state" style="text-align:center;margin-top:12px">✓ In your inventory</p>`; }
        toast(on ? `${it.name} will come on every new trip${wasInInv ? "" : " (added to your inventory)"}` : `${it.name} won't be added to new trips`);
      } catch (err) { cb.checked = !on; fail(err); }
      finally { cb.disabled = false; }
    });
    for (const id of ["#ek", "#ep", "#elist"]) $(id)?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]"); if (!b) return;
      $$("button", $(id)).forEach((x) => x.classList.toggle("on", x === b));
      if (id === "#elist") $("#ewrap")?.classList.toggle("hidden", b.dataset.k === "mine");
    });
    $("#eb").addEventListener("change", async (e) => {
      if (e.target.value !== "__new") return;
      const name = await newBag();
      if (name) { const o = document.createElement("option"); o.textContent = name; e.target.insertBefore(o, e.target.lastElementChild); e.target.value = name; }
      else e.target.value = it.bag || "";
    });
    $("#ef").addEventListener("submit", async (e) => {
      e.preventDefault();
      const patch = { name: $("#en").value.trim(), qty: $("#eq").value.trim(), category: $("#ec").value.trim() || "Other", note: $("#eo").value.trim(),
        bag: $("#eb").value === "__new" ? it.bag : $("#eb").value, kind: $("#ek .on")?.dataset.k || kindOf(it), purpose: $("#ep .on")?.dataset.k || purposeOf(it),
        pack_last: $("#el").checked, laundry: $("#elau").checked,
        ...($("#elist") ? ($("#elist .on")?.dataset.k === "mine" ? { personal_of: session.user.id, assigned_to: null } : { personal_of: null, assigned_to: $("#ew")?.value || null }) : {}) };
      closeSheet(); Object.assign(it, patch); cacheTrip(); drawTrip();
      write({ type: "update", table: "items", ids: [it.id], patch }).catch(fail);
    });
    $("#del").addEventListener("click", async () => {
      closeSheet(); T.items = T.items.filter((x) => x !== it); cacheTrip(); drawTrip();
      write({ type: "delete", table: "items", ids: [it.id] }).catch(fail);
    });
    $("#toCloset")?.addEventListener("click", async () => { closeSheet(); await addToInventory([it]); });
  }

  async function shareTrip() {
    const isOwner = T.trip.owner_id === session.user.id;
    openSheet(`<h2>Pack together</h2><p class="muted" style="margin:4px 0 14px">Anyone with this link can join after signing in. It works for 14 days.</p>
      <div id="link"><button class="primary" id="mk" style="margin-top:0">Create invite link</button></div>
      <h3 class="sec">On this trip</h3>
      <div class="card">${T.members.map((m) => { const pr = profileOf(m.user_id); return `<div class="row">${avatar(pr)}<span class="nm">${esc(pr.display_name || pr.email)}${m.user_id === session.user.id ? " (you)" : ""}<span class="note">${m.role === "owner" ? "Owner" : esc(pr.email || "")}</span></span>
        ${isOwner && m.user_id !== session.user.id ? `<button class="del" data-rm="${m.user_id}">Remove</button>` : ""}</div>`; }).join("")}</div>`);
    $("#mk").addEventListener("click", async () => {
      const btn = $("#mk"); busy(btn, true, "Creating…");
      try {
        const inv = must(await sb.from("trip_invites").insert({ trip_id: T.trip.id, created_by: session.user.id }).select("token").single());
        const url = `${location.origin}/#/join/${inv.token}`;
        if (navigator.share) {
          try { await navigator.share({ title: `Pack: ${T.trip.name}`, text: `Help me pack for ${T.trip.name}`, url }); closeSheet(); return; } catch {}
        }
        $("#link").innerHTML = `<div class="copy-box"><input class="t" readonly value="${esc(url)}" aria-label="Invite link"><button class="pill" id="cp">Copy</button></div>`;
        $("#cp").addEventListener("click", async () => { try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { $(".copy-box input").select(); } });
      } catch (e) { busy(btn, false); fail(e); }
    });
    $$("[data-rm]", sheetBody).forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Remove this person from the trip?")) return;
      const { error } = await sb.from("trip_members").delete().eq("trip_id", T.trip.id).eq("user_id", b.dataset.rm);
      if (error) return fail(error);
      T.members = T.members.filter((m) => m.user_id !== b.dataset.rm); closeSheet(); redrawTrip(); toast("Removed");
    }));
  }

  function tripMenu(isOwner) {
    openSheet(`<div class="menu">
      <button data-a="edit">Edit trip details & bags</button>
      <button data-a="weather">Refresh weather</button>
      <button data-a="template">Save as a template</button>
      <button data-a="copy">Copy as text</button>
      <button data-a="reset">Unpack everything</button>
      <hr>
      ${isOwner ? '<button data-a="delete" class="danger">Delete trip</button>' : '<button data-a="leave" class="danger">Leave this trip</button>'}
      <button data-a="close" style="font-weight:650">Cancel</button></div>`, async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
      closeSheet();
      const id = T.trip.id;
      try {
        if (a === "edit") go(`#/trip/${id}/edit`);
        if (a === "weather") {
          if (!T.trip.destination) return go(`#/trip/${id}/edit`);
          toast("Checking the weather…"); await getWeather(T.trip); redrawTrip();
        }
        if (a === "template") {
          const name = prompt("Template name", T.trip.name.replace(/\b(19|20)\d\d\b/g, "").trim() || T.trip.name);
          if (!name) return;
          must(await sb.from("templates").insert({ owner_id: session.user.id, name: name.trim().slice(0, 120), bags: T.trip.bags,
            items: T.items.map((i) => ({ name: i.name, qty: i.qty, category: i.category, bag: i.bag, kind: kindOf(i), purpose: purposeOf(i) })) }));
          toast("Saved to Templates");
        }
        if (a === "copy") {
          const groups = {};
          for (const i of T.items) (groups[i.category] ||= []).push(i);
          const txt = `${T.trip.name}\n\n` + Object.entries(groups).map(([c, its]) => c.toUpperCase() + "\n" + its.map((i) => `${i.packed ? "☑" : "☐"} ${i.name}${i.qty ? ` (${i.qty})` : ""}${i.bag ? ` — ${i.bag}` : ""}`).join("\n")).join("\n\n");
          try { await navigator.clipboard.writeText(txt); toast("Copied"); } catch { toast("Couldn't copy on this device"); }
        }
        if (a === "reset" && confirm("Uncheck every item?")) {
          T.items.forEach((i) => { i.packed = false; i.packed_by = null; }); cacheTrip(); redrawTrip();
          await write({ type: "update", table: "items", eq: { trip_id: id }, patch: { packed: false, packed_by: null } });
        }
        if (a === "delete" && confirm(`Delete “${T.trip.name}” for everyone on it?`)) {
          must(await sb.from("trips").delete().eq("id", id)); store.set("trip." + id, null); toast("Trip deleted"); go("#/");
        }
        if (a === "leave" && confirm(`Leave “${T.trip.name}”?`)) {
          must(await sb.from("trip_members").delete().eq("trip_id", id).eq("user_id", session.user.id)); store.set("trip." + id, null); go("#/");
        }
      } catch (err) { fail(err); }
    });
  }

  // ───────────────────────── trip overview (dashboard) ─────────────────────────
  let FL = null; // { tripId, flights: [...] }
  async function fetchFlights(id) {
    const { data, error } = await sb.from("trip_flights").select("*").eq("trip_id", id).order("flight_date").order("dep_time");
    if (error) { if (/trip_flights|schema cache|does not exist/i.test(error.message)) return { tripId: id, flights: [], unavailable: true }; throw new Error(error.message); }
    return { tripId: id, flights: data || [] };
  }
  const redrawTrip = () => {
    const h = location.hash;
    if (h.endsWith("/pack")) drawTrip(); else if (h.endsWith("/expenses")) { if (EX) drawExpenses(); } else if (T && h === `#/trip/${T.trip.id}`) drawOverview();
  };
  // Where the trip stands today: countdown, day x of y, or over.
  function tripStatus(trip) {
    const t0 = today(), s = trip.start_date, e = trip.end_date || trip.start_date;
    const days = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
    if (!s) return { big: "No dates yet", small: "Add dates for a countdown and the forecast", tone: "" };
    if (t0 < s) { const n = days(t0, s); return { big: n === 1 ? "Tomorrow" : `${n} days`, small: n === 1 ? "You leave tomorrow" : "until you leave", tone: n <= 2 ? "soon" : "" }; }
    if (t0 <= e) { const n = days(s, t0) + 1, of = days(s, e) + 1; return { big: of === 1 ? "Today" : `Day ${n} of ${of}`, small: t0 === e ? (of === 1 ? "Have a great trip" : "Last day. Safe travels home") : "You're on the trip", tone: "now" }; }
    const n = days(e, t0); return { big: "Trip's over", small: n === 1 ? "Ended yesterday" : `Ended ${n} days ago`, tone: "past" };
  }
  const FLIGHT_STATE = (st) => {
    if (!st) return null;
    const s = String(st.state || "").toLowerCase(), late = Math.max(st.dep?.late || 0, 0), arrLate = st.arr?.late || 0;
    if (/cancel/.test(s)) return ["Canceled", "bad"];
    if (/divert/.test(s)) return ["Diverted", "bad"];
    if (/landed|arrived/.test(s)) return [arrLate > 10 ? `Landed ${arrLate} min late` : "Landed", "ok"];
    if (/enroute|departed|approaching/.test(s)) return ["In the air", "air"];
    if (/boarding/.test(s)) return ["Boarding", "air"];
    if (/gateclosed/.test(s)) return ["Gate closed", "air"];
    if (/delay/.test(s) || late > 10) return [late ? `Delayed ${late >= 60 ? Math.floor(late / 60) + "h " + (late % 60) + "m" : late + " min"}` : "Delayed", "warn"];
    if (/checkin/.test(s)) return ["Check-in open", "ok"];
    if (/expected|scheduled/.test(s)) return ["On time", "ok"];
    return null;
  };
  const DIR = { out: "Going", back: "Coming home", other: "Other flights" };
  function flightRow(f) {
    const st = f.status, lab = FLIGHT_STATE(st);
    const dep = (f.dep_airport || st?.dep?.iata || "").toUpperCase(), arr = (f.arr_airport || st?.arr?.iata || "").toUpperCase();
    const hm = (x) => (x ? clock(x) : "");
    const depT = st?.dep?.est && st.dep.est !== st.dep.sched ? st.dep.est.slice(11, 16) : st?.dep?.sched?.slice(11, 16) || f.dep_time;
    const arrT = st?.arr?.est && st.arr.est !== st.arr.sched ? st.arr.est.slice(11, 16) : st?.arr?.sched?.slice(11, 16) || f.arr_time;
    const moved = st?.dep?.est && st?.dep?.sched && st.dep.est !== st.dep.sched;
    const bits = [st?.dep?.terminal && `Terminal ${st.dep.terminal}`, st?.dep?.gate && `Gate ${st.dep.gate}`, st?.arr?.belt && `Bags: belt ${st.arr.belt}`].filter(Boolean);
    const who = f.user_id ? profileOf(f.user_id) : null;
    const num = f.flight_no.replace(/\s+/g, "").toUpperCase();
    return `<div class="flt" data-flight="${f.id}">
      <button class="flt-main" data-edit-flight="${f.id}">
        <div class="flt-top">${who ? avatar(who, "sm") : ""}<strong>${esc(f.flight_no.toUpperCase())}</strong><span class="grow"></span>
          ${lab ? `<span class="flt-pill ${lab[1]}">${esc(lab[0])}</span>` : ""}</div>
        <div class="flt-route"><div><b>${esc(dep || "—")}</b><span>${esc(hm(depT))}${moved ? ` <s>${esc(hm(st.dep.sched.slice(11, 16)))}</s>` : ""}</span></div>
          <div class="flt-line" aria-hidden="true">${ICON.plane}</div>
          <div class="r"><b>${esc(arr || "—")}</b><span>${esc(hm(arrT))}</span></div></div>
        <div class="flt-meta">${st?.airline ? esc(st.airline) + " · " : ""}${esc(fmtDate(f.flight_date, { weekday: "short", month: "short", day: "numeric" }))}${who ? ` · ${esc(who.id === session.user.id ? "You" : who.display_name || who.email || "")}` : ""}${bits.length ? " · " + bits.map(esc).join(" · ") : ""}${f.note ? ` · ${esc(f.note)}` : ""}</div>
      </button>
      <a class="flt-track" href="https://www.flightaware.com/live/flight/${encodeURIComponent(num)}" target="_blank" rel="noopener">Live tracking ↗</a>
    </div>`;
  }

  async function renderOverview(id) {
    if (!T || T.trip.id !== id) T = store.get("trip." + id, null);
    EX = store.get("exp." + id, null); FL = store.get("flights." + id, null);
    if (T) drawOverview(); else app.innerHTML = header({ title: "Trip", back: "#/" }) + `<main><p class="hint"><span class="spin"></span><span>Loading…</span></p></main>`;
    const [fresh, ex, fl] = await Promise.all([fetchTrip(id), fetchExpenses(id).catch(() => EX), fetchFlights(id).catch(() => FL)]);
    if (!fresh) { store.set("trip." + id, null); toast("That trip isn't available."); return go("#/"); }
    T = fresh; cacheTrip(); if (ex) { EX = ex; cacheEx(); } if (fl) { FL = fl; store.set("flights." + id, FL); }
    if (location.hash !== `#/trip/${id}`) return;
    drawOverview();

    const wx0 = T.trip.weather, t0 = today();
    const notOver = !T.trip.end_date || T.trip.end_date >= t0;
    const underway = notOver && (!T.trip.start_date || T.trip.start_date <= t0);
    const maxAge = (underway ? 1 : wx0?.hours?.length ? 2 : 6) * 3600e3;
    const stale = !wx0 || !("lat" in wx0) || (notOver && (Date.now() - new Date(wx0.fetched || 0) > maxAge || (wx0.kind !== "typical" && !("offset" in wx0)) || (underway && wx0.hours?.length && wxNow(wx0).hours.length < 46)));
    if (T.trip.destination && stale) getWeather(T.trip).then(() => { if (location.hash === `#/trip/${id}`) drawOverview(); }).catch(() => {});
    refreshFlights(id);

    let h;
    const again = () => { clearTimeout(h); h = setTimeout(refresh, 300); };
    channel = sb.channel("overview-" + id)
      .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `trip_id=eq.${id}` }, again)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trips", filter: `id=eq.${id}` }, again)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: `trip_id=eq.${id}` }, again)
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_flights", filter: `trip_id=eq.${id}` }, again)
      .subscribe();
    async function refresh() {
      if (location.hash !== `#/trip/${id}`) return;
      const [f, e2, fl2] = await Promise.all([fetchTrip(id).catch(() => null), fetchExpenses(id).catch(() => null), fetchFlights(id).catch(() => null)]);
      if (f) { T = f; cacheTrip(); } if (e2) { EX = e2; cacheEx(); } if (fl2) { FL = fl2; store.set("flights." + id, FL); }
      drawOverview();
    }
  }
  // Ask for live status on flights from yesterday to 3 days out (the server caches, so this is cheap).
  async function refreshFlights(id) {
    if (!cfg.flights || !FL?.flights?.length || !navigator.onLine) return;
    const t0 = today(), lo = new Date(Date.now() - 864e5).toISOString().slice(0, 10), hi = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    let changed = false;
    for (const f of FL.flights.filter((x) => x.flight_date >= lo && x.flight_date <= hi)) {
      try {
        const r = await api("/api/flight-status", { id: f.id });
        if (r.status && JSON.stringify(r.status) !== JSON.stringify(f.status)) { f.status = r.status; Object.assign(f, r.filled || {}); changed = true; }
      } catch {}
    }
    if (changed) { store.set("flights." + id, FL); if (location.hash === `#/trip/${id}`) drawOverview(); }
    void t0;
  }

  function drawOverview() {
    const { trip, items: all } = T, me_ = session.user.id, cur = trip.currency || "USD";
    const shared = T.members.length > 1;
    const st = tripStatus(trip);
    const mine = all.filter((i) => i.personal_of === me_ || (!shared && !i.personal_of) || (!i.personal_of && i.assigned_to === me_));
    const group = all.filter((i) => !i.personal_of);
    const done = (arr) => arr.filter((i) => i.packed).length;
    const lastLeft = mine.filter((i) => i.pack_last && !i.packed).length;
    const laundry = (shared ? mine : all).filter((i) => i.laundry).length;
    const ex = EX?.tripId === trip.id ? EX : null;
    const total = ex ? ex.expenses.reduce((a, e) => a + e.amount_cents, 0) : (T.expensesTotal || 0);
    const pairs = ex ? balances(ex) : [];
    const myNet = pairs.reduce((a, p) => a + (p.to === me_ ? p.cents : p.from === me_ ? -p.cents : 0), 0);
    const flights = FL?.tripId === trip.id ? FL.flights : [];
    const byDir = ["out", "back", "other"].map((d) => [d, flights.filter((f) => f.direction === d)]).filter(([, l]) => l.length);
    const scrollY = window.scrollY;

    app.innerHTML = header({ title: trip.name, back: "#/", more: true, sub: [dateRange(trip.start_date, trip.end_date), trip.destination].filter(Boolean).map(esc).join(" · ") }) + `<main class="ov">
      ${tripTabs("overview")}
      <section class="card ov-hero ${st.tone}">
        <div><div class="ov-big">${esc(st.big)}</div><div class="ov-small">${esc(st.small)}</div></div>
        ${!trip.start_date ? `<a class="pill" href="#/trip/${trip.id}/edit">Add dates</a>` : trip.destination ? `<span class="ov-place">📍 ${esc(trip.destination)}</span>` : ""}
      </section>

      <div class="ov-grid">
        <a class="card ov-tile" href="#/trip/${trip.id}/pack">
          ${ring(done(mine), mine.length)}
          <div class="grow"><div class="ov-k">Packing</div>
            <div class="ov-v">${mine.length ? (done(mine) === mine.length ? "All packed ✓" : `${done(mine)} of ${mine.length} packed`) : "Nothing on your list yet"}</div>
            <div class="ov-s">${[shared ? `Group ${done(group)}/${group.length}` : "", lastLeft ? `⏰ ${lastLeft} to pack last` : "", laundry ? `🧺 ${laundry} in laundry` : ""].filter(Boolean).join(" · ") || "Open your list"}</div></div>
          <span class="ov-go" aria-hidden="true">›</span></a>
        <a class="card ov-tile" href="#/trip/${trip.id}/expenses">
          <div class="ov-ic" aria-hidden="true">💸</div>
          <div class="grow"><div class="ov-k">Expenses</div>
            <div class="ov-v">${total ? esc(money(total, cur)) + " spent" : "No expenses yet"}</div>
            <div class="ov-s ${myNet > 0 ? "plus" : myNet < 0 ? "minus" : ""}">${!shared ? "Log costs as you go" : myNet > 0 ? `You're owed ${esc(money(myNet, cur))}` : myNet < 0 ? `You owe ${esc(money(-myNet, cur))}` : total ? "You're all square ✓" : "Split costs with the group"}</div></div>
          <span class="ov-go" aria-hidden="true">›</span></a>
      </div>

      ${weatherCard(trip)}

      <section class="card ov-sec">
        <div class="ov-head"><h2>✈️ Flights</h2><button class="pill" id="addFlight">+ Add flight</button></div>
        ${FL?.unavailable ? `<p class="hint" style="margin:0">Flights aren't available yet.</p>`
          : flights.length ? byDir.map(([d, l]) => `<div class="flt-dir">${DIR[d]}</div>${l.map(flightRow).join("")}`).join("")
          : `<p class="hint" style="margin:0">Add your flight number and Pack shows times${cfg.flights ? ", gates and live delays" : " and a link to live tracking"} here for everyone on the trip.</p>`}
        ${flights.length && !cfg.flights ? `<p class="hint flt-note">Tap Live tracking for gates and delays.</p>` : ""}
      </section>

      <section class="card ov-sec">
        <div class="ov-head"><h2>👥 ${shared ? `${T.members.length} people` : "Who's going"}</h2><button class="pill" id="ovShare">${shared ? "Invite" : "Invite people"}</button></div>
        <div class="ov-people">${T.members.map((m) => { const p = profileOf(m.user_id); const nf = flights.filter((f) => f.user_id === m.user_id).length;
          return `<div class="ov-person">${avatar(p)}<div class="grow"><div class="nm">${esc(m.user_id === me_ ? "You" : p.display_name || p.email || "Someone")}${m.role === "owner" ? ' <span class="badge">Organizer</span>' : ""}</div>
            <div class="muted">${[nf ? `${nf} flight${nf === 1 ? "" : "s"}` : "", p.venmo ? "Venmo ✓" : ""].filter(Boolean).join(" · ") || (m.user_id === me_ ? "That's you" : "On this trip")}</div></div></div>`; }).join("")}</div>
        ${shared ? "" : `<p class="hint" style="margin:10px 0 0">Share the trip to pack together, split costs and see each other's flights.</p>`}
      </section>

      ${trip.details ? `<section class="card ov-sec"><div class="ov-head"><h2>📝 Notes</h2><a class="pill" href="#/trip/${trip.id}/edit">Edit</a></div><p class="ov-notes">${esc(trip.details)}</p></section>` : ""}
    </main>`;
    window.scrollTo(0, scrollY);
    $$("[data-wx]").forEach((b) => b.addEventListener("click", () => { wxOpen[b.dataset.wx] = !wxOpen[b.dataset.wx]; drawOverview(); }));
    $("#moreBtn").addEventListener("click", () => tripMenu(T.members.find((m) => m.role === "owner")?.user_id === me_));
    $("#ovShare").addEventListener("click", shareTrip);
    $("#addFlight").addEventListener("click", () => FL?.unavailable ? toast("Flights aren't available yet.") : flightSheet(null));
    $$("[data-edit-flight]").forEach((b) => b.addEventListener("click", () => flightSheet(flights.find((f) => f.id === b.dataset.editFlight))));
  }

  function flightSheet(f) {
    const trip = T.trip, me_ = session.user.id;
    const lastBack = FL?.flights?.filter((x) => x.direction === "out").length && !FL.flights.some((x) => x.direction === "back");
    const dir = f?.direction || (lastBack ? "back" : "out");
    const dateFor = (d) => (d === "back" ? trip.end_date : trip.start_date) || today();
    openSheet(`<h2>${f ? "Edit flight" : "Add a flight"}</h2><form id="ff" autocomplete="off">
      <label class="f">Which way</label><div class="seg wide" id="fdir">${Object.entries({ out: "Going", back: "Coming home", other: "Other" }).map(([k, l]) => `<button type="button" data-k="${k}" class="${dir === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="row2"><div><label class="f" for="fno">Flight number</label><input class="t" id="fno" value="${esc(f?.flight_no || "")}" placeholder="AS 1234" required maxlength="12" autocapitalize="characters" spellcheck="false"></div>
        <div><label class="f" for="fdate">Date</label><input class="t" id="fdate" type="date" value="${esc(f?.flight_date || dateFor(dir))}" required></div></div>
      ${T.members.length > 1 ? `<label class="f" for="fwho">Who's flying</label><select class="t" id="fwho">${T.members.map((m) => `<option value="${m.user_id}"${(f ? f.user_id : me_) === m.user_id ? " selected" : ""}>${esc(m.user_id === me_ ? "Me" : nameOf(m.user_id))}</option>`).join("")}</select>` : ""}
      <p class="hint" style="margin:10px 2px 0">${cfg.flights ? "Pack looks up the airports, times, gates and delays. Fill these in only if it can't find your flight." : "Optional, so everyone can see when you land."}</p>
      <div class="row2"><div><label class="f" for="fdep">From</label><input class="t" id="fdep" value="${esc(f?.dep_airport || "")}" placeholder="SEA" maxlength="40" autocapitalize="characters"></div>
        <div><label class="f" for="farr">To</label><input class="t" id="farr" value="${esc(f?.arr_airport || "")}" placeholder="LAX" maxlength="40" autocapitalize="characters"></div></div>
      <div class="row2"><div><label class="f" for="fdt">Departs</label><input class="t" id="fdt" type="time" value="${esc(f?.dep_time || "")}"></div>
        <div><label class="f" for="fat">Arrives</label><input class="t" id="fat" type="time" value="${esc(f?.arr_time || "")}"></div></div>
      <label class="f" for="fnote">Note <small>(optional)</small></label><input class="t" id="fnote" value="${esc(f?.note || "")}" placeholder="Seat 14C, picking up the rental car" maxlength="200">
      <p class="hint" id="ferr" role="alert" style="color:var(--err)"></p>
      <button class="primary" type="submit">${f ? "Save" : "Add flight"}</button>
      ${f ? `<button class="danger-btn" type="button" id="fdel">Remove flight</button>` : ""}</form>`);
    $("#fdir").addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]"); if (!b) return;
      $$("button", $("#fdir")).forEach((x) => x.classList.toggle("on", x === b));
      if (!f && $("#fdate").value === dateFor(b.dataset.k === "back" ? "out" : "back")) $("#fdate").value = dateFor(b.dataset.k);
    });
    $("#ff").addEventListener("submit", async (e) => {
      e.preventDefault();
      const no = $("#fno").value.trim().toUpperCase().replace(/\s+/g, " ");
      if (!/^[A-Z0-9]{2,3}\s?\d{1,5}[A-Z]?$/.test(no)) { $("#ferr").textContent = "Use the airline code and number, like AS 1234."; return; }
      const row = { direction: $("#fdir .on")?.dataset.k || "out", flight_no: no, flight_date: $("#fdate").value,
        user_id: $("#fwho")?.value || me_, dep_airport: $("#fdep").value.trim().toUpperCase(), arr_airport: $("#farr").value.trim().toUpperCase(),
        dep_time: $("#fdt").value || "", arr_time: $("#fat").value || "", note: $("#fnote").value.trim() };
      const b = e.submitter || $("#ff .primary"); busy(b, true, "Saving…");
      try {
        let saved;
        if (f) { must(await sb.from("trip_flights").update(row).eq("id", f.id)); saved = Object.assign(f, row); if (f.flight_no !== no) saved.status = null; }
        else { saved = must(await sb.from("trip_flights").insert({ ...row, trip_id: trip.id, created_by: me_ }).select("*").single()); FL.flights.push(saved); }
        FL.flights.sort((a, b2) => (a.flight_date + a.dep_time).localeCompare(b2.flight_date + b2.dep_time));
        store.set("flights." + trip.id, FL); closeSheet(); drawOverview(); toast(f ? "Flight saved" : "Flight added");
        if (cfg.flights) api("/api/flight-status", { id: saved.id }).then((r) => { if (r.status) { saved.status = r.status; Object.assign(saved, r.filled || {}); store.set("flights." + trip.id, FL); drawOverview(); } else if (r.notFound) toast("Couldn't find live info for that flight. Check the number and date."); }).catch(() => {});
      } catch (err) { busy(b, false); $("#ferr").textContent = err.message; }
    });
    $("#fdel")?.addEventListener("click", async () => {
      if (!confirm("Remove this flight?")) return;
      try { must(await sb.from("trip_flights").delete().eq("id", f.id)); FL.flights = FL.flights.filter((x) => x.id !== f.id); store.set("flights." + trip.id, FL); closeSheet(); drawOverview(); }
      catch (err) { fail(err); }
    });
  }

  // ───────────────────────── trip ledger ─────────────────────────
  let EX = null; // { tripId, expenses: [{..., expense_shares: [...]}] }
  async function fetchExpenses(id) {
    const rows = must(await sb.from("expenses").select("*, expense_shares(*)").eq("trip_id", id).order("spent_on", { ascending: false }).order("created_at", { ascending: false }));
    return applyPendingExpenses({ tripId: id, expenses: rows });
  }
  function applyPendingExpenses(ex) {
    for (const op of outbox) {
      if (op.table === "expenses" && op.type === "insert") for (const r of op.rows) if (r.trip_id === ex.tripId && !ex.expenses.some((e) => e.id === r.id)) ex.expenses.unshift({ ...r, expense_shares: [] });
      if (op.table === "expenses" && op.type === "update") ex.expenses.forEach((e) => { if (op.ids?.includes(e.id)) Object.assign(e, op.patch); });
      if (op.table === "expenses" && op.type === "delete") ex.expenses = ex.expenses.filter((e) => !op.ids?.includes(e.id));
      if (op.table === "expense_shares" && op.type === "insert") for (const r of op.rows) { const e = ex.expenses.find((x) => x.id === r.expense_id); if (e && !e.expense_shares.some((x) => x.user_id === r.user_id)) e.expense_shares.push({ paid_back: false, ...r }); }
      if (op.table === "expense_shares" && op.type === "update") ex.expenses.forEach((e) => e.expense_shares.forEach((x) => { if (x.expense_id === op.eq?.expense_id && x.user_id === op.eq?.user_id) Object.assign(x, op.patch); }));
      if (op.table === "expense_shares" && op.type === "delete") ex.expenses.forEach((e) => { if (e.id === op.eq?.expense_id) e.expense_shares = e.expense_shares.filter((x) => op.eq.user_id && x.user_id !== op.eq.user_id); });
    }
    return ex;
  }
  const cacheEx = () => { if (EX) { store.set("exp." + EX.tripId, EX); if (T) { T.expensesTotal = EX.expenses.reduce((a, e) => a + e.amount_cents, 0); store.set("trip." + T.trip.id, T); } } };

  // Who owes whom, netted per pair of people, from shares not yet paid back.
  function balances(ex) {
    const owe = new Map(); // "debtor|creditor" -> cents
    for (const e of ex.expenses) for (const sh of e.expense_shares || []) {
      if (sh.user_id === e.paid_by || sh.paid_back || !sh.amount_cents) continue;
      const k = sh.user_id + "|" + e.paid_by; owe.set(k, (owe.get(k) || 0) + sh.amount_cents);
    }
    const pairs = [], seen = new Set();
    for (const k of owe.keys()) {
      const [a, b] = k.split("|"); const id = [a, b].sort().join("|"); if (seen.has(id)) continue; seen.add(id);
      const net = (owe.get(a + "|" + b) || 0) - (owe.get(b + "|" + a) || 0);
      if (net > 0) pairs.push({ from: a, to: b, cents: net }); else if (net < 0) pairs.push({ from: b, to: a, cents: -net });
    }
    return pairs.sort((x, y) => (y.from === session.user.id || y.to === session.user.id) - (x.from === session.user.id || x.to === session.user.id) || y.cents - x.cents);
  }

  async function renderExpenses(id) {
    if (!T || T.trip.id !== id) {
      const cached = store.get("trip." + id, null);
      T = cached || (await fetchTrip(id));
      if (!T) return go("#/");
    }
    EX = store.get("exp." + id, null);
    if (EX) drawExpenses(); else app.innerHTML = header({ title: T.trip.name, back: "#/" }) + `<main>${tripTabs("expenses")}<p class="hint"><span class="spin"></span><span>Loading…</span></p></main>`;
    const [fresh, ex] = await Promise.all([fetchTrip(id), fetchExpenses(id)]);
    if (fresh) T = fresh;
    EX = ex; cacheEx(); drawExpenses();
    let h;
    channel = sb.channel("exp-" + id)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: `trip_id=eq.${id}` }, () => { clearTimeout(h); h = setTimeout(refresh, 300); })
      .on("postgres_changes", { event: "*", schema: "public", table: "expense_shares" }, () => { clearTimeout(h); h = setTimeout(refresh, 300); })
      .subscribe();
    async function refresh() {
      if (location.hash !== `#/trip/${id}/expenses`) return;
      const ex2 = await fetchExpenses(id).catch(() => null); if (ex2) { EX = ex2; cacheEx(); drawExpenses(); }
    }
  }

  function drawExpenses() {
    const { trip } = T, cur = trip.currency || "USD", me_ = session.user.id;
    const shared = T.members.length > 1;
    const list = EX.expenses;
    const total = list.reduce((a, e) => a + e.amount_cents, 0);
    const myShare = list.reduce((a, e) => a + ((e.expense_shares || []).find((x) => x.user_id === me_)?.amount_cents || 0), 0);
    const iPaid = list.filter((e) => e.paid_by === me_).reduce((a, e) => a + e.amount_cents, 0);
    const pairs = balances(EX);
    const myNet = pairs.reduce((a, p) => a + (p.to === me_ ? p.cents : p.from === me_ ? -p.cents : 0), 0);
    const scrollY = window.scrollY;
    const canVenmo = (uid) => cur === "USD" && !!profileOf(uid).venmo;
    const owedBy = new Set(pairs.filter((p) => p.from === me_).map((p) => p.to));
    const noVenmo = [...owedBy].filter((u) => !profileOf(u).venmo);
    const venmoHint = cur !== "USD" || !shared ? ""
      : !me?.venmo && pairs.some((p) => p.to === me_) ? `<p class="hint vhint">Add your Venmo on the <a href="#/account">You</a> tab so people can pay you back in one tap.</p>`
      : noVenmo.length ? `<p class="hint vhint">${esc(noVenmo.map(firstName).join(" and "))} ${noVenmo.length > 1 ? "haven't" : "hasn't"} added Venmo yet, so there's no pay button for them.</p>` : "";
    const byDay = new Map();
    for (const e of list) { const d = e.spent_on || today(); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(e); }

    app.innerHTML = header({ title: trip.name, back: "#/", more: false, sub: [dateRange(trip.start_date, trip.end_date), trip.destination].filter(Boolean).map(esc).join(" · ") }) + `<main>
      ${tripTabs("expenses")}
      <div class="stats" style="margin-bottom:12px">
        ${`<div class="stat"><b>${esc(money(total, cur))}</b><span>trip total</span></div>`}
        ${`<div class="stat"><b>${esc(money(myShare, cur))}</b><span>your share</span></div>`}
        ${`<div class="stat"><b>${esc(money(iPaid, cur))}</b><span>you paid</span></div>`}
      </div>
      ${shared ? `<section class="card balance ${myNet > 0 ? "plus" : myNet < 0 ? "minus" : "even"}">
        <div class="bal-head">${myNet > 0 ? `You're owed <b>${esc(money(myNet, cur))}</b>` : myNet < 0 ? `You owe <b>${esc(money(-myNet, cur))}</b>` : list.length ? "You're all square ✓" : "No expenses yet"}</div>
        ${pairs.map((p, n) => `<div class="row"><span class="avs">${avatar(profileOf(p.from))}${avatar(profileOf(p.to))}</span>
          <span class="nm">${p.from === me_ ? `You owe ${esc(nameOf(p.to))}` : p.to === me_ ? `${esc(nameOf(p.from))} owes you` : `${esc(nameOf(p.from))} owes ${esc(nameOf(p.to))}`} <b>${esc(money(p.cents, cur))}</b></span>
          <span class="row-btns">${p.from === me_ && canVenmo(p.to) ? `<button class="pill venmo" data-vpair="${n}">${VENMO_ICON}Pay</button>` : ""}<button class="pill" data-settle="${n}">Paid back</button></span></div>`).join("")}
        ${venmoHint}
      </section>` : `<p class="hint" style="margin:0 4px 12px">Share this trip to split costs. Pack keeps a running tally of who owes whom.</p>`}
      ${list.length ? "" : `<div class="empty"><strong>No expenses yet</strong>Log coffees, meals, gas, campsites, whoever paid. Pack splits them and keeps track of who owes whom.</div>`}
      ${[...byDay.entries()].map(([d, es]) => `<h3 class="sec">${esc(fmtDate(d, { weekday: "short", month: "short", day: "numeric" }))}</h3>
        ${es.map((e) => `<section class="card expense" data-exp="${e.id}">
          <button class="exp-main" data-edit-exp="${e.id}"><span class="grow"><strong>${esc(e.description)}</strong>
            <span class="note">${e.paid_by === me_ ? "You paid" : `${esc(nameOf(e.paid_by))} paid`}${(e.expense_shares || []).length > 1 ? ` · split ${(e.expense_shares || []).length} ways` : ""}</span></span>
            <b class="amt">${esc(money(e.amount_cents, cur))}</b></button>
          ${shared && (e.expense_shares || []).length ? `<div class="shares">${e.expense_shares.map((sh) => sh.user_id === e.paid_by
            ? `<span class="share self">${avatar(profileOf(sh.user_id), "sm")}${esc(sh.user_id === me_ ? "Your share" : nameOf(sh.user_id) + "'s share")} ${esc(money(sh.amount_cents, cur))}</span>`
            : `<button class="share${sh.paid_back ? " paid" : ""}" data-share="${e.id}|${sh.user_id}" aria-pressed="${sh.paid_back}">${avatar(profileOf(sh.user_id), "sm")}${sh.user_id === me_ ? (sh.paid_back ? `You paid back ${esc(money(sh.amount_cents, cur))} ✓` : `You owe ${esc(money(sh.amount_cents, cur))}`) : (sh.paid_back ? `${esc(nameOf(sh.user_id))} paid back ${esc(money(sh.amount_cents, cur))} ✓` : `${esc(nameOf(sh.user_id))} owes ${esc(money(sh.amount_cents, cur))}`)}</button>`).join("")}</div>` : ""}
          ${shared && cur === "USD" ? (() => { const sh = (e.expense_shares || []).find((x) => x.user_id === me_); return sh && e.paid_by !== me_ && !sh.paid_back && sh.amount_cents > 0 && canVenmo(e.paid_by)
            ? `<div class="pay-row"><button class="venmo-btn" data-vexp="${e.id}">${VENMO_ICON}Pay ${esc(firstName(e.paid_by))} ${esc(money(sh.amount_cents, cur))} on Venmo</button></div>` : ""; })() : ""}
        </section>`).join("")}`).join("")}
      ${shared && list.length ? `<p class="hint" style="margin:10px 4px">Tap someone's share to mark it paid back. Balances update right away.</p>` : ""}
    </main>
    <div class="add"><div style="max-width:760px;margin:0 auto"><button class="primary" id="addExp" style="margin:0">+ Add expense</button></div></div>`;
    window.scrollTo(0, scrollY);

    $("#addExp").addEventListener("click", () => expenseSheet(null));
    $$("[data-edit-exp]").forEach((b) => b.addEventListener("click", () => expenseSheet(EX.expenses.find((e) => e.id === b.dataset.editExp))));
    $$("[data-share]").forEach((b) => b.addEventListener("click", async () => {
      const [eid, uid] = b.dataset.share.split("|");
      const sh = EX.expenses.find((e) => e.id === eid)?.expense_shares.find((x) => x.user_id === uid); if (!sh) return;
      sh.paid_back = !sh.paid_back; cacheEx(); drawExpenses();
      try { await write({ type: "update", table: "expense_shares", eq: { expense_id: eid, user_id: uid }, patch: { paid_back: sh.paid_back } }); }
      catch (err) { sh.paid_back = !sh.paid_back; cacheEx(); drawExpenses(); fail(err); }
    }));
    const markPaid = async (keys, label) => {
      if (!keys.length || !confirm(`${label}\n\nMark it as paid back in Pack?`)) return;
      for (const e of EX.expenses) for (const sh of e.expense_shares || []) if (keys.some((k) => k.expense_id === e.id && k.user_id === sh.user_id)) sh.paid_back = true;
      cacheEx(); if (location.hash === `#/trip/${T.trip.id}/expenses`) drawExpenses();
      try { for (const k of keys) await write({ type: "update", table: "expense_shares", eq: k, patch: { paid_back: true } }); toast("Marked as paid back"); }
      catch (err) { fail(err); }
    };
    $$("[data-vexp]").forEach((b) => b.addEventListener("click", () => {
      const e = EX.expenses.find((x) => x.id === b.dataset.vexp); const sh = e?.expense_shares.find((x) => x.user_id === me_); if (!sh) return;
      const to = profileOf(e.paid_by);
      openVenmo(to.venmo, sh.amount_cents, `${e.description} · ${trip.name}`, () =>
        markPaid([{ expense_id: e.id, user_id: me_ }], `Did you send ${firstName(e.paid_by)} ${money(sh.amount_cents, cur)} for ${e.description}?`));
    }));
    $$("[data-vpair]").forEach((b) => b.addEventListener("click", () => {
      const pr = pairs[+b.dataset.vpair];
      const keys = [];
      for (const e of EX.expenses) for (const sh of e.expense_shares || []) {
        if (sh.paid_back || sh.user_id === e.paid_by) continue;
        if ((sh.user_id === pr.from && e.paid_by === pr.to) || (sh.user_id === pr.to && e.paid_by === pr.from)) keys.push({ expense_id: e.id, user_id: sh.user_id });
      }
      openVenmo(profileOf(pr.to).venmo, pr.cents, `${trip.name} · settling up (Pack)`, () =>
        markPaid(keys, `Did you send ${firstName(pr.to)} ${money(pr.cents, cur)}?`));
    }));
    $$("[data-settle]").forEach((b) => b.addEventListener("click", async () => {
      const pr = pairs[+b.dataset.settle];
      if (!confirm(`Mark everything between ${pr.from === me_ ? "you" : nameOf(pr.from)} and ${pr.to === me_ ? "you" : nameOf(pr.to)} as paid back (${money(pr.cents, cur)})?`)) return;
      const ops = [];
      for (const e of EX.expenses) for (const sh of e.expense_shares || []) {
        if (sh.paid_back || sh.user_id === e.paid_by) continue;
        if ((sh.user_id === pr.from && e.paid_by === pr.to) || (sh.user_id === pr.to && e.paid_by === pr.from)) { sh.paid_back = true; ops.push({ expense_id: e.id, user_id: sh.user_id }); }
      }
      cacheEx(); drawExpenses();
      try { for (const k of ops) await write({ type: "update", table: "expense_shares", eq: k, patch: { paid_back: true } }); toast("Marked as paid back"); }
      catch (err) { fail(err); }
    }));
  }

  // Add or edit an expense: amount, who paid, who it's split between (equally or custom).
  function expenseSheet(e) {
    const cur = T.trip.currency || "USD", me_ = session.user.id, d = curDigits(cur);
    const members = T.members.map((m) => m.user_id);
    const old = e ? Object.fromEntries((e.expense_shares || []).map((x) => [x.user_id, x])) : {};
    let split = e ? Object.keys(old) : [...members];
    let custom = e ? (e.expense_shares || []).some((x, _, a) => Math.abs(x.amount_cents - e.amount_cents / a.length) >= 1) : false;
    const fmtIn = (c) => (c / 10 ** d).toFixed(d);
    openSheet(`<h2>${e ? "Edit expense" : "Add expense"}</h2><form id="xf" autocomplete="off">
      <label class="f" for="xd">What for</label><input class="t" id="xd" value="${esc(e?.description || "")}" placeholder="Coffee, dinner, gas…" required maxlength="120" data-autofocus>
      <div class="row2"><div><label class="f" for="xa">Amount (${esc(cur)})</label><input class="t" id="xa" inputmode="decimal" value="${e ? fmtIn(e.amount_cents) : ""}" placeholder="0.00" required></div>
        <div><label class="f" for="xt">Date</label><input class="t" id="xt" type="date" value="${esc(e?.spent_on || (T.trip.start_date && T.trip.start_date > today() ? T.trip.start_date : today()))}"></div></div>
      ${members.length > 1 ? `<label class="f" for="xp">Paid by</label><select class="t" id="xp">${members.map((u) => `<option value="${u}"${u === (e?.paid_by || me_) ? " selected" : ""}>${esc(u === me_ ? "Me" : nameOf(u))}</option>`).join("")}</select>
      <label class="f">Split between</label><div class="chips" id="xs">${members.map((u) => `<button type="button" class="chip${split.includes(u) ? " on" : ""}" data-u="${u}">${esc(u === me_ ? "Me" : nameOf(u))}</button>`).join("")}</div>
      <label class="check-row"><input type="checkbox" id="xc"${custom ? " checked" : ""}><span class="grow">Split unevenly</span></label>
      <div id="xcustom"></div>` : ""}
      <p class="hint" id="xerr" role="alert" style="color:var(--err)"></p>
      <button class="primary" type="submit">${e ? "Save" : "Add expense"}</button>
      ${e ? `<button class="danger-btn" type="button" id="xdel">Delete expense</button>` : ""}</form>`);
    const drawCustom = () => {
      const box = $("#xcustom"); if (!box) return;
      if (!$("#xc").checked) { box.innerHTML = ""; return; }
      // Keep anything already typed when the list of people changes.
      const typed = Object.fromEntries($$("[data-cu]", box).map((i) => [i.dataset.cu, i.value]));
      const val = (u) => typed[u] ?? (old[u] && e ? fmtIn(old[u].amount_cents) : "");
      box.innerHTML = split.map((u) => `<div class="row2" style="align-items:center;margin-top:8px"><span>${esc(u === me_ ? "Me" : nameOf(u))}</span>
        <input class="t" inputmode="decimal" data-cu="${u}" value="${esc(val(u))}" placeholder="0.00"></div>`).join("");
    };
    drawCustom();
    $("#xs")?.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-u]"); if (!b) return;
      const u = b.dataset.u; split = split.includes(u) ? split.filter((x) => x !== u) : [...split, u];
      if (!split.length) split = [u];
      b.parentElement.querySelectorAll("[data-u]").forEach((x) => x.classList.toggle("on", split.includes(x.dataset.u)));
      drawCustom();
    });
    $("#xc")?.addEventListener("change", drawCustom);
    $("#xdel")?.addEventListener("click", async () => {
      if (!confirm(`Delete “${e.description}”?`)) return;
      closeSheet(); EX.expenses = EX.expenses.filter((x) => x.id !== e.id); cacheEx(); drawExpenses();
      write({ type: "delete", table: "expenses", ids: [e.id] }).catch(fail);
    });
    $("#xf").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const amount = parseMoney($("#xa").value, cur);
      if (!amount) return ($("#xerr").textContent = "Enter an amount.");
      const payer = $("#xp")?.value || me_;
      const people = members.length > 1 ? split : [me_];
      let shares;
      if ($("#xc")?.checked) {
        shares = people.map((u) => ({ user_id: u, amount_cents: parseMoney($(`[data-cu="${u}"]`)?.value, cur) }));
        const sum = shares.reduce((a, x) => a + x.amount_cents, 0);
        if (sum !== amount) return ($("#xerr").textContent = `Shares add up to ${money(sum, cur)}, not ${money(amount, cur)}.`);
      } else {
        const base = Math.floor(amount / people.length); let rest = amount - base * people.length;
        // Any leftover cent goes to the payer first, then in order.
        const ordered = [...people].sort((a, b) => (b === payer) - (a === payer));
        shares = ordered.map((u) => ({ user_id: u, amount_cents: base + (rest-- > 0 ? 1 : 0) }));
      }
      const row = { description: $("#xd").value.trim().slice(0, 120), amount_cents: amount, paid_by: payer, spent_on: $("#xt").value || today() };
      const shareRows = (eid) => shares.map((x) => ({ expense_id: eid, user_id: x.user_id, amount_cents: x.amount_cents,
        paid_back: x.user_id !== payer && !!old[x.user_id]?.paid_back && old[x.user_id]?.amount_cents === x.amount_cents && e?.paid_by === payer }));
      closeSheet();
      try {
        if (e) {
          Object.assign(e, row); e.expense_shares = shareRows(e.id); cacheEx(); drawExpenses();
          for (const u of Object.keys(old)) await write({ type: "delete", table: "expense_shares", eq: { expense_id: e.id, user_id: u } });
          await write({ type: "update", table: "expenses", ids: [e.id], patch: row });
          await write({ type: "insert", table: "expense_shares", rows: shareRows(e.id) });
        } else {
          const eid = newId();
          const full = { id: eid, trip_id: T.trip.id, created_by: me_, ...row };
          EX.expenses.unshift({ ...full, created_at: new Date().toISOString(), expense_shares: shareRows(eid) }); cacheEx(); drawExpenses();
          await write({ type: "insert", table: "expenses", rows: [full] });
          await write({ type: "insert", table: "expense_shares", rows: shareRows(eid) });
        }
      } catch (err) { fail(err); renderExpenses(T.trip.id); }
    });
  }

  // ───────────────────────── closet ─────────────────────────
  let closetTab = store.get("closetTab", "personal");
  async function renderCloset() {
    invCache = null;
    const all = must(await sb.from("closet_items").select("*").order("category").order("name"));
    const tabOf = (i) => (i.purpose === "work" ? "work" : "personal");
    const items = all.filter((i) => tabOf(i) === closetTab);
    const groups = {};
    for (const i of items) (groups[i.category] ||= []).push(i);
    const alwaysN = items.filter((i) => i.always).length;
    const isEquip = closetTab === "work";
    const n = (t) => all.filter((i) => tabOf(i) === t).length;
    app.innerHTML = header({ title: "Inventory", sub: "Things you own and pack often. Mark “Always” to add them to every new trip." }) + `<main class="tabbed">
      <div class="seg wide" role="tablist" style="margin-bottom:14px">
        <button role="tab" data-ctab="personal" class="${!isEquip ? "on" : ""}" aria-selected="${!isEquip}">Personal <small>${n("personal")}</small></button>
        <button role="tab" data-ctab="work" class="${isEquip ? "on" : ""}" aria-selected="${isEquip}">Equipment <small>${n("work")}</small></button>
      </div>
      ${!items.length ? `<div class="empty"><strong>${isEquip ? "No equipment yet" : "Nothing here yet"}</strong>${isEquip
        ? "Add the kit you bring for work — cameras, lenses, laptops, tools. When you plan a trip, you can bring it all with one tap."
        : "Add things you always bring — chargers, meds, your favorite jacket — or save items from any trip."}</div>` : ""}
      ${alwaysN ? `<p class="hint" style="margin:0 4px 12px">${alwaysN} item${alwaysN === 1 ? "" : "s"} here will be added to every new trip.</p>` : ""}
      ${Object.entries(groups).map(([c, its]) => `<section class="card cat"><h2>${esc(c)} <span>${its.length}</span></h2>
        ${its.map((i) => `<div class="row"><button class="nm linkish" data-open="${i.id}">${esc(i.name)}${i.note ? `<span class="note">${esc(i.note)}</span>` : ""}</button>
          ${i.qty ? `<span class="qty">${esc(i.qty)}</span>` : ""}
          <button class="tog ${i.always ? "on" : ""}" data-tog="${i.id}" aria-pressed="${i.always}">Always</button>
          <button class="del" data-del="${i.id}" aria-label="Delete ${esc(i.name)}">✕</button></div>`).join("")}</section>`).join("")}
      ${items.length ? `<p class="hint" style="margin:6px 4px">Tap an item to move it to ${isEquip ? "Personal" : "Equipment"} or change its type.</p>` : ""}
    </main>
    <div class="add over-tabs"><form id="addForm"><input class="t" id="addInput" placeholder="${isEquip ? "Add equipment…" : "Add personal items…"} (any format)" autocomplete="off" enterkeyhint="send"><button id="addBtn" type="submit">Add</button></form></div>
    ${tabs("closet")}`;
    $$("[data-ctab]").forEach((b) => b.addEventListener("click", () => { closetTab = b.dataset.ctab; store.set("closetTab", closetTab); renderCloset(); }));
    $("main").addEventListener("click", async (e) => {
      const t = e.target.closest("[data-tog]");
      if (t) { const it = items.find((x) => x.id === t.dataset.tog); it.always = !it.always; t.classList.toggle("on", it.always);
        const { error } = await sb.from("closet_items").update({ always: it.always }).eq("id", it.id); if (error) fail(error); return; }
      const d = e.target.closest("[data-del]");
      if (d) { const { error } = await sb.from("closet_items").delete().eq("id", d.dataset.del); error ? fail(error) : renderCloset(); return; }
      const o = e.target.closest("[data-open]");
      if (o) {
        const it = items.find((x) => x.id === o.dataset.open); if (!it) return;
        const other = isEquip ? "personal" : "work";
        openSheet(`<h2>${esc(it.name)}</h2><div class="menu">
          <button data-a="move">Move to ${isEquip ? "Personal" : "Equipment"}</button>
          <hr>${KINDS.map(([k, l]) => `<button data-a="kind" data-k="${k}"${(it.kind || "gear") === k ? ' class="cur"' : ""}>${l}${(it.kind || "gear") === k ? " ✓" : ""}</button>`).join("")}
          <hr><button data-a="close" style="font-weight:650">Cancel</button></div>`, async (ev) => {
          const b = ev.target.closest("[data-a]"); if (!b) return;
          closeSheet();
          const patch = b.dataset.a === "move" ? { purpose: other } : b.dataset.a === "kind" ? { kind: b.dataset.k } : null;
          if (!patch) return;
          const { error } = await sb.from("closet_items").update(patch).eq("id", it.id);
          if (error) return fail(error);
          if (patch.purpose) toast(`Moved to ${isEquip ? "Personal" : "Equipment"}`);
          renderCloset();
        });
      }
    });
    $("#addForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const v = $("#addInput").value.trim(); if (!v) return;
      const btn = $("#addBtn"); busy(btn, true);
      try {
        let rows;
        try {
          const res = await api("/api/sort", { items: v, mode: "closet", categories: [...new Set(all.map((i) => i.category))], have: all.map((i) => i.name) });
          rows = res.items.map((i) => ({ name: i.name, qty: i.qty || "", note: i.note || "", category: i.category || "Other", kind: i.kind || "gear" }));
        } catch (err) {
          if (err.status === 401) throw err;
          rows = v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name: name.slice(0, 200), category: "Other" }));
        }
        const have = new Set(all.map((i) => key(i.name)));
        // Whatever tab you're on decides personal vs equipment.
        rows = rows.filter((r) => !have.has(key(r.name))).map((r) => ({ ...r, purpose: closetTab, owner_id: session.user.id }));
        if (rows.length) must(await sb.from("closet_items").insert(rows));
        renderCloset();
      } catch (err) { busy(btn, false); fail(err); }
    });
  }

  // ───────────────────────── templates ─────────────────────────
  async function renderTemplates() {
    const tpls = must(await sb.from("templates").select("id,name,bags,items,created_at").order("created_at", { ascending: false }));
    app.innerHTML = header({ title: "Templates", sub: "Reusable lists for trips you take again." }) + `<main class="tabbed">
      ${!tpls.length ? `<div class="empty"><strong>No templates yet</strong>Open any trip, tap ••• and choose “Save as a template”. Next time, start a new trip from it.</div>` : ""}
      ${tpls.map((t) => `<a class="tpl" href="#/template/${t.id}"><div class="grow"><div class="t">${esc(t.name)}</div>
        <div class="m">${(t.items || []).length} items${t.bags?.length ? " · " + t.bags.map(esc).join(", ") : ""}</div></div>${ICON.back.replace("M15 18l-6-6 6-6", "M9 18l6-6-6-6").replace("<svg", '<svg width="20" height="20"')}</a>`).join("")}
    </main>${tabs("tpl")}`;
  }
  async function renderTemplate(id) {
    const t = must(await sb.from("templates").select("*").eq("id", id).maybeSingle());
    if (!t) return go("#/templates");
    const groups = {};
    for (const i of t.items || []) (groups[i.category || "Other"] ||= []).push(i);
    app.innerHTML = header({ title: t.name, back: "#/templates", sub: `${(t.items || []).length} items${t.bags?.length ? " · " + t.bags.map(esc).join(", ") : ""}` }) + `<main>
      <a class="primary" style="text-decoration:none;margin:0 0 16px" href="#/new/${t.id}">Start a trip from this</a>
      ${Object.entries(groups).map(([c, its]) => `<section class="card cat"><h2>${esc(c)} <span>${its.length}</span></h2>
        ${its.map((i, n) => `<div class="row"><span class="nm">${esc(i.name)}</span>${i.qty ? `<span class="qty">${esc(i.qty)}</span>` : ""}${i.bag ? `<span class="bagtag">${esc(i.bag)}</span>` : ""}
          <button class="del" data-rm="${esc(c)}|${n}" aria-label="Remove ${esc(i.name)}">✕</button></div>`).join("")}</section>`).join("")}
      <button class="danger-btn" id="delTpl">Delete template</button></main>`;
    $("main").addEventListener("click", async (e) => {
      const r = e.target.closest("[data-rm]"); if (!r) return;
      const [c, n] = r.dataset.rm.split("|"); const victim = groups[c][+n];
      t.items = t.items.filter((x) => x !== victim);
      const { error } = await sb.from("templates").update({ items: t.items }).eq("id", t.id); error ? fail(error) : renderTemplate(id);
    });
    $("#delTpl").addEventListener("click", async () => {
      if (!confirm(`Delete the “${t.name}” template?`)) return;
      const { error } = await sb.from("templates").delete().eq("id", t.id); error ? fail(error) : go("#/templates");
    });
  }

  // ───────────────────────── account ─────────────────────────
  // ───────────────────────── you: stats + account ─────────────────────────
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const tripDays = (t) => !t.start_date ? 0 : Math.round((new Date((t.end_date || t.start_date) + "T12:00:00") - new Date(t.start_date + "T12:00:00")) / 864e5) + 1;
  function barChart(rows, field, label, color) {
    const W = 340, H = 110, max = Math.max(1, ...rows.map((r) => r[field])), bw = W / rows.length;
    const total = rows.reduce((a, r) => a + r[field], 0);
    return `<figure class="card chart"><figcaption><strong>${esc(label)}</strong><span>${total} in 30 days · peak ${max}</span></figcaption>
      <svg viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="${esc(label)}, last 30 days">
        <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="var(--line)"/>
        ${rows.map((r, i) => { const h = (r[field] / max) * (H - 8); return `<rect x="${i * bw + 1.5}" y="${H - h}" width="${bw - 3}" height="${h}" rx="2" fill="${color}"><title>${esc(fmtDate(r.day))}: ${r[field]}</title></rect>`; }).join("")}
        <text x="0" y="${H + 14}" font-size="10" fill="var(--muted)">${esc(fmtDate(rows[0].day))}</text>
        <text x="${W}" y="${H + 14}" font-size="10" fill="var(--muted)" text-anchor="end">Today</text>
      </svg></figure>`;
  }
  const stat = (n, label) => `<div class="stat"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;

  async function renderAccount() {
    const draw = (st, admin) => {
      app.innerHTML = header({ title: "You" }) + `<main class="tabbed">
      <div class="card" style="padding:16px;display:flex;gap:14px;align-items:center">${avatar(me)}<div class="grow"><strong>${esc(me?.display_name || "")}</strong><div class="muted" style="font-size:14px">${esc(me?.email || session.user.email || "")}</div></div></div>
      ${admin ? `<a class="secondary admin-link" href="#/admin">Admin dashboard →</a>` : ""}
      <h3 class="sec">Your packing</h3>
      ${st ? `<div class="stats">
        ${stat(st.trips, st.trips === 1 ? "trip planned" : "trips planned")}
        ${stat(st.upcoming, "upcoming")}
        ${stat(st.days, st.days === 1 ? "day away" : "days away")}
        ${stat(st.packed, "items packed")}
        ${stat(st.avg, "items per trip")}
        ${stat(st.shared, st.shared === 1 ? "shared trip" : "shared trips")}
      </div>
      ${st.top.length ? `<div class="card" style="padding:14px 16px;margin-top:12px"><div class="muted" style="font-size:13px;font-weight:650;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Always comes with you</div>
        <div class="chips">${st.top.map(([n, c]) => `<span class="chip">${esc(n)} <small>×${c}</small></span>`).join("")}</div></div>` : ""}
      <div class="card" style="padding:14px 16px;margin-top:12px;display:flex;gap:16px">
        <div class="grow"><div class="muted" style="font-size:13px">Inventory</div><strong>${plural(st.personal, "personal item")} · ${plural(st.equipment, "piece")} of equipment</strong></div>
        <a class="pill" href="#/inventory" style="align-self:center;text-decoration:none">Open</a></div>
      <div class="kindbar" aria-label="What you pack">${[["clothes", "Clothes"], ["gear", "Gear"], ["essentials", "Essentials"]].map(([k, l]) =>
        `<span style="flex:${st.kinds[k] || 0.0001}" class="k-${k}" title="${l}: ${st.kinds[k] || 0}"></span>`).join("")}</div>
      <p class="hint" style="margin:6px 4px 0">${[["clothes", "Clothes"], ["gear", "Gear"], ["essentials", "Essentials"]].map(([k, l]) => `<span class="dot k-${k}"></span>${l} ${st.kinds[k] || 0}`).join(" · ")}</p>`
      : `<p class="hint" style="margin:0 4px"><span class="spin"></span><span>Counting…</span></p>`}
      <form id="nf"><label class="f" for="dn">Your name <small>(shown to people you pack with)</small></label>
        <input class="t" id="dn" value="${esc(me?.display_name || "")}" maxlength="60">
        <button class="secondary" type="submit">Save name</button></form>
      <h3 class="sec">Venmo</h3>
      <form id="vf"><label class="f" for="vm">Username or profile link <small>(so trip-mates can pay you back in one tap)</small></label>
        <input class="t" id="vm" value="${me?.venmo ? "@" + esc(me.venmo) : ""}" placeholder="@your-name or venmo.com/u/your-name" maxlength="120" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="url">
        <p class="hint" id="vmerr" role="alert" style="margin:6px 4px 0"></p>
        <button class="secondary" type="submit">${me?.venmo ? "Save Venmo" : "Add Venmo"}</button></form>
      <h3 class="sec">Appearance</h3>
      <div class="seg wide" role="group" aria-label="Appearance">${[["system", "Match system"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => `<button type="button" data-theme-pick="${k}" class="${themePref() === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <h3 class="sec">Reminders</h3>
      <label class="check-row" style="margin-top:0"><input type="checkbox" id="remind"${me?.reminders === false ? "" : " checked"}><span class="grow">Email me the day before a trip<br><small class="muted">What's left to pack and what to grab last, sent around 9am your time.</small></span></label>
      <h3 class="sec">Smart sorting</h3>
      <p class="hint" style="margin:0 4px">Each person gets ${cfg.dailyLimit || 50} smart sorts a day, reset at midnight. Checking things off, editing and sharing never count.</p>
      <h3 class="sec">Home screen</h3>
      ${isStandalone() ? `<p class="hint" style="margin:0 4px">Pack is on your home screen ✓</p>`
        : `<div data-install-wrap="btn"${canInstall() ? "" : " hidden"}>${installBtn()}<p class="hint" style="margin:6px 4px 0">Opens full screen like an app, and your lists work offline.</p></div>
           ${canInstall() ? "" : `<p class="hint" style="margin:0 4px">On a phone, open pack.spruceandsound.com and use <strong>Add to Home Screen</strong> to use Pack like an app.</p>`}`}
      <h3 class="sec">Your data</h3>
      <button class="secondary" id="export" type="button">Download my data</button>
      <p class="hint" style="margin:6px 4px 0">A file with your account, trips, lists, inventory, templates and expenses.</p>
      <button class="secondary" id="out" style="margin-top:28px">Sign out</button>
      <button class="danger-btn" id="delAcct" type="button">Delete account</button>
      <p class="legal-links"><a href="/terms">Terms of Use</a> · <a href="/privacy">Privacy Policy</a> · <a href="mailto:hello@spruceandsound.com">Contact</a></p>
    </main>${tabs("me")}`;
      $("#nf").addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = $("#dn").value.trim().slice(0, 60);
        const { error } = await sb.from("profiles").update({ display_name: name }).eq("id", session.user.id);
        if (error) return fail(error);
        me.display_name = name; toast("Saved"); renderAccount();
      });
      $("#vf").addEventListener("submit", async (e) => {
        e.preventDefault();
        const v = parseVenmo($("#vm").value), err = $("#vmerr");
        if (v === null) { err.style.color = "var(--err)"; err.textContent = "That doesn't look like a Venmo username. Try @your-name, or copy the link from your Venmo profile."; return; }
        const { error } = await sb.from("profiles").update({ venmo: v || null }).eq("id", session.user.id);
        if (error) return fail(error);
        err.textContent = ""; me = { ...(me || { id: session.user.id }), venmo: v || null }; store.set("me", me); toast(v ? `Saved @${v}` : "Venmo removed"); renderAccount();
      });
      $("#remind").addEventListener("change", async (e) => {
        const on = e.target.checked;
        const { error } = await sb.from("profiles").update({ reminders: on }).eq("id", session.user.id);
        if (error) { e.target.checked = !on; return fail(error); }
        me.reminders = on; store.set("me", me); toast(on ? "Reminders on" : "Reminders off");
      });
      $("#export").addEventListener("click", async (e) => {
        const b = e.currentTarget; busy(b, true, "Preparing…");
        try {
          const uid = session.user.id;
          const [profile, trips, inventory, templates, expenses] = await Promise.all([
            sb.from("profiles").select("*").eq("id", uid).maybeSingle().then(must),
            sb.from("trips").select("*, trip_members(user_id, role, joined_at), items(*)").then(must),
            sb.from("closet_items").select("*").eq("owner_id", uid).then(must),
            sb.from("templates").select("*").then(must),
            sb.from("expenses").select("*, expense_shares(*)").then(must),
          ]);
          for (const t of trips) t.expenses = expenses.filter((x) => x.trip_id === t.id);
          for (const t of trips) t.items = (t.items || []).filter((i) => !i.personal_of || i.personal_of === uid);
          const out = { exported_at: new Date().toISOString(), app: "Pack · pack.spruceandsound.com", account: { ...profile, email: profile?.email || session.user.email }, trips, inventory, templates };
          const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
          const a = Object.assign(document.createElement("a"), { href: url, download: `pack-data-${today()}.json` });
          document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
          toast("Downloaded");
        } catch (err) { fail(err); } finally { busy(b, false); }
      });
      $("#delAcct").addEventListener("click", () => {
        openSheet(`<h2>Delete your account?</h2>
          <p class="hint" style="margin:6px 0 10px">This can't be undone. Pack will permanently delete:</p>
          <ul class="del-list"><li>Your profile, inventory and templates</li><li>Trips that only you are on</li><li>Your personal lists on shared trips</li><li>Expenses you paid for, and your shares of others' expenses</li></ul>
          <p class="hint" style="margin:0 0 12px">Shared trips stay for everyone else. If you own one, it passes to the next person on it. Want a copy first? Use <strong>Download my data</strong>.</p>
          <form id="delf"><label class="f" for="delc">Type DELETE to confirm</label>
          <input class="t" id="delc" autocomplete="off" autocapitalize="characters" spellcheck="false" required>
          <p class="hint" id="delerr" role="alert" style="color:var(--err)"></p>
          <button class="danger-btn" type="submit" style="margin-top:4px">Delete my account</button>
          <button class="secondary" type="button" id="delno">Keep my account</button></form>`);
        $("#delno").addEventListener("click", closeSheet);
        $("#delf").addEventListener("submit", async (e) => {
          e.preventDefault();
          if ($("#delc").value.trim().toUpperCase() !== "DELETE") { $("#delerr").textContent = "Type DELETE to confirm."; return; }
          const b = e.submitter || $("#delf .danger-btn"); busy(b, true, "Deleting…");
          try {
            await api("/api/delete-account", { confirm: "DELETE" });
            for (const k of Object.keys(localStorage)) if (k.startsWith("pack2.") && k !== "pack2.cfg" && k !== "pack2.theme") localStorage.removeItem(k);
            closeSheet(); history.replaceState(null, "", "#/");
            await sb.auth.signOut().catch(() => {});
            toast("Your account was deleted");
          } catch (err) { busy(b, false); $("#delerr").textContent = err.message; }
        });
      });
      $("#out").addEventListener("click", async () => {
        for (const k of Object.keys(localStorage)) if (k.startsWith("pack2.") && k !== "pack2.cfg" && k !== "pack2.lastEmail") localStorage.removeItem(k);
        history.replaceState(null, "", "#/");
        await sb.auth.signOut();
      });
    };
    draw(store.get("myStats", null), store.get("isAdmin", false));
    const [trips, inv, adminRes] = await Promise.all([
      sb.from("trips").select("id,start_date,end_date,items(name,packed,kind),trip_members(user_id)").then(must),
      sb.from("closet_items").select("purpose").eq("owner_id", session.user.id).then(must),
      sb.rpc("is_admin"),
    ]);
    const t0 = today(), counts = new Map(), kinds = {};
    let packed = 0, itemsN = 0;
    for (const t of trips) for (const i of t.items || []) {
      itemsN++; if (i.packed) packed++;
      kinds[i.kind || "gear"] = (kinds[i.kind || "gear"] || 0) + 1;
      const k = key(i.name); const c = counts.get(k) || [i.name, 0]; c[1]++; counts.set(k, c);
    }
    const st = {
      trips: trips.length, upcoming: trips.filter((t) => !t.end_date || t.end_date >= t0).length,
      days: trips.reduce((a, t) => a + tripDays(t), 0), packed, avg: trips.length ? Math.round(itemsN / trips.length) : 0,
      shared: trips.filter((t) => (t.trip_members || []).length > 1).length,
      top: [...counts.values()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8),
      personal: inv.filter((i) => i.purpose !== "work").length, equipment: inv.filter((i) => i.purpose === "work").length, kinds,
    };
    const admin = !adminRes.error && adminRes.data === true;
    store.set("myStats", st); store.set("isAdmin", admin);
    if (location.hash === "#/account") draw(st, admin);
  }

  // ───────────────────────── admin ─────────────────────────
  async function renderAdmin() {
    app.innerHTML = header({ title: "Admin", back: "#/account", sub: "Pack usage across everyone" }) + `<main><p class="hint"><span class="spin"></span><span>Loading…</span></p></main>`;
    const { data: a, error } = await sb.rpc("admin_stats");
    if (error) { app.innerHTML = header({ title: "Admin", back: "#/account" }) + `<main><div class="empty"><strong>Admins only</strong>This page is only for Pack's owner.</div></main>`; return; }
    const pct = (x, y) => (y ? Math.round((x / y) * 100) + "%" : "–");
    const ago = (d) => { if (!d) return "never"; const n = Math.round((new Date(today() + "T12:00:00") - new Date(String(d).slice(0, 10) + "T12:00:00")) / 864e5); return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`; };
    app.innerHTML = header({ title: "Admin", back: "#/account", sub: "Pack usage across everyone · updated just now" }) + `<main>
      <a class="card cc-link" href="#/admin/content"><span class="cc-li">📣</span><span class="grow"><b>Content calendar</b><small>30 days of Instagram + TikTok posts, with files to download</small></span><span class="muted">›</span></a>
      <h3 class="sec">People</h3>
      <div class="stats">
        ${stat(a.users, "accounts")}${stat(a.users_7d, "new this week")}${stat(a.active_1d, "active today")}
        ${stat(a.active_7d, "active this week")}${stat(a.active_30d, "active this month")}${stat(pct(a.returning_users, a.users), "came back another day")}
      </div>
      <h3 class="sec">Trips &amp; packing</h3>
      <div class="stats">
        ${stat(a.trips, "trips")}${stat(a.trips_7d, "trips this week")}${stat(pct(a.repeat_planners, a.users), "planned 2+ trips")}
        ${stat(a.shared_trips, "shared trips")}${stat(a.items, "items listed")}${stat(pct(a.items_packed, a.items), "items checked off")}
        ${stat(a.inventory_items, "inventory items")}${stat(a.templates, "templates")}${stat(a.sorts_today + " / " + a.sorts_30d, "smart sorts today / 30d")}
      </div>
      <h3 class="sec">Last 30 days</h3>
      ${barChart(a.daily, "active", "Active people", "var(--pine-2)")}
      ${barChart(a.daily, "signups", "New sign-ups", "var(--amber)")}
      ${barChart(a.daily, "trips", "Trips created", "var(--sky)")}
      ${barChart(a.daily, "sorts", "Smart sorts (Claude)", "var(--ok)")}
      <h3 class="sec">Everyone (${a.people.length})</h3>
      <div class="card people">${a.people.map((p) => `<div class="row"><span class="nm">${esc(p.email)}<span class="note">Joined ${esc(fmtDate(String(p.joined).slice(0, 10)))} · active ${esc(ago(p.last_active))}${p.days_active > 1 ? ` · ${p.days_active} days` : ""}</span></span>
        <span class="qty" title="Trips">${plural(p.trips, "trip")}</span><span class="qty" title="Smart sorts, last 30 days">${p.sorts_30d} sorts</span></div>`).join("")}</div>
      <h3 class="sec">Reminder emails</h3>
      <button class="secondary" id="testRem" style="margin-top:0">Send me a test reminder</button>
      <p class="hint" style="margin:6px 4px">Uses your next trip. Needs a Resend API key in Netlify.</p>
      <p class="hint" style="margin:12px 4px">“Active” means someone opened Pack that day. Days are in UTC. Only you can see this page.</p>
    </main>`;
    $("#testRem").addEventListener("click", async (e) => {
      busy(e.currentTarget, true, "Sending…");
      try { const r = await api("/api/test-reminder", {}); toast(`Sent to ${r.to}`); } catch (err) { fail(err); }
      busy(e.currentTarget, false);
    });
  }

  // ───────────────────────── admin: content calendar ─────────────────────────
  // Files live in /content as AES-GCM blobs; only admins can get the key (content_key RPC).
  const contentState = { key: null, cal: null, urls: {}, posted: new Set(), tab: "cal" };
  async function contentKey() {
    if (contentState.key) return contentState.key;
    const { data, error } = await sb.rpc("content_key");
    if (error || !data) throw new Error("admins");
    contentState.key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(data), (c) => c.charCodeAt(0)), "AES-GCM", false, ["decrypt"]);
    return contentState.key;
  }
  async function decryptBlob(path) {
    const res = await fetch("/content/" + path, { cache: "no-cache" });
    if (!res.ok) throw new Error("Couldn't load " + path);
    const buf = new Uint8Array(await res.arrayBuffer());
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, await contentKey(), buf.slice(12));
  }
  async function contentFile(name) {
    if (contentState.urls[name]) return contentState.urls[name];
    const f = contentState.cal.files[name]; if (!f) throw new Error("Missing " + name);
    const p = decryptBlob(f.blob).then((b) => URL.createObjectURL(new Blob([b], { type: f.type })));
    contentState.urls[name] = p; p.catch(() => delete contentState.urls[name]);
    return p;
  }
  async function downloadContent(name, btn) {
    const old = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = "Preparing…"; }
    try { const a = document.createElement("a"); a.href = await contentFile(name); a.download = name; document.body.append(a); a.click(); a.remove(); }
    catch (e) { fail(e); }
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
  const mb = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB");
  const platIcon = (p) => (/TikTok/.test(p) ? "♪" : /Story/.test(p) ? "◎" : /Reel|video/i.test(p) ? "▶" : "▦");

  async function renderContent() {
    app.innerHTML = header({ title: "Content calendar", back: "#/admin", sub: "Instagram + TikTok stills · only you can see this" }) + `<main><p class="hint"><span class="spin"></span><span>Unlocking…</span></p></main>`;
    try {
      await contentKey();
      if (!contentState.cal) contentState.cal = JSON.parse(new TextDecoder().decode(await decryptBlob("calendar.bin")));
      const { data } = await sb.from("content_posted").select("post_id");
      contentState.posted = new Set((data || []).map((r) => r.post_id));
    } catch (e) {
      app.innerHTML = header({ title: "Content calendar", back: "#/admin" }) + `<main><div class="empty"><strong>${e.message === "admins" ? "Admins only" : "Couldn't open the calendar"}</strong>${e.message === "admins" ? "This page is only for Pack's owner." : esc(e.message)}</div></main>`;
      return;
    }
    drawContent();
  }

  function drawContent() {
    const C = contentState.cal, S = C.strategy, td = today();
    const allPosts = C.days.flatMap((d) => d.posts);
    const done = allPosts.filter((p) => contentState.posted.has(p.id)).length;
    const nextDay = C.days.find((d) => d.date >= td) || C.days[0];
    const list = (a) => `<ul class="cc-ul">${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    const weeks = [...new Set(C.days.map((d) => d.week))];
    const dayCard = (d) => {
      const posted = d.posts.filter((p) => contentState.posted.has(p.id)).length;
      return `<details class="card cc-day${d.date === td ? " today" : ""}${posted === d.posts.length ? " done" : ""}" data-day="${d.day}"${d.date === nextDay.date ? " open" : ""}>
        <summary>
          <div class="cc-date"><b>${esc(fmtDate(d.date, { day: "numeric" }))}</b><span>${esc(fmtDate(d.date, { weekday: "short" }))}</span></div>
          <div class="grow"><div class="cc-title">${esc(d.title)}${d.date === td ? ` <span class="badge">Today</span>` : ""}</div>
            <div class="cc-posts">${d.posts.map((p) => `<span class="${contentState.posted.has(p.id) ? "on" : ""}">${platIcon(p.platform)} ${esc(p.platform.replace("Instagram ", "IG "))} · ${esc(p.time)}</span>`).join("")}</div></div>
          <span class="cc-count">${posted}/${d.posts.length}</span>
        </summary>
        <div class="cc-body"></div>
      </details>`;
    };
    $("main", app).innerHTML = `
      <div class="stats">${stat(C.days.length, "days")}${stat(allPosts.length, "posts")}${stat(`${done}/${allPosts.length}`, "posted")}</div>
      <div class="progress cc-prog"><i style="width:${Math.round((done / allPosts.length) * 100)}%"></i></div>
      <div class="card cc-dl">
        <div class="cc-dlh"><b>Download</b><span class="muted">Each week's ZIP has every image and caption, in a folder per day (Instagram feed, TikTok and Stories kept separate).</span></div>
        ${C.downloads.map((x) => `<button class="secondary" data-dl="${esc(x.name)}">⬇ ${esc(x.label)} <small>${mb(C.files[x.name]?.size || 0)}</small></button>`).join("")}
        <div class="cc-dlrow">
          <button class="secondary" data-dl="pack-calendar.ics">📅 Posting times (.ics)</button>
          <button class="secondary" data-dl="pack-calendar.csv">📊 Spreadsheet (.csv)</button>
          <button class="secondary" data-dl="pack-strategy.md">📝 Strategy (.md)</button>
        </div>
        <p class="hint" style="margin:8px 2px 0">Open the .ics to put every posting time in your calendar, with a 15-minute alert and the caption inside.</p>
      </div>
      <div class="seg wide" style="margin:18px 0 6px"><button data-ctab="cal" class="${contentState.tab === "cal" ? "on" : ""}">Calendar</button><button data-ctab="plan" class="${contentState.tab === "plan" ? "on" : ""}">Strategy &amp; best practices</button></div>
      ${contentState.tab === "cal" ? weeks.map((w) => `<h3 class="sec">Week ${w} · ${esc(C.days.find((d) => d.week === w).theme)}</h3>${C.days.filter((d) => d.week === w).map(dayCard).join("")}`).join("") : `
        <div class="card cc-plan">
          <h4>Goal</h4><p>${esc(S.goal)}</p>
          <h4>Who it's for</h4><p>${esc(S.audience)}</p>
          <h4>Positioning</h4><p>${esc(S.positioning)}</p>
          <h4>Content pillars</h4><ul class="cc-ul">${S.pillars.map(([a, b]) => `<li><b>${esc(a)}.</b> ${esc(b)}</li>`).join("")}</ul>
          <h4>When to post</h4>${list(S.times)}
          <h4>Cadence</h4>${list(S.cadence)}
          <h4>Best practices</h4>${list(S.practices)}
          <h4>Measuring</h4>${list(S.measure)}
          <p class="hint">Times are Pacific. If most of your followers are on the East Coast, post at the same clock time Eastern.</p>
        </div>`}`;
    $$("[data-dl]", app).forEach((b) => b.addEventListener("click", () => downloadContent(b.dataset.dl, b)));
    $$("[data-ctab]", app).forEach((b) => b.addEventListener("click", () => { contentState.tab = b.dataset.ctab; drawContent(); }));
    $$(".cc-day", app).forEach((el) => {
      el.addEventListener("toggle", () => { if (el.open) fillDay(el); });
      if (el.open) fillDay(el);
    });
    const t = $(".cc-day[open]", app);
    if (t && contentState.tab === "cal" && !drawContent.scrolled && t !== $(".cc-day", app)) {
      drawContent.scrolled = true;
      setTimeout(() => scrollTo({ top: t.getBoundingClientRect().top + scrollY - ($("header.bar")?.offsetHeight || 0) - 50, behavior: "smooth" }), 50);
    }
  }

  function fillDay(el) {
    const body = $(".cc-body", el); if (body.dataset.filled) return; body.dataset.filled = "1";
    const C = contentState.cal, d = C.days.find((x) => String(x.day) === el.dataset.day);
    const files = [...new Set(d.posts.flatMap((p) => p.assets))];
    const copyBtn = (label, text) => `<button class="tog cc-copy" data-copy="${esc(text)}">${esc(label)}</button>`;
    const media = (list) => `<div class="cc-media">${list.map((f) => `<figure data-f="${esc(f)}"><div class="cc-thumb ${/-ig-/.test(f) ? "feed" : ""}"><span class="spin"></span></div><figcaption>${esc(f)}</figcaption>
        <button class="tog" data-dlf="${esc(f)}">Download</button></figure>`).join("")}</div>`;
    body.innerHTML = `
      ${d.ready ? `<p class="cc-ready">✓ The video is finished and ready to post. Add a trending sound inside the app.</p>` : ""}
      ${d.pain ? `<p class="cc-k"><b>Pain point</b>${esc(d.pain)}</p>` : ""}
      ${d.onscreen?.length ? `<div class="cc-k"><b>On-screen text</b><ol>${d.onscreen.map((t) => `<li>${esc(t)}</li>`).join("")}</ol></div>` : ""}
      ${d.script?.length ? `<div class="cc-k"><b>Script / shot list</b><ul class="cc-ul">${[...d.script, ...(d.extra_script || [])].map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
      ${d.cta ? `<p class="cc-k"><b>Call to action</b>${esc(d.cta)}</p>` : ""}
      ${d.posts.map((p) => `<div class="cc-post">
        <div class="cc-ph"><b>${platIcon(p.platform)} ${esc(p.platform)}</b><span>${esc(p.time)} PT${p.format ? " · " + esc(p.format) : ""}</span>
          <button class="tog ${contentState.posted.has(p.id) ? "on" : ""}" data-posted="${esc(p.id)}">${contentState.posted.has(p.id) ? "✓ Posted" : "Mark posted"}</button></div>
        <p class="cc-why">${esc(p.why)}</p>
        ${p.assets.length ? media(p.assets) : ""}
        ${p.assets.length > 1 ? `<button class="tog cc-all" data-dlall="${esc(p.assets.join("|"))}">Download all ${p.assets.length}</button>` : ""}
        ${p.caption ? `<pre class="cc-cap">${esc(p.caption)}${p.hashtags ? "\n\n" + esc(p.hashtags) : ""}</pre>
        <div class="cc-acts">${copyBtn("Copy caption + tags", p.caption + (p.hashtags ? "\n\n" + p.hashtags : ""))}${p.hashtags ? copyBtn("Copy tags", p.hashtags) : ""}</div>` : ""}
        ${p.alt ? `<p class="cc-k cc-small"><b>Alt text</b>${esc(p.alt)}</p><div class="cc-acts">${copyBtn("Copy alt text", p.alt)}</div>` : ""}
        ${p.note ? `<p class="cc-k cc-small"><b>How to post</b>${esc(p.note)}</p>` : ""}
      </div>`).join("")}`;
    $$("[data-dlall]", body).forEach((b) => b.addEventListener("click", async () => {
      const names = b.dataset.dlall.split("|"), old = b.textContent; b.disabled = true;
      for (let i = 0; i < names.length; i++) { b.textContent = `Saving ${i + 1} of ${names.length}…`; await downloadContent(names[i]); await new Promise((r) => setTimeout(r, 450)); }
      b.disabled = false; b.textContent = old;
    }));
    $$("[data-copy]", body).forEach((b) => b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copied"); } catch { toast("Couldn't copy — select the text and copy it instead"); }
    }));
    $$("[data-dlf]", body).forEach((b) => b.addEventListener("click", () => downloadContent(b.dataset.dlf, b)));
    $$("[data-posted]", body).forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.posted, on = !contentState.posted.has(id); b.disabled = true;
      const { error } = on ? await sb.from("content_posted").insert({ post_id: id }) : await sb.from("content_posted").delete().eq("post_id", id);
      b.disabled = false;
      if (error && !/duplicate/i.test(error.message)) return fail(error);
      on ? contentState.posted.add(id) : contentState.posted.delete(id);
      const open = $$(".cc-day[open]", app).map((x) => x.dataset.day), y = scrollY;
      drawContent(); $$(".cc-day", app).forEach((x) => { if (open.includes(x.dataset.day)) { x.open = true; fillDay(x); } else x.open = false; }); scrollTo(0, y);
    }));
    $$("figure[data-f]", body).forEach(async (fig) => {
      const f = fig.dataset.f, box = $(".cc-thumb", fig);
      try {
        const url = await contentFile(f);
        box.innerHTML = /\.mp4$/.test(f) ? `<video src="${url}" controls playsinline preload="metadata"></video>` : `<img src="${url}" alt="">`;
        const im = $("img", box); if (im) im.addEventListener("click", () => {
          const lb = document.createElement("div"); lb.className = "cc-lb"; lb.innerHTML = `<img src="${url}" alt="">`;
          lb.addEventListener("click", () => lb.remove()); document.body.append(lb);
        });
      } catch { box.innerHTML = `<span class="muted">Couldn't load</span>`; }
    });
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  boot();
})();
