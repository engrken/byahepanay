import type { NextRequest } from 'next/server';
import { SPOTTER_SESSION_COOKIE, verifySpotterSessionToken } from './session-core';
export { SPOTTER_SESSION_COOKIE };
export function getSpotterSessionId(request: NextRequest): string | null {
  return verifySpotterSessionToken(request.cookies.get(SPOTTER_SESSION_COOKIE)?.value, process.env.SPOTTER_SESSION_SECRET);
}
