# ByahePanay — Ceres Liner Last-Trip Tracker

Mobile-first Next.js PWA for community checkpoint reports and estimated Ceres Liner arrivals across Capiz, Iloilo, and Aklan. It is not an official Ceres Liner schedule or operator service.

## Stack

- Next.js App Router + TypeScript + Tailwind CSS
- Supabase Postgres, RLS, and Realtime
- Service Worker shell cache + IndexedDB offline sighting queue
- Vercel deployment in Singapore region (`sin1`)

## 1. Supabase setup

1. Create a Supabase project at https://supabase.com/dashboard.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and run it.
3. Under **Project Settings → API**, copy the Project URL, public anon/publishable key, and server-only service-role key.
4. Keep the service-role key secret. It must never be committed or exposed to the browser.

The schema creates routes, checkpoints, route membership, buses, trips, sightings, and private browser-session tables. It enables RLS, makes public roles read-only, and adds `trips` and `sightings` to `supabase_realtime` where that publication exists.

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in real Supabase values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_TEST_MODE=true
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Do not put a `NEXT_PUBLIC_` prefix on it. Do not commit `.env.local`.

## 3. Local development

Node.js 20.9+ is recommended (Node 22 is configured on Vercel).

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your Supabase credentials
npm run dev
```

Open http://localhost:3000. Optional checks:

```bash
npm run typecheck
npm run lint
npm run build
npm run start
```

## 4. GitHub

This repository is `https://github.com/engrken/byahepanay`. The production branch is `main`. Vercel is connected to this repository; pushes to `main` trigger production deployment.

```bash
git clone https://github.com/engrken/byahepanay.git
cd byahepanay
# If updating an existing clone, run: git pull origin main
npm install
git status
```

Do not commit secrets, Supabase credentials, `.env.local`, or Vercel local project credentials.

## 5. Vercel configuration

Project: `byahepanay` (team `kentbsece-7567`). Add the following under **Project → Settings → Environment Variables** for Production and Preview:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (encrypted/server-only)
- `NEXT_PUBLIC_TEST_MODE`

Controlled test setup can use `NEXT_PUBLIC_TEST_MODE=true`; this skips only the 300 m geofence. Set it to `false` before real public use, then redeploy. The linked `main` branch auto-deploys.

## 6. API endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/board` | GET | Corridor data and active/arrived trips |
| `/api/departures` | POST | Actual departure log and cadence anchor |
| `/api/sightings` | POST | Geofence, speed, sequence, consensus validation |
| `/api/buses?bodyNumber=...` | GET | Bus registry lookup |
| `/api/trips/:id/tag` | POST | Tag a trip with body/plate numbers |
| `/api/trips/:id/join` | POST | Join Rider Beacon mode |
| `/api/trips/:id/status` | POST | Rider status update |

## 7. Field and release validation

- Check every checkpoint's exact highway-side GPS coordinate before enabling the 300 m geofence for commuters. Seed coordinates are approximate municipal/area anchors only.
- Verify route branch logic, segment/dwell time, and 30-minute cadence against actual trips. Cadence slots are projections, not confirmed dispatches.
- Test geofence rejection, speed rejection (>95 km/h), stale/out-of-order reports, two-spotter consensus, and Rider Beacon (20–90 km/h).
- Test the offline queue by submitting with airplane mode enabled and reconnecting.
- Test Add to Home Screen, offline launch, iOS Safari, Wake Lock support, and battery impact.
- Measure production initial transfer on a throttled low-end mobile profile; the <50 KB goal is not guaranteed by source size alone.

**Important:** route timing offsets and GPS points are initial planning estimates supplied for the prototype. They are not operator-verified and must not be presented as live schedule guarantees. Browser GPS/background sync are best-effort, and anonymous crowdsourcing requires abuse monitoring before high-volume public launch.
