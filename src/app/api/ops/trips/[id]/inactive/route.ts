import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { jsonError, isSameOriginRequest, isUuid } from '@/lib/http';
import { getSpotterSessionId } from '@/lib/spotter-session';
import { isDeveloperAdmin } from '@/lib/admin-verification';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return jsonError('Cross-origin write requests are not allowed.', 403, 'CROSS_SITE_REQUEST');
  }

  const spotterId = getSpotterSessionId(request);
  if (!spotterId) {
    return jsonError('Secure browser session is missing or expired.', 401, 'SESSION_REQUIRED');
  }

  const { id } = await context.params;
  if (!isUuid(id)) return jsonError('Invalid trip identifier.', 400, 'INVALID_TRIP_ID');

  let body: { reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON request body.', 400, 'INVALID_JSON');
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 10 || reason.length > 500) {
    return jsonError('Enter an administrative reason between 10 and 500 characters.', 422, 'INVALID_REASON');
  }

  const sql = getDb();
  if (!sql) return jsonError('Operations database is unavailable.', 503, 'DATABASE_UNAVAILABLE');

  try {
    if (!(await isDeveloperAdmin(sql, spotterId))) {
      return jsonError('Developer administrator access required.', 403, 'ADMIN_REQUIRED');
    }

    const rows = await sql`
      with changed as (
        update public.trips
        set status = 'inactive',
            inactive_at = now(),
            inactive_by_spotter_id = ${spotterId}::uuid,
            inactive_reason = ${reason}
        where id = ${id}::uuid
          and status = 'active'
          and coalesce(last_checkpoint_at, departure_at) <= now() - interval '90 minutes'
        returning id
      ),
      audit as (
        insert into public.trip_status_events
          (trip_id, previous_status, new_status, reason, actor_spotter_id)
        select id, 'active', 'inactive', ${reason}, ${spotterId}::uuid
        from changed
        returning trip_id, created_at
      )
      select trip_id, created_at from audit
    `;

    if (!rows.length) {
      return jsonError(
        'This trip is no longer active or has a checkpoint confirmation newer than 90 minutes. Refresh the review list before retrying.',
        409,
        'TRIP_NOT_ELIGIBLE_FOR_INACTIVE',
      );
    }

    return NextResponse.json({
      inactive: true,
      tripId: id,
      inactiveAt: (rows[0] as { created_at: string }).created_at,
      message: 'Trip marked inactive. Its reports and history have been retained.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('BiyahePanay admin trip deactivation failed', error);
    return jsonError('Unable to mark this trip inactive.', 500, 'TRIP_INACTIVE_FAILED');
  }
}
