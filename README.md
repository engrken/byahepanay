# BiyahePanay — Bus Tracking & Passenger Information

Mobile-first Next.js PWA for community checkpoint reports and estimated bus arrivals across Capiz, Iloilo, and Aklan. BiyahePanay is independent and community-powered; it is not an official transport operator timetable or service.

## Stack

- Next.js App Router, TypeScript, and Tailwind CSS
- Neon PostgreSQL via @neondatabase/serverless
- Vercel Marketplace Neon integration
- Service Worker shell cache and IndexedDB offline sighting queue
- Vercel deployment in Singapore region (`sin1`)

## Database setup

The Vercel project is named `biyahepanay` and remains connected to the existing Neon Marketplace integration in Singapore. That integration currently injects the legacy variable `BYAHEPANAY_DATABASE_URL`; the app now prefers `BIYAHEPANAY_DATABASE_URL` when present and falls back to the existing variable, so the database connection remains compatible during the rename.

For a fresh database, run the complete `neon/schema.sql` file on the Neon SQL Editor. It creates the route, checkpoint, bus, trip, rider-session, and sighting tables, plus the five route variants and their initial checkpoint/ETA seed data.

All database calls run from server-side Next.js route handlers. No database URL or write credential is sent to the browser. The database is not exposed through a public PostgREST API.

## Environment variables

For local development, copy `.env.example` to `.env.local` and set a pooled Neon connection string:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
SPOTTER_SESSION_SECRET=replace-with-a-random-secret-of-at-least-32-characters
BYPASS_GEOFENCE=true
```

On Vercel, the server checks `BIYAHEPANAY_DATABASE_URL`, then the existing integration variable `BYAHEPANAY_DATABASE_URL`, then `DATABASE_URL`. Keep the current Neon Marketplace variable in place unless you separately verify a replacement. Do not commit real database credentials.

## Run locally

Node.js 20.9+ is recommended (Node 22 is configured on Vercel).

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your Neon pooled connection string
npm run dev
```

Open http://localhost:3000. Optional checks:

```bash
npm run typecheck
npm run lint
npm run build
npm run start
```

## GitHub and Vercel

Repository: https://github.com/engrken/byahepanay  
Production branch: `main`  
Vercel project: `biyahepanay` (team `kentbsece-7567`)

Pushes to `main` trigger a Vercel production deployment. Vercel injects the Neon integration variables for Production and Preview.

## API endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/board` | GET | Corridor data and active/arrived trips |
| `/api/departures` | POST | Actual departure log and cadence anchor |
| `/api/sightings` | POST | Geofence, speed, sequence, and consensus validation |
| `/api/buses?bodyNumber=...` | GET | Bus registry lookup |
| `/api/trips/:id/tag` | POST | Tag a trip with body/plate numbers |
| `/api/trips/:id/join` | POST | Join Rider Beacon mode |
| `/api/trips/:id/status` | POST | Rider status update |

## Reporting security

Write APIs use a server-issued HMAC-signed HttpOnly browser-session cookie, same-origin validation, per-session rate limits, and stable idempotency keys. Sighting insertion, quorum evaluation, and trip progression are serialized per trip and committed in one database transaction. Offline reports preserve their idempotency key across retries.

On first launch after this upgrade, the app transfers any old browser UUID only for existing active trip creator/rider memberships, then removes it from local storage. A signed anonymous browser session is not proof of a distinct human. One person can create multiple browser profiles; treat consensus as separate browser sessions, not verified commuters, until an anti-abuse challenge or verified accounts are introduced.

## Live updates and offline behavior

The app refreshes the Neon-backed board every 10 seconds while the page is visible and when the user returns to the tab. Offline roadside sightings remain in IndexedDB and are retried when connectivity returns. Neon Realtime is not enabled in this database at the moment.

## App appearance and mobile experience

- Light and dark themes are available from the header, follow the device preference on first visit, and remember the user's choice on that device.
- The page includes mobile-safe spacing, larger touch targets, a sticky corridor selector, quick section links, and a safe-area-aware reporting dock.
- The browser connection indicator explains when the phone is offline; sightings continue to use the existing on-device queue and retry flow.

## Stop-first bus arrivals

Choose a corridor, then use **Use my location** or select a waiting stop. The app compares active trips that pass that stop and puts the bus with the earliest estimated arrival first. Buses that have already passed the stop or have only an unverified report there are excluded from the incoming list. Browser location is used locally to select the nearest mapped stop; it is not sent to the server unless the rider separately submits a sighting. Because checkpoint coordinates are still prototype estimates, the displayed nearest stop and ETAs must be field-validated before public operational use.

