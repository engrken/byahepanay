'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ROUTES, routeForTab } from '@/lib/corridors';
import { estimateTimeline, formatTime, projectCadence, arrivalWindowLabel } from '@/lib/eta';
import { nearestCheckpoint, formatDistance } from '@/lib/geo';
import { enqueueSighting, flushSightingQueue, getQueuedSightingCount, type QueuedSighting } from '@/lib/offline-queue';
import type { BoardData, BusType, Checkpoint, CorridorTab, RouteDefinition, Trip } from '@/lib/types';

const EMPTY_BOARD: BoardData = { configured: false, routes: ROUTES, trips: [] };
type UiMessage = { kind: 'info' | 'success' | 'error' | 'warning'; text: string } | null;

async function ensureSpotterSession() {
  const response = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) { const result = await response.json().catch(() => ({})) as { error?: string }; throw new Error(result.error ?? 'Could not initialize a secure reporting session.'); }
}
function createRequestId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('This browser cannot create secure report identifiers.');
  return globalThis.crypto.randomUUID();
}
function routeMatchesTab(routeId: string, tab: CorridorTab) {
  if (tab === 'kalibo') return routeId === 'kalibo_mambusao' || routeId === 'kalibo_sapian';
  if (tab === 'iloilo') return routeId === 'iloilo_passi';
  return routeId === tab;
}

function ConfidenceBadge({ value }: { value: 'scheduled' | 'unverified' | 'verified' }) {
  const labels = {
    verified: ['🟢', 'Verified'],
    unverified: ['🟡', 'Unverified'],
    scheduled: ['⚪', 'Scheduled · Unconfirmed'],
  } as const;
  return <span className={`confidence ${value}`}><span>{labels[value][0]}</span>{labels[value][1]}</span>;
}

function ErrorNotice({ message }: { message: UiMessage }) {
  if (!message) return null;
  return <div role="status" className={`notice ${message.kind === 'error' ? 'error' : message.kind === 'success' ? 'success' : message.kind === 'info' ? 'info' : ''}`}>{message.text}</div>;
}

