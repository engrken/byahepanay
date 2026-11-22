import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { jsonError, isSameOriginRequest } from '@/lib/http';
import { getSpotterSessionId } from '@/lib/spotter-session';
import {
  hashEmailAddress, hashEmailOtp, isEmailOtpConfigured, maskEmailAddress, normalizeEmailAddress,
} from '@/lib/reporter-verification';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError('Cross-origin requests are not allowed.', 403, 'CROSS_SITE_REQUEST');
  const spotterId = getSpotterSessionId(request);
  if (!spotterId) return jsonError('Secure browser session required.', 401, 'SESSION_REQUIRED');
  if (!isEmailOtpConfigured()) return jsonError('Email OTP delivery is not configured yet.', 503, 'OTP_PROVIDER_NOT_CONFIGURED');

  const sql = getDb();
  if (!sql) return jsonError('Reporting database is unavailable.', 503, 'DATABASE_UNAVAILABLE');

  let body: { emailAddress?: unknown; code?: unknown };
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }
  const email = normalizeEmailAddress(body.emailAddress);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!email || !/^\d{6}$/.test(code)) return jsonError('Enter the same email address and the six-digit code from the email.', 422, 'INVALID_OTP_INPUT');

  const emailHash = hashEmailAddress(email);
  const codeHash = hashEmailOtp(emailHash, code);
  const maskedEmail = maskEmailAddress(email);

  try {
    const transactionResults = await sql.transaction([
      sql`select pg_advisory_xact_lock(hashtextextended(${spotterId}, 0)),
                  pg_advisory_xact_lock(hashtextextended(${emailHash}, 1))`,
      sql`with counts as materialized (
          select
            count(*) filter (where e.spotter_id = ${spotterId}::uuid and e.event_type = 'check' and e.created_at > now() - interval '10 minutes') as session_attempts,
            count(*) filter (where e.email_hash = ${emailHash} and e.event_type = 'check' and e.created_at > now() - interval '10 minutes') as email_attempts
          from public.email_verification_events e
        ),
        attempt as (
          insert into public.email_verification_events(spotter_id, email_hash, event_type, provider_status)
          select ${spotterId}::uuid, ${emailHash}, 'check', 'checking' from counts
          where session_attempts < 5 and email_attempts < 5
          returning id
        ),
        latest as materialized (
          select id from public.email_verification_challenges
          where spotter_id = ${spotterId}::uuid and email_hash = ${emailHash}
            and expires_at > now() and consumed_at is null and attempts < 5
          order by created_at desc limit 1
        ),
        checked as (
          update public.email_verification_challenges c
          set attempts = c.attempts + 1,
              consumed_at = case when c.code_hash = ${codeHash} then now() else c.consumed_at end
          from latest, attempt
          where c.id = latest.id and c.attempts < 5
          returning c.id, c.email_masked, (c.code_hash = ${codeHash}) as approved
        )
        select (attempt.id is not null) as attempt_allowed, attempt.id as event_id,
               checked.id as challenge_id, checked.email_masked, checked.approved
        from (select 1) anchor
        left join attempt on true
        left join checked on true`
    ], { isolationLevel: 'ReadCommitted' });

    const attempt = transactionResults[1]?.[0] as {
      attempt_allowed: boolean; event_id: string | null; challenge_id: string | null;
      email_masked: string | null; approved: boolean | null;
    } | undefined;
    if (!attempt?.attempt_allowed) return jsonError('Too many code attempts. Request another code later.', 429, 'OTP_CHECK_RATE_LIMIT');
    if (!attempt.challenge_id) return jsonError('No active code was found. Request a new verification email.', 422, 'OTP_CODE_EXPIRED');

    if (!attempt.approved) {
      await sql`update public.email_verification_events set provider_status = 'rejected' where id = ${attempt.event_id}::uuid`;
      return jsonError('That code is incorrect or has expired. Check the latest email and try again.', 422, 'OTP_NOT_APPROVED');
    }
    await sql`update public.email_verification_events set provider_status = 'approved' where id = ${attempt.event_id}::uuid`;

    const identityRows = await sql`insert into public.reporter_identities(email_hash, email_masked, verification_method, verified_at)
      values (${emailHash}, ${maskedEmail}, 'email', now())
      on conflict (email_hash) do update
      set email_masked = excluded.email_masked, verification_method = 'email', verified_at = now()
      returning id`;
    const reporterId = (identityRows[0] as { id: string } | undefined)?.id;
    if (!reporterId) return jsonError('Could not save email verification.', 500);

    const linkRows = await sql`insert into public.spotter_reporter_links(spotter_id, reporter_id)
      values (${spotterId}::uuid, ${reporterId}::uuid)
      on conflict (spotter_id) do update set reporter_id = excluded.reporter_id
      where public.spotter_reporter_links.reporter_id = excluded.reporter_id
         or exists (
           select 1 from public.reporter_identities old_identity
           where old_identity.id = public.spotter_reporter_links.reporter_id
             and old_identity.verification_method = 'sms'
         )
      returning reporter_id`;
    if (!linkRows.length) return jsonError('This browser is already linked to another verified email. Use that address or a separate browser profile.', 409, 'SESSION_ALREADY_VERIFIED');

    return NextResponse.json({
      verified: true,
      emailMasked: attempt.email_masked ?? maskedEmail,
      verificationMethod: 'email',
      message: 'Email verified. This browser is now linked to a consistent reporter identity for community-report checks.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Email OTP verify failed', error);
    return jsonError('Could not verify this email address. Please try again.', 502, 'OTP_VERIFY_FAILED');
  }
}
