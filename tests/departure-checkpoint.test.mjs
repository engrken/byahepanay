import test from 'node:test';
import assert from 'node:assert/strict';
import { getStartableCheckpoints, resolveDepartureCheckpoint, isPersistedCheckpointId } from '../src/lib/departure-checkpoint.ts';

const route = {
  id: 'iloilo_passi',
  name: 'Roxas City → Iloilo via Passi',
  short_name: 'Iloilo · Passi',
  destination: 'Tagbak Terminal',
  checkpoints: [
    { id: '11111111-1111-4111-8111-111111111111', code: 'pueblo_terminal', name: 'Pueblo de Panay Terminal', lat: 11.5598, lng: 122.7480 },
    { id: '22222222-2222-4222-8222-222222222222', code: 'lawaan', name: 'Lawaan', lat: 11.5513, lng: 122.7584 },
    { id: '33333333-3333-4333-8333-333333333333', code: 'bolo', name: 'Bolo', lat: 11.5386, lng: 122.7581 },
    { id: '44444444-4444-4444-8444-444444444444', code: 'tagbak_terminal', name: 'Tagbak Terminal', lat: 10.7700, lng: 122.5570 },
  ],
};

test('startable checkpoints retain database UUIDs and exclude the destination terminal', () => {
  const checkpoints = getStartableCheckpoints(route);
  assert.deepEqual(checkpoints.map((checkpoint) => checkpoint.id), [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ]);
  assert.ok(checkpoints.every((checkpoint) => isPersistedCheckpointId(checkpoint.id)));
});

test('a selected mid-route checkpoint such as Bolo resolves to its database UUID', () => {
  const checkpoint = resolveDepartureCheckpoint(route, '33333333-3333-4333-8333-333333333333');
  assert.equal(checkpoint?.name, 'Bolo');
  assert.equal(checkpoint?.id, '33333333-3333-4333-8333-333333333333');
});

test('legacy static corridor codes resolve to the matching live database UUID', () => {
  assert.equal(isPersistedCheckpointId('bolo'), false);
  const checkpoint = resolveDepartureCheckpoint(route, 'bolo');
  assert.equal(checkpoint?.name, 'Bolo');
  assert.equal(checkpoint?.id, '33333333-3333-4333-8333-333333333333');
  assert.ok(isPersistedCheckpointId(checkpoint?.id ?? ''));
});

test('unknown non-empty selections are not silently replaced by another checkpoint', () => {
  assert.equal(resolveDepartureCheckpoint(route, 'missing-stop'), null);
});

test('a route with no startable checkpoints has no departure checkpoint', () => {
  assert.equal(resolveDepartureCheckpoint({ ...route, checkpoints: [route.checkpoints.at(-1)] }, ''), null);
});
