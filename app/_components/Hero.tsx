/**
 * The hero states the mechanism, not the mood.
 *
 * Every figure in the stat strip is read off the `ProofView` — the same object the ledger below
 * animates — so the hero cannot drift from the proof. The one figure that is not (the test count)
 * is labelled with the command that produces it.
 */

import { ArrowDown, ExternalLink } from 'lucide-react';

import { Badge } from '@/app/_components/ui/badge';
import { RepoBadges } from '@/app/_components/RepoBadges';
import { Button } from '@/app/_components/ui/button';
import { explorerAddress } from '@/app/_lib/chain';
import { sourceHref, sourceLinkProps } from '@/app/_lib/links';
import type { ProofView } from '@/app/_lib/proof';
import { groupDigits, shortHash } from '@/app/_lib/utils';

export async function Hero({ view }: { view: ProofView }) {
  const stats = [
    {
      figure: `${view.ruling.frontIndex} · ${view.ruling.victimIndex} · ${view.ruling.backIndex}`,
      label: 'positions recovered on-chain',
      note: 'from the precompile’s own logs',
    },
    {
      figure: `${view.claim.gasPercentOfCap}%`,
      label: `of MAX_GAS_CAP — ${groupDigits(view.claim.gasUsed)} gas`,
      note: 'three verifications, one transaction',
    },
    {
      figure: `${view.source.merkleDepth}`,
      label: 'laterality bits per position',
      note: `one block, ${view.source.transactionCount} transactions`,
    },
    {
      figure: '144',
      label: 'Foundry tests, all passing',
      note: 'npm test — forge test --summary',
    },
  ];

  return (
    <section id="top" className="relative overflow-hidden pb-16 pt-28 sm:pt-36">
      <div aria-hidden className="meshfield pointer-events-none absolute inset-0 opacity-70" />
      <div aria-hidden className="gridfield pointer-events-none absolute inset-0 opacity-40" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-base"
      />

      <div className="relative mx-auto max-w-[78rem] px-5 sm:px-8">
        <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div>
            <div className="mb-7 flex flex-wrap items-center gap-2">
              <Badge tone="indexed">Creditcoin CC3 · live</Badge>
              <Badge tone="claimed">Attestcoin native query verifier</Badge>
              <Badge tone="quiet">DeFi</Badge>
              {/* Real release + CI state, read from the GitHub API on the server. Renders nothing
                  if either read fails — see _lib/repo.ts. */}
              <RepoBadges />
            </div>

            <h1 className="text-balance text-[clamp(2.6rem,7.2vw,5.1rem)] font-bold leading-[0.94] tracking-[-0.035em]">
              <span className="block animate-rise text-mid" style={{ animationDelay: '0ms' }}>
                Position inside a block
              </span>
              <span className="block animate-rise text-hi" style={{ animationDelay: '110ms' }}>
                was a claim.
              </span>
              <span
                className="block animate-rise bg-[image:var(--gradient-index)] bg-clip-text text-transparent"
                style={{ animationDelay: '230ms' }}
              >
                Now it is a fact.
              </span>
            </h1>

            <p
              className="mt-7 max-w-2xl animate-rise text-balance text-[1.0625rem] leading-relaxed text-mid sm:text-lg"
              style={{ animationDelay: '340ms' }}
            >
              index41 proves that transaction <span className="text-hi">A executed before</span> transaction B
              inside an Ethereum block — by reading each transaction&apos;s ordinal position out of the
              left/right <span className="text-hi">laterality of its merkle authentication path</span>. A relay
              bonds CTC behind &ldquo;you will not be sandwiched&rdquo;. When it happens, the contract asserts{' '}
              <span className="font-mono text-accent">front &lt; victim &lt; back</span>, computes the
              attacker&apos;s realized profit from proven logs, and pays the victim from the bond.
            </p>

            <div className="mt-9 flex animate-rise flex-wrap items-center gap-3" style={{ animationDelay: '450ms' }}>
              <Button asChild size="lg" variant="indexed">
                <a href="#proof">
                  Watch three rows light up
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </a>
              </Button>
              <Button asChild size="lg" variant="slate">
                <a href={explorerAddress(view.contract.index41)} target="_blank" rel="noreferrer noopener">
                  Contract on Blockscout
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
              </Button>
            </div>

            <p
              className="mt-5 animate-rise font-mono text-[0.6875rem] leading-relaxed text-low"
              style={{ animationDelay: '540ms' }}
            >
              Index41 {shortHash(view.contract.index41, 10, 8)} · chain {view.network.chainId} ·{' '}
              <a href={sourceHref('contracts/src/Index41.sol')} {...sourceLinkProps} className="link-hash">
                Index41.sol
              </a>
              {' · '}no wallet, no API key, no .env — this page reads a public node
            </p>
          </div>

          {/* --- social proof, in the only currency this project has: verified numbers --- */}
          <dl
            className="grid animate-rise grid-cols-2 gap-3 self-stretch lg:self-end"
            style={{ animationDelay: '620ms' }}
          >
            {stats.map((s) => (
              <div key={s.label} className="plate rounded-md p-4">
                <dt className="font-mono text-[1.55rem] font-bold leading-none tracking-tight text-accent">
                  {s.figure}
                </dt>
                <dd className="mt-2 text-[0.8125rem] font-medium leading-snug text-hi">{s.label}</dd>
                <dd className="mt-1 font-mono text-[0.625rem] leading-snug text-low">{s.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
