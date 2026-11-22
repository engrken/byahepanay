import { NextRequest, NextResponse } from 'next/server';
import { createSpotterSessionToken, SPOTTER_SESSION_COOKIE } from '@/lib/session-core';
import { getSpotterSessionId } from '@/lib/spotter-session';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store, private' };
  if (getSpotterSessionId(request)) return NextResponse.json({ sessionReady: true }, { headers });
  const secret = process.env.SPOTTER_SESSION_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: 'Secure reporting is not configured. Contact the app administrator.', code: 'SESSION_SECRET_MISSING' }, { status: 503, headers });
  const session = createSpotterSessionToken(secret);
  const response = NextResponse.json({ sessionReady: true }, { headers });
  response.cookies.set(SPOTTER_SESSION_COOKIE, session.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: session.maxAge });
  return response;
}
