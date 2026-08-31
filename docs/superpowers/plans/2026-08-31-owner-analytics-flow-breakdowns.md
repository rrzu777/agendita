# Owner analytics flow breakdowns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the approved professional/payment/error breakdowns (G2), without altering conversion, capture or retention.

**Architecture:** Extend the existing reducer with a current-context observation projection, aggregate bounded retained raw reads in a separate server-only transaction, and expose a minimal DTO on the existing owner report. Render four explicitly separate populations using the existing dashboard components.

**Tech Stack:** Existing TypeScript, Next.js16.3.2, React, Prisma/PostgreSQL, Vitest, Playwright. No dependencies or migrations.

**Spec:** `docs/superpowers/specs/2026-08-31-owner-analytics-flow-breakdowns-design.md`, supplement to the original design §4/§5/§7.3/§10.

## Global Constraints

- Work only in `/Users/robertozamorautrera/Projects/agendita/.worktrees/owner-analytics`, branch `feature/owner-analytics`; preserve the canonical checkout.
- La unidad es intento, no evento, persona ni profesional atendiendo una reserva.
- Usar sólo crudo todavía retenido en la ventana seleccionada, máximo90d. No añadir nuevas tablas, dimensiones históricas ni extender retención.
- No cambiar captación, contadores publicados, Booking, pago, retención, permisos, configuración de producción ni dependencias.
- Sin push/PR/merge/deploy, cron real, cuentas reales, email ni cobros. No leer archivos .env.
- Owner/admin only; tenant derived from authenticated session; no raw/PII/credentials in the DTO. Existing one-filter-only contract stays.
- `[report.period.from, report.period.to)`; frozen source cohort/date/zone, same cutoff. No preset expansion to today.
- `available|empty|not_retained|incomplete_source|limit_exceeded|error`; unavailable groups are null, never zero/partial prefix.
- Limits:10000 combined sessions+attempts/range before filtering,200events/attempt,50000events/range; sentinel reads. RepeatableRead maxWait5000/timeout15000.
- Read relevant installed Next guides before code; apply_patch edits; TDD evidence. Task review before final task commit (controller commits after review).
- No worker subagents. Controller owns review and the final full matrix. Workers run focused suites only; do not duplicate the global matrix.
- Safe tests: `env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin HOME="$HOME" DATABASE_URL=postgresql://analytics:analytics@127.0.0.1:55439/agendita_owner_analytics_test DIRECT_URL=postgresql://analytics:analytics@127.0.0.1:55439/agendita_owner_analytics_test NEXT_PUBLIC_SUPABASE_URL=https://analytics-e2e.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=analytics-e2e-anon-key PAYMENT_PROVIDER=manual OWNER_ANALYTICS_ENABLED=false` prefix; do not set APP_DOMAIN in units. PostgreSQL already provisioned with55existing migrations. Verify current replacement container before DB tests: `4a5acd250822a94195a1167a98cb6f29b4ca3a514dd870e2eec73337ee1f6d01`, label codex.task=owner-analytics-goal, no host/data-volume mounts, localhost55439, CPU1/memory512MiB. Former container7a4bd787 exited after tmpfs256m filled during boundary fixture; see ledger/runbook. Never touch other containers.

## File structure and shared interfaces

- `src/lib/analytics/flow-breakdowns.ts`: enum-key distributions and pure grouping; no server imports.
- `src/lib/analytics/report-types.ts` + `funnel.ts`: DTO types and `AttemptProjection.flow` with current professional/payment/errors from the shared reducer.
- `src/server/analytics/flow-breakdowns.ts`: bounded server-only raw reader, safe statuses; no capture or mutations.
- `src/server/analytics/reports.ts`: required `flowBreakdowns: FlowBreakdownsReport`, called after existing authorized summary transaction succeeds.
- `src/components/dashboard/analytics/flow-breakdowns.tsx`: accessible read-only section using the DTO, existing Card/table styling.
- `src/components/dashboard/analytics/analytics-dashboard.tsx`: renders the section regardless of historical summary availability.
- Test helpers with typed `OwnerAnalyticsReport` fixtures must add an explicit empty/unavailable flow result; never cast away required DTO checks.

```ts
// Public DTO shape; exact enum types derive from AnalyticsEventInput.
type FlowBreakdownsStatus = 'available' | 'empty' | 'not_retained' | 'incomplete_source' | 'limit_exceeded' | 'error'
interface FlowBreakdownsReport {
  status: FlowBreakdownsStatus
  from: string; to: string; cutoffAt: string; timezones: string[]
  scope: 'all_attempts' | 'channel' | 'acquisition_link' | 'final_service'
  groups: FlowBreakdownGroup[] | null
}
// Group entryKind complete/partial and maturity mature/in_progress; exactly four.
// Each carries attempts, incompleteCapture, and enum-count records:
// professional (kind + explicit/not_required/not_observed), screen,
// condition, offeredMethods, selectedMethod, errors.
// Singular distributions include not_observed; offeredMethods includes
// not_observed and none_offered, mutually exclusive with actual methods.
```

