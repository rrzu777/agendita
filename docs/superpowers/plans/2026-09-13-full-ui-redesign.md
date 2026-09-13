# Agendita Full UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved 53-route redesign, tenant customisation and responsive navigation in production through five independently releasable PRs.

**Architecture:** Keep Tailwind v4 runtime tokens canonical, add a pure tenant-theme resolver and wrapper, then migrate complete vertical slices onto shared shells and primitives. Domain actions remain authoritative; each PR is additive or independently reversible.

**Tech Stack:** Next.js 16.3 App Router, React 19, Tailwind CSS 4, Prisma 5/PostgreSQL, Zod 4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-full-ui-redesign-design.md`

**Route ledger:** `docs/superpowers/audits/2026-09-13-route-redesign-coverage.md`

## Global Constraints

- Read relevant guides from `node_modules/next/dist/docs/` before changing Next.js layouts, styling or route behavior.
- WCAG 2.2 AA; minimum actionable target 44 px; visible focus; reduced-motion and forced-colors support.
- Tenant category suggests a preset but never locks or genders the style.
- Preserve booking/payment/permission/analytics domain behavior and every mobile action.
- One PR per track; Build → Review → Fix → Re-review → Verify → Merge.
- No real payment, real customer reservation or irreversible production mutation for QA.

---

### Task 1: PR 1 — design contracts, tenant theme and canonical navigation

**Files:**
- Create: `DESIGN.md`, `UX-CONTRACT.md`, `premium-ui.json`
- Create: `docs/superpowers/audits/2026-09-13-route-redesign-coverage.md`
- Create: `src/lib/theme/business-theme.ts`
- Create: `src/components/theme/business-theme.tsx`
- Create: `src/components/dashboard/dashboard-context-nav.tsx`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_business_visual_theme/migration.sql`
- Modify: `src/app/globals.css`
- Modify: `src/app/dashboard/layout.tsx`
- Modify: `src/lib/dashboard/navigation.ts`
- Modify: `src/components/dashboard/sidebar.tsx`
- Modify: `src/components/dashboard/mobile-more-menu.tsx`
- Modify: `src/lib/business/schema.ts`
- Modify: `src/lib/business/settings-form-values.ts`
- Modify: `src/server/actions/business-settings.ts`
- Modify: `src/components/dashboard/settings/profile-settings-form.tsx`
- Modify: `src/components/dashboard/settings/public-profile-preview.tsx`
- Test: `tests/unit/business-theme.test.ts`
- Test: `tests/unit/dashboard-navigation.test.ts`
- Test: `tests/unit/business-settings-schema.test.ts`
- Test: `tests/unit/business-settings-action.test.ts`
- Test: `tests/unit/profile-settings-form.test.tsx`

**Interfaces:**
- Produces `resolveBusinessTheme(input): BusinessTheme` and `businessThemeStyle(input): CSSProperties`.
- Produces grouped `DashboardNavGroup[]` while retaining role filtering and active-route behavior.
- Persists `brandColor: string | null` and `visualStyle: soft | balanced | contrast`.

- [ ] Write failing tests for valid/invalid custom colors, contrast, category fallbacks and all three visual styles.
- [ ] Add Prisma enum/fields and additive migration that backfills category-appropriate defaults.
- [ ] Implement pure theme resolver and React wrapper; map output only to semantic CSS custom properties.
- [ ] Reconcile global tokens, scrollbar, focus, motion and forced-colors rules in `globals.css`.
- [ ] Write failing navigation tests proving eight destinations, group children, role filtering and active parent state.
- [ ] Implement desktop groups, tablet rail and four-item mobile navigation; expose every functional child of Catálogo, Crecimiento, Finanzas and Configuración without losing unsaved-change or tour behavior.
- [ ] Extend profile schema/action/form/preview with labelled style choices and a validated hex color.
- [ ] Run targeted tests, DESIGN lint, Premium strict audit, Impeccable detector, lint, typecheck and build.
- [ ] Browser-test dashboard/settings at three widths and at least soft + contrast tenant themes.
- [ ] Complete two code-review passes, commit, open PR, wait for CI, review exact HEAD and merge.

### Task 2: PR 2 — owner operations vertical slice

