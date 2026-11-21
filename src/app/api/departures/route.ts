import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adminUnavailable, jsonError, isUuid } from '@/lib/http';
import { haversineKm } from '@/lib/geo';

export const dynamic = 'force-dynamic';
const VALID_ROUTES = ['iloilo_passi', 'kalibo_mambusao', 'kalibo_sapian', 'tapaz', 'estancia'];

export async function POST(request: NextRequest) {
  const sql = getDb();
  if (!sql) return adminUnavailable();

  let body: {
    routeId?: string; busType?: string; spotterId?: string; bodyNumber?: string;
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
  if (!isUuid(body.spotterId)) return jsonError('A valid browser session identifier is required.');
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
    if (process.env.NEXT_PUBLIC_TEST_MODE !== 'true' && originDistance > 300) {
      return jsonError(
        `You are ${Math.round(originDistance)} m from Pueblo Terminal. Departure reports must be logged within 300 m.`,
        422, 'DEPARTURE_OUTSIDE_GEOFENCE',
      );
    }

    const spotterId = body.spotterId;
    const rateSince = new Date(Date.now() - 2 * 60_000).toISOString();
    const recentDeparture = await sql`
      select id from public.sightings
      where spotter_id = ${spotterId}::uuid and kind = 'departure'
        and created_at > ${rateSince}::timestamptz limit 1
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
    const tripRows = await sql`
      with new_trip as (
        insert into public.trips (
          route_id, bus_id, bus_type, departure_at, status,
          last_checkpoint_id, last_checkpoint_at, last_lat, last_lng, confidence_status
        )
        values (
          ${routeId}, ${busId}::uuid, ${busType}, ${departureAt}::timestamptz, 'active',
          ${origin.id}::uuid, ${departureAt}::timestamptz, ${origin.lat}, ${origin.lng}, 'verified'
        )
        returning id, route_id, bus_type, departure_at, status, last_checkpoint_id,
                  last_checkpoint_at, confidence_status
      ),
      creator_session as (
        insert into public.trip_creator_sessions (trip_id, spotter_id)
        select id, ${spotterId}::uuid from new_trip returning trip_id
      ),
      departure_sighting as (
        insert into public.sightings (
          trip_id, checkpoint_id, spotter_id, kind, lat, lng, distance_meters,
          is_verified, confidence_status, verified_at
        )
        select id, ${origin.id}::uuid, ${spotterId}::uuid, 'departure',
               ${origin.lat}, ${origin.lng}, ${Math.round(originDistance * 10) / 10},
               true, 'verified', ${departureAt}::timestamptz
        from new_trip returning id
      )
      select * from new_trip
    `;
    const trip = tripRows[0] as Record<string, unknown> | undefined;
    if (!trip) return jsonError('Could not record departure.', 500);
    return NextResponse.json({ trip: { ...trip, body_number: bodyNumber, plate_number: plateNumber } }, { status: 201 });
  } catch (error) {
    console.error('ByahePanay departure creation failed', error);
    return jsonError('Could not record departure. Please try again.', 500);
  }
}
