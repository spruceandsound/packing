# Pack — pack.spruceandsound.com

Smart, shareable packing lists. People sign in with an emailed code, dump
everything they're bringing, and Claude sorts it into categories and bags, with
weather-aware suggestions. Trips can be shared so a group packs together.

## How it's built

- **Static app** (`index.html`, `app.js`, `app.css`, `sw.js`): no build step. Hash routes:
  `#/` trips, `#/trip/:id`, `#/new`, `#/closet`, `#/templates`, `#/account`, `#/join/:token`.
- **Supabase** (project `pack`, us-west-1): sign-in and the database. Row-level security
  keeps every trip private to its members; the closet and templates are private to their owner.
  Schema: `supabase/schema.sql` (safe to re-run).
- **Netlify function** `netlify/functions/api.mjs`:
  - `GET /api/config` hands the app the public Supabase URL and key
  - `POST /api/weather` gets the forecast from Open-Meteo (free, no key), or last year's
    weather for the same dates when the trip is more than ~2 weeks out
  - `POST /api/sort` checks the sign-in and the daily limit, then asks Claude to sort
  - `POST /api/test-reminder` (admins) emails you a sample day-before reminder
- **Scheduled function** `netlify/functions/reminders.mjs` runs hourly and emails each trip member
  at 9am their time the day before a trip (via Resend)
- Weather includes 48 hours of hourly detail for the first two days

## Environment variables (Netlify → Project configuration → Environment variables)

| Name | Where it comes from |
| --- | --- |
| `SUPABASE_URL` | `https://vnckwnzctryaukqeeyab.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys → publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → secret key (keep private) |
| `ANTHROPIC_API_KEY` | platform.claude.com → API keys |
| `PACK_MODEL` | optional, default `claude-haiku-5-5` |
| `PACK_DAILY_LIMIT` | optional, smart sorts per person per day, default 50 (resets at midnight in each person's time zone) |
| `PACK_SITE_DAILY_LIMIT` | optional, smart sorts for everyone combined per day, default 1000 |
| `RESEND_API_KEY` | resend.com → API Keys (day-before reminder emails; domain spruceandsound.com verified in Resend) |
| `AERODATABOX_KEY` | optional, rapidapi.com → AeroDataBox → subscribe (free tier) → your RapidAPI key; turns on live flight status |
| `PACK_FROM_EMAIL` | optional, default `Pack <hello@spruceandsound.com>` |

## Content calendar (admin only)

`#/admin/content` shows the marketing calendar to admins. The files in `content/` are AES-256-GCM
encrypted blobs (safe in this public repo). The key is stored only in the `app_secrets` table and
handed to admins by the `content_key()` function (`supabase/07-content-calendar.sql`); the page
decrypts in the browser. "Posted" check marks are saved in `content_posted`.

## Venmo

People can add a Venmo username or profile link on the You tab (`profiles.venmo`, `supabase/09-venmo.sql`).
On a trip's Expenses tab, anyone who owes a share sees "Pay … on Venmo" (per expense, and "Pay" on each
settle-up row). Phones open the Venmo app with the recipient, amount and note filled in, falling back to
venmo.com; computers open venmo.com. Coming back to Pack offers to mark the share paid back. USD trips only.

## Trip overview and flights

Opening a trip shows an overview (`#/trip/:id`): countdown, packing and expenses tiles, weather, flights,
people and notes. The packing list is `#/trip/:id/pack`, expenses `#/trip/:id/expenses`.
Flights live in `trip_flights` (`supabase/12-trip-flights.sql`), stays in `trip_stays` (`supabase/13-trip-stays.sql`).
"Paste a confirmation" sends pasted text or a screenshot to `/api/trip-import` (Claude reads out flights and stays;
counts as one smart sort; nothing pasted is stored). Airport names and time zones come from `data/airports.json`
(built from github.com/mwgg/Airports, MIT license in `data/airports-LICENSE.txt`), used for city names, flight
length, local arrival times, countdowns and "who lands when". Day-before reminders include the person's flights
and the first stay. For live status, gates and delays, set
`AERODATABOX_KEY` (a RapidAPI key subscribed to AeroDataBox) in Netlify; `/api/flight-status` caches results
for 10 minutes near travel day. Without the key, flights show what people entered plus a FlightAware link.

## Viewers, calendar and rental cars

Trips have two kinds of invite (`supabase/14-trip-viewers.sql`): **Traveler** (packs, splits costs, edits, as before) and
**Viewer** (`trip_members.role = 'viewer'`). Viewers see the overview and calendar: dates, weather, notes, flights, stays,
rental cars and who's going. Row-level security keeps packing lists and expenses from them entirely, and only travelers
(`is_trip_editor`) can change anything or create invite links. Viewers get no day-before packing reminder. A viewer who opens a
Traveler link becomes a traveler. The join screen says which kind of invite it is (`invite_preview`).

The Calendar tab (`#/trip/:id/calendar`) lays the trip out Sunday–Saturday with trip days shaded, then lists each day's
flights (out, home, and landings the next day), check-ins and check-outs, and rental car pickups and drop-offs.
Rental cars live in `trip_cars` (`supabase/15-trip-cars.sql`) and are added on the overview.

Hourly weather starts collapsed; the "Next 48 hours" button animates it open.

## Policies and account controls

- `/privacy` (privacy.html) and `/terms` (terms.html), styled by legal.css; linked from the landing footer,
  sign-in screen, You tab and reminder emails. Update the "Last updated" date when you change them.
- `/error` (error.html): shown when Pack can't load (server timeout or offline with nothing cached).
- You tab → Download my data (JSON, built in the browser) and Delete account (`POST /api/delete-account`,
  which runs `prepare_account_deletion` from `supabase/10-account-deletion.sql` to hand shared trips to
  the next member, then deletes the sign-in, cascading everything else).
- `/.well-known/security.txt` for security reports.

## Supabase settings

- Authentication → URL Configuration: Site URL `https://pack.spruceandsound.com`,
  redirect URL `https://pack.spruceandsound.com/**`
- Authentication → Emails → Magic Link template must include `{{ .Token }}` (the app
  signs people in with the code, which works inside the home-screen app on iPhone)
- Google sign-in is off (the button was removed). To add it back: enable Google under Authentication → Sign In / Providers with a Google OAuth client, then restore the button in `renderSignIn`
