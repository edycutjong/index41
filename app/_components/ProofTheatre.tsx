'use client';

/**
 * THE SIGNATURE MOMENT.
 *
 * Three rows of a real Ethereum mainnet block light in sequence, and every number that lights is
 * one this component was handed — never one it made up. `view.legs[i].index` is decoded from the
 * Attestcoin precompile's own `TransactionVerified` log inside a real Creditcoin receipt;
 * `view.legs[i].laterality` is the shape of that transaction's merkle authentication path as the
 * proof service returned it. This file's only job is to reveal them in the order a human can
 * follow, and to show the two agreeing.
 *
 * The animation is a reveal, not a computation. If you delete every timer here the same numbers
 * are still on the page, because they arrived with the props.
 */

import * as React from 'react';
import { ArrowRight, Check, ExternalLink, Play, RotateCcw, Zap } from 'lucide-react';

import { Badge } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { explorerTx, lateralitySteps, sourceBlockUrl, sourceTxUrl } from '@/app/_lib/chain';
import type { ProofView } from '@/app/_lib/proof';
import { cn, groupDigits, shortHash } from '@/app/_lib/utils';

// ---------------------------------------------------------------------------------------------
// The timeline. One flat list of beats so "where are we" is a single integer.
// ---------------------------------------------------------------------------------------------

type Beat =
  | { kind: 'scan'; leg: number }
  | { kind: 'bit'; leg: number; bit: number }
  | { kind: 'index'; leg: number }
  | { kind: 'assert' }
  | { kind: 'proven' }
  | { kind: 'paid' };

const MS: Record<Beat['kind'], number> = {
  scan: 420,
  bit: 90,
  index: 540,
  assert: 760,
  proven: 900,
  paid: 900,
};

function buildTimeline(legs: ProofView['legs']): Beat[] {
  const beats: Beat[] = [];
  legs.forEach((leg, i) => {
    beats.push({ kind: 'scan', leg: i });
    for (let bit = 0; bit < leg.laterality.length; bit += 1) beats.push({ kind: 'bit', leg: i, bit });
    beats.push({ kind: 'index', leg: i });
  });
  beats.push({ kind: 'assert' }, { kind: 'proven' }, { kind: 'paid' });
  return beats;
}

// ---------------------------------------------------------------------------------------------

/**
 * "Has this reader asked the machine to stop moving things?" is a fact about the browser, not
 * React state, so it is read through `useSyncExternalStore` and stays live if the OS setting
 * changes mid-visit. The server snapshot is `false`, matching a first paint that has not yet
 * animated anything.
 */
function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

