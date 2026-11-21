import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { haversineKm } from '@/lib/geo';
import { adminUnavailable, jsonError, isUuid } from '@/lib/http';

export const dynamic = 'force-dynamic';
const MAX_GEOFENCE_METERS = 300;
const MAX_SPEED_KMH = 95;
const RATE_LIMIT_MINUTES = 5;

interface SightingPayload {
  tripId?: string; checkpointId?: string; lat?: number; lng?: number;
  kind?: 'roadside' | 'rider_beacon'; spotterId?: string; riderStatus?: string; observedAt?: string;
}
type TripRow = {
  id: string; route_id: string; bus_type: 'ordinary' | 'aircon'; departure_at: string;
  status: 'active' | 'arrived' | 'cancelled'; last_checkpoint_id: string | null;
  last_checkpoint_at: string | null; last_lat: number | null; last_lng: number | null;
  route_locked: boolean; route_candidate: string | null;
};
type CheckpointRow = { id: string; code: string; name: string; lat: number; lng: number };
type MembershipRow = { route_id: string; sequence: number };

function routeForSequence(code: string, currentRoute: string, candidateRoute: string | null, routeLocked: boolean) {
  if (routeLocked) return currentRoute;
  if (code === 'loctugan' || code === 'panitan') return 'estancia';
  if (code === 'dao' || code === 'cuartero') return 'iloilo_passi';
  if (code === 'sapian') return 'kalibo_sapian';
  if (code === 'mambusao') return 'kalibo_mambusao';
  if (code === 'altavas' && candidateRoute === 'kalibo_mambusao') return 'kalibo_mambusao';
  if (code === 'jamindan' || code === 'tapaz' || code === 'calinog') return 'tapaz';
  return currentRoute;
}
function reclassifyRoute(code: string, currentRoute: string, candidateRoute: string | null) {
  if (code === 'loctugan' || code === 'panitan') return { routeId: 'estancia', locked: true, candidate: null };
  if (code === 'dao' || code === 'cuartero') return { routeId: 'iloilo_passi', locked: true, candidate: null };
  if (code === 'sapian') return { routeId: 'kalibo_sapian', locked: true, candidate: null };
  if (code === 'mambusao') return { routeId: currentRoute, locked: false, candidate: 'kalibo_mambusao' };
  if (code === 'altavas' && (currentRoute === 'kalibo_mambusao' || candidateRoute === 'kalibo_mambusao')) {
    return { routeId: 'kalibo_mambusao', locked: true, candidate: null };
  }
  if (code === 'jamindan' || code === 'tapaz' || code === 'calinog') return { routeId: 'tapaz', locked: true, candidate: null };
  return { routeId: currentRoute, locked: false, candidate: candidateRoute };
}

