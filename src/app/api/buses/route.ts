import { NextRequest, NextResponse } from 'next/server';
import { getPublicServerSupabase } from '@/lib/supabase';
import { jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = getPublicServerSupabase();
  if (!supabase) return jsonError('Supabase is not configured.', 503);
  const bodyNumber = request.nextUrl.searchParams.get('bodyNumber')?.trim();
  if (!bodyNumber || bodyNumber.length > 20) return jsonError('Enter a body number to look up.');
  const { data, error } = await supabase.from('buses').select('body_number,plate_number,bus_type').eq('body_number', bodyNumber).maybeSingle();
  if (error) return jsonError(error.message, 502);
  if (!data) return jsonError('No registry match. You can still tag the trip with this body number.', 404);
  return NextResponse.json({ bus: data });
}