export default function Tracker() {
  const [board, setBoard] = useState<BoardData>(EMPTY_BOARD);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [themeReady, setThemeReady] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => new Date());
  const [tab, setTab] = useState<CorridorTab>('iloilo');
  const [kaliboVia, setKaliboVia] = useState<'mambusao' | 'sapian'>('mambusao');
  const [waitStopId, setWaitStopId] = useState<string | null>(null);
  const [message, setMessage] = useState<UiMessage>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [departureOpen, setDepartureOpen] = useState(false);
  const [departureType, setDepartureType] = useState<BusType>('aircon');
  const [departureBody, setDepartureBody] = useState('');
  const [departurePlate, setDeparturePlate] = useState('');
  const [busy, setBusy] = useState(false);
  const [tagBody, setTagBody] = useState('');
  const [tagPlate, setTagPlate] = useState('');
  const [riderMode, setRiderMode] = useState(false);
  const [lastBeaconAt, setLastBeaconAt] = useState<string | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [riderLocation, setRiderLocation] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const lastBeaconCheckpointRef = useRef<string | null>(null);

  const refreshBoard = useCallback(async () => {
    try {
      const response = await fetch('/api/board', { cache: 'no-store' });
      if (!response.ok) throw new Error('Live board unavailable');
      const data = await response.json() as BoardData;
      setBoard(data);
      try { window.localStorage.setItem('byahepanay-board-cache', JSON.stringify(data)); } catch { /* Storage may be disabled or full. */ }
    } catch {
      setBoard((current) => current.routes.length ? current : EMPTY_BOARD);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const clockTimer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    let nextTheme: 'light' | 'dark' = 'light';
    try {
      const savedTheme = window.localStorage.getItem('byahepanay-theme');
      nextTheme = savedTheme === 'light' || savedTheme === 'dark'
        ? savedTheme
        : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      nextTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', nextTheme === 'dark' ? '#101a22' : '#152b3a');
    setTheme(nextTheme);
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101a22' : '#152b3a');
    try { window.localStorage.setItem('byahepanay-theme', theme); } catch { /* Theme still applies for this page session. */ }
  }, [theme, themeReady]);

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    updateConnection();
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  useEffect(() => {
    try {
      const cached = window.localStorage.getItem('byahepanay-board-cache');
      if (cached) setBoard(JSON.parse(cached) as BoardData);
    } catch { /* Ignore invalid or unavailable local cache. */ }
    void ensureSpotterSession().catch(() => setMessage({ kind: 'warning', text: 'Secure reporting is unavailable until a session can be initialized.' }));
    void refreshBoard();
    void getQueuedSightingCount().then(setQueuedCount);
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    const online = () => {
      void flushSightingQueue().then(({ remaining, sent }) => {
        setQueuedCount(remaining);
        if (sent > 0) {
          setMessage({ kind: 'success', text: `${sent} offline sighting${sent === 1 ? '' : 's'} synced.` });
          void refreshBoard();
        }
      }).catch(() => undefined);
    };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [refreshBoard]);

  useEffect(() => {
    // Neon Realtime is optional; poll the server-side Neon board while the page is visible.
    const poll = () => {
      if (document.visibilityState === 'visible') void refreshBoard();
    };
    const timer = window.setInterval(poll, 10_000);
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('focus', poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
      window.removeEventListener('focus', poll);
    };
  }, [refreshBoard]);

  const selectedRoute = useMemo(() => routeForTab(tab, kaliboVia), [tab, kaliboVia]);
  const selectedBoardRoute = useMemo(
    () => board.routes.find((route) => route.id === selectedRoute.id) ?? selectedRoute,
    [board.routes, selectedRoute],
  );
  const relatedTrips = useMemo(() => board.trips
    .filter((trip) => (routeMatchesTab(trip.route_id, tab) || (trip.route_candidate ? routeMatchesTab(trip.route_candidate, tab) : false)) && (trip.status === 'active' || trip.status === 'arrived'))
    .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || new Date(b.departure_at).getTime() - new Date(a.departure_at).getTime()), [board.trips, tab]);

  // Use the rider's browser location to find the nearest mapped stop on the selected corridor.
  // The coordinates stay on this device unless the rider separately submits a bus sighting.
  const nearestUserStop = useMemo(
    () => riderLocation ? nearestCheckpoint(riderLocation, selectedBoardRoute.checkpoints) : null,
    [riderLocation, selectedBoardRoute],
  );
  const targetStop = useMemo(() => {
    if (waitStopId) {
      const manualStop = board.routes.flatMap((route) => route.checkpoints).find((point) => point.id === waitStopId);
      if (manualStop) return manualStop;
    }
    return nearestUserStop?.checkpoint ?? null;
  }, [board.routes, nearestUserStop, waitStopId]);

  // Rank every active trip that actually passes the rider's selected stop.
  // A bus that has already passed the stop, or only has an unverified report there, is not ranked as incoming.
  const rankedArrivals = useMemo(() => {
    if (!targetStop) return [];
    return relatedTrips.map((trip) => {
      if (trip.status !== 'active') return null;
      const routeId = !trip.route_locked && trip.route_candidate ? trip.route_candidate : trip.route_id;
      const route = board.routes.find((candidate) => candidate.id === routeId);
      if (!route) return null;
      const tripTimeline = estimateTimeline(trip, route.checkpoints, clock);
      const stopItem = tripTimeline.items.find((item) => item.checkpoint.id === targetStop.id);
      if (!stopItem || stopItem.state === 'passed' || stopItem.state === 'pending' || !stopItem.eta || stopItem.minutesAway === null) {
        return null;
      }
      return { trip, route, eta: stopItem.eta, minutesAway: stopItem.minutesAway };
    }).filter((arrival): arrival is { trip: Trip; route: RouteDefinition; eta: Date; minutesAway: number } => arrival !== null)
      .sort((a, b) => a.eta.getTime() - b.eta.getTime());
  }, [relatedTrips, targetStop, board.routes, clock]);

  // The earliest estimated arrival becomes the primary bus shown in the tracker.
  const activeTrip: Trip | null = rankedArrivals[0]?.trip ?? relatedTrips[0] ?? null;
  const activeRoute: RouteDefinition = useMemo(() => {
    if (activeTrip) {
      const displayRouteId = !activeTrip.route_locked && activeTrip.route_candidate
        ? activeTrip.route_candidate : activeTrip.route_id;
      return board.routes.find((route) => route.id === displayRouteId) ?? selectedBoardRoute;
    }
    return selectedBoardRoute;
  }, [activeTrip, board.routes, selectedBoardRoute]);
  const timeline = useMemo(() => activeTrip
    ? estimateTimeline(activeTrip, activeRoute.checkpoints, clock)
    : null, [activeTrip, activeRoute, clock]);
  const waitItem = targetStop
    ? timeline?.items.find((item) => item.checkpoint.id === targetStop.id) ?? null
    : null;
  const cadence = activeTrip ? projectCadence(activeTrip.departure_at, activeTrip.bus_type, 3) : [];

  const submitSighting = useCallback(async (payload: Omit<QueuedSighting, 'queuedAt' | 'requestId' | 'spotterId'>) => {
    const report: QueuedSighting = { ...payload, requestId: createRequestId(), queuedAt: new Date().toISOString() };
    try {
      await ensureSpotterSession();
      const response = await fetch('/api/sightings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(report) });
      const result = await response.json().catch(() => ({})) as { error?: string; verified?: boolean; message?: string; checkpoint?: string };
      if (!response.ok) { setMessage({ kind: 'error', text: result.error ?? 'This sighting could not be accepted.' }); return false; }
      setMessage({ kind: result.verified ? 'success' : 'warning', text: result.message ?? (result.verified ? `${result.checkpoint} verified.` : `${result.checkpoint} reported; awaiting confirmation.`) });
      await refreshBoard(); return true;
    } catch {
      try { await enqueueSighting(report); const count = await getQueuedSightingCount(); setQueuedCount(count);
        setMessage({ kind: 'info', text: 'No signal. Sighting saved on this phone and will sync when your connection returns.' }); return true;
      } catch { setMessage({ kind: 'error', text: 'No connection and local storage is unavailable. The sighting was not saved.' }); return false; }
    }
  }, [refreshBoard]);

  const findMyStop = () => {
    if (!navigator.geolocation) {
      setLocationError('Location is not available in this browser. Choose your stop from the list instead.');
      return;
    }
    setLocationBusy(true);
    setLocationError(null);
    setWaitStopId(null);
    navigator.geolocation.getCurrentPosition((position) => {
      setRiderLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      });
      setLocationBusy(false);
    }, (error) => {
      setLocationBusy(false);
      setLocationError(
        error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Allow location access or choose your stop manually.'
          : error.code === error.TIMEOUT
            ? 'Location lookup timed out. Try again outdoors or select your stop manually.'
            : 'Could not read your location. Choose your stop manually.',
      );
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
  };

  const recordDeparture = async () => {
    if (!navigator.geolocation) {
      setMessage({ kind: 'error', text: 'GPS is required to verify a Pueblo departure.' });
      return;
    }
    setBusy(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 5_000 });
      });
      await ensureSpotterSession();
      const response = await fetch('/api/departures', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: createRequestId(), routeId: selectedRoute.id, busType: departureType,  bodyNumber: departureBody.trim() || undefined, plateNumber: departurePlate.trim() || undefined, lat: position.coords.latitude, lng: position.coords.longitude }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; trip?: Trip };
      if (!response.ok) throw new Error(result.error ?? 'Could not log departure.');
      setDepartureOpen(false);
      setTab(selectedRoute.id === 'iloilo_passi' ? 'iloilo' : selectedRoute.id === 'tapaz' ? 'tapaz' : selectedRoute.id === 'estancia' ? 'estancia' : 'kalibo');
      if (selectedRoute.id === 'kalibo_sapian') setKaliboVia('sapian');
      if (selectedRoute.id === 'kalibo_mambusao') setKaliboVia('mambusao');
      setMessage({ kind: 'success', text: `${departureType === 'aircon' ? 'Aircon' : 'Ordinary'} departure logged from Pueblo de Panay.` });
      setDepartureBody(''); setDeparturePlate('');
      await refreshBoard();
    } catch (error) {
      const geoCode = typeof error === 'object' && error !== null && 'code' in error ? Number(error.code) : 0;
      const messageText = geoCode
        ? geoCode === 1 ? 'Allow location access to log a terminal departure.' : 'Could not get a GPS fix at Pueblo Terminal.'
        : error instanceof Error ? error.message : 'Departure could not be recorded.';
      setMessage({ kind: 'error', text: messageText });
    } finally { setBusy(false); }
  };

  const reportRoadside = () => {
    if (!activeTrip || activeTrip.status !== 'active') {
      setMessage({ kind: 'info', text: activeTrip?.status === 'arrived' ? 'This trip has already reached its terminal.' : 'There is no active trip on this corridor yet. Log a departure first.' });
      return;
    }
    if (!navigator.geolocation) {
      setMessage({ kind: 'error', text: 'GPS is not available in this browser.' });
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      const nearest = nearestCheckpoint(position.coords, activeRoute.checkpoints);
      if (!nearest) {
        setBusy(false);
        setMessage({ kind: 'error', text: 'No checkpoint coordinates are available for this corridor.' });
        return;
      }
      if (nearest.distanceMeters > 300) {
        setBusy(false);
        setMessage({ kind: 'error', text: `Nearest stop is ${nearest.checkpoint.name}, ${formatDistance(nearest.distanceMeters)} away. Move within 300 m of a mapped checkpoint to report.` });
        return;
      }
      const sent = await submitSighting({
        tripId: activeTrip.id, checkpointId: nearest.checkpoint.id,
        lat: position.coords.latitude, lng: position.coords.longitude,
        kind: 'roadside', 
      });
      if (sent) setWaitStopId(nearest.checkpoint.id);
      setBusy(false);
    }, (error) => {
      setBusy(false);
      setMessage({ kind: 'error', text: error.code === error.PERMISSION_DENIED ? 'Allow location access to report a bus sighting.' : 'Could not get a GPS fix. Try again outdoors.' });
    }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 8_000 });
  };

  const lookupBus = async () => {
    if (!tagBody.trim()) {
      setMessage({ kind: 'info', text: 'Enter a Ceres body number to look up.' });
      return;
    }
    try {
      const response = await fetch(`/api/buses?bodyNumber=${encodeURIComponent(tagBody.trim())}`, { cache: 'no-store' });
      const result = await response.json() as { bus?: { plate_number?: string | null; bus_type?: BusType | null }; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'No registry match.');
      setTagPlate(result.bus?.plate_number ?? '');
      setMessage({ kind: 'success', text: `Registry match found for body ${tagBody.trim()}.` });
    } catch (error) {
      setMessage({ kind: 'info', text: error instanceof Error ? error.message : 'No registry match found.' });
    }
  };

  const saveBusTag = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeTrip) return;
    setBusy(true);
    try {
      await ensureSpotterSession();
      const response = await fetch(`/api/trips/${activeTrip.id}/tag`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bodyNumber: tagBody, plateNumber: tagPlate,  }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Unable to tag bus.');
      setTagBody(''); setTagPlate('');
      setMessage({ kind: 'success', text: 'Bus registry tag attached to this trip.' });
      await refreshBoard();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to tag bus.' });
    } finally { setBusy(false); }
  };

  const updateRiderStatus = async (status: string) => {
    if (!activeTrip) return;
    try {
      await ensureSpotterSession();
      const response = await fetch(`/api/trips/${activeTrip.id}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status,  }),
      });
      if (!response.ok) throw new Error('Status update failed.');
      setMessage({ kind: 'success', text: `Rider update sent: ${status.replaceAll('_', ' ')}.` });
      await refreshBoard();
    } catch {
      setMessage({ kind: 'error', text: 'Rider status could not be sent. Check your signal.' });
    }
  };

  useEffect(() => {
    if (!riderMode || !activeTrip || activeTrip.status !== 'active') {
      if (riderMode && activeTrip?.status === 'arrived') setRiderMode(false);
      return;
    }
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | undefined;
    const acquireWakeLock = async () => {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
      try {
        if (nav.wakeLock) {
          wakeLockRef.current = await nav.wakeLock.request('screen');
          if (mounted) setWakeLockActive(true);
        }
      } catch { if (mounted) setWakeLockActive(false); }
    };
    const ping = () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(async (position) => {
        if (!mounted) return;
        const nearest = nearestCheckpoint(position.coords, activeRoute.checkpoints);
        if (!nearest || nearest.distanceMeters > 300) return;
        if (nearest.checkpoint.id === activeTrip.last_checkpoint_id || nearest.checkpoint.id === lastBeaconCheckpointRef.current) return;
        const sent = await submitSighting({
          tripId: activeTrip.id, checkpointId: nearest.checkpoint.id,
          lat: position.coords.latitude, lng: position.coords.longitude,
          kind: 'rider_beacon', 
        });
        if (sent && mounted) {
          lastBeaconCheckpointRef.current = nearest.checkpoint.id;
          setLastBeaconAt(new Date().toISOString());
        }
      }, () => undefined, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 15_000 });
    };
    void acquireWakeLock();
    ping();
    interval = setInterval(ping, 30_000);
    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
      if (wakeLockRef.current) {
        void wakeLockRef.current.release().catch(() => undefined);
        wakeLockRef.current = null;
      }
      setWakeLockActive(false);
    };
  }, [riderMode, activeTrip?.id, activeTrip?.status, activeTrip?.last_checkpoint_id, activeRoute, submitSighting]);

  const startRiderMode = async () => {
    if (!activeTrip || activeTrip.status !== 'active') {
      setMessage({ kind: 'info', text: activeTrip?.status === 'arrived' ? 'This trip has already reached its terminal.' : 'Log the bus departure first, then turn on Rider Beacon mode.' });
      if (!activeTrip) setDepartureOpen(true);
      return;
    }
    if (!navigator.geolocation) {
      setMessage({ kind: 'error', text: 'GPS is not available on this device.' });
      return;
    }
    setBusy(true);
    try {
      await ensureSpotterSession();
      const response = await fetch(`/api/trips/${activeTrip.id}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({  }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not join Rider Beacon mode.');
      setRiderMode(true);
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not join Rider Beacon mode.' });
    } finally { setBusy(false); }
  };

  const selectedTab = (value: CorridorTab) => {
    setTab(value);
    setWaitStopId(null);
    setMessage(null);
  };

  const waitingGuidance = waitItem?.state === 'passed'
    ? 'This trip has already passed your selected stop.'
    : waitItem?.minutesAway !== null && waitItem?.minutesAway !== undefined && waitItem.minutesAway <= 12
      ? 'Walk to the highway now.'
      : waitItem?.minutesAway !== null && waitItem?.minutesAway !== undefined && waitItem.minutesAway >= 20
        ? 'Safe to wait at home for now.'
        : 'Get ready and keep your phone nearby.';

  return (
    <main className="app-shell">
      <a className="skip-link" href="#main-content">Skip to tracker</a>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brandline">
            <div className="brand"><span className="brand-mark">🚌</span><span>ByahePanay</span></div>
            <div className="header-tools">
              <div className="eyebrow">Community trip tracker</div>
              <button
                className="theme-toggle"
                type="button"
                onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                aria-pressed={theme === 'dark'}
                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
                <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
              </button>
            </div>
          </div>
          <h1 className="header-title">Catch the last trip.<br />Not the guesswork.</h1>
          <p className="header-subtitle">Crowd-verified Ceres Liner sightings across Capiz, Iloilo, and Aklan.</p>
          <div className="header-meta">
            <div className="origin-pill">📍 Pueblo de Panay Terminal · Roxas City</div>
            <div className={`connection-pill ${isOnline ? 'connected' : 'disconnected'}`} role="status" aria-live="polite">
              <span className="connection-dot" aria-hidden="true" />
              {isOnline ? 'Connection available' : 'Offline · reports saved on this device'}
            </div>
          </div>
        </div>
      </header>

      <div className="page-content" id="main-content">
        <section className="corridor-wrap" aria-label="Choose travel corridor">
          <div className="corridor-tabs">
            <button className={`corridor-tab ${tab === 'iloilo' ? 'active' : ''}`} onClick={() => selectedTab('iloilo')}>Iloilo<br />(Passi)</button>
            <button className={`corridor-tab ${tab === 'kalibo' ? 'active' : ''}`} onClick={() => selectedTab('kalibo')}>Kalibo</button>
            <button className={`corridor-tab ${tab === 'tapaz' ? 'active' : ''}`} onClick={() => selectedTab('tapaz')}>Tapaz</button>
            <button className={`corridor-tab ${tab === 'estancia' ? 'active' : ''}`} onClick={() => selectedTab('estancia')}>Estancia</button>
          </div>
          {tab === 'kalibo' && <div className="variant-switch" aria-label="Kalibo corridor branch">
            <button className={`variant-button ${kaliboVia === 'mambusao' ? 'active' : ''}`} onClick={() => { setKaliboVia('mambusao'); setWaitStopId(null); }}>Via Mambusao</button>
            <button className={`variant-button ${kaliboVia === 'sapian' ? 'active' : ''}`} onClick={() => { setKaliboVia('sapian'); setWaitStopId(null); }}>Via Sapian</button>
          </div>}
        </section>

        <nav className="section-jump-nav" aria-label="Tracker sections">
          <a href="#arrivals">Arrivals</a>
          <a href="#active-trip">Current trip</a>
          <a href="#checkpoint-timeline">Checkpoints</a>
        </nav>

        <section className="card arrival-card" id="arrivals" aria-label="Next buses near your stop">
          <div className="arrival-card-head">
            <div>
              <div className="arrival-kicker">RIDER PRIORITY</div>
              <h2>Next bus near you</h2>
              <p>We rank active buses by their estimated arrival at your stop.</p>
            </div>
            <button className="secondary-button location-button" type="button" onClick={findMyStop} disabled={locationBusy}>
              {locationBusy ? 'Locating…' : riderLocation ? 'Refresh location' : 'Use my location'}
            </button>
          </div>
          <div className="arrival-stop-field">
            <label htmlFor="arrival-stop">Your waiting stop</label>
            <select
              id="arrival-stop"
              value={selectedBoardRoute.checkpoints.some((point) => point.id === targetStop?.id) ? targetStop?.id ?? '' : ''}
              onChange={(event) => setWaitStopId(event.target.value || null)}
            >
              <option value="">Choose a stop on {selectedBoardRoute.short_name}</option>
              {selectedBoardRoute.checkpoints.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
            </select>
          </div>
          <div className="arrival-location-meta">
            {riderLocation && nearestUserStop
              ? <>Nearest mapped stop: <strong>{nearestUserStop.checkpoint.name}</strong> · approx. {formatDistance(nearestUserStop.distanceMeters)} away · GPS accuracy ±{formatDistance(riderLocation.accuracy)}</>
              : 'Use your location or select a stop manually. Your location stays on this device.'}
          </div>
          {locationError && <div className="notice error">{locationError}</div>}
          {targetStop ? <div className="arrival-results">
            <div className="arrival-results-title">Buses approaching {targetStop.name}</div>
            {rankedArrivals.length ? <div className="arrival-list">
              {rankedArrivals.slice(0, 4).map((arrival, index) => (
                <div className="arrival-row" key={arrival.trip.id}>
                  <div className="arrival-number">{index === 0 ? 'NEXT' : index + 1}</div>
                  <div className="arrival-description">
                    <strong>{arrival.route.short_name}</strong>
                    <span>{arrival.trip.bus_type === 'aircon' ? 'Aircon · Deluxe' : 'Regular · Ordinary'} · {arrival.trip.body_number ? 'Bus ' + arrival.trip.body_number : 'Bus not tagged'}</span>
                    <span>{arrival.trip.confidence_status === 'verified' ? 'Community verified' : 'Awaiting stronger confirmation'}</span>
                  </div>
                  <div className="arrival-eta">
                    <strong>{arrival.minutesAway <= 1 ? 'Arriving' : arrival.minutesAway + ' min'}</strong>
                    <span>{formatTime(arrival.eta)}</span>
                  </div>
                </div>
              ))}
            </div> : <div className="empty-trip arrival-empty">
              <strong>No active bus is currently estimated to reach this stop.</strong>
              <p>Try another stop or check again after a departure or community sighting is reported.</p>
            </div>}
          </div> : <div className="empty-trip arrival-empty">
            <strong>Find the bus that reaches you first.</strong>
            <p>Share your location or choose your waiting stop to compare all active buses on this corridor.</p>
          </div>}
        </section>

        {!loading && !board.configured && <div className="notice info">Demo shell: connect Neon and apply <code>neon/schema.sql</code> to enable live trips and crowd reports.</div>}
        <ErrorNotice message={message} />
        {queuedCount > 0 && <div className="notice info">📶 {queuedCount} sighting{queuedCount === 1 ? '' : 's'} saved offline · will retry when signal returns.</div>}

        <div className="section-label">{targetStop ? rankedArrivals.length ? 'Next bus to ' + targetStop.name : 'No bus currently approaching ' + targetStop.name : activeTrip?.status === 'arrived' ? 'Latest arrival' : 'Active trip'} · {activeRoute.short_name}</div>
        <section className="card trip-card" id="active-trip" aria-live="polite">
          {activeTrip ? <>
            <div className="trip-card-top">
              <div>
                <div className="trip-type"><span className="bus-symbol">🚌</span>{activeTrip.bus_type === 'aircon' ? 'Aircon · Deluxe' : 'Regular · Ordinary'}</div>
                <div className="trip-route">{activeRoute.name}</div>
              </div>
              <ConfidenceBadge value={activeTrip.confidence_status} />
            </div>
            <div className="trip-stats">
              <div><div className="stat-label">Bus / Plate</div><div className="stat-value">{activeTrip.body_number || 'Not tagged'}{activeTrip.plate_number ? ` · ${activeTrip.plate_number}` : ''}</div></div>
              <div><div className="stat-label">Left Pueblo</div><div className="stat-value">{formatTime(activeTrip.departure_at)}</div></div>
              <div><div className="stat-label">Last confirmed</div><div className="stat-value">{activeRoute.checkpoints.find((point) => point.id === activeTrip.last_checkpoint_id)?.name ?? 'Pueblo Terminal'}</div></div>
              <div><div className="stat-label">Checkpoint time</div><div className="stat-value">{formatTime(activeTrip.last_checkpoint_at)}</div></div>
            </div>
            <div className="destination-window">
              <div><span>{activeTrip.status === 'arrived' ? `Arrived · ${activeRoute.destination}` : `Safe arrival window · ${activeRoute.destination}`}</span><strong>{activeTrip.status === 'arrived' ? formatTime(activeTrip.last_checkpoint_at) : arrivalWindowLabel(timeline?.arrivalWindow ?? null)}</strong></div>
              <div aria-hidden="true" style={{ fontSize: 23 }}>🏁</div>
            </div>
            {timeline && timeline.delayMinutes >= 1 && timeline.nextCheckpoint && <div className="notice">⚠️ Delayed +{timeline.delayMinutes} mins — awaiting {timeline.nextCheckpoint.name} checkpoint confirmation.</div>}
            {activeTrip.route_candidate && !activeTrip.route_locked && <div className="notice info">Route is provisional after Mambusao. Waiting for Jamindan/Tapaz or Kalibo-side confirmation.</div>}
            {activeTrip.status === 'active' && <details className="details-box">
              <summary>🪪 Bus Registry Lookup / Tag</summary>
              <form className="form-grid" onSubmit={saveBusTag}>
                <div className="field"><label htmlFor="tag-body">Ceres body number</label><input id="tag-body" value={tagBody} onChange={(event) => setTagBody(event.target.value)} placeholder="e.g. 5412" maxLength={20} required /></div>
                <div className="field"><label htmlFor="tag-plate">Plate number</label><input id="tag-plate" value={tagPlate} onChange={(event) => setTagPlate(event.target.value)} placeholder="Optional" maxLength={16} /></div>
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="secondary-button" type="button" onClick={lookupBus} disabled={busy}>Lookup body number</button><button className="primary-button" type="submit" disabled={busy}>Attach bus tag</button></div>
              </form>
            </details>}
          </> : <div className="empty-trip">
            <strong>{loading ? 'Checking the live board…' : 'No active trip confirmed on this corridor'}</strong>
            <p>Log a departure when a bus actually leaves Pueblo, or check back for a community-verified sighting.</p>
          </div>}
        </section>

        <div className="section-label">Checkpoint timeline</div>
        <section className="card timeline-card" id="checkpoint-timeline">
          {(timeline?.items ?? activeRoute.checkpoints.map((checkpoint) => ({ checkpoint, state: 'upcoming' as const, eta: null, minutesAway: null }))).map((item) => {
            const stateText = item.state === 'passed' ? 'Passed' : item.state === 'pending' ? '1 report · awaiting confirmation' : item.state === 'approaching' ? 'Approaching' : 'Upcoming';
            const dotText = item.state === 'passed' ? '✓' : item.state === 'pending' ? '!' : item.state === 'approaching' ? '🚌' : '·';
            return <div className="timeline-row" key={item.checkpoint.id}>
              <div className="timeline-track"><span className={`timeline-dot ${item.state}`}>{dotText}</span></div>
              <button className={`wait-button ${waitStopId === item.checkpoint.id ? 'selected' : ''}`} onClick={() => setWaitStopId(item.checkpoint.id)}>
                <div className={`checkpoint-name ${item.state === 'upcoming' ? 'dim' : ''}`}>{item.checkpoint.name}</div>
                <div className="checkpoint-status">{stateText}</div>
              </button>
              <div className="checkpoint-eta">
                <strong>{item.state === 'passed' ? '✓' : item.state === 'pending' ? 'Pending' : item.eta ? formatTime(item.eta) : '—'}</strong>
                <span>{item.state === 'passed' ? 'Confirmed' : item.minutesAway !== null ? `${item.minutesAway} min` : item.state === 'pending' ? 'Unverified' : 'ETA pending'}</span>
              </div>
            </div>;
          })}
        </section>
        {waitStopId && <section className="card wait-card" style={{ marginTop: 10 }}>
          <div className="wait-card-top"><h3>📍 My Waiting Stop</h3><button className="secondary-button" type="button" onClick={() => setWaitStopId(null)}>Clear</button></div>
          <div className="wait-eta">{waitItem?.eta ? formatTime(waitItem.eta) : waitItem?.state === 'passed' ? 'Already passed' : 'ETA pending'}</div>
          <div className="wait-guidance">{activeRoute.checkpoints.find((point) => point.id === waitStopId)?.name} · {waitingGuidance}</div>
        </section>}

        <div className="section-label">Next 30-minute dispatch slots</div>
        {activeTrip ? <div className="cadence-list">
          {cadence.map((slot) => <div className="cadence-item" key={slot.departureAt.toISOString()}>
            <div className="cadence-time">{formatTime(slot.departureAt)}</div>
            <div className="cadence-type">{slot.busType === 'aircon' ? 'Aircon · Deluxe' : 'Regular · Ordinary'}</div>
            <div className="cadence-state">⚪ Scheduled · Unconfirmed</div>
          </div>)}
        </div> : <div className="card empty-trip"><p>Projected slots appear after an actual departure is logged as the cadence anchor. These are projections, not confirmed operator dispatches.</p></div>}

        <p className="footer-note">ETAs are estimates from community sightings and the planning offsets in this prototype. They are not official Ceres Liner schedules. Coordinates must be field-checked before public operational use.</p>
      </div>

      <nav className="bottom-bar" aria-label="Quick reporting actions">
        <div className="bottom-actions">
          <button className="action-button" onClick={() => setDepartureOpen(true)} disabled={busy} aria-label="Log a bus departure from Pueblo">
            <span className="action-icon" aria-hidden="true">🏁</span>
            <span className="action-label">Departure</span>
            <span className="action-copy">Left Pueblo</span>
          </button>
          <button className="action-button main" onClick={reportRoadside} disabled={busy} aria-label="Report a bus that just passed this checkpoint">
            <span className="action-icon" aria-hidden="true">👀</span>
            <span className="action-label">Bus sighting</span>
            <span className="action-copy">Passed here</span>
          </button>
          <button className="action-button beacon" onClick={startRiderMode} disabled={busy} aria-label="Start Rider Beacon mode">
            <span className="action-icon" aria-hidden="true">🚌</span>
            <span className="action-label">Rider Beacon</span>
            <span className="action-copy">I’m on this bus</span>
          </button>
        </div>
      </nav>

      {departureOpen && <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setDepartureOpen(false); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="departure-title">
          <h2 id="departure-title">Log a Pueblo departure</h2>
          <p>Only log a departure after the bus actually leaves the terminal. This becomes the 30-minute cadence anchor for projected slots.</p>
          <div className="field" style={{ marginBottom: 10 }}><label htmlFor="departure-route">Corridor</label><select id="departure-route" value={selectedRoute.id} onChange={(event) => {
            const route = ROUTES.find((candidate) => candidate.id === event.target.value);
            if (!route) return;
            if (route.id === 'iloilo_passi') setTab('iloilo');
            else if (route.id === 'tapaz') setTab('tapaz');
            else if (route.id === 'estancia') setTab('estancia');
            else { setTab('kalibo'); setKaliboVia(route.id === 'kalibo_sapian' ? 'sapian' : 'mambusao'); }
          }}>
            <option value="iloilo_passi">Iloilo via Passi</option><option value="kalibo_mambusao">Kalibo via Mambusao</option><option value="kalibo_sapian">Kalibo via Sapian</option><option value="tapaz">Tapaz / Calinog</option><option value="estancia">Estancia</option>
          </select></div>
          <div className="field" style={{ marginBottom: 10 }}><label htmlFor="departure-type">Bus type</label><select id="departure-type" value={departureType} onChange={(event) => setDepartureType(event.target.value as BusType)}><option value="aircon">Aircon · Deluxe</option><option value="ordinary">Regular · Ordinary</option></select></div>
          <div className="form-grid">
            <div className="field"><label htmlFor="departure-body">Body number · optional</label><input id="departure-body" value={departureBody} onChange={(event) => setDepartureBody(event.target.value)} placeholder="e.g. 5412" maxLength={20} /></div>
            <div className="field"><label htmlFor="departure-plate">Plate · optional</label><input id="departure-plate" value={departurePlate} onChange={(event) => setDeparturePlate(event.target.value)} placeholder="Plate number" maxLength={16} /></div>
          </div>
          <div className="modal-actions"><button className="secondary-button" onClick={() => setDepartureOpen(false)} type="button">Cancel</button><button className="primary-button" onClick={recordDeparture} disabled={busy}>{busy ? 'Saving…' : 'Confirm actual departure'}</button></div>
        </section>
      </div>}

      {riderMode && activeTrip && <section className="beacon-screen" aria-label="Rider Beacon mode">
        <div>
          <div className="eyebrow">ByahePanay · Rider Beacon</div>
          <h2>{activeRoute.destination} trip beacon active</h2>
          <div className="beacon-orb">🚌</div>
          <div className="beacon-meta">GPS checks every 30 seconds<br />{wakeLockActive ? 'Screen wake lock active' : 'Screen may dim on this device'}<br />Last checkpoint: {activeRoute.checkpoints.find((point) => point.id === activeTrip.last_checkpoint_id)?.name ?? 'Pueblo Terminal'}<br />Last beacon: {lastBeaconAt ? formatTime(lastBeaconAt) : 'Waiting for GPS fix'}</div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>One-tap rider updates</div>
          <div className="beacon-status-grid">
            <button onClick={() => void updateRiderStatus('seats_available')}>🪑 Seats Available</button>
            <button onClick={() => void updateRiderStatus('standing_only')}>🧍 Standing Only</button>
            <button onClick={() => void updateRiderStatus('stopped_cargo_traffic_10m')}>⏸ Stopped · Cargo / Traffic +10m</button>
            <button onClick={() => void updateRiderStatus('mechanical_breakdown')}>🔧 Mechanical Breakdown</button>
          </div>
          {message && <div className="notice info">{message.text}</div>}
          <button className="beacon-stop" style={{ width: '100%', marginTop: 14 }} onClick={() => { setRiderMode(false); void updateRiderStatus('moving'); }}>Stop Rider Beacon</button>
        </div>
      </section>}
    </main>
  );
}
