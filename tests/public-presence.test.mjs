import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const endpoint = readFileSync(new URL('../src/app/api/public/presence/route.ts', import.meta.url), 'utf8');
const component = readFileSync(new URL('../src/components/community-presence.tsx', import.meta.url), 'utf8');

test('public presence endpoint returns aggregate counts using the intended activity windows', () => {
  assert.match(endpoint, /count\(distinct spotter_id\)/);
  assert.match(endpoint, /count\(distinct reporter_id\)/);
  assert.match(endpoint, /ACTIVE_PRESENCE_WINDOW_MINUTES/);
  assert.match(endpoint, /ACTIVE_REPORT_WINDOW_MINUTES/);
  assert.match(endpoint, /s-maxage=30/);
});

test('public presence endpoint never selects or returns individual identities', () => {
  assert.doesNotMatch(endpoint, /select\s+(?:distinct\s+)?(?:spotter_id|reporter_id)\b/i);
  assert.doesNotMatch(endpoint, /email_hash|spotter_id:\s|reporter_id:\s/i);
  assert.match(endpoint, /active_visitors_now: toCount/);
  assert.match(endpoint, /active_contributors_now: toCount/);
});

test('community panel informs users when counts fail and provides a retry action', () => {
  assert.match(component, /role="alert"/);
  assert.match(component, /Community activity couldn’t be loaded/);
  assert.match(component, /The tracker remains usable/);
  assert.match(component, /Try again/);
});
