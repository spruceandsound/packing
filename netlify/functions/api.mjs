// Pack API (pack.spruceandsound.com)
//
//   GET  /api/config   → public Supabase settings for the app
//   POST /api/weather  → { destination, start, end, units } → forecast or typical weather
//   POST /api/sort     → signed-in only; counts against the daily limit; Claude sorts items
//   POST /api/delete-account → signed-in only; { confirm: "DELETE" } permanently deletes the account
//   POST /api/trip-import    → signed-in; { text | image, trip, people } → flights and stays read from a pasted
//                              confirmation or screenshot (counts as one smart sort; nothing pasted is stored)
//   POST /api/flight-status  → signed-in trip members; { id } → live status for a saved flight (needs AERODATABOX_KEY)
//
//   AERODATABOX_KEY        optional, RapidAPI key for AeroDataBox (live flight status). Without it, flights show
//                          what people typed in plus a link to FlightAware.
//
// Environment variables (Netlify → Project configuration → Environment variables):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   (Supabase → Project Settings → API)
//   ANTHROPIC_API_KEY
//   PACK_MODEL             optional, default claude-haiku-5-5
//   PACK_DAILY_LIMIT       optional, AI sorts per person per day (default 50, resets at midnight in their time zone)
//   PACK_SITE_DAILY_LIMIT  optional, AI sorts for everyone combined per day (default 1000)

import { buildReminder, sendEmail } from "../lib/reminder-email.mjs";

