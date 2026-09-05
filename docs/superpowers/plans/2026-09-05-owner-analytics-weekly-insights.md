# Owner Analytics Weekly Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generate deterministic weekly owner analytics with an optional constrained AI narrative and durable, opt-in delivery.

**Architecture:** A deterministic engine reads closed analytics cohorts and emits facts/actions. A persisted weekly snapshot freezes those facts; a server-only OpenAI Responses adapter may narrate the snapshot with strict Structured Outputs. Generation attempts and email delivery are independently leased and budgeted. Dashboard and email degrade to deterministic facts when AI is unavailable.

**Tech Stack:** Next.js 16, TypeScript, Prisma/PostgreSQL, Zod, official OpenAI Node SDK, Resend outbox, Vitest, existing dashboard server actions.

**Spec:** `docs/superpowers/specs/2026-09-05-owner-analytics-weekly-insights-design.md`

## Estado de ejecución — 2026-09-05

- [x] Persistencia semanal, consentimiento v2, preferencias y enlace al outbox.
- [x] Selector local miércoles 09:00, cursor estable, facts determinísticos,
      denominadores explícitos y hash de snapshot.
- [x] Claims de generación con máximo dos intentos, lease/fencing, Responses API
      `store:false`, Structured Outputs y degradación determinística.
- [x] Cron, acciones owner/admin, controles de preferencias, dashboard, privacidad
      y workflow opt-in.
- [x] Email weekly congelado, revalidación de rol/preferencia y purge acotado.
- [ ] Pruebas PostgreSQL de aislamiento/retención y activación staged; requieren
      DB exclusiva, revisión legal, proveedor y autorización independiente.

## Global Constraints

- `OWNER_ANALYTICS_INSIGHTS_ENABLED=false`; no provider call without a positive global budget, explicit business allowlist, owner opt-in, privacy version 2, and source consent gate.
- Reports use one business/local week identity, immutable source/input hash, and maximum 90-day retention from the source-bounded expiry.
- Summary-only v1 and v2 weeks may be shown separately; AI requires seven complete v2 days and never mixes v1/v2/unknown.
- Minimum AI population is 20 mature complete attempts; all rates are computed server-side from explicit numerator/denominator pairs.
- Provider uses Responses API, `gpt-5.6-luna` allowlist, `store:false`, Structured Outputs, `max_output_tokens=700`, 15-second timeout, SDK retries disabled, and at most two real requests/report.
- Prompts contain canonical facts/action IDs only: no names, raw events, customer/payment data, free labels, or tenant cross-query.
- No real activation, credentials, email, or legal approval is created by these tasks; all flags remain off.

