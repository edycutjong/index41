# Contributing to index41

Thanks for your interest in index41.

This repository is three projects in one, and the setup differs per part. Read the part you are
touching.

## Getting Started

```bash
git clone --recurse-submodules <repo-url>   # lib/forge-std is a submodule
cd index41
npm install
```

You need **Node ≥ 20** and, for anything under `contracts/`,
[Foundry](https://book.getfoundry.sh/getting-started/installation).

### The demo surface (`app/`)

```bash
npm run dev        # http://localhost:3000
```

No `.env`, no wallet and no API key. The page reads a real Creditcoin CC3 receipt over public
JSON-RPC and falls back to `data/proof-artifact.json` if that node is unreachable. If you add a
third source of numbers to this page, the PR will be rejected — see below.

### The contracts (`contracts/`)

```bash
forge build
forge test --summary      # 120 tests across 4 suites
forge test --gas-report
```

### The proving pipeline (`src/`)

`npm run prove` submits a real transaction on CC3 testnet and needs a funded key at
`~/.config/creditcoin/index41-testnet.json`. **Never** put a key in this repository — `gitleaks`
scans the full history in CI and will fail the build.

## Before You Open a PR

```bash
npm run ci     # lint + typecheck + forge fmt --check + 120 forge tests + npm audit
npm run e2e    # Playwright, 54 tests (needs `npm run build` first)
```

- Add or update tests for any behavior change. Name regression tests after the defect they pin,
  not after the function they call.
- Keep commits conventional (`feat:`, `fix:`, `docs:`, `chore:`, `contract:`, `ci:`).
- Solidity is formatted by `forge fmt`. TypeScript is **not** run through Prettier — the source is
  hand-formatted with aligned comment blocks, and reformatting it is not a welcome PR.

## The one rule that gets a PR closed

**Never mock the judged capability.** The demo shows real proven data or it does not ship. A change
that makes the page "deterministic" by making it stop reading the chain, or that hard-codes a
transaction index anywhere under `app/`, defeats the entire point of the project. There are exactly
two sources of numbers — a live chain read and a captured-from-live artifact — and the UI always
names which one is on screen.

## Reporting Bugs / Requesting Features

Open an issue using the provided templates. For anything security-related, do **not** open a public
issue — see [SECURITY.md](SECURITY.md).
