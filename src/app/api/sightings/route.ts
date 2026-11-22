import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { haversineKm } from '@/lib/geo';
import { adminUnavailable, jsonError, isUuid, isSameOriginRequest } from '@/lib/http';
import { getSpotterSessionId } from '@/lib/spotter-session';
import { requireReporterIdentity } from '@/lib/reporter-verification';
import { recalibrateSegment } from '@/lib/calibration';

export const dynamic = 'force-dynamic';
const MAX_GEOFENCE_METERS = 300;
const MAX_SPEED_KMH = 95;
const RATE_LIMIT_MINUTES = 5;

interface SightingPayload {
  tripId?: string; checkpointId?: string; lat?: number; lng?: number;
  kind?: 'roadside' | 'rider_beacon'; requestId?: string; riderStatus?: string; observedAt?: string; gpsAccuracyM?: number;
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
  if (!isSameOriginRequest(request)) return jsonError('Cross-origin write requests are not allowed.', 403, 'CROSS_SITE_REQUEST');
  const spotterId = getSpotterSessionId(request);
  if (!spotterId) return jsonError('Secure browser session is missing or expired. Refresh the app and try again.', 401, 'SESSION_REQUIRED');
  const sql = getDb();
  if (!sql) return adminUnavailable();
  const reporter = await requireReporterIdentity(sql, spotterId);
  if (!reporter.allowed) return jsonError('Verify your email address with an email OTP before reporting a bus sighting.', 428, 'EMAIL_VERIFICATION_REQUIRED');

