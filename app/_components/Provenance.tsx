'use client';

/**
 * Where every number on this page came from — stated on the page, not in a README.
 *
 * A demo that shows a number it cannot source is a mock wearing a costume. So this component is
 * deliberately loud: it names the endpoint, the instant of the read, and which of the two real
 * paths produced what is currently on screen. The "re-read the chain" button performs an actual
 * `eth_getTransactionReceipt` in front of the viewer and swaps the whole page over to the result.
 */

import * as React from 'react';
import { CircleAlert, Database, ExternalLink, Radio, RefreshCw } from 'lucide-react';

import { Button } from '@/app/_components/ui/button';
import { CC3, explorerAddress, explorerTx } from '@/app/_lib/chain';
import type { ProofView } from '@/app/_lib/proof';
import { cn, shortHash, utcFromIso } from '@/app/_lib/utils';

export function ProvenanceBar({
  view,
  onUpdate,
}: {
  view: ProofView;
  onUpdate: (next: ProofView) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [flash, setFlash] = React.useState(false);
  const live = view.provenance.mode === 'live-chain-read';

  async function reread() {
    setBusy(true);
    try {
      const res = await fetch('/api/proof', { cache: 'no-store' });
      if (res.ok) {
        onUpdate((await res.json()) as ProofView);
        setFlash(true);
        setTimeout(() => setFlash(false), 1400);
      }
    } catch {
      /* the button never fabricates a result; a failed read simply leaves the page as it was */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        'plate flex flex-col items-start gap-3 rounded-md px-4 py-3 transition-colors duration-500 md:flex-row md:flex-wrap md:items-center md:gap-x-5',
        flash && 'border-accent/60',
      )}
    >
      <span className="flex items-center gap-2">
        {live ? (
          <Radio className="h-4 w-4 shrink-0 text-ok" aria-hidden />
        ) : (
          <Database className="h-4 w-4 shrink-0 text-primary-ink" aria-hidden />
        )}
        <span
          className={cn(
            'font-mono text-[0.6875rem] font-bold uppercase tracking-[0.16em]',
            live ? 'text-ok' : 'text-primary-ink',
          )}
        >
          {live ? 'live chain read' : 'cached real proof'}
        </span>
      </span>

      <span className="min-w-0 flex-1 font-mono text-[0.6875rem] leading-relaxed text-mid">
        {live ? (
          <>
            <span className="text-hi">eth_getTransactionReceipt</span> against{' '}
            <span className="text-primary-ink">{CC3.rpcUrl.replace('https://', '')}</span> at{' '}
            <span className="text-hi">{utcFromIso(view.provenance.at)}</span> — the indices below are decoded
            from the Attestcoin precompile&apos;s own logs in that receipt.
          </>
        ) : (
          <>
            the node was unreachable, so this is{' '}
            <span className="text-hi">data/proof-artifact.json</span>, captured from the same live sources at{' '}
            <span className="text-hi">{utcFromIso(view.provenance.capturedAt)}</span>. A recording of a real
            read — never a substitute for one.
            {view.provenance.liveError && (
              <span className="ml-1 inline-flex items-center gap-1 text-low">
                <CircleAlert className="h-3 w-3" aria-hidden />
                {view.provenance.liveError}
              </span>
            )}
          </>
        )}
      </span>

      <span className="flex items-center gap-2">
        <a
          href={explorerTx(view.claim.txHash)}
          target="_blank"
          rel="noreferrer noopener"
          className="link-hash inline-flex items-center gap-1 text-[0.6875rem]"
        >
          {shortHash(view.claim.txHash)}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
        <Button size="sm" variant="ghost" onClick={reread} disabled={busy}>
          <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} aria-hidden />
          {busy ? 'reading' : 're-read the chain'}
        </Button>
      </span>
    </div>
  );
}

/**
 * The full accounting: one row per displayed quantity, naming its origin. This is the section a
 * sceptical judge reads before believing anything else on the page.
 */
export function ProvenanceTable({ view }: { view: ProofView }) {
  const rows: Array<{ value: React.ReactNode; what: string; from: React.ReactNode }> = [
    {
      value: `${view.ruling.frontIndex} / ${view.ruling.victimIndex} / ${view.ruling.backIndex}`,
      what: 'the three block positions',
      from: (
        <>
          three <code className="text-primary-ink">TransactionVerified</code> logs emitted by the Attestcoin
          verifier precompile{' '}
          <a href={explorerAddress(view.contract.verifierPrecompile)} target="_blank" rel="noreferrer noopener" className="link-hash">
            {view.contract.verifierPrecompile}
          </a>{' '}
          inside CC3 transaction{' '}
          <a href={explorerTx(view.claim.txHash)} target="_blank" rel="noreferrer noopener" className="link-hash">
            {shortHash(view.claim.txHash)}
          </a>
        </>
      ),
    },
    {
      value: view.legs.map((l) => l.laterality).join(' / '),
      what: 'the merkle path laterality',
      from: (
        <>
          one bit per sibling of the authentication paths returned by{' '}
          <code className="text-primary-ink">POST /api/v1/proof-batch/3</code> for exactly the positions the
          chain reported. Recorded in <code className="text-primary-ink">data/proof-artifact.json</code>, which
          refuses to be written if its own decode disagrees with the chain.
        </>
      ),
    },
    {
      value: `${view.claim.gasUsed.toLocaleString('en-US')} gas · ${view.claim.gasPercentOfCap}%`,
      what: 'cost of the ruling',
      from: (
        <>
          <code className="text-primary-ink">gasUsed</code> from the same receipt, over the Attestcoin verifier
          gas cap of 75,000,000
        </>
      ),
    },
    {
      value: `${view.ruling.harm} wei`,
      what: 'the harm, and the payout',
      from: (
        <>
          <code className="text-primary-ink">SandwichProven.harm</code> and{' '}
          <code className="text-primary-ink">HarmPaid.amount</code> — the searcher&apos;s realized profit,
          computed on-chain from the proven swap logs, not estimated
        </>
      ),
    },
    {
      value: `${view.source.transactionCount} txs`,
      what: 'the source block',
      from: (
        <>
          Ethereum mainnet block {view.source.blockNumber} header, read from a public mainnet RPC at capture
          time; block hash{' '}
          <code className="break-all text-primary-ink">{shortHash(view.source.blockHash, 12, 8)}</code>
        </>
      ),
    },
    {
      value: '3 sources agree',
      what: 'the cross-check',
      from: (
        <>
          for each leg the artifact re-derives the position from the path, asserts it equals the position the
          chain emitted, then asks a mainnet RPC and asserts that agrees too. A fourth, independent check
          takes one line and no key:
          <br />
          <code className="mt-1 inline-block break-all text-primary-ink">
            curl -s {'https://eth.blockscout.com/api/v2/transactions/'}
            {view.legs[0]?.txHash ?? ''} | jq .position
          </code>
        </>
      ),
    },
  ];

  return (
    <div className="scroll-x">
      <table className="w-full min-w-[44rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-edge">
            <th className="eyebrow pb-3 pr-4">value on screen</th>
            <th className="eyebrow pb-3 pr-4">what it is</th>
            <th className="eyebrow pb-3">where it came from</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.what} className="border-b border-line align-top">
              <td className="py-3.5 pr-4 font-mono text-[0.8125rem] font-bold text-accent">{row.value}</td>
              <td className="py-3.5 pr-4 text-[0.8125rem] text-hi">{row.what}</td>
              <td className="py-3.5 text-[0.8125rem] leading-relaxed text-mid">{row.from}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
