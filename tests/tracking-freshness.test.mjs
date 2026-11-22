import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateTimeline, TRACKING_LOST_AFTER_MINUTES } from '../src/lib/eta.ts';

const route = [
  { id: 'terminal', code: 'terminal', name: 'Pueblo Terminal', lat: 11, lng: 122, sequence: 0, eta_offset_minutes: 0, segment_minutes: 0 },
  { id: 'lawaan', code: 'lawaan', name: 'Lawaan', lat: 11.1, lng: 122, sequence: 1, eta_offset_minutes: 4, segment_minutes: 4 },
  { id: 'bolo', code: 'bolo', name: 'Bolo', lat: 11.2, lng: 122, sequence: 2, eta_offset_minutes: 8, segment_minutes: 4 },
];

function trip(overrides = {}) {
  return {
    id: 'trip-1',
    route_id: 'iloilo_passi',
    bus_type: 'aircon',
    departure_at: '2026-11-22T00:00:00.000Z',
    status: 'active',
    last_checkpoint_id: 'terminal',
    last_checkpoint_at: '2026-11-22T00:00:00.000Z',
    last_lat: 11,
    last_lng: 122,
    confidence_status: 'verified',
    ...overrides,
  };
}

test('tracking becomes lost after 90 minutes without a confirmed checkpoint', () => {
  const now = new Date('2026-11-22T02:00:00.000Z');
  const result = estimateTimeline(trip(), route, now);
  assert.equal(TRACKING_LOST_AFTER_MINUTES, 90);
  assert.equal(result.trackingLost, true);
  assert.equal(result.arrivalWindow, null);
  assert.equal(result.items[1].state, 'stale');
  assert.equal(result.items[1].eta, null);
});

test('checkpoint check-in becomes overdue without claiming that traffic caused the delay', () => {
  const now = new Date('2026-11-22T00:25:00.000Z');
  const result = estimateTimeline(trip(), route, now);
  assert.equal(result.trackingLost, false);
  assert.equal(result.confirmationOverdue, true);
  assert.equal(result.items[1].state, 'approaching');
  assert.ok(result.items[1].eta instanceof Date);
});

test('a recently confirmed checkpoint remains eligible for ETA estimates', () => {
  const now = new Date('2026-11-22T00:05:00.000Z');
  const result = estimateTimeline(trip(), route, now);
  assert.equal(result.trackingLost, false);
  assert.equal(result.confirmationOverdue, false);
  assert.ok(result.items[1].eta instanceof Date);
});

test('completed trips do not become tracking-lost because there is no next checkpoint', () => {
  const now = new Date('2026-11-22T06:00:00.000Z');
  const completed = trip({
    status: 'arrived',
    last_checkpoint_id: 'bolo',
    last_checkpoint_at: '2026-11-22T00:08:00.000Z',
  });
  const result = estimateTimeline(completed, route, now);
  assert.equal(result.trackingLost, false);
  assert.equal(result.nextCheckpoint, null);
  assert.equal(result.arrivalWindow, null);
});
