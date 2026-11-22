'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CONFIRMATION_OVERDUE_GRACE_MINUTES, TRACKING_LOST_AFTER_MINUTES } from '@/lib/eta';

type ActiveTrip = {
  id: string;
  route_id: string;
  short_name: string;
  bus_type: 'ordinary' | 'aircon';
  departure_at: string;
  last_checkpoint_at: string;
  last_checkpoint_name: string | null;
  rider_status: string | null;
  rider_status_at: string | null;
  body_number: string | null;
};

type Metrics = {
  summary?: {
    reports: number;
    verified_reports: number;
    otp_verified_reports: number;
    median_gps_accuracy_m: number | null;
    calibration_samples: number;
    calibrated_segments: number;
  };
  daily: Array<{
    metric_date: string;
    report_count: number;
    verified_report_count: number;
    otp_verified_report_count: number;
    median_gps_accuracy_m: number | null;
    calibration_sample_count: number;
  }>;
  calibrations: Array<{
    route_id: string;
    short_name: string;
    from_checkpoint: string;
    to_checkpoint: string;
    bus_type: string;
    sample_count: number;
    median_minutes: number;
    p80_minutes: number;
    baseline_minutes: number;
  }>;
  alerts: Array<{ alert_key: string; severity: string; message: string }>;
  latestHealth?: {
    status: string;
    database_latency_ms: number;
    active_trip_count: number;
    stale_active_trip_count: number;
  } | null;
  activeTrips: ActiveTrip[];
  presence?: { active_users_now: number; active_contributors_now: number; contributors_reporting_15m: number };
  checkpointReviews?: Array<{ code: string; name: string; lat: number; lng: number; source: string; validation_status: string; note: string; submitted_at: string; reviewed_at: string | null }>;
};

function minutesSince(value: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
}

