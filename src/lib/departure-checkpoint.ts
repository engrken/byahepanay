import type { Checkpoint, RouteDefinition } from '@/lib/types';

/** Stops returned by the live board; the destination terminal cannot be a trip start. */
export function getStartableCheckpoints(route: RouteDefinition | null | undefined): Checkpoint[] {
  return route?.checkpoints.slice(0, -1) ?? [];
}

/** A selected checkpoint is valid only when it belongs to the live database-backed route. */
export function resolveDepartureCheckpoint(
  route: RouteDefinition | null | undefined,
  selectedCheckpointId: string,
): Checkpoint | null {
  const available = getStartableCheckpoints(route);
  return available.find((checkpoint) => checkpoint.id === selectedCheckpointId) ?? available[0] ?? null;
}

/** The departure API expects the UUID primary key returned by /api/board. */
export function isPersistedCheckpointId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
