// Pack API (pack.spruceandsound.com)
//
//   GET  /api/config   → public Supabase settings for the app
//   POST /api/weather  → { destination, start, end, units } → forecast or typical weather
//   POST /api/sort     → signed-in only; counts against the daily limit; Claude sorts items
//   POST /api/delete-account → signed-in only; { confirm: "DELETE" } permanently deletes the account
//
// Environment variables (Netlify → Project configuration → Environment variables):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   (Supabase → Project Settings → API)
//   ANTHROPIC_API_KEY
//   PACK_MODEL             optional, default claude-haiku-5-5
//   PACK_DAILY_LIMIT       optional, AI sorts per person per day (default 50, resets at midnight in their time zone)
//   PACK_SITE_DAILY_LIMIT  optional, AI sorts for everyone combined per day (default 1000)

import { buildReminder, sendEmail } from "../lib/reminder-email.mjs";

export const config = {
  path: ["/api/config", "/api/weather", "/api/sort", "/api/test-reminder", "/api/delete-account"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

const env = (k, d = "") => (process.env[k] || d).trim();
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const clip = (s, n) => String(s ?? "").slice(0, n).trim();

// ───────────────────────── weather (Open-Meteo, no key needed) ─────────────────────────

const WMO = (c) =>
  c == null ? "" : c === 0 ? "clear" : c <= 2 ? "partly cloudy" : c === 3 ? "cloudy" : c <= 48 ? "fog" :
  c <= 57 ? "drizzle" : c <= 67 ? "rain" : c <= 77 ? "snow" : c <= 82 ? "showers" : c <= 86 ? "snow showers" : "thunderstorms";

async function geocode(destination) {
  const [name, ...rest] = destination.split(",").map((s) => s.trim()).filter(Boolean);
  if (!name) return null;
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&format=json&name=${encodeURIComponent(name)}`);
  const d = await r.json().catch(() => ({}));
  const results = d.results || [];
  if (!results.length) return null;
  const hint = rest.join(" ").toLowerCase();
  const match = hint
    ? results.find((p) => [p.admin1, p.country, p.country_code, p.admin2].filter(Boolean).some((v) => {
        v = v.toLowerCase(); return hint.includes(v) || v.includes(hint) || (hint.length === 2 && STATE[hint.toUpperCase()]?.toLowerCase() === v);
      }))
    : null;
  const p = match || results[0];
  return { lat: p.latitude, lon: p.longitude, place: [p.name, p.admin1, p.country_code === "US" ? "" : p.country].filter(Boolean).join(", ") };
}

const STATE = { AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia" };

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

async function weather({ destination, start, end, units }) {
  destination = clip(destination, 160);
  if (!destination) return { error: "Add a destination to see the weather." };
  const geo = await geocode(destination);
  if (!geo) return { error: `Couldn't find “${destination}” on the map.` };
  const f = units === "c" ? "" : "&temperature_unit=fahrenheit&precipitation_unit=inch";
  const today = iso(new Date());
  const lastForecastDay = addDays(today, 15);
  start = /^\d{4}-\d{2}-\d{2}$/.test(start || "") ? start : "";
  end = /^\d{4}-\d{2}-\d{2}$/.test(end || "") ? end : start;
  if (start && end < start) end = start;
  if (start && end && addDays(start, 21) < end) end = addDays(start, 21);

  let kind, url;
  if (!start || (start <= lastForecastDay && end >= today)) {
    const s = !start || start < today ? today : start;
    const e = !start ? addDays(today, 6) : end > lastForecastDay ? lastForecastDay : end;
    kind = start ? "forecast" : "next7";
    // Hourly detail for the first two days (temperature, feels like, rain chance, wind).
    const wind = units === "c" ? "&wind_speed_unit=kmh" : "&wind_speed_unit=mph";
    url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,is_day&timezone=auto&start_date=${s}&end_date=${e}${f}${wind}`;
  } else {
    // Too far out (or in the past): use the same dates last year as a guide.
    const back = (s) => `${Number(s.slice(0, 4)) - (s > today ? 1 : 0) - (s > today && addDays(s, -365) > today ? 1 : 0)}${s.slice(4)}`;
    kind = "typical";
    url = `https://archive-api.open-meteo.com/v1/archive?latitude=${geo.lat}&longitude=${geo.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&start_date=${back(start)}&end_date=${back(end)}${f}`;
  }
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.daily) return { error: "Weather isn't available right now." };
  const t = d.daily;
  const days = t.time.map((date, i) => ({
    date: kind === "typical" ? addDays(start, i) : date,
    hi: Math.round(t.temperature_2m_max[i]),
    lo: Math.round(t.temperature_2m_min[i]),
    code: t.weather_code?.[i] ?? null,
    rain: kind === "typical" ? (t.precipitation_sum[i] ?? 0) : (t.precipitation_probability_max[i] ?? 0),
  })).filter((x) => Number.isFinite(x.hi));
  if (!days.length) return { error: "Weather isn't available for those dates." };
  // First 48 hours of the window, starting from this hour if the window starts today.
  let hours = [];
  if (d.hourly?.time) {
    const h = d.hourly;
    const nowLocal = new Date(Date.now() + (d.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 13);
    const from = Math.max(0, h.time.findIndex((x) => x.slice(0, 13) >= nowLocal));
    hours = h.time.slice(from, from + 48).map((time, k) => {
      const i = from + k;
      return { t: time, temp: Math.round(h.temperature_2m[i]), feels: Math.round(h.apparent_temperature[i]), rain: h.precipitation_probability[i] ?? 0,
        code: h.weather_code[i] ?? null, wind: Math.round(h.wind_speed_10m[i] ?? 0), dir: Math.round(h.wind_direction_10m[i] ?? 0), day: h.is_day[i] === 1 };
    }).filter((x) => Number.isFinite(x.temp));
    days.forEach((x, i) => { x.sunrise = d.daily.sunrise?.[i]?.slice(11, 16) || ""; x.sunset = d.daily.sunset?.[i]?.slice(11, 16) || ""; x.wind = Math.round(d.daily.wind_speed_10m_max?.[i] ?? 0); });
  }
  const u = units === "c" ? "°C" : "°F";
  const his = days.map((x) => x.hi), los = days.map((x) => x.lo);
  const wet = kind === "typical" ? days.filter((x) => x.rain > (units === "c" ? 1 : 0.04)).length : days.filter((x) => x.rain >= 50).length;
  const conds = [...new Set(days.map((x) => WMO(x.code)).filter(Boolean))].slice(0, 3).join(", ");
  const summary = `${kind === "typical" ? "Typical for these dates" : "Forecast"}: highs ${Math.min(...his)}–${Math.max(...his)}${u}, lows ${Math.min(...los)}–${Math.max(...los)}${u}; ${wet ? `${wet} of ${days.length} days ${kind === "typical" ? "had" : "likely"} rain` : "mostly dry"}${conds ? ` (${conds})` : ""}.`;
  return { place: geo.place, lat: Math.round(geo.lat * 1000) / 1000, lon: Math.round(geo.lon * 1000) / 1000, kind, units: units === "c" ? "c" : "f",
    days, hours, summary, fetched: new Date().toISOString() };
}

// ───────────────────────── auth & limits ─────────────────────────

async function currentUser(req) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const r = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: env("SUPABASE_ANON_KEY"), authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u?.id ? u : null;
}

// Hands shared trips to the next member, then deletes the auth user (everything else cascades).
async function deleteAccount(req) {
  const user = await currentUser(req);
  if (!user) return json({ error: "Sign in again, then try deleting your account." }, 401);
  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "DELETE") return json({ error: "Type DELETE to confirm." }, 400);
  const key = env("SUPABASE_SERVICE_ROLE_KEY"), base = env("SUPABASE_URL");
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  const prep = await fetch(`${base}/rest/v1/rpc/prepare_account_deletion`, { method: "POST", headers, body: JSON.stringify({ p_user: user.id }) });
  if (!prep.ok) { console.error("prepare_account_deletion", prep.status, await prep.text()); return json({ error: "Couldn't delete your account. Please try again or email hello@spruceandsound.com." }, 500); }
  const del = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE", headers });
  if (!del.ok) { console.error("delete user", del.status, await del.text()); return json({ error: "Couldn't delete your account. Please try again or email hello@spruceandsound.com." }, 500); }
  return json({ ok: true, handedOff: Number(await prep.json().catch(() => 0)) || 0 });
}

