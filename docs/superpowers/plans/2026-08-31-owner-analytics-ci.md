# Owner analytics CI isolation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Fix PR197 E2E collection, verify CI on the exact new head, then perform the user-authorized merge.

**Architecture:** Keep the existing production-mode E2E job and all its non-analytics suites. Route the two analytics suites through their existing dedicated configs in a separate job with the exact synthetic PostgreSQL URL and Redis/OpenSSL prerequisites. No product changes.

**Tech Stack:** GitHub Actions, Node22, PostgreSQL16, Redis, Playwright, Vitest.

**Spec:** User approval of the diagnosed CI fix and merge; existing isolation contracts in `tests/config/owner-analytics-public-fixture.mjs`, `tests/helpers/analytics-database.ts`, `playwright.owner-analytics*.config.ts`. Production rollout gates remain in `docs/operations/owner-analytics.md`.

## Global constraints

- Preserve all DB/runtime guards, consent and capture gates. No real accounts, migrations, messages or manual production activation.
- Dedicated URL: `postgresql://analytics:analytics@127.0.0.1:55439/agendita_owner_analytics_test`; both DATABASE_URL and DIRECT_URL identical; runner NODE_ENV=test.
- Dedicated suites run sequentially, each with its own existing server launcher on3555; public launcher owns Redis socket/HTTPS3556. No reuse of the general job's compiled `.next` artifact or seeded DB.
- Preserve canonical checkout and current worktree. Review before commit; no force push/admin bypass/merge with failing checks.

## Task 1: Fix and verify E2E routing

Files: modify `playwright.config.ts`, `.github/workflows/ci.yml`; create `tests/unit/analytics-e2e-ci-contract.test.ts`; record evidence here.

- [ ] Add regression using the real Playwright CLI `test --list --reporter=json`: general config under the existing CI job env must list every non-analytics spec and neither analytics spec. Each dedicated config under the new job env must list exactly its suite and nonempty tests. Listing does not start servers or execute fixtures.
- [ ] Add parsed workflow contract checking the new job's DB credentials/database/port against the unchanged guards, and both explicit Playwright commands after migrations/browser install. Run `npm run test:unit -- tests/unit/analytics-e2e-ci-contract.test.ts --maxWorkers=1`; observe current guard failure/missing job before changes.
- [ ] Add only `testIgnore: ['**/owner-analytics.spec.ts', '**/owner-analytics-public.spec.ts']` to the general config.
- [ ] Add `owner-analytics-e2e` job: ubuntu-latest, Node22, PostgreSQL16 user/password analytics, database agendita_owner_analytics_test, port55439:5432; non-production synthetic environment. Install redis-server/redis-tools/openssl, `npm ci`, `npx prisma migrate deploy`, Chromium/deps; then `npx playwright test --config=playwright.owner-analytics-public.config.ts` and `npx playwright test --config=playwright.owner-analytics.config.ts`.
- [ ] Run focal new+existing CI contract tests, both real dedicated E2Es on the verified owned DB, typecheck/lint/build. Independent review of all changed files; fix/re-review if necessary before commit.
- [ ] Commit/push this scoped fix to feature/owner-analytics. Wait for all GitHub checks and report external Vercel check status without modifying provider settings.
- [ ] Refresh exact HEAD, base, diff, checks and review threads; merge PR197 with exact-head guard only when green. Verify merge result and retain worktree/artifacts. Report remaining rollout/pilot gates; no activation is authorized by this fix.

## Diagnostic evidence

Original CI run33403295661 job99525087973 failed during collection of both analytics specs: exclusive DB/non-production guard errors with general NODE_ENV=production and agendita_e2e. All other jobs including unit ultimately passed. Prior15 dedicated local E2Es passed with their separate configs, so this fix addresses CI routing/provisioning, not a demonstrated production defect.

## Local correction checkpoint (before push/remote CI)

Implementation and independent spec/quality review PASS, no open findings. General discovery preserves all14other spec files; dedicated suites each remain selected only by their own config. Guards, launchers and product unchanged.

- RED: new contract4/4failed1.88s, including the same exclusive-DB errors from real Playwright discovery.
- GREEN: new+existing CI contracts18/18; exact workflow guard/URL/service/command assertions and all3real CLI discovery calls.
- Real dedicated public E2E8/8 in32.3s; dashboard7/7 in31.2s, synthetic owned DB. No listeners3555/3556 and0businesses/users after cleanup; owned DB stopped, not removed.
- Typecheck, ESLint, actionlint and diffcheck all exit0; build exit0, compile2.6s, TypeScript5.7s,59/59static generation.
- Prior whole-feature review remains closed; this one CI follow-up diff is independently reviewed before commit. Cost of this scope decision: a cross-feature interaction could need a focused correction; all remote suites must pass before merge.

This is a commit-time checkpoint. Subsequent CI/merge evidence is the exact-head status of PR197; no production activation is implied by publishing or merging this fix.

## Remote follow-up after6ca52c7

Run33405786279 reached actual E2E execution, confirming collection/provisioning. Two blocking failures surfaced:

- General E2E: owner mobile tour expects12links, now13because this feature adds Métricas. Update the explicit expected destinations and retain staff exclusion, count, visibility and tour assertions. Settings payment selector also retried successfully; no evidence this feature caused that separate intermittent failure, so it is not changed here.
- Dedicated public E2E: desktop consent case timed out waiting for attempt bootstrap with no session request; remaining7cases passed. Store initialization occurs in an effect while SSR consent buttons are enabled. Reproduce the early-interaction window deterministically before changing it; remote logs alone do not prove the exact browser event ordering.

Follow-up scope includes the consent provider, its component/public E2E regressions, and the mobile tour expectation. No collector/storage/guard/timeout changes. Root owns synthetic DB and all browser runs. Independently review the focused follow-up, run affected tests plus type/lint/build, then publish and require all checks on the new exact SHA before merging.

Follow-up verification: independent SpecPASS/QualityPASS, no open findings. Component regression RED observed enabled consent before the provider effect; GREEN component9/9 and root related59/59. Real public final8/8 in33.4s, including SSR-held scripts inside the existing desktop booking (no additional bootstrap). Mobile tours9/9 in27.0s with the existing role/counter assertions and synthetic tours flag enabled. Build passed: compile3.6s, TypeScript15.4s,59/59static pages. No remote success or merge is implied by these local results.

Final local dashboard7/7 in27.3s, fresh typecheck and ESLint of all4changed code/test files exit0. The follow-up is ready for publication; remote exact-head gates remain required.

Discarded test arrangement: adding a separate SSR scenario introduced an extra bootstrap and triggered the real10/minute limiter in the last consent case (8passed/1failed). The check now shares the existing desktop flow; no limit, retry, timeout, IP, or production code was adjusted to bypass it. A local tours harness initially omitted its feature flag; this was corrected only in ignored QA configuration. A build invocation initially omitted required synthetic app domains and failed before compilation; the documented complete environment passed without changing validation.
