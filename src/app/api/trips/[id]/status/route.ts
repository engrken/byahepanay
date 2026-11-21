import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase';
import { adminUnavailable, jsonError, isUuid } from '@/lib/http';

export const dynamic = 'force-dynamic';
const ALLOWED = ['seats_available', 'standing_only', 'stopped_cargo_traffic_10m', 'mechanical_breakdown', 'moving'];

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getAdminSupabase();
  if (!supabase) return adminUnavailable();
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError('Invalid trip identifier.');
  let body: { status?: string; spotterId?: string };
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }
  if (!body.status || !ALLOWED.includes(body.status)) return jsonError('Choose a supported rider status.');
  if (!isUuid(body.spotterId)) return jsonError('Missing browser session identity.');
  const { data: riderSession } = await supabase.from('trip_rider_sessions').select('trip_id').eq('trip_id', id).eq('spotter_id', body.spotterId).maybeSingle();
  if (!riderSession) return jsonError('Join Rider Beacon mode before posting a passenger status.', 403);
  const updatedAt = new Date().toISOString();
  await supabase.from('trip_rider_sessions').update({ last_seen_at: updatedAt }).eq('trip_id', id).eq('spotter_id', body.spotterId);
  const { error } = await supabase.from('trips').update({ rider_status: body.status, rider_status_at: updatedAt }).eq('id', id).eq('status', 'active');
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true, status: body.status });
}