export const config = {
  path: ["/api/config", "/api/weather", "/api/sort", "/api/test-reminder", "/api/delete-account", "/api/flight-status", "/api/trip-import"],
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

  // "today" here is the UTC date, which can be a day ahead of (or behind) the destination's own date,
  // so ask for a day either side and trim to the destination's local today once we know its offset.
  const yesterday = addDays(today, -1);
  let kind, url, winStart, winEnd;
  if (!start || (start <= lastForecastDay && end >= yesterday)) {
    const s = !start || start < yesterday ? yesterday : start;
    const e = !start ? addDays(today, 6) : end > lastForecastDay ? lastForecastDay : end;
    winStart = start || yesterday; winEnd = !start ? addDays(today, 7) : e;
    // Hourly detail runs 48 hours from now (mid-trip) or from the start of the trip, even past its last day.
    const hourFrom = s > today ? s : today;
    const want = e > addDays(hourFrom, 2) ? e : addDays(hourFrom, 2);
    const eReq = want > lastForecastDay ? lastForecastDay : want;
    kind = start ? "forecast" : "next7";
    // Hourly detail for the first two days (temperature, feels like, rain chance, wind).
    const wind = units === "c" ? "&wind_speed_unit=kmh" : "&wind_speed_unit=mph";
    url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,is_day&timezone=auto&start_date=${s}&end_date=${eReq}${f}${wind}`;
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
  const offset = d.utc_offset_seconds || 0;
  const nowLocal = new Date(Date.now() + offset * 1000).toISOString().slice(0, 13); // "YYYY-MM-DDTHH" at the destination
  const localToday = nowLocal.slice(0, 10);
  let days = t.time.map((date, i) => ({
    date: kind === "typical" ? addDays(start, i) : date,
    hi: Math.round(t.temperature_2m_max[i]),
    lo: Math.round(t.temperature_2m_min[i]),
    code: t.weather_code?.[i] ?? null,
    rain: kind === "typical" ? (t.precipitation_sum[i] ?? 0) : (t.precipitation_probability_max[i] ?? 0),
    ...(kind === "typical" ? {} : { sunrise: t.sunrise?.[i]?.slice(11, 16) || "", sunset: t.sunset?.[i]?.slice(11, 16) || "", wind: Math.round(t.wind_speed_10m_max?.[i] ?? 0) }),
  })).filter((x) => Number.isFinite(x.hi));
  // Forecasts show the trip's days from the destination's today on (or the next 7 days when there are no dates).
  if (kind !== "typical") days = days.filter((x) => x.date >= localToday && x.date >= winStart && x.date <= winEnd).slice(0, kind === "next7" ? 7 : 22);
  if (!days.length) return { error: "Weather isn't available for those dates." };
  // 48 hours: from this hour if the trip has started (or has no dates), otherwise from the start of the first day.
  let hours = [];
  if (d.hourly?.time) {
    const h = d.hourly;
    const firstHour = start && start + "T00" > nowLocal ? start + "T00" : nowLocal;
    const from = Math.max(0, h.time.findIndex((x) => x.slice(0, 13) >= firstHour));
    hours = h.time.slice(from, from + 48).map((time, k) => {
      const i = from + k;
      return { t: time, temp: Math.round(h.temperature_2m[i]), feels: Math.round(h.apparent_temperature[i]), rain: h.precipitation_probability[i] ?? 0,
        code: h.weather_code[i] ?? null, wind: Math.round(h.wind_speed_10m[i] ?? 0), dir: Math.round(h.wind_direction_10m[i] ?? 0), day: h.is_day[i] === 1 };
    }).filter((x) => Number.isFinite(x.temp));
  }
  const u = units === "c" ? "°C" : "°F";
  const his = days.map((x) => x.hi), los = days.map((x) => x.lo);
  const wet = kind === "typical" ? days.filter((x) => x.rain > (units === "c" ? 1 : 0.04)).length : days.filter((x) => x.rain >= 50).length;
  const conds = [...new Set(days.map((x) => WMO(x.code)).filter(Boolean))].slice(0, 3).join(", ");
  const summary = `${kind === "typical" ? "Typical for these dates" : "Forecast"}: highs ${Math.min(...his)}–${Math.max(...his)}${u}, lows ${Math.min(...los)}–${Math.max(...los)}${u}; ${wet ? `${wet} of ${days.length} days ${kind === "typical" ? "had" : "likely"} rain` : "mostly dry"}${conds ? ` (${conds})` : ""}.`;
  return { place: geo.place, lat: Math.round(geo.lat * 1000) / 1000, lon: Math.round(geo.lon * 1000) / 1000, kind, units: units === "c" ? "c" : "f",
    days, hours, summary, offset, fetched: new Date().toISOString() };
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

// ───────────────────────── read a confirmation (flights + stays) ─────────────────────────

const IMPORT_TOOL = {
  name: "travel_details",
  description: "Flights and places to stay found in a travel confirmation, itinerary or booking.",
  input_schema: {
    type: "object",
    properties: {
      flights: { type: "array", items: { type: "object", properties: {
        flight_no: { type: "string", description: "Airline IATA code and number, e.g. 'AS 1234'. Marketing carrier as printed." },
        date: { type: "string", description: "Departure date YYYY-MM-DD (local to the departure airport)." },
        dep_airport: { type: "string", description: "3-letter IATA code of departure airport." },
        arr_airport: { type: "string", description: "3-letter IATA code of arrival airport." },
        dep_time: { type: "string", description: "Local departure time HH:MM, 24-hour. Empty if not shown." },
        arr_time: { type: "string", description: "Local arrival time HH:MM, 24-hour. Empty if not shown." },
        direction: { type: "string", enum: ["out", "back", "other"], description: "out = toward the trip destination, back = heading home, other = in between." },
        passengers: { type: "array", items: { type: "string" }, description: "Passenger first names as printed (first names only)." },
      }, required: ["flight_no", "date"] } },
      stays: { type: "array", items: { type: "object", properties: {
        name: { type: "string", description: "Hotel, rental or campsite name." },
        address: { type: "string", description: "Street address as printed, or empty." },
        check_in_date: { type: "string", description: "YYYY-MM-DD or empty." },
        check_in_time: { type: "string", description: "HH:MM 24-hour or empty." },
        check_out_date: { type: "string", description: "YYYY-MM-DD or empty." },
        check_out_time: { type: "string", description: "HH:MM 24-hour or empty." },
      }, required: ["name"] } },
    },
    required: ["flights", "stays"],
  },
};
const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
const hm = (v) => { const m = String(v || "").match(/^(\d{1,2}):(\d{2})/); return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : ""; };
const iataOk = (v) => (/^[A-Z]{3}$/.test(String(v || "").toUpperCase().trim()) ? String(v).toUpperCase().trim() : "");

async function tripImport(req) {
  if (!env("ANTHROPIC_API_KEY")) return json({ error: "The app isn't fully set up yet (Claude API key)." }, 503);
  const user = await currentUser(req);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const body = await req.json().catch(() => ({}));
  const text = clip(body.text, 20000);
  const img = typeof body.image === "string" ? body.image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!text && !img) return json({ error: "Paste a confirmation or add a screenshot." }, 400);
  if (img && img[2].length > 5_000_000) return json({ error: "That image is too large. Try a smaller screenshot." }, 413);
  const used = await useSort(user.id);
  const limit = Number(env("PACK_DAILY_LIMIT", "50")) || 50;
  if (used == null) return json({ error: `You've used all ${limit} smart sorts for today. They reset at midnight.` }, 429);

  const t = body.trip || {};
  const people = (Array.isArray(body.people) ? body.people : []).map((x) => clip(x, 40)).filter(Boolean).slice(0, 20);
  const intro = [
    "Read this travel confirmation and pull out every flight segment and every place to stay.",
    "Only include what's actually in it. Use the airport's local times as printed. Ignore prices, seat maps, ads and fine print.",
    "Don't include confirmation codes, ticket numbers, loyalty numbers, payment details or anything else personal beyond passenger first names.",
    t.destination ? `The trip is to ${clip(t.destination, 160)}${t.start ? `, ${clip(t.start, 10)} to ${clip(t.end || t.start, 10)}` : ""}. Use that to decide out vs back.` : "",
    t.start ? `If a date has no year, assume the year that fits ${clip(t.start, 10)}.` : `Today is ${iso(new Date())}; if a date has no year, assume the next one.`,
    people.length ? `People on the trip: ${people.join(", ")}.` : "",
  ].filter(Boolean).join("\n");
  const content = img
    ? [{ type: "image", source: { type: "base64", media_type: img[1], data: img[2] } }, { type: "text", text: intro + (text ? "\n\nAlso pasted:\n" + text : "") }]
    : [{ type: "text", text: intro + "\n\nConfirmation:\n" + text }];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env("PACK_MODEL", "claude-haiku-5-5"), max_tokens: 2000, tools: [IMPORT_TOOL], tool_choice: { type: "tool", name: "travel_details" }, messages: [{ role: "user", content }] }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("Claude API error (import)", r.status, d?.error?.message); return json({ error: "Couldn't read that right now. Try again in a minute." }, 502); }
  const out = (d.content || []).find((b) => b.type === "tool_use")?.input || {};
  const flights = (out.flights || []).slice(0, 20).map((f) => ({
    flight_no: clip(String(f.flight_no || "").toUpperCase().replace(/\s+/g, " ").replace(/^([A-Z0-9]{2})(\d)/, "$1 $2"), 12),
    date: ymd(f.date), dep_airport: iataOk(f.dep_airport), arr_airport: iataOk(f.arr_airport), dep_time: hm(f.dep_time), arr_time: hm(f.arr_time),
    direction: ["out", "back", "other"].includes(f.direction) ? f.direction : "other",
    passengers: (Array.isArray(f.passengers) ? f.passengers : []).map((x) => clip(x, 40)).filter(Boolean).slice(0, 12),
  })).filter((f) => /^[A-Z0-9]{2,3} ?\d{1,5}[A-Z]?$/.test(f.flight_no) && f.date);
  const stays = (out.stays || []).slice(0, 10).map((x) => ({
    name: clip(x.name, 120), address: clip(x.address, 300), check_in_date: ymd(x.check_in_date), check_in_time: hm(x.check_in_time),
    check_out_date: ymd(x.check_out_date), check_out_time: hm(x.check_out_time),
  })).filter((x) => x.name);
  return json({ flights, stays, remaining: Math.max(0, limit - used) });
}

