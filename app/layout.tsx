import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';

import './globals.css';

/**
 * Two faces, both taken from the project's own token sheet so the site, the icon and the OG card
 * are one system. Space Grotesk carries the voice; JetBrains Mono carries every number, because
 * on this page numbers are evidence and evidence is set in mono.
 */
const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

const title = 'index41 — prove transaction order inside an Ethereum block, on Creditcoin';
const description =
  'index41 recovers a transaction’s position inside an Ethereum block from the left/right laterality of its merkle authentication path, proves front-run < victim < back-run on Creditcoin, and pays the victim from a relay’s bond. Real mainnet sandwich, real on-chain ruling.';

/**
 * No placeholder domain is baked in. Set NEXT_PUBLIC_SITE_URL when the page is deployed and the
 * OG tags become absolute; until then they stay relative rather than pointing at a host that does
 * not exist.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title,
  description,
  applicationName: 'index41',
  keywords: [
    'transaction order proof',
    'merkle path laterality',
    'calculateTxIndex',
    'Attestcoin',
    'Creditcoin CC3',
    'sandwich attack proof',
    'MEV',
    'front-running evidence',
    'Ethereum block position',
    'DeFi',
  ],
  authors: [{ name: 'index41' }],
  openGraph: {
    type: 'website',
    title,
    description,
    siteName: 'index41',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'index41 — position is a fact' }],
  },
  twitter: { card: 'summary_large_image', title, description, images: ['/og-image.png'] },
  icons: { icon: '/icon.svg' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#070b12',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="min-h-screen overflow-x-hidden bg-base text-hi antialiased">{children}</body>
    </html>
  );
}
