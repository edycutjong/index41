<p align="center">
  <img src="docs/assets/readme-hero-animated.svg" alt="index41 — The instant laterality decodes, three slate transactions lock into gold indices 41 → 42 → 43 — position becomes fact." width="100%">
</p>

<h1 align="center">index41</h1>

<p align="center"><b>Proves transaction A executed <i>before</i> B inside an Ethereum block — a fact carried in no payload, readable by no oracle — and makes a relay's bond pay for breaking its no-sandwich promise.</b></p>

<p align="center">
  <img src="docs/assets/icon-animated.svg" alt="index41 — The instant laterality decodes, three slate transactions lock into gold indices 41 → 42 → 43 — position becomes fact." width="96">
</p>

> Built for BUIDL CTC 2026 Fall (DoraHacks) · DeFi track. Full README lands with the code.

## Live on CC3 testnet

A real Ethereum **mainnet** sandwich, ruled on by a bonded contract on Creditcoin. Open any of these.

| | |
|---|---|
| Index41 (source verified) | [`0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2`](https://creditcoin-testnet.blockscout.com/address/0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2) |
| The ruling — 3× `verifyAndEmit` in one transaction | [`0xd136dea0…d243810`](https://creditcoin-testnet.blockscout.com/tx/0xd136dea0524b7e0e9eba54bf9724eec78597c2598047a96849af727f4d243810) |
| Mainnet block / recovered positions | `25764741` · **14 → 15 → 16**, read out of merkle laterality by `calculateTxIndex` |
| Harm paid from the bond | `219708` wei, to the address the *proof* says was sandwiched |
| Gas | 1,092,100 — **1.45%** of `MAX_GAS_CAP` |

Deploy tx, bond tx, before/after balances and every explorer link: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
How the proof is built and audited: [`docs/PIPELINE.md`](docs/PIPELINE.md).
