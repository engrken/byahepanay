import type { NeonSql } from './db';

export const CALIBRATION_MIN_SAMPLES = 8;
export const CALIBRATION_MIN_QUALITY = 70;
export const CALIBRATION_MAX_AGE_DAYS = 90;
export interface CalibrationSample { observed_minutes: number | string; baseline_minutes: number | string; quality_score: number | string; mean_gps_accuracy_m: number | string; created_at: string; }
export interface CalibrationSummary { sampleCount: number; medianMinutes: number; p80Minutes: number; baselineMinutes: number; lastSampleAt: string; }

function median(values: number[]) {
  const sorted = [...values].sort((a,b)=>a-b);
  const middle = Math.floor(sorted.length/2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
}
function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a,b)=>a-b);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length-1)*fraction;
  const lower = Math.floor(position); const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper]-sorted[lower])*(position-lower);
}
export function summarizeSegmentSamples(samples: CalibrationSample[]): CalibrationSummary | null {
  const candidates = samples.filter((sample) => {
    const observed = Number(sample.observed_minutes);
    const baseline = Number(sample.baseline_minutes);
    return Number.isFinite(observed) && observed >= 2 && observed <= 180 && Number.isFinite(baseline) && baseline > 0 &&
      Number(sample.quality_score) >= CALIBRATION_MIN_QUALITY && Number(sample.mean_gps_accuracy_m) <= 40;
  });
  if (candidates.length < CALIBRATION_MIN_SAMPLES) return null;
  const values = candidates.map((sample) => Number(sample.observed_minutes));
  const center = median(values);
  const mad = median(values.map((value)=>Math.abs(value-center)));
  const outlierLimit = Math.max(4, center*0.6, mad*3);
  const inliers = candidates.filter((sample)=>Math.abs(Number(sample.observed_minutes)-center)<=outlierLimit);
  if (inliers.length < CALIBRATION_MIN_SAMPLES) return null;
  const observed = inliers.map((sample)=>Number(sample.observed_minutes));
  const baselines = inliers.map((sample)=>Number(sample.baseline_minutes));
  const lastSampleAt = inliers.map((sample)=>sample.created_at).sort().at(-1);
  if (!lastSampleAt) return null;
  return { sampleCount: inliers.length, medianMinutes: Math.round(median(observed)*10)/10,
    p80Minutes: Math.round(percentile(observed,0.8)*10)/10, baselineMinutes: Math.round(median(baselines)*10)/10, lastSampleAt };
}

export async function recalibrateSegment(sql: NeonSql, routeId: string, fromCheckpointId: string, toCheckpointId: string, busType: 'ordinary'|'aircon') {
  const rows = await sql`select observed_minutes, baseline_minutes, quality_score, mean_gps_accuracy_m, created_at
    from public.eta_calibration_samples where route_id = ${routeId} and from_checkpoint_id = ${fromCheckpointId}::uuid
      and to_checkpoint_id = ${toCheckpointId}::uuid and bus_type = ${busType}
      and created_at >= now() - interval '90 days' order by created_at desc limit 200`;
  const summary = summarizeSegmentSamples(rows as unknown as CalibrationSample[]);
  if (!summary) return null;
  await sql`insert into public.eta_segment_calibrations
      (route_id,from_checkpoint_id,to_checkpoint_id,bus_type,sample_count,median_minutes,p80_minutes,baseline_minutes,last_sample_at,updated_at)
    values (${routeId},${fromCheckpointId}::uuid,${toCheckpointId}::uuid,${busType},${summary.sampleCount},${summary.medianMinutes},${summary.p80Minutes},${summary.baselineMinutes},${summary.lastSampleAt}::timestamptz,now())
    on conflict (route_id,from_checkpoint_id,to_checkpoint_id,bus_type) do update set sample_count=excluded.sample_count,
      median_minutes=excluded.median_minutes,p80_minutes=excluded.p80_minutes,baseline_minutes=excluded.baseline_minutes,
      last_sample_at=excluded.last_sample_at,updated_at=now()`;
  return summary;
}
