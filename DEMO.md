# DEMO — index41 in five screens

For the numbers and the links, read [`JUDGE.md`](JUDGE.md); it is the receipt. This file is the
walkthrough for someone who has not cloned anything yet — what the product looks like, in order,
with a note under each screen saying exactly what in it is real.

Every screenshot below is **unretouched**, captured on **2026-08-16** from the app running locally
and from public block explorers. Nothing was composited, recoloured or cropped. Where a third-party
explorer shows its own advertising slot, that banner is left in frame rather than edited out —
removing it would mean editing evidence.

---

## The architecture, before anything else

![index41 architecture — an Ethereum mainnet block is re-encoded and re-folded off-chain, its continuity proof chained to a Creditcoin checkpoint, then one Creditcoin transaction verifies three transactions, recovers each ordinal position from merkle-path laterality, asserts the ordering, derives harm from proven Swap logs and pays the victim from the relay's bond](docs/architecture.svg)

Three of block `25,764,741`'s 240 transactions are touched. Everything expensive happens off-chain
and for free; exactly one Creditcoin transaction spends gas.

---

## 1 · The demo surface

![The index41 landing page: the headline "Position inside a block was a claim. Now it is a fact.", with stat tiles reading 14 · 15 · 16 positions recovered on-chain, 1.456% of MAX_GAS_CAP, 8 laterality bits per position, and 120 Foundry tests](docs/screens/demo-surface.png)

`npm install && npm run dev` → `http://localhost:3000`. No `.env`, no wallet, no API key, no account.

The four tiles are read, not typed: `14 · 15 · 16` comes from the `TransactionVerified` logs the
Attestcoin precompile itself wrote, and the page decodes them on every load.

---

## 2 · The mechanism — why nothing else can see this

![The mechanism section: a merkle authentication path is normally an opaque list of sibling hashes, but walking it leaf to root also answers "were you the left child or the right one?" — a worked example panel shows PATH LEAF → ROOT RLLLRRRR, L → 1 R → 0 giving 01110000, least-significant first +2 +4 +8, = BLOCK POSITION 14](docs/screens/laterality-decode.png)

The worked example on the right is the whole idea in one panel. `RLLLRRRR`, read leaf → root with
`L → 1` and `R → 0`, is `01110000`; taken least-significant-first that is `+2 +4 +8` — **position 14**.

The position was never written down anywhere. It was recovered from the *shape* of the proof, which
is why it cannot be disputed. Creditcoin exposes exactly this as `calculateTxIndex`, and it is a
`view`, so it costs nothing.

---

## 3 · The ruling — five logs of one Creditcoin transaction

![The ruling panel: 14 < 15 < 16 front-run before victim before back-run, checked; and the five logs of one Creditcoin transaction — three TransactionVerified events with chainKey 3, height 25764741 and txIndex 14, 15, 16, then SandwichProven and HarmPaid 219708; the bond pays the victim 219,708 wei and the transaction costs 1,092,100 gas, 1.456% of the 75,000,000 MAX_GAS_CAP](docs/screens/the-ruling-logs.png)

One transaction does all of it: three verifications, three position recoveries, the ordering
assertion, the harm computation and the payout. `paid == computed`.

The right-hand panel shows the off-chain decode and the precompile's on-chain emission **side by
side** — so they can be seen agreeing, rather than asserted to agree.

---

## 4 · The same event, decoded by a stranger

![Blockscout's transaction page for the ruling, Logs tab: the decoded TransactionVerified event with chainKey 3, height 25764741 and transactionIndex 14, emitted by the verifier precompile](docs/screens/blockscout-transactionverified.png)

This is not our UI. The contract is source-verified, so Blockscout decodes the events on its own:
`chainKey 3` (Ethereum mainnet), `height 25764741`, `transactionIndex 14`. Two more identical
events follow with `15` and `16`.

Nothing on this page came from us except the bytecode.

---

## 5 · The judge page

![The /judge page: the 30-second path, then a receipt table reading "Provenance of this page: LIVE CHAIN READ", the source-verified contract address, the ruling transaction with status 1 and block 5,317,821, Ethereum mainnet block 25,764,741 with 240 transactions, positions recovered 14 → 15 → 16 by calculateTxIndex, the three laterality decodes all agreeing, and the ordering assertion holding](docs/screens/judge-page.png)

`/judge` is the same evidence written for one reader. The first row of the receipt names its own
provenance — `LIVE CHAIN READ` here — so you always know whether the page in front of you just
talked to a node or fell back to the committed capture. There is no third source and no mock.

---

## Run it yourself

```bash
# the demo surface — zero config
npm install && npm run dev            # → http://localhost:3000  (and /judge)

# re-read every live source and diff the committed artifact
node scripts/capture-proof.mjs --check
# → "committed artifact MATCHES a fresh live capture"

# the contract suite
npm test                              # forge test --summary — 120 tests, 4 suites

# the E2E suite (needs a build first)
npm run build && npm run e2e          # 54 tests
```

And the check that needs no clone at all — one position, over someone else's API:

```bash
curl -s https://eth.blockscout.com/api/v2/transactions/0xec3777f9d0e55d03b9caa3a4b8a786dd62e16eeb327a9f1c45dfbc79af618436 | jq .position
# 14
```

---

## Headline number

> **A sandwich goes from three transaction hashes to a settled on-chain ruling in 16.9 seconds
> (p50, n=5, real CC3 testnet).**

Conditions: `npm run bench`, 2026-08-16, node v22.22.0 on darwin/arm64, ordinary home broadband,
against the live hosted prover, live public Ethereum mainnet RPCs and the live Creditcoin CC3
testnet. Every trial proves the same committed sandwich — Ethereum mainnet block `25,764,741`,
positions 14 / 15 / 16 — so the variance is network and chain, never workload.

One number is the headline. Everything else is in the table below.

## Real run — receipt

Not a simulation of a run. These five rulings exist on chain and the bond really paid.

```
Run: npm run bench          Date: 2026-08-16T10:09:37Z          Wall clock: 1,706 s
```

| Metric | Value |
|---|---|
| Spend | **6.014653809 CTC** — Creditcoin **testnet** CTC, so no fiat cost; itemised as 6 court deployments + 6 bonds posted + 6 rulings submitted |
| Signer balance | `9992.981569222499340876` → `9986.966915413499340876` CTC |
| Gas, 5 measured rulings | **5,460,500** total — **1,092,100 each**, identical every time |
| Artifacts | 5 status-1 receipts, 3 `TransactionVerified` logs each, 219,708 wei paid to the victim each |
| Verification | 5/5 trials passed every check · positions 14/15/16 · one merkle root across both proof sources · `paid == computed` |

The five rulings, on a public explorer:

| Trial | Block | Transaction |
|---:|---:|---|
| 1 | 5,319,297 | [`0x92359364…727e8c`](https://creditcoin-testnet.blockscout.com/tx/0x92359364e1e2565764917b4d1a7c6d0e784d9eb9032b728cb4f8034269727e8c) |
| 2 | 5,319,301 | [`0xbc0dd6e5…89de87`](https://creditcoin-testnet.blockscout.com/tx/0xbc0dd6e5de827bcb1e094a3ccbebf5c9b213992ac90158cd7f4150482989de87) |
| 3 | 5,319,305 | [`0x3c80ae88…93e5dc`](https://creditcoin-testnet.blockscout.com/tx/0x3c80ae884a99dc5dd087a000f47cc2df04363b21ef683ec27615acdef093e5dc) |
| 4 | 5,319,309 | [`0x74a706d2…a19687`](https://creditcoin-testnet.blockscout.com/tx/0x74a706d215c05b2df6f84e3ec193df2dc588d852ab58887f83c272db82a19687) |
| 5 | 5,319,313 | [`0x7d7e7362…3594ca`](https://creditcoin-testnet.blockscout.com/tx/0x7d7e73627c8a22905159351dff2b22d7acf1bc44e70961512801044f3f3594ca) |

Full transcript, including every individual trial: [`docs/bench-output.txt`](docs/bench-output.txt).

## Full results

| Path | n | p50 | p95 | min | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| Hosted proof fetch — `POST /api/v1/proof-batch/3` | 20 | **638 ms** | 1,214 ms | 622 ms | 3,395 ms | 814 ms |
| Local proof build — `RawProofBuilder`, no proof service at all | 5 | **171,045 ms** | 386,790 ms † | 154,986 ms | 386,790 ms | 211,637 ms |
| End-to-end prove → ruling | 5 | **16,874 ms** | 17,243 ms † | 12,696 ms | 17,243 ms | 15,347 ms |

† At n=5 the nearest-rank p95 **is** the slowest observation. Read it as the worst case seen, not
as a resolved tail — and see the limitations below for why n is small.

**What the middle row is worth reading twice.** The hosted prover is **268× faster at the median**,
and index41 does not need it. The local path talks to no proof service whatsoever — it rebuilds the
merkle tree from Ethereum and the continuity proof from Creditcoin's own attestations — and returns
**the same merkle root**, `0x362ca563…76c16`. That is the price of prover independence, measured:
about three minutes instead of two thirds of a second, for a claim that settles either way.

## Reproduce

```bash
git clone --recurse-submodules <repo>            # forge-std is a submodule
cd index41
npm install
npm run bench                                    # ~28 minutes; needs a funded CC3 testnet key
```

The key is read at runtime from `~/.config/creditcoin/index41-testnet.json` and is never in this
repository. Trial counts are adjustable — `npm run bench -- --n-hosted 30 --n-local 3 --n-e2e 3` —
and the script prints its own `n` in every row, so a shorter run cannot be mistaken for this one.

**There is no CI / deterministic-replay variant of this benchmark, on purpose.** There is no
`OFFLINE=1`, no `MOCK=`, no `--dry-run`. Every trial is a real round trip and every end-to-end
trial lands a real transaction, because a latency number for a proving pipeline that never proved
anything would not be a number about this product. The script is correctness-gated and exits
non-zero if any check fails, so it is a verification script that happens to report timings.

Two cheaper checks, if 28 minutes is too long:

```bash
node scripts/verify-bytecode.mjs    # every deployed court runs identical executable code
npm run capture:check               # re-read every live source, diff the committed artifact
```

## Methodology & limitations

- **Input is fixed, not random.** Every trial proves the same committed sandwich
  (`data/sandwich-25764741.json`). That is this benchmark's seed: run-to-run variance is network
  and chain, never workload. It also means these numbers describe *one* block of 240 transactions
  with a 60-root continuity range, not a distribution over block sizes.
- **One warm-up per path, discarded.** DNS, TLS and the SDK's first-call cost are not the product.
- **n is deliberately small on two of the three paths.** A local build costs ~200 s of public
  mainnet round-trips and an end-to-end trial spends real gas and deploys a court. n=5 cannot
  resolve a p95, and the table says so with a dagger rather than implying more precision than was
  bought. The hosted path is cheap, so it gets n=20.
- **Single machine, single network.** One laptop on home broadband, one geography. The 3,395 ms
  hosted outlier and the 386,790 ms local outlier are both public-endpoint variance and are left in
  — removing them would flatter the numbers and misrepresent the tail.
- **Court deployment and bonding are excluded from the end-to-end timing.** They are setup: a relay
  bonds once, and many claims then settle against that bond. They are excluded here only because
  the replay guard retires a court after it rules, so each trial needs a new one — an artefact of
  benchmarking, not of the product.
- **Testnet.** The spend above is testnet CTC and has no fiat cost. It is reported as gas and CTC
  rather than dollars so that it cannot be read as a dollar figure.
- **Not measured:** cold-start of the deployed Next.js surface, concurrent claimants, blocks other
  than 25,764,741, and any network other than CC3 testnet.

## Where to go next

| | |
|---|---|
| The receipt, and every link in one place | [`JUDGE.md`](JUDGE.md) |
| The full argument and the Attestcoin surface table | [`README.md`](README.md) |
| How the proof is built and audited | [`docs/PIPELINE.md`](docs/PIPELINE.md) |
| Every deploy, bond and balance | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| The ruling transcript, and the same run with no proof service | [`docs/pipeline-output.txt`](docs/pipeline-output.txt) · [`docs/pipeline-output-local-prover.txt`](docs/pipeline-output-local-prover.txt) |
| Pitch deck (PDF) | [`docs/index41-pitch-deck.pdf`](docs/index41-pitch-deck.pdf) |