function timeAgo(value: string) {
  const minutes = minutesSince(value);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m ago` : `${hours}h ago`;
}

function freshnessLabel(minutes: number) {
  if (minutes >= TRACKING_LOST_AFTER_MINUTES) return { label: 'Tracking lost', tone: 'critical' };
  if (minutes >= CONFIRMATION_OVERDUE_GRACE_MINUTES) return { label: 'Confirmation overdue', tone: 'warning' };
  return { label: 'Recently confirmed', tone: 'healthy' };
}

export default function OpsDashboard() {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyTripId, setBusyTripId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const response = await fetch('/api/ops/metrics?days=30', { cache: 'no-store', credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Metrics unavailable');
      setData(result as Metrics);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error
        ? loadError.message
        : 'Could not load operational metrics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadData(), 0);
    const refresh = window.setInterval(() => void loadData(), 30_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(refresh);
    };
  }, [loadData]);

  const markInactive = async (trip: ActiveTrip) => {
    const reason = (reasons[trip.id] ?? '').trim();
    if (reason.length < 10) {
      setError('Enter an administrative reason of at least 10 characters.');
      return;
    }
    if (!window.confirm(
      `Mark the ${trip.short_name} trip as inactive? It will disappear from the public active board, but its trip and report history will be retained. This does not mark it as arrived.`,
    )) return;

    setBusyTripId(trip.id);
    setError('');
    try {
      const response = await fetch(`/api/ops/trips/${encodeURIComponent(trip.id)}/inactive`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not mark this trip inactive.');
      setReasons((current) => ({ ...current, [trip.id]: '' }));
      await loadData();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not mark this trip inactive.');
    } finally {
      setBusyTripId(null);
    }
  };

  const summary = data?.summary;
  const verifiedRate = summary?.reports
    ? Math.round(summary.verified_reports / summary.reports * 100)
    : 0;

  return (
    <main className="ops-shell">
      <header className="ops-header">
        <div className="arrival-kicker">BIYAHEPANAY · ADMINISTRATION</div>
        <h1>Operations &amp; analytics</h1>
        <p>Review checkpoint freshness, close tracking that has stopped, and monitor aggregate report quality. Every administrative status change is audited.</p>
        <Link href="/">← Back to passenger tracker</Link>
      </header>

      {loading && <section className="card ops-panel">Loading operational data…</section>}
      {error && <section className="notice error ops-error" role="alert">{error}</section>}

      {data && <>
        <section className="card ops-panel" id="trip-review">
          <div className="ops-panel-head">
            <div>
              <h2>Active trip review</h2>
              <p>Freshness is based on the last confirmed checkpoint, not Rider Beacon status pings.</p>
            </div>
            <span className="ops-state">{data.activeTrips.length} active</span>
          </div>

          {data.activeTrips.length === 0
            ? <p className="ops-footnote">There are no active trips to review.</p>
            : <div className="ops-trip-review-list">
              {data.activeTrips.map((trip) => {
                const minutes = minutesSince(trip.last_checkpoint_at || trip.departure_at);
                const freshness = freshnessLabel(minutes);
                const canDeactivate = minutes >= TRACKING_LOST_AFTER_MINUTES;
                return (
                  <article className="ops-trip-review" key={trip.id}>
                    <div className="ops-trip-review-top">
                      <div>
                        <strong>{trip.short_name}</strong>
                        <span>{trip.bus_type === 'aircon' ? 'Aircon' : 'Ordinary'}{trip.body_number ? ` · Bus ${trip.body_number}` : ''}</span>
                      </div>
                      <span className={`ops-state ${freshness.tone}`}>{freshness.label}</span>
                    </div>
                    <dl className="ops-trip-review-meta">
                      <div><dt>Last checkpoint</dt><dd>{trip.last_checkpoint_name ?? 'Pueblo Terminal'}</dd></div>
                      <div><dt>Last confirmed</dt><dd>{timeAgo(trip.last_checkpoint_at || trip.departure_at)}</dd></div>
                      <div><dt>Departed</dt><dd>{new Date(trip.departure_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
                      <div><dt>Rider status</dt><dd>{trip.rider_status ?? 'Not reported'}{trip.rider_status_at ? ` · ${timeAgo(trip.rider_status_at)}` : ''}</dd></div>
                    </dl>

                    {canDeactivate
                      ? <div className="ops-inactive-action">
                        <label htmlFor={`inactive-reason-${trip.id}`}>Reason for ending tracking</label>
                        <textarea
                          id={`inactive-reason-${trip.id}`}
                          value={reasons[trip.id] ?? ''}
                          onChange={(event) => setReasons((current) => ({ ...current, [trip.id]: event.target.value }))}
                          minLength={10}
                          maxLength={500}
                          rows={2}
                          placeholder="Example: No verified checkpoint update for over 90 minutes; administrator reviewed and ended tracking."
                        />
                        <button
                          className="secondary-button ops-inactive-button"
                          type="button"
                          disabled={busyTripId === trip.id || (reasons[trip.id] ?? '').trim().length < 10}
                          onClick={() => void markInactive(trip)}
                        >
                          {busyTripId === trip.id ? 'Updating…' : 'Mark inactive'}
                        </button>
                      </div>
                      : <p className="ops-footnote">The inactive action becomes available after 90 minutes without a confirmed checkpoint.</p>}
                  </article>
                );
              })}
            </div>}
        </section>

        <section className="card ops-panel" id="live-presence">
          <div className="ops-panel-head">
            <div><h2>Live audience and contributors</h2><p>Refreshed every 30 seconds · visible browser sessions heartbeat every minute.</p></div>
            <span className="ops-state healthy">Live presence</span>
          </div>
          <div className="ops-kpis">
            <Kpi label="Active users · 5 min" value={data.presence?.active_users_now ?? 0} />
            <Kpi label="Active verified contributors · 5 min" value={data.presence?.active_contributors_now ?? 0} />
            <Kpi label="Contributors reporting · 15 min" value={data.presence?.contributors_reporting_15m ?? 0} />
          </div>
          <p className="ops-footnote">Active users are signed browser sessions seen within five minutes, not unique people. Contributors are deduplicated by verified reporter identity. No GPS, IP address or email address is collected for these counts.</p>
        </section>

        <section className="ops-kpis">
          <Kpi label="Reports · 30 days" value={summary?.reports ?? 0} />
          <Kpi label="Verified report rate" value={`${verifiedRate}%`} />
          <Kpi label="OTP-verified reports" value={summary?.otp_verified_reports ?? 0} />
          <Kpi label="Calibrated segments" value={summary?.calibrated_segments ?? 0} />
        </section>

        <section className="card ops-panel">
          <div className="ops-panel-head">
            <div><h2>Operational health</h2><p>Latest daily snapshot</p></div>
            <span className={`ops-state ${data.latestHealth?.status ?? 'unknown'}`}>{data.latestHealth?.status ?? 'Awaiting snapshot'}</span>
          </div>
          <div className="ops-health-grid">
            <Kpi label="Database latency" value={data.latestHealth ? `${data.latestHealth.database_latency_ms} ms` : '—'} />
            <Kpi label="Active trips" value={data.latestHealth?.active_trip_count ?? '—'} />
            <Kpi label="Stale trips" value={data.latestHealth?.stale_active_trip_count ?? '—'} />
            <Kpi label="Median GPS accuracy" value={summary?.median_gps_accuracy_m !== null && summary?.median_gps_accuracy_m !== undefined
              ? `${Number(summary.median_gps_accuracy_m).toFixed(0)} m` : '—'} />
          </div>
          <p className="ops-footnote">Live health probe: <a href="/api/health">/api/health</a></p>
        </section>

        <section className="card ops-panel" id="checkpoint-review">
          <div className="ops-panel-head">
            <div><h2>Checkpoint coordinate review</h2><p>Open each pin in Google Maps during field checks. A map pin is not field-verified until its roadside waiting point is confirmed.</p></div>
            <span className="ops-state warning">Field review pending</span>
          </div>
          {(data.checkpointReviews ?? []).length === 0
            ? <p>No coordinate review records are available.</p>
            : <div className="ops-table-wrap"><table className="ops-table">
              <thead><tr><th>Checkpoint</th><th>Coordinates</th><th>Review status</th><th>Map</th></tr></thead>
              <tbody>{data.checkpointReviews?.map((item) => (
                <tr key={item.code}>
                  <td><strong>{item.name}</strong><small>{item.code}</small></td>
                  <td>{Number(item.lat).toFixed(6)}, {Number(item.lng).toFixed(6)}</td>
                  <td><span className="ops-state warning">{item.validation_status.replace(/_/g, ' ')}</span><small>{item.source.replace(/_/g, ' ')}</small></td>
                  <td><a href={"https://www.google.com/maps/search/?api=1&query=" + item.lat + "," + item.lng} target="_blank" rel="noreferrer">Open Google Maps ↗</a></td>
                </tr>
              ))}</tbody>
            </table></div>}
          <p className="ops-footnote">Review the correct highway side, passenger waiting point and nearby barangay boundary. Confirm with a fresh roadside GPS fix before changing a status to field-verified.</p>
        </section>

        <section className="card ops-panel">
          <h2>Historical report quality</h2>
          <p>Daily totals and verified-email coverage.</p>
          {data.daily.length === 0
            ? <p>No snapshots yet. The first scheduled snapshot will populate this history.</p>
            : <div className="ops-table-wrap"><table className="ops-table">
              <thead><tr><th>Date</th><th>Reports</th><th>Verified</th><th>OTP reports</th><th>Median GPS</th><th>New samples</th></tr></thead>
              <tbody>{data.daily.map((day) => <tr key={day.metric_date}>
                <td>{new Date(day.metric_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</td>
                <td>{day.report_count}</td>
                <td>{day.verified_report_count}</td>
                <td>{day.otp_verified_report_count}</td>
                <td>{day.median_gps_accuracy_m === null ? '—' : `${Math.round(Number(day.median_gps_accuracy_m))} m`}</td>
                <td>{day.calibration_sample_count}</td>
              </tr>)}</tbody>
            </table></div>}
        </section>

        <section className="card ops-panel">
          <h2>Automatic ETA calibration</h2>
          <p>Segment medians replace initial planning offsets only after eight qualified samples in the rolling 90-day window.</p>
          {data.calibrations.length === 0
            ? <div className="notice info">No segment has reached the calibration threshold yet. New samples require two independent verified contributor identities and GPS accuracy of 40 m or better.</div>
            : <div className="ops-table-wrap"><table className="ops-table">
              <thead><tr><th>Corridor / segment</th><th>Bus</th><th>Samples</th><th>Baseline</th><th>Median</th><th>P80</th></tr></thead>
              <tbody>{data.calibrations.map((row, index) => <tr key={`${row.route_id}-${row.from_checkpoint}-${row.to_checkpoint}-${row.bus_type}-${index}`}>
                <td>{row.short_name}<br /><small>{row.from_checkpoint} → {row.to_checkpoint}</small></td>
                <td>{row.bus_type}</td><td>{row.sample_count}</td>
                <td>{Number(row.baseline_minutes).toFixed(1)} min</td>
                <td><strong>{Number(row.median_minutes).toFixed(1)} min</strong></td>
                <td>{Number(row.p80_minutes).toFixed(1)} min</td>
              </tr>)}</tbody>
            </table></div>}
        </section>

        <section className="card ops-panel">
          <h2>Open operational alerts</h2>
          {data.alerts.length === 0
            ? <p>No active alerts in the latest snapshot.</p>
            : data.alerts.map((alert) => <div className={`ops-alert`} key={alert.alert_key}>
              <span className={`ops-state ${alert.severity}`}>{alert.severity}</span><span>{alert.message}</span>
            </div>)}
        </section>
        <p className="ops-footnote">Calibration policy: rolling 90 days · minimum 8 samples · quality score ≥70 · mean GPS accuracy ≤40 m · median/MAD outlier rejection. ETA values are research estimates, not operator dispatch data.</p>
      </>}
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="ops-kpi"><span>{label}</span><strong>{value}</strong></div>;
}