export function ProofTheatre({ view }: { view: ProofView }) {
  const timeline = React.useMemo(() => buildTimeline(view.legs), [view.legs]);
  const total = timeline.length;

  const prefersReducedMotion = usePrefersReducedMotion();

  // `cursor` = how many beats have played. `total` means "everything is on screen".
  //
  // A reader who has asked for reduced motion is shown the finished ledger immediately — that is
  // derived from the media query, not assigned to state, so nothing has to re-render to reach it.
  // Pressing Play or Replay is an explicit request and overrides that from then on.
  const [rawCursor, setCursor] = React.useState(0);
  const [interacted, setInteracted] = React.useState(false);
  const cursor = prefersReducedMotion && !interacted ? total : rawCursor;
  const [running, setRunning] = React.useState(false);
  const startedOnce = React.useRef(false);

  const played = React.useCallback(
    (predicate: (b: Beat) => boolean) => timeline.slice(0, cursor).some(predicate),
    [timeline, cursor],
  );

  // Drive the timeline.
  React.useEffect(() => {
    if (!running || cursor >= total) return;
    const beat = timeline[cursor];
    if (!beat) return;
    const t = setTimeout(() => setCursor((c) => c + 1), MS[beat.kind]);
    return () => clearTimeout(t);
  }, [running, cursor, total, timeline]);

  // Autoplay once, when the ledger is actually on screen — and never for a reader who has asked
  // the machine to stop moving things.
  const ledgerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (prefersReducedMotion) {
      startedOnce.current = true;
      return;
    }
    const node = ledgerRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !startedOnce.current) {
            startedOnce.current = true;
            setRunning(true);
          }
        }
      },
      { threshold: 0.35 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [prefersReducedMotion]);

  const replay = () => {
    setInteracted(true);
    setCursor(0);
    setRunning(true);
    startedOnce.current = true;
  };
  const jumpToEnd = () => {
    setInteracted(true);
    setRunning(false);
    setCursor(total);
    startedOnce.current = true;
  };

  // Derived state — all of it a question about the cursor, none of it about the data.
  const legState = view.legs.map((leg, i) => {
    const scanned = played((b) => b.kind === 'scan' && b.leg === i);
    const bitsShown = timeline
      .slice(0, cursor)
      .filter((b): b is Extract<Beat, { kind: 'bit' }> => b.kind === 'bit' && b.leg === i).length;
    const proven = played((b) => b.kind === 'index' && b.leg === i);
    return { leg, scanned, bitsShown, proven };
  });

  const activeLeg = (() => {
    const beat = timeline[Math.min(cursor, total - 1)];
    if (beat && 'leg' in beat) return beat.leg;
    return view.legs.length - 1;
  })();

  const asserted = played((b) => b.kind === 'assert');
  const provenFired = played((b) => b.kind === 'proven');
  const paidFired = played((b) => b.kind === 'paid');

  const above = view.legs[0]?.index ?? 0;
  const below = Math.max(0, view.source.transactionCount - ((view.legs[2]?.index ?? 0) + 1));

  return (
    <div className="relative">
      {/* --- controls ---------------------------------------------------------------- */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="eyebrow hidden sm:inline">The block</span>
          <span className="hidden h-px w-8 bg-edge sm:inline-block" />
          <a
            href={sourceBlockUrl(view.source.blockNumber)}
            target="_blank"
            rel="noreferrer noopener"
            className="link-hash text-xs"
          >
            {view.source.chain} #{view.source.blockNumber}
          </a>
          <span className="font-mono text-[0.6875rem] text-low">
            {view.source.transactionCount} txs · merkle depth {view.source.merkleDepth}
          </span>
          <span className="font-mono text-[0.625rem] text-low sm:hidden">· swipe the ledger →</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="slate" onClick={replay} aria-label="Replay the proof sequence">
            {cursor === 0 || cursor >= total ? <Play className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
            {cursor >= total ? 'Replay' : 'Play'}
          </Button>
          <Button size="sm" variant="ghost" onClick={jumpToEnd}>
            <Zap className="h-3.5 w-3.5" />
            Skip
          </Button>
        </div>
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* --- the ledger ------------------------------------------------------------ */}
        <div ref={ledgerRef} className="plate gridfield flex flex-col overflow-hidden rounded-md">
          <div className="scroll-x flex-1">
            <div className="min-w-[34rem]">
              <div className="grid grid-cols-[6.5rem_1fr_10.5rem] gap-3 border-b border-line bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] px-4 py-2.5">
                <span className="eyebrow">Position</span>
                <span className="eyebrow">Transaction</span>
                <span className="eyebrow text-right">path → index</span>
              </div>

              <ElidedRows count={above} label="transactions above" />

              {legState.map(({ leg, scanned, bitsShown, proven }, i) => (
                <LedgerRow
                  key={leg.txHash}
                  leg={leg}
                  scanned={scanned}
                  bitsShown={bitsShown}
                  proven={proven}
                  isVictim={i === 1}
                  active={activeLeg === i && cursor < total}
                />
              ))}

              <ElidedRows count={below} label="transactions below" />
            </div>
          </div>

          {/* the ordering assertion — the sentence the whole contract exists to make */}
          <div
            className={cn(
              'mt-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-line px-4 py-4 transition-all duration-500',
              asserted ? 'bg-[color-mix(in_srgb,var(--accent)_7%,transparent)]' : 'bg-transparent',
            )}
          >
            <span
              className={cn(
                'font-mono text-lg font-bold tracking-[0.14em] transition-colors duration-500',
                asserted ? 'text-accent' : 'text-low',
              )}
            >
              {view.ruling.frontIndex} &lt; {view.ruling.victimIndex} &lt; {view.ruling.backIndex}
            </span>
            <span
              className={cn(
                'font-mono text-[0.6875rem] uppercase tracking-[0.16em] transition-colors duration-500',
                asserted ? 'text-hi' : 'text-low',
              )}
            >
              {asserted ? 'front-run before victim before back-run' : 'order not asserted yet'}
            </span>
            {asserted && <Check className="h-4 w-4 animate-land text-accent" aria-hidden />}
          </div>
        </div>

        {/* --- the decode ------------------------------------------------------------- */}
        <DecodePane
          leg={view.legs[activeLeg] ?? view.legs[0]!}
          bitsShown={legState[activeLeg]?.bitsShown ?? 0}
          proven={legState[activeLeg]?.proven ?? false}
        />
      </div>

      {/* --- the ruling ------------------------------------------------------------- */}
      <RulingConsole view={view} provenFired={provenFired} paidFired={paidFired} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function ElidedRows({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-2">
      <span className="font-mono text-[0.6875rem] leading-none text-low">⋮</span>
      <span className="font-mono text-[0.6875rem] text-low">
        {count} {label} — index41 never touches them
      </span>
    </div>
  );
}

function LedgerRow({
  leg,
  scanned,
  bitsShown,
  proven,
  isVictim,
  active,
}: {
  leg: ProofView['legs'][number];
  scanned: boolean;
  bitsShown: number;
  proven: boolean;
  isVictim: boolean;
  active: boolean;
}) {
  const bits = Array.from(leg.laterality);
  return (
    <div
      className={cn(
        'relative grid grid-cols-[6.5rem_1fr_10.5rem] items-center gap-3 border-b border-line px-4 py-3.5 transition-colors duration-500',
        isVictim && 'bg-[color-mix(in_srgb,var(--primary)_7%,transparent)]',
        proven && 'bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]',
      )}
    >
      {active && !proven && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-24 animate-sweep bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--accent)_22%,transparent),transparent)]"
        />
      )}

      {/* the index cell — slate and hollow until the chain has spoken */}
      <span className="index-cell text-base" data-state={proven ? 'proven' : 'claimed'}>
        {proven ? leg.index : '··'}
      </span>

      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span
            className={cn(
              'text-sm font-bold transition-colors duration-500',
              proven ? 'text-hi' : 'text-mid',
              isVictim && proven && 'text-accent',
            )}
          >
            {leg.label}
          </span>
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-low">{leg.role}</span>
        </span>
        <a
          href={sourceTxUrl(leg.txHash)}
          target="_blank"
          rel="noreferrer noopener"
          className="link-hash mt-1 inline-flex items-center gap-1 text-[0.6875rem]"
        >
          {shortHash(leg.txHash, 14, 10)}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </span>

      <span className="flex items-center justify-end gap-1" aria-label={`merkle path ${leg.laterality}`}>
        {bits.map((side, i) => {
          const shown = scanned && i < bitsShown;
          return (
            <span key={i} className="bit" data-lit={shown ? (side === 'L' ? '1' : '0') : undefined}>
              {shown ? side : '·'}
            </span>
          );
        })}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The decode pane — the leap, spelled out. Position is not attested; it is RECOVERED.