export async function POST(request: NextRequest) {
  const sql = getDb();
  if (!sql) return adminUnavailable();

  let body: SightingPayload;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }
  if (!isUuid(body.tripId) || !isUuid(body.checkpointId)) return jsonError('A valid active trip and checkpoint are required.');
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number' ||
      !Number.isFinite(body.lat) || !Number.isFinite(body.lng) ||
      Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) {
    return jsonError('A valid GPS latitude and longitude are required.');
  }
  if (body.kind !== 'roadside' && body.kind !== 'rider_beacon') return jsonError('Unknown sighting type.');
  if (!isUuid(body.spotterId)) return jsonError('A valid browser session identifier is required.');

  const tripId = body.tripId;
  const checkpointId = body.checkpointId;
  const spotterId = body.spotterId;

  try {
    const [tripRows, checkpointRows] = await Promise.all([
      sql`select id, route_id, bus_type, departure_at, status, last_checkpoint_id, last_checkpoint_at,
                 last_lat, last_lng, route_locked, route_candidate
          from public.trips where id = ${tripId}::uuid limit 1`,
      sql`select id, code, name, lat, lng from public.checkpoints where id = ${checkpointId}::uuid limit 1`,
    ]);
    const trip = tripRows[0] as TripRow | undefined;
    const checkpoint = checkpointRows[0] as CheckpointRow | undefined;
    if (!trip || trip.status !== 'active') return jsonError('This trip is no longer active.', 404);
    if (!checkpoint) return jsonError('Checkpoint not found.');

    if (body.kind === 'rider_beacon') {
      const riderSession = await sql`
        select trip_id from public.trip_rider_sessions
        where trip_id = ${trip.id}::uuid and spotter_id = ${spotterId}::uuid limit 1
      `;
      if (!riderSession.length) {
        return jsonError('Join Rider Beacon mode on this trip before sending beacon pings.', 403, 'RIDER_SESSION_REQUIRED');
      }
      await sql`
        update public.trip_rider_sessions set last_seen_at = now()
        where trip_id = ${trip.id}::uuid and spotter_id = ${spotterId}::uuid
      `;
    }

    const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
    const distanceMeters = haversineKm(
      { lat: body.lat, lng: body.lng }, { lat: checkpoint.lat, lng: checkpoint.lng },
    ) * 1000;
    if (!testMode && distanceMeters > MAX_GEOFENCE_METERS) {
      return jsonError(
        `GPS is ${Math.round(distanceMeters)} m from ${checkpoint.name}; sightings must be within ${MAX_GEOFENCE_METERS} m.`,
        422, 'OUTSIDE_GEOFENCE',
      );
    }

    const receivedAt = new Date();
    const observedAtDate = body.observedAt ? new Date(body.observedAt) : receivedAt;
    if (!Number.isFinite(observedAtDate.getTime()) || observedAtDate.getTime() > receivedAt.getTime() + 120_000) {
      return jsonError('Invalid observation timestamp.', 422, 'INVALID_OBSERVED_AT');
    }
    const previousTime = new Date(trip.last_checkpoint_at ?? trip.departure_at).getTime();
    if (observedAtDate.getTime() < previousTime) {
      return jsonError('This queued GPS report is older than the latest confirmed checkpoint.', 409, 'OUT_OF_ORDER_SIGHTING');
    }

    const elapsedHours = Math.max(0, (observedAtDate.getTime() - previousTime) / 3_600_000);
    let impliedSpeedKmh: number | null = null;
    let segmentDistanceKm = 0;
    if (trip.last_lat !== null && trip.last_lng !== null) {
      segmentDistanceKm = haversineKm({ lat: trip.last_lat, lng: trip.last_lng }, { lat: checkpoint.lat, lng: checkpoint.lng });
      if (elapsedHours > 0) impliedSpeedKmh = segmentDistanceKm / elapsedHours;
      else if (segmentDistanceKm > 0.05) impliedSpeedKmh = Number.POSITIVE_INFINITY;
    }

    if (trip.last_checkpoint_id === checkpoint.id) {
      return jsonError('This checkpoint is already the trip’s latest confirmed stop.', 409, 'DUPLICATE_CHECKPOINT');
    }
    if (impliedSpeedKmh !== null && impliedSpeedKmh > MAX_SPEED_KMH) {
      return jsonError(
        `Implied speed ${impliedSpeedKmh.toFixed(1)} km/h exceeds the ${MAX_SPEED_KMH} km/h validation limit.`,
        422, 'IMPLAUSIBLE_SPEED',
      );
    }
    if (impliedSpeedKmh !== null && impliedSpeedKmh < 5 && segmentDistanceKm > 0.3) {
      return jsonError('This report implies less than 5 km/h since the previous town and was treated as a stale or out-of-order tap.', 422, 'STALE_TAP');
    }

    const sequenceRouteId = routeForSequence(checkpoint.code, trip.route_id, trip.route_candidate, trip.route_locked);
    const membershipRows = await sql`
      select route_id, sequence from public.route_checkpoints where checkpoint_id = ${checkpoint.id}::uuid
    `;
    const memberships = membershipRows as MembershipRow[];
    if (!memberships.length) return jsonError('This checkpoint is not mapped to a supported corridor.', 422);
    const targetMembership = memberships.find((membership) => membership.route_id === sequenceRouteId);
    if (!targetMembership) return jsonError('Checkpoint is not on the resolved corridor or a supported branch.', 422, 'ROUTE_MISMATCH');

    if (trip.last_checkpoint_id) {
      const previousRows = await sql`
        select sequence from public.route_checkpoints
        where route_id = ${sequenceRouteId} and checkpoint_id = ${trip.last_checkpoint_id}::uuid limit 1
      `;
      const previous = previousRows[0] as { sequence: number } | undefined;
      if (!previous) return jsonError('The last confirmed checkpoint does not belong to this branch; route sequence cannot be verified.', 409, 'BRANCH_SEQUENCE_MISMATCH');
      if (targetMembership.sequence <= previous.sequence) {
        return jsonError('This checkpoint is behind the last confirmed stop on the selected corridor.', 409, 'OUT_OF_ORDER_CHECKPOINT');
      }
    }

    if (body.kind === 'roadside') {
      const since = new Date(Date.now() - RATE_LIMIT_MINUTES * 60_000).toISOString();
      const recentTap = await sql`
        select id from public.sightings
        where spotter_id = ${spotterId}::uuid and kind = 'roadside'
          and created_at > ${since}::timestamptz limit 1
      `;
      if (recentTap.length) {
        return jsonError('One roadside report per browser session is allowed every 5 minutes.', 429, 'SPOTTER_RATE_LIMIT');
      }
    }

    const beaconMovingAtHighwaySpeed =
      body.kind === 'rider_beacon' && impliedSpeedKmh !== null && impliedSpeedKmh >= 20 && impliedSpeedKmh <= 90;
    const nowIso = receivedAt.toISOString();
    const observedAtIso = observedAtDate.toISOString();

    const inserted = await sql`
      insert into public.sightings (
        trip_id, checkpoint_id, spotter_id, kind, lat, lng, distance_meters, implied_speed_kmh,
        is_verified, confidence_status, rider_status, observed_at, verified_at
      )
      values (
        ${trip.id}::uuid, ${checkpoint.id}::uuid, ${spotterId}::uuid, ${body.kind},
        ${body.lat}, ${body.lng}, ${Math.round(distanceMeters * 10) / 10},
        ${impliedSpeedKmh === null ? null : Math.round(impliedSpeedKmh * 10) / 10},
        ${beaconMovingAtHighwaySpeed}, ${beaconMovingAtHighwaySpeed ? 'verified' : 'unverified'},
        ${body.riderStatus ?? null}, ${observedAtIso}::timestamptz,
        ${beaconMovingAtHighwaySpeed ? nowIso : null}::timestamptz
      )
      returning id
    `;
    const sightingId = (inserted[0] as { id: string } | undefined)?.id;
    if (!sightingId) return jsonError('Could not save sighting.', 500);

    const consensusSince = new Date(observedAtDate.getTime() - RATE_LIMIT_MINUTES * 60_000).toISOString();
    const consensusUntil = new Date(observedAtDate.getTime() + RATE_LIMIT_MINUTES * 60_000).toISOString();
    const recentReports = await sql`
      select distinct spotter_id from public.sightings
      where trip_id = ${trip.id}::uuid and checkpoint_id = ${checkpoint.id}::uuid
        and observed_at >= ${consensusSince}::timestamptz
        and observed_at <= ${consensusUntil}::timestamptz
    `;
    const distinctSpotters = recentReports.length;
    const consensusVerified = distinctSpotters >= 2;
    const verified = beaconMovingAtHighwaySpeed || consensusVerified;

    if (verified) {
      await sql`
        update public.sightings
        set is_verified = true, confidence_status = 'verified', verified_at = ${nowIso}::timestamptz
        where trip_id = ${trip.id}::uuid and checkpoint_id = ${checkpoint.id}::uuid
          and observed_at >= ${consensusSince}::timestamptz
          and observed_at <= ${consensusUntil}::timestamptz
      `;
    }

    const routeUpdate = !trip.route_locked
      ? reclassifyRoute(checkpoint.code, trip.route_id, trip.route_candidate)
      : { routeId: trip.route_id, locked: true, candidate: trip.route_candidate };

    let tripArrived = false;
    if (verified) {
      const finalRows = await sql`
        select checkpoint_id from public.route_checkpoints
        where route_id = ${routeUpdate.routeId} order by sequence desc limit 1
      `;
      const finalCheckpoint = finalRows[0] as { checkpoint_id: string } | undefined;
      tripArrived = finalCheckpoint?.checkpoint_id === checkpoint.id;

      await sql`
        update public.trips
        set route_id = ${routeUpdate.routeId}, route_locked = ${routeUpdate.locked},
            route_candidate = ${routeUpdate.candidate}, last_checkpoint_id = ${checkpoint.id}::uuid,
            last_checkpoint_at = ${observedAtIso}::timestamptz, last_lat = ${body.lat}, last_lng = ${body.lng},
            confidence_status = 'verified', pending_checkpoint_id = null, pending_reported_at = null,
            rider_status = coalesce(${body.riderStatus ?? null}, rider_status),
            rider_status_at = case when ${body.riderStatus ?? null}::text is null
              then rider_status_at else ${nowIso}::timestamptz end,
            status = ${tripArrived ? 'arrived' : 'active'}
        where id = ${trip.id}::uuid
      `;
    } else {
      await sql`
        update public.trips
        set confidence_status = 'unverified', pending_checkpoint_id = ${checkpoint.id}::uuid,
            pending_reported_at = ${observedAtIso}::timestamptz
        where id = ${trip.id}::uuid
      `;
    }

    return NextResponse.json({
      sightingId, verified, confidence: verified ? 'verified' : 'unverified', distinctSpotters,
      checkpoint: checkpoint.name, routeId: verified ? routeUpdate.routeId : trip.route_id,
      routeLocked: verified ? routeUpdate.locked : trip.route_locked, arrived: tripArrived, impliedSpeedKmh,
      message: verified ? 'Verified passed.' : 'Unverified sighting — awaiting another spotter or a moving rider beacon.',
    }, { status: 201 });
  } catch (error) {
    console.error('ByahePanay sighting validation failed', error);
    return jsonError('Could not validate this sighting. Please retry.', 500);
  }
}
