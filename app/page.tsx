/**
 * index41 — the judge-facing demo surface.
 *
 * DESIGN DIRECTION (committed once, applied everywhere):
 *   Aesthetic       amber-on-dark data terminal. A block explorer that has been art-directed —
 *                   not a SaaS marketing page with a chart on it. Dense where the evidence is,
 *                   generous where the argument is.
 *   Type            Space Grotesk carries the voice; JetBrains Mono carries every number, because
 *                   on this page numbers are evidence.
 *   Colour          ONE axis, taken verbatim from the project's token sheet. Steel-slate #587B9E =
 *                   a position that is merely CLAIMED. Data-gold #FFC53D = a position that has
 *                   been PROVEN. Nothing that is not a proven index is ever allowed to be gold.
 *   Motion          One orchestrated entrance in the hero; after that, motion happens only when a
 *                   fact lands. The ledger reveals; it never decorates.
 *   Space           Asymmetric throughout — the argument column is always wider than the evidence
 *                   column, and the ledger breaks out of the prose rhythm entirely.
 *
 * The page is a server component so the first paint already carries a real chain read.
 */

import { Attestations } from '@/app/_components/Attestations';
import { Faq } from '@/app/_components/Faq';
import { FinalCta } from '@/app/_components/FinalCta';
import { Footer } from '@/app/_components/Footer';
import { Header } from '@/app/_components/Header';
import { Hero } from '@/app/_components/Hero';
import { LiveProof } from '@/app/_components/LiveProof';
import { Mechanism } from '@/app/_components/Mechanism';
import { ProvenanceTable } from '@/app/_components/Provenance';
import { getProofView } from '@/app/_lib/proof';
import { utc } from '@/app/_lib/utils';

/** Never prerender a stale ruling into HTML: the first paint should be a read, not a memory. */
export const dynamic = 'force-dynamic';

export default async function Page() {
  const view = await getProofView();

  return (
    <>
      <Header />

      <main>
        <Hero view={view} />

        {/* --- THE SIGNATURE MOMENT ------------------------------------------------ */}
        <section id="proof" className="relative mx-auto max-w-[78rem] scroll-mt-20 px-5 pb-10 sm:px-8">
          <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
            <div>
              <span className="eyebrow">The signature moment</span>
              <h2 className="mt-3 text-balance text-[clamp(1.9rem,4vw,3rem)] font-bold leading-[1.05] tracking-[-0.03em]">
                Three rows of a real Ethereum block,
                <span className="block text-accent">lighting up in order.</span>
              </h2>
            </div>
            <p className="text-[0.9375rem] leading-relaxed text-mid">
              Each row&apos;s position is dark until the merkle path&apos;s laterality has been read bit by
              bit. Then the index cell fills gold — because at that instant the position stopped being a
              claim. Block {view.source.blockNumber} was mined {utc(view.source.timestamp)}.
            </p>
          </div>

          <LiveProof initial={view} />
        </section>

        <Mechanism view={view} />

        {/* --- provenance ---------------------------------------------------------- */}
        <section id="provenance" className="relative mx-auto max-w-[78rem] scroll-mt-20 px-5 py-20 sm:px-8 sm:py-28">
          <div className="mb-10 max-w-3xl">
            <span className="eyebrow">Provenance</span>
            <h2 className="mt-3 text-balance text-[clamp(1.9rem,4vw,3rem)] font-bold leading-[1.05] tracking-[-0.03em]">
              Every number above, and where it came from.
            </h2>
            <p className="mt-4 text-[1.0625rem] leading-relaxed text-mid">
              A demo that shows a figure it cannot source is a mock in a costume. So here is the accounting,
              on the page rather than in a README.
            </p>
          </div>
          <ProvenanceTable view={view} />
        </section>

        <Attestations view={view} />
        <Faq view={view} />
        <FinalCta view={view} />
      </main>

      <Footer view={view} />
    </>
  );
}
