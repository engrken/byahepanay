export type BusType = 'ordinary' | 'aircon';
export type Confidence = 'scheduled' | 'unverified' | 'verified';
export type CorridorTab = 'iloilo' | 'kalibo' | 'tapaz' | 'estancia';

export interface Checkpoint {
  id: string;
  code: string;
  name: string;
  lat: number;
  lng: number;
  sequence?: number;
  eta_offset_minutes?: number;
  segment_minutes?: number;
  dwell_buffer_minutes?: number;
}

export interface RouteDefinition {
  id: string;
  name: string;
  short_name: string;
  destination: string;
  checkpoints: Checkpoint[];
}

export interface Trip {
  id: string;
  route_id: string;
  bus_type: BusType;
  departure_at: string;
  status: 'active' | 'arrived' | 'cancelled';
  last_checkpoint_id: string | null;
  last_checkpoint_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
  confidence_status: Confidence;
  pending_checkpoint_id?: string | null;
  pending_reported_at?: string | null;
  delay_minutes?: number;
  body_number?: string | null;
  plate_number?: string | null;
  rider_status?: string | null;
  route_locked?: boolean;
  route_candidate?: string | null;
}

export interface BoardData {
  configured: boolean;
  routes: RouteDefinition[];
  trips: Trip[];
}

export interface TimelineItem {
  checkpoint: Checkpoint;
  state: 'passed' | 'pending' | 'approaching' | 'upcoming';
  eta: Date | null;
  minutesAway: number | null;
}
