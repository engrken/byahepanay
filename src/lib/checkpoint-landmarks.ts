import type { Checkpoint, CheckpointLandmark, RouteDefinition } from './types';

/**
 * Owner-supplied landmark coordinates for the Roxas City ↔ Iloilo via Passi corridor.
 * These are useful map references, not field-certified roadside waiting spots yet.
 */
const LANDMARKS: CheckpointLandmark[] = [
  { id: 'iloilo-pueblo-transport-terminal', checkpointCode: 'pueblo_terminal', name: 'Roxas City Integrated Transport Terminal', lat: 11.5895, lng: 122.75, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-lawaan-city-hardware', checkpointCode: 'lawaan', name: 'CitiHardware Roxas', lat: 11.5525, lng: 122.7585, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-lawaan-covered-gym', checkpointCode: 'lawaan', name: 'Lawaan Covered Gym', lat: 11.5525, lng: 122.7585, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-bolo-venancio-alba-school', checkpointCode: 'bolo', name: 'Venancio Alba Elementary School', lat: 11.539046, lng: 122.757922, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-bolo-barangay-hall', checkpointCode: 'bolo', name: 'Brgy. Bolo Barangay Hall', lat: 11.5386, lng: 122.7581, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-lanot-welcome-rotonda', checkpointCode: 'lanot', name: 'Crossing Lanot Welcome Rotonda', lat: 11.5205, lng: 122.7576, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-lanot-crossing', checkpointCode: 'lanot', name: 'Crossing Lanot', lat: 11.5205, lng: 122.7576, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-lonoy-barangay-hall', checkpointCode: 'lonoy', name: 'LONOY BRGY HALL', lat: 11.5103, lng: 122.7393, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-lonoy-cudian-school', checkpointCode: 'lonoy', name: 'Cudian Elementary School', lat: 11.513922, lng: 122.730020, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-ivisan-arriba-rotonda', checkpointCode: 'ivisan', name: 'Arriba Ivisan Rotonda', lat: 11.5217, lng: 122.6911, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-ivisan-mirola-hardware', checkpointCode: 'ivisan', name: 'Mirola Hardware', lat: 11.518403, lng: 122.693483, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-sigma-inc-mianay', checkpointCode: 'sigma', name: 'Iglesia ni Cristo (Mianay)', lat: 11.460271, lng: 122.690696, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-sigma-seven-eleven', checkpointCode: 'sigma', name: '7-Eleven Sigma', lat: 11.419263, lng: 122.666483, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-dao-terminal', checkpointCode: 'dao', name: 'Dao Terminal', lat: 11.396631, lng: 122.679338, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-dao-plaza', checkpointCode: 'dao', name: 'Dao Plaza', lat: 11.3944, lng: 122.6858, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-cuartero-cebuana', checkpointCode: 'cuartero', name: 'Cebuana Lhuillier Pawnshop', lat: 11.342597, lng: 122.671416, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-dumarao-bus-stop', checkpointCode: 'dumarao', name: 'Dumarao Bus Stop', lat: 11.260983, lng: 122.678046, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-dumarao-capsu', checkpointCode: 'dumarao', name: 'CAPSU Dumarao', lat: 11.244462, lng: 122.677282, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-capiz-iloilo-boundary', checkpointCode: 'dumarao', name: 'Capiz–Iloilo Boundary', lat: 11.212420, lng: 122.667750, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-passi-citymall', checkpointCode: 'passi_city', name: 'CityMall Passi', lat: 11.1050, lng: 122.6420, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-duenas-town-plaza', checkpointCode: 'duenas', name: 'Dueñas Town Plaza', lat: 11.0667, lng: 122.6167, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-pototan-astrodome', checkpointCode: 'pototan', name: 'Pototan Astrodome', lat: 11.0333, lng: 122.6333, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-zarraga-town-hall', checkpointCode: 'zarraga', name: 'Zarraga Town Hall', lat: 10.8226921, lng: 122.6089538, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-leganes-town-plaza', checkpointCode: 'leganes', name: 'Leganes Town Plaza', lat: 10.7851, lng: 122.5902, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-jaro-plaza', checkpointCode: 'jaro', name: 'Jaro Plaza', lat: 10.7244, lng: 122.5573, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-tagbak-citymall', checkpointCode: 'tagbak_terminal', name: 'CityMall Tagbak', lat: 10.7663, lng: 122.5761, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
  { id: 'iloilo-tagbak-bus-terminal', checkpointCode: 'tagbak_terminal', name: 'Tagbak Bus Terminal', lat: 10.7663, lng: 122.5761, coordinateSource: 'owner_supplied_coordinates', validationStatus: 'pending_field_validation' },
];

export const LANDMARK_ENABLED_ROUTE_IDS = ['iloilo_passi', 'iloilo_passi_return'] as const;

/** Maximum distance from the planning route line for a landmark to receive an interpolated ETA. */
export const MAX_LANDMARK_ETA_ROUTE_DISTANCE_METERS = 750;

export function findCheckpointLandmark(id: string | undefined): CheckpointLandmark | null {
  return id ? LANDMARKS.find((landmark) => landmark.id === id) ?? null : null;
}

export function landmarksForCheckpoint(code: string): CheckpointLandmark[] {
  return LANDMARKS.filter((landmark) => landmark.checkpointCode === code);
}

export function attachLandmarksToRoute(route: RouteDefinition): RouteDefinition {
  if (!LANDMARK_ENABLED_ROUTE_IDS.includes(route.id as typeof LANDMARK_ENABLED_ROUTE_IDS[number])) return route;
  return {
    ...route,
    checkpoints: route.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      landmarks: landmarksForCheckpoint(checkpoint.code),
    })),
  };
}

export function attachLandmarksToCheckpoint<T extends Checkpoint>(checkpoint: T, routeId: string): T {
  if (!LANDMARK_ENABLED_ROUTE_IDS.includes(routeId as typeof LANDMARK_ENABLED_ROUTE_IDS[number])) return checkpoint;
  return { ...checkpoint, landmarks: landmarksForCheckpoint(checkpoint.code) };
}
