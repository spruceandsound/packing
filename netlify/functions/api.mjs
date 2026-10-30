// Pack API (pack.spruceandsound.com)
//
//   GET  /api/config   → public Supabase settings for the app
//   POST /api/weather  → { destination, start, end, units } → forecast or typical weather
//   POST /api/sort     → signed-in only; counts against the daily limit; Claude sorts items
//
// Environment variables (Netlify → Project configuration → Environment variables):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   (Supabase → Project Settings → API)
//   ANTHROPIC_API_KEY
//   PACK_MODEL             optional, default claude-haiku-5-5
//   PACK_DAILY_LIMIT       optional, AI sorts per person per day (default 25)
//   PACK_SITE_DAILY_LIMIT  optional, AI sorts for everyone combined per day (default 1000)

export const config = {
  path: ["/api/config", "/api/weather", "/api/sort"],
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
    url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${s}&end_date=${e}${f}`;
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
  const u = units === "c" ? "°C" : "°F";
  const his = days.map((x) => x.hi), los = days.map((x) => x.lo);
  const wet = kind === "typical" ? days.filter((x) => x.rain > (units === "c" ? 1 : 0.04)).length : days.filter((x) => x.rain >= 50).length;
  const conds = [...new Set(days.map((x) => WMO(x.code)).filter(Boolean))].slice(0, 3).join(", ");
  const summary = `${kind === "typical" ? "Typical for these dates" : "Forecast"}: highs ${Math.min(...his)}–${Math.max(...his)}${u}, lows ${Math.min(...los)}–${Math.max(...los)}${u}; ${wet ? `${wet} of ${days.length} days ${kind === "typical" ? "had" : "likely"} rain` : "mostly dry"}${conds ? ` (${conds})` : ""}.`;
  return { place: geo.place, kind, units: units === "c" ? "c" : "f", days, summary, fetched: new Date().toISOString() };
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

async function useSort(userId) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/use_ai_sort`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      p_user: userId,
      p_limit: Number(env("PACK_DAILY_LIMIT", "25")) || 25,
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
          },
          required: ["name", "category"],
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
  const limit = Number(env("PACK_DAILY_LIMIT", "25")) || 25;
  if (used == null) return json({ error: `You've used all ${limit} smart sorts for today.`, limit }, 429);

  const lines = [
    mode === "closet"
      ? "Organize these items for someone's personal gear closet (things they own and often pack)."
      : "Organize these items into a packing list.",
    "Split the text into separate items (commas, new lines, 'and'). Fix spelling and capitalization. Merge duplicates.",
    "Move quantities like 'x3' or '3 shirts' into qty. Group into practical categories, documents and essentials first.",
    "Keep every item the person gave — never drop or rename one into something else.",
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
    bag: bagSet.has(String(i.bag || "").toLowerCase()) ? bags.find((b) => b.toLowerCase() === String(i.bag).toLowerCase()) : "",
  })).filter((i) => i.name);
  const sugg = mode === "trip" ? (out.suggestions || []).slice(0, 6).map((s) => ({ name: clip(s.name, 80), why: clip(s.why, 80) })).filter((s) => s.name) : [];
  return json({ items: clean, suggestions: sugg, remaining: Math.max(0, limit - used) });
}

// ───────────────────────── router ─────────────────────────

export default async (req) => {
  const path = new URL(req.url).pathname;
  try {
    if (path === "/api/config" && req.method === "GET") {
      if (!env("SUPABASE_URL") || !env("SUPABASE_ANON_KEY")) return json({ error: "The app isn't set up yet (Supabase keys missing)." }, 503);
      return json({ supabaseUrl: env("SUPABASE_URL"), supabaseAnonKey: env("SUPABASE_ANON_KEY"), dailyLimit: Number(env("PACK_DAILY_LIMIT", "25")) || 25 });
    }
    if (req.method !== "POST") return json({ error: "Not found" }, 404);
    if (path === "/api/weather") {
      if (!(await currentUser(req))) return json({ error: "Please sign in again." }, 401);
      const w = await weather(await req.json().catch(() => ({})));
      return json(w, w.error ? 422 : 200);
    }
    if (path === "/api/sort") return await sort(req);
    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error(err); return json({ error: "Something went wrong. Try again." }, 500);
  }
};
