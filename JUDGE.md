# index41 — for judges

> **index41 proves transaction A executed before transaction B inside an Ethereum block — a fact
> carried in no payload and readable by no oracle — and makes a relay's bond pay for breaking its
> no-sandwich promise.**

This file mirrors the live `/judge` page ([`app/judge/page.tsx`](app/judge/page.tsx)), which
renders the same receipt from a **live chain read** rather than from this text. If a number here
and a number there ever disagree, the page is right — it read the chain; this file is typed.

---

## The 30-second path

> **In a hurry, or the host is not answering?** The 2:55 demo walks the whole thing end to end:
> **https://youtu.be/NuyoosaD-lk**. Nothing in it is staged — the hero beat is a production build
> reading the ruling live off a public CC3 node, with the `LIVE CHAIN READ` banner on camera.

1. Open the demo surface — **https://index41.edycu.dev** — or run it yourself with
   `npm install && npm run dev` → `http://localhost:3000`. Scroll to the ledger. Three rows of a real Ethereum mainnet block light up in sequence.
2. Read the banner above the ledger. It names which of the **two real sources** is on screen right
   now — `LIVE CHAIN READ` or `CACHED REAL PROOF`. There is no third source and no mock.
3. Click **re-read the chain**. That hits `/api/proof`, which performs a real
   `eth_getTransactionReceipt` against a public CC3 node every time, uncached.
