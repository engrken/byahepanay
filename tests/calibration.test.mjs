import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeSegmentSamples } from '../src/lib/calibration.ts';

const samples = Array.from({length:10},(_,index)=>({observed_minutes:12+(index%3)-1,baseline_minutes:11,quality_score:90,mean_gps_accuracy_m:12,created_at:`2026-11-${String(index+1).padStart(2,'0')}T10:00:00Z`}));
test('calibration requires at least eight good, accurate samples',()=>{assert.equal(summarizeSegmentSamples(samples.slice(0,7)),null);assert.ok(summarizeSegmentSamples(samples));});
test('median calibration resists extreme travel-time outliers',()=>{const summary=summarizeSegmentSamples([...samples,{observed_minutes:170,baseline_minutes:11,quality_score:90,mean_gps_accuracy_m:10,created_at:'2026-11-20T10:00:00Z'}]);assert.ok(summary);assert.ok(summary.medianMinutes<20);assert.ok(summary.sampleCount<=10);});
test('low-quality or inaccurate reports never calibrate a segment',()=>{const bad=samples.map(s=>({...s,quality_score:40}));assert.equal(summarizeSegmentSamples(bad),null);});
