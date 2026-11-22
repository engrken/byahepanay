import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adminUnavailable, jsonError, isUuid, isSameOriginRequest } from '@/lib/http';
import { getSpotterSessionId } from '@/lib/spotter-session';
import { requireReporterIdentity } from '@/lib/reporter-verification';

export const dynamic = 'force-dynamic';
const ALLOWED = ['seats_available', 'standing_only', 'stopped_cargo_traffic_10m', 'mechanical_breakdown', 'moving'];

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return jsonError('Cross-origin write requests are not allowed.', 403, 'CROSS_SITE_REQUEST');
  const spotterId = getSpotterSessionId(request);
  if (!spotterId) return jsonError('Secure browser session is missing or expired. Refresh the app and try again.', 401, 'SESSION_REQUIRED');
  const sql = getDb();
  if (!sql) return adminUnavailable();
  const reporter = await requireReporterIdentity(sql, spotterId);
  if (!reporter.allowed) return jsonError('Verify your email address with an email OTP before posting a passenger status.', 428, 'EMAIL_VERIFICATION_REQUIRED');
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError('Invalid trip identifier.');
  let body: { status?: string };
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }
  if (!body.status || !ALLOWED.includes(body.status)) return jsonError('Choose a supported rider status.');

  try {
    const session = await sql`
      select trip_id from public.trip_rider_sessions
      where trip_id = ${id}::uuid and spotter_id = ${spotterId}::uuid limit 1
    `;
    if (!session.length) return jsonError('Join Rider Beacon mode before posting a passenger status.', 403);
    const updatedAt = new Date().toISOString();
    await sql`
      update public.trip_rider_sessions set last_seen_at = ${updatedAt}::timestamptz
      where trip_id = ${id}::uuid and spotter_id = ${spotterId}::uuid
    `;
    const updated = await sql`
      update public.trips set rider_status = ${body.status}, rider_status_at = ${updatedAt}::timestamptz
      where id = ${id}::uuid and status = 'active' returning id
    `;
    if (!updated.length) return jsonError('Active trip not found.', 404);
    return NextResponse.json({ ok: true, status: body.status });
  } catch (error) {
    console.error('BiyahePanay rider status update failed', error);
    return jsonError('Rider status update failed.', 500);
  }
}
