// Builds the day-before trip reminder email (HTML + plain text) and sends it through Resend.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SITE = "https://pack.spruceandsound.com";

function longDate(d) {
  if (!d) return "";
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

const clock = (hm) => { if (!hm) return ""; const [h, m] = hm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`; };
const minus = (hm, mins) => { const [h, m] = hm.split(":").map(Number); const t = ((h * 60 + m - mins) % 1440 + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
// Flights tomorrow, with a "be at the airport by" time (2 hours before departure).
function flightLines(r) {
  return (r.flights || []).map((f) => {
    const route = [f.dep_airport, f.arr_airport].filter(Boolean).join(" → ");
    const times = f.dep_time ? `departs ${clock(f.dep_time)}${f.arr_time ? `, lands ${clock(f.arr_time)}` : ""}` : "";
    return { head: `${f.flight_no}${route ? " · " + route : ""}`, times, by: f.dep_time ? clock(minus(f.dep_time, 120)) : "" };
  });
}

export function buildReminder(r) {
  const fl = flightLines(r);
  const stay = (r.stays || [])[0];
  const first = (r.display_name || "").trim().split(/\s+/)[0];
  const left = Number(r.items_left || 0), total = Number(r.items_total || 0), mine = Number(r.mine_left || 0);
  const last = (r.pack_last || []).filter(Boolean);
  const url = `${SITE}/#/trip/${r.trip_id}/pack`;
  const where = r.destination ? ` to ${r.destination}` : "";
  const subject = left
    ? `Tomorrow: ${r.trip_name} · ${left} item${left === 1 ? "" : "s"} left to pack`
    : `Tomorrow: ${r.trip_name} · you're all packed`;
  const status = !total ? "Your list is empty. Add what you're bringing tonight."
    : left ? `${left} of ${total} item${total === 1 ? "" : "s"} still to pack${mine ? ` (${mine} ${mine === 1 ? "is" : "are"} yours to bring)` : ""}.`
    : `Everything on your list is packed.`;

  const text = [
    `Hi${first ? " " + first : ""},`,
    "",
    `Your trip${where} starts tomorrow, ${longDate(r.start_date)}.`,
    "",
    status,
    last.length ? `\nPack last (grab these on your way out):\n${last.map((n) => "- " + n).join("\n")}` : "",
    fl.length ? `\nYour flight${fl.length > 1 ? "s" : ""}:\n${fl.map((f) => `- ${f.head}${f.times ? ", " + f.times : ""}${f.by ? `. Be at the airport by ${f.by} (2 hours before; 3 for international).` : ""}`).join("\n")}` : "",
    stay ? `\nStaying at: ${stay.name}${stay.address ? ", " + stay.address : ""}${stay.check_in_time ? ` (check-in ${clock(stay.check_in_time)})` : ""}` : "",
    r.weather_summary ? `\nWeather: ${r.weather_summary}` : "",
    "",
    `Open your list: ${url}`,
    "",
    "You're getting this because trip reminders are on. Turn them off in Pack → You: https://pack.spruceandsound.com/#/account",
    "Pack by Spruce & Sound · 203 Riverwalk Dr, Lynden, WA 98264 · Privacy: https://pack.spruceandsound.com/privacy",
  ].filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n");

  const html = `<!doctype html><html><body style="margin:0;background:#F6F1E7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1E2622">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F1E7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFDF8;border:1px solid #E0D8C8;border-radius:16px;overflow:hidden">
<tr><td style="background:#1F3D34;padding:22px 24px;color:#F4ECDC">
  <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#E8A84C;font-weight:700">Tomorrow</div>
  <div style="font-size:24px;font-weight:800;margin-top:4px">${esc(r.trip_name)}</div>
  <div style="font-size:14px;color:#B9C7BE;margin-top:4px">${esc(longDate(r.start_date))}${r.destination ? " · " + esc(r.destination) : ""}</div>
</td></tr>
<tr><td style="padding:22px 24px;font-size:16px;line-height:1.5">
  <p style="margin:0 0 14px">Hi${first ? " " + esc(first) : ""},</p>
  <p style="margin:0 0 14px">${esc(status)}</p>
  ${total ? `<div style="height:8px;background:#EDE6D8;border-radius:99px;overflow:hidden;margin:0 0 18px"><div style="height:8px;width:${Math.round(((total - left) / total) * 100)}%;background:#E8A84C"></div></div>` : ""}
  ${last.length ? `<p style="margin:0 0 6px;font-weight:700">Pack last</p><p style="margin:0 0 6px;color:#66706A;font-size:14px">Grab these on your way out:</p>
    <ul style="margin:0 0 16px;padding-left:20px">${last.map((n) => `<li style="margin:2px 0">${esc(n)}</li>`).join("")}</ul>` : ""}
  ${fl.length ? `<p style="margin:0 0 6px;font-weight:700">Your flight${fl.length > 1 ? "s" : ""}</p>${fl.map((f) => `<div style="border:1px solid #E0D8C8;border-radius:12px;padding:10px 14px;margin:0 0 8px"><div style="font-weight:700">${esc(f.head)}</div>${f.times ? `<div style="font-size:14px;color:#66706A">${esc(f.times[0].toUpperCase() + f.times.slice(1))}</div>` : ""}${f.by ? `<div style="font-size:14px;margin-top:4px">Be at the airport by <b>${esc(f.by)}</b> <span style="color:#66706A">(2 hours before; 3 for international)</span></div>` : ""}</div>`).join("")}<div style="height:8px"></div>` : ""}
  ${stay ? `<p style="margin:0 0 4px;font-weight:700">Staying at</p><p style="margin:0 0 16px;font-size:15px">${esc(stay.name)}${stay.address ? `<br><span style="color:#66706A">${esc(stay.address)}</span>` : ""}${stay.check_in_time ? `<br><span style="color:#66706A">Check-in ${esc(clock(stay.check_in_time))}</span>` : ""}</p>` : ""}
  ${r.weather_summary ? `<p style="margin:0 0 18px;font-size:14px;color:#66706A">${esc(r.weather_summary)}</p>` : ""}
  <a href="${url}" style="display:inline-block;background:#1F3D34;color:#F4ECDC;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:12px">Open your list</a>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #E0D8C8;font-size:12px;line-height:1.5;color:#66706A">You're getting this because trip reminders are on. <a href="https://pack.spruceandsound.com/#/account" style="color:#66706A">Turn them off</a> in Pack → You.<br>Pack by Spruce &amp; Sound · 203 Riverwalk Dr, Lynden, WA 98264 · <a href="https://pack.spruceandsound.com/privacy" style="color:#66706A">Privacy</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export async function sendEmail({ to, subject, text, html }) {
  const key = (process.env.RESEND_API_KEY || "").trim();
  if (!key) throw new Error("RESEND_API_KEY isn't set");
  const from = (process.env.PACK_FROM_EMAIL || "Pack <hello@spruceandsound.com>").trim();
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
