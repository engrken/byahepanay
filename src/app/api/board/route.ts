import { NextResponse } from 'next/server';
import { ROUTES } from '@/lib/corridors';
import { getPublicServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type RouteRow = { id: string; name: string; short_name: string; destination: string };
type CheckpointRow = { id: string; code: string; name: string; lat: number; lng: number };
type RouteLinkRow = { route_id: string; checkpoint_id: string; sequence: number; eta_offset_minutes: number; segment_minutes: number; dwell_buffer_minutes: number };
type BusRow = { body_number?: string | null; plate_number?: string | null };
type TripRow = {
  id: string; route_id: string; bus_type: 'ordinary' | 'aircon'; departure_at: string; status: 'active' | 'arrived' | 'cancelled';
  last_checkpoint_id: string | null; last_checkpoint_at: string | null; last_lat: number | null; last_lng: number | null;
  confidence_status: 'scheduled' | 'unverified' | 'verified'; pending_checkpoint_id: string | null; pending_reported_at: string | null;
  route_locked: boolean; route_candidate: string | null; rider_status: string | null;
  bus?: BusRow | BusRow[] | null;
};

export async function GET() {
  const supabase = getPublicServerSupabase();
  if (!supabase) {
    return NextResponse.json({ configured: false, routes: ROUTES, trips: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const [routesResult, checkpointResult, linksResult, tripsResult] = await Promise.all([
    supabase.from('routes').select('id,name,short_name,destination').eq('is_active', true).order('id'),
    supabase.from('checkpoints').select('id,code,name,lat,lng'),
    supabase.from('route_checkpoints').select('route_id,checkpoint_id,sequence,eta_offset_minutes,segment_minutes,dwell_buffer_minutes').order('sequence'),
    supabase.from('trips').select('id,route_id,bus_type,departure_at,status,last_checkpoint_id,last_checkpoint_at,last_lat,last_lng,confidence_status,pending_checkpoint_id,pending_reported_at,route_locked,route_candidate,rider_status,bus:buses(body_number,plate_number)').in('status', ['active', 'arrived']).order('departure_at', { ascending: false }).limit(40),
  ]);

  const firstError = routesResult.error ?? checkpointResult.error ?? linksResult.error ?? tripsResult.error;
  if (firstError) {
    return NextResponse.json({ error: 'Unable to load live board', detail: firstError.message }, { status: 502 });
  }

  const routesData = (routesResult.data ?? []) as RouteRow[];
  const checkpointData = (checkpointResult.data ?? []) as CheckpointRow[];
  const linkData = (linksResult.data ?? []) as RouteLinkRow[];
  const tripData = (tripsResult.data ?? []) as TripRow[];

  const routes = routesData.map((route) => ({
    ...route,
    checkpoints: linkData
      .filter((link) => link.route_id === route.id)
      .map((link) => {
        const point = checkpointData.find((candidate) => candidate.id === link.checkpoint_id);
        return point ? {
          ...point,
          sequence: link.sequence,
          eta_offset_minutes: link.eta_offset_minutes,
          segment_minutes: link.segment_minutes,
          dwell_buffer_minutes: link.dwell_buffer_minutes,
        } : null;
      })
      .filter((point): point is NonNullable<typeof point> => point !== null),
  }));

  const trips = tripData.map((trip) => {
    const bus = Array.isArray(trip.bus) ? trip.bus[0] : trip.bus;
    return {
      ...trip,
      body_number: bus?.body_number ?? null,
      plate_number: bus?.plate_number ?? null,
      bus: undefined,
    };
  });

  return NextResponse.json({ configured: true, routes, trips }, { headers: { 'Cache-Control': 'no-store' } });
}
