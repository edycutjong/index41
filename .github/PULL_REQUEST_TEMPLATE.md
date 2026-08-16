## Summary
<!-- What does this PR change and why? -->

## Changes
-

## Checklist
- [ ] `npm run ci` passes (ESLint, tsc, `forge fmt --check`, 120 forge tests, npm audit)
- [ ] `npm run build && npm run e2e` passes (Playwright, 48 tests)
- [ ] Tests added/updated, and named after the defect they pin
- [ ] No key, `.env`, or kitchen file added — `npm run secrets` is clean
- [ ] Docs / README updated if behavior changed

## The one that matters
- [ ] **This PR does not mock the judged capability.** No hard-coded transaction index under
      `app/`, no third source of numbers, no flag that makes the demo stop reading the chain.

## Related Issues
Closes #
