import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestCheckpoint } from '../src/lib/geo.ts';

const pins = [
  { id: 'pueblo', name: 'Pueblo', lat: 11.55987, lng: 122.74805 },
  { id: 'lawaan', name: 'Lawaan', lat: 11.551354, lng: 122.758464 },
  { id: 'bolo', name: 'Bolo', lat: 11.543040, lng: 122.758362 },
];

test('the corrected Bolo pin wins for a fix at Bolo', () => {
  const result = nearestCheckpoint({ latitude: 11.543040, longitude: 122.758362 }, pins, 1500);
  assert.equal(result?.checkpoint.id, 'bolo');
  assert.equal(result?.distanceMeters, 0);
});

test('a remote terminal is not presented as the nearest stop when it is too far away', () => {
  const result = nearestCheckpoint(
    { latitude: 11.543040, longitude: 122.758362 },
    [{ id: 'pueblo', name: 'Pueblo', lat: 11.55987, lng: 122.74805 }],
    1500,
  );
  assert.equal(result, null);
});
