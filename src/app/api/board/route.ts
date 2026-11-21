import { NextResponse } from 'next/server';
import { ROUTES } from '@/lib/corridors';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteRow = { id: string; name: string; short_name: string; destination: string };
type CheckpointRow = { id: string; code: string; name: string; lat: number; lng: number };
type RouteLinkRow = {
  route_id: string; checkpoint_id: string; sequence: number;
  eta_offset_minutes: number; segment_minutes: number; dwell_buffer_minutes: number;
};

export async function GET() {
  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ configured: false, routes: ROUTES, trips: [] }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  try {
    const [routeRows, checkpointRows, linkRows, tripRows] = await Promise.all([
      sql`select id, name, short_name, destination from public.routes where is_active = true order by id`,
      sql`select id, code, name, lat, lng from public.checkpoints`,
      sql`select route_id, checkpoint_id, sequence, eta_offset_minutes, segment_minutes, dwell_buffer_minutes
          from public.route_checkpoints order by route_id, sequence`,
      sql`select t.id, t.route_id, t.bus_type, t.departure_at, t.status,
                 t.last_checkpoint_id, t.last_checkpoint_at, t.last_lat, t.last_lng,
                 t.confidence_status, t.pending_checkpoint_id, t.pending_reported_at,
                 t.route_locked, t.route_candidate, t.rider_status,
                 b.body_number, b.plate_number
          from public.trips t
          left join public.buses b on b.id = t.bus_id
          where t.status in ('active', 'arrived')
          order by t.departure_at desc
          limit 40`,
    ]);

    const routesData = routeRows as RouteRow[];
    const checkpoints = checkpointRows as CheckpointRow[];
    const links = linkRows as RouteLinkRow[];
    const checkpointById = new Map(checkpoints.map((point) => [point.id, point]));

    const routes = routesData.map((route) => ({
      ...route,
      checkpoints: links
        .filter((link) => link.route_id === route.id)
        .map((link) => {
          const point = checkpointById.get(link.checkpoint_id);
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

    return NextResponse.json({ configured: true, routes, trips: tripRows }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('ByahePanay board query failed', error);
    return NextResponse.json({ error: 'Unable to load the live board.' }, { status: 502 });
  }
}
