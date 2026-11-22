import type { Metadata, Viewport } from 'next';
import './globals.css';
import PresenceHeartbeat from '@/components/presence-heartbeat';

export const metadata: Metadata = {
  title: 'BiyahePanay — Bus Tracking & Passenger Information',
  description: 'Community-powered bus checkpoint sightings and estimated arrivals across Capiz, Iloilo, and Aklan.',
  applicationName: 'BiyahePanay',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'BiyahePanay' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#152b3a',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try { const saved = localStorage.getItem('byahepanay-theme'); const theme = saved === 'light' || saved === 'dark' ? saved : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; } catch {}`,
          }}
        />
      </head>
      <body><PresenceHeartbeat />{children}</body>
    </html>
  );
}
