'use client';

/**
 * Element 11 — and the home of the ONE optional wallet affordance on the whole site.
 *
 * "Add CC3 testnet" appears only if an injected provider already exists, does nothing on load,
 * and is not required by any other part of the page. The default path never touches it.
 */

import * as React from 'react';
import { Check, Wallet } from 'lucide-react';

import { Button } from '@/app/_components/ui/button';
import { CC3, explorerAddress } from '@/app/_lib/chain';
import { REPO_URL, sourceHref, sourceLinkProps } from '@/app/_lib/links';
import type { ProofView } from '@/app/_lib/proof';
import { shortHash, utcFromIso } from '@/app/_lib/utils';

interface InjectedProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export function Footer({ view }: { view: ProofView }) {
  const [wallet, setWallet] = React.useState<'absent' | 'idle' | 'busy' | 'added'>('absent');

  React.useEffect(() => {
    const injected = (window as unknown as { ethereum?: InjectedProvider }).ethereum;
    if (injected) setWallet('idle');
  }, []);

  async function addChain() {
    const injected = (window as unknown as { ethereum?: InjectedProvider }).ethereum;
    if (!injected) return;
    setWallet('busy');
    try {
      await injected.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: `0x${CC3.chainId.toString(16)}`,
            chainName: CC3.name,
            nativeCurrency: { name: 'Creditcoin', symbol: 'CTC', decimals: 18 },
            rpcUrls: [CC3.rpcUrl],
            blockExplorerUrls: [CC3.explorer],
          },
        ],
      });
      setWallet('added');
    } catch {
      setWallet('idle');
    }
  }

  const columns: Array<{
    heading: string;
    links: Array<{ label: string; href: string; mono?: boolean; external?: boolean }>;
  }> = [
    {
      heading: 'On chain',
      links: [
        {
          label: `Index41 ${shortHash(view.contract.index41, 8, 6)}`,
          href: explorerAddress(view.contract.index41),
          mono: true,
          external: true,
        },
        {
          label: `Verifier precompile ${shortHash(view.contract.verifierPrecompile, 8, 6)}`,
          href: explorerAddress(view.contract.verifierPrecompile),
          mono: true,
          external: true,
        },
        {
          label: `EvmV1Decoder ${shortHash(view.contract.evmV1Decoder, 8, 6)}`,
          href: explorerAddress(view.contract.evmV1Decoder),
          mono: true,
          external: true,
        },
        { label: 'Blockscout explorer', href: CC3.explorer, external: true },
      ],
    },
    {
      heading: 'The evidence',
      links: [
        { label: 'The ruling transcript', href: sourceHref('docs/pipeline-output.txt') },
        { label: 'No proof service at all', href: sourceHref('docs/pipeline-output-local-prover.txt') },
        { label: 'The replay guard refusing', href: sourceHref('docs/pipeline-output-replay.txt') },
        { label: 'The proof artifact', href: sourceHref('data/proof-artifact.json') },
      ],
    },
    {
      heading: 'The build',
      links: [
        { label: 'The pipeline, step by step', href: sourceHref('docs/PIPELINE.md') },
        { label: 'Deployment record', href: sourceHref('docs/DEPLOYMENT.md') },
        { label: 'Index41.sol', href: sourceHref('contracts/src/Index41.sol') },
        { label: 'capture-proof.mjs — how this page gets its data', href: sourceHref('scripts/capture-proof.mjs') },
      ],
    },
  ];

  return (
    <footer className="relative border-t border-line bg-[color-mix(in_srgb,var(--bg-panel)_70%,var(--bg-base))]">
      <div className="mx-auto max-w-[78rem] px-5 py-16 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="" width={28} height={28} className="rounded-[6px]" />
              <span className="font-mono text-sm font-bold tracking-[0.06em] text-hi">
                index<span className="text-accent">41</span>
              </span>
            </div>
            <p className="mt-4 max-w-xs text-[0.875rem] leading-relaxed text-mid">
              Proves transaction A executed before transaction B inside an Ethereum block, on Creditcoin, by
              recovering each position from the laterality of its merkle authentication path.
            </p>
            <p className="mt-5 font-mono text-[0.625rem] leading-relaxed text-low">
              {CC3.name} · chain {CC3.chainId}
              <br />
              proof artifact captured {utcFromIso(view.provenance.capturedAt)}
            </p>

            <div className="mt-5">
              {wallet === 'absent' ? (
                <p className="font-mono text-[0.625rem] leading-relaxed text-low">
                  No wallet detected — and none is needed. Everything above was read from a public node.
                </p>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={addChain} disabled={wallet === 'busy'}>
                    {wallet === 'added' ? (
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <Wallet className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {wallet === 'added' ? 'CC3 testnet added' : 'Add CC3 testnet'}
                  </Button>
                  <p className="mt-2 font-mono text-[0.625rem] leading-relaxed text-low">
                    Entirely optional. Nothing on this page requires it.
                  </p>
                </>
              )}
            </div>
          </div>

          {columns.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h3 className="eyebrow">{col.heading}</h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(link.external ? { target: '_blank', rel: 'noreferrer noopener' } : sourceLinkProps)}
                      className={`text-[0.8125rem] leading-snug text-mid transition-colors hover:text-accent ${
                        link.mono ? 'font-mono text-[0.6875rem]' : ''
                      }`}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="rule my-10" />

        <div className="flex flex-wrap items-center justify-between gap-4 font-mono text-[0.625rem] text-low">
          <span>
            index41 · built for BUIDL CTC 2026 Fall, DeFi track ·{' '}
            <a href={sourceHref('LICENSE')} {...sourceLinkProps} className="link-hash">
              MIT licence
            </a>
            {REPO_URL ? '' : ' · repository goes public at submission'}
          </span>
          <span>
            Testnet software. Not audited, not financial advice, and the bond is play money until it is not.
          </span>
        </div>
      </div>
    </footer>
  );
}