  let body: SightingPayload;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }
  if (!isUuid(body.tripId) || !isUuid(body.checkpointId)) return jsonError('A valid active trip and checkpoint are required.');
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number' ||
      !Number.isFinite(body.lat) || !Number.isFinite(body.lng) ||
      Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) {
    return jsonError('A valid GPS latitude and longitude are required.');
  }
  if (body.kind !== 'roadside' && body.kind !== 'rider_beacon') return jsonError('Unknown sighting type.');
  if (!isUuid(body.requestId)) return jsonError('A unique request identifier is required.');
  const allowedRiderStatuses = ['seats_available', 'standing_only', 'mechanical_breakdown', 'moving'];
  if (body.riderStatus !== undefined && !allowedRiderStatuses.includes(body.riderStatus)) return jsonError('Choose a supported rider status.');
  if (body.gpsAccuracyM !== undefined && (typeof body.gpsAccuracyM !== 'number' || !Number.isFinite(body.gpsAccuracyM) || body.gpsAccuracyM < 0 || body.gpsAccuracyM > 1000)) return jsonError('Invalid GPS accuracy measurement.');
  const gpsAccuracyM = body.gpsAccuracyM ?? null;

  const tripId = body.tripId;
  const checkpointId = body.checkpointId;
  const requestId = body.requestId;

  try {
    const duplicateRows = await sql`select id, trip_id, checkpoint_id, spotter_id, is_verified, confidence_status from public.sightings where idempotency_key = ${requestId}::uuid limit 1`;
    if (duplicateRows.length) {
      const duplicate = duplicateRows[0] as { id: string; trip_id: string; checkpoint_id: string; spotter_id: string; is_verified: boolean; confidence_status: string };
      if (duplicate.trip_id !== tripId || duplicate.checkpoint_id !== checkpointId || duplicate.spotter_id !== spotterId) return jsonError('This request identifier was already used for another report.', 409, 'IDEMPOTENCY_KEY_REUSED');
      return NextResponse.json({ sightingId: duplicate.id, verified: duplicate.is_verified, confidence: duplicate.confidence_status, duplicate: true, message: 'This report was already received.' });
    }
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
    }

    const allowLocalGeofenceBypass = process.env.NODE_ENV !== 'production' && process.env.BYPASS_GEOFENCE === 'true';
    const distanceMeters = haversineKm(
      { lat: body.lat, lng: body.lng }, { lat: checkpoint.lat, lng: checkpoint.lng },
    ) * 1000;
    if (!allowLocalGeofenceBypass && distanceMeters > MAX_GEOFENCE_METERS) {
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
        where kind = 'roadside' and created_at > ${since}::timestamptz
          and (spotter_id = ${spotterId}::uuid or (${reporter.reporterId}::uuid is not null and reporter_id = ${reporter.reporterId}::uuid)) limit 1
      `;
      if (recentTap.length) {
        return jsonError('One roadside report per browser session is allowed every 5 minutes.', 429, 'SPOTTER_RATE_LIMIT');
      }
    }

    const beaconMovingAtHighwaySpeed =
      body.kind === 'rider_beacon' && impliedSpeedKmh !== null && impliedSpeedKmh >= 20 && impliedSpeedKmh <= 90;
    const nowIso = receivedAt.toISOString();
    const observedAtIso = observedAtDate.toISOString();

    const routeUpdate = !trip.route_locked ? reclassifyRoute(checkpoint.code, trip.route_id, trip.route_candidate) : { routeId: trip.route_id, locked: true, candidate: trip.route_candidate };
    const finalRows = await sql`select checkpoint_id from public.route_checkpoints where route_id = ${routeUpdate.routeId} order by sequence desc limit 1`;
    const finalCheckpoint = finalRows[0] as { checkpoint_id: string } | undefined;
    const tripArrived = finalCheckpoint?.checkpoint_id === checkpoint.id;
    const consensusSince = new Date(observedAtDate.getTime() - RATE_LIMIT_MINUTES * 60_000).toISOString();
    const consensusUntil = new Date(observedAtDate.getTime() + RATE_LIMIT_MINUTES * 60_000).toISOString();
    const rateSince = new Date(receivedAt.getTime() - RATE_LIMIT_MINUTES * 60_000).toISOString();
    const transactionResults = await sql.transaction([
      sql`select pg_advisory_xact_lock(hashtextextended(${reporter.reporterId ?? spotterId}, 0))`,
      sql`select pg_advisory_xact_lock(hashtextextended(${trip.id}, 0))`,
      sql`with locked_trip as (select id from public.trips where id = ${trip.id}::uuid and status = 'active'
          and last_checkpoint_id is not distinct from ${trip.last_checkpoint_id}::uuid
          and last_checkpoint_at is not distinct from ${trip.last_checkpoint_at}::timestamptz for update)
        insert into public.sightings (trip_id, checkpoint_id, spotter_id, reporter_id, kind, lat, lng, distance_meters, gps_accuracy_m, implied_speed_kmh, is_verified, confidence_status, rider_status, observed_at, verified_at, idempotency_key)
        select ${trip.id}::uuid, ${checkpoint.id}::uuid, ${spotterId}::uuid, ${reporter.reporterId}::uuid, ${body.kind}, ${body.lat}, ${body.lng}, ${Math.round(distanceMeters * 10) / 10}, ${gpsAccuracyM},
          ${impliedSpeedKmh === null ? null : Math.round(impliedSpeedKmh * 10) / 10}, false, 'unverified', ${body.riderStatus ?? null}, ${observedAtIso}::timestamptz, null, ${requestId}::uuid
        from locked_trip where (${body.kind !== 'roadside'}::boolean or not exists (select 1 from public.sightings where kind = 'roadside' and created_at > ${rateSince}::timestamptz and (spotter_id = ${spotterId}::uuid or (${reporter.reporterId}::uuid is not null and reporter_id = ${reporter.reporterId}::uuid))))
        on conflict (idempotency_key) do nothing returning id`,
      sql`update public.sightings set is_verified = true, confidence_status = 'verified', verified_at = ${nowIso}::timestamptz
        where trip_id = ${trip.id}::uuid and checkpoint_id = ${checkpoint.id}::uuid
          and observed_at between ${consensusSince}::timestamptz and ${consensusUntil}::timestamptz
          and (${beaconMovingAtHighwaySpeed}::boolean or (select count(distinct coalesce(reporter_id,spotter_id)) from public.sightings where trip_id = ${trip.id}::uuid and checkpoint_id = ${checkpoint.id}::uuid and observed_at between ${consensusSince}::timestamptz and ${consensusUntil}::timestamptz) >= 2)`,
      sql`update public.trip_rider_sessions set last_seen_at = ${nowIso}::timestamptz where trip_id = ${trip.id}::uuid and spotter_id = ${spotterId}::uuid and ${body.kind === 'rider_beacon'}::boolean`,
      sql`update public.trips
        set route_id = case when exists (select 1 from public.sightings where idempotency_key = ${requestId}::uuid and is_verified) then ${routeUpdate.routeId} else route_id end,
            route_locked = case when exists (select 1 from public.sightings where idempotency_key = ${requestId}::uuid and is_verified) then ${routeUpdate.locked} else route_locked end,
            route_candidate = case when exists (select 1 from public.sightings where idempotency_key = ${requestId}::uuid and is_verified) then ${routeUpdate.candidate} else route_candidate end,
            last_checkpoint_id = case when exists (select 1 from public.sightings where idempotency_key = ${requestId}::uuid and is_verified) then ${checkpoint.id}::uuid else last_checkpoint_id end,
            last_checkpoint_at = case when exists (select 1 from public.sightings where idempotency_key = ${requestId}::uuid and is_verified) then ${observedAtIso}::timestamptz else last_checkpoint_at end,
            last_lat = case when exists (select 1 from public.sightings where idempotency_key = ${requestId}::uuid and is_verified) then ${body.lat} else last_lat end,
            last_lng = case when exists (select 1 from public.sightings where idempotency_key = ${requestId}::uuid and is_verified) then ${body.lng} else last_lng end,
            confidence_status = case when exists (select 1 from public.sightings where idempotency_key = ${requestId}::uuid and is_verified) then 'verified' else 'unverified' end,
            pending_checkpoint_id = case when exists (select 1 from public.sightings where idempotency_key = ${requestId}::uuid and is_verified) then null else ${checkpoint.id}::uuid end,
            pending_reported_at = case when exists (select 1 from public.sightings where idempotency_key = ${requestId}::uuid and is_verified) then null else ${observedAtIso}::timestamptz end,
            rider_status = coalesce(${body.riderStatus ?? null}, rider_status),
            rider_status_at = case when ${body.riderStatus ?? null}::text is null then rider_status_at else ${nowIso}::timestamptz end,
            status = case when exists (select 1 from public.sightings where idempotency_key = ${requestId}::uuid and is_verified) and ${tripArrived}::boolean then 'arrived' else status end
        where id = ${trip.id}::uuid and status = 'active' and last_checkpoint_id is not distinct from ${trip.last_checkpoint_id}::uuid
          and last_checkpoint_at is not distinct from ${trip.last_checkpoint_at}::timestamptz
          and exists (select 1 from public.sightings where idempotency_key = ${requestId}::uuid and trip_id = ${trip.id}::uuid and spotter_id = ${spotterId}::uuid)`,
      sql`with segment as (
          select prev.sequence as from_sequence, next.eta_offset_minutes - prev.eta_offset_minutes as baseline_minutes
          from public.route_checkpoints prev join public.route_checkpoints next on next.route_id=prev.route_id and next.sequence=prev.sequence+1
          where prev.route_id=${routeUpdate.routeId} and prev.checkpoint_id=${trip.last_checkpoint_id}::uuid and next.checkpoint_id=${checkpoint.id}::uuid
        ), consensus as (
          select percentile_cont(0.5) within group(order by extract(epoch from s.observed_at)) as median_received_epoch,
            count(distinct s.reporter_id)::int as reporter_count, avg(s.gps_accuracy_m) as mean_accuracy
          from public.sightings s where s.trip_id=${trip.id}::uuid and s.checkpoint_id=${checkpoint.id}::uuid and s.is_verified=true
            and s.reporter_id is not null and s.observed_at between ${consensusSince}::timestamptz and ${consensusUntil}::timestamptz
        ) insert into public.eta_calibration_samples
          (trip_id,route_id,from_checkpoint_id,to_checkpoint_id,bus_type,baseline_minutes,observed_minutes,reporter_count,mean_gps_accuracy_m,quality_score,observed_at)
        select ${trip.id}::uuid,${routeUpdate.routeId},${trip.last_checkpoint_id}::uuid,${checkpoint.id}::uuid,${trip.bus_type},
          segment.baseline_minutes, (consensus.median_received_epoch-extract(epoch from ${trip.last_checkpoint_at ?? trip.departure_at}::timestamptz))/60.0,
          consensus.reporter_count,consensus.mean_accuracy,greatest(0,least(100,100-consensus.mean_accuracy*0.5)),to_timestamp(consensus.median_received_epoch)
        from segment cross join consensus
        where consensus.reporter_count>=2 and consensus.mean_accuracy<=40 and segment.baseline_minutes>0
          and (consensus.median_received_epoch-extract(epoch from ${trip.last_checkpoint_at ?? trip.departure_at}::timestamptz))/60.0 between 2 and 180
        on conflict(trip_id,to_checkpoint_id) do nothing returning id,route_id,from_checkpoint_id,to_checkpoint_id,bus_type` ,
      sql`select s.id as sighting_id, s.is_verified, t.status,
          (select count(distinct coalesce(reporter_id,spotter_id)) from public.sightings where trip_id = ${trip.id}::uuid and checkpoint_id = ${checkpoint.id}::uuid and observed_at between ${consensusSince}::timestamptz and ${consensusUntil}::timestamptz) as distinct_spotters
        from public.sightings s join public.trips t on t.id = s.trip_id where s.idempotency_key = ${requestId}::uuid and s.trip_id = ${trip.id}::uuid and s.spotter_id = ${spotterId}::uuid limit 1`
    ], { isolationLevel: 'ReadCommitted' });
    const insertedRows = transactionResults[2] ?? [];
    const calibrationRows = transactionResults[6] ?? [];
    const outcome = (transactionResults[7] ?? [])[0] as { sighting_id: string; is_verified: boolean; status: string; distinct_spotters: number } | undefined;
    if (!outcome) {
      const recentTap = body.kind === 'roadside' ? await sql`select id from public.sightings where kind = 'roadside' and created_at > ${rateSince}::timestamptz and (spotter_id = ${spotterId}::uuid or (${reporter.reporterId}::uuid is not null and reporter_id = ${reporter.reporterId}::uuid)) limit 1` : [];
      if (recentTap.length) return jsonError('One roadside report per secure browser session is allowed every 5 minutes.', 429, 'SPOTTER_RATE_LIMIT');
      return jsonError('The trip changed while this report was being checked. Refresh the board and try again.', 409, 'CONCURRENT_TRIP_UPDATE');
    }
    const verified = outcome.is_verified === true; const distinctSpotters = Number(outcome.distinct_spotters ?? 0); const arrived = outcome.status === 'arrived';
    if (calibrationRows.length && trip.last_checkpoint_id) {
      try { await recalibrateSegment(sql, routeUpdate.routeId, trip.last_checkpoint_id, checkpoint.id, trip.bus_type); }
      catch (calibrationError) { console.error('ETA segment recalibration failed', calibrationError); }
    }
    return NextResponse.json({ sightingId: outcome.sighting_id, verified, confidence: verified ? 'verified' : 'unverified', distinctSpotters, checkpoint: checkpoint.name,
      routeId: verified ? routeUpdate.routeId : trip.route_id, routeLocked: verified ? routeUpdate.locked : trip.route_locked, arrived, impliedSpeedKmh, duplicate: insertedRows.length === 0,
      message: verified ? 'Verified passed.' : 'Unverified sighting — awaiting another browser session or a moving Rider Beacon.'
    }, { status: insertedRows.length ? 201 : 200 });

  } catch (error) {
    console.error('ByahePanay sighting validation failed', error);
    return jsonError('Could not validate this sighting. Please retry.', 500);
  }
}