// ───────────────────────── flights (AeroDataBox via RapidAPI) ─────────────────────────

const minutesBetween = (a, b) => (a && b ? Math.round((Date.parse(b.replace(" ", "T")) - Date.parse(a.replace(" ", "T"))) / 60000) : 0);
const localHM = (t) => (t?.local ? String(t.local).slice(0, 16) : "");
function shapeFlight(f) {
  const side = (x, arr) => {
    const sched = x?.scheduledTime, est = x?.revisedTime || x?.predictedTime || x?.runwayTime;
    return {
      iata: x?.airport?.iata || "", city: x?.airport?.municipalityName || x?.airport?.shortName || x?.airport?.name || "",
      sched: localHM(sched), est: localHM(est), late: est && sched ? minutesBetween(sched.utc, est.utc) : 0,
      terminal: x?.terminal || "", gate: x?.gate || "", ...(arr ? { belt: x?.baggageBelt || "" } : {}),
    };
  };
  return { state: f.status || "Unknown", number: f.number || "", airline: f.airline?.name || "", aircraft: f.aircraft?.model || "",
    dep: side(f.departure, false), arr: side(f.arrival, true), updated: f.lastUpdatedUtc || "" };
}

// Live status for one saved flight. The person must be on the trip (checked by reading the row as them).
async function flightStatus(req) {
  const user = await currentUser(req);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const { id } = await req.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) return json({ error: "Missing flight." }, 400);
  const base = env("SUPABASE_URL");
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const rr = await fetch(`${base}/rest/v1/trip_flights?id=eq.${id}&select=*`, { headers: { apikey: env("SUPABASE_ANON_KEY"), authorization: `Bearer ${token}` } });
  const row = (await rr.json().catch(() => []))?.[0];
  if (!row) return json({ error: "That flight isn't on one of your trips." }, 404);
  const key = env("AERODATABOX_KEY");
  if (!key) return json({ configured: false, status: row.status || null });

  // Re-check every 10 minutes around travel day, otherwise twice a day; nothing for flights long past.
  const today = iso(new Date());
  if (row.flight_date < addDays(today, -1)) return json({ configured: true, status: row.status || null });
  const near = row.flight_date <= addDays(today, 1);
  const ttl = (near ? 10 : 12 * 60) * 60000;
  if (row.status_at && Date.now() - Date.parse(row.status_at) < ttl) return json({ configured: true, status: row.status, cached: true });

  const num = row.flight_no.replace(/\s+/g, "").toUpperCase();
  const r = await fetch(`https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(num)}/${row.flight_date}?withAircraftImage=false&withLocation=false`, {
    headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" },
  });
  if (r.status === 204 || r.status === 404) return json({ configured: true, status: null, notFound: true });
  if (!r.ok) { console.error("aerodatabox", r.status, (await r.text()).slice(0, 200)); return json({ configured: true, status: row.status || null, error: "Flight status isn't available right now." }); }
  const list = await r.json().catch(() => []);
  const legs = Array.isArray(list) ? list : [list];
  const want = (row.dep_airport || "").trim().toUpperCase();
  const leg = legs.find((f) => want && f?.departure?.airport?.iata === want) || legs[0];
  if (!leg) return json({ configured: true, status: null, notFound: true });
  const status = shapeFlight(leg);

  // Save for everyone on the trip, and fill in airports and times nobody typed in.
  const svc = env("SUPABASE_SERVICE_ROLE_KEY");
  const patch = { status, status_at: new Date().toISOString() };
  if (!row.dep_airport && status.dep.iata) patch.dep_airport = status.dep.iata;
  if (!row.arr_airport && status.arr.iata) patch.arr_airport = status.arr.iata;
  if (!row.dep_time && status.dep.sched) patch.dep_time = status.dep.sched.slice(11, 16);
  if (!row.arr_time && status.arr.sched) patch.arr_time = status.arr.sched.slice(11, 16);
  await fetch(`${base}/rest/v1/trip_flights?id=eq.${id}`, {
    method: "PATCH", headers: { apikey: svc, authorization: `Bearer ${svc}`, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify(patch),
  }).catch((e) => console.error("save flight status", e));
  return json({ configured: true, status, filled: patch });
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
  if (t?.id) {
    const [fl, st] = await Promise.all([asUser(`trip_flights?trip_id=eq.${t.id}&user_id=eq.${user.id}&select=flight_no,dep_airport,arr_airport,dep_time,arr_time,flight_date&order=flight_date,dep_time&limit=2`), asUser(`trip_stays?trip_id=eq.${t.id}&select=name,address,check_in_time&order=check_in_date.asc.nullslast&limit=1`)]);
    r.flights = Array.isArray(fl) ? fl : []; r.stays = Array.isArray(st) ? st : [];
  }
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
      return json({ supabaseUrl: env("SUPABASE_URL"), supabaseAnonKey: env("SUPABASE_ANON_KEY"), dailyLimit: Number(env("PACK_DAILY_LIMIT", "50")) || 50, flights: !!env("AERODATABOX_KEY") });
    }
    if (req.method !== "POST") return json({ error: "Not found" }, 404);
    if (path === "/api/weather") {
      if (!(await currentUser(req))) return json({ error: "Please sign in again." }, 401);
      const w = await weather(await req.json().catch(() => ({})));
      return json(w, w.error ? 422 : 200);
    }
    if (path === "/api/sort") return await sort(req);
    if (path === "/api/delete-account" && req.method === "POST") return await deleteAccount(req);
    if (path === "/api/flight-status") return await flightStatus(req);
    if (path === "/api/trip-import") return await tripImport(req);
    if (path === "/api/test-reminder") return await testReminder(req);
    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error(err); return json({ error: "Something went wrong. Try again." }, 500);
  }
};
