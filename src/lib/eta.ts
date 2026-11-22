import type { Checkpoint, CheckpointLandmark, TimelineItem, Trip } from './types';
import { MAX_LANDMARK_ETA_ROUTE_DISTANCE_METERS } from './checkpoint-landmarks.ts';

const MINUTE = 60_000;
export const CONFIRMATION_OVERDUE_GRACE_MINUTES = 15;
export const TRACKING_LOST_AFTER_MINUTES = 90;

function effectiveOffsets(trip: Trip, ordered: Checkpoint[]) {
  const offsets: number[] = [];
  ordered.forEach((checkpoint, index) => {
    if (index === 0) {
      offsets.push(checkpoint.eta_offset_minutes ?? 0);
      return;
    }
    const previous = ordered[index - 1];
    const calibrated = checkpoint.calibrated_segment_minutes?.[trip.bus_type];
    if (calibrated !== undefined) {
      offsets.push(offsets[index - 1] + calibrated);
      return;
    }
    const fallback = checkpoint.segment_minutes ?? Math.max(
      0,
      (checkpoint.eta_offset_minutes ?? 0)
        - (previous.eta_offset_minutes ?? 0)
        - (previous.dwell_buffer_minutes ?? 0),
    );
    offsets.push(offsets[index - 1] + fallback + (previous.dwell_buffer_minutes ?? 0));
  });
  return offsets;
}

export interface TimelineEstimate {
  items: TimelineItem[];
  delayMinutes: number;
  nextCheckpoint: Checkpoint | null;
  arrivalWindow: [Date, Date] | null;
  minutesSinceCheckpoint: number;
  confirmationOverdue: boolean;
  trackingLost: boolean;
}

export function estimateTimeline(
  trip: Trip,
  checkpoints: Checkpoint[],
  now = new Date(),
): TimelineEstimate {
  const ordered = [...checkpoints].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  if (!ordered.length) {
    return {
      items: [], delayMinutes: 0, nextCheckpoint: null, arrivalWindow: null,
      minutesSinceCheckpoint: 0, confirmationOverdue: false, trackingLost: false,
    };
  }

  const offsets = effectiveOffsets(trip, ordered);
  const departure = new Date(trip.departure_at);
  const configuredStartIndex = trip.start_checkpoint_id
    ? ordered.findIndex((point) => point.id === trip.start_checkpoint_id)
    : 0;
  const startIndex = configuredStartIndex >= 0 ? configuredStartIndex : 0;
  const lastId = trip.last_checkpoint_id ?? trip.start_checkpoint_id ?? ordered[startIndex].id;
  const foundLastIndex = ordered.findIndex((point) => point.id === lastId);
  const lastIndex = foundLastIndex >= startIndex ? foundLastIndex : startIndex;
  const startOffset = offsets[startIndex] ?? 0;
  const nextCheckpoint = ordered[lastIndex + 1] ?? null;
  const expectedNextAt = nextCheckpoint
    ? departure.getTime() + (offsets[lastIndex + 1] - startOffset) * MINUTE
    : now.getTime();
  const delayMinutes = nextCheckpoint
    ? Math.max(0, Math.floor((now.getTime() - expectedNextAt) / MINUTE))
    : 0;
  const confirmedAt = trip.last_checkpoint_at
    ? new Date(trip.last_checkpoint_at).getTime()
    : departure.getTime();
  const minutesSinceCheckpoint = Math.max(0, Math.floor((now.getTime() - confirmedAt) / MINUTE));
  const trackingLost = trip.status === 'active' && minutesSinceCheckpoint >= TRACKING_LOST_AFTER_MINUTES;
  const confirmationOverdue = Boolean(nextCheckpoint)
    && !trackingLost
    && delayMinutes >= CONFIRMATION_OVERDUE_GRACE_MINUTES;

  const items = ordered.map((checkpoint, index): TimelineItem => {
    if (index < startIndex) return { checkpoint, state: 'not_started', eta: null, minutesAway: null };
    if (index <= lastIndex) return { checkpoint, state: 'passed', eta: null, minutesAway: null };
    if (trip.pending_checkpoint_id === checkpoint.id) {
      return {
        checkpoint,
        state: 'pending',
        eta: trip.pending_reported_at ? new Date(trip.pending_reported_at) : null,
        minutesAway: null,
      };
    }
    if (trackingLost) return { checkpoint, state: 'stale', eta: null, minutesAway: null };

    const baseline = departure.getTime() + (offsets[index] - startOffset) * MINUTE;
    const slid = baseline + delayMinutes * MINUTE;
    const etaMs = Math.max(slid, confirmedAt + (offsets[index] - offsets[lastIndex]) * MINUTE);
    const eta = new Date(etaMs);
    return {
      checkpoint,
      state: index === lastIndex + 1 ? 'approaching' : 'upcoming',
      eta,
      minutesAway: Math.max(0, Math.ceil((etaMs - now.getTime()) / MINUTE)),
    };
  });

  const destinationEta = items[items.length - 1]?.eta;
  const arrivalWindow: [Date, Date] | null = trackingLost
    ? null
    : destinationEta
      ? [new Date(destinationEta.getTime() - 3 * MINUTE), new Date(destinationEta.getTime() + 4 * MINUTE)]
      : null;

  return {
    items,
    delayMinutes,
    nextCheckpoint,
    arrivalWindow,
    minutesSinceCheckpoint,
    confirmationOverdue,
    trackingLost,
  };
}


export interface LandmarkRouteProjection {
  segmentIndex: number;
  fraction: number;
  distanceMeters: number;
}

