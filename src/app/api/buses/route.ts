import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adminUnavailable, jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sql = getDb();
  if (!sql) return adminUnavailable();
  const bodyNumber = request.nextUrl.searchParams.get('bodyNumber')?.trim();
  if (!bodyNumber || bodyNumber.length > 20) return jsonError('Enter a body number to look up.');

  try {
    const rows = await sql`
      select body_number, plate_number, bus_type from public.buses
      where body_number = ${bodyNumber} limit 1
    `;
    const bus = rows[0] as { body_number: string; plate_number: string | null; bus_type: string | null } | undefined;
    if (!bus) return jsonError('No registry match. You can still tag the trip with this body number.', 404);
    return NextResponse.json({ bus });
  } catch (error) {
    console.error('ByahePanay bus lookup failed', error);
    return jsonError('Bus registry lookup failed.', 502);
  }
}
