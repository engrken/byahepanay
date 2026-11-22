import { createHmac } from 'node:crypto';
import type { NeonSql } from './db';

export function isTwilioVerifyConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID);
}
export function isPhoneVerificationRequired() {
  return process.env.REQUIRE_PHONE_VERIFICATION === 'true';
}
export function normalizePhilippineMobileNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.trim().replace(/[\s()-]/g, '');
  if (/^09\d{9}$/.test(compact)) return `+63${compact.slice(1)}`;
  if (/^9\d{9}$/.test(compact)) return `+63${compact}`;
  if (/^\+639\d{9}$/.test(compact)) return compact;
  return null;
}
export function maskPhoneNumber(value: string) { return `+63 ••• ••• ${value.slice(-4)}`; }
export function hashPhoneNumber(value: string) {
  const secret = process.env.SPOTTER_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Phone hashing is not configured.');
  return createHmac('sha256', secret).update(value).digest('hex');
}
export async function getReporterIdentity(sql: NeonSql, spotterId: string): Promise<string | null> {
  const rows = await sql`select reporter_id from public.spotter_reporter_links where spotter_id = ${spotterId}::uuid limit 1`;
  return (rows[0] as { reporter_id: string } | undefined)?.reporter_id ?? null;
}
export async function requireReporterIdentity(sql: NeonSql, spotterId: string) {
  const reporterId = await getReporterIdentity(sql, spotterId);
  return { reporterId, required: isPhoneVerificationRequired(), allowed: !isPhoneVerificationRequired() || reporterId !== null };
}
