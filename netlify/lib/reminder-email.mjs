// Builds the day-before trip reminder email (HTML + plain text) and sends it through Resend.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SITE = "https://pack.spruceandsound.com";

function longDate(d) {
  if (!d) return "";
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

export function buildReminder(r) {
  const first = (r.display_name || "").trim().split(/\s+/)[0];
  const left = Number(r.items_left || 0), total = Number(r.items_total || 0), mine = Number(r.mine_left || 0);
  const last = (r.pack_last || []).filter(Boolean);
  const url = `${SITE}/#/trip/${r.trip_id}`;
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
    r.weather_summary ? `\nWeather: ${r.weather_summary}` : "",
    "",
    `Open your list: ${url}`,
    "",
    "You're getting this because trip reminders are on. Turn them off in Pack → You.",
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
  ${r.weather_summary ? `<p style="margin:0 0 18px;font-size:14px;color:#66706A">${esc(r.weather_summary)}</p>` : ""}
  <a href="${url}" style="display:inline-block;background:#1F3D34;color:#F4ECDC;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:12px">Open your list</a>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #E0D8C8;font-size:12px;color:#66706A">You're getting this because trip reminders are on. Turn them off in Pack → You.</td></tr>
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
