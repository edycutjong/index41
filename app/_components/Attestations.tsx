/**
 * Element 8, honestly.
 *
 * A hackathon project three days old has no customers, and inventing six smiling quotes would be
 * the same lie as inventing the indices. So this section quotes the only witnesses that exist —
 * the precompile, the proof service, the replay guard, the local prover and the test runner —
 * verbatim, each with the file the line was copied out of. A judge can `cat` any of them.
 */

import { FileText } from 'lucide-react';

import { type EvidencePath, sourceHref, sourceLinkProps } from '@/app/_lib/links';
import type { ProofView } from '@/app/_lib/proof';

export function Attestations({ view }: { view: ProofView }) {
  const quotes: Array<{ quote: string; who: string; where: string; file?: EvidencePath }> = [
    {
      quote: `TransactionVerified(chainKey=${view.verified[1]?.chainKey ?? 3}, height=${
        view.verified[1]?.height ?? view.ruling.blockHeight
      }, txIndex=${view.verified[1]?.txIndex ?? view.ruling.victimIndex})`,
      who: `the Attestcoin verifier precompile, in log ${view.verified[1]?.logIndex ?? 1} of CC3 transaction ${view.claim.txHash.slice(0, 12)}…`,
      where: 'data/proof-artifact.json → verifiedLogs',
      file: 'data/proof-artifact.json',
    },
    {
      quote: 'front-run  RLLLRRRR  →   14   merkle ok · leaf matches mainnet · 3520 bytes',
      who: 'the audit step, refusing to take the prover at its word',
      where: 'docs/pipeline-output.txt',
      file: 'docs/pipeline-output.txt',
    },
    {
      quote:
        'HTTP 422 BlockNotReady: The continuity proof cannot be created because block 25765103 is not attested to yet. Last attested block: 25765100',
      who: 'the proof service, asked for a height it could not possibly serve',
      where: 'docs/pipeline-output.txt — the payload the adaptive poller reads',
      file: 'docs/pipeline-output.txt',
    },
    {
      quote:
        'In the --kill-hosted run, source 3 reproduced the hosted merkle root 0x362ca563…76c16 and the same 60-root continuity proof exactly.',
      who: 'the local prover, with the proof service switched off entirely',
      where: 'docs/PIPELINE.md',
      file: 'docs/PIPELINE.md',
    },
    {
      quote:
        'This court ruled on this exact sandwich at unix 1786853490: harm 219708, paid 219708. The replay guard is doing its job.',
      who: 'the contract, refusing to pay for the same sandwich twice',
      where: 'docs/pipeline-output-replay.txt',
      file: 'docs/pipeline-output-replay.txt',
    },
    {
      quote:
        'blocks 100 fetched / 203 cached · transactions 1 fetched / 722 cached (20,983 back-filled from blocks) · 925 mainnet round-trips avoided',
      who: 'CachingBlockProvider, measured on the no-proof-service run',
      where: 'docs/PIPELINE.md',
      file: 'docs/PIPELINE.md',
    },
  ];

  return (
    <section id="evidence" className="relative mx-auto max-w-[78rem] px-5 py-20 sm:px-8 sm:py-28">
      <div className="mb-11 max-w-3xl">
        <span className="eyebrow">Attestations</span>
        <h2 className="mt-3 text-balance text-[clamp(1.9rem,4vw,3rem)] font-bold leading-[1.05] tracking-[-0.03em]">
          No testimonials. <span className="text-primary-ink">Witnesses.</span>
        </h2>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-mid">
          This project is days old and has no users to quote. Rather than invent some, here are the machines
          that checked it, quoted exactly, each with the file the line came out of.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {quotes.map((q) => (
          <figure
            key={q.quote}
            className="plate group relative flex flex-col rounded-md p-6 transition-transform duration-300 hover:-translate-y-1"
          >
            <span
              aria-hidden
              className="absolute right-5 top-3 select-none font-mono text-5xl leading-none text-[color-mix(in_srgb,var(--primary)_22%,transparent)] transition-colors duration-300 group-hover:text-[color-mix(in_srgb,var(--accent)_30%,transparent)]"
            >
              &ldquo;
            </span>
            <blockquote className="scroll-x relative z-10 pr-6">
              <p className="whitespace-pre-wrap break-words font-mono text-[0.8125rem] leading-relaxed text-hi">
                {q.quote}
              </p>
            </blockquote>
            <figcaption className="mt-auto pt-5">
              <p className="text-[0.8125rem] font-bold leading-snug text-primary-ink">{q.who}</p>
              {q.file ? (
                <a
                  href={sourceHref(q.file)}
                  {...sourceLinkProps}
                  className="mt-1.5 flex items-start gap-1.5 font-mono text-[0.625rem] leading-snug text-low transition-colors hover:text-accent"
                >
                  <FileText className="mt-px h-3 w-3 shrink-0" aria-hidden />
                  {q.where}
                </a>
              ) : (
                <p className="mt-1.5 flex items-start gap-1.5 font-mono text-[0.625rem] leading-snug text-low">
                  <FileText className="mt-px h-3 w-3 shrink-0" aria-hidden />
                  {q.where}
                </p>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