### Task 1: Current-context projection and bounded owner read

**Files:**
- Create `src/lib/analytics/flow-breakdowns.ts`, `src/server/analytics/flow-breakdowns.ts`.
- Modify `src/lib/analytics/funnel.ts`, `src/lib/analytics/report-types.ts`, `src/server/analytics/reports.ts`.
- Test `tests/unit/analytics-flow-breakdowns.test.ts`, `tests/integration/analytics-flow-breakdowns.test.ts`.
- Modify only typed report fixtures required by the new field, and add independent failure-isolation tests in the appropriate report test.

**Interfaces:**
- Consumes `reduceFunnelAttempt({attempt,events,bookings,now})`, `AnalyticsEventInput`, existing authenticated report filters.
- Produces `AttemptProjection.flow`, `FlowBreakdownsReport`, `FlowBreakdownGroup`, `report.flowBreakdowns` and pure grouping function `aggregateFlowBreakdowns(projections: AttemptProjection[]): FlowBreakdownGroup[]`.
- Internal `readOwnerAnalyticsFlowBreakdowns({businessId,from,to,channel?,acquisitionLinkId?,serviceId?},now)` is server-only, not a server action/public endpoint; only authorized report calls it. It owns the separate read transaction and catches only its failures.

- [x] **Step 1: RED reducer/group contracts.** Use existing `tests/helpers/analytics-fixtures.ts`. Example assertion:

```ts
const p = reduceFunnelAttempt({attempt: attempt(), events: completePath(), bookings: [], now})
expect(p.flow.payment).toMatchObject({screen: 'sin-abono', condition: 'no_deposit', selectedMethod: null})
expect(aggregateFlowBreakdowns([p])[0]).toMatchObject({entryKind: 'complete', maturity: 'mature', attempts: 1})
```

Test explicit anyone/person vs automatic/required-unobserved/none; no preselected method; A→B and lost revisions clear stale details; date change preserves compatible professional; payment/package/promo changes clear payment; partial entry observes valid payment without inventing previous steps; replay/out-of-order/stale availability generation; error enums deduplicated/current-context only; cutoffs/deadlines. Existing funnel numerical outputs must remain unchanged.

- [x] **Step 2: Run RED.** `npm run test:unit -- tests/unit/analytics-flow-breakdowns.test.ts --maxWorkers=1`. Record missing API/assertion output, not setup failures as evidence.
- [x] **Step 3: Implement projection and grouping.** Add flow state to existing switch/invalidation points; do not create a second event reducer. `payment` holds screen/condition/offeredMethods/selectedMethod or null, professional holds kind/choice or null, errors is a closed-key set flattened in stable order. Group each attempt exactly once in its entry/maturity bucket, enum counts only, sorted stable DTO keys. Keep history metrics untouched.
- [x] **Step 4: RED PostgreSQL/DAL boundary.** Add fixtures scoped to two synthetic businesses. Assert real report flow results and minimal serialization, roles and foreign/multi filters; current final service vs considered service; historical frozen timezone; boundary/read cutoff; pre-purge expired rows; frozen marker even after all raw removed; mismatched accepted count; invalid stored payload; unknown version; empty vs unavailable; 10000source and50000event limits with sentinel guards. Test server query rejection yields `status:error`, `groups:null` while original summary remains accessible.

```ts
const report = await getOwnerAnalyticsReport({from: '2026-08-10', to: '2026-08-11'}, now)
expect(report.flowBreakdowns.status).toBe('available')
expect(report.flowBreakdowns.groups).toEqual(expect.arrayContaining([
  expect.objectContaining({entryKind: 'partial', maturity: 'mature', attempts: 1}),
]))
expect(JSON.stringify(report.flowBreakdowns)).not.toContain(privateAttemptId)
```

- [x] **Step 5: Implement bounded read/integration.** Read markers and source headers before events; validate bounds/expiry/version/frozen markers. Session headers only serve load/expiry/version guards; do not fetch session surface events. Source and attempt-event caps checked before returning any counts. Page50attempts; parse through analyticsEventSchema, require attempt accepted count consistency, call the same reducer with empty bookings. Channel/link filter immutable acquisition; service filter finalContext only. Read all candidates before filters for honest availability. Use the separate RepeatableRead transaction; on exception return error only for details. A main-report auth/filter failure still rejects normally.
- [x] **Step 6: Verify focused matrix and static checks.** Unit new+analytics-funnel/daily-metrics/reports, integration new+analytics-report-isolation/retention/rollups; typecheck, ESLint changed TS/TSX, git diff --check. Do not run full unrelated suites. Report exact commands, RED/GREEN output, changed files and unresolved concerns to task report.
- [x] **Step 7: Controller task review → fixes/re-review → verify → commit.** No implementation worker commits before the review gate; snapshot working diff with review-package's working-tree support if available, else a tooling-generated patch artifact. Intended commit `feat(analytics): project retained flow breakdowns for owner reports`.

