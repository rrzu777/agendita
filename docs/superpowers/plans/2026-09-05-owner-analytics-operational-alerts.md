# Owner Analytics Operational Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist maintenance heartbeats, detect stale or unhealthy analytics operations independently, and deliver deduplicated internal alerts without affecting booking or capture.

**Architecture:** PostgreSQL stores one fenced heartbeat per job, incident lifecycles, and a durable email outbox. The maintenance route records a complete run only after all bounded continuations finish; a separate production-health probe evaluates stale state and claims outbox deliveries with leases. All new behavior is disabled by default.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Prisma/PostgreSQL, GitHub Actions, existing Resend provider, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-owner-analytics-operational-alerts-design.md`

## Estado de ejecución — 2026-09-05

- [x] Schema/configuración aditiva, flags fail-closed y constraints de outbox.
- [x] Heartbeat con lease, cursor/sequence, CAS y driver de continuaciones.
- [x] Evaluador de incidentes, thresholds, advisory locks y outbox Resend
      idempotente con revalidación weekly de destinatario.
- [x] Monitor autenticado independiente, body/query guard, health-check opcional
      y workflow preparado sin activación.
- [x] Purge acotado de payloads semanales/incidentes resueltos y runbook de
      activación/rollback.
- [x] El heartbeat semanal comparte el contrato de fencing y el driver conserva
      el cursor confirmado para reanudar una corrida acotada.
- [x] Aplicar las migraciones en una DB disposable y ejecutar las pruebas
      PostgreSQL locales desde cero; las 57 migraciones y la matriz operativa
      pasan.
- [ ] Ejecutar CI remoto, staging y producción; siguen siendo gates externos y
      no se simulan con typecheck o build.

## Global Constraints

- `OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED=false` and `OWNER_ANALYTICS_ALERTS_ENABLED=false` by default.
- Maintenance success means one complete run with `hasMore=false`, no accumulated errors, and no dangerous retention backlog.
- All cron routes require `CRON_SECRET`, reject unexpected input, and send `Cache-Control: no-store`.
- No incident detail, heartbeat JSON, or email payload may contain customer data, tenant IDs, stack traces, or raw provider errors.
- No operational failure may mutate Booking, payment, ledger, or capture semantics.
- Resend delivery uses one frozen payload, one dedupe key, leases, CAS fencing, and a 23-hour automatic retry cutoff.
- Use `apply_patch`; preserve unrelated worktree changes; commit each independently testable task.

### Task 1: Add durable operational schema and configuration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260905120000_owner_analytics_operations/migration.sql`
- Modify: `.env.example`
- Modify: `src/lib/env.ts`
- Test: `tests/unit/analytics-operational-schema.test.ts`

**Interfaces:**
- Produces Prisma models `AnalyticsJobHeartbeat`, `AnalyticsOperationalIncident`, and `AnalyticsEmailDelivery`.
- Produces validated server helpers `getOwnerAnalyticsOperationsConfig()` and `getOwnerAnalyticsMonitorExpected()`.

- [x] **Step 1: Write failing schema/config tests** covering default-disabled flags, strict booleans, valid alert email lists, unique dedupe key, and nullable incident/report parent constraints.
- [x] **Step 2: Run `npm test -- tests/unit/analytics-operational-schema.test.ts --run` and verify failure because models/helpers do not exist.**
- [x] **Step 3: Add Prisma enums/models and indexes.** `AnalyticsJobHeartbeat.jobKey` is the primary key; `AnalyticsEmailDelivery.dedupeKey` is unique; incident `activeKey` is nullable unique; delivery has exactly one nullable incident/weekly parent for now and `notificationKind`, payload hash, frozen recipients, lease, attempts, and expiry fields.
- [x] **Step 4: Add an additive SQL migration.** Use PostgreSQL checks for bounded enums, `CHECK (num_nonnulls(incident_id, weekly_insight_id)=1)`, indexes for active incidents and retryable deliveries, and no destructive rewrite of current analytics tables.
- [x] **Step 5: Add env example and server validation.** Empty alert recipients and false flags are valid; malformed configured values return explicit validation errors only when the corresponding feature is enabled.
- [x] **Step 6: Run Prisma validation and the focused tests.**
- [x] **Step 7: Commit `feat(analytics): add durable operational schema`.**

### Task 2: Implement fenced maintenance heartbeat and complete-run driver

**Files:**
- Create: `src/server/analytics/operations/heartbeat.ts`
- Modify: `src/server/analytics/maintenance.ts`
- Modify: `src/app/api/cron/owner-analytics/route.ts`
- Modify: `scripts/run-owner-analytics-cron.sh`
- Test: `tests/unit/analytics-heartbeat.test.ts`
- Test: `tests/unit/analytics-cron.test.ts`

**Interfaces:**
- `startAnalyticsJobRun(jobKey: 'owner_analytics_maintenance', now: Date): Promise<{runId:string; leaseToken:string}>`.
- `recordAnalyticsJobProgress(input: {runId:string; leaseToken:string; batchSequence:number; hasMore:boolean; errors:number; nextCursor:string|null; now:Date}): Promise<void>`.
- `finishAnalyticsJobRun(input: {runId:string; leaseToken:string; status:'succeeded'|'partial'|'failed'; result:HeartbeatResult; now:Date}): Promise<boolean>`.
- `runOwnerAnalyticsMaintenance(input): Promise<MaintenanceResult>` remains the public service boundary.

