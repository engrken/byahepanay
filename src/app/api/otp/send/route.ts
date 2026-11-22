import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { jsonError, isSameOriginRequest } from '@/lib/http';
import { getSpotterSessionId } from '@/lib/spotter-session';
import {
  createEmailOtpCode, hashEmailAddress, hashEmailOtp, isEmailOtpConfigured,
  maskEmailAddress, normalizeEmailAddress,
} from '@/lib/reporter-verification';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError('Cross-origin requests are not allowed.', 403, 'CROSS_SITE_REQUEST');
  const spotterId = getSpotterSessionId(request);
  if (!spotterId) return jsonError('Secure browser session required.', 401, 'SESSION_REQUIRED');
  if (!isEmailOtpConfigured()) return jsonError('Email OTP delivery is not configured yet. Add RESEND_API_KEY and EMAIL_FROM in Vercel.', 503, 'OTP_PROVIDER_NOT_CONFIGURED');

  const sql = getDb();
  if (!sql) return jsonError('Reporting database is unavailable.', 503, 'DATABASE_UNAVAILABLE');

  let body: { emailAddress?: unknown };
  try { body = await request.json(); } catch { return jsonError('Invalid JSON request body.'); }
  const email = normalizeEmailAddress(body.emailAddress);
  if (!email) return jsonError('Enter a valid email address.', 422, 'INVALID_EMAIL');
  const emailHash = hashEmailAddress(email);
  const maskedEmail = maskEmailAddress(email);

  try {
    const events = await sql`with locks as materialized (
        select pg_advisory_xact_lock(hashtextextended(${spotterId}, 0)),
               pg_advisory_xact_lock(hashtextextended(${emailHash}, 1))
      ),
      counts as materialized (
        select
          count(*) filter (where e.spotter_id = ${spotterId}::uuid and e.event_type = 'send' and e.created_at > now() - interval '60 seconds') as session_minute,
          count(*) filter (where e.spotter_id = ${spotterId}::uuid and e.event_type = 'send' and e.created_at > now() - interval '1 hour') as session_hour,
          count(*) filter (where e.email_hash = ${emailHash} and e.event_type = 'send' and e.created_at > now() - interval '1 hour') as email_hour
        from public.email_verification_events e, locks
      )
      insert into public.email_verification_events(spotter_id, email_hash, event_type, provider_status)
      select ${spotterId}::uuid, ${emailHash}, 'send', 'requested' from counts
      where session_minute = 0 and session_hour < 4 and email_hour < 4
      returning id`;
    const eventId = (events[0] as { id: string } | undefined)?.id;
    if (!eventId) return jsonError('Email code request limit reached. Wait before requesting another code.', 429, 'OTP_RATE_LIMIT');

    const challengeId = randomUUID();
    const code = createEmailOtpCode();
    const codeHash = hashEmailOtp(emailHash, code);
    await sql`insert into public.email_verification_challenges
      (id, spotter_id, email_hash, email_masked, code_hash, expires_at)
      values (${challengeId}::uuid, ${spotterId}::uuid, ${emailHash}, ${maskedEmail}, ${codeHash}, now() + interval '10 minutes')`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY!}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': challengeId,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM!,
        to: [email],
        subject: 'Your ByahePanay verification code',
        text: `Your ByahePanay verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:24px auto;padding:24px;border:1px solid #e5e7eb;border-radius:14px;color:#172b3a"><p style="font-size:12px;letter-spacing:1.5px;font-weight:700;color:#64748b">BYAHEPANAY · REPORTER VERIFICATION</p><h1 style="font-size:22px;margin:12px 0">Your verification code</h1><p>Enter this one-time code in the ByahePanay app:</p><p style="font-size:32px;letter-spacing:8px;font-weight:700;padding:14px 0">${code}</p><p style="color:#64748b">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`,
      }),
      cache: 'no-store',
    });
    const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
    await sql`update public.email_verification_events set provider_status = ${response.ok ? 'sent' : 'provider_error'} where id = ${eventId}::uuid`;
    if (!response.ok) {
      await sql`update public.email_verification_challenges set consumed_at = now() where id = ${challengeId}::uuid`;
      console.error('Resend OTP delivery failed', { status: response.status });
      return jsonError('The verification email could not be sent. Check the address or contact the app administrator.', 502, 'OTP_DELIVERY_FAILED');
    }

    return NextResponse.json({
      sent: true,
      emailMasked: maskedEmail,
      expiresInMinutes: 10,
      message: `A verification code was sent to ${maskedEmail}. It expires in 10 minutes.`,
      providerMessageId: result.id ?? null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Email OTP send failed', error);
    return jsonError('Could not send an email verification code. Please try again.', 502, 'OTP_DELIVERY_FAILED');
  }
}
