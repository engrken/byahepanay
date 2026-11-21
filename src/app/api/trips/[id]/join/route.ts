import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase';
import { adminUnavailable, jsonError, isUuid } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getAdminSupabase();
  if (!supabase) return adminUnavailable();
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError('Invalid trip identifier.');
  let body: { spotterId?: string };
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }
  if (!isUuid(body.spotterId)) return jsonError('Missing browser session identity.');
  const { data: trip } = await supabase.from('trips').select('id').eq('id', id).eq('status', 'active').maybeSingle();
  if (!trip) return jsonError('Active trip not found.', 404);
  const { error } = await supabase.from('trip_rider_sessions').upsert({
    trip_id: id, spotter_id: body.spotterId, last_seen_at: new Date().toISOString(),
  }, { onConflict: 'trip_id,spotter_id' });
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ joined: true });
}
