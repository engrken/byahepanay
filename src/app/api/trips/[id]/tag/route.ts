import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adminUnavailable, jsonError, isUuid, isSameOriginRequest } from '@/lib/http';
import { getSpotterSessionId } from '@/lib/spotter-session';
import { requireReporterIdentity } from '@/lib/reporter-verification';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return jsonError('Cross-origin write requests are not allowed.', 403, 'CROSS_SITE_REQUEST');
  const spotterId = getSpotterSessionId(request);
  if (!spotterId) return jsonError('Secure browser session is missing or expired. Refresh the app and try again.', 401, 'SESSION_REQUIRED');
  const sql = getDb();
  if (!sql) return adminUnavailable();
  const reporter = await requireReporterIdentity(sql, spotterId);
  if (!reporter.allowed) return jsonError('Verify your email address with an email OTP before attaching a bus number.', 428, 'EMAIL_VERIFICATION_REQUIRED');
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError('Invalid trip identifier.');
  let body: { bodyNumber?: string; plateNumber?: string };
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }

  const bodyNumber = body.bodyNumber?.trim();
  const plateNumber = body.plateNumber?.trim() || null;
  if (!bodyNumber || bodyNumber.length > 20) return jsonError('Enter a valid bus number (maximum 20 characters).');
  if (plateNumber && plateNumber.length > 16) return jsonError('Plate number is too long.');

  try {
    const [ownerRows, tripRows] = await Promise.all([
      sql`select spotter_id from public.trip_creator_sessions where trip_id = ${id}::uuid limit 1`,
      sql`select id, bus_type from public.trips where id = ${id}::uuid and status = 'active' limit 1`,
    ]);
    const owner = ownerRows[0] as { spotter_id: string } | undefined;
    const trip = tripRows[0] as { id: string; bus_type: 'ordinary' | 'aircon' } | undefined;
    if (!trip || !owner || owner.spotter_id !== spotterId) {
      return jsonError('Only the browser session that logged this departure can attach a bus tag.', 403);
    }

    const busRows = await sql`
      insert into public.buses (body_number, plate_number, bus_type)
      values (${bodyNumber}, ${plateNumber}, ${trip.bus_type})
      on conflict (body_number)
      do update set plate_number = excluded.plate_number, bus_type = excluded.bus_type
      returning id, body_number, plate_number
    `;
    const bus = busRows[0] as { id: string; body_number: string; plate_number: string | null } | undefined;
    if (!bus) return jsonError('Unable to save bus tag.', 500);

    const tagged = await sql`
      update public.trips set bus_id = ${bus.id}::uuid
      where id = ${id}::uuid and status = 'active' returning id
    `;
    if (!tagged.length) return jsonError('Active trip not found.', 404);
    return NextResponse.json({ bus });
  } catch (error) {
    console.error('BiyahePanay trip tag failed', error);
    return jsonError('Unable to save bus tag.', 500);
  }
}
