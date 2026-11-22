'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type CommunityCounts = {
  active_visitors_now: number;
  active_contributors_now: number;
  contributors_reporting_15m: number;
};

const REFRESH_INTERVAL_MS = 60_000;

export default function CommunityPresence() {
  const [counts, setCounts] = useState<CommunityCounts | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const requestInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRefreshing(true);

    try {
      const response = await fetch('/api/public/presence', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const result = await response.json().catch(() => ({})) as Partial<CommunityCounts> & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Community activity is temporarily unavailable.');

      const nextCounts = {
        active_visitors_now: Number(result.active_visitors_now),
        active_contributors_now: Number(result.active_contributors_now),
        contributors_reporting_15m: Number(result.contributors_reporting_15m),
      };
      if (Object.values(nextCounts).some((value) => !Number.isSafeInteger(value) || value < 0)) {
        throw new Error('The community activity response was incomplete.');
      }

      setCounts(nextCounts);
      setUpdatedAt(new Date());
      setHasError(false);
    } catch {
      setHasError(true);
    } finally {
      requestInFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const updateConnection = () => setBrowserOnline(navigator.onLine);
    updateConnection();
    const initialRefresh = window.setTimeout(() => void refresh(), 0);

    const poll = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(poll, REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('focus', poll);
    const handleManualRefresh = () => void refresh();
    window.addEventListener('byahepanay:refresh', handleManualRefresh);
    const handleOnline = () => {
      updateConnection();
      void refresh();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', updateConnection);

    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
      document.removeEventListener('focus', poll);
      window.removeEventListener('byahepanay:refresh', handleManualRefresh);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', updateConnection);
    };
  }, [refresh]);

  const formatCount = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString();
  const updatedLabel = updatedAt
    ? 'Updated ' + updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'Waiting for live counts';

  return (
    <section className="card community-presence" aria-labelledby="community-presence-title" aria-busy={refreshing}>
      <div className="community-presence-heading">
        <div>
          <div className="arrival-kicker">COMMUNITY ACTIVITY</div>
          <h2 id="community-presence-title">Who’s online now</h2>
          <p>Live community counts, refreshed automatically.</p>
        </div>
        <span className={counts && !hasError ? 'presence-live-pill' : 'presence-live-pill pending'}>
          <span aria-hidden="true" />{hasError ? (counts ? 'STALE' : 'UNAVAILABLE') : counts ? 'LIVE' : 'UPDATING'}
        </span>
      </div>

      <div className="community-presence-grid" aria-live="polite">
        <div className="presence-stat">
          <strong>{formatCount(counts?.active_visitors_now)}</strong>
          <span>Active visitors</span>
          <small>Browser sessions active in the last 5 minutes</small>
        </div>
        <div className="presence-stat">
          <strong>{formatCount(counts?.active_contributors_now)}</strong>
          <span>Contributors online</span>
          <small>Verified contributors active in the last 5 minutes</small>
        </div>
        <div className="presence-stat">
          <strong>{formatCount(counts?.contributors_reporting_15m)}</strong>
          <span>Recently reporting</span>
          <small>Verified contributors who reported in the last 15 minutes</small>
        </div>
      </div>

      <div className="community-presence-footer">
        <span>{updatedLabel} · Counts only; no names or personal details are shown.</span>
        <button className="presence-refresh-button" type="button" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {hasError && (
        <div className="community-presence-error" role="alert">
          <div>
            <strong>Community activity couldn’t be loaded.</strong>
            <p>{counts
              ? 'These are the last available counts. '
              : 'Live counts are not available right now. '}
              {browserOnline
                ? 'The tracker remains usable. Please try again.'
                : 'Your device appears to be offline. Reconnect to refresh the counts.'}</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      )}
    </section>
  );
}