async function useSort(userId) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/use_ai_sort`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      p_user: userId,
      p_limit: Number(env("PACK_DAILY_LIMIT", "50")) || 50,
      p_site_limit: Number(env("PACK_SITE_DAILY_LIMIT", "1000")) || 1000,
    }),
  });
  if (!r.ok) throw new Error("Couldn't check today's usage (" + r.status + ")");
  return r.json(); // number, or null when a limit is reached
}

// ───────────────────────── Claude ─────────────────────────

const SORT_TOOL = {
  name: "packing_list",
  description: "Return the organized items.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Clean item name in sentence case, without the quantity" },
            qty: { type: "string", description: "Quantity if given or obvious ('3', '2 pairs'); else empty" },
            note: { type: "string", description: "Only a note the user wrote; else empty" },
            category: { type: "string", description: "Short category, e.g. Documents, Clothes, Toiletries, Tech, Health" },
            bag: { type: "string", description: "One of the listed bags, or empty if no bags were listed" },
            kind: { type: "string", enum: ["clothes", "gear", "essentials"], description: "clothes = anything worn (incl. shoes, accessories); essentials = documents, money, toiletries, meds; gear = everything else (tech, equipment, tools, bags, books)" },
            last: { type: "boolean", description: "true only for things used right up until leaving, packed at the last minute (phone charger, toothbrush, daily meds, glasses, keys, wallet)" },
            purpose: { type: "string", enum: ["personal", "work"], description: "work = needed for the job or work purpose of the trip (e.g. camera kit for a shoot, laptop for a conference); otherwise personal" },
          },
          required: ["name", "category", "kind", "purpose"],
        },
      },
      suggestions: {
        type: "array",
        description: "Up to 6 things this person is likely to forget or need for THIS trip and weather, not already listed",
        items: {
          type: "object",
          properties: { name: { type: "string" }, why: { type: "string", description: "Under 8 words" } },
          required: ["name"],
        },
      },
    },
    required: ["items", "suggestions"],
  },
};

async function sort(req) {
  if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) return json({ error: "The app isn't fully set up yet (Supabase keys)." }, 503);
  if (!env("ANTHROPIC_API_KEY")) return json({ error: "The app isn't fully set up yet (Claude API key)." }, 503);
  const user = await currentUser(req);
  if (!user) return json({ error: "Please sign in again." }, 401);

  const body = await req.json().catch(() => ({}));
  const items = clip(body.items, 4000);
  if (!items) return json({ error: "Add some items first." }, 400);
  const mode = body.mode === "closet" ? "closet" : "trip";
  const t = body.trip || {};
  const bags = (Array.isArray(t.bags) ? t.bags : []).map((b) => clip(b, 40)).filter(Boolean).slice(0, 12);
  const cats = (Array.isArray(body.categories) ? body.categories : []).map((c) => clip(c, 40)).filter(Boolean).slice(0, 30);
  const have = (Array.isArray(body.have) ? body.have : []).map((c) => clip(c, 80)).filter(Boolean).slice(0, 150);

  const used = await useSort(user.id);
  const limit = Number(env("PACK_DAILY_LIMIT", "50")) || 50;
  if (used == null) return json({ error: `You've used all ${limit} smart sorts for today. They reset at midnight.`, limit }, 429);

  const lines = [
    mode === "closet"
      ? "Organize these items for someone's personal inventory (things they own and often pack)."
      : "Organize these items into a packing list.",
    "Split the text into separate items (commas, new lines, 'and'). Fix spelling and capitalization. Merge duplicates.",
    "Move quantities like 'x3' or '3 shirts' into qty. Group into practical categories, documents and essentials first.",
    "Keep every item the person gave — never drop or rename one into something else.",
    "Give every item a kind (clothes, gear or essentials) and a purpose (work or personal). Only mark work when the trip or item clearly involves work.",
    cats.length ? `Reuse these existing categories where they fit: ${cats.join(", ")}.` : "",
    have.length ? `Already on the list (don't repeat these, and don't suggest them): ${have.join(", ")}.` : "",
    mode === "trip" && bags.length ? `Assign every item to one of these bags, choosing sensibly (valuables, meds, chargers, batteries and documents in a carry-on; full-size liquids in a checked bag if there is one): ${bags.join(", ")}.` : "Leave bag empty.",
    mode === "trip" && t.name ? `Trip: ${clip(t.name, 120)}` : "",
    mode === "trip" && t.destination ? `Destination: ${clip(t.destination, 160)}` : "",
    mode === "trip" && t.start ? `Dates: ${clip(t.start, 10)} to ${clip(t.end || t.start, 10)}` : "",
    mode === "trip" && t.details ? `Details: ${clip(t.details, 1000)}` : "",
    mode === "trip" && t.weather ? `Weather: ${clip(t.weather, 400)}` : "",
    mode === "trip" ? "Suggestions should reflect the weather, length and purpose of the trip." : "Return no suggestions.",
    "",
    "Items:",
    items,
  ].filter(Boolean);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env("PACK_MODEL", "claude-haiku-5-5"),
      max_tokens: 3000,
      tools: [SORT_TOOL],
      tool_choice: { type: "tool", name: "packing_list" },
      messages: [{ role: "user", content: lines.join("\n") }],
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("Claude API error", r.status, d?.error?.message); return json({ error: "Smart sorting is busy right now. Try again in a minute." }, 502); }
  const out = (d.content || []).find((b) => b.type === "tool_use")?.input;
  if (!out) return json({ error: "Claude didn't return a list. Try again." }, 502);

  const bagSet = new Set(bags.map((b) => b.toLowerCase()));
  const clean = (out.items || []).map((i) => ({
    name: clip(i.name, 200), qty: clip(i.qty, 40), note: clip(i.note, 200),
    category: clip(i.category, 40) || "Other",
    kind: ["clothes", "gear", "essentials"].includes(i.kind) ? i.kind : "gear",
    purpose: i.purpose === "work" ? "work" : "personal",
    last: i.last === true,
    bag: bagSet.has(String(i.bag || "").toLowerCase()) ? bags.find((b) => b.toLowerCase() === String(i.bag).toLowerCase()) : "",
  })).filter((i) => i.name);
  const sugg = mode === "trip" ? (out.suggestions || []).slice(0, 6).map((s) => ({ name: clip(s.name, 80), why: clip(s.why, 80) })).filter((s) => s.name) : [];
  return json({ items: clean, suggestions: sugg, remaining: Math.max(0, limit - used) });
}

