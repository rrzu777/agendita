# TypeScript Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current 17 test-only TypeScript errors into a clean, enforced `npm run typecheck` baseline without changing runtime behavior.

**Architecture:** Correct the four inaccurate test mocks/fixtures at their source, then add a dedicated package script and CI job. Keep `tsconfig.json` at `target: ES2017`; tests must not force a production target change merely to use BigInt literal syntax.

**Tech Stack:** TypeScript, Vitest, NextRequest, GitHub Actions, npm.

## Global Constraints

- Deliver this plan in a separate PR based directly on `origin/main` before rebasing the Web Push branch.
- Do not change production behavior or loosen TypeScript strictness.
- Do not change `tsconfig.json` target or exclude tests from typechecking.
- Preserve all existing test assertions.

---

### Task 1: Correct test fixture types

**Files:**
- Modify: `tests/unit/create-booking-no-deposit.test.ts`
- Modify: `tests/unit/mercado-pago-oauth.test.ts`
- Modify: `tests/unit/metrics.test.ts`
- Modify: `tests/unit/reward-email.test.ts`

**Interfaces:**
- Consumes: production signatures of Prisma transaction clients, `createClient`, `NextRequest`, and `sendLoyaltyRewardNotification`.
- Produces: test doubles assignable to those signatures with no runtime behavior change.

- [ ] **Step 1: Capture the failing baseline**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected: 17 diagnostics in exactly the four files above.

- [ ] **Step 2: Fix the Prisma transaction mock shape**

Add the missing member to the root fixture and stop optional-chaining a property TypeScript correctly says does not exist:

```ts
const mockPrisma = {
  business: { findUnique: vi.fn() },
  service: { findFirst: vi.fn() },
  timeBlock: { findMany: vi.fn().mockResolvedValue([]) },
  // existing members stay unchanged
}

// inside tx
timeBlock: { findMany: mockPrisma.timeBlock.findMany },
```

- [ ] **Step 3: Make the Supabase callback mock explicitly test-shaped**

In `mercado-pago-oauth.test.ts`, type the partial return at the single mock boundary:

```ts
type AuthMiddlewareModule = typeof import('@/lib/auth/middleware')
type CreateClientResult = Awaited<ReturnType<AuthMiddlewareModule['createClient']>>

vi.mocked(createClient).mockResolvedValue({
  auth: mockSupabaseAuth,
} as unknown as CreateClientResult)
```

Do not weaken the production `createClient` type.

- [ ] **Step 4: Use NextRequest and ES2017-compatible BigInt construction**

In `metrics.test.ts`:

```ts
import { NextRequest } from 'next/server'

const authed = () =>
  new NextRequest('http://localhost:3000/api/metrics', {
    headers: { authorization: `Bearer ${SECRET}` },
  })
```

Replace every literal such as `5n` with `BigInt(5)` and every direct
`new Request(...)` passed to `GET` with `new NextRequest(...)`.

- [ ] **Step 5: Give the notification mock a real call signature**

In `reward-email.test.ts`:

```ts
import type { LoyaltyRewardEmailData, EmailResult } from '@/lib/notifications/types'

const sendLoyaltyRewardNotification = vi.hoisted(() =>
  vi.fn<(data: LoyaltyRewardEmailData) => Promise<EmailResult>>(
    async () => ({ success: true }),
  ),
)
```

Import those types from their defining `@/lib/notifications/types` module to
avoid loading notification infrastructure.

- [ ] **Step 6: Verify focused tests and the compiler**

Run:

```bash
npm test -- tests/unit/create-booking-no-deposit.test.ts tests/unit/mercado-pago-oauth.test.ts tests/unit/metrics.test.ts tests/unit/reward-email.test.ts
npx tsc --noEmit --pretty false
```

Expected: focused tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit the fixture corrections**

```bash
git add tests/unit/create-booking-no-deposit.test.ts tests/unit/mercado-pago-oauth.test.ts tests/unit/metrics.test.ts tests/unit/reward-email.test.ts
git commit -m "test: restore strict TypeScript baseline"
```

### Task 2: Enforce typechecking in local and CI workflows

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: clean compiler baseline from Task 1.
- Produces: `npm run typecheck` and a blocking `typecheck` CI job.

- [ ] **Step 1: Add the package script**

Add alongside `lint`:

```json
"typecheck": "tsc --noEmit --pretty false"
```

- [ ] **Step 2: Add a dedicated CI job**

Add after `lint`:

```yaml
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
```

- [ ] **Step 3: Verify all quality gates**

Run:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

Expected: all commands exit 0. Build may print documented provider warnings but no errors.

- [ ] **Step 4: Commit CI enforcement**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "ci: enforce TypeScript typecheck"
```

### Task 3: Review and ship the baseline PR

**Files:**
- Review all files changed in Tasks 1–2.

**Interfaces:**
- Produces: merged TypeScript baseline required by the Web Push plan.

- [ ] **Step 1: Run the Build-Review-Ship review gate**

Request an independent review for correctness, accidental production changes,
mock fidelity and CI coverage. Fix every HIGH/CRITICAL and all reasonable MEDIUM findings, then request re-review.

- [ ] **Step 2: Refresh verification after the final fix**

```bash
git diff --check origin/main...HEAD
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

- [ ] **Step 3: Push, create and merge the PR**

Push a `feature/` branch, create a ready PR, wait for exact-head checks, review
the final diff and unresolved threads, then squash-merge only if all are green.

- [ ] **Step 4: Rebase the Web Push worktree**

After updating the canonical `main`, rebase
`feature/push-cancellation-warnings` onto the new `origin/main` and rerun
`npm run typecheck` before beginning its first production-code task.
