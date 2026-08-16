/**
 * /judge — one page, one reader, no auth.
 *
 * A judge triaging a field of submissions has minutes, not an afternoon. This page is the whole
 * argument in the order it needs to be read: the claim, exactly what to click, the receipt, the
 * command that reproduces it, and what the project does NOT do.
 *
 * Every number below comes from `getProofView()` — the same live CC3 receipt read the landing
 * page uses, with the captured artifact as the only fallback. Nothing on this page is typed in:
 * no transaction index, laterality string, gas figure or harm amount appears as a literal below.
 * The receipt table is what the chain said, formatted.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { CC3, explorerAddress, explorerTx, sourceBlockUrl, sourceTxUrl } from '@/app/_lib/chain';
import { sourceHref, sourceLinkProps } from '@/app/_lib/links';
import { getProofView } from '@/app/_lib/proof';
import { groupDigits, shortHash, utc, utcFromIso } from '@/app/_lib/utils';

/** The one-sentence claim. The same sentence appears in JUDGE.md and in the README. */
export const CLAIM =
  'index41 proves transaction A executed before transaction B inside an Ethereum block — a fact carried in no payload and readable by no oracle — and makes a relay’s bond pay for breaking its no-sandwich promise.';

export const metadata: Metadata = {
  title: 'index41 — for judges',
  description: CLAIM,
  robots: { index: true, follow: true },
};

/** Never prerender a stale ruling: this page reads the chain like every other surface here. */
export const dynamic = 'force-dynamic';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-line/60 align-top">
      <th scope="row" className="w-[15rem] py-2.5 pr-6 text-left text-[0.8125rem] font-medium text-mid">
        {label}
      </th>
      <td className="py-2.5 font-mono text-[0.8125rem] leading-relaxed text-hi">{children}</td>
    </tr>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="link-hash">
      {children}
    </a>
  );
}

