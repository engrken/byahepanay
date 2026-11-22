'use client';

import { useEffect } from 'react';
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from '@/lib/presence';

export default function PresenceHeartbeat() {
  useEffect(() => {
    let stopped = false;
    let sending = false;
    const heartbeat = async () => {
      if (stopped || sending || document.visibilityState !== 'visible') return;
      sending = true;
      try {
        const session = await fetch('/api/session', { method: 'GET', cache: 'no-store', credentials: 'same-origin' });
        if (!session.ok || stopped) return;
        await fetch('/api/presence', {
          method: 'POST', cache: 'no-store', credentials: 'same-origin', keepalive: true,
          headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
      } catch {
        // Presence is best-effort and must never block passenger browsing.
      } finally { sending = false; }
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), PRESENCE_HEARTBEAT_INTERVAL_MS);
    const onVisibility = () => { if (document.visibilityState === 'visible') void heartbeat(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
    };
  }, []);
  return null;
}
