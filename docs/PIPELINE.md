# The proving pipeline

Three Ethereum mainnet transaction hashes in. One Creditcoin ruling out.

```bash
npm run prove                                   # the recorded sandwich in data/
npm run prove -- <front> <victim> <back>        # any three hashes from one block
npm run prove -- --kill-hosted                  # the hosted prover is switched off entirely
```

No flags are required and none of them switch the judged capability on or off. `--kill-hosted`
points the two hosted proof sources at a hostname that does not resolve, which is the closest
honest simulation of the proof service being down; the pipeline then rebuilds the proof itself and
produces the same merkle root, byte for byte.

## What a run does

| Step | What happens | Evidence it produces |
|---|---|---|
| 0–1 | Connect CC3 (102031) and Ethereum mainnet; confirm chain key 3 maps to chainId 1 | heads, balance, precompile addresses |
| 2 | Resolve the block and the three positions from a mainnet RPC | `25764741`, positions `14 / 15 / 16` — ground truth, never acted on |
| 3 | Wait for attestation, adaptively | measured `waitUntilHeightAttested` time, the prover's own `BlockNotReady` payload |
| 4 | Fetch proofs down a ladder of three interchangeable sources | which source answered, in how long |
| 5 | Audit the bundle without trusting the source | re-encoded leaves, re-folded merkle paths, continuity chained to an on-chain checkpoint |
| 6 | Decode each leg through Creditcoin's deployed `EvmV1Decoder` | pool, numeraire side, realized profit `219708` |
| 7 | Dry-run all three verifications for free | `verifySingle=true`, `calculateTxIndex = 14 / 15 / 16` |
| 8 | Deploy/reuse the court, bond the relay, declare coverage | contract address, bond, coverage |
| 9 | Submit ONE transaction: 3× `verifyAndEmit` + 3× `calculateTxIndex` | gas used against `MAX_GAS_CAP` |
| 10 | Read back the ruling | `SandwichProven`, `HarmPaid`, Blockscout links |

## Proven runs

