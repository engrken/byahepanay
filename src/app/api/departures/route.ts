import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adminUnavailable, jsonError, isUuid, isSameOriginRequest } from '@/lib/http';
import { getSpotterSessionId } from '@/lib/spotter-session';
import { requireReporterIdentity } from '@/lib/reporter-verification';
import { haversineKm } from '@/lib/geo';

export const dynamic = 'force-dynamic';
const VALID_ROUTES = ['iloilo_passi', 'kalibo_mambusao', 'kalibo_sapian', 'tapaz', 'estancia'];

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError('Cross-origin write requests are not allowed.', 403, 'CROSS_SITE_REQUEST');
  const spotterId = getSpotterSessionId(request);
  if (!spotterId) return jsonError('Secure browser session is missing or expired. Refresh the app and try again.', 401, 'SESSION_REQUIRED');
  const sql = getDb();
  if (!sql) return adminUnavailable();
  const reporter = await requireReporterIdentity(sql, spotterId);
  if (!reporter.allowed) return jsonError('Verify your email address with an email OTP before logging a departure.', 428, 'EMAIL_VERIFICATION_REQUIRED');

  let body: {
    routeId?: string; busType?: string; requestId?: string; bodyNumber?: string;
    plateNumber?: string; lat?: number; lng?: number;
  };
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }

  const routeId = body.routeId;
  const busType = body.busType;
  if (!routeId || !VALID_ROUTES.includes(routeId)) return jsonError('Choose a valid Panay corridor.');
  if (busType !== 'ordinary' && busType !== 'aircon') return jsonError('Choose Ordinary or Aircon.');

  const bodyNumber = body.bodyNumber?.trim() || null;
  const plateNumber = body.plateNumber?.trim() || null;
  if (bodyNumber && bodyNumber.length > 20) return jsonError('Ceres body number must be 20 characters or fewer.');
  if (plateNumber && plateNumber.length > 16) return jsonError('Plate number must be 16 characters or fewer.');
  if (!isUuid(body.requestId)) return jsonError('A unique request identifier is required.');
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number' ||
      !Number.isFinite(body.lat) || !Number.isFinite(body.lng) ||
      Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) {
    return jsonError('GPS location is required to verify a Pueblo departure.');
  }

  try {
    const [routeRows, originRows] = await Promise.all([
      sql`select id from public.routes where id = ${routeId} and is_active = true limit 1`,
      sql`select id, lat, lng from public.checkpoints where code = 'pueblo_terminal' limit 1`,
    ]);
    if (!routeRows.length || !originRows.length) {
      return jsonError('Corridor seed data is missing. Apply neon/schema.sql first.', 503);
    }

    const origin = originRows[0] as { id: string; lat: number; lng: number };
    const originDistance = haversineKm({ lat: body.lat, lng: body.lng }, { lat: origin.lat, lng: origin.lng }) * 1000;
    const allowLocalGeofenceBypass = process.env.NODE_ENV !== 'production' && process.env.BYPASS_GEOFENCE === 'true';
    if (!allowLocalGeofenceBypass && originDistance > 300) {
      return jsonError(
        `You are ${Math.round(originDistance)} m from Pueblo Terminal. Departure reports must be logged within 300 m.`,
        422, 'DEPARTURE_OUTSIDE_GEOFENCE',
      );
    }

    const requestId = body.requestId;
    const rateSince = new Date(Date.now() - 2 * 60_000).toISOString();
    const previousRequest = await sql`select s.id, s.spotter_id, t.id as trip_id, t.route_id, t.bus_type, t.departure_at, t.status, t.last_checkpoint_id, t.last_checkpoint_at, t.confidence_status, b.body_number, b.plate_number
      from public.sightings s join public.trips t on t.id = s.trip_id left join public.buses b on b.id = t.bus_id
      where s.idempotency_key = ${requestId}::uuid and s.kind = 'departure' limit 1`;
    if (previousRequest.length) {
      const previous = previousRequest[0] as { id: string; spotter_id: string; trip_id: string; route_id: string; bus_type: string; departure_at: string; status: string; last_checkpoint_id: string | null; last_checkpoint_at: string | null; confidence_status: string; body_number: string | null; plate_number: string | null };
      if (previous.spotter_id !== spotterId) return jsonError('This request identifier was already used.', 409, 'IDEMPOTENCY_KEY_REUSED');
      return NextResponse.json({ trip: { id: previous.trip_id, route_id: previous.route_id, bus_type: previous.bus_type, departure_at: previous.departure_at, status: previous.status, last_checkpoint_id: previous.last_checkpoint_id, last_checkpoint_at: previous.last_checkpoint_at, confidence_status: previous.confidence_status, body_number: previous.body_number, plate_number: previous.plate_number }, duplicate: true });
    }
    const recentDeparture = await sql`
      select id from public.sightings
      where kind = 'departure' and created_at > ${rateSince}::timestamptz
        and (spotter_id = ${spotterId}::uuid or (${reporter.reporterId}::uuid is not null and reporter_id = ${reporter.reporterId}::uuid)) limit 1
    `;
    if (recentDeparture.length) {
      return jsonError('Please wait 2 minutes before logging another terminal departure from this browser.', 429, 'DEPARTURE_RATE_LIMIT');
    }

    let busId: string | null = null;
    if (bodyNumber) {
      const busRows = await sql`
        insert into public.buses (body_number, plate_number, bus_type)
        values (${bodyNumber}, ${plateNumber}, ${busType})
        on conflict (body_number)
        do update set plate_number = excluded.plate_number, bus_type = excluded.bus_type
        returning id
      `;
      busId = (busRows[0] as { id: string } | undefined)?.id ?? null;
    }

    const departureAt = new Date().toISOString();
    const transactionResults = await sql.transaction([
      sql`select pg_advisory_xact_lock(hashtextextended(${reporter.reporterId ?? spotterId}, 0))`,
      sql`
        with eligible as (select 1 where not exists (select 1 from public.sightings where idempotency_key = ${requestId}::uuid)
          and not exists (select 1 from public.sightings where kind = 'departure' and created_at > ${rateSince}::timestamptz and (spotter_id = ${spotterId}::uuid or (${reporter.reporterId}::uuid is not null and reporter_id = ${reporter.reporterId}::uuid)))),
        new_trip as (insert into public.trips (route_id, bus_id, bus_type, departure_at, status, last_checkpoint_id, last_checkpoint_at, last_lat, last_lng, confidence_status)
          select ${routeId}, ${busId}::uuid, ${busType}, ${departureAt}::timestamptz, 'active', ${origin.id}::uuid, ${departureAt}::timestamptz, ${origin.lat}, ${origin.lng}, 'verified'
          from eligible returning id, route_id, bus_type, departure_at, status, last_checkpoint_id, last_checkpoint_at, confidence_status),
        creator_session as (insert into public.trip_creator_sessions (trip_id, spotter_id) select id, ${spotterId}::uuid from new_trip returning trip_id),
        departure_sighting as (insert into public.sightings (trip_id, checkpoint_id, spotter_id, reporter_id, kind, lat, lng, distance_meters, is_verified, confidence_status, verified_at, idempotency_key)
          select id, ${origin.id}::uuid, ${spotterId}::uuid, ${reporter.reporterId}::uuid, 'departure', ${origin.lat}, ${origin.lng}, ${Math.round(originDistance * 10) / 10}, true, 'verified', ${departureAt}::timestamptz, ${requestId}::uuid from new_trip returning id)
        select new_trip.* from new_trip cross join creator_session cross join departure_sighting
      `
    ], { isolationLevel: 'ReadCommitted' });
    const tripRows = transactionResults[1] ?? [];
    const trip = tripRows[0] as Record<string, unknown> | undefined;
    if (!trip) {
      const rateLimited = await sql`select id from public.sightings where kind = 'departure' and created_at > ${rateSince}::timestamptz and (spotter_id = ${spotterId}::uuid or (${reporter.reporterId}::uuid is not null and reporter_id = ${reporter.reporterId}::uuid)) limit 1`;
      if (rateLimited.length) return jsonError('Please wait 2 minutes before logging another terminal departure from this browser.', 429, 'DEPARTURE_RATE_LIMIT');
      return jsonError('The departure was not created because the request was stale or already used. Refresh and retry.', 409, 'DEPARTURE_CONFLICT');
    }
    return NextResponse.json({ trip: { ...trip, body_number: bodyNumber, plate_number: plateNumber } }, { status: 201 });
  } catch (error) {
    console.error('BiyahePanay departure creation failed', error);
    return jsonError('Could not record departure. Please try again.', 500);
  }
}
