import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ACTIVE_PRESENCE_WINDOW_MINUTES, ACTIVE_REPORT_WINDOW_MINUTES } from '@/lib/presence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const cacheHeaders = {
  'Cache-Control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
};
const errorHeaders = { 'Cache-Control': 'no-store' };

export async function GET() {
  const sql = getDb();
  if (!sql) {
    return NextResponse.json({
      error: 'Community activity counts are temporarily unavailable. Please try again in a moment.',
      code: 'PRESENCE_UNAVAILABLE',
    }, { status: 503, headers: errorHeaders });
  }

  try {
    // Return aggregate counts only. No session IDs, reporter IDs, names, or email data leave the database.
    const rows = await sql`select
      (select count(distinct spotter_id)::int
        from public.app_presence
        where last_seen_at > now() - (${ACTIVE_PRESENCE_WINDOW_MINUTES}::int * interval '1 minute')) as active_visitors_now,
      (select count(distinct reporter_id)::int
        from public.app_presence
        where reporter_id is not null
          and last_seen_at > now() - (${ACTIVE_PRESENCE_WINDOW_MINUTES}::int * interval '1 minute')) as active_contributors_now,
      (select count(distinct reporter_id)::int
        from public.sightings
        where reporter_id is not null
          and created_at > now() - (${ACTIVE_REPORT_WINDOW_MINUTES}::int * interval '1 minute')) as contributors_reporting_15m
    `;

    const counts = rows[0] ?? {};
    const toCount = (value: unknown) => {
      const count = Number(value ?? 0);
      return Number.isSafeInteger(count) && count >= 0 ? count : 0;
    };

    return NextResponse.json({
      active_visitors_now: toCount(counts.active_visitors_now),
      active_contributors_now: toCount(counts.active_contributors_now),
      contributors_reporting_15m: toCount(counts.contributors_reporting_15m),
      active_window_minutes: ACTIVE_PRESENCE_WINDOW_MINUTES,
      report_window_minutes: ACTIVE_REPORT_WINDOW_MINUTES,
      generated_at: new Date().toISOString(),
    }, { headers: cacheHeaders });
  } catch (error) {
    console.error('BiyahePanay public presence query failed', error);
    return NextResponse.json({
      error: 'Community activity counts are temporarily unavailable. Please try again in a moment.',
      code: 'PRESENCE_QUERY_FAILED',
    }, { status: 503, headers: errorHeaders });
  }
}
