import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adminUnavailable, jsonError, isUuid, isSameOriginRequest } from '@/lib/http';
import { getSpotterSessionId } from '@/lib/spotter-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return jsonError('Cross-origin write requests are not allowed.', 403, 'CROSS_SITE_REQUEST');
  const spotterId = getSpotterSessionId(request);
  if (!spotterId) return jsonError('Secure browser session is missing or expired. Refresh the app and try again.', 401, 'SESSION_REQUIRED');
  const sql = getDb();
  if (!sql) return adminUnavailable();
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError('Invalid trip identifier.');

  try {
    const active = await sql`select id from public.trips where id = ${id}::uuid and status = 'active' limit 1`;
    if (!active.length) return jsonError('Active trip not found.', 404);
    await sql`
      insert into public.trip_rider_sessions (trip_id, spotter_id, last_seen_at)
      values (${id}::uuid, ${spotterId}::uuid, now())
      on conflict (trip_id, spotter_id) do update set last_seen_at = excluded.last_seen_at
    `;
    return NextResponse.json({ joined: true });
  } catch (error) {
    console.error('ByahePanay rider join failed', error);
    return jsonError('Could not join Rider Beacon mode.', 500);
  }
}
