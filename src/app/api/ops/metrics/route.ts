import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSpotterSessionId } from '@/lib/spotter-session';
import { isDeveloperAdmin } from '@/lib/admin-verification';
import { ACTIVE_PRESENCE_WINDOW_MINUTES, ACTIVE_REPORT_WINDOW_MINUTES } from '@/lib/presence';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const spotterId = getSpotterSessionId(request);
  if (!spotterId) {
    return NextResponse.json({ error: 'Developer administrator session required.' }, { status: 401, headers: noStore });
  }

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ configured: false, error: 'Database unavailable' }, { status: 503, headers: noStore });
  }

  try {
    if (!(await isDeveloperAdmin(sql, spotterId))) {
      return NextResponse.json({ error: 'Developer administrator access required.' }, { status: 403, headers: noStore });
    }

    const raw = Number(request.nextUrl.searchParams.get('days') ?? 30);
    const days = Number.isFinite(raw) ? Math.min(90, Math.max(7, Math.floor(raw))) : 30;
    const [daily, calibrations, alerts, health, summary, activeTrips, presence, checkpointReviews] = await Promise.all([
      sql`select metric_date,report_count,verified_report_count,otp_verified_report_count,unique_verified_reporters,median_gps_accuracy_m,median_report_distance_m,calibration_sample_count,calibrated_segment_count,average_quality_score
        from public.report_quality_daily
        where metric_date >= (now() at time zone 'Asia/Manila')::date - ${days}::int + 1
        order by metric_date`,
      sql`select c.route_id,r.short_name,fp.name from_checkpoint,tp.name to_checkpoint,c.bus_type,c.sample_count,c.median_minutes,c.p80_minutes,c.baseline_minutes,c.last_sample_at,c.updated_at
        from public.eta_segment_calibrations c
        join public.routes r on r.id=c.route_id
        join public.checkpoints fp on fp.id=c.from_checkpoint_id
        join public.checkpoints tp on tp.id=c.to_checkpoint_id
        where c.updated_at > now() - interval '90 days'
        order by c.route_id,fp.name,tp.name,c.bus_type`,
      sql`select alert_key,severity,message,first_seen_at,last_seen_at
        from public.ops_alerts where resolved_at is null
        order by severity desc,last_seen_at desc`,
      sql`select status,database_latency_ms,active_trip_count,stale_active_trip_count,calibration_segment_count,latest_sighting_at,created_at
        from public.ops_health_snapshots order by created_at desc limit 1`,
      sql`select
          coalesce(sum(report_count),0)::int reports,
          coalesce(sum(verified_report_count),0)::int verified_reports,
          coalesce(sum(otp_verified_report_count),0)::int otp_verified_reports,
          coalesce(max(unique_verified_reporters),0)::int peak_daily_verified_reporters,
          (select percentile_cont(0.5) within group(order by gps_accuracy_m)
             from public.sightings
             where created_at >= now() - (${days}::int * interval '1 day') and gps_accuracy_m is not null) median_gps_accuracy_m,
          (select count(*)::int from public.eta_calibration_samples
             where created_at >= now() - (${days}::int * interval '1 day')) calibration_samples,
          (select count(*)::int from public.eta_segment_calibrations
             where updated_at > now() - interval '90 days') calibrated_segments
        from public.report_quality_daily
        where metric_date >= (now() at time zone 'Asia/Manila')::date - ${days}::int + 1`,
      sql`select t.id,t.route_id,r.short_name,t.bus_type,t.departure_at,
          coalesce(t.last_checkpoint_at,t.departure_at) as last_checkpoint_at,
          c.name as last_checkpoint_name,t.rider_status,t.rider_status_at,b.body_number
        from public.trips t
        join public.routes r on r.id=t.route_id
        left join public.checkpoints c on c.id=t.last_checkpoint_id
        left join public.buses b on b.id=t.bus_id
        where t.status='active'
        order by coalesce(t.last_checkpoint_at,t.departure_at) asc
        limit 50`,

      sql`select
          (select count(distinct spotter_id)::int from public.app_presence
            where last_seen_at > now() - (${ACTIVE_PRESENCE_WINDOW_MINUTES}::int * interval '1 minute')) as active_users_now,
          (select count(distinct reporter_id)::int from public.app_presence
            where reporter_id is not null and last_seen_at > now() - (${ACTIVE_PRESENCE_WINDOW_MINUTES}::int * interval '1 minute')) as active_contributors_now,
          (select count(distinct reporter_id)::int from public.sightings
            where reporter_id is not null and created_at > now() - (${ACTIVE_REPORT_WINDOW_MINUTES}::int * interval '1 minute')) as contributors_reporting_15m`,
      sql`select c.code,c.name,c.lat,c.lng,r.source,r.validation_status,r.note,r.submitted_at,r.reviewed_at
        from public.checkpoint_location_reviews r
        join public.checkpoints c on c.id=r.checkpoint_id
        order by c.name`,
    ]);

    return NextResponse.json({
      days,
      summary: summary[0],
      daily,
      calibrations,
      alerts,
      latestHealth: health[0] ?? null,
      activeTrips,
      presence: presence[0] ?? { active_users_now: 0, active_contributors_now: 0, contributors_reporting_15m: 0 },
      checkpointReviews,
      calibrationPolicy: {
        minimumSamples: 8,
        minimumQualityScore: 70,
        maximumGpsAccuracyMeters: 40,
        rollingWindowDays: 90,
        outlierRule: 'Median absolute deviation; extreme travel-time samples are excluded.',
      },
      generatedAt: new Date().toISOString(),
    }, { headers: noStore });
  } catch (error) {
    console.error('BiyahePanay ops metrics query failed', error);
    return NextResponse.json({ error: 'Unable to load operational metrics.' }, { status: 502, headers: noStore });
  }
}
