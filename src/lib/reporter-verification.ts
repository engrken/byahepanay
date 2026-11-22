import { createHmac, randomInt } from 'node:crypto';
import type { NeonSql } from './db';

function getHashingSecret() {
  const secret = process.env.SPOTTER_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Reporter identity hashing is not configured.');
  return secret;
}

export function isEmailOtpConfigured() {
  return Boolean(process.env.GMAIL_USER?.trim() && process.env.GMAIL_APP_PASSWORD?.replace(/\\s+/g, ''));
}

export function isEmailVerificationRequired() {
  return process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
}

export function normalizeEmailAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().normalize('NFKC');
  if (!candidate || candidate.length > 254 || /[\\s<>(),;:"\\\\]/.test(candidate)) return null;
  const at = candidate.lastIndexOf('@');
  if (at <= 0 || at !== candidate.indexOf('@')) return null;
  const local = candidate.slice(0, at);
  const domain = candidate.slice(at + 1).toLowerCase();
  if (local.length > 64 || !domain || domain.length > 253 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label) || label.length > 63)) return null;
  return `${local.toLowerCase()}@${domain}`;
}

export function maskEmailAddress(value: string) {
  const [local, domain] = value.split('@');
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(3, Math.min(8, local.length - 1)))}@${domain}`;
}

export function hashEmailAddress(value: string) {
  return createHmac('sha256', getHashingSecret()).update(`email-identity:${value}`).digest('hex');
}

export function hashEmailOtp(emailHash: string, code: string) {
  return createHmac('sha256', getHashingSecret()).update(`email-otp:${emailHash}:${code}`).digest('hex');
}

export function createEmailOtpCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export async function getReporterIdentity(sql: NeonSql, spotterId: string): Promise<string | null> {
  const rows = await sql`select reporter_id from public.spotter_reporter_links where spotter_id = ${spotterId}::uuid limit 1`;
  return (rows[0] as { reporter_id: string } | undefined)?.reporter_id ?? null;
}

export async function requireReporterIdentity(sql: NeonSql, spotterId: string) {
  const reporterId = await getReporterIdentity(sql, spotterId);
  return { reporterId, required: isEmailVerificationRequired(), allowed: !isEmailVerificationRequired() || reporterId !== null };
}