// ---------------------------------------------------------------------------------------------

function DecodePane({
  leg,
  bitsShown,
  proven,
}: {
  leg: ProofView['legs'][number];
  bitsShown: number;
  proven: boolean;
}) {
  const steps = React.useMemo(() => lateralitySteps(leg.laterality), [leg.laterality]);
  const shown = steps.slice(0, bitsShown);
  const running = shown.at(-1)?.runningTotal ?? 0;

  return (
    <div className="plate flex flex-col rounded-md p-5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="eyebrow">Laterality decode</span>
        <span className="font-mono text-[0.6875rem] text-low">{leg.role}</span>
      </div>
      <p className="mb-4 text-[0.8125rem] leading-relaxed text-mid">
        Walk the authentication path <span className="text-hi">leaf → root</span>. Each sibling says which side
        you were on. <span className="font-mono text-primary-ink">L</span> = sibling on the left, so this node
        was the right child, so the bit is <span className="font-mono text-accent">1</span>.
      </p>

      <div className="scroll-x -mx-1 mb-4 px-1">
        <table className="w-full border-collapse font-mono text-[0.6875rem]">
          <thead>
            <tr className="text-low">
              <th className="pb-1.5 text-left font-normal">depth</th>
              <th className="pb-1.5 text-left font-normal">sibling</th>
              <th className="pb-1.5 text-center font-normal">side</th>
              <th className="pb-1.5 text-right font-normal">bit·2^d</th>
              <th className="pb-1.5 text-right font-normal">Σ</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step, i) => {
              const on = i < bitsShown;
              const sibling = leg.siblings[i];
              return (
                <tr
                  key={step.depth}
                  className={cn('transition-opacity duration-300', on ? 'opacity-100' : 'opacity-25')}
                >
                  <td className="py-1 text-low">{step.depth}</td>
                  <td className="py-1 pr-2 text-primary-ink">{sibling ? shortHash(sibling.hash, 6, 4) : '—'}</td>
                  <td className={cn('py-1 text-center font-bold', step.side === 'L' ? 'text-accent' : 'text-low')}>
                    {on ? step.side : '·'}
                  </td>
                  <td className={cn('py-1 text-right', step.weight ? 'text-accent' : 'text-low')}>
                    {on ? (step.weight ? `+${step.weight}` : '+0') : '—'}
                  </td>
                  <td className="py-1 text-right text-hi">{on ? step.runningTotal : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-auto space-y-2.5">
        <div className="flex items-center justify-between gap-3 rounded-sm border border-line px-3 py-2">
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-low">path</span>
          <span className="font-mono text-sm font-bold tracking-[0.18em] text-primary-ink">
            {leg.laterality.slice(0, bitsShown).padEnd(leg.laterality.length, '·')}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-sm border border-line px-3 py-2">
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-low">
            = index (off-chain)
          </span>
          <span className="font-mono text-sm font-bold text-hi">{bitsShown ? running : '·'}</span>
        </div>
        <div
          className={cn(
            'flex items-center justify-between gap-3 rounded-sm border px-3 py-2 transition-all duration-500',
            proven ? 'border-accent/70 bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]' : 'border-line',
          )}
        >
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-low">
            precompile emitted
          </span>
          <span className={cn('font-mono text-sm font-bold', proven ? 'text-accent' : 'text-low')}>
            {proven ? leg.index : '·'}
          </span>
        </div>
        <p
          className={cn(
            'flex items-center gap-1.5 font-mono text-[0.6875rem] transition-opacity duration-500',
            proven && leg.agrees ? 'text-ok opacity-100' : 'opacity-0',
          )}
          aria-live="polite"
        >
          <Check className="h-3 w-3" aria-hidden />
          off-chain decode and on-chain emission agree
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function RulingConsole({
  view,
  provenFired,
  paidFired,
}: {
  view: ProofView;
  provenFired: boolean;
  paidFired: boolean;
}) {
  const { ruling, harmPaid, claim } = view;
  return (
    <div className="plate mt-4 overflow-hidden rounded-md">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="eyebrow">The ruling — logs of one Creditcoin transaction</span>
        <a
          href={explorerTx(claim.txHash)}
          target="_blank"
          rel="noreferrer noopener"
          className="link-hash inline-flex items-center gap-1 text-[0.6875rem]"
        >
          {shortHash(claim.txHash, 12, 8)} on Blockscout
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>

      <div className="scroll-x">
        <div className="min-w-[34rem] space-y-2 px-4 py-4 font-mono text-[0.78rem] leading-relaxed">
          {view.verified.map((v) => (
            <p key={v.logIndex} className="text-mid">
              <span className="text-low">log {v.logIndex} </span>
              <span className="text-primary-ink">TransactionVerified</span>
              <span className="text-low">(chainKey=</span>
              <span className="text-hi">{v.chainKey}</span>
              <span className="text-low">, height=</span>
              <span className="text-hi">{v.height}</span>
              <span className="text-low">, txIndex=</span>
              <span className="font-bold text-accent">{v.txIndex}</span>
              <span className="text-low">)</span>
            </p>
          ))}

          <p
            className={cn(
              'transition-all duration-700',
              provenFired ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
            )}
          >
            <span className="text-low">log {ruling.logIndex} </span>
            <span className="font-bold text-accent">SandwichProven</span>
            <span className="text-low">(</span>
            <span className="text-primary-ink">{shortHash(ruling.searcher, 8, 6)}</span>
            <span className="text-low">, </span>
            <span className="text-hi">{ruling.blockHeight}</span>
            <span className="text-low">, </span>
            <span className="font-bold text-accent">{ruling.frontIndex}</span>
            <span className="text-low">, </span>
            <span className="font-bold text-accent">{ruling.victimIndex}</span>
            <span className="text-low">, </span>
            <span className="font-bold text-accent">{ruling.backIndex}</span>
            <span className="text-low">, harm=</span>
            <span className="text-hi">{ruling.harm}</span>
            <span className="text-low">, paid=</span>
            <span className="text-hi">{ruling.paid}</span>
            <span className="text-low">)</span>
          </p>

          <p
            className={cn(
              'transition-all duration-700',
              paidFired ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
            )}
          >
            <span className="text-low">log {harmPaid.logIndex} </span>
            <span className="font-bold text-ok">HarmPaid</span>
            <span className="text-low">(victim=</span>
            <span className="text-primary-ink">{shortHash(harmPaid.victim, 8, 6)}</span>
            <span className="text-low">, relay=</span>
            <span className="text-primary-ink">{shortHash(harmPaid.relay, 8, 6)}</span>
            <span className="text-low">, </span>
            <span className="text-hi">{harmPaid.amount}</span>
            <span className="text-low">)</span>
          </p>
        </div>
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line px-4 py-4 transition-colors duration-700',
          paidFired ? 'bg-[color-mix(in_srgb,var(--color-success)_7%,transparent)]' : '',
        )}
      >
        <span className="flex items-center gap-2">
          <Badge tone={paidFired ? 'live' : 'quiet'}>bond → victim</Badge>
          <span className="font-mono text-sm font-bold text-hi">{groupDigits(Number(harmPaid.amount))}</span>
          <span className="font-mono text-[0.6875rem] text-low">
            wei of the numeraire, = the searcher&apos;s realized profit
          </span>
        </span>
        <span className="ml-auto flex items-center gap-2 font-mono text-[0.6875rem] text-low">
          gas <span className="font-bold text-hi">{groupDigits(claim.gasUsed)}</span>
          <ArrowRight className="h-3 w-3" aria-hidden />
          <span className="font-bold text-accent">{claim.gasPercentOfCap}%</span> of the 75,000,000 MAX_GAS_CAP
        </span>
      </div>
    </div>
  );
}
