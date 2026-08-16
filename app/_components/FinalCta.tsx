import { ArrowUpRight, ExternalLink, Terminal } from 'lucide-react';

import { Button } from '@/app/_components/ui/button';
import { explorerAddress, explorerTx } from '@/app/_lib/chain';
import { REPO_URL, sourceHref, sourceLinkProps } from '@/app/_lib/links';
import type { ProofView } from '@/app/_lib/proof';
import { groupDigits, shortHash } from '@/app/_lib/utils';

export function FinalCta({ view }: { view: ProofView }) {
  return (
    <section className="relative overflow-hidden border-y border-line">
      <div aria-hidden className="meshfield pointer-events-none absolute inset-0 opacity-90" />
      <div aria-hidden className="gridfield pointer-events-none absolute inset-0 opacity-30" />

      <div className="relative mx-auto max-w-[78rem] px-5 py-24 sm:px-8 sm:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <span className="eyebrow">Verify it yourself</span>
          <h2 className="mt-4 text-balance text-[clamp(2.1rem,5.4vw,3.9rem)] font-bold leading-[1.02] tracking-[-0.035em]">
            Don&apos;t take the animation&apos;s word for it.
            <span className="mt-2 block bg-[image:var(--gradient-index)] bg-clip-text text-transparent">
              Open the receipt.
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-[1.0625rem] leading-relaxed text-mid">
            Five logs, one Creditcoin transaction, {groupDigits(view.claim.gasUsed)} gas. Three of the logs
            were written by the Attestcoin precompile itself — not by this project&apos;s contract, and
            certainly not by this website.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" variant="indexed">
              <a href={explorerTx(view.claim.txHash)} target="_blank" rel="noreferrer noopener">
                Read the ruling on Blockscout
                <ArrowUpRight className="h-4 w-4" aria-hidden />
              </a>
            </Button>
            <Button asChild size="lg" variant="slate">
              <a href={explorerAddress(view.contract.index41)} target="_blank" rel="noreferrer noopener">
                The contract
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <a href={sourceHref('docs/pipeline-output.txt')} {...sourceLinkProps}>
                The full transcript
              </a>
            </Button>
          </div>

          <div className="mx-auto mt-12 max-w-2xl">
            <div className="plate rounded-md p-5 text-left">
              <div className="mb-3 flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-low" aria-hidden />
                <span className="eyebrow">or reproduce the read on your own machine</span>
              </div>
              <pre className="scroll-x font-mono text-[0.8125rem] leading-relaxed text-mid">
                <code>{`${REPO_URL ? `git clone ${REPO_URL}\n` : '# from the repository root\n'}npm install
npm run dev                              # the page you are looking at
node scripts/capture-proof.mjs --check   # re-read every source, diff the artifact`}</code>
              </pre>
              <p className="mt-3 font-mono text-[0.625rem] leading-relaxed text-low">
                no .env · no wallet · no API key. <code>--check</code> re-reads Creditcoin, the proof service
                and an Ethereum mainnet RPC, then exits non-zero if any of them disagrees with the committed
                artifact.
              </p>
            </div>
          </div>

          <p className="mt-8 font-mono text-[0.6875rem] text-low">
            claim {shortHash(view.claim.txHash, 12, 10)} · block {view.claim.blockNumber} · status{' '}
            {view.claim.status === 1 ? 'success' : `0x${view.claim.status.toString(16)}`}
          </p>
        </div>
      </div>
    </section>
  );
}
