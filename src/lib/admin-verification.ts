import type { NeonSql } from './db';
import { hashEmailAddress, normalizeEmailAddress } from './reporter-verification.ts';

/**
 * Returns the keyed hash for the configured developer-admin email.
 * The raw address stays in a server-only Vercel environment variable and is
 * never stored or returned by this module.
 */
export function getDeveloperAdminEmailHash(): string | null {
  const email = normalizeEmailAddress(process.env.DEVELOPER_ADMIN_EMAIL);
  if (!email) return null;

  try {
    return hashEmailAddress(email);
  } catch {
    return null;
  }
}

/**
 * Grants developer-admin access only when this browser session is linked to
 * an email identity that completed the existing OTP verification flow.
 */
export async function isDeveloperAdmin(sql: NeonSql, spotterId: string): Promise<boolean> {
  const emailHash = getDeveloperAdminEmailHash();
  if (!emailHash) return false;

  const rows = await sql`
    select 1
    from public.spotter_reporter_links l
    join public.reporter_identities i on i.id = l.reporter_id
    where l.spotter_id = ${spotterId}::uuid
      and i.email_hash = ${emailHash}
      and i.verification_method = 'email'
      and i.email_hash is not null
      and i.verified_at is not null
    limit 1
  `;
  return rows.length > 0;
}
