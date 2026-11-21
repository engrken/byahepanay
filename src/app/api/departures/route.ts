import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase';
import { adminUnavailable, jsonError, isUuid } from '@/lib/http';
import { haversineKm } from '@/lib/geo';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const supabase = getAdminSupabase();
  if (!supabase) return adminUnavailable();

  let body: { routeId?: string; busType?: string; spotterId?: string; bodyNumber?: string; plateNumber?: string; lat?: number; lng?: number };
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }
  const routeId = body.routeId;
  const busType = body.busType;
  if (!routeId || !['iloilo_passi', 'kalibo_mambusao', 'kalibo_sapian', 'tapaz', 'estancia'].includes(routeId)) {
    return jsonError('Choose a valid Panay corridor.');
  }
  if (busType !== 'ordinary' && busType !== 'aircon') return jsonError('Choose Ordinary or Aircon.');
  const bodyNumber = body.bodyNumber?.trim() || null;
  const plateNumber = body.plateNumber?.trim() || null;
  if (bodyNumber && bodyNumber.length > 20) return jsonError('Ceres body number must be 20 characters or fewer.');
  if (plateNumber && plateNumber.length > 16) return jsonError('Plate number must be 16 characters or fewer.');

  const [routeResult, originResult] = await Promise.all([
    supabase.from('routes').select('id').eq('id', routeId).single(),
    supabase.from('checkpoints').select('id,lat,lng').eq('code', 'pueblo_terminal').single(),
  ]);
  if (routeResult.error || originResult.error || !originResult.data) return jsonError('Corridor seed data is missing. Run supabase/schema.sql first.', 503);

  if (typeof body.lat !== 'number' || typeof body.lng !== 'number' || !Number.isFinite(body.lat) || !Number.isFinite(body.lng) || Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) {
    return jsonError('GPS location is required to verify a Pueblo departure.');
  }
  const originDistance = haversineKm({ lat: body.lat, lng: body.lng }, { lat: originResult.data.lat, lng: originResult.data.lng }) * 1000;
  if (process.env.NEXT_PUBLIC_TEST_MODE !== 'true' && originDistance > 300) {
    return jsonError(`You are ${Math.round(originDistance)} m from Pueblo Terminal. Departure reports must be logged within 300 m.`, 422, 'DEPARTURE_OUTSIDE_GEOFENCE');
  }

  if (!isUuid(body.spotterId)) return jsonError('A valid browser session identifier is required.');
  const spotterId = body.spotterId;
  const rateSince = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: recentDeparture } = await supabase.from('sightings').select('id').eq('spotter_id', spotterId).eq('kind', 'departure').gt('created_at', rateSince).limit(1).maybeSingle();
  if (recentDeparture) return jsonError('Please wait 2 minutes before logging another terminal departure from this browser.', 429, 'DEPARTURE_RATE_LIMIT');
  const departureAt = new Date().toISOString();
  const { data: trip, error } = await supabase.from('trips').insert({
    route_id: routeId,
    bus_type: busType,
    departure_at: departureAt,
    status: 'active',
    last_checkpoint_id: originResult.data.id,
    last_checkpoint_at: departureAt,
    last_lat: originResult.data.lat,
    last_lng: originResult.data.lng,
    confidence_status: 'verified',
  }).select('id,route_id,bus_type,departure_at,status,last_checkpoint_id,last_checkpoint_at,confidence_status').single();

  if (error || !trip) return jsonError(error?.message ?? 'Could not record departure.', 500);
  const creatorSession = await supabase.from('trip_creator_sessions').insert({ trip_id: trip.id, spotter_id: spotterId });
  if (creatorSession.error) {
    await supabase.from('trips').delete().eq('id', trip.id);
    return jsonError('Could not securely bind the departure to this browser session.', 500);
  }
  await supabase.from('sightings').insert({
    trip_id: trip.id,
    checkpoint_id: originResult.data.id,
    spotter_id: spotterId,
    kind: 'departure',
    lat: originResult.data.lat,
    lng: originResult.data.lng,
    distance_meters: Math.round(originDistance * 10) / 10,
    is_verified: true,
    confidence_status: 'verified',
    verified_at: departureAt,
  });

  if (bodyNumber) {
    const bus = await supabase.from('buses').upsert({
      body_number: bodyNumber,
      plate_number: plateNumber,
      bus_type: busType,
    }, { onConflict: 'body_number' }).select('id').single();
    if (bus.data) await supabase.from('trips').update({ bus_id: bus.data.id }).eq('id', trip.id);
  }

  return NextResponse.json({ trip: { ...trip, body_number: bodyNumber, plate_number: plateNumber } }, { status: 201 });
}
