import type { Checkpoint } from './types';

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a: Pick<Checkpoint, 'lat' | 'lng'>, b: Pick<Checkpoint, 'lat' | 'lng'>): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function nearestCheckpoint<T extends Checkpoint>(
  point: Pick<GeolocationCoordinates, 'latitude' | 'longitude'>,
  checkpoints: T[],
  maxDistanceMeters = Number.POSITIVE_INFINITY,
): { checkpoint: T; distanceMeters: number } | null {
  if (!checkpoints.length) return null;
  let nearest: T | null = null;
  let nearestMeters = Number.POSITIVE_INFINITY;
  for (const checkpoint of checkpoints) {
    const meters = haversineKm(
      { lat: point.latitude, lng: point.longitude },
      { lat: checkpoint.lat, lng: checkpoint.lng },
    ) * 1000;
    if (meters < nearestMeters) {
      nearest = checkpoint;
      nearestMeters = meters;
    }
  }
  return nearest && nearestMeters <= maxDistanceMeters ? { checkpoint: nearest, distanceMeters: nearestMeters } : null;
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}
