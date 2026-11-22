import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
export const SPOTTER_SESSION_COOKIE = 'byahepanay_session';
export const SPOTTER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function sign(value: string, secret: string): Buffer { return createHmac('sha256', secret).update(value).digest(); }
export function createSpotterSessionToken(secret: string, now = Math.floor(Date.now() / 1000)) {
  if (secret.length < 32) throw new Error('SPOTTER_SESSION_SECRET must contain at least 32 characters.');
  const sessionId = randomUUID(); const expiresAt = now + SPOTTER_SESSION_TTL_SECONDS;
  const payload = `${sessionId}.${expiresAt}`;
  const token = `${payload}.${sign(payload, secret).toString('base64url')}`;
  return { sessionId, token, expiresAt, maxAge: SPOTTER_SESSION_TTL_SECONDS };
}
export function verifySpotterSessionToken(token: string | undefined, secret: string | undefined, now = Math.floor(Date.now() / 1000)): string | null {
  if (!token || !secret || secret.length < 32) return null;
  const parts = token.split('.'); if (parts.length !== 3) return null;
  const [sessionId, expiresText, suppliedSignature] = parts;
  if (!UUID_PATTERN.test(sessionId)) return null;
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + SPOTTER_SESSION_TTL_SECONDS + 60) return null;
  const payload = `${sessionId}.${expiresAt}`; const expected = sign(payload, secret);
  let supplied: Buffer; try { supplied = Buffer.from(suppliedSignature, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return sessionId;
}