| Run | Proof source | Index41 | CC3 transaction | Gas |
|---|---|---|---|---|
| **live deployment** — see [`DEPLOYMENT.md`](DEPLOYMENT.md) | `POST /api/v1/proof-batch/3` (hosted, by block position) | [`0xb37Bc52b…10eC2`](https://creditcoin-testnet.blockscout.com/address/0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2) **(source verified)** | [`0xd136dea0…d243810`](https://creditcoin-testnet.blockscout.com/tx/0xd136dea0524b7e0e9eba54bf9724eec78597c2598047a96849af727f4d243810) | 1,092,100 (1.456% of cap) |
| default | `POST /api/v1/proof-batch/3` (hosted, by block position) | [`0x2084C677…82DDD`](https://creditcoin-testnet.blockscout.com/address/0x2084C677901067f15c59C48beFeb168b26982DDD) | [`0x53ac43ed…03b8b`](https://creditcoin-testnet.blockscout.com/tx/0x53ac43edb920c0fb5c45387e5488248696801bfa907e57402d53b3dfa6703b8b) | 1,092,100 (1.456% of cap) |
| `--kill-hosted` | `RawProofBuilder` — **no proof service at all** | [`0xc5F604B7…66C33`](https://creditcoin-testnet.blockscout.com/address/0xc5F604B76240dc606509e1319d8B30D518566C33) | [`0xb95466d9…16fb2`](https://creditcoin-testnet.blockscout.com/tx/0xb95466d9b7c790d51a6457af9db13de88f5477091b47d005949ebce1b9516fb2) | 1,092,100 (1.456% of cap) |

Both runs emitted, from the precompile itself:

```
TransactionVerified(chainKey=3, height=25764741, txIndex=14)
TransactionVerified(chainKey=3, height=25764741, txIndex=15)
TransactionVerified(chainKey=3, height=25764741, txIndex=16)
SandwichProven(0x11111215…3911, 25764741, 14, 15, 16, 219708, 219708)
HarmPaid(0x51f400b9…1410, 0x9436ed9A…5e24, 219708)
```

Full transcripts: [`pipeline-output-deployment.txt`](pipeline-output-deployment.txt) (the live
deployment), [`pipeline-output.txt`](pipeline-output.txt),
[`pipeline-output-local-prover.txt`](pipeline-output-local-prover.txt),
[`pipeline-output-replay.txt`](pipeline-output-replay.txt) (the replay guard refusing a second
ruling on the same sandwich). Contract addresses: [`deployment.json`](deployment.json).

## The three proof sources

They sit behind one interface and the pipeline is indifferent to which answers.

1. **`HostedByIndexSource`** — `POST /api/v1/proof-batch/{chain_key}`, keyed by **block position**.
   No SDK binding, no official example, and the only endpoint that asks the question index41 asks:
   *give me positions 14, 15 and 16*. It returns **one** continuity proof shared by all three legs
   instead of three copies of the same 60 roots.
2. **`HostedByHashSource`** — the SDK's own `proofProvider.service.ProofBuilder.getBatchProof`.
   Same host, different endpoint, different code path.
3. **`LocalRawSource`** — `proofProvider.raw.RawProofBuilder` over `SimpleBlockProvider`. Rebuilds
   the block's merkle tree from mainnet transactions and the continuity proof from Creditcoin's own
   attestations. **Needs no proof service.**

In the `--kill-hosted` run, source 3 reproduced the hosted merkle root
`0x362ca563e40b7cef16c1b901211e74a50abb61657945997a476ae7bc35676c16` and the same 60-root
continuity proof exactly.

### Two things the SDK cannot do here, discovered by doing it

- **`RawProofBuilder.getBatchProof` cannot express a single-block batch.** Three legs of one block
  collapse to `fromHeader === toHeader`, and `ContinuityProofBuilder.createForHeights` rejects
  `toHeight <= fromHeight` outright. `getProof` per leg is the working call; because the legs share
  a block, the three continuity proofs must come back byte-identical, which the source asserts.
- **`proofProvider.mergeProofs` is not the way around that** — it throws on non-contiguous ranges,
  and three proofs for one block are not a range at all.

### `CachingBlockProvider`

`SimpleBlockProvider` says in its own doc comment that it "has no caching or optimizations". For
one index41 claim that means roughly 1,000 mainnet round-trips: the whole 240-transaction block
re-fetched one `eth_getTransactionByHash` at a time, per leg, plus a 100-block continuity range
walked three times. `CachingBlockProvider` implements the SDK's own `BlockProvider` interface,
delegates misses to `SimpleBlockProvider`, and back-fills the per-transaction cache out of the
block it already fetched. Measured on the `--kill-hosted` run:

```
blocks 100 fetched / 203 cached · transactions 1 fetched / 722 cached
(20,983 back-filled from blocks) · 925 mainnet round-trips avoided
```

## The audit — why the prover swap is safe

A proof source is never taken at its word. Before any gas is spent:

| Claim | How it is checked | SDK surface |
|---|---|---|
| these are the right transaction bytes | re-encode from mainnet and compare | `encoding.getTransactionWithRaw`, `encoding.abiEncode`, `encoding.EncodingVersion` |
| this path leads to that root | fold leaf → root through the siblings | `merkle.hashLeaf`, `merkle.hashInner` |
| this is position *n* | one bit of laterality per sibling | (decoded locally, then again on-chain) |
| this continuity proof is real | chain digests from `lowerEndpointDigest` and find the result on Creditcoin | `merkle.computeDigestOf`, `getAttestationHeightForDigest`, `getCheckpointForHeight` |

The last row is the one that matters. Folding `computeDigestOf` across the 60 roots lands on
`0x5492ed3c…d197`, which Creditcoin holds as the **checkpoint at height 25764800**. That binds an
off-chain blob to on-chain state, off-chain, for free — and it is what makes swapping the prover a
non-event.

## Adaptive attestation waiting

The official examples poll `waitUntilHeightAttested` on a flat schedule. Two measured improvements,
both on the default path:

- **`extraDelayMs`.** `waitUntilHeightAttested`'s fifth parameter defaults to `15000`: after seeing
  the height attested it sleeps a flat fifteen seconds "to ensure data availability", whether the
  block was attested one second ago or three hours ago. No official example passes it. index41
  passes `0` once the block is more than 256 below the attested tip. Measured: **15,269 ms → 317 ms**.
- **`ErrorResponse.retriable` + `last_attested_block`.** Every run first asks the prover for a
  height it cannot serve, to confirm it honours that contract before the poller relies on it:

  ```
  HTTP 422 BlockNotReady: The continuity proof cannot be created because block 25765103
  is not attested to yet. Last attested block: 25765100
  retriable=true block_number=25765103 last_attested_block=25765100
  → 3 blocks behind, so the adaptive poller would sleep 36s, not a flat 15s
  ```

  Overshoot the source chain's head and you get `BlockNotOnSourceChain` (404) instead, which
  carries neither field — so the probe targets `tip + 3`, above the attestation but below mainnet.
  If a prover ever fails to report the lag, the poller degrades to the flat schedule rather than
  sleeping on a field that is not there.

## Gas

Printed with every submission, from the SDK's own helpers rather than a local rule of thumb:

```
calldata        17860 bytes (utils.hex.bytesInHexString)
gas limit       1539012 from utils.gas.computeGasLimit
MAX_GAS_CAP     75000000 — the budget is 2.052% of it
GAS USED        1092100  (1.456% of MAX_GAS_CAP)
```

(Exact `gasUsed / MAX_GAS_CAP`, not `utils.gas.gasAsPercentageOfMax` — that SDK helper does integer
basis-point division and truncates, e.g. it would print `1.45%` here instead of `1.456%`. The
raw `pipeline-output*.txt` transcripts still show the SDK's truncated figure, because that is
literally what the script printed at the time the helper was still driving the display.)

`computeGasLimit` matters on Creditcoin specifically: `pallet-evm` does not always propagate
precompile revert reasons during estimation, and the helper falls back to a continuity-length
heuristic when that happens.

## Attestcoin surfaces this pipeline makes load-bearing

The official-example baseline is **3 methods on 2 classes** (`ProofBuilder` ctor →
`waitUntilHeightAttested` → `getProof`, plus `getLatestAttestedHeightAndHash`).

**36 distinct surfaces, 24 of them undocumented.** 31 execute on a clean default run; all 36 across
the default and `--kill-hosted` runs. "Undocumented" means absent from docs.creditcoin.org.

The five that do not run on a zero-flag default run sit on the lower rungs of the proof ladder: they
are constructed on every run and *invoked* only when the hosted sources are gone, which is what
`--kill-hosted` forces. The honest headline is therefore **31 on the default path, 36 across both
runs** — never 36 unqualified.

Every row below whose symbol the project's 325-surface capability ledger catalogues carries the same
documented/undocumented verdict there — all 32 SDK and on-chain rows agree, row for row. The four
proof-gen HTTP endpoints fall outside that ledger's SDK scope and are classified here against the
prover's own published OpenAPI spec and the docs site; `POST /api/v1/proof-batch/{chain_key}` and the
`ErrorResponse` fields appear in neither the docs site nor any SDK binding, hence undocumented. The
totals reconcile at **36 / 24**, and `README.md` states the identical numbers.

### `chainInfo`

| Surface | Doc | Where it is load-bearing |
|---|---|---|
| `PrecompileChainInfoProvider` | 📖 | every chain read; also injected into `RawProofBuilder` |
| `.getSupportedChainByKey` | — | refuses to run unless chain key 3 really maps to chainId 1 |
| `.getAttestationGenesisHeight` | — | reported, and required by the local continuity builder |
| `.getLatestAttestedHeightAndHash` | — | the tip the block is measured against |
| `.getContinuityBounds` | — | the parent/child range the continuity proof must span |
| `.waitUntilHeightAttested` | — | the wait — with its fifth parameter, `extraDelayMs` |
| `.getAttestationHeightForDigest` | — | binds the recomputed continuity digest to an attestation |
| `.getCheckpointForHeight` | — | …or, as here, to a checkpoint |

### `blockProver`

| Surface | Doc | Where it is load-bearing |
|---|---|---|
| `BLOCK_PROVER_PRECOMPILE_ADDRESS` | 📖 | the verifier address, and the filter for the precompile's own logs |
| `PrecompileBlockProver` | 📖 | the free preflight |
| `.verifySingle` | 📖 | all three legs dry-run before a claim is built |
| `.computeTransactionIndex` | — | position recovered off-chain, cross-checked against the contract |

### `proofProvider`

| Surface | Doc | Where it is load-bearing |
|---|---|---|
| `service.ProofBuilder` | 📖 | ladder rung 2 |
| `service.ProofBuilder.getBatchProof` | 📖 | ladder rung 2 |
| `raw.RawProofBuilder` | 📖 | ladder rung 3 — the prover-free path |
| `raw.RawProofBuilder.getProof` | — | the call that actually works for a single-block batch |
| `raw.blockProvider.SimpleBlockProvider.constructor` | — | `new SimpleBlockProvider(rpc)`, wrapped by `CachingBlockProvider` |
| `raw.blockProvider.BlockProvider` | — | implemented, not just called |
| `merkle.hashLeaf` | — | leaf hash for the independent merkle walk |
| `merkle.hashInner` | — | the walk itself |
| `merkle.computeDigestOf` | — | the continuity digest chain |

### `encoding`

| Surface | Doc | Where it is load-bearing |
|---|---|---|
| `getTransactionWithRaw` | — | re-encode the leaf from mainnet |
| `abiEncode` | — | …and compare it byte for byte with what the source served |
| `EncodingVersion` | 📖 | V1, for both the re-encode and the local prover |

### `utils`

| Surface | Doc | Where it is load-bearing |
|---|---|---|
| `gas.computeGasLimit` | — | the submitted gas limit |
| `gas.MAX_GAS_CAP` | — | the ceiling every claim is held against |
| `gas.gasAsPercentageOfMax` | — | headroom, before and after |
| `hex.bytesInHexString` | — | calldata size |
| `decoder.decodeEvmV1Transaction` | — | the whole preflight decode, `trackGas` included |

### Proof-gen API

| Surface | Doc | Where it is load-bearing |
|---|---|---|
| `GET /api/v1/health` | 📖 | reported before anything else |
| `GET /api/v1/attested-height/{chain_key}` | 📖 | the adaptive poller's clock |
| `POST /api/v1/proof-batch/{chain_key}` | — | the primary proof source — no SDK binding exists |
| `ErrorResponse.retriable` / `last_attested_block` | — | the backoff schedule |

### On-chain

| Surface | Doc | Where it is load-bearing |
|---|---|---|
| `INativeQueryVerifier.verifyAndEmit` | 📖 | three sequential calls in one transaction |
| `INativeQueryVerifier.calculateTxIndex` | — | **the product** — position from merkle laterality |
| `EvmV1Decoder` (deployed library, 9 public selectors) | 📖 | linked into Index41 on chain; called off-chain by the preflight |

### Deliberately not used

- **`queryBuilder` (62 surfaces).** Index41 needs no selective-field query: `EvmV1Decoder` already
  returns sender, entry point, value, nonce, gas limit, receipt status, gas used and the full log
  set from the same bytes the precompile verified. Spending a selector budget on facts that are
  free would be decoration, and the brief for this pipeline says so explicitly.
- **`proofProvider.mergeProofs`.** Throws on non-contiguous ranges. See above.
- **`PrecompileBlockProver.verifyBatch` / `verifyAndEmitBatch`.** TypeScript-side only. There is no
  on-chain batch verify, which is exactly why the claim makes three `verifyAndEmit` calls.

## Reproducing

```bash
npm ci
npm run build:cc3         # links Index41 against Creditcoin's deployed EvmV1Decoder
npm run prove             # ~40s, one CC3 transaction
npm run prove -- --kill-hosted --fresh-court   # ~4min, rebuilds every proof locally
```

A signing key is read from `~/.config/creditcoin/index41-testnet.json` at runtime and never from
this repository. Re-running against a court that has already ruled on the same sandwich stops at
`ALREADY RULED` — the replay guard, doing its job.
