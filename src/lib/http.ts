import { NextResponse } from 'next/server';

export function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json({ error: message, code }, { status });
}

export function adminUnavailable() {
  return jsonError('Neon database is not configured. Attach the ByahePanay Neon integration or set DATABASE_URL.', 503, 'DATABASE_NOT_CONFIGURED');
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
