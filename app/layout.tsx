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

/**
 * Two lengths, deliberately. Search engines and social cards truncate at different widths, so the
 * page copy is written to each budget rather than one string being cut twice:
 *   title        ≤ 60  — Google truncates past ~60, X past ~70
 *   description  ≤ 155 — Google truncates around 150–160
 *   social*      ≤ 125 — cards often show ~125 and less again on mobile
 * Keep `description` containing "laterality": e2e/zero-config.spec.ts asserts the real pitch is
 * present rather than a framework default.
 */
const title = 'index41 — prove transaction order in an Ethereum block';
const description =
  'Recovers a transaction’s position in an Ethereum block from its merkle path laterality, then proves front-run < victim < back-run on Creditcoin.';

const socialTitle = 'index41 — prove transaction order in an Ethereum block';
const socialDescription =
  'Proves front-run < victim < back-run inside a real Ethereum block, and pays the victim from the relay’s bond. On Creditcoin.';

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
  creator: 'index41',
  publisher: 'index41',
  category: 'technology',
  // phone numbers/addresses are never meaningful here, and iOS Safari otherwise
  // linkifies transaction hashes and block numbers as telephone numbers
  formatDetection: { telephone: false, address: false, email: false },
  ...(siteUrl ? { alternates: { canonical: '/' } } : {}),
  openGraph: {
    type: 'website',
    title: socialTitle,
    description: socialDescription,
    siteName: 'index41',
    locale: 'en_US',
    ...(siteUrl ? { url: '/' } : {}),
    images: [
      {
        url: '/og-image-v2.png',
        width: 1200,
        height: 630,
        type: 'image/png',
        alt: 'index41 — Ethereum mainnet block 25,764,741 with the searcher at index 14, the victim at 15 and the searcher again at 16, ruled on by a bonded contract on Creditcoin CC3',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: socialTitle,
    description: socialDescription,
    images: ['/og-image-v2.png'],
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    shortcut: ['/icon-32.png'],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  manifest: '/site.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'index41',
    statusBarStyle: 'black-translucent',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
};

/**
 * This surface is dark-only, and that is a design decision rather than an
 * omission. The signature moment is a ledger row *lighting gold* the instant
 * merkle laterality decodes: `--accent` #FFC53D measures 11.9:1 on `--bg-base`
 * #070B12 and about 1.7:1 on white, so on a light ground the one event the
 * product exists to show would be invisible.
 *
 * Declaring `colorScheme` is what makes that choice explicit to the browser:
 * it paints the canvas dark before CSS arrives (no white flash), renders
 * scrollbars and form controls in dark chrome, and stops user-agent auto-dark
 * from inverting a page that is already dark.
 */
export const viewport: Viewport = {
  themeColor: '#070b12',
  colorScheme: 'dark',
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
