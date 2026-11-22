import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSpotterSessionId } from '@/lib/spotter-session';
import { isEmailOtpConfigured, isEmailVerificationRequired } from '@/lib/reporter-verification';
import { isDeveloperAdmin } from '@/lib/admin-verification';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const spotterId = getSpotterSessionId(request);
  if (!spotterId) return NextResponse.json({ error: 'Secure browser session required.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({
      configured: isEmailOtpConfigured(), required: isEmailVerificationRequired(), verified: false,
      isDeveloperAdmin: false, emailMasked: null, verificationMethod: null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const rows = await sql`select i.email_masked, i.verification_method
      from public.spotter_reporter_links l
      join public.reporter_identities i on i.id = l.reporter_id
      where l.spotter_id = ${spotterId}::uuid
        and i.verification_method = 'email'
        and i.email_hash is not null
      limit 1`;
    const identity = rows[0] as { email_masked: string | null; verification_method: string } | undefined;
    return NextResponse.json({
      configured: isEmailOtpConfigured(),
      required: isEmailVerificationRequired(),
      verified: Boolean(identity),
      emailMasked: identity?.email_masked ?? null,
      verificationMethod: identity?.verification_method ?? null,
      isDeveloperAdmin: await isDeveloperAdmin(sql, spotterId),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Email OTP status query failed', error);
    return NextResponse.json({ error: 'Email verification status is temporarily unavailable.' }, { status: 503 });
  }
}