export interface LandmarkEtaEstimate {
  status: 'estimated' | 'passed' | 'needs_review' | 'unavailable';
  eta: Date | null;
  minutesAway: number | null;
  distanceFromRouteMeters: number;
}

/** Project a landmark onto the nearest segment of the selected route polyline. */
export function projectLandmarkToRoute(
  landmark: Pick<CheckpointLandmark, 'lat' | 'lng'>,
  checkpoints: Checkpoint[],
): LandmarkRouteProjection | null {
  if (checkpoints.length < 2) return null;
  const earthRadius = 6_371_008.8;
  let nearest: LandmarkRouteProjection | null = null;

  for (let index = 0; index < checkpoints.length - 1; index += 1) {
    const start = checkpoints[index];
    const end = checkpoints[index + 1];
    const referenceLatitude = ((start.lat + end.lat + landmark.lat) / 3) * Math.PI / 180;
    const metersPerDegreeLatitude = earthRadius * Math.PI / 180;
    const metersPerDegreeLongitude = metersPerDegreeLatitude * Math.cos(referenceLatitude);
    const x = (lng: number) => lng * metersPerDegreeLongitude;
    const y = (lat: number) => lat * metersPerDegreeLatitude;
    const ax = x(start.lng);
    const ay = y(start.lat);
    const dx = x(end.lng) - ax;
    const dy = y(end.lat) - ay;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) continue;
    const fraction = Math.max(0, Math.min(1, ((x(landmark.lng) - ax) * dx + (y(landmark.lat) - ay) * dy) / lengthSquared));
    const projectedX = ax + fraction * dx;
    const projectedY = ay + fraction * dy;
    const distanceMeters = Math.hypot(x(landmark.lng) - projectedX, y(landmark.lat) - projectedY);
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = { segmentIndex: index, fraction, distanceMeters };
    }
  }

  return nearest;
}

/**
 * Estimate a landmark ETA by interpolating between the two adjacent barangay ETAs.
 * Landmarks far from the planning route or outside their barangay's adjacent route
 * segments are shown for reference but deliberately receive no ETA.
 */
export function estimateLandmarkEta(
  trip: Trip,
  checkpoints: Checkpoint[],
  timeline: TimelineEstimate,
  landmark: CheckpointLandmark,
  now = new Date(),
): LandmarkEtaEstimate {
  const ordered = [...checkpoints].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const projection = projectLandmarkToRoute(landmark, ordered);
  const unavailable = (status: LandmarkEtaEstimate['status'], distanceFromRouteMeters = Number.POSITIVE_INFINITY): LandmarkEtaEstimate => ({
    status, eta: null, minutesAway: null, distanceFromRouteMeters,
  });
  if (!projection) return unavailable('unavailable');

  const parentIndex = ordered.findIndex((checkpoint) => checkpoint.code === landmark.checkpointCode);
  if (parentIndex < 0 || projection.distanceMeters > MAX_LANDMARK_ETA_ROUTE_DISTANCE_METERS ||
      projection.segmentIndex < parentIndex - 1 || projection.segmentIndex > parentIndex) {
    return unavailable('needs_review', projection.distanceMeters);
  }

  const startIndexCandidate = trip.start_checkpoint_id
    ? ordered.findIndex((checkpoint) => checkpoint.id === trip.start_checkpoint_id)
    : 0;
  const startIndex = startIndexCandidate >= 0 ? startIndexCandidate : 0;
  const lastId = trip.last_checkpoint_id ?? trip.start_checkpoint_id ?? ordered[startIndex]?.id;
  const foundLastIndex = ordered.findIndex((checkpoint) => checkpoint.id === lastId);
  const lastIndex = foundLastIndex >= startIndex ? foundLastIndex : startIndex;
  const segmentIndex = projection.segmentIndex;

  if (segmentIndex < lastIndex || trip.status === 'arrived') {
    return unavailable('passed', projection.distanceMeters);
  }
  if (trip.status !== 'active') return unavailable('unavailable', projection.distanceMeters);

  const startTime = segmentIndex === lastIndex
    ? new Date(trip.last_checkpoint_at ?? trip.departure_at)
    : timeline.items[segmentIndex]?.eta;
  const endTime = timeline.items[segmentIndex + 1]?.eta;
  if (!startTime || !endTime || !Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) ||
      endTime.getTime() < startTime.getTime()) {
    return unavailable('unavailable', projection.distanceMeters);
  }

  const etaMs = startTime.getTime() + (endTime.getTime() - startTime.getTime()) * projection.fraction;
  const eta = new Date(etaMs);
  return {
    status: 'estimated',
    eta,
    minutesAway: Math.max(0, Math.ceil((etaMs - now.getTime()) / MINUTE)),
    distanceFromRouteMeters: projection.distanceMeters,
  };
}

export function projectCadence(anchorAt: string, anchorType: 'ordinary' | 'aircon', count = 4) {
  const anchor = new Date(anchorAt);
  return Array.from({ length: count }, (_, index) => {
    const timestamp = new Date(anchor.getTime() + (index + 1) * 30 * MINUTE);
    const busType = (index + 1) % 2 === 0
      ? anchorType
      : anchorType === 'aircon' ? 'ordinary' : 'aircon';
    return { departureAt: timestamp, busType, confidence: 'scheduled' as const };
  });
}

export function formatTime(value: Date | string | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function arrivalWindowLabel(window: [Date, Date] | null) {
  return window ? `${formatTime(window[0])} – ${formatTime(window[1])}` : 'Awaiting confirmation';
}
