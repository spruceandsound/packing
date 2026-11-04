// Day-before trip reminders. Runs every hour; each person gets theirs once it's 9am or later
// in their own time zone on the day before the trip (see due_reminders() in supabase/05-…sql).
//
// Needs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
// Optional: PACK_FROM_EMAIL (default "Pack <hello@spruceandsound.com>")
import { buildReminder, sendEmail } from "../lib/reminder-email.mjs";

export const config = { schedule: "@hourly" };

const env = (k) => (process.env[k] || "").trim();

export default async () => {
  if (!env("RESEND_API_KEY") || !env("SUPABASE_SERVICE_ROLE_KEY")) {
    console.log("Reminders skipped: RESEND_API_KEY or SUPABASE_SERVICE_ROLE_KEY not set");
    return new Response("skipped");
  }
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/due_reminders`, { method: "POST", headers, body: "{}" });
  if (!r.ok) { console.error("due_reminders failed", r.status, await r.text()); return new Response("error", { status: 500 }); }
  const due = await r.json();
  let sent = 0, failed = 0;
  for (const row of due) {
    try {
      // Their flights on the first day and where they're staying first, if anyone added them.
      const get = (path) => fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, { headers }).then((x) => (x.ok ? x.json() : [])).catch(() => []);
      const [flights, stays] = await Promise.all([
        get(`trip_flights?trip_id=eq.${row.trip_id}&user_id=eq.${row.user_id}&flight_date=eq.${row.start_date}&select=flight_no,dep_airport,arr_airport,dep_time,arr_time&order=dep_time`),
        get(`trip_stays?trip_id=eq.${row.trip_id}&select=name,address,check_in_date,check_in_time&order=check_in_date.asc.nullslast&limit=1`),
      ]);
      await sendEmail({ to: row.email, ...buildReminder({ ...row, flights, stays }) });
      await fetch(`${env("SUPABASE_URL")}/rest/v1/reminders_sent`, {
        method: "POST", headers: { ...headers, prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({ trip_id: row.trip_id, user_id: row.user_id, kind: "day_before" }),
      });
      sent++;
    } catch (err) { failed++; console.error("Reminder failed for trip", row.trip_id, err.message); }
  }
  console.log(`Reminders: ${sent} sent, ${failed} failed, ${due.length} due`);
  return new Response(`sent ${sent}`);
};
