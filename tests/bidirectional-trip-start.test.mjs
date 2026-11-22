import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES, routeForTab } from '../src/lib/corridors.ts';
import { estimateTimeline } from '../src/lib/eta.ts';

test('return corridors reverse the checkpoint order and end at Roxas Terminal', () => {
  const pairs = [
    ['iloilo_passi', 'iloilo_passi_return'],
    ['kalibo_mambusao', 'kalibo_mambusao_return'],
    ['kalibo_sapian', 'kalibo_sapian_return'],
    ['tapaz', 'tapaz_return'],
    ['estancia', 'estancia_return'],
  ];
  for (const [outboundId, inboundId] of pairs) {
    const outbound = ROUTES.find((route) => route.id === outboundId);
    const inbound = ROUTES.find((route) => route.id === inboundId);
    assert.ok(outbound, `missing ${outboundId}`);
    assert.ok(inbound, `missing ${inboundId}`);
    assert.deepEqual(
      inbound.checkpoints.map((point) => point.id),
      [...outbound.checkpoints].reverse().map((point) => point.id),
    );
    assert.equal(inbound.checkpoints[0].name, outbound.checkpoints.at(-1).name);
    assert.equal(inbound.checkpoints.at(-1).id, 'pueblo_terminal');
    assert.equal(inbound.destination, 'Pueblo de Panay Terminal');
  }
});

test('route tabs select both directions and preserve Kalibo variants', () => {
  assert.equal(routeForTab('iloilo', 'mambusao', 'inbound').id, 'iloilo_passi_return');
  assert.equal(routeForTab('kalibo', 'sapian', 'inbound').id, 'kalibo_sapian_return');
  assert.equal(routeForTab('kalibo', 'mambusao', 'outbound').id, 'kalibo_mambusao');
});

test('a trip may start mid-route without marking earlier checkpoints passed', () => {
  const route = ROUTES.find((candidate) => candidate.id === 'iloilo_passi');
  assert.ok(route);
  const departureAt = '2026-11-22T08:00:00.000Z';
  const trip = {
    id: 'trip-test',
    route_id: route.id,
    bus_type: 'ordinary',
    departure_at: departureAt,
    status: 'active',
    start_checkpoint_id: 'lanot',
    last_checkpoint_id: 'lanot',
    last_checkpoint_at: departureAt,
    last_lat: null,
    last_lng: null,
    confidence_status: 'verified',
  };
  const result = estimateTimeline(trip, route.checkpoints, new Date('2026-11-22T08:00:30.000Z'));
  assert.equal(result.items.find((item) => item.checkpoint.id === 'pueblo_terminal')?.state, 'not_started');
  assert.equal(result.items.find((item) => item.checkpoint.id === 'lawaan')?.state, 'not_started');
  assert.equal(result.items.find((item) => item.checkpoint.id === 'lanot')?.state, 'passed');
  const next = result.items.find((item) => item.checkpoint.id === 'lonoy');
  assert.equal(next?.state, 'approaching');
  assert.equal(next?.eta?.toISOString(), '2026-11-22T08:06:00.000Z');
});
