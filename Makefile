.DEFAULT_GOAL := help
.PHONY: help install dev build start lint lint-fix typecheck fmt fmt-check test test-gas \
        e2e lighthouse audit secrets security-scan ci ci-full prove capture-check clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ── Setup ───────────────────────────────────────────────────────────────────
install: ## Install npm dependencies (Foundry is separate — see book.getfoundry.sh)
	npm install

# ── The demo surface ────────────────────────────────────────────────────────
dev: ## Run the demo surface — no .env, no wallet, no API key
	npm run dev

build: ## Next.js production build
	npm run build

start: ## Serve the production build
	npm run start

# ── Code quality ────────────────────────────────────────────────────────────
lint: ## ESLint over app/ src/ scripts/, zero warnings tolerated
	npm run lint

lint-fix: ## ESLint --fix
	npm run lint:fix

typecheck: ## tsc --noEmit
	npm run typecheck

fmt: ## forge fmt (Solidity). TypeScript is hand-formatted and NOT run through Prettier.
	npm run fmt:sol

fmt-check: ## forge fmt --check
	npm run fmt:sol:check

# ── Tests ───────────────────────────────────────────────────────────────────
test: ## 120 Foundry unit tests across 4 suites
	npm test

test-gas: ## Per-test gas report
	npm run test:gas

e2e: ## Playwright E2E — 48 tests, chromium + mobile, zero config
	@echo "🎭 Playwright E2E (run 'make build' first)..."
	npm run e2e

lighthouse: ## Lighthouse CI over / and /judge
	@echo "🔦 Lighthouse CI audit..."
	npm run lighthouse

# ── Security ────────────────────────────────────────────────────────────────
audit: ## npm audit over the production dependency tree
	npm run audit

secrets: ## gitleaks over the full git history AND the working tree
	@echo "=== GITLEAKS — full history ==="
	gitleaks git --no-banner --redact .
	@echo "=== GITLEAKS — working tree ==="
	gitleaks dir --no-banner --redact .

security-scan: ## audit + secrets + licence check
	@echo "=== NPM AUDIT (production tree) ==="
	npm audit --omit=dev --audit-level=high || true
	@echo ""
	@$(MAKE) --no-print-directory secrets
	@echo ""
	@echo "=== LICENSE CHECK ==="
	npx license-checker --production --failOn "GPL-3.0;AGPL-3.0" --summary || true

# ── Gates ───────────────────────────────────────────────────────────────────
ci: ## lint + typecheck + forge fmt --check + forge test + npm audit
	npm run ci

ci-full: ## everything above, plus the Next build and the E2E suite
	npm run ci:full

# ── The real thing ──────────────────────────────────────────────────────────
prove: ## Deploy → bond → prove → pay, on CC3 testnet (needs a funded key in ~/.config)
	npm run build:cc3 && npm run prove -- --fresh-court

capture-check: ## Re-read every live source and diff the committed proof artifact
	npm run capture:check

clean: ## Remove build output and test artifacts
	rm -rf .next out cache playwright-report test-results .lighthouseci
