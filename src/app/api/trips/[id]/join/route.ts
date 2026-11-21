import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adminUnavailable, jsonError, isUuid } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const sql = getDb();
  if (!sql) return adminUnavailable();
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError('Invalid trip identifier.');
  let body: { spotterId?: string };
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }
  if (!isUuid(body.spotterId)) return jsonError('Missing browser session identity.');

  try {
    const active = await sql`select id from public.trips where id = ${id}::uuid and status = 'active' limit 1`;
    if (!active.length) return jsonError('Active trip not found.', 404);
    await sql`
      insert into public.trip_rider_sessions (trip_id, spotter_id, last_seen_at)
      values (${id}::uuid, ${body.spotterId}::uuid, now())
      on conflict (trip_id, spotter_id) do update set last_seen_at = excluded.last_seen_at
    `;
    return NextResponse.json({ joined: true });
  } catch (error) {
    console.error('ByahePanay rider join failed', error);
    return jsonError('Could not join Rider Beacon mode.', 500);
  }
}