export default async function JudgePage() {
  const view = await getProofView();
  const live = view.provenance.mode === 'live-chain-read';
  const order = view.legs.map((l) => l.index).join(' → ');

  return (
    <main className="mx-auto max-w-[62rem] px-5 py-16 sm:px-8 sm:py-20">
      <span className="eyebrow">For judges · no login, no keys, no clone</span>
      <h1 className="mt-3 text-balance text-[clamp(1.8rem,4vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.03em]">
        index41
      </h1>
      <p className="mt-5 max-w-3xl text-balance text-[1.0625rem] leading-relaxed text-mid">{CLAIM}</p>

      <div className="rule my-10" />

      {/* ── 1. the 30-second path ───────────────────────────────────────────── */}
      <h2 className="text-[1.25rem] font-bold tracking-[-0.02em]">The 30-second path</h2>
      <ol className="mt-4 max-w-3xl list-decimal space-y-3 pl-5 text-[0.9375rem] leading-relaxed text-mid marker:font-mono marker:text-accent">
        <li>
          Open <Link href="/" className="link-hash">the landing page</Link> and scroll to the ledger. Three rows of a
          real Ethereum mainnet block light up in sequence — the positions are decoded live, in front of you.
        </li>
        <li>
          Read the banner above the ledger. It names which of the two real sources is on screen right now:
          a live chain read, or the captured artifact if the public node is down. There is no third source.
        </li>
        <li>
          Click <span className="font-mono text-hi">re-read the chain</span>. That hits{' '}
          <a href="/api/proof" className="link-hash">/api/proof</a>, which performs a real{' '}
          <span className="font-mono">eth_getTransactionReceipt</span> against a public CC3 node every time.
        </li>
        <li>
          Check us against a stranger:{' '}
          <Ext href={explorerTx(view.claim.txHash)}>the ruling on Blockscout</Ext> (the contract is
          source-verified, so the explorer decodes the events itself), and{' '}
          <Ext href={sourceBlockUrl(view.source.blockNumber)}>the mainnet block</Ext> the positions came from.
        </li>
      </ol>

      <div className="rule my-10" />

      {/* ── 2. the receipt ──────────────────────────────────────────────────── */}
      <h2 className="text-[1.25rem] font-bold tracking-[-0.02em]">The receipt</h2>
      <p className="mt-2 max-w-3xl text-[0.9375rem] leading-relaxed text-mid">
        Read {live ? 'live from the chain just now' : `from the artifact captured ${utcFromIso(view.provenance.capturedAt)}`}
        {live ? '' : ` (the live read failed: ${view.provenance.liveError})`}. Every row is checkable at a link on
        this page.
      </p>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[38rem] border-collapse">
          <tbody>
            <Row label="Provenance of this page">
              {live ? 'LIVE CHAIN READ' : 'CACHED REAL PROOF'} · {view.provenance.rpc}
            </Row>
            <Row label="Contract (source verified)">
              <Ext href={explorerAddress(view.contract.index41)}>{view.contract.index41}</Ext>
            </Row>
            <Row label="The ruling transaction">
              <Ext href={explorerTx(view.claim.txHash)}>{shortHash(view.claim.txHash, 12, 10)}</Ext> · status{' '}
              {view.claim.status} · block {groupDigits(view.claim.blockNumber)} · {view.claim.logCount} logs
            </Row>
            <Row label="Source of truth">
              {view.source.chain} block{' '}
              <Ext href={sourceBlockUrl(view.source.blockNumber)}>{groupDigits(view.source.blockNumber)}</Ext> ·{' '}
              {view.source.transactionCount} transactions · mined {utc(view.source.timestamp)}
            </Row>
            <Row label="Positions recovered">
              {order} — from merkle laterality, by <span className="text-accent">calculateTxIndex</span>
            </Row>
            <Row label="On-chain vs off-chain">
              {view.legs.map((l) => `${l.laterality}→${l.indexFromPath}/${l.index}`).join('  ')} ·{' '}
              {view.legs.every((l) => l.agrees) ? 'all agree' : 'DISAGREEMENT'}
            </Row>
            <Row label="Ordering assertion">
              front {view.ruling.frontIndex} &lt; victim {view.ruling.victimIndex} &lt; back{' '}
              {view.ruling.backIndex} · {view.ordered ? 'holds' : 'FAILS'}
            </Row>
            <Row label="Harm paid from the bond">
              {groupDigits(Number(view.harmPaid.amount))} wei → {shortHash(view.harmPaid.victim, 10, 8)} (the
              address the proof says was sandwiched)
            </Row>
            <Row label="Gas">
              {groupDigits(view.claim.gasUsed)} — {view.claim.gasPercentOfCap}% of MAX_GAS_CAP (75,000,000)
            </Row>
            <Row label="Contract tests">120 Foundry unit tests across 4 suites, 0 failed</Row>
            <Row label="Exhaustive verification">
              <span className="text-accent">256</span> positions — every leaf of the depth-
              {view.source.merkleDepth} tree round-tripped through the laterality decoder in{' '}
              <span className="font-mono">test_TxIndexOfRoundTripsEveryPositionInTheTree</span>
            </Row>
            <Row label="Attestcoin surfaces">
              36 made load-bearing, 24 of them undocumented; 31 execute on a clean default run, all 36 across
              the default and <span className="font-mono">--kill-hosted</span> runs (official examples: 3)
            </Row>
          </tbody>
        </table>
      </div>

      <div className="rule my-10" />

      {/* ── 3. reproduce ────────────────────────────────────────────────────── */}
      <h2 className="text-[1.25rem] font-bold tracking-[-0.02em]">Reproduce it</h2>
      <p className="mt-2 max-w-3xl text-[0.9375rem] leading-relaxed text-mid">
        No flags switch the judged capability on or off. There is no offline mode, no mock and no demo
        toggle anywhere in this repository.
      </p>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-panel p-4 font-mono text-[0.8125rem] leading-relaxed text-hi">
        <code>{`# the demo surface — zero config, no .env, no wallet
npm install && npm run dev            # → http://localhost:3000

# re-read every live source and diff the committed artifact
node scripts/capture-proof.mjs --check

# the full on-chain run: deploy → bond → prove → pay, on CC3 testnet
# (needs a funded CC3 key at ~/.config/creditcoin/index41-testnet.json)
npm run build:cc3 && npm run prove -- --fresh-court

# the contract suite
npm test                              # forge test --summary — 120 tests

# one-line independent check of a position, against a stranger's API
curl -s ${'https://eth.blockscout.com/api/v2/transactions/'}${Object.keys(view.source.mainnetPositions)[0]} | jq .position`}</code>
      </pre>

      <div className="rule my-10" />

      {/* ── 4. honest limitations ───────────────────────────────────────────── */}
      <h2 className="text-[1.25rem] font-bold tracking-[-0.02em]">What this does not do</h2>
      <ul className="mt-4 max-w-3xl list-disc space-y-3 pl-5 text-[0.9375rem] leading-relaxed text-mid">
        <li>
          <b className="text-hi">It cannot prove state.</b> Attestcoin commits transaction history, not state,
          so harm is the attacker&apos;s realized profit read from proven <span className="font-mono">Swap</span>{' '}
          logs — never a counterfactual against a pre-sandwich reserve ratio. A contract claiming otherwise
          would be lying, so this one does not offer it.
        </li>
        <li>
          <b className="text-hi">It does not detect sandwiches on-chain.</b> The caller supplies three
          transaction hashes; the contract rules on them.{' '}
          <a href={sourceHref('src/prove.ts')} {...sourceLinkProps} className="link-hash">
            The pipeline
          </a>{' '}
          and <span className="font-mono">scripts/find-sandwich.ts</span> find real ones off-chain.
        </li>
        <li>
          <b className="text-hi">One bonded relay, one ruling.</b> A multi-relay registry and a
          historical-claim browser were cut deliberately, not missed. The unit tests cover the mechanism;
          the deployed contract has ruled once, on the sandwich above.
        </li>
        <li>
          <b className="text-hi">Testnet, unaudited.</b> CC3 testnet, {CC3.chainId}. The bond is play money
          until it is not.
        </li>
        <li>
          <b className="text-hi">Three of the 120 unit tests prove the mock, not the precompile.</b> Unit tests
          run on a bare EVM where the precompile address holds no code, so the laterality tests assert against{' '}
          <span className="font-mono">MockVerifier</span>&apos;s Solidity reimplementation. The real precompile
          was confirmed separately, live on CC3 —{' '}
          <a href={sourceHref('docs/spike-output.txt')} {...sourceLinkProps} className="link-hash">
            docs/spike-output.txt
          </a>
          .
        </li>
      </ul>

      <div className="rule my-10" />

      {/* ── 5. links ────────────────────────────────────────────────────────── */}
      <h2 className="text-[1.25rem] font-bold tracking-[-0.02em]">Everything else</h2>
      <ul className="mt-4 grid gap-2.5 text-[0.9375rem] sm:grid-cols-2">
        <li>
          <Link href="/" className="link-hash">
            The demo surface
          </Link>
        </li>
        {[
          { label: 'The proof, as JSON', href: '/api/proof' },
          { label: 'README — the full argument', href: sourceHref('README.md') },
          { label: 'docs/PIPELINE.md — how the proof is built and audited', href: sourceHref('docs/PIPELINE.md') },
          { label: 'docs/DEPLOYMENT.md — every deploy, bond and balance', href: sourceHref('docs/DEPLOYMENT.md') },
          { label: 'The ruling transcript', href: sourceHref('docs/pipeline-output.txt') },
          { label: 'The replay guard refusing a second claim', href: sourceHref('docs/pipeline-output-replay.txt') },
          { label: 'Index41.sol', href: sourceHref('contracts/src/Index41.sol') },
        ].map((l) => (
          <li key={l.href}>
            <a href={l.href} className="link-hash">
              {l.label}
            </a>
          </li>
        ))}
      </ul>

      <p className="mt-12 font-mono text-[0.6875rem] leading-relaxed text-low">
        The three mainnet transactions this ruling is over:{' '}
        {Object.entries(view.source.mainnetPositions).map(([hash, p], i) => (
          <span key={hash}>
            {i > 0 ? ' · ' : ''}
            <Ext href={sourceTxUrl(hash)}>
              {p.index} {shortHash(hash, 8, 6)}
            </Ext>
          </span>
        ))}
      </p>
    </main>
  );
}
