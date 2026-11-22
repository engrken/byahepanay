import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateTimeline } from '../src/lib/eta.ts';

const departure = '2026-11-22T10:00:00.000Z';
const points = [
  { id:'a',code:'a',name:'Origin',lat:11,lng:122,sequence:0,eta_offset_minutes:0,segment_minutes:0,dwell_buffer_minutes:0 },
  { id:'b',code:'b',name:'Checkpoint B',lat:11.1,lng:122.1,sequence:1,eta_offset_minutes:10,segment_minutes:10,dwell_buffer_minutes:0,calibrated_segment_minutes:{ordinary:8,aircon:12} },
  { id:'c',code:'c',name:'Checkpoint C',lat:11.2,lng:122.2,sequence:2,eta_offset_minutes:20,segment_minutes:10,dwell_buffer_minutes:0,calibrated_segment_minutes:{ordinary:14,aircon:15} },
];
const trip = (bus_type) => ({ id:'trip',route_id:'route',bus_type,departure_at:departure,status:'active',last_checkpoint_id:'a',last_checkpoint_at:departure,last_lat:11,last_lng:122,confidence_status:'verified' });
test('ETA uses calibrated segment medians for ordinary buses',()=>{
  const result=estimateTimeline(trip('ordinary'),points,new Date('2026-11-22T10:01:00.000Z'));
  assert.equal(result.items[1].eta.toISOString(),'2026-11-22T10:08:00.000Z');
  assert.equal(result.items[2].eta.toISOString(),'2026-11-22T10:22:00.000Z');
});
test('ETA selects aircon calibration independently from ordinary buses',()=>{
  const result=estimateTimeline(trip('aircon'),points,new Date('2026-11-22T10:01:00.000Z'));
  assert.equal(result.items[1].eta.toISOString(),'2026-11-22T10:12:00.000Z');
  assert.equal(result.items[2].eta.toISOString(),'2026-11-22T10:27:00.000Z');
});