4. Check it against a stranger:
   - the ruling on Blockscout —
     [`0xd136dea0…d243810`](https://creditcoin-testnet.blockscout.com/tx/0xd136dea0524b7e0e9eba54bf9724eec78597c2598047a96849af727f4d243810)
     (the contract is source-verified, so the explorer decodes the events itself)
   - the Ethereum mainnet block the positions came from —
     [`25764741`](https://eth.blockscout.com/block/25764741)
   - one position, over someone else's API:
     ```bash
     curl -s https://eth.blockscout.com/api/v2/transactions/0xec3777f9d0e55d03b9caa3a4b8a786dd62e16eeb327a9f1c45dfbc79af618436 | jq .position
     # 14
     ```

Nothing above needs a key, a wallet, a `.env`, an account or a clone.

---

## The receipt

Every row was read from the chain, not asserted.

| | |
|---|---|
| Contract (source verified) | [`0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2`](https://creditcoin-testnet.blockscout.com/address/0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2) on Creditcoin CC3 testnet (102031) |
| The ruling transaction | [`0xd136dea0…d243810`](https://creditcoin-testnet.blockscout.com/tx/0xd136dea0524b7e0e9eba54bf9724eec78597c2598047a96849af727f4d243810) · status `1` · block `5,317,821` · 5 logs |
| Source of truth | Ethereum **mainnet** block `25,764,741` · 240 transactions · a real MEV sandwich |
| Positions recovered | **14 → 15 → 16** (searcher buy · victim · searcher sell), from merkle-path laterality via `calculateTxIndex` |
| Off-chain vs on-chain | `RLLLRRRR→14` · `LLLLRRRR→15` · `RRRRLRRR→16` — the laterality decode and the precompile's own emitted index agree on all three |
| Ordering assertion | `front 14 < victim 15 < back 16` — holds |
| Harm paid from the bond | `219,708` wei → `0x51f400…6a1410`, the address the *proof* says was sandwiched. Paid == computed. |
| Gas | `1,092,100` — **1.456%** of `MAX_GAS_CAP` (75,000,000), for 3× `verifyAndEmit` + 3× `calculateTxIndex` + the ordering assert + the events |
| Contract tests | **120** Foundry unit tests across 4 suites, 0 failed |
| E2E tests | **54** Playwright tests (chromium + mobile), zero config |
| Exhaustive verification | **256 positions** — every leaf of the depth-8 tree round-tripped through the laterality decoder in `test_TxIndexOfRoundTripsEveryPositionInTheTree` |
| Attestcoin depth | **36 surfaces** made load-bearing, **24 undocumented**; **30** do real work on a clean default run (3 more are constructed but never queried), all 36 across the default and `--kill-hosted` runs. The official examples exercise **3**. **Counted by the run itself** — `npm run prove` prints `ATTESTCOIN SURFACES EXERCISED THIS RUN: 30` and names all 36, into `docs/pipeline-output.txt`. |
| Latency | p50 / p95 over repeated real runs of three paths — hosted proof fetch, prover-free local build, full prove→ruling. `npm run bench`, numbers in [`DEMO.md`](DEMO.md#full-results) |

---

## Reproduce it

There is no offline mode, no mock and no demo toggle anywhere in this repository. **No flag
switches the judged capability on or off.**

```bash
# the demo surface — zero config
npm install && npm run dev            # → http://localhost:3000

# re-read every live source and diff the committed artifact
node scripts/capture-proof.mjs --check
# → "committed artifact MATCHES a fresh live capture"

# the contract suite (needs the forge-std submodule: clone with --recurse-submodules,
# or run `git submodule update --init` once — nothing else here does)
npm test                              # forge test --summary — 120 tests, 4 suites

# the E2E suite (needs a build first)
npm run build && npm run e2e          # 54 tests

# every deployed court runs the same executable code — read live, no explorer trusted
node scripts/verify-bytecode.mjs

# the full on-chain run: deploy → bond → declare coverage → prove → pay, on CC3 testnet
# needs a funded CC3 key at ~/.config/creditcoin/index41-testnet.json — never in this repo
npm run build:cc3
npm run prove -- --fresh-court
npm run prove -- --kill-hosted --fresh-court   # same, with the hosted prover switched off
```

`--kill-hosted` is **not** a kill switch for the product — it only changes which of the three
interchangeable proof sources answers. Both runs produce the same ruling and the same gas
(`docs/pipeline-output.txt`, `docs/pipeline-output-local-prover.txt`). `--fresh-court` deploys a
court and touches no Attestcoin surface; it is needed because the replay guard retires a court once
it has ruled.

The repeated-run benchmark, if you want the latency numbers rather than a single shot — real
network, real chain, no offline mode, ~25 minutes and a little testnet gas:

```bash
npm run bench                         # p50/p95 for three paths; exits non-zero if a check fails
```

---

## What this does not do

Disclosed rather than discovered:

- **It cannot prove state.** Attestcoin commits transaction *history*, not state. Harm is therefore
  the attacker's realized profit read from proven `Swap` logs — never a counterfactual against a
  pre-sandwich reserve ratio. A contract claiming otherwise would be unsound, so this one does not
  offer it.
- **It does not detect sandwiches on-chain.** The caller supplies three transaction hashes and the
  contract rules on them. `scripts/find-sandwich.ts` finds real ones off-chain.
- **One bonded relay, one ruling.** A multi-relay registry and a historical-claim browser were cut
  deliberately. The deployed contract has ruled once, on the sandwich above.
- **Three of the 120 unit tests prove the mock, not the precompile.** Unit tests run on a bare EVM
  where the precompile address holds no code, so `test_MockDecodesLiveMainnetLateralityTo{Fourteen,
  Fifteen,Sixteen}` assert against `MockVerifier`'s Solidity reimplementation. The **real**
  precompile was confirmed separately and live on CC3: `OrderProbe.proveOrder` returned
  `[14, 15, 16]` from `INativeQueryVerifier.calculateTxIndex` — `docs/spike-output.txt`.
- **Testnet, unaudited.** The bond is play money until it is not.

---

## Everything else

| | |
|---|---|
| The full argument | [`README.md`](README.md) |
| The same thing in five screenshots, if you would rather look than run | [`DEMO.md`](DEMO.md) |
| The architecture on one page | [`docs/architecture.svg`](docs/architecture.svg) |
| How the proof is built and audited | [`docs/PIPELINE.md`](docs/PIPELINE.md) |
| Every deploy, bond and balance | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| The ruling transcript | [`docs/pipeline-output.txt`](docs/pipeline-output.txt) |
| The same run with no proof service at all | [`docs/pipeline-output-local-prover.txt`](docs/pipeline-output-local-prover.txt) |
| The replay guard refusing a second claim | [`docs/pipeline-output-replay.txt`](docs/pipeline-output-replay.txt) |
| The day-one spike, against the live network | [`docs/spike-output.txt`](docs/spike-output.txt) |
| The benchmark transcript — p50/p95, and the rulings it landed | [`docs/bench-output.txt`](docs/bench-output.txt) |
| The court | [`contracts/src/Index41.sol`](contracts/src/Index41.sol) |
| Security posture and boundary tests | [`.github/SECURITY.md`](.github/SECURITY.md) |

Built for **BUIDL CTC 2026 Fall** (DoraHacks), DeFi track.
