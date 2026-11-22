export const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000;
export const ACTIVE_PRESENCE_WINDOW_MINUTES = 5;
export const ACTIVE_REPORT_WINDOW_MINUTES = 15;
export const MAX_NEAREST_STOP_DISTANCE_METERS = 1_500;

export function isPresenceFresh(lastSeenAt: string | Date, now = Date.now()) {
  const timestamp = lastSeenAt instanceof Date ? lastSeenAt.getTime() : new Date(lastSeenAt).getTime();
  const age = now - timestamp;
  return Number.isFinite(timestamp) && age >= 0 && age <= ACTIVE_PRESENCE_WINDOW_MINUTES * 60_000;
}
