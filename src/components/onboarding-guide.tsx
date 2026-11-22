'use client';

import { useEffect, useState } from 'react';

const steps = [
  { title: 'Welcome to BiyahePanay', body: 'This is a community-powered bus tracker for Panay. It is not an official operator timetable. Arrivals depend on current, corroborated community reports.', action: 'Start with Routes', href: '#corridors' },
  { title: 'Choose your corridor', body: 'Select the route you are travelling on. Kalibo has two variants: via Mambusao and via Sapian. The selected corridor determines which stops and trips are compared.', action: 'View routes', href: '#corridors' },
  { title: 'Find your waiting stop', body: 'Use My Location to find a nearby mapped stop, or choose your stop manually. GPS can drift, especially indoors. When the app reports a weak or distant fix, refresh outdoors and check the stop yourself.', action: 'Find a stop', href: '#arrivals' },
  { title: 'Read arrivals and checkpoints', body: 'Verified means a report met the app’s corroboration rules. Unverified means confirmation is still pending. Scheduled is a projection, not a confirmed dispatch. Tracking lost means the ETA is paused.', action: 'See the trip timeline', href: '#checkpoint-timeline' },
  { title: 'Contribute safely', body: 'Verify your email before contributing. Departures and checkpoint reports require location permission. Rider Beacon is optional and may be interrupted by the browser or operating system.', action: 'Go to Contribute', href: '#contribution' },
];

export default function OnboardingGuide() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        setOpen(window.localStorage.getItem('biyahepanay-onboarding-v1') !== 'done');
      } catch { setOpen(true); }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const finish = () => {
    try { window.localStorage.setItem('biyahepanay-onboarding-v1', 'done'); } catch { /* Close for this visit. */ }
    setOpen(false);
  };
  if (!open) return null;
  const current = steps[step];
  return (
    <div className="onboarding-backdrop" role="presentation">
      <section className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding-kicker">QUICK START · {step + 1} OF {steps.length}</div>
        <div className="onboarding-progress" aria-hidden="true">
          {steps.map((item, index) => <span key={item.title} className={index <= step ? 'is-complete' : ''} />)}
        </div>
        <h2 id="onboarding-title">{current.title}</h2>
        <p>{current.body}</p>
        <div className="onboarding-actions">
          <button type="button" className="onboarding-skip" onClick={finish}>Skip guide</button>
          {step > 0 && <button type="button" className="secondary-button" onClick={() => setStep((value) => value - 1)}>Back</button>}
          <a className="primary-button" href={current.href} onClick={finish}>{current.action}</a>
          {step < steps.length - 1
            ? <button type="button" className="secondary-button" onClick={() => setStep((value) => value + 1)}>Next</button>
            : <button type="button" className="secondary-button" onClick={finish}>Finish</button>}
        </div>
        <a className="onboarding-help-link" href="/help">Open the complete user guide</a>
      </section>
    </div>
  );
}
