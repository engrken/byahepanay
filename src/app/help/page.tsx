import Link from 'next/link';

const sections = [
  {
    id: 'routes',
    title: '1. Choose your route',
    body: 'Start in Routes and select the corridor you are travelling on. Choose Kalibo via Mambusao or via Sapian carefully: they are different road branches with different checkpoints.',
    bullets: ['Iloilo via Passi', 'Kalibo via Mambusao', 'Kalibo via Sapian', 'Tapaz / Calinog', 'Estancia'],
  },
  {
    id: 'stops',
    title: '2. Find your waiting stop',
    body: 'In Arrivals, tap Use my location and allow location access. The app compares your current GPS fix with mapped stops on the selected corridor. You can always choose your waiting stop manually from the list.',
    bullets: ['For better GPS, move outdoors and wait for a more accurate fix.', 'The accuracy value (for example ±30 m) is the phone’s estimated uncertainty, not the distance to the stop.', 'If no stop is close enough to your GPS fix, the app asks you to select one manually rather than guessing.'],
  },
  {
    id: 'arrivals',
    title: '3. Understand arrival information',
    body: 'The app ranks trips that are still approaching your chosen stop. A bus that has already passed it or has only an unconfirmed report there is not shown as an incoming bus.',
    bullets: ['Verified: a report has passed the app’s community verification rules.', 'Unverified: the report is waiting for additional confirmation.', 'Scheduled · Unconfirmed: a projected departure, not a confirmed operator dispatch.', 'Confirmation overdue: the next checkpoint report is later than expected.', 'Tracking lost · ETA paused: no confirmed checkpoint has been received recently, so the app stops displaying a misleading arrival estimate.'],
  },
  {
    id: 'trip',
    title: '4. Follow a current trip',
    body: 'Use Current trip and Checkpoints to see the last confirmed stop and the trip’s progress. ETA values are estimates and can change as new verified reports arrive.',
    bullets: ['The timeline is based on confirmed checkpoint observations.', 'Rider Beacon status pings do not count as a confirmed checkpoint.', 'A trip can disappear from the active board when an administrator marks tracking inactive; its history is retained.'],
  },
  {
    id: 'contribute',
    title: '5. Report a bus or checkpoint',
    body: 'Open Contribute. Verify access to your email inbox with a one-time code before submitting reports. Email verification helps maintain a consistent reporter identity; it does not prove that a report is true.',
    bullets: ['Log a departure only when the bus is departing the Pueblo de Panay Terminal geofence.', 'Checkpoint sightings need location permission and must be close to a mapped checkpoint.', 'Rider Beacon is optional. Keep the app open and follow your phone’s location permission prompts.', 'Do not submit a report while driving. Ask a passenger or another observer to report safely.'],
  },
  {
    id: 'offline',
    title: '6. Offline use and troubleshooting',
    body: 'When the phone loses its connection, eligible roadside sightings can be stored on the device and retried when connectivity returns. Not every action is available offline.',
    bullets: ['Email OTP, departure verification, live board refresh and administrator actions need a connection.', 'Queued sightings may be rejected later if they fail server-side validation.', 'If location is inaccurate, refresh outdoors or choose your stop manually.', 'If the page looks stale, refresh it when online.'],
  },
];

export default function HelpPage() {
  return (
    <main className="help-shell">
      <header className="help-header">
        <div className="help-kicker">BIYAHEPANAY · PASSENGER GUIDE</div>
        <h1>How to use BiyahePanay</h1>
        <p>A practical guide to finding your stop, reading arrivals and contributing reliable bus observations.</p>
        <div className="help-actions">
          <Link className="primary-button" href="/">Open the tracker</Link>
          <Link className="secondary-button" href="/#arrivals">Find arrivals</Link>
        </div>
      </header>
      <nav className="help-toc" aria-label="Guide sections">
        {sections.map((section) => <a key={section.id} href={'#' + section.id}>{section.title}</a>)}
      </nav>
      {sections.map((section) => (
        <section className="card help-section" id={section.id} key={section.id}>
          <h2>{section.title}</h2>
          <p>{section.body}</p>
          <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      ))}
      <footer className="help-footer">
        <p><strong>Important:</strong> BiyahePanay is a community-powered information tool, not an official bus operator timetable or emergency service. Check with the operator or terminal for confirmed dispatch information.</p>
        <Link href="/">← Back to BiyahePanay</Link>
      </footer>
    </main>
  );
}