## Field and release validation

- Check every checkpoint's exact highway-side GPS coordinate before enabling the 300 m geofence for commuters. Seed coordinates are approximate municipal/area anchors only.
- Verify route branch logic, segment/dwell time, and 30-minute cadence against actual trips. Cadence slots are projections, not confirmed dispatches.
- Test geofence rejection, speed rejection (>95 km/h), stale/out-of-order reports, two-reporter consensus, and Rider Beacon (20–90 km/h).
- Test the offline queue by submitting with airplane mode enabled and reconnecting.
- Test Add to Home Screen, offline launch, iOS Safari, Wake Lock support, and battery impact.
- The server only honors `BYPASS_GEOFENCE=true` in local development (`NODE_ENV !== production`). Vercel Production and Preview always enforce the 300 m geofence; no browser-controlled test-mode bypass exists.

**Important:** route timing offsets and GPS points are initial planning estimates. They are not operator-verified and must not be presented as live schedule guarantees. Browser GPS/background sync are best-effort, and anonymous crowdsourcing requires abuse monitoring before high-volume public launch.

## Email OTP and reporter integrity
Email verification is delivered through Gmail SMTP using Nodemailer. Configure `GMAIL_USER` (the full Gmail or Google Workspace address) and `GMAIL_APP_PASSWORD` (a Google App Password; never use the normal account password) in Vercel. Gmail App Passwords require 2-Step Verification, and some managed/work/school accounts or Advanced Protection configurations may not offer them. The app connects to `smtp.gmail.com:465` with implicit TLS and sends from the authenticated Gmail address. Production always requires a successful email OTP before contribution writes; the server fails closed in production even if `REQUIRE_EMAIL_VERIFICATION` is missing or set to `false`. Keep `REQUIRE_EMAIL_VERIFICATION=true` explicitly configured in Vercel Production and Preview. If SMTP is unavailable, contribution writes remain blocked instead of falling back to anonymous access. The app stores a keyed email hash and masked address, never the full email address or OTP code. Codes expire after 10 minutes; delivery is limited to four requests per hour per session and per email, with five verification attempts per 10 minutes per session and email. One verified email maps to one reporter identity across browser profiles.

## Automatic ETA calibration
Each checkpoint segment is calibrated separately by route and bus type. A sample is accepted only after at least two distinct email-verified reporter identities corroborate a checkpoint, both reports have GPS accuracy recorded, mean accuracy is at most 40 m, the route sequence is adjacent, and elapsed time is plausible. Calibrations use a rolling 90-day window, require eight quality-qualified samples, and use a median with median-absolute-deviation outlier rejection. The 80th percentile is retained for uncertainty reporting. Until a segment qualifies, the initial planning offset remains in use.

## Operational monitoring and research metrics
`/api/health` is the health probe. `/api/ops/metrics?days=30` returns aggregate daily report-quality and ETA calibration metrics; `/ops` is the visual dashboard. A Vercel Cron job calls `/api/ops/snapshot` once daily at midnight Manila time using `CRON_SECRET` and records the previous completed Manila calendar day, stores historical aggregates, and opens/resolves alerts for slow database queries and stale active trips. No raw email addresses, phone numbers, or per-reporter identities are exposed in the dashboard.

Calibration values are research estimates, not official timetables. Field-validate checkpoint coordinates and timestamps with transport operators and local field checks before operational reliance.


### Rebrand compatibility
The app display name is now **BiyahePanay**. Existing IndexedDB, local-storage, service-worker sync, and session-cookie identifiers are intentionally retained so installed devices keep their queued sightings, preferences, and active sessions across the spelling change. The service-worker shell cache is versioned separately to refresh the renamed app shell.


## Passenger guide and live audience monitoring

- Passenger guide: /help; first-time visitors see a skippable quick-start walkthrough.
- Visible browser sessions heartbeat every 60 seconds. Operations reports signed browser sessions seen within five minutes, verified contributor identities currently online, and verified contributors who reported within 15 minutes.
- Presence records contain only opaque session IDs and verified reporter IDs; no GPS, IP address, full email or user-agent is collected for these counters.
- The five pilot checkpoint pins supplied by the project owner are tagged as pending field validation until the passenger waiting point and highway side are checked on site. Operations links each candidate pin to Google Maps.
- Nearest-stop matching does not confidently name a distant fallback when no stop is within 1.5 km (or 3 times reported GPS accuracy, if greater).
