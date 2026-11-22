import type { Checkpoint, RouteDefinition } from './types';

// Approximate municipal/roadside anchor points for prototype planning only.
// Replace with field-verified highway-side coordinates before public launch.
const P = {
  pueblo: { code: 'pueblo_terminal', name: 'Pueblo de Panay Terminal', lat: 11.55987, lng: 122.74805 },
  lawaan: { code: 'lawaan', name: 'Lawaan', lat: 11.551354, lng: 122.758464 },
  bolo: { code: 'bolo', name: 'Bolo', lat: 11.543040, lng: 122.758362 },
  lanot: { code: 'lanot', name: 'Lanot', lat: 11.522087, lng: 122.757176 },
  lonoy: { code: 'lonoy', name: 'Loñoy', lat: 11.510291, lng: 122.744620 },
  ivisan: { code: 'ivisan', name: 'Ivisan', lat: 11.518743, lng: 122.697715 },
  sigma: { code: 'sigma', name: 'Sigma', lat: 11.4219, lng: 122.6664 },
  dao: { code: 'dao', name: 'Dao', lat: 11.3937, lng: 122.6856 },
  cuartero: { code: 'cuartero', name: 'Cuartero', lat: 11.3407, lng: 122.6694 },
  dumarao: { code: 'dumarao', name: 'Dumarao', lat: 11.2654, lng: 122.6889 },
  passi: { code: 'passi_city', name: 'Passi City', lat: 11.1078, lng: 122.6415 },
  duenas: { code: 'duenas', name: 'Dueñas', lat: 11.0675, lng: 122.6180 },
  pototan: { code: 'pototan', name: 'Pototan', lat: 10.9440, lng: 122.6350 },
  zarraga: { code: 'zarraga', name: 'Zarraga', lat: 10.8240, lng: 122.6080 },
  leganes: { code: 'leganes', name: 'Leganes', lat: 10.7870, lng: 122.5890 },
  jaro: { code: 'jaro', name: 'Jaro', lat: 10.7370, lng: 122.5650 },
  tagbak: { code: 'tagbak_terminal', name: 'Tagbak Terminal (Iloilo)', lat: 10.7700, lng: 122.5570 },
  mambusao: { code: 'mambusao', name: 'Mambusao', lat: 11.4336, lng: 122.5982 },
  altavas: { code: 'altavas', name: 'Altavas', lat: 11.5350, lng: 122.4900 },
  balete: { code: 'balete', name: 'Balete', lat: 11.5680, lng: 122.3850 },
  banga: { code: 'banga', name: 'Banga', lat: 11.6380, lng: 122.3400 },
  kalibo: { code: 'kalibo_terminal', name: 'Kalibo Terminal', lat: 11.7060, lng: 122.3650 },
  sapian: { code: 'sapian', name: 'Sapian', lat: 11.4943, lng: 122.6027 },
  jamindan: { code: 'jamindan', name: 'Jamindan', lat: 11.4002, lng: 122.4983 },
  tapaz: { code: 'tapaz', name: 'Tapaz', lat: 11.2613, lng: 122.5364 },
  calinog: { code: 'calinog', name: 'Calinog', lat: 11.13, lng: 122.49 },
  loctugan: { code: 'loctugan', name: 'Loctugan', lat: 11.5660, lng: 122.7780 },
  panitan: { code: 'panitan', name: 'Panitan', lat: 11.4660, lng: 122.7725 },
  pontevedra: { code: 'pontevedra', name: 'Pontevedra', lat: 11.4812, lng: 122.8325 },
  president_roxas: { code: 'president_roxas', name: 'President Roxas', lat: 11.4310, lng: 122.9279 },
  pilar: { code: 'pilar', name: 'Pilar', lat: 11.4870, lng: 122.9963 },
  balasan: { code: 'balasan', name: 'Balasan', lat: 11.4700, lng: 123.0800 },
  estancia: { code: 'estancia_terminal', name: 'Estancia Terminal', lat: 11.4550, lng: 123.1510 },
} satisfies Record<string, Omit<Checkpoint, 'id'>>;

type PointKey = keyof typeof P;
type RouteStep = readonly [PointKey, number, number?]; // point, cumulative minutes, dwell buffer

function makeRoute(
  id: string,
  name: string,
  short_name: string,
  destination: string,
  steps: readonly RouteStep[],
): RouteDefinition {
  const checkpoints = steps.map(([key, offset, dwell = 0], index) => {
    const base = P[key];
    const previousOffset = index === 0 ? 0 : steps[index - 1][1];
    const previousDwell = index === 0 ? 0 : (steps[index - 1][2] ?? 0);
    return {
      id: base.code,
      ...base,
      sequence: index,
      eta_offset_minutes: offset,
      segment_minutes: index === 0 ? 0 : Math.max(0, offset - previousOffset - previousDwell),
      dwell_buffer_minutes: dwell,
    };
  });
  return { id, name, short_name, destination, checkpoints };
}

