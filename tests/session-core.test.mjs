import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpotterSessionToken, verifySpotterSessionToken, SPOTTER_SESSION_TTL_SECONDS } from '../src/lib/session-core.ts';
const SECRET='unit-test-secret-with-at-least-thirty-two-characters';
test('fresh signed sessions verify and use the expected TTL',()=>{const now=1800000000;const s=createSpotterSessionToken(SECRET,now);assert.equal(verifySpotterSessionToken(s.token,SECRET,now),s.sessionId);assert.equal(s.expiresAt,now+SPOTTER_SESSION_TTL_SECONDS);});
test('tampered, expired, malformed and wrong-secret tokens are rejected',()=>{const now=1800000000;const s=createSpotterSessionToken(SECRET,now);assert.equal(verifySpotterSessionToken(s.token+'x',SECRET,now),null);assert.equal(verifySpotterSessionToken(s.token,SECRET+'wrong',now),null);assert.equal(verifySpotterSessionToken(s.token,SECRET,s.expiresAt),null);assert.equal(verifySpotterSessionToken('bad',SECRET,now),null);});
test('weak secrets cannot issue or verify sessions',()=>{assert.throws(()=>createSpotterSessionToken('short',1800000000));assert.equal(verifySpotterSessionToken('bad','short',1800000000),null);});