**Files:**
- Create: `src/components/dashboard/dashboard-page-header.tsx`
- Create: `src/components/dashboard/dashboard-panel.tsx`
- Create: `src/components/dashboard/kpi-strip.tsx`
- Modify: `src/components/dashboard/header.tsx`
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/dashboard/calendar/page.tsx`, `src/components/dashboard/calendar-views.tsx`
- Modify: `src/app/dashboard/bookings/page.tsx`, booking row/card/drawer components
- Modify: `src/app/dashboard/customers/page.tsx`, `src/app/dashboard/customers/[id]/page.tsx`, customer list/detail components
- Modify: `src/app/dashboard/services/page.tsx`, `src/app/dashboard/equipo/page.tsx`, `src/app/dashboard/availability/page.tsx`
- Test: existing dashboard/calendar/booking/customer/catalog suites plus focused component tests for new primitives.

**Interfaces:** consumes Task 1 theme/navigation; produces shared owner page primitives used by Task 3.

- [ ] Add failing component tests for page header, KPI semantics and contextual navigation.
- [ ] Build Cabina del día from existing authoritative data; keep empty/error states truthful.
- [ ] Adapt calendar topology for desktop/tablet/mobile without changing scheduling rules.
- [ ] Migrate bookings and customer list/detail, preserving all actions, pagination and responsive access.
- [ ] Migrate Services/Equipo/Disponibilidad under Catálogo context navigation.
- [ ] Verify role matrix, table overflow/stacked states, dialogs, loading and narrow viewport.
- [ ] Complete review/fix/re-review/verification, PR, exact-HEAD CI review and merge.
- [ ] Update the route ledger with the exact automated and browser evidence collected for routes 1–10 and 25.

### Task 3: PR 3 — growth, finance, settings and admin

**Files:**
- Modify growth routes/components: `metricas`, `promociones`, `fidelizacion`, `campanas`, `paquetes`, `reviews`.
- Modify finance routes/components: `payments`, `billing`.
- Modify settings shell/navigation and `profile`, `reservations`, `policies`, `payments` forms.
- Modify admin list/detail routes and shared components they own.
- Test: owner analytics, campaigns, promotions, loyalty, packages, payment/billing, settings and admin suites.

**Interfaces:** consumes Task 2 page primitives; preserves server actions and analytics definitions.

- [ ] Add route-backed context navigation for Crecimiento, Finanzas and Configuración.
- [ ] Put actionable metrics first; move methodology and capture health behind secondary disclosure.
- [ ] Migrate growth workflows without changing attribution, consent or campaign side effects.
- [ ] Migrate financial surfaces without changing payment states or money calculations.
- [ ] Reconcile all settings forms to the required/optional and save/recovery contract.
- [ ] Migrate admin with explicit zero-data and account-health states.
- [ ] Complete full track QA, review/fix/re-review, PR, CI and merge.
- [ ] Update the route ledger with the exact automated and browser evidence collected for routes 11–24 and 26–27.

### Task 4: PR 4 — public profile and booking journey

**Files:**
- Modify: `src/components/public/business-profile.tsx`
- Modify: `src/components/booking/booking-business-page.tsx`, `wizard.tsx`, `booking-summary.tsx`
- Modify: all `src/components/booking/step-*.tsx`
- Modify: booking confirmation route/components and public loading/error states.
- Test: multiservice, professional query param, availability preview, draft preservation, Google login, payment branch and confirmation-state suites.

**Interfaces:** consumes Task 1 `BusinessTheme`; must not change booking/payment payload contracts.

- [ ] Add failing tests for six-stage progress and theme continuity.
- [ ] Rebuild profile as tenant-first trust surface using only available business data.
- [ ] Reconcile multi-service, optional professional and availability preview with the approved hierarchy.
- [ ] Make customer required/optional labels and “Fecha de nacimiento” explicit; preserve conditional address and Google draft.
- [ ] Reconcile payment/policy presentation against actual offered methods and existing terminal states.
- [ ] Exercise success, verifying, rejected, pending, expired, cancelled and retry states at three widths.
- [ ] Complete review/fix/re-review, full booking E2E, PR, CI and merge.
- [ ] Update the route ledger with the exact automated and browser evidence collected for routes 28–31.

### Task 5: PR 5 — client account, packages, loyalty, platform and final route sweep

**Files:**
- Modify: `/mi` layouts/pages/actions, packages components/routes, loyalty components/routes, review, notifications, opt-out and install.
- Modify: owner/client auth pages, landing, legal templates, not-found/error and admin leftovers.
- Create/update route coverage and visual regression evidence under `docs/superpowers/audits/`.
- Test: auth/session, self-service, packages, loyalty, opt-out, notifications and route smoke suites.

**Interfaces:** completes the spec; no new independent theme or shell implementation is allowed.

- [ ] Migrate client multi-business home and tenant detail with reservation management intact.
- [ ] Add the client shell: business switcher at `/mi`, local Próximas/Historial/Beneficios/Preferencias navigation at `/mi/[slug]`, persistent Reservar action and contextual reprogramming.
- [ ] Migrate package purchase/confirmation and loyalty card/link states without changing financial lifecycle.
- [ ] Migrate review, notification, opt-out and install states with explicit recovery.
- [ ] Separate owner auth, client auth, marketing and legal registers while sharing tokens.
- [ ] Audit all 53 routes for canonical shell, title, loading/error, mobile actions and raw legacy tokens.
- [ ] Update the route ledger with the exact automated and browser evidence collected for routes 32–53.
- [ ] Recompute the `page.tsx` inventory and fail the sweep if any current route is absent from the route ledger.
- [ ] Run full unit/integration/E2E/build/static/visual matrix and production-safe smoke tests.
- [ ] Complete final review/fix/re-review, PR, CI, merge and exact production deployment verification.

## Baseline evidence

- `origin/main`: `93e3906`.
- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm test`: 4,109 passed, 1 skipped, 15 failed under concurrent baseline load; isolated rerun reduced to one UUID-regex collision and that exact test passed on immediate rerun. Treat the suite as load/flakiness-sensitive and re-run changed tests serially before attributing failures.
