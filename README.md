# ByahePanay — Ceres Liner Last-Trip Tracker

Mobile-first Next.js PWA for community checkpoint reports and estimated Ceres Liner arrivals across Capiz, Iloilo, and Aklan. It is not an official Ceres Liner schedule or operator service.

## Stack

- Next.js App Router, TypeScript, and Tailwind CSS
- Neon PostgreSQL via @neondatabase/serverless
- Vercel Marketplace Neon integration
- Service Worker shell cache and IndexedDB offline sighting queue
- Vercel deployment in Singapore region (`sin1`)

## Database setup

The existing Vercel project `byahepanay` is connected to the Neon Marketplace database `byahepanay` in Singapore. The integration injects `BYAHEPANAY_DATABASE_URL` for Production and Preview.

For a fresh database, run the complete `neon/schema.sql` file on the Neon SQL Editor. It creates the route, checkpoint, bus, trip, rider-session, and sighting tables, plus the five route variants and their initial checkpoint/ETA seed data.

All database calls run from server-side Next.js route handlers. No database URL or write credential is sent to the browser. The database is not exposed through a public PostgREST API.

## Environment variables

For local development, copy `.env.example` to `.env.local` and set a pooled Neon connection string:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
SPOTTER_SESSION_SECRET=replace-with-a-random-secret-of-at-least-32-characters
BYPASS_GEOFENCE=true
```

On Vercel, the Marketplace integration provides `BYAHEPANAY_DATABASE_URL`, which the server uses automatically. Do not commit real database credentials.

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
Vercel project: `byahepanay` (team `kentbsece-7567`)

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
- Test geofence rejection, speed rejection (>95 km/h), stale/out-of-order reports, two-spotter consensus, and Rider Beacon (20–90 km/h).
- Test the offline queue by submitting with airplane mode enabled and reconnecting.
- Test Add to Home Screen, offline launch, iOS Safari, Wake Lock support, and battery impact.
- The server only honors `BYPASS_GEOFENCE=true` in local development (`NODE_ENV !== production`). Vercel Production and Preview always enforce the 300 m geofence; no browser-controlled test-mode bypass exists.

**Important:** route timing offsets and GPS points are initial planning estimates. They are not operator-verified and must not be presented as live schedule guarantees. Browser GPS/background sync are best-effort, and anonymous crowdsourcing requires abuse monitoring before high-volume public launch.

## Phone OTP and reporter integrity
SMS verification uses Twilio Verify. Configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, and `REQUIRE_PHONE_VERIFICATION=true` in Vercel only after a Twilio Verify service is provisioned and tested. Until the provider is configured, OTP is visibly unavailable and signed-session protections continue to operate. The app stores a keyed phone hash and masked number, never the raw number or OTP code.

## Automatic ETA calibration
Each checkpoint segment is calibrated separately by route and bus type. A sample is accepted only after at least two distinct OTP-verified phone identities confirm a checkpoint, both reports have GPS accuracy recorded, mean accuracy is at most 40 m, the route sequence is adjacent, and elapsed time is plausible. Calibrations use a rolling 90-day window, require eight quality-qualified samples, and use a median with median-absolute-deviation outlier rejection. The 80th percentile is retained for uncertainty reporting. Until a segment qualifies, the initial planning offset remains in use.

## Operational monitoring and research metrics
`/api/health` is the health probe. `/api/ops/metrics?days=30` returns aggregate daily report-quality and ETA calibration metrics; `/ops` is the visual dashboard. A Vercel Cron job calls `/api/ops/snapshot` every six hours using `CRON_SECRET`, stores historical aggregates, and opens/resolves alerts for slow database queries and stale active trips. No raw phone numbers or per-reporter identities are exposed in the dashboard.

Calibration values are research estimates, not official schedules. Field-validate checkpoint coordinates and timestamps with Vallacar/Ceres permission before operational reliance.
