'use client';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/app/_components/ui/accordion';
import type { ProofView } from '@/app/_lib/proof';
import { groupDigits } from '@/app/_lib/utils';

export function Faq({ view }: { view: ProofView }) {
  const items: Array<{ q: string; a: React.ReactNode }> = [
    {
      q: 'Are the indices on this page real, or a scripted animation?',
      a: (
        <>
          Real. The page calls <code className="text-primary-ink">eth_getTransactionReceipt</code> against a
          public Creditcoin CC3 node and decodes the three{' '}
          <code className="text-primary-ink">TransactionVerified</code> logs the Attestcoin precompile emitted
          inside that receipt. If the node is unreachable it falls back to{' '}
          <code className="text-primary-ink">data/proof-artifact.json</code> — a recording of the same live
          read, written by <code className="text-primary-ink">scripts/capture-proof.mjs</code>, which refuses
          to write a file whose own decode disagrees with the chain. The banner above the ledger always says
          which of the two you are looking at. There is no third path, and no hardcoded{' '}
          {view.ruling.victimIndex} anywhere in the source.
        </>
      ),
    },
    {
      q: 'Why is the project called index41 when the proven positions are 14, 15 and 16?',
      a: (
        <>
          The name and the icon use 41 / 42 / 43 as an illustrative fingerprint — three consecutive slots in a
          block. The sandwich that was actually found, proven and paid sits at{' '}
          {view.ruling.frontIndex} / {view.ruling.victimIndex} / {view.ruling.backIndex} in Ethereum mainnet
          block {view.source.blockNumber}, and those are the only numbers this page will ever show you as a
          result. Branding is branding; evidence is evidence.
        </>
      ),
    },
    {
      q: 'How can a merkle path tell you a position? Isn’t it just an inclusion proof?',
      a: (
        <>
          An inclusion proof answers &ldquo;is this leaf in the tree&rdquo;. But folding it leaf → root also
          requires knowing, at each level, whether your node was the left or the right child — otherwise you
          cannot concatenate in the right order. Those {view.source.merkleDepth} decisions, read
          least-significant-first with L = 1, spell the leaf&apos;s index in binary. Creditcoin exposes it as{' '}
          <code className="text-primary-ink">INativeQueryVerifier.calculateTxIndex</code>, a{' '}
          <span className="text-hi">view</span> function: recovering a position costs no gas at all.
        </>
      ),
    },
    {
      q: 'What is the bond actually paying out, and how is the harm computed?',
      a: (
        <>
          A relay stakes CTC behind the promise &ldquo;you will not be sandwiched&rdquo;. When a victim brings
          three same-block transactions, the contract proves each one, asserts{' '}
          <span className="font-mono text-accent">front &lt; victim &lt; back</span>, then decodes the swap
          logs through Creditcoin&apos;s deployed <code className="text-primary-ink">EvmV1Decoder</code> and
          computes the searcher&apos;s <span className="text-hi">realized profit</span> — what the back-run
          took out minus what the front-run paid in. Here that is {view.ruling.harm} wei of the pool&apos;s
          numeraire, and the full amount was paid. Nothing is estimated from a price feed, because Attestcoin
          cannot attest one.
        </>
      ),
    },
    {
      q: 'Do I need a wallet, an API key or a .env file to see this work?',
      a: (
        <>
          No. <code className="text-primary-ink">npm install &amp;&amp; npm run dev</code> is the whole setup;
          the RPC endpoint is a public constant and no secret is read on any path. Wallet connection would only
          ever be garnish on top of a page that already works — never a gate in front of it. Reproducing the
          proof end to end (<code className="text-primary-ink">npm run prove</code>) does need a funded CC3
          testnet key, which is why the ruling it produced is committed here as transcripts and a receipt you
          can open on Blockscout instead.
        </>
      ),
    },
    {
      q: 'How much of the Attestcoin surface is this really using?',
      a: (
        <>
          The pipeline makes <span className="text-hi">36 distinct Attestcoin / USC-SDK surfaces</span>{' '}
          load-bearing, <span className="text-hi">24 of them undocumented</span>. To be precise about which
          ones a judge actually causes to run:{' '}
          <span className="text-accent">31 of the 36 execute on a clean, zero-flag default run</span>; the
          remaining 5 belong to the local proving path and execute under{' '}
          <code className="text-primary-ink">--kill-hosted</code>. The official-example baseline, for
          comparison, is 3 methods on 2 classes. The surface-by-surface table is in{' '}
          <code className="text-primary-ink">docs/PIPELINE.md</code>.
        </>
      ),
    },
    {
      q: 'What can this NOT do?',
      a: (
        <>
          Attestcoin proves transaction <span className="text-hi">history</span>, not{' '}
          <span className="text-hi">state</span>. There is no proof over{' '}
          <code className="text-primary-ink">eth_call</code>, storage slots or{' '}
          <code className="text-primary-ink">balanceOf</code>, and no on-chain batch verify — the interface
          exposes exactly <code className="text-primary-ink">verifyAndEmit</code> and{' '}
          <code className="text-primary-ink">calculateTxIndex</code>. Writing back to Ethereum does not exist.
          Every one of those limits shaped the design rather than being papered over.
        </>
      ),
    },
    {
      q: 'What does the ruling cost, and would it scale?',
      a: (
        <>
          One transaction: three <code className="text-primary-ink">verifyAndEmit</code> calls, three{' '}
          <code className="text-primary-ink">calculateTxIndex</code> reads, the ordering assertion and the
          payout, for {groupDigits(view.claim.gasUsed)} gas —{' '}
          <span className="text-accent">{view.claim.gasPercentOfCap}%</span> of the 75,000,000{' '}
          <code className="text-primary-ink">MAX_GAS_CAP</code>. A separate probe measured the structural part
          alone (3× verify + 3× index + assert + event) at 292,376 gas, 0.390% of the cap. The dominant cost is
          proof calldata, which is why the by-index batch endpoint — one continuity proof shared across all
          three legs instead of three copies — is the one the pipeline prefers.
        </>
      ),
    },
  ];

  return (
    <section id="faq" className="relative mx-auto max-w-[78rem] px-5 py-20 sm:px-8 sm:py-28">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <span className="eyebrow">Questions</span>
          <h2 className="mt-3 text-balance text-[clamp(1.9rem,4vw,3rem)] font-bold leading-[1.05] tracking-[-0.03em]">
            The ones a judge should ask.
          </h2>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-mid">
            Including the uncomfortable ones about the name, the surface count and what the protocol cannot do.
          </p>
        </div>

        <Accordion type="single" collapsible className="w-full border-t border-line">
          {items.map((item, i) => (
            <AccordionItem key={item.q} value={`q${i}`}>
              <AccordionTrigger>{item.q}</AccordionTrigger>
              <AccordionContent>{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