const trunk: readonly RouteStep[] = [
  ['pueblo', 0], ['lawaan', 4], ['bolo', 7], ['lanot', 11], ['lonoy', 17], ['ivisan', 23],
];

const OUTBOUND_ROUTES: RouteDefinition[] = [
  makeRoute('iloilo_passi', 'Roxas City → Iloilo via Passi', 'Iloilo · Passi', 'Tagbak Terminal', [
    ...trunk, ['sigma', 33], ['dao', 43], ['cuartero', 53], ['dumarao', 65], ['passi', 83, 8],
    ['duenas', 98], ['pototan', 110], ['zarraga', 125], ['leganes', 133], ['jaro', 143], ['tagbak', 150],
  ]),
  makeRoute('kalibo_mambusao', 'Roxas City → Kalibo via Mambusao', 'Kalibo · Mambusao', 'Kalibo Terminal', [
    ...trunk, ['sigma', 33], ['mambusao', 45], ['altavas', 68], ['balete', 83], ['banga', 98], ['kalibo', 110],
  ]),
  makeRoute('kalibo_sapian', 'Roxas City → Kalibo via Sapian', 'Kalibo · Sapian', 'Kalibo Terminal', [
    ...trunk, ['sapian', 36], ['altavas', 54], ['balete', 69], ['banga', 84], ['kalibo', 96],
  ]),
  makeRoute('tapaz', 'Roxas City → Tapaz / Calinog', 'Tapaz', 'Calinog', [
    ...trunk, ['sigma', 33], ['mambusao', 45], ['jamindan', 60], ['tapaz', 78], ['calinog', 95],
  ]),
  makeRoute('estancia', 'Roxas City → Estancia', 'Estancia', 'Estancia Terminal', [
    ['pueblo', 0], ['lawaan', 4], ['bolo', 7], ['lanot', 11], ['loctugan', 16], ['panitan', 23],
    ['pontevedra', 35], ['president_roxas', 48], ['pilar', 63], ['balasan', 78], ['estancia', 90],
  ]),
];

const RETURN_LABELS: Record<string, { name: string; short_name: string }> = {
  iloilo_passi: { name: 'Iloilo → Roxas City via Passi', short_name: 'Iloilo · Passi → Roxas' },
  kalibo_mambusao: { name: 'Kalibo → Roxas City via Mambusao', short_name: 'Kalibo · Mambusao → Roxas' },
  kalibo_sapian: { name: 'Kalibo → Roxas City via Sapian', short_name: 'Kalibo · Sapian → Roxas' },
  tapaz: { name: 'Calinog → Roxas City via Tapaz', short_name: 'Tapaz → Roxas' },
  estancia: { name: 'Estancia → Roxas City', short_name: 'Estancia → Roxas' },
};

function reverseRoute(route: RouteDefinition): RouteDefinition {
  const reversed = [...route.checkpoints].reverse();
  let elapsed = 0;
  const checkpoints = reversed.map((checkpoint, index) => {
    const previousOutboundCheckpoint = index === 0 ? null : route.checkpoints[route.checkpoints.length - index];
    const segment = previousOutboundCheckpoint?.segment_minutes ?? 0;
    if (previousOutboundCheckpoint) {
      elapsed += segment + (previousOutboundCheckpoint.dwell_buffer_minutes ?? 0);
    }
    return {
      ...checkpoint,
      sequence: index,
      eta_offset_minutes: elapsed,
      segment_minutes: segment,
      // Outbound calibration samples must not be reused in the opposite direction.
      calibrated_segment_minutes: undefined,
      calibration_sample_count: undefined,
    };
  });
  const label = RETURN_LABELS[route.id];
  return {
    id: `${route.id}_return`,
    name: label.name,
    short_name: label.short_name,
    destination: 'Pueblo de Panay Terminal',
    checkpoints,
  };
}

export const ROUTES: RouteDefinition[] = [
  ...OUTBOUND_ROUTES,
  ...OUTBOUND_ROUTES.map(reverseRoute),
];

export function routeForTab(
  tab: 'iloilo' | 'kalibo' | 'tapaz' | 'estancia',
  kaliboVia: 'mambusao' | 'sapian' = 'mambusao',
  direction: 'outbound' | 'inbound' = 'outbound',
) {
  const baseId = tab === 'iloilo' ? 'iloilo_passi' : tab === 'tapaz' ? 'tapaz' : tab === 'estancia' ? 'estancia' : `kalibo_${kaliboVia}`;
  const id = direction === 'inbound' ? `${baseId}_return` : baseId;
  return ROUTES.find((route) => route.id === id) ?? ROUTES[0];
}
