<p align="center">
  <img src="docs/assets/readme-hero-animated.svg" alt="index41 — The instant laterality decodes, three slate transactions lock into gold indices 41 → 42 → 43 — position becomes fact." width="100%">
</p>

<h1 align="center">index41</h1>

<p align="center"><b>Proves transaction A executed <i>before</i> B inside an Ethereum block — a fact carried in no payload, readable by no oracle — and makes a relay's bond pay for breaking its no-sandwich promise.</b></p>

<p align="center">
  <img src="docs/assets/icon-animated.svg" alt="index41 — The instant laterality decodes, three slate transactions lock into gold indices 41 → 42 → 43 — position becomes fact." width="96">
</p>

<p align="center">Built for BUIDL CTC 2026 Fall (DoraHacks) · DeFi track</p>

<p align="center">
  <b>Judging this?</b> <a href="JUDGE.md">JUDGE.md</a> is the whole argument in reading order —
  the claim, a 30-second click path, the receipt, the reproduce command and the honest
  limitations. The live version of that page is <code>/judge</code>, and it renders its numbers
  from a chain read rather than from the file.
</p>

---

## The mechanism

A private-RPC or relay service posts a CTC bond on Creditcoin behind a public promise: *route
through us and you will not be sandwiched.* A user who gets sandwiched anyway submits three
Ethereum transaction hashes from the same block. `Index41.proveSandwich` then:

1. **Verifies** each of the three transactions with `INativeQueryVerifier.verifyAndEmit(...)` —
   three sequential calls in one Creditcoin transaction, sharing one continuity proof.
2. **Recovers each transaction's ordinal position inside its block** by calling
   `INativeQueryVerifier.calculateTxIndex(merkleProof)` — a free `view` that decodes position out
   of the left/right laterality of the merkle authentication path. Every sibling on the path is one
   bit; the position is the shape of the proof, not a claimed field.
3. **Asserts the sandwich shape**: `frontRunIndex < victimIndex < backRunIndex`, the same pool as
   `to` on all three, the same searcher as sender on the outer two, and a higher priority fee on
   the front-run.
4. **Computes harm** as the attacker's *realized profit* — front-run `amountIn` versus back-run
   `amountOut`, both read from `Swap` logs that are inside the proof. Never a counterfactual against
   a pre-sandwich reserve ratio: Attestcoin commits transaction history, not state, so there is no
   state to counterfactually compare against, and a contract that claimed otherwise would be lying.
5. **Pays the victim** from the relay's bond and marks the claim `processedQueries` so the same
   sandwich cannot be claimed twice.

Ordering is not in any payload. A transaction does not carry "I was 15th"; no oracle reports it; no
`eth_call` can be proven for it. The merkle authentication path *is* the position — that is the
entire foundation of this contract, and it is the one thing nothing else here can do.

## Live on CC3 testnet

A real Ethereum **mainnet** sandwich, ruled on by a bonded contract on Creditcoin. Open any of
these — the contract is source-verified, so Blockscout decodes the calls and events itself.

