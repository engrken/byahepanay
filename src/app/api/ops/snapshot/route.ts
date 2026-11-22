import { NextRequest,NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
export const dynamic='force-dynamic';export const runtime='nodejs';
export async function GET(request:NextRequest){const secret=process.env.CRON_SECRET;if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'Unauthorized'},{status:401});const sql=getDb();if(!sql)return NextResponse.json({error:'Database unavailable'},{status:503});const started=Date.now();try{
const[dailyRows,healthRows]=await Promise.all([
sql`with bounds as (
  select (now() at time zone 'Asia/Manila')::date as metric_date,
    ((now() at time zone 'Asia/Manila')::date::timestamp at time zone 'Asia/Manila') as start_at
), report_stats as (
  select count(*)::int as report_count,
    count(*) filter(where s.is_verified)::int as verified_report_count,
    count(*) filter(where s.reporter_id is not null)::int as otp_verified_report_count,
    count(distinct s.reporter_id)::int as unique_verified_reporters,
    percentile_cont(0.5) within group(order by s.gps_accuracy_m) filter(where s.gps_accuracy_m is not null) as median_gps_accuracy_m,
    percentile_cont(0.5) within group(order by s.distance_meters) as median_report_distance_m
  from public.sightings s cross join bounds b
  where s.created_at>=b.start_at and s.created_at<b.start_at+interval '1 day'
), sample_stats as (
  select count(*)::int as sample_count,avg(x.quality_score) as avg_quality
  from public.eta_calibration_samples x cross join bounds b
  where x.created_at>=b.start_at and x.created_at<b.start_at+interval '1 day'
), calibration_stats as (
  select count(*)::int as segment_count from public.eta_segment_calibrations where updated_at>now()-interval '90 days'
) select bounds.metric_date,report_stats.*,sample_stats.sample_count as calibration_sample_count,
  calibration_stats.segment_count as calibrated_segment_count,sample_stats.avg_quality as average_quality_score
  from bounds cross join report_stats cross join sample_stats cross join calibration_stats`,sql`select(select count(*)::int from public.trips where status='active') active_trip_count,(select count(*)::int from public.trips where status='active' and updated_at<now()-interval '90 minutes') stale_active_trip_count,(select count(*)::int from public.eta_segment_calibrations where updated_at>now()-interval '90 days') calibration_segment_count,(select max(created_at) from public.sightings) latest_sighting_at`]);
const latency=Date.now()-started;const daily=dailyRows[0] as Record<string,unknown>;const health=healthRows[0] as Record<string,unknown>;
await sql`insert into public.report_quality_daily(metric_date,report_count,verified_report_count,otp_verified_report_count,unique_verified_reporters,median_gps_accuracy_m,median_report_distance_m,calibration_sample_count,calibrated_segment_count,average_quality_score,updated_at) values(${daily.metric_date}::date,${daily.report_count},${daily.verified_report_count},${daily.otp_verified_report_count},${daily.unique_verified_reporters},${daily.median_gps_accuracy_m},${daily.median_report_distance_m},${daily.calibration_sample_count},${daily.calibrated_segment_count},${daily.average_quality_score},now()) on conflict(metric_date) do update set report_count=excluded.report_count,verified_report_count=excluded.verified_report_count,otp_verified_report_count=excluded.otp_verified_report_count,unique_verified_reporters=excluded.unique_verified_reporters,median_gps_accuracy_m=excluded.median_gps_accuracy_m,median_report_distance_m=excluded.median_report_distance_m,calibration_sample_count=excluded.calibration_sample_count,calibrated_segment_count=excluded.calibrated_segment_count,average_quality_score=excluded.average_quality_score,updated_at=now()`;
const stale=Number(health.stale_active_trip_count??0);const active=Number(health.active_trip_count??0);const status=latency>2500||stale>0?'degraded':'healthy';
await sql`insert into public.ops_health_snapshots(status,database_latency_ms,active_trip_count,stale_active_trip_count,calibration_segment_count,latest_sighting_at) values(${status},${latency},${active},${stale},${health.calibration_segment_count},${health.latest_sighting_at}::timestamptz)`;
if(latency>2500)await sql`insert into public.ops_alerts(alert_key,severity,message,last_seen_at,resolved_at) values('database_latency','warning','Database query latency exceeded 2.5 seconds.',now(),null) on conflict(alert_key) do update set last_seen_at=now(),resolved_at=null,message=excluded.message`;else await sql`update public.ops_alerts set resolved_at=now() where alert_key='database_latency' and resolved_at is null`;
if(stale>0)await sql`insert into public.ops_alerts(alert_key,severity,message,last_seen_at,resolved_at) values('stale_active_trips','warning',${stale}::text || ' active trip(s) have not updated for 90 minutes.',now(),null) on conflict(alert_key) do update set last_seen_at=now(),resolved_at=null,message=excluded.message`;else await sql`update public.ops_alerts set resolved_at=now() where alert_key='stale_active_trips' and resolved_at is null`;
if(status!=='healthy')console.warn('ByahePanay operational snapshot degraded',{latency,active,stale});return NextResponse.json({ok:true,status,databaseLatencyMs:latency,dailyMetricsUpdated:true,healthSnapshotStored:true,activeTrips:active,staleActiveTrips:stale,calibrationSegments:Number(health.calibration_segment_count??0)});
}catch(error){console.error('ByahePanay scheduled ops snapshot failed',error);return NextResponse.json({error:'Unable to store operational snapshot.'},{status:500});}}