### Task 2: Dashboard breakdowns and synthetic desktop/mobile proof

**Files:**
- Create `src/components/dashboard/analytics/flow-breakdowns.tsx`, `tests/unit/analytics-flow-breakdowns-ui.test.tsx`.
- Modify `src/components/dashboard/analytics/analytics-dashboard.tsx`, `tests/unit/analytics-dashboard.test.tsx`, `tests/e2e/owner-analytics.spec.ts`, existing E2E fixture/helper only as required to seed flow observations.

**Interfaces:**
- Consumes Task1 `FlowBreakdownsReport` and `OwnerAnalyticsReport.flowBreakdowns`.
- Produces `FlowBreakdowns({report}: {report: FlowBreakdownsReport})`, rendered by AnalyticsDashboard. No client query or mutation.

- [x] **Step 1: RED rendering contract.** Seed four populations with asymmetric values; assert names/counts never mixed, singular unknown evidence not «no eligió», explicit vs optional professional, payment screen/condition/method distinct and chosen not paid. Offered methods/errors explicitly non-additive. All six statuses have distinct text, unavailable renders no count tables.

```tsx
render(<FlowBreakdowns report={unavailableFlow} />)
expect(screen.getByRole('heading', {name: 'Detalle del flujo observado'})).toBeVisible()
expect(screen.queryByRole('table')).not.toBeInTheDocument()
expect(screen.getByText(/no se reconstruye/i)).toBeVisible()
```

- [x] **Step 2: Run RED.** `npm run test:unit -- tests/unit/analytics-flow-breakdowns-ui.test.tsx --maxWorkers=1`; capture missing behavior before code.
- [x] **Step 3: Implement read-only UI.** Existing Card/text/table style, responsive stacked content with local overflow only; no redesign/library. Four population sections with headings and counts, closed Spanish label maps and no raw enums/IDs. Group each dimension in compact tables/list; collapse verbose breakdowns with native details/summary if useful (keyboard accessible, no forced animation). Display window exclusive end, cutoff, zones, scope incl final_service exact meaning. Explain max90d/limits and evidence, unknown not negative, selected not paid, errors not causal. Render outside historical-summary success conditional. Avoid duplicating main conversion KPIs.
- [x] **Step 4: RED then GREEN real dashboard E2E.** Extend existing synthetic fixture to include retained professional/payment/error observations; no real accounts. Actual dashboard must show count/labels across desktop and mobile, final-service filter scope and unknown/status labels. Assert keyboard expansion, no page horizontal overflow, table/text alternative. Screenshot both layouts for controller inspection.
- [x] **Step 5: Verify.** New UI unit+analytics-dashboard/controls/links, `npx playwright test --config=playwright.owner-analytics.config.ts`, typecheck, changed ESLint, diff-check. Preserve fixture cleanup and no3555/3556 listeners. Record RED/GREEN and screenshot paths.
- [x] **Step 6: Controller review → fixes/re-review → verification → commit.** Intended commit `feat(analytics): show professional payment and error breakdowns`.

## Final acceptance (controller, after both tasks)

### Final review fix wave (original MVP requirements)

Whole-branch review of `c5ea714..55d7fe3`: G2 compliant, no Critical. One Important:
original spec§9 collector operational counters missing; one Minor: service table
«Sin recorrido» mislabels conversions without observed interest. Single grouped
fix wave, unchanged capture/financial semantics, no activation/new storage.

- [x] RED/GREEN collector terminal request and committed receipt categories through existing per-instance operational sink; finite labels, noPII, instrumentation fail-open, statuses/headers/budgets/transaction semantics intact.
- [x] RED/GREEN «Conversiones sin interés observado», including coherent path without interest and twoBookings→one attempt-service conversion; no formula change.
- [x] Focused checks → one scoped independent re-review → controller commit.
- [ ] Final global checks on fixed code; DB suite alone (prior50kfixture timedout with unit overlap, unchanged isolated test passed).

### Acceptance and handoff

- Audit supplement cases and original§10 against actual assertions; no capture-only claim for presentation.
- Whole branch review with focused G2 seams and previous audit as context; not redispatch completed tasks.
- Full unit and integration once on final code, both synthetic E2E suites, typecheck/lint changed branch files/build (never vercel-build). Record actual failed runs and exact fixes, not only green summaries.
- Reconcile spec/plan/runbook/completion audit: G1/G2 implemented only after evidence; production/IA13months gates remain explicit.
- Commit local work and leave branch/worktree intact for user; no publishing/integration without request.
