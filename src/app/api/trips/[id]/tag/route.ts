import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase';
import { adminUnavailable, jsonError, isUuid } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getAdminSupabase();
  if (!supabase) return adminUnavailable();
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError('Invalid trip identifier.');
  let body: { bodyNumber?: string; plateNumber?: string; spotterId?: string };
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }
  if (!isUuid(body.spotterId)) return jsonError('Missing browser session identity.');
  const bodyNumber = body.bodyNumber?.trim();
  const plateNumber = body.plateNumber?.trim() || null;
  if (!bodyNumber || bodyNumber.length > 20) return jsonError('Enter a valid Ceres body number (maximum 20 characters).');
  if (plateNumber && plateNumber.length > 16) return jsonError('Plate number is too long.');

  const { data: tripOwner } = await supabase.from('trip_creator_sessions').select('spotter_id').eq('trip_id', id).maybeSingle();
  const { data: activeTrip } = await supabase.from('trips').select('id').eq('id', id).eq('status', 'active').maybeSingle();
  if (!activeTrip || !tripOwner || tripOwner.spotter_id !== body.spotterId) return jsonError('Only the browser session that logged this departure can attach a bus tag.', 403);
  const bus = await supabase.from('buses').upsert({ body_number: bodyNumber, plate_number: plateNumber }, { onConflict: 'body_number' }).select('id,body_number,plate_number').single();
  if (bus.error || !bus.data) return jsonError(bus.error?.message ?? 'Unable to save bus tag.', 500);
  const tagged = await supabase.from('trips').update({ bus_id: bus.data.id }).eq('id', id).eq('status', 'active').select('id').maybeSingle();
  if (tagged.error || !tagged.data) return jsonError(tagged.error?.message ?? 'Active trip not found.', 404);
  return NextResponse.json({ bus: bus.data });
}
