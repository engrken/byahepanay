import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isSameOriginRequest, jsonError } from '@/lib/http';
import { getSpotterSessionId } from '@/lib/spotter-session';
import { requireReporterIdentity } from '@/lib/reporter-verification';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const noStore = { 'Cache-Control': 'no-store, private' };

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError('Cross-origin requests are not allowed.', 403, 'CROSS_SITE_REQUEST');
  const spotterId = getSpotterSessionId(request);
  if (!spotterId) return jsonError('Secure browser session is missing. Refresh the app and try again.', 401, 'SESSION_REQUIRED');
  const sql = getDb();
  if (!sql) return NextResponse.json({ error: 'Presence tracking is unavailable.' }, { status: 503, headers: noStore });

  try {
    const reporter = await requireReporterIdentity(sql, spotterId);
    await sql`insert into public.app_presence (spotter_id, reporter_id, created_at, last_seen_at)
      values (${spotterId}::uuid, ${reporter.reporterId}::uuid, now(), now())
      on conflict (spotter_id) do update
      set reporter_id = excluded.reporter_id, last_seen_at = now()`;
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) {
    console.error('BiyahePanay presence heartbeat failed', error);
    return NextResponse.json({ error: 'Could not update app presence.' }, { status: 503, headers: noStore });
  }
}
