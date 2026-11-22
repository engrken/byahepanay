import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adminUnavailable, jsonError, isSameOriginRequest, isUuid } from '@/lib/http';
import { createSpotterSessionToken, SPOTTER_SESSION_COOKIE } from '@/lib/session-core';
import { getSpotterSessionId } from '@/lib/spotter-session';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store, private' };
  if (getSpotterSessionId(request)) return NextResponse.json({ sessionReady: true }, { headers });
  const secret = process.env.SPOTTER_SESSION_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: 'Secure reporting is not configured. Contact the app administrator.', code: 'SESSION_SECRET_MISSING' }, { status: 503, headers });
  const session = createSpotterSessionToken(secret);
  const response = NextResponse.json({ sessionReady: true }, { headers });
  response.cookies.set(SPOTTER_SESSION_COOKIE, session.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: session.maxAge });
  return response;
}

/** One-time compatibility handoff for active trips created before signed sessions were introduced. */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError('Cross-origin requests are not allowed.', 403, 'CROSS_SITE_REQUEST');
  const spotterId = getSpotterSessionId(request);
  if (!spotterId) return jsonError('Initialize a secure browser session before migrating trip ownership.', 401, 'SESSION_REQUIRED');
  let body: { legacySpotterId?: string };
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }
  const legacySpotterId = body.legacySpotterId;
  if (!legacySpotterId || legacySpotterId === spotterId) return NextResponse.json({ sessionReady: true, migrated: false }, { headers: { 'Cache-Control': 'no-store, private' } });
  if (!isUuid(legacySpotterId)) return jsonError('The legacy browser identifier is invalid.', 400, 'INVALID_LEGACY_SESSION');
  const sql = getDb();
  if (!sql) return adminUnavailable();
  try {
    const eligible = await sql`
      select t.id from public.trips t
      where t.status = 'active' and (
        exists (select 1 from public.trip_creator_sessions c where c.trip_id = t.id and c.spotter_id = ${legacySpotterId}::uuid)
        or exists (select 1 from public.trip_rider_sessions r where r.trip_id = t.id and r.spotter_id = ${legacySpotterId}::uuid)
      ) limit 100
    `;
    if (!eligible.length) return NextResponse.json({ sessionReady: true, migrated: false }, { headers: { 'Cache-Control': 'no-store, private' } });
    const results = await sql.transaction([
      sql`select pg_advisory_xact_lock(hashtextextended(${legacySpotterId}, 0))`,
      sql`delete from public.trip_rider_sessions old_session using public.trips t
        where old_session.trip_id = t.id and t.status = 'active' and old_session.spotter_id = ${legacySpotterId}::uuid
          and exists (select 1 from public.trip_rider_sessions new_session where new_session.trip_id = t.id and new_session.spotter_id = ${spotterId}::uuid)`,
      sql`update public.trip_creator_sessions c set spotter_id = ${spotterId}::uuid from public.trips t
        where c.trip_id = t.id and t.status = 'active' and c.spotter_id = ${legacySpotterId}::uuid returning c.trip_id`,
      sql`update public.trip_rider_sessions r set spotter_id = ${spotterId}::uuid from public.trips t
        where r.trip_id = t.id and t.status = 'active' and r.spotter_id = ${legacySpotterId}::uuid returning r.trip_id`,
      sql`update public.sightings s set spotter_id = ${spotterId}::uuid from public.trips t
        where s.trip_id = t.id and t.status = 'active' and s.spotter_id = ${legacySpotterId}::uuid returning s.id`
    ], { isolationLevel: 'ReadCommitted' });
    return NextResponse.json({
      sessionReady: true, migrated: true,
      creatorTrips: results[2]?.length ?? 0,
      riderTrips: results[3]?.length ?? 0,
      sightings: results[4]?.length ?? 0,
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('Legacy trip session migration failed', error);
    return jsonError('Could not migrate your active trip session. Refresh the app and retry.', 500, 'SESSION_MIGRATION_FAILED');
  }
}