| | |
|---|---|
| Index41 (source verified) | [`0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2`](https://creditcoin-testnet.blockscout.com/address/0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2) |
| The ruling — 3× `verifyAndEmit` in one transaction | [`0xd136dea0…d243810`](https://creditcoin-testnet.blockscout.com/tx/0xd136dea0524b7e0e9eba54bf9724eec78597c2598047a96849af727f4d243810) |
| Mainnet block / recovered positions | `25764741` · **14 → 15 → 16**, read out of merkle laterality by `calculateTxIndex` |
| Harm paid from the bond | `219708` wei, to the address the *proof* says was sandwiched |
| Gas | 1,092,100 — **1.456%** of `MAX_GAS_CAP` (75,000,000) |

Deploy tx, bond tx, before/after balances and every explorer link, including the three real mainnet
transactions the ruling is over: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
How the proof pipeline is built, audited, and made prover-independent:
[`docs/PIPELINE.md`](docs/PIPELINE.md).

## Architecture

```
contracts/src/
  Index41.sol             the court — bonding, coverage, proveSandwich, harm accounting, payout
  OrderProbe.sol           the day-one spike: does calculateTxIndex really recover position,
                            do 3x verifyAndEmit fit in one tx under MAX_GAS_CAP — before any
                            product code existed
  interfaces/
    INativeQueryVerifier.sol   the precompile interface, exactly as Creditcoin ships it
  base/
    USCBase.sol             shared USC-SDK plumbing (kept unmodified from the vendored source)

contracts/test/            120 Foundry unit tests, 4 suites (below)

src/                        the TypeScript proving pipeline (npm run prove)
  prove.ts                  entrypoint — resolves the block, waits for attestation, fetches
                             proofs, audits them, decodes, dry-runs, submits, reads back the ruling
  proof-sources.ts           three interchangeable proof sources behind one interface
  caching-block-provider.ts  wraps the SDK's SimpleBlockProvider, back-fills from already-fetched
                             blocks — ~925 mainnet round-trips avoided on a --kill-hosted run
  audit.ts                   never trusts a proof source: re-encodes, re-folds, chains continuity
                             to an on-chain checkpoint before any gas is spent
  claim.ts                   builds the on-chain claim struct, budgets gas, submits, parses events
  court.ts, eth.ts, config.ts, prover-api.ts, artifacts.ts, log.ts   supporting plumbing

scripts/
  spike.ts                   the day-one live-network spike (docs/spike-output.txt)
  find-sandwich.ts            scans real Ethereum mainnet blocks for MEV sandwiches to feed in

data/sandwich-25764741.json  the recorded real mainnet sandwich this repo's default run proves
data/proof-artifact.json     the ruling, captured from live sources by scripts/capture-proof.mjs

app/                        the demo surface (Next.js 16, App Router, Tailwind + ShadCN)
  page.tsx                  server component — reads the ruling off CC3 before the first paint
  judge/page.tsx            /judge — the claim, the click path, the receipt, the limitations
  _lib/chain.ts             plain JSON-RPC + receipt decoding; no SDK, no wallet, no secret
  _lib/proof.ts             live read, with the captured artifact as the only fallback
  _components/ProofTheatre.tsx  the ledger: three rows of block 25764741 lighting in sequence
  api/proof/route.ts        re-reads the chain on demand, behind the page's own button
  evidence/[...path]/route.ts    allowlisted read-only view of the files the claim rests on

e2e/                        48 Playwright tests — invariants, never literal indices
  zero-config.spec.ts        loads with no env, no wallet, no console errors; names its source
  proof-flow.spec.ts         the two decodes agree · front < victim < back · paid == computed
  judge-route.spec.ts        /judge is 200 with no credentials, and carries a real receipt
  responsive.spec.ts         375 / 768 / 1440 — no horizontal scroll on either page

.github/workflows/          6-stage CI: contracts · app · secrets · build · E2E · performance

scripts/capture-proof.mjs    freezes the ruling into data/proof-artifact.json — and refuses to
                              write one whose own decode disagrees with the chain
```

## The demo surface

```bash
npm install
npm run dev                    # http://localhost:3000 — no .env, no wallet, no API key
                               # /judge — the same evidence, written for one reader
```

The page shows three rows of Ethereum mainnet block `25764741` lighting up in sequence —
**14 searcher buy · 15 the victim · 16 searcher sell** — then `SandwichProven` and the bond paying
out. **Those indices are not written anywhere in the web code.** They are decoded, on every page
load, from the three `TransactionVerified` logs the Attestcoin precompile itself wrote inside the
receipt of CC3 transaction [`0xd136dea0…d243810`](https://creditcoin-testnet.blockscout.com/tx/0xd136dea0524b7e0e9eba54bf9724eec78597c2598047a96849af727f4d243810).
A banner above the ledger states which of the two real sources is on screen — a **live chain read**,
or the **captured artifact** if the public node is unreachable — and there is no third source.

Alongside each index the page shows the laterality decode that produced it (`RLLLRRRR → 14`), the
real sibling hashes it was folded from, and the position the precompile emitted, so the off-chain
and on-chain answers can be seen agreeing rather than asserted to agree.

```bash
node scripts/capture-proof.mjs --check   # re-read every live source, diff the committed artifact
```

Every explorer link on the page resolves: Creditcoin links to Blockscout, Ethereum mainnet links to
`eth.blockscout.com`, which also serves the position over its API for a one-line independent check:

```bash
curl -s https://eth.blockscout.com/api/v2/transactions/0xec3777f9d0e55d03b9caa3a4b8a786dd62e16eeb327a9f1c45dfbc79af618436 | jq .position
# 14
```

## Why only Attestcoin — the SDK is the engine

The official SDK examples touch **3 methods on 2 classes**
(`ProofBuilder` constructor → `waitUntilHeightAttested` → `getProof`, plus
`getLatestAttestedHeightAndHash`). This pipeline makes **36 distinct Attestcoin/USC-SDK surfaces
load-bearing, 24 of them undocumented** (absent from docs.creditcoin.org) — 31 execute on a clean
default run, all 36 across the default and `--kill-hosted` runs. Full surface-by-surface table,
with what each one is load-bearing *for*: [`docs/PIPELINE.md`](docs/PIPELINE.md#attestcoin-surfaces-this-pipeline-makes-load-bearing).

The headline surface is `INativeQueryVerifier.calculateTxIndex` — undocumented, and the only
on-chain call in the entire Attestcoin surface area that answers the question this product asks:
*what position was this transaction at?* Everything else in the pipeline exists to get three
mainnet transactions into a state where that one call can be trusted: proof fetched from an
interchangeable source, independently re-encoded and re-folded against the claimed root, and the
continuity proof chained to an on-chain checkpoint before a single unit of gas is spent on the
claim itself.

Deliberately **not** used: the 62-surface `queryBuilder` selector API (`EvmV1Decoder` already
returns sender, entry point, value, nonce, gas limit, receipt status, gas used and the full log set
from the same bytes the precompile verified — spending a selector budget on facts that are free
would be decoration), `proofProvider.mergeProofs` (throws on non-contiguous ranges; three legs of
one block are not a range), and `PrecompileBlockProver.verifyBatch` (TypeScript-side only — there
is no on-chain batch verify, which is exactly why a claim makes three sequential `verifyAndEmit`
calls). Reasoning for each: [`docs/PIPELINE.md`](docs/PIPELINE.md).

## Tests

**120 Foundry unit tests, 0 failed:**

```
Index41MechanismTest   19   wiring, constants, position recovery from merkle laterality
Index41BondTest        26   posting/accumulating a bond, declaring coverage, the unbond clock
Index41ClaimTest       52   the sandwich-shape assertion and every way to fail it
Index41HarmTest        23   realized-profit accounting, replay protection, double-claim guards
```

`Index41MechanismTest`'s three `test_MockDecodesLiveMainnetLateralityTo{Fourteen,Fifteen,Sixteen}`
tests assert against `MockVerifier`'s own Solidity reimplementation of the laterality algorithm
(unit tests run on a bare EVM, where the real precompile address has no code) — they prove the
mock, not the precompile. The precompile itself was independently confirmed against these same
three paths on CC3 testnet, live: `OrderProbe.proveOrder` returned `[14, 15, 16]` from the real
`INativeQueryVerifier.calculateTxIndex` (`docs/spike-output.txt`), and again in the deployment run
(`docs/DEPLOYMENT.md`).

```bash
npm ci
forge build                    # default profile — unit tests link their own EvmV1Decoder
npm test                       # forge test --summary — 120 tests, all four suites
npm run test:gas               # per-test gas report
```

The one exhaustive test rather than an example: `test_TxIndexOfRoundTripsEveryPositionInTheTree`
walks **all 256 leaves** of the depth-8 tree and asserts the laterality decode round-trips to the
position for every one of them. The decision function that must never be wrong is verified over its
whole input space, not on three cases.

## The engineering harness

```bash
npm run ci            # ESLint (0 warnings) + tsc + forge fmt --check + 120 forge tests + npm audit
npm run ci:full       # …plus the Next production build and the 48-test Playwright suite

npm run lint          # ESLint over app/ src/ scripts/
npm run typecheck     # tsc --noEmit
npm run fmt:sol:check # forge fmt --check
npm run e2e           # Playwright — chromium + mobile, zero config
npm run lighthouse    # Lighthouse CI over / and /judge
npm run secrets       # gitleaks over the full git history AND the working tree
make security-scan    # the above, plus npm audit and a licence check
```

| Layer | Tool | Result on this repo |
|---|---|---|
| Contracts | `forge build` · `forge fmt --check` · Foundry | 120 tests, 4 suites, 0 failed · formatter clean |
| Exhaustive verification | Foundry | **256 positions** — every leaf of the tree round-tripped |
| Code quality | ESLint 9 (`next/core-web-vitals` + `next/typescript`) · `tsc --noEmit` | clean at `--max-warnings=0` |
| E2E | Playwright, chromium + Pixel 7 | **48 tests** — zero config, no `.env`, no wallet |
| Performance | Lighthouse CI, `/` and `/judge` | perf **100** · a11y **96** · best-practices **100** · SEO **100** |
| Security — SAST | CodeQL (`javascript-typescript`, `security-and-quality`) | weekly + every push/PR |
| Security — secrets | gitleaks over **full history** + TruffleHog | 17 commits scanned, **no leaks found** |
| Security — SCA | `npm audit` (production tree, blocking) + Dependabot | **0 vulnerabilities** in the shipped tree |
| CI/CD | GitHub Actions, 6 stages, parallel, concurrency-cancelled | contracts + TypeScript + Next, all three gated |

Solidity is formatted by `forge fmt`. TypeScript deliberately is **not** run through Prettier — the
source is hand-formatted with aligned comment blocks that carry meaning, and churning 18 files for
cosmetics on a frozen submission buys nothing. The formatting gate that exists is the one that can
be met exactly.

A note on the E2E suite, because it is the easy place to cheat: none of the 48 tests assert
`14`, `15` or `16`. They assert **invariants** — that each leg's off-chain laterality decode equals
the index the precompile emitted, that the three positions are strictly increasing, that harm paid
equals harm computed, and that the page names which of the two real sources it used. A test that
hard-coded the indices would still pass against a page that had hard-coded them too, which is
precisely the failure this repository exists to avoid.

## Reproducing the live proof

```bash
npm run build:cc3              # links Index41 against Creditcoin's deployed EvmV1Decoder
npm run prove -- --fresh-court # deploy → bond → declare coverage → prove → pay, on CC3 testnet
npm run prove -- --kill-hosted --fresh-court   # same, with the hosted prover switched off
```

No flags are required and none of them switch the judged capability on or off — `--kill-hosted`
only changes which of the three interchangeable proof sources answers. A signing key is read from
`~/.config/creditcoin/index41-testnet.json` at runtime and is never in this repository. Re-running
against a court that already ruled on this sandwich stops at `ALREADY RULED` — the replay guard,
committed at [`docs/pipeline-output-replay.txt`](docs/pipeline-output-replay.txt).

```bash
npm run typecheck              # tsc --noEmit
```

## Scope

**Never cut:** `calculateTxIndex`, the three-way ordering assertion, the mainnet demo, real CC3 tx
hashes on Blockscout. **Cut deliberately:** a multi-relay registry (single bonded relay), a
historical-claim browser (one claim, one demo), automatic sandwich detection (the caller supplies
three tx hashes — `scripts/find-sandwich.ts` exists to find real ones, but the contract itself
takes hashes, not a scan). The web surface is deliberately **one page about one ruling**: it reads
the chain and shows the decode, and it cannot submit a claim — claiming needs a funded key, which
belongs in `npm run prove`, not in a judge's browser. Wallet connection is one optional button in
the footer that adds the CC3 network; nothing on the default path touches it.

## Hard constraints this project is built to

- **Writability does not exist.** Read Ethereum state on Creditcoin only. No round-trips.
- **Attestcoin proves transaction history, not state.** No proofs over `eth_call`, storage slots,
  or `balanceOf` — anywhere in this codebase.
- **No on-chain batch verification.** `INativeQueryVerifier` exposes exactly `verifyAndEmit` and
  `calculateTxIndex`. A claim is three sequential `verifyAndEmit` calls in one transaction.
- Source chain is Ethereum **mainnet** (Attestcoin chain key 3) — sandwiches essentially do not
  occur on Sepolia, and the demo needs a real one.
