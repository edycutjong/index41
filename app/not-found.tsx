/**
 * 404 — the one page on this site that is allowed to say it does not know something.
 *
 * The whole project recovers a transaction's POSITION from the laterality of its merkle path. A
 * route that does not exist is the same shape of failure: a path that resolves to no index. So the
 * page reuses the ledger's own `index-cell` in its unproven state (`··`, steel-slate, never gold)
 * rather than printing a generic "404" in a large font. Nothing here is decorative — the cell is
 * the same component the proof uses, in the same state it uses when the chain has not spoken.
 *
 * Static by design: it takes no chain read, so it must never become a dynamic render.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/app/_components/ui/button';

export const metadata: Metadata = {
  title: 'No index for this path — index41',
  description: 'This route does not resolve to a page.',
  // Required, not optional: the root layout declares `index, follow` for the site, and without an
  // override here that value is inherited onto the 404 — where it lands next to the `noindex` Next
  // emits for a not-found render, leaving two contradictory robots tags on one page.
  robots: { index: false, follow: true },
};

/** The destinations that actually exist, so the page is a way out rather than a dead end. */
const EXITS = [
  { href: '/#proof', label: 'The proof', hint: 'three rows of a real block, lighting up in order' },
  { href: '/judge', label: 'For judges', hint: 'everything needed to verify, in order' },
  { href: '/#mechanism', label: 'The mechanism', hint: 'how laterality becomes an index' },
  { href: '/#faq', label: 'FAQ', hint: 'the questions worth asking first' },
];

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[100svh] max-w-[52rem] flex-col justify-center px-5 py-24 sm:px-8">
      <span className="eyebrow">Error 404</span>

      <div className="mt-6 flex items-center gap-5">
        {/* the ledger's own cell, in the state it wears when nothing has been proven */}
        <span className="index-cell text-2xl" data-state="claimed" aria-hidden>
          ··
        </span>
        <h1 className="text-balance text-[clamp(1.75rem,4vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.03em]">
          This path has no index.
        </h1>
      </div>

      <p className="mt-6 max-w-prose text-[0.9375rem] leading-relaxed text-mid">
        Every position on this site is recovered from a path. That one does not resolve — so rather
        than invent a page, it reports the miss. The proof itself is untouched and still on chain.
      </p>

      <div className="mt-9 flex flex-wrap gap-3">
        <Button asChild variant="indexed">
          <Link href="/">Back to the proof</Link>
        </Button>
        <Button asChild variant="slate">
          <Link href="/judge">For judges</Link>
        </Button>
      </div>

      <div className="rule my-10" />

      <nav aria-label="Where to go instead">
        <h2 className="eyebrow">Paths that do resolve</h2>
        <ul className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {EXITS.map((exit) => (
            <li key={exit.href}>
              <Link
                href={exit.href}
                className="group block rounded-sm border border-transparent px-1 py-1 transition-colors hover:border-line"
              >
                <span className="text-[0.875rem] font-bold text-hi transition-colors group-hover:text-accent">
                  {exit.label}
                </span>
                <span className="mt-0.5 block font-mono text-[0.6875rem] leading-relaxed text-low">
                  {exit.hint}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
