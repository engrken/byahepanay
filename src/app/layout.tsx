import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ByahePanay — Ceres Liner Last-Trip Tracker',
  description: 'Community-powered checkpoint sightings and estimated Ceres Liner arrivals across Capiz, Iloilo, and Aklan.',
  applicationName: 'ByahePanay',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'ByahePanay' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#152b3a',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
