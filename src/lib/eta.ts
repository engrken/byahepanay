import type { Checkpoint, TimelineItem, Trip } from './types';

const MINUTE = 60_000;

export function estimateTimeline(
  trip: Trip,
  checkpoints: Checkpoint[],
  now = new Date(),
): { items: TimelineItem[]; delayMinutes: number; nextCheckpoint: Checkpoint | null; arrivalWindow: [Date, Date] | null } {
  const ordered = [...checkpoints].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  if (!ordered.length) return { items: [], delayMinutes: 0, nextCheckpoint: null, arrivalWindow: null };

  const departure = new Date(trip.departure_at);
  const lastId = trip.last_checkpoint_id ?? ordered[0].id;
  const lastIndex = Math.max(0, ordered.findIndex((point) => point.id === lastId));
  const nextCheckpoint = ordered[lastIndex + 1] ?? null;
  const expectedNextAt = nextCheckpoint
    ? departure.getTime() + (nextCheckpoint.eta_offset_minutes ?? 0) * MINUTE
    : now.getTime();
  // Sliding clock: while the next checkpoint is unconfirmed, lateness grows as real time advances.
  const delayMinutes = nextCheckpoint ? Math.max(0, Math.floor((now.getTime() - expectedNextAt) / MINUTE)) : 0;
  const confirmedAt = trip.last_checkpoint_at ? new Date(trip.last_checkpoint_at).getTime() : departure.getTime();

  const items = ordered.map((checkpoint, index): TimelineItem => {
    if (index <= lastIndex) {
      return { checkpoint, state: 'passed', eta: null, minutesAway: null };
    }
    if (trip.pending_checkpoint_id === checkpoint.id) {
      return {
        checkpoint,
        state: 'pending',
        eta: trip.pending_reported_at ? new Date(trip.pending_reported_at) : null,
        minutesAway: null,
      };
    }
    const baseline = departure.getTime() + (checkpoint.eta_offset_minutes ?? 0) * MINUTE;
    const slid = baseline + delayMinutes * MINUTE;
    const etaMs = Math.max(slid, confirmedAt + (checkpoint.eta_offset_minutes! - (ordered[lastIndex].eta_offset_minutes ?? 0)) * MINUTE);
    const eta = new Date(etaMs);
    return {
      checkpoint,
      state: index === lastIndex + 1 ? 'approaching' : 'upcoming',
      eta,
      minutesAway: Math.max(0, Math.ceil((etaMs - now.getTime()) / MINUTE)),
    };
  });

  const destinationEta = items[items.length - 1]?.eta;
  const arrivalWindow: [Date, Date] | null = destinationEta
    ? [new Date(destinationEta.getTime() - 3 * MINUTE), new Date(destinationEta.getTime() + 4 * MINUTE)]
    : null;
  return { items, delayMinutes, nextCheckpoint, arrivalWindow };
}

export function projectCadence(anchorAt: string, anchorType: 'ordinary' | 'aircon', count = 4) {
  const anchor = new Date(anchorAt);
  return Array.from({ length: count }, (_, index) => {
    const timestamp = new Date(anchor.getTime() + (index + 1) * 30 * MINUTE);
    const busType = (index + 1) % 2 === 0 ? anchorType : anchorType === 'aircon' ? 'ordinary' : 'aircon';
    return { departureAt: timestamp, busType, confidence: 'scheduled' as const };
  });
}

export function formatTime(value: Date | string | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function arrivalWindowLabel(window: [Date, Date] | null) {
  return window ? `${formatTime(window[0])} – ${formatTime(window[1])}` : 'Awaiting departure';
}