### Task 1: Add weekly schema, consent provenance, and shared outbox linkage

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260905130000_owner_analytics_weekly_insights/migration.sql`
- Modify: `src/lib/analytics/report-types.ts`
- Modify: `src/lib/analytics/policy.ts`
- Modify: `.env.example`
- Modify: `src/lib/env.ts`
- Test: `tests/unit/analytics-weekly-schema.test.ts`

**Interfaces:**
- Prisma models `AnalyticsInsightPreference`, `AnalyticsWeeklyInsight`, and `AnalyticsInsightGenerationAttempt`.
- `AnalyticsDailyMetric` and source snapshot types carry `consentVersion`.
- Config helper exposes allowlist, model, token/call limits, retry limits, and privacy gate.

- [ ] **Step 1: Write failing schema/config tests** for stable `businessId + weekStart`, nullable snapshot narrative, generation leases, attempt uniqueness, consent v1/v2, and false/empty defaults.
- [ ] **Step 2: Run focused tests and confirm failure.**
- [ ] **Step 3: Add additive Prisma models and the shared `AnalyticsEmailDelivery` weekly parent relation.** Use checks for statuses, one attempt number per report, one recipient, and 90-day expiry.
- [ ] **Step 4: Add `consentVersion` to daily metrics and source provenance.** Preserve v1 reads/writes during compatibility; do not backfill unverified data as v2.
- [ ] **Step 5: Add migration SQL/indexes and config parsing.** Reject enabled production config without model allowlist, positive budget, privacy approval, and business IDs.
- [ ] **Step 6: Run Prisma validate, generation, and focused tests.**
- [ ] **Step 7: Commit `feat(analytics): add weekly insights persistence and consent provenance`.**

### Task 2: Implement stable weekly selector and deterministic facts engine

**Files:**
- Create: `src/server/analytics/weekly-insights/selector.ts`
- Create: `src/server/analytics/weekly-insights/facts.ts`
- Create: `src/server/analytics/weekly-insights/actions.ts`
- Modify: `src/server/analytics/reports.ts`
- Modify: `src/server/analytics/flow-breakdowns.ts`
- Test: `tests/unit/analytics-weekly-selector.test.ts`
- Test: `tests/unit/analytics-weekly-facts.test.ts`
- Test: `tests/integration/analytics-weekly-facts.test.ts`

**Interfaces:**
- `selectWeeklyInsightCandidates(input: {now:Date; cursor:string|null; limit:number}): Promise<{candidates:WeeklyCandidate[]; nextCursor:string|null}>`.
- `buildWeeklyFacts(input: {businessId:string; weekStart:Date; now:Date}): Promise<WeeklyFactsResult>`.
- `WeeklyFactsResult` is `{status:'insufficient_data'|'deterministic_ready'; sourceConsentVersion; facts; sourceExpiry; inputHash; reasonCode?}`.

- [ ] **Step 1: Write failing selector tests** for local Wednesday 09:00, DST, week interval, stable timezone transition, two-week catch-up, terminal/in-progress statuses, and cursor continuation.
- [ ] **Step 2: Write failing facts tests** for seven publication markers, v1/v2 separation, 20 mature attempts, exact denominator formulas, stale availability, optional payment branches, no free labels, and max-three deterministic signal ordering.
- [ ] **Step 3: Implement date/coverage selector.** Query closed publication markers by business timezone and source consent, exclude unknown/mixed weeks, cap candidates and return a durable cursor.
- [ ] **Step 4: Implement facts/action catalog.** Reuse report/reducer semantics; create canonical `factId`, evidence counts, server `confidence:'limited'`, `actionIds`, caveats, source expiry, and canonical JSON hash.
- [ ] **Step 5: Add integration fixtures** proving tenant isolation, v1 summary-only behavior, no zero for missing history, and retention-derived expiry.
- [ ] **Step 6: Run focused unit/integration facts tests and typecheck.**
- [ ] **Step 7: Commit `feat(analytics): compute deterministic weekly insights`.**

### Task 3: Implement durable generation claims and OpenAI adapter

**Files:**
- Create: `src/server/analytics/weekly-insights/generation.ts`
- Create: `src/server/analytics/weekly-insights/openai-narrator.ts`
- Create: `src/server/analytics/weekly-insights/narrative-schema.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/unit/analytics-narrative-schema.test.ts`
- Test: `tests/unit/analytics-generation.test.ts`
- Test: `tests/integration/analytics-generation-budget.test.ts`

**Interfaces:**
- `claimWeeklyGeneration(input: {weeklyInsightId:string; now:Date}): Promise<GenerationClaim|null>`.
- `narrateWeeklyFacts(input: {facts:CanonicalWeeklyFacts; model:string; now:Date}): Promise<NarrativeResult>`.
- `finalizeWeeklyGeneration(input: {claim:GenerationClaim; result:NarrativeResult; now:Date}): Promise<void>`.

- [ ] **Step 1: Add official `openai` dependency and failing adapter tests** with a mocked Responses client.
- [ ] **Step 2: Define Zod/JSON Schema** with summary max 320 chars, max three findings, received `factId/actionId` enums, caveats enum, and no model-owned confidence.
- [ ] **Step 3: Implement global PostgreSQL advisory lock budget.** Reserve one `AnalyticsInsightGenerationAttempt` per actual HTTP request, enforce max two/report and weekly call/token limits, and persist circuit breaker probe state in the weekly heartbeat.
- [ ] **Step 4: Implement server-only Responses adapter.** Use `store:false`, `text.format` strict schema, `reasoning.effort:'none'`, 700 output cap, 15-second timeout, `maxRetries:0`, and canonical input only.
- [ ] **Step 5: Implement lease/fencing.** A 45-second generation lease and CAS finalization discard late results; timeout/rate-limit/5xx may schedule one second attempt after one hour; auth/billing/schema/refusal/config errors are terminal.
- [ ] **Step 6: Validate returned IDs and fact references against the frozen snapshot.** Store usage/provider ID only; never store prompt/raw response/provider error text.
- [ ] **Step 7: Run focused unit/integration tests, typecheck, and lint.**
- [ ] **Step 8: Commit `feat(analytics): add constrained weekly insight narrator`.**

### Task 4: Add weekly scheduler, privacy preferences, and dashboard server actions

**Files:**
- Create: `src/app/api/cron/owner-analytics-insights/route.ts`
- Create: `src/server/analytics/weekly-insights/job.ts`
- Create: `src/server/actions/weekly-insights.ts`
- Modify: `src/app/dashboard/metricas/page.tsx`
- Modify: `src/components/dashboard/analytics/analytics-dashboard.tsx`
- Create: `src/components/dashboard/analytics/weekly-insight-card.tsx`
- Modify: `src/app/privacy/page.tsx`
- Modify: `.github/workflows/owner-analytics.yml`
- Test: `tests/unit/analytics-insights-cron.test.ts`
- Test: `tests/unit/weekly-insights-actions.test.ts`
- Test: `tests/unit/analytics-privacy.test.ts`

**Interfaces:**
- `runWeeklyInsightsJob(input: {now:Date; cursor:string|null}): Promise<{processed:number; nextCursor:string|null}>`.
- Owner/admin actions `getWeeklyInsights`, `setWeeklyInsightPreferences` enforce tenant membership and privacy version.
- Cron route requires `CRON_SECRET`, no body/query except cursor, and no-store.

- [ ] **Step 1: Write failing route/action/UI tests** for auth, cursor, deadline, owner/admin authorization, separate AI/email toggles, privacy v2, stale/insufficient/generation-failed states, and deterministic-only display.
- [ ] **Step 2: Implement the hourly job with 40-second deadline, 20-request cap, concurrency 1, durable weekly cursor, candidate claim, facts persistence, generation claim, and no work after 20 seconds remain.**
- [ ] **Step 3: Implement preference action.** Validate membership/role, one recipient owner/admin, `aiNarrativeEnabled` requires accepted privacy version 2, and turning off email cancels unstarted outbox deliveries.
- [ ] **Step 4: Update privacy copy to describe provider, aggregated fields, retention, opt-out, and v2 consent.** Keep current v1 text accurate while v2 remains disabled.
- [ ] **Step 5: Add dashboard card/history.** Display deterministic facts for v1/v2 separately, use narrative only when `ready`, show server confidence/caveats, and hide expired snapshots.
- [ ] **Step 6: Add an opt-in workflow flag/URL to GitHub Actions without enabling it.**
- [ ] **Step 7: Run focused route/action/privacy/UI tests, lint and typecheck.**
- [ ] **Step 8: Commit `feat(analytics): add weekly insight scheduler and dashboard`.**

### Task 5: Deliver weekly email through outbox and enforce retention

**Files:**
- Modify: `src/server/analytics/weekly-insights/job.ts`
- Modify: `src/server/analytics/operations/email-outbox.ts`
- Modify: `src/server/analytics/maintenance.ts`
- Modify: `src/lib/notifications/email-provider.ts`
- Modify: `tests/integration/analytics-retention.test.ts`
- Create: `tests/unit/weekly-insight-email.test.ts`

- [ ] **Step 1: Write failing tests** for deterministic-only email, frozen payload, preference revocation before send, recipient role loss, ambiguous delivery, three-attempt/23-hour cutoff, and source-bounded 90-day expiry.
- [ ] **Step 2: Implement weekly digest outbox creation.** Use one stable `weeklyInsightId:weekly_digest` key, freeze recipients/payload, and never generate a new AI report from an email retry.
- [ ] **Step 3: Implement delivery worker reuse.** Revalidate authorization before retry, preserve the original recipient/payload after an attempt, and reconcile ambiguous sends without duplicate keys.
- [ ] **Step 4: Extend maintenance purge.** Hide and delete expired weekly insights, generation attempts, and outbox payloads within the bounded budget; retain current heartbeat and unresolved incidents.
- [ ] **Step 5: Run focused email/retention/integration tests and the full unit suite.**
- [ ] **Step 6: Commit `feat(analytics): deliver opt-in weekly insight emails`.**

### Task 6: Staged verification and handoff

**Files:**
- Modify: `docs/operations/owner-analytics.md`
- Modify: `docs/operations/owner-analytics-completion-audit.md`
- Modify: `docs/operations/owner-analytics-insights-activation.md`

- [ ] **Step 1: Document flags, migrations, runbook, synthetic provider tests, privacy/legal gate, and seven-day measurement gate.**
- [ ] **Step 2: Run Prisma validate, typecheck, lint, focused operational/weekly tests, full unit tests, and existing analytics E2E contracts.**
- [ ] **Step 3: Verify every new flag remains false/empty and no real OpenAI/Resend request occurs in CI.**
- [ ] **Step 4: Record exact SHAs and limitations; do not call this active production capture until the explicit pilot gate is met.**
- [ ] **Step 5: Commit `docs(analytics): document weekly insights activation runbook`.**