// Admins only: send yourself a sample day-before reminder for your next trip.
async function testReminder(req) {
  const user = await currentUser(req);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const asUser = (path, init = {}) => fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, { ...init, headers: { apikey: env("SUPABASE_ANON_KEY"), authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) } }).then((r) => r.json());
  if ((await asUser("rpc/is_admin", { method: "POST", body: "{}" })) !== true) return json({ error: "Admins only" }, 403);
  if (!env("RESEND_API_KEY")) return json({ error: "Add RESEND_API_KEY in Netlify first." }, 503);
  const trips = await asUser(`trips?select=id,name,destination,start_date,end_date,weather,items(name,packed,pack_last,assigned_to)&order=start_date.asc.nullslast&limit=20`);
  const t = (Array.isArray(trips) ? trips : []).find((x) => !x.start_date || x.start_date >= new Date().toISOString().slice(0, 10)) || (Array.isArray(trips) ? trips[0] : null);
  const items = t?.items || [];
  const r = {
    trip_id: t?.id || "", trip_name: t?.name || "Sample trip", destination: t?.destination || "Big Sur, CA",
    start_date: t?.start_date || new Date(Date.now() + 864e5).toISOString().slice(0, 10), display_name: user.user_metadata?.full_name || "",
    weather_summary: t?.weather?.summary || "", items_total: items.length || 12, items_left: t ? items.filter((i) => !i.packed).length : 5,
    mine_left: items.filter((i) => !i.packed && i.assigned_to === user.id).length,
    pack_last: t ? items.filter((i) => i.pack_last && !i.packed).map((i) => i.name).slice(0, 12) : ["Phone charger", "Toothbrush"],
  };
  const mail = buildReminder(r);
  try { await sendEmail({ to: user.email, ...mail, subject: "[Test] " + mail.subject }); }
  catch (e) { return json({ error: "Couldn't send: " + e.message }, 502); }
  return json({ ok: true, to: user.email });
}

// ───────────────────────── router ─────────────────────────

export default async (req) => {
  const path = new URL(req.url).pathname;
  try {
    if (path === "/api/config" && req.method === "GET") {
      if (!env("SUPABASE_URL") || !env("SUPABASE_ANON_KEY")) return json({ error: "The app isn't set up yet (Supabase keys missing)." }, 503);
      return json({ supabaseUrl: env("SUPABASE_URL"), supabaseAnonKey: env("SUPABASE_ANON_KEY"), dailyLimit: Number(env("PACK_DAILY_LIMIT", "50")) || 50 });
    }
    if (req.method !== "POST") return json({ error: "Not found" }, 404);
    if (path === "/api/weather") {
      if (!(await currentUser(req))) return json({ error: "Please sign in again." }, 401);
      const w = await weather(await req.json().catch(() => ({})));
      return json(w, w.error ? 422 : 200);
    }
    if (path === "/api/sort") return await sort(req);
    if (path === "/api/delete-account" && req.method === "POST") return await deleteAccount(req);
    if (path === "/api/test-reminder") return await testReminder(req);
    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error(err); return json({ error: "Something went wrong. Try again." }, 500);
  }
};
