import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase';
import { haversineKm } from '@/lib/geo';
import { adminUnavailable, jsonError, isUuid } from '@/lib/http';

export const dynamic = 'force-dynamic';

const MAX_GEOFENCE_METERS = 300;
const MAX_SPEED_KMH = 95;
const RATE_LIMIT_MINUTES = 5;

interface SightingPayload {
  tripId?: string;
  checkpointId?: string;
  lat?: number;
  lng?: number;
  kind?: 'roadside' | 'rider_beacon';
  spotterId?: string;
  riderStatus?: string;
  observedAt?: string;
}

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
  if (code === 'altavas' && (currentRoute === 'kalibo_mambusao' || candidateRoute === 'kalibo_mambusao')) return { routeId: 'kalibo_mambusao', locked: true, candidate: null };
  if (code === 'jamindan' || code === 'tapaz' || code === 'calinog') return { routeId: 'tapaz', locked: true, candidate: null };
  return { routeId: currentRoute, locked: false, candidate: candidateRoute };
}

export async function POST(request: NextRequest) {
  const supabase = getAdminSupabase();
  if (!supabase) return adminUnavailable();

  let body: SightingPayload;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }
  if (!isUuid(body.tripId) || !isUuid(body.checkpointId)) return jsonError('A valid active trip and checkpoint are required.');
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number' || !Number.isFinite(body.lat) || !Number.isFinite(body.lng) || Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) {
    return jsonError('A valid GPS latitude and longitude are required.');
  }
  if (body.kind !== 'roadside' && body.kind !== 'rider_beacon') return jsonError('Unknown sighting type.');

  if (!isUuid(body.spotterId)) return jsonError('A valid browser session identifier is required.');
  const spotterId = body.spotterId;
  const [{ data: trip, error: tripError }, { data: checkpoint, error: checkpointError }] = await Promise.all([
    supabase.from('trips').select('id,route_id,bus_type,departure_at,status,last_checkpoint_id,last_checkpoint_at,last_lat,last_lng,route_locked,route_candidate').eq('id', body.tripId).single(),
    supabase.from('checkpoints').select('id,code,name,lat,lng').eq('id', body.checkpointId).single(),
  ]);
  if (tripError || !trip || trip.status !== 'active') return jsonError('This trip is no longer active.', 404);
  if (checkpointError || !checkpoint) return jsonError('Checkpoint not found.');

  if (body.kind === 'rider_beacon') {
    const { data: riderSession } = await supabase.from('trip_rider_sessions')
      .select('trip_id').eq('trip_id', trip.id).eq('spotter_id', spotterId).maybeSingle();
    if (!riderSession) return jsonError('Join Rider Beacon mode on this trip before sending beacon pings.', 403, 'RIDER_SESSION_REQUIRED');
    await supabase.from('trip_rider_sessions').update({ last_seen_at: new Date().toISOString() })
      .eq('trip_id', trip.id).eq('spotter_id', spotterId);
  }

  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
  const distanceMeters = haversineKm({ lat: body.lat, lng: body.lng }, { lat: checkpoint.lat, lng: checkpoint.lng }) * 1000;
  if (!testMode && distanceMeters > MAX_GEOFENCE_METERS) {
    return jsonError(`GPS is ${Math.round(distanceMeters)} m from ${checkpoint.name}; sightings must be within ${MAX_GEOFENCE_METERS} m.`, 422, 'OUTSIDE_GEOFENCE');
  }

  const receivedAt = new Date();
  const observedAtDate = body.observedAt ? new Date(body.observedAt) : receivedAt;
  if (!Number.isFinite(observedAtDate.getTime()) || observedAtDate.getTime() > receivedAt.getTime() + 120_000) return jsonError('Invalid observation timestamp.', 422, 'INVALID_OBSERVED_AT');
  const previousTime = new Date(trip.last_checkpoint_at ?? trip.departure_at).getTime();
  if (observedAtDate.getTime() < previousTime) return jsonError('This queued GPS report is older than the latest confirmed checkpoint.', 409, 'OUT_OF_ORDER_SIGHTING');
  const elapsedHours = Math.max(0, (observedAtDate.getTime() - previousTime) / 3_600_000);
  let impliedSpeedKmh: number | null = null;
  let segmentDistanceKm = 0;
  if (trip.last_lat !== null && trip.last_lng !== null) {
    segmentDistanceKm = haversineKm({ lat: trip.last_lat, lng: trip.last_lng }, { lat: checkpoint.lat, lng: checkpoint.lng });
    if (elapsedHours > 0) impliedSpeedKmh = segmentDistanceKm / elapsedHours;
    else if (segmentDistanceKm > 0.05) impliedSpeedKmh = Number.POSITIVE_INFINITY;
  }

  if (trip.last_checkpoint_id === checkpoint.id) return jsonError('This checkpoint is already the trip’s latest confirmed stop.', 409, 'DUPLICATE_CHECKPOINT');
  if (impliedSpeedKmh !== null && impliedSpeedKmh > MAX_SPEED_KMH) {
    return jsonError(`Implied speed ${impliedSpeedKmh.toFixed(1)} km/h exceeds the ${MAX_SPEED_KMH} km/h validation limit.`, 422, 'IMPLAUSIBLE_SPEED');
  }
  if (impliedSpeedKmh !== null && impliedSpeedKmh < 5 && segmentDistanceKm > 0.3) {
    return jsonError('This report implies less than 5 km/h since the previous town and was treated as a stale or out-of-order tap.', 422, 'STALE_TAP');
  }

  // Resolve the route used for sequence validation before locking the branch.
  // Mambusao is common to the provisional Kalibo-via-Mambusao and Tapaz paths;
  // Altavas confirms Kalibo while Jamindan confirms Tapaz.
  const sequenceRouteId = routeForSequence(checkpoint.code, trip.route_id, trip.route_candidate, trip.route_locked);
  const { data: membershipsRaw } = await supabase.from('route_checkpoints').select('route_id,sequence').eq('checkpoint_id', checkpoint.id);
  const memberships = (membershipsRaw ?? []) as Array<{ route_id: string; sequence: number }>;
  if (!memberships.length) return jsonError('This checkpoint is not mapped to a supported corridor.', 422);
  const targetMembership = memberships.find((membership) => membership.route_id === sequenceRouteId);
  if (!targetMembership) return jsonError('Checkpoint is not on the resolved corridor or a supported branch.', 422, 'ROUTE_MISMATCH');

  if (trip.last_checkpoint_id) {
    const { data: previousLink } = await supabase.from('route_checkpoints').select('sequence')
      .eq('route_id', sequenceRouteId).eq('checkpoint_id', trip.last_checkpoint_id).maybeSingle();
    if (!previousLink) return jsonError('The last confirmed checkpoint does not belong to this branch; route sequence cannot be verified.', 409, 'BRANCH_SEQUENCE_MISMATCH');
    if (targetMembership.sequence <= previousLink.sequence) {
      return jsonError('This checkpoint is behind the last confirmed stop on the selected corridor.', 409, 'OUT_OF_ORDER_CHECKPOINT');
    }
  }

  if (body.kind === 'roadside') {
    const since = new Date(Date.now() - RATE_LIMIT_MINUTES * 60_000).toISOString();
    const { data: recentTap } = await supabase.from('sightings').select('id').eq('spotter_id', spotterId).eq('kind', 'roadside').gt('created_at', since).limit(1).maybeSingle();
    if (recentTap) return jsonError('One roadside report per browser session is allowed every 5 minutes.', 429, 'SPOTTER_RATE_LIMIT');
  }

  const beaconMovingAtHighwaySpeed = body.kind === 'rider_beacon' && impliedSpeedKmh !== null && impliedSpeedKmh >= 20 && impliedSpeedKmh <= 90;
  const nowIso = receivedAt.toISOString();
  const observedAtIso = observedAtDate.toISOString();
  const insertResult = await supabase.from('sightings').insert({
    trip_id: trip.id,
    checkpoint_id: checkpoint.id,
    spotter_id: spotterId,
    kind: body.kind,
    lat: body.lat,
    lng: body.lng,
    distance_meters: Math.round(distanceMeters * 10) / 10,
    implied_speed_kmh: impliedSpeedKmh === null ? null : Math.round(impliedSpeedKmh * 10) / 10,
    is_verified: beaconMovingAtHighwaySpeed,
    confidence_status: beaconMovingAtHighwaySpeed ? 'verified' : 'unverified',
    rider_status: body.riderStatus ?? null,
    observed_at: observedAtIso,
    verified_at: beaconMovingAtHighwaySpeed ? nowIso : null,
  }).select('id').single();
  if (insertResult.error || !insertResult.data) return jsonError(insertResult.error?.message ?? 'Could not save sighting.', 500);

  const consensusSince = new Date(observedAtDate.getTime() - RATE_LIMIT_MINUTES * 60_000).toISOString();
  const consensusUntil = new Date(observedAtDate.getTime() + RATE_LIMIT_MINUTES * 60_000).toISOString();
  const { data: recentReportsRaw } = await supabase.from('sightings').select('spotter_id').eq('trip_id', trip.id).eq('checkpoint_id', checkpoint.id)
    .gte('observed_at', consensusSince).lte('observed_at', consensusUntil);
  const recentReports = (recentReportsRaw ?? []) as Array<{ spotter_id: string }>;
  const distinctSpotters = new Set(recentReports.map((row) => row.spotter_id)).size;
  const consensusVerified = distinctSpotters >= 2;
  const verified = beaconMovingAtHighwaySpeed || consensusVerified;

  if (verified) {
    await supabase.from('sightings').update({ is_verified: true, confidence_status: 'verified', verified_at: nowIso })
      .eq('trip_id', trip.id).eq('checkpoint_id', checkpoint.id).gte('observed_at', consensusSince).lte('observed_at', consensusUntil);
  }

  const routeUpdate = !trip.route_locked ? reclassifyRoute(checkpoint.code, trip.route_id, trip.route_candidate) : {
    routeId: trip.route_id, locked: true, candidate: trip.route_candidate,
  };

  let tripArrived = false;
  if (verified) {
    const { data: finalCheckpoint } = await supabase.from('route_checkpoints').select('checkpoint_id')
      .eq('route_id', routeUpdate.routeId).order('sequence', { ascending: false }).limit(1).maybeSingle();
    tripArrived = finalCheckpoint?.checkpoint_id === checkpoint.id;
    const update = await supabase.from('trips').update({
      route_id: routeUpdate.routeId,
      route_locked: routeUpdate.locked,
      route_candidate: routeUpdate.candidate,
      last_checkpoint_id: checkpoint.id,
      last_checkpoint_at: observedAtIso,
      last_lat: body.lat,
      last_lng: body.lng,
      confidence_status: 'verified',
      pending_checkpoint_id: null,
      pending_reported_at: null,
      rider_status: body.riderStatus ?? null,
      rider_status_at: body.riderStatus ? nowIso : undefined,
      status: tripArrived ? 'arrived' : 'active',
    }).eq('id', trip.id);
    if (update.error) return jsonError(update.error.message, 500);
  } else {
    await supabase.from('trips').update({
      confidence_status: 'unverified',
      pending_checkpoint_id: checkpoint.id,
      pending_reported_at: observedAtIso,
    }).eq('id', trip.id);
  }

  return NextResponse.json({
    sightingId: insertResult.data.id,
    verified,
    confidence: verified ? 'verified' : 'unverified',
    distinctSpotters,
    checkpoint: checkpoint.name,
    routeId: verified ? routeUpdate.routeId : trip.route_id,
    routeLocked: verified ? routeUpdate.locked : trip.route_locked,
    arrived: tripArrived,
    impliedSpeedKmh,
    message: verified ? 'Verified passed.' : 'Unverified sighting — awaiting another spotter or a moving rider beacon.',
  }, { status: 201 });
}
