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
  const COLORS = ["#2F7A5B", "#3E6E8E", "#9A5B2F", "#7A4E8C", "#B0533F", "#4F6B2F", "#2F5E7A"];
  const colorFor = (id) => COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  const initials = (p) => (p?.display_name || p?.email || "?").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
  const avatar = (p, cls = "") => `<span class="av ${cls}" style="background:${colorFor(p?.id)}" title="${esc(p?.display_name || p?.email || "")}">${esc(initials(p))}</span>`;

  const ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
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
      if (!cfg) { app.innerHTML = `<div class="auth"><div class="inner"><img src="/apple-touch-icon.png" alt=""><h1>Pack</h1><p>${esc(e.message || "Can't reach Pack right now.")}</p><a class="go" href="/" style="text-decoration:none">Try again</a></div></div>`; return; }
    }
    if (!window.supabase?.createClient) { await new Promise((r) => setTimeout(r, 400)); }
    if (!window.supabase?.createClient) { app.innerHTML = `<div class="auth"><div class="inner"><h1>Pack</h1><p>Couldn't load. Check your connection.</p><a class="go" href="/" style="text-decoration:none">Try again</a></div></div>`; return; }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    });
    const { data } = await sb.auth.getSession();
    session = data.session;
    sb.auth.onAuthStateChange((_ev, s) => {
      const was = !!session; session = s;
      if (!!s !== was) { me = null; route(); }
    });
    window.addEventListener("hashchange", route);
    window.addEventListener("online", () => { $(".offline")?.remove(); route(); });
    window.addEventListener("offline", () => { if (!$(".offline")) app.insertAdjacentHTML("afterbegin", '<div class="offline">Offline — showing what\'s saved on this device</div>'); });
    route();
  }

  async function loadMe() {
    if (me || !session) return me;
    const { data } = await sb.from("profiles").select("id,email,display_name").eq("id", session.user.id).maybeSingle();
    me = data || { id: session.user.id, email: session.user.email, display_name: "" };
    return me;
  }

  async function api(path, body) {
    const { data } = await sb.auth.getSession();
    const r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(data.session ? { authorization: "Bearer " + data.session.access_token } : {}) },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({ error: "No response from Pack" }));
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
    if (!session) return $(".auth #email, .auth #code") ? undefined : renderSignIn();
    await loadMe().catch(() => {});
    const join = store.get(pendingJoinKey, null);
    if (join) return acceptInvite(join);
    try {
      if (view === "trip" && id && sub === "edit") return await renderTripForm(id);
      if (view === "trip" && id) return await renderTrip(id);
      if (view === "new") return await renderTripForm(null, id);
      if (view === "inventory" || view === "closet") return await renderCloset();
      if (view === "templates") return await renderTemplates();
      if (view === "template" && id) return await renderTemplate(id);
      if (view === "account") return renderAccount();
      return await renderHome();
    } catch (e) { fail(e); }
  }
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

  function tabs(on) {
    const t = (href, name, label) => `<a href="${href}" class="${on === name ? "on" : ""}">${ICON[name]}<span>${label}</span></a>`;
    return `<nav class="tabs">${t("#/", "trips", "Trips")}${t("#/inventory", "closet", "Inventory")}${t("#/templates", "tpl", "Templates")}${t("#/account", "me", "You")}</nav>`;
  }
  const header = ({ title, sub = "", back = "", more = false, progress = null }) => `
    <header class="bar"><div class="bar-row">
      ${back ? `<a class="icon-btn" href="${back}" aria-label="Back">${ICON.back}</a>` : ""}
      <h1>${esc(title)}</h1>
      ${more ? `<button class="icon-btn" id="moreBtn" aria-label="More">${ICON.more}</button>` : ""}
    </div>${sub ? `<div class="sub">${sub}</div>` : ""}${progress != null ? `<div class="progress"><i style="width:${progress}%"></i></div>` : ""}</header>`;

  // ───────────────────────── sign in ─────────────────────────
  function renderSignIn(step = "email", email = store.get("lastEmail", "")) {
    const invite = store.get(pendingJoinKey, null);
    if (step === "email") {
      app.innerHTML = `<section class="auth"><form id="f">
        <img src="/apple-touch-icon.png" alt="">
        <h1>Pack</h1>
        <p>${invite ? "Sign in to join the trip you were invited to." : "Dump everything you're bringing. Pack sorts it into a smart list."}</p>
        <input id="email" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" value="${esc(email)}" required aria-label="Email">
        <button class="go" id="go" type="submit">Email me a sign-in code</button>
        <div class="or">or</div>
        <button class="google" id="google" type="button">${ICON.google}Continue with Google</button>
        <div class="err" id="err" role="alert"></div>
        <div class="fine">New here? Same steps — your account is created automatically.</div>
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
      $("#google").addEventListener("click", async () => {
        const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/" } });
        if (error) $("#err").textContent = error.message;
      });
    } else {
      app.innerHTML = `<section class="auth"><form id="f">
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
      app.innerHTML = `<section class="auth"><div class="inner"><img src="/apple-touch-icon.png" alt="">
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
        `<main class="tabbed">${!trips.length ? `<div class="empty"><strong>No trips yet</strong>Tap “New trip”, dump everything you're bringing, and Pack sorts it — with weather-smart suggestions.</div>` : ""}
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
    $("#start").addEventListener("change", () => { if (!$("#end").value || $("#end").value < $("#start").value) $("#end").value = $("#start").value; });

    $("#f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#save");
      const row = {
        name: $("#name").value.trim(), destination: $("#dest").value.trim() || null,
        start_date: $("#start").value || null, end_date: $("#end").value || $("#start").value || null,
        details: $("#details").value.trim() || null, bags,
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
        go(`#/trip/${created.id}`);
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
  async function sortInto(trip, text, existing, weather, workNames = new Set()) {
    let res;
    try {
      res = await api("/api/sort", {
        items: text, mode: "trip",
        trip: { name: trip.name, destination: trip.destination, start: trip.start_date, end: trip.end_date, details: trip.details, bags: trip.bags, weather: weather?.summary || trip.weather?.summary || "" },
        categories: [...new Set(existing.map((i) => i.category))],
        have: existing.map((i) => i.name),
      });
    } catch (e) {
      const lines = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 200);
      if (lines.length) must(await sb.from("items").insert(lines.map((name, i) => ({ trip_id: trip.id, name: name.slice(0, 200), category: "Unsorted", position: 1000 + i }))));
      toast((e.status === 429 ? e.message : "Couldn't sort right now.") + " Your items were added unsorted.", 5000);
      return;
    }
    const have = new Set(existing.map((i) => key(i.name)));
    const rows = res.items.filter((i) => !have.has(key(i.name)) && (have.add(key(i.name)), true))
      .map((i, n) => ({ trip_id: trip.id, name: i.name, qty: i.qty || "", note: i.note || "", category: i.category || "Other", bag: i.bag || "", kind: i.kind || "gear", purpose: workNames.has(key(i.name)) ? "work" : i.purpose || "personal", position: existing.length + n }));
    if (rows.length) must(await sb.from("items").insert(rows));
    const allNames = new Set([...have, ...rows.map((r) => key(r.name))]);
    const prev = Array.isArray(trip.suggestions) ? trip.suggestions : [];
    const merged = [...res.suggestions, ...prev].filter((s, i, a) => !allNames.has(key(s.name)) && a.findIndex((x) => key(x.name) === key(s.name)) === i).slice(0, 6);
    await sb.from("trips").update({ suggestions: merged }).eq("id", trip.id);
    trip.suggestions = merged;
    if (res.remaining != null && res.remaining <= 3) toast(`${res.remaining} smart sort${res.remaining === 1 ? "" : "s"} left today`);
  }

  // ───────────────────────── one trip ─────────────────────────
  const view = { group: store.get("group", "category"), hide: false, kind: "all", purpose: store.get("purpose", "all"), select: false, picked: new Set() };
  const KINDS = [["clothes", "Clothes"], ["gear", "Gear"], ["essentials", "Essentials"]];
  const kindOf = (i) => i.kind || "gear";
  const purposeOf = (i) => i.purpose || "personal";
  const inInventory = (i) => (T.inventory || []).includes(key(i.name));
  async function addToInventory(list) {
    const fresh = list.filter((i) => !inInventory(i));
    if (!fresh.length) return toast(list.length > 1 ? "Those are all in your inventory already" : "Already in your inventory");
    const { error } = await sb.from("closet_items").insert(fresh.map((i) => ({ name: i.name, qty: i.qty, note: i.note, category: i.category, kind: kindOf(i), purpose: purposeOf(i), owner_id: session.user.id })));
    if (error) return fail(error);
    T.inventory = [...(T.inventory || []), ...fresh.map((i) => key(i.name))]; store.set("trip." + T.trip.id, T);
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
      sb.from("closet_items").select("name").eq("owner_id", session.user.id).then(must),
    ]);
    if (!trip) return null;
    const ids = members.map((m) => m.user_id);
    const profiles = ids.length ? must(await sb.from("profiles").select("id,email,display_name").in("id", ids)) : [];
    return { trip, items, members, profiles, inventory: inv.map((i) => key(i.name)) };
  }

  async function renderTrip(id) {
    const cached = store.get("trip." + id, null);
    if (cached) { T = cached; drawTrip(); }
    const fresh = await fetchTrip(id);
    if (!fresh) { store.set("trip." + id, null); toast("That trip isn't available."); return go("#/"); }
    T = fresh; store.set("trip." + id, T); drawTrip();

    const stale = !T.trip.weather || (Date.now() - new Date(T.trip.weather.fetched || 0) > 6 * 3600e3 && (!T.trip.end_date || T.trip.end_date >= today()));
    if (T.trip.destination && stale) getWeather(T.trip).then(() => { if (T?.trip.id === id) drawTrip(); }).catch(() => {});

    // Live updates from other members
    let h;
    channel = sb.channel("trip-" + id)
      .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `trip_id=eq.${id}` }, () => { clearTimeout(h); h = setTimeout(refresh, 250); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trips", filter: `id=eq.${id}` }, () => { clearTimeout(h); h = setTimeout(refresh, 250); })
      .subscribe();
    async function refresh() {
      if (location.hash !== `#/trip/${id}`) return;
      const f = await fetchTrip(id).catch(() => null);
      if (f) { T = f; store.set("trip." + id, T); drawTrip(); }
    }
  }

  const profileOf = (uid) => T.profiles.find((p) => p.id === uid) || { id: uid, display_name: "Someone" };

  function drawTrip() {
    const { trip, items } = T;
    const p = items.filter((i) => i.packed).length, n = items.length;
    const shared = T.members.length > 1;
    const byBag = view.group === "bag";
    const scrollY = window.scrollY;
    const hasWork = items.some((i) => purposeOf(i) === "work");
    const inPurpose = items.filter((i) => view.purpose === "all" || purposeOf(i) === view.purpose);
    const shown = inPurpose.filter((i) => view.kind === "all" || kindOf(i) === view.kind);

    const groupOf = (i) => byBag ? bagOf(i) : i.category || "Other";
    const groups = new Map();
    const order = byBag ? [...trip.bags, ""] : [];
    for (const i of shown) {
      if (view.hide && i.packed && !view.select) continue;
      const g = groupOf(i);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(i);
    }
    const names = byBag ? order.filter((g) => groups.has(g)) : [...groups.keys()];
    const counts = (g) => { const all = shown.filter((i) => groupOf(i) === g); return `${all.filter((i) => i.packed).length}/${all.length}`; };
    const kindCount = (k) => inPurpose.filter((i) => k === "all" || kindOf(i) === k).length;

    const wx = trip.weather;
    const wxHtml = wx && Array.isArray(wx.days) && wx.days.length ? `<section class="card wx">
        <div class="wx-head"><strong>${esc(wx.place)}</strong><span>${wx.kind === "typical" ? "Typical for your dates" : wx.kind === "next7" ? "Next 7 days" : "Forecast"}</span></div>
        <div class="wx-days">${wx.days.map((d) => `<div class="wx-day"><div class="d">${esc(fmtDate(String(d.date).slice(0, 10), { weekday: "short" }))} ${esc(Number(String(d.date).slice(8, 10)))}</div>
          <div class="i">${WX(Number(d.code))}</div><div class="h">${esc(Number(d.hi))}°</div><div class="l">${esc(Number(d.lo))}°</div>
          <div class="p">${wx.kind === "typical" ? (Number(d.rain) > (wx.units === "c" ? 1 : 0.04) ? "rain" : "") : Number(d.rain) >= 20 ? esc(Number(d.rain)) + "%" : ""}</div></div>`).join("")}</div>
        <div class="wx-sum">${esc(wx.summary)}</div></section>`
      : trip.destination ? "" : `<a class="card wx" style="display:block;text-decoration:none;color:inherit;padding:14px 16px" href="#/trip/${trip.id}/edit"><span class="muted">Add a destination and dates to see the weather and get weather-smart suggestions →</span></a>`;

    const sugg = Array.isArray(trip.suggestions) ? trip.suggestions : [];
    const ownerId = T.members.find((m) => m.role === "owner")?.user_id;

    app.innerHTML = header({
      title: trip.name, back: "#/", more: true, progress: n ? (p / n) * 100 : 0,
      sub: [n ? `${p} of ${n} packed` : "No items yet", dateRange(trip.start_date, trip.end_date), trip.destination].filter(Boolean).map(esc).join(" · "),
    }) + `<main${view.select ? ' style="padding-bottom:calc(var(--safe-b) + 240px)"' : ""}>
      ${wxHtml}
      <div class="members">
        <span class="avs">${T.members.map((m) => avatar(profileOf(m.user_id))).join("")}</span>
        <span class="grow muted" style="font-size:14px">${shared ? `Packing with ${T.members.length - 1} other${T.members.length > 2 ? "s" : ""}` : "Just you"}</span>
        <button class="pill" id="shareBtn">Share</button>
      </div>
      <div class="filters" role="group" aria-label="Show">
        ${[["all", "All"], ...KINDS].map(([k, label]) => `<button class="${view.kind === k ? "on" : ""}" data-kind="${k}">${label} <small>${kindCount(k)}</small></button>`).join("")}
      </div>
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Work or personal">${[["all", "Both"], ["personal", "Personal"], ["work", "Work"]].map(([k, l]) => `<button class="${view.purpose === k ? "on" : ""}" data-purpose="${k}">${l}</button>`).join("")}</div>
        <div class="seg" role="group" aria-label="Group by"><button class="${!byBag ? "on" : ""}" data-group="category">Category</button><button class="${byBag ? "on" : ""}" data-group="bag">Bag</button></div>
      </div>
      <div class="toolbar">
        <button class="pill ${view.hide ? "on" : ""}" id="hideBtn">Hide packed</button><span class="spacer"></span>
        <button class="pill ${view.select ? "on" : ""}" id="selBtn">${view.select ? "Done" : "Select"}</button>
      </div>
      ${byBag && !trip.bags.length ? `<button class="card hintcard" id="addBagHint">No bags on this trip yet. <strong>Add bags →</strong></button>` : ""}
      ${view.purpose === "work" && !hasWork ? `<p class="hint" style="margin:0 4px 14px">Nothing is marked as work yet. Tap Select, choose items, then “Work / Personal”.</p>` : ""}
      ${sugg.length ? `<div class="sugg"><p>You might also want:</p><div class="chips">${sugg.map((s, i) => `<button class="chip dash" data-sug="${i}"><span>+ ${esc(s.name)}</span>${s.why ? `<small>${esc(s.why)}</small>` : ""}</button>`).join("")}</div></div>` : ""}
      <div id="groups" class="${view.select ? "selecting" : ""}">${names.map((g) => `<section class="card cat"><h2>${esc(g || (byBag ? "No bag yet" : "Other"))} <span>${counts(g)}</span></h2>
        ${groups.get(g).map((i) => `<div class="item${i.packed ? " on" : ""}${view.picked.has(i.id) ? " picked" : ""}" data-id="${i.id}">
          ${view.select
            ? `<button class="tick" data-pick="${i.id}" role="checkbox" aria-checked="${view.picked.has(i.id)}" aria-label="Select ${esc(i.name)}"><span class="box round">${ICON.check}</span></button>`
            : `<button class="tick" data-tick="${i.id}" role="checkbox" aria-checked="${i.packed}" aria-label="${esc(i.name)}"><span class="box">${ICON.check}</span></button>`}
          <button class="body" data-${view.select ? "pick" : "edit"}="${i.id}"><span class="grow"><span class="nm">${esc(i.name)}</span>${i.note ? `<span class="note">${esc(i.note)}</span>` : ""}</span>
            ${i.qty ? `<span class="qty">${esc(i.qty)}</span>` : ""}
            ${purposeOf(i) === "work" && view.purpose !== "work" ? `<span class="worktag">Work</span>` : ""}
            ${byBag ? `<span class="cattag">${esc(i.category)}</span>` : ""}
            ${shared && i.packed && i.packed_by && i.packed_by !== session.user.id ? avatar(profileOf(i.packed_by), "by") : ""}
          </button>
          ${!byBag && !view.select ? `<button class="bagtag${i.bag ? "" : " empty"}" data-bag="${i.id}" aria-label="Bag for ${esc(i.name)}">${i.bag ? esc(i.bag) : "+ Bag"}</button>` : ""}
        </div>`).join("")}</section>`).join("") ||
        `<div class="empty"><strong>${n && !shown.length ? "Nothing matches" : n ? "All packed 🎉" : "Nothing here yet"}</strong>${n && !shown.length ? "Try a different filter." : n ? "Turn off “Hide packed” to see everything." : "Type or paste items below and Pack will sort them."}</div>`}</div>
    </main>
    ${view.select
      ? `<div class="add selbar"><div class="selrow"><span class="muted" style="font-size:14px">${view.picked.size ? `${view.picked.size} selected` : "Tap items to select"}</span>
          <button class="pill" id="selAll">${view.picked.size === shown.length && shown.length ? "None" : "All"}</button></div>
        <div class="selrow">
          <button class="selact" data-act="bag" ${view.picked.size ? "" : "disabled"}>Move to bag</button>
          <button class="selact" data-act="kind" ${view.picked.size ? "" : "disabled"}>Type</button>
          <button class="selact" data-act="purpose" ${view.picked.size ? "" : "disabled"}>Work / Personal</button>
        </div>
        <div class="selrow"><button class="selact alt" data-act="inv" ${view.picked.size ? "" : "disabled"}>Add to inventory</button></div></div>`
      : `<div class="add"><form id="addForm"><input class="t" id="addInput" placeholder="Add items… (any format)" autocomplete="off" enterkeyhint="send"><button type="submit" id="addBtn">Add</button></form></div>`}`;
    window.scrollTo(0, scrollY);

    $$("[data-group]").forEach((b) => b.addEventListener("click", () => { view.group = b.dataset.group; store.set("group", view.group); drawTrip(); }));
    $$("[data-kind]").forEach((b) => b.addEventListener("click", () => { view.kind = b.dataset.kind; drawTrip(); }));
    $$("[data-purpose]").forEach((b) => b.addEventListener("click", () => { view.purpose = b.dataset.purpose; store.set("purpose", view.purpose); drawTrip(); }));
    $("#hideBtn").addEventListener("click", () => { view.hide = !view.hide; drawTrip(); });
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
      if (b.dataset.act === "inv") { const list = T.items.filter((i) => view.picked.has(i.id)); view.picked.clear(); view.select = false; drawTrip(); addToInventory(list); }
    }));
    $("#shareBtn").addEventListener("click", shareTrip);
    $("#moreBtn").addEventListener("click", () => tripMenu(ownerId === session.user.id));
    $("#groups").addEventListener("click", async (e) => {
      const pk = e.target.closest("[data-pick]");
      if (pk) { const id = pk.dataset.pick; view.picked.has(id) ? view.picked.delete(id) : view.picked.add(id); drawTrip(); return; }
      const bg = e.target.closest("[data-bag]");
      if (bg) return pickBag([bg.dataset.bag]);
      const t = e.target.closest("[data-tick]");
      if (t) {
        const it = T.items.find((x) => x.id === t.dataset.tick); if (!it) return;
        it.packed = !it.packed; it.packed_by = it.packed ? session.user.id : null;
        if (navigator.vibrate) navigator.vibrate(8);
        drawTrip();
        const { error } = await sb.from("items").update({ packed: it.packed, packed_by: it.packed_by }).eq("id", it.id);
        if (error) { it.packed = !it.packed; drawTrip(); fail(error); } else store.set("trip." + T.trip.id, T);
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
  }

  // Change several items at once (bag, type, work/personal)
  async function patchItems(ids, patch, label) {
    const set = new Set(ids);
    const before = T.items.filter((i) => set.has(i.id)).map((i) => ({ ...i }));
    T.items.forEach((i) => { if (set.has(i.id)) Object.assign(i, patch); });
    view.picked.clear(); view.select = false; drawTrip();
    const { error } = await sb.from("items").update(patch).in("id", ids);
    if (error) { before.forEach((b) => Object.assign(T.items.find((i) => i.id === b.id) || {}, b)); drawTrip(); return fail(error); }
    store.set("trip." + T.trip.id, T);
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
  function pickKind(ids) {
    const one = ids.length === 1 ? T.items.find((i) => i.id === ids[0]) : null;
    choice(`Type for ${one ? one.name : ids.length + " items"}`, KINDS, one ? kindOf(one) : null, (v) => patchItems(ids, { kind: v }, `set to ${v}`));
  }
  function pickPurpose(ids) {
    const one = ids.length === 1 ? T.items.find((i) => i.id === ids[0]) : null;
    choice(`${one ? one.name : ids.length + " items"}: work or personal?`, [["personal", "Personal"], ["work", "Work"]], one ? purposeOf(one) : null, (v) => patchItems(ids, { purpose: v }, `marked ${v}`));
  }

  async function addText(text) {
    const btn = $("#addBtn"); busy(btn, true);
    try {
      await sortInto(T.trip, text, T.items, null);
      const f = await fetchTrip(T.trip.id); if (f) { T = f; store.set("trip." + T.trip.id, T); }
      drawTrip(); return true;
    } catch (e) { busy(btn, false); fail(e); return false; }
  }

  function editItem(it) {
    if (!it) return;
    const cats = [...new Set(T.items.map((i) => i.category))];
    openSheet(`<h2>Edit item</h2><form id="ef">
      <label class="f" for="en">Item</label><input class="t" id="en" value="${esc(it.name)}" required maxlength="200">
      <div class="row2"><div><label class="f" for="eq">Qty</label><input class="t" id="eq" value="${esc(it.qty)}" maxlength="40"></div>
      <div><label class="f" for="ec">Category</label><input class="t" id="ec" value="${esc(it.category)}" list="cats" maxlength="40"><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div></div>
      <label class="f">Type</label><div class="seg wide" id="ek">${KINDS.map(([k, l]) => `<button type="button" data-k="${k}" class="${kindOf(it) === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <label class="f">For</label><div class="seg wide" id="ep">${[["personal", "Personal"], ["work", "Work"]].map(([k, l]) => `<button type="button" data-k="${k}" class="${purposeOf(it) === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <label class="f" for="eb">Bag</label><select class="t" id="eb"><option value="">No bag</option>${T.trip.bags.map((b) => `<option${key(b) === key(it.bag) ? " selected" : ""}>${esc(b)}</option>`).join("")}<option value="__new">+ New bag…</option></select>
      <label class="f" for="eo">Note</label><input class="t" id="eo" value="${esc(it.note)}" maxlength="200">
      <button class="primary" type="submit">Save</button>
      ${inInventory(it) ? `<p class="hint" style="text-align:center;margin-top:12px">✓ In your inventory</p>` : `<button class="secondary" type="button" id="toCloset">Add to inventory</button>`}
      <button class="danger-btn" type="button" id="del">Remove from list</button></form>`);
    for (const id of ["#ek", "#ep"]) $(id).addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]"); if (!b) return;
      $$("button", $(id)).forEach((x) => x.classList.toggle("on", x === b));
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
        bag: $("#eb").value === "__new" ? it.bag : $("#eb").value, kind: $("#ek .on")?.dataset.k || kindOf(it), purpose: $("#ep .on")?.dataset.k || purposeOf(it) };
      closeSheet(); Object.assign(it, patch); drawTrip();
      const { error } = await sb.from("items").update(patch).eq("id", it.id); if (error) fail(error);
    });
    $("#del").addEventListener("click", async () => {
      closeSheet(); T.items = T.items.filter((x) => x !== it); drawTrip();
      const { error } = await sb.from("items").delete().eq("id", it.id); if (error) fail(error);
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
      T.members = T.members.filter((m) => m.user_id !== b.dataset.rm); closeSheet(); drawTrip(); toast("Removed");
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
          toast("Checking the weather…"); await getWeather(T.trip); drawTrip();
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
          T.items.forEach((i) => { i.packed = false; i.packed_by = null; }); drawTrip();
          must(await sb.from("items").update({ packed: false, packed_by: null }).eq("trip_id", id));
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

  // ───────────────────────── closet ─────────────────────────
  let closetTab = store.get("closetTab", "personal");
  async function renderCloset() {
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
  function renderAccount() {
    app.innerHTML = header({ title: "You" }) + `<main class="tabbed">
      <div class="card" style="padding:16px;display:flex;gap:14px;align-items:center">${avatar(me)}<div class="grow"><strong>${esc(me?.display_name || "")}</strong><div class="muted" style="font-size:14px">${esc(me?.email || session.user.email || "")}</div></div></div>
      <form id="nf"><label class="f" for="dn">Your name <small>(shown to people you pack with)</small></label>
        <input class="t" id="dn" value="${esc(me?.display_name || "")}" maxlength="60">
        <button class="secondary" type="submit">Save name</button></form>
      <h3 class="sec">Smart sorting</h3>
      <p class="hint" style="margin:0 4px">Each person gets ${cfg.dailyLimit || 25} smart sorts a day. Checking things off, editing and sharing never count.</p>
      <h3 class="sec">On your iPhone or iPad</h3>
      <p class="hint" style="margin:0 4px">In Safari, tap Share → <strong>Add to Home Screen</strong> to use Pack like an app.</p>
      <button class="secondary" id="out" style="margin-top:28px">Sign out</button>
    </main>${tabs("me")}`;
    $("#nf").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("#dn").value.trim().slice(0, 60);
      const { error } = await sb.from("profiles").update({ display_name: name }).eq("id", session.user.id);
      if (error) return fail(error);
      me.display_name = name; toast("Saved"); renderAccount();
    });
    $("#out").addEventListener("click", async () => {
      for (const k of Object.keys(localStorage)) if (k.startsWith("pack2.") && k !== "pack2.cfg" && k !== "pack2.lastEmail") localStorage.removeItem(k);
      history.replaceState(null, "", "#/");
      await sb.auth.signOut();
    });
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  boot();
})();
