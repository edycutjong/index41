/**
 * Element 7 — the core capabilities, but written as claims a judge can falsify by opening a file.
 * Deliberately asymmetric: the leap gets a full-width panel, the supporting five sit in a bento
 * beneath it, because they are supporting.
 */

import { Ban, Binary, Fuel, GitBranch, Repeat2, ShieldCheck, Timer } from 'lucide-react';

import { Card, CardContent } from '@/app/_components/ui/card';
import type { ProofView } from '@/app/_lib/proof';
import { groupDigits } from '@/app/_lib/utils';

export function Mechanism({ view }: { view: ProofView }) {
  const front = view.legs[0];
  const capabilities = [
    {
      icon: GitBranch,
      title: 'Three proof sources, one interface',
      body:
        'The hosted by-index endpoint (no SDK binding, no official example), the SDK’s own by-hash batch, ' +
        'and a local raw builder that needs no proof service at all. Run with --kill-hosted and the local ' +
        'source reproduces the hosted merkle root byte for byte.',
      proof: 'src/proof-sources.ts',
    },
    {
      icon: ShieldCheck,
      title: 'The prover gets no benefit of the doubt',
      body:
        'Before any gas: leaves re-encoded from mainnet and compared, paths re-folded to the root, and the ' +
        `continuity proof’s ${view.source.continuityRoots} roots chained until they land on a checkpoint ` +
        'Creditcoin already holds. An off-chain blob bound to on-chain state, for free.',
      proof: 'src/audit.ts',
    },
    {
      icon: Fuel,
      title: 'Free dry run, then one transaction',
      body:
        `calculateTxIndex is a view. Every position is recovered and every verification rehearsed at zero ` +
        `cost, and only then does one transaction spend ${groupDigits(view.claim.gasUsed)} gas — ` +
        `${view.claim.gasPercentOfCap}% of the 75,000,000 cap — on three verifyAndEmit calls at once.`,
      proof: 'contracts/src/Index41.sol',
    },
    {
      icon: Timer,
      title: 'Attestation waiting that reads the error',
      body:
        'The proof API’s BlockNotReady payload carries block_number and last_attested_block. Subtract them, ' +
        'multiply by the source chain’s slot time, and you know the earliest instant a retry can succeed. ' +
        'No official example touches either field.',
      proof: 'src/prover-api.ts',
    },
    {
      icon: Repeat2,
      title: 'A ruling cannot be claimed twice',
      body:
        'Three per-leg query ids and a composite claim id are burned when the court rules. Replaying the ' +
        'same sandwich against the same court is refused — demonstrated, not asserted, in a recorded run.',
      proof: 'docs/pipeline-output-replay.txt',
    },
    {
      icon: Ban,
      title: 'What it deliberately cannot do',
      body:
        'Attestcoin proves transaction HISTORY, not STATE. There is no proof over eth_call, storage or ' +
        'balanceOf, and no on-chain batch verify. Harm is therefore derived from proven logs — never from ' +
        'a price read the protocol cannot attest.',
      proof: 'docs/PIPELINE.md',
    },
  ];

  return (
    <section id="mechanism" className="relative mx-auto max-w-[78rem] px-5 py-20 sm:px-8 sm:py-28">
      <div className="mb-12 max-w-3xl">
        <span className="eyebrow">The leap</span>
        <h2 className="mt-3 text-balance text-[clamp(1.9rem,4vw,3rem)] font-bold leading-[1.05] tracking-[-0.03em]">
          Path laterality <span className="text-accent">is</span> the index, in binary.
        </h2>
      </div>

      {/* --- the one idea, at full width -------------------------------------------- */}
      <Card className="overflow-hidden">
        <CardContent className="grid gap-8 p-7 sm:p-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
          <div>
            <div className="mb-4 flex items-center gap-2.5">
              <Binary className="h-5 w-5 text-accent" aria-hidden />
              <span className="eyebrow">why nothing else can see this</span>
            </div>
            <p className="text-[1.0625rem] leading-relaxed text-mid">
              A merkle authentication path is normally treated as an opaque list of sibling hashes: something
              you fold to check membership and then throw away. But walking it{' '}
              <span className="text-hi">leaf → root</span>, every step also answers a second question —{' '}
              <span className="text-hi">were you the left child or the right one?</span> That single bit, at
              that depth, is one bit of your position in the tree.
            </p>
            <p className="mt-4 text-[1.0625rem] leading-relaxed text-mid">
              Collect the bits least-significant-first and you have not <em className="text-hi">verified</em> a
              position someone told you. You have <em className="text-accent">recovered</em> it from the
              geometry of the proof itself, where it was never written down and therefore cannot be disputed.
              Creditcoin exposes exactly this as{' '}
              <code className="font-mono text-primary-ink">calculateTxIndex</code> — and it is a{' '}
              <span className="text-hi">view</span>, so it costs nothing.
            </p>
            <p className="mt-4 text-[1.0625rem] leading-relaxed text-mid">
              Ordering follows for free. If A&apos;s path decodes below B&apos;s path in the same block, A ran
              first. Not &ldquo;probably&rdquo;, not &ldquo;according to an indexer&rdquo; — provably, from
              bytes another chain already committed to.
            </p>
          </div>

          {front && (
            <figure className="plate self-start rounded-md p-5">
              <figcaption className="eyebrow mb-4">worked example — {front.role}</figcaption>
              <div className="space-y-3 font-mono text-[0.8125rem]">
                <Row k="path leaf → root" v={front.laterality} tone="ink" />
                <Row
                  k="L → 1, R → 0"
                  v={Array.from(front.laterality)
                    .map((c) => (c === 'L' ? '1' : '0'))
                    .join('')}
                  tone="ink"
                />
                <Row
                  k="least-significant first"
                  v={Array.from(front.laterality)
                    .map((c, i) => (c === 'L' ? 1 << i : 0))
                    .filter(Boolean)
                    .map((w) => `+${w}`)
                    .join(' ')}
                  tone="accent"
                />
                <div className="rule my-1" />
                <Row k="= block position" v={String(front.index)} tone="big" />
              </div>
              <p className="mt-4 text-[0.75rem] leading-relaxed text-low">
                Same eight bits the Attestcoin precompile folds on-chain. The page shows the off-chain decode
                and the on-chain emission side by side above, so a mismatch would be visible rather than
                hidden.
              </p>
            </figure>
          )}
        </CardContent>
      </Card>

      {/* --- the supporting six ------------------------------------------------------ */}
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {capabilities.map((c) => (
          <Card key={c.title} className="group">
            <CardContent className="p-6">
              <c.icon
                className="h-5 w-5 text-primary-ink transition-colors duration-300 group-hover:text-accent"
                aria-hidden
              />
              <h3 className="mt-4 text-base font-bold leading-snug text-hi">{c.title}</h3>
              <p className="mt-2.5 text-[0.875rem] leading-relaxed text-mid">{c.body}</p>
              <p className="mt-4 font-mono text-[0.6875rem] text-low">{c.proof}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone: 'ink' | 'accent' | 'big' }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-[0.6875rem] uppercase tracking-[0.14em] text-low">{k}</span>
      <span
        className={
          tone === 'big'
            ? 'text-2xl font-bold text-accent'
            : tone === 'accent'
              ? 'text-right font-bold text-accent'
              : 'text-right font-bold tracking-[0.16em] text-primary-ink'
        }
      >
        {v}
      </span>
    </div>
  );
}
