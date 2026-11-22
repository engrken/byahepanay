import test from 'node:test';
import assert from 'node:assert/strict';
import { isPresenceFresh, ACTIVE_PRESENCE_WINDOW_MINUTES } from '../src/lib/presence.ts';

test('presence stays active inside the five-minute heartbeat window', () => {
  const now = Date.parse('2026-11-22T08:00:00.000Z');
  assert.equal(isPresenceFresh('2026-11-22T07:56:00.000Z', now), true);
  assert.equal(isPresenceFresh('2026-11-22T07:54:59.000Z', now), false);
  assert.equal(ACTIVE_PRESENCE_WINDOW_MINUTES, 5);
});

test('future or invalid heartbeat timestamps are not counted', () => {
  const now = Date.parse('2026-11-22T08:00:00.000Z');
  assert.equal(isPresenceFresh('2026-11-22T08:00:01.000Z', now), false);
  assert.equal(isPresenceFresh('not-a-date', now), false);
});
