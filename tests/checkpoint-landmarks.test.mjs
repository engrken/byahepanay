import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '../src/lib/corridors.ts';
import { attachLandmarksToRoute, findCheckpointLandmark, LANDMARK_ENABLED_ROUTE_IDS, landmarksForCheckpoint } from '../src/lib/checkpoint-landmarks.ts';
import { estimateLandmarkEta, estimateTimeline, projectLandmarkToRoute } from '../src/lib/eta.ts';

const outbound = attachLandmarksToRoute(ROUTES.find((route) => route.id === 'iloilo_passi'));
const inbound = attachLandmarksToRoute(ROUTES.find((route) => route.id === 'iloilo_passi_return'));
const testNow = new Date('2026-11-22T10:00:00+08:00');

function activeTrip(route) {
  const first = route.checkpoints[0];
  return {
    id: 'trip-test',
    route_id: route.id,
    bus_type: 'ordinary',
    departure_at: testNow.toISOString(),
    status: 'active',
    start_checkpoint_id: first.id,
    last_checkpoint_id: first.id,
    last_checkpoint_at: testNow.toISOString(),
    last_lat: first.lat,
    last_lng: first.lng,
    confidence_status: 'verified',
  };
}

test('landmark references are available only on Roxas–Iloilo routes', () => {
  assert.ok(LANDMARK_ENABLED_ROUTE_IDS.includes('iloilo_passi'));
  assert.equal(outbound.checkpoints.find((point) => point.code === 'bolo')?.landmarks?.length, 2);
  const tapaz = ROUTES.find((route) => route.id === 'tapaz');
  const untouched = attachLandmarksToRoute(tapaz);
  assert.equal(untouched.checkpoints.find((point) => point.code === 'bolo')?.landmarks, undefined);
});

test('all owner-supplied Roxas–Iloilo landmark coordinates are present and valid', () => {
  const all = outbound.checkpoints.flatMap((point) => point.landmarks ?? []);
  assert.equal(all.length, 27);
  assert.ok(all.every((landmark) =>
    landmark.coordinateSource === 'owner_supplied_coordinates' &&
    landmark.validationStatus === 'pending_field_validation' &&
    landmark.lat >= -90 && landmark.lat <= 90 &&
    landmark.lng >= -180 && landmark.lng <= 180
  ));
});

test('landmark ids resolve to a single landmark under the intended barangay', () => {
  const school = findCheckpointLandmark('iloilo-bolo-venancio-alba-school');
  assert.equal(school?.checkpointCode, 'bolo');
  assert.equal(school?.lat, 11.539046);
  assert.equal(landmarksForCheckpoint('tagbak_terminal').length, 2);
});

test('landmark projection locates a roadside reference on the route polyline', () => {
  const school = findCheckpointLandmark('iloilo-bolo-venancio-alba-school');
  const projection = projectLandmarkToRoute(school, outbound.checkpoints);
  assert.ok(projection);
  assert.equal(projection.segmentIndex, 2);
  assert.ok(projection.distanceMeters < 50);
  assert.ok(projection.fraction > 0 && projection.fraction < 1);
});

test('landmark ETA is interpolated between adjacent barangay checkpoint ETAs', () => {
  const trip = activeTrip(outbound);
  const timeline = estimateTimeline(trip, outbound.checkpoints, testNow);
  const school = findCheckpointLandmark('iloilo-bolo-venancio-alba-school');
  const estimate = estimateLandmarkEta(trip, outbound.checkpoints, timeline, school, testNow);
  const boloIndex = outbound.checkpoints.findIndex((point) => point.code === 'bolo');
  const lanotIndex = outbound.checkpoints.findIndex((point) => point.code === 'lanot');
  assert.equal(estimate.status, 'estimated');
  assert.ok(estimate.eta);
  assert.ok(estimate.eta.getTime() >= timeline.items[boloIndex].eta.getTime());
  assert.ok(estimate.eta.getTime() <= timeline.items[lanotIndex].eta.getTime());
});

test('a displaced landmark is listed but its ETA is withheld for route review', () => {
  const trip = activeTrip(outbound);
  const timeline = estimateTimeline(trip, outbound.checkpoints, testNow);
  const terminal = findCheckpointLandmark('iloilo-pueblo-transport-terminal');
  const estimate = estimateLandmarkEta(trip, outbound.checkpoints, timeline, terminal, testNow);
  assert.equal(estimate.status, 'needs_review');
  assert.ok(estimate.distanceFromRouteMeters > 750);
});

test('landmark ETA projection also works in the reverse Iloilo–Roxas direction', () => {
  const trip = activeTrip(inbound);
  const timeline = estimateTimeline(trip, inbound.checkpoints, testNow);
  const boloHall = findCheckpointLandmark('iloilo-bolo-barangay-hall');
  const estimate = estimateLandmarkEta(trip, inbound.checkpoints, timeline, boloHall, testNow);
  assert.equal(estimate.status, 'estimated');
  assert.ok(estimate.eta);
});
