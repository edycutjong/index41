# Live on CC3 testnet

index41 is deployed, bonded, and has ruled on a **real Ethereum mainnet sandwich**. Every hash
below is on Creditcoin CC3 testnet (chainId `102031`) and can be opened on Blockscout right now.
The source is verified, so the explorer decodes the calls and the events itself.

Full transcript of the run that produced this page:
[`pipeline-output-deployment.txt`](pipeline-output-deployment.txt). Reproduce with
`npm run prove -- --fresh-court`.

---

## The contract

| | |
|---|---|
| **Index41** | [`0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2`](https://creditcoin-testnet.blockscout.com/address/0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2) |
| Network | CC3 testnet · chainId `102031` · `https://rpc.cc3-testnet.creditcoin.network` |
| Source verified | **yes** — Blockscout, solc `v0.8.23+commit.f704f362`, optimizer on / 200 runs, evm `shanghai` ([contract tab](https://creditcoin-testnet.blockscout.com/address/0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2?tab=contract)) |
| Linked library | `EvmV1Decoder` at [`0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f`](https://creditcoin-testnet.blockscout.com/address/0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f) — Creditcoin's own deployed copy, recorded by Blockscout as the external library link |
| Verifier precompile | [`0x0000000000000000000000000000000000000FD2`](https://creditcoin-testnet.blockscout.com/address/0x0000000000000000000000000000000000000FD2) |
| Deployer / relay | [`0x9436ed9Ac85F9e39A5AE44cd598651F272c45e24`](https://creditcoin-testnet.blockscout.com/address/0x9436ed9Ac85F9e39A5AE44cd598651F272c45e24) |

`EvmV1Decoder` exposes `public` library functions, so it is an **external** library: the deployed
Index41 bytecode carries that address and would revert on the first decode if it were unlinked.
`npm run build:cc3` is the profile that links it.

## The four transactions

| # | What | Transaction | Block | Gas |
|---|---|---|---|---|
| 1 | **Deploy** Index41 | [`0x0faac56c…6a9bc13`](https://creditcoin-testnet.blockscout.com/tx/0x0faac56ca12a671978bb73635828ec09313a6c6d83138e086644aaa816a9bc13) | 5317818 | 3,342,081 |
| 2 | **postBondFor** — 1.0 CTC behind the relay's no-sandwich promise | [`0xbbd71b65…8563b01`](https://creditcoin-testnet.blockscout.com/tx/0xbbd71b6516cce96f1b6250c088bea9fc755e89b1de950cd778ba17a068563b01) | 5317819 | 225,792 |
| 3 | **declareCoverage** — the relay claims the entry point the victim actually called | [`0xe4633e89…6566a3`](https://creditcoin-testnet.blockscout.com/tx/0xe4633e8995d6255b9faa838014371575bfb85cdbcfca31113b13b5ffe46566a3) | 5317820 | 224,630 |
| 4 | **proveSandwich** — 3× `verifyAndEmit` + 3× `calculateTxIndex` + the ruling + the payout | [`0xd136dea0…d243810`](https://creditcoin-testnet.blockscout.com/tx/0xd136dea0524b7e0e9eba54bf9724eec78597c2598047a96849af727f4d243810) | 5317821 | **1,092,100** |

All four returned `status 1`.

## The sandwich it ruled on

Ethereum **mainnet** block `25764741`, Attestcoin source-chain **key 3**. These three hashes are
real mainnet transactions; nothing about them was authored by this project.

| Role | Mainnet transaction | Position recovered on Creditcoin |
|---|---|---|
| front-run (searcher buy) | [`0xec3777f9d0e55d03b9caa3a4b8a786dd62e16eeb327a9f1c45dfbc79af618436`](https://etherscan.io/tx/0xec3777f9d0e55d03b9caa3a4b8a786dd62e16eeb327a9f1c45dfbc79af618436) | **14** |
| the victim | [`0x7b054188f739937a2fc2c9257b48f2ccab0ec4440ce5eda7f2ec5ccbb44485a0`](https://etherscan.io/tx/0x7b054188f739937a2fc2c9257b48f2ccab0ec4440ce5eda7f2ec5ccbb44485a0) | **15** |
| back-run (searcher sell) | [`0xb0cae362c6a6dcf08f4adfc1d510cdda851271a913cdea4bc81da010b65be23a`](https://etherscan.io/tx/0xb0cae362c6a6dcf08f4adfc1d510cdda851271a913cdea4bc81da010b65be23a) | **16** |

`14 < 15 < 16`. The indices are not in any payload and were not supplied to the contract — each one
came back from `INativeQueryVerifier.calculateTxIndex`, which reads the ordinal out of the
left/right laterality of the merkle authentication path:

```
front-run  RLLLRRRR  →  14
victim     LLLLRRRR  →  15
back-run   RRRRLRRR  →  16
```

Shared merkle root `0x362ca563e40b7cef16c1b901211e74a50abb61657945997a476ae7bc35676c16` — one block,
one tree, one root, which is how `sameBlock` is enforced structurally rather than trusted. The one
shared continuity proof (60 roots, `25764741..25764800`) chains to
`0x5492ed3c…d197`, which Creditcoin holds as the **checkpoint at height 25764800**.

## What the chain says happened

Logs in transaction 4, in order — the first three are emitted by the **precompile itself**, not by
Index41 and not by the script:

```
0x…0FD2  TransactionVerified(chainKey=3, height=25764741, txIndex=14)
0x…0FD2  TransactionVerified(chainKey=3, height=25764741, txIndex=15)
0x…0FD2  TransactionVerified(chainKey=3, height=25764741, txIndex=16)
Index41  SandwichProven(0x11111215b72E894C60F24E91ac2c8cCb1D373911, 25764741, 14, 15, 16, 219708, 219708)
Index41  HarmPaid(0x51f400b9770aD2BDdb7CF74664F5Cd1DAF6A1410, 0x9436ed9Ac85F9e39A5AE44cd598651F272c45e24, 219708)
```

Harm `219708` is the attacker's **realized profit**: `47047136` numeraire taken out on the back-run
minus `46827428` committed on the front-run, both read from `Swap` logs that are inside the proof.
It is not a counterfactual against a pre-sandwich reserve ratio — Attestcoin commits transaction
history, not state, and a contract that claimed to prove that would be lying.

## The bond actually paid

`eth_getBalance` on CC3, either side of transaction 4:

| Address | Before (block 5317815) | After (block 5317821) | Δ |
|---|---|---|---|
| victim `0x51f400b9770aD2BDdb7CF74664F5Cd1DAF6A1410` | `878832` wei | `1098540` wei | **+219708** |
| relay `0x9436ed9Ac85F9e39A5AE44cd598651F272c45e24` | 9995.98900902 CTC | 9994.98656672 CTC | −1 CTC bond − gas |

The `Δ` is exactly the harm the contract computed. The relay's bond went from `1.0 CTC` to
`1.0 CTC − 219708 wei`.

**The payee is not configurable, and that is the point.** `_payout` sends to `victim.from` — the
address the *proof* says was sandwiched, decoded out of the verified transaction bytes. It does not
pay the submitter, so there is nothing to gain by front-running a claim, which would be an ironic
way to lose this argument. That address is a mainnet EOA; the same secp256k1 key controls it on
Creditcoin, so the real victim can spend the payout. Making the payout land on some *other*
convenient address would have required either a redirect parameter (destroying the property above)
or a fabricated proof — so it was not done.

## Gas against the cap

```
calldata      17,860 bytes          utils.hex.bytesInHexString
estimate      1,140,009             eth_estimateGas
gas limit     1,539,012             utils.gas.computeGasLimit  (2.05% of cap)
GAS USED      1,092,100             1.45% of MAX_GAS_CAP       (utils.gas.gasAsPercentageOfMax)
MAX_GAS_CAP   75,000,000            utils.gas.MAX_GAS_CAP
headroom      73,907,900 gas        68.7× what the claim spent
```

Three `verifyAndEmit` calls, three `calculateTxIndex` calls, three full `EvmV1Decoder` decodes, the
ordering assertion, the harm computation, storage of the verdict and the payout — all inside a
single Creditcoin transaction using **1.45%** of the block's gas cap. The day-3 gate was that three
verifications fit under `MAX_GAS_CAP`; they fit with two orders of magnitude to spare.

## Every court ever deployed

`proveSandwich` burns three per-leg query ids plus a composite claim id, so one sandwich can be
ruled on exactly once per contract. Demonstrating an independent second run therefore needs a
second court. All of them are in [`deployment.json`](deployment.json); the ones that produced
committed evidence:

| Court | What it proved | Claim tx |
|---|---|---|
| [`0xb37Bc52b…10eC2`](https://creditcoin-testnet.blockscout.com/address/0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2) | this deployment — hosted prover, verified source | [`0xd136dea0…d243810`](https://creditcoin-testnet.blockscout.com/tx/0xd136dea0524b7e0e9eba54bf9724eec78597c2598047a96849af727f4d243810) |
| [`0x2084C677…82DDD`](https://creditcoin-testnet.blockscout.com/address/0x2084C677901067f15c59C48beFeb168b26982DDD) | the default pipeline run | [`0x53ac43ed…03b8b`](https://creditcoin-testnet.blockscout.com/tx/0x53ac43edb920c0fb5c45387e5488248696801bfa907e57402d53b3dfa6703b8b) |
| [`0xc5F604B7…66C33`](https://creditcoin-testnet.blockscout.com/address/0xc5F604B76240dc606509e1319d8B30D518566C33) | `--kill-hosted` — every proof rebuilt locally, no proof service at all | [`0xb95466d9…16fb2`](https://creditcoin-testnet.blockscout.com/tx/0xb95466d9b7c790d51a6457af9db13de88f5477091b47d005949ebce1b9516fb2) |

All three are verified on Blockscout (identical bytecode, so the explorer matched the later two
automatically). All three used **1,092,100** gas for the claim — the cost of a ruling does not
depend on where the proof came from.

## Reproducing this exactly

```bash
npm ci
npm run build:cc3                    # links Index41 against Creditcoin's deployed EvmV1Decoder
npm test                             # 120 tests: 19 mechanism · 26 bond · 52 claim · 23 harm
npm run prove -- --fresh-court       # deploy → bond → declare coverage → prove → pay
```

The signing key is read from `~/.config/creditcoin/index41-testnet.json` at runtime and is never in
this repository. Running `npm run prove` again against a court that has already ruled on this
sandwich stops at `ALREADY RULED` — the replay guard, doing its job; that transcript is committed
too, at [`pipeline-output-replay.txt`](pipeline-output-replay.txt).

Source verification is a one-liner:

```bash
FOUNDRY_PROFILE=cc3 forge verify-contract 0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2 \
  contracts/src/Index41.sol:Index41 \
  --verifier blockscout --verifier-url https://creditcoin-testnet.blockscout.com/api/ \
  --chain-id 102031 --compiler-version 0.8.23
```
