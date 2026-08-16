# Security Policy

## Scope and status

index41 is **testnet software and has not been audited.** `Index41` is deployed on Creditcoin CC3
testnet at [`0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2`](https://creditcoin-testnet.blockscout.com/address/0xb37Bc52b9d6f7431Ba8Be4deD4f53281Efb10eC2)
and holds only testnet CTC. Do not deploy it to a network where the bond is real money without an
audit.

## Supported Versions

| Version | Supported |
|---|---|
| latest (`main`) | ✅ |

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities. Instead, report them privately:

- Email **edy.cu@live.com**, or
- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security → Report a vulnerability).

You'll get an acknowledgment within 48 hours and a resolution timeline after triage. Please give a
reasonable window to patch before public disclosure.

## Secrets

No key is in this repository, and none ever has been. The relay/deployer key is read at runtime
from `~/.config/creditcoin/index41-testnet.json` (`src/config.ts`), which fails loudly if absent
rather than degrading into a simulated run.

This is enforced mechanically, not by convention:

- **gitleaks** scans the full commit history on every push, PR and weekly
  (`.github/workflows/gitleaks.yml`, `fetch-depth: 0`). Verified: 17 commits, no leaks.
- **TruffleHog** runs alongside it in the CI security stage, verified-secrets mode.
- `.gitignore` covers `.env` and `.env.*`.
- The allowlist in `.gitleaks.toml` is deliberately narrow — it names individual public keccak
  event-topic constants rather than allowlisting the `0x…64-hex` shape, because a raw EVM private
  key has exactly that shape.

## Boundary claims, each backed by a test

These are assertions in the suite, not paragraphs:

| Boundary | Enforced by | Test |
|---|---|---|
| The same sandwich cannot be claimed twice | `processedQueries` in `Index41.sol` | replay-guard tests in `Index41HarmTest`, plus the live refusal recorded in [`docs/pipeline-output-replay.txt`](../docs/pipeline-output-replay.txt) |
| Ordering is asserted, never asserted-about | `front < victim < back` in `proveSandwich` | `Index41ClaimTest` (52 tests — the shape assertion and every way to fail it) |
| Harm can never exceed what the proof shows | realized profit read from proven `Swap` logs only | `Index41HarmTest` (23 tests) |
| A position cannot be claimed, only recovered | `INativeQueryVerifier.calculateTxIndex` over the merkle path | `test_TxIndexOfRoundTripsEveryPositionInTheTree` — all 256 leaves of the depth-8 tree |
| The demo surface cannot spend anything | `app/` holds no key and no signer; `/evidence` serves an explicit allowlist and 404s everything else | `app/_lib/links.ts`, `app/evidence/[...path]/route.ts` |

## Known limitations

- Attestcoin proves transaction **history**, not **state**. Harm is the attacker's realized profit,
  never a counterfactual against a pre-sandwich reserve ratio. A contract claiming otherwise would
  be unsound; this one does not offer it.
- The contract rules on three transaction hashes supplied by the caller. It does not detect
  sandwiches itself.