- [x] **Step 1: Add failing tests** for stale completion fencing, duplicate batch sequence, progress not updating `lastSuccessAt`, complete run updating success counters once, and lease expiry producing failure.
- [x] **Step 2: Run focused tests and verify failure.**
- [x] **Step 3: Implement heartbeat transactions with `currentRunId`, lease token, expected sequence, `lastProgressAt`, cumulative errors, and complete-run counters.** Use CAS updates; reject an old token without throwing into Booking code.
- [x] **Step 4: Wrap the existing driver in the cron route/driver.** Generate one run ID for the whole cursor loop, record each response, and finish only after the shell driver reaches terminal `hasMore=false`. Preserve legacy route response fields.
- [x] **Step 5: Extend the shell script to pass an opaque run token/cursor contract and call a guarded finish endpoint.** Existing legacy execution must fail the workflow rather than claim a successful heartbeat when the continuation budget is exhausted.
- [x] **Step 6: Run focused heartbeat/cron tests and typecheck.**
- [x] **Step 7: Commit `feat(analytics): fence maintenance heartbeat runs`.**

### Task 3: Add incident evaluator and durable email outbox worker

**Files:**
- Create: `src/server/analytics/operations/incidents.ts`
- Create: `src/server/analytics/operations/email-outbox.ts`
- Modify: `src/lib/notifications/email-provider.ts`
- Test: `tests/unit/analytics-operational-incidents.test.ts`
- Test: `tests/unit/analytics-email-outbox.test.ts`
- Test: `tests/integration/analytics-operational-incidents.test.ts`

**Interfaces:**
- `evaluateOwnerAnalyticsOperations(now: Date): Promise<{state:'healthy'|'warning'|'critical'|'not_initialized'|'not_enabled'; incidents: IncidentSummary[]}>`.
- `claimAnalyticsEmailDelivery(input: {deliveryId:string; now:Date}): Promise<DeliveryClaim|null>`.
- `deliverAnalyticsEmailClaim(claim: DeliveryClaim): Promise<DeliveryResult>`.

- [x] **Step 1: Write failing unit tests** for all threshold edges: 2h15/4h heartbeat, 2/4 failures, 2h/12h/24h backlog, open/escalate/remind/resolve, and disabled/expected monitor states.
- [x] **Step 2: Write failing integration tests** for concurrent evaluators, one active incident, one notification hito, old heartbeat completion, outbox lease expiry, and same-key ambiguous retry.
- [x] **Step 3: Implement pure threshold/state transitions.** Keep details allowlisted and compute `activeKey`, severity, hito sequence, and resolution from durable rows only.
- [x] **Step 4: Implement transactional incident upsert and delivery creation.** Never put recipient emails in incident details; freeze subject/body/recipient list into the outbox payload and hash it.
- [x] **Step 5: Add a generic Resend outbox send path with `maxRetries:0`, 15-second provider timeout, lease CAS, statuses `pending/sending/sent/failed/ambiguous/manual_review/cancelled`, and 23-hour cutoff.** Reuse existing provider formatting and idempotency support.
- [x] **Step 6: Run focused unit/integration tests.**
- [x] **Step 7: Commit `feat(analytics): add durable operational incidents and outbox`.**

### Task 4: Add independent monitor route and production-health integration

**Files:**
- Create: `src/app/api/cron/owner-analytics-monitor/route.ts`
- Modify: `scripts/check-production-health.cjs`
- Modify: `tests/unit/check-production-health.test.js`
- Create: `tests/unit/analytics-monitor-route.test.ts`
- Modify: `.github/workflows/production-health.yml`
- Modify: `.env.example`

**Interfaces:**
- `POST /api/cron/owner-analytics-monitor` returns `{state, heartbeat, incidents, deliveries}` with no tenant/customer payload.
- `checkProductionHealth()` accepts an optional monitor probe and preserves the expected-disabled skip.

- [x] **Step 1: Add failing route/auth and monitor matrix tests.** Cover no body/query, wrong Bearer, `not_enabled`, expected-enabled `not_initialized`, warning/critical, and `no-store`.
- [x] **Step 2: Extend the production health helper tests** for the monitor URL, expected flag, retries, malformed JSON, and failing state.
- [x] **Step 3: Implement the route and script probe.** The app evaluates incidents and drains bounded outbox deliveries; the script fails only when monitor is expected and unhealthy, while preserving old checks when it is intentionally disabled.
- [x] **Step 4: Add repository variable `OWNER_ANALYTICS_MONITOR_EXPECTED` to the workflow environment without enabling it.** Keep `CRON_SECRET` server-only.
- [x] **Step 5: Run route/script tests and lint changed files.**
- [x] **Step 6: Commit `feat(analytics): monitor durable operations from production health`.**

### Task 5: Retention, documentation, and end-to-end verification

**Files:**
- Modify: `src/server/analytics/maintenance.ts`
- Modify: `docs/operations/owner-analytics.md`
- Modify: `docs/operations/owner-analytics-completion-audit.md`
- Test: `tests/integration/analytics-retention.test.ts`

- [x] **Step 1: Add failing retention tests** for resolved incidents and delivery payloads, open incident preservation, 90-day expiry, and independent purge when heartbeat monitoring is disabled.
- [x] **Step 2: Implement bounded purge.** Purge only expired resolved incidents and delivery payloads; never purge the current heartbeat or unresolved incident.
- [x] **Step 3: Document activation gates and the total-app-down limitation.** Record manual heartbeat run, synthetic incident, external GitHub failure, and recipient verification evidence requirements.
- [x] **Step 4a: Run the focused operational suite, Prisma validation,
      typecheck, and lint.** Focal operational/analytics suites pass.
- [ ] **Step 4b: Run the existing full unit suite.** The repository-wide run
      remains non-green on unrelated payment/bank-transfer tests under this
      environment.
- [x] **Step 5: Commit `docs(analytics): document operational alert activation gates`.**
