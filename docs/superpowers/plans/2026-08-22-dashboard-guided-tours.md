# Dashboard Guided Tours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every permitted dashboard destination reachable on mobile and add optional, role-aware, server-persisted guided tours for the highest-value owner/admin workflows.

**Architecture:** A shared navigation registry drives desktop and mobile navigation, while a `UserTourProgress` table stores monotonic progress per user, business, tour, and version. A lazy client provider renders existing Radix `Popover`/`Sheet` primitives against stable `data-tour-id` targets, coordinates with unsaved changes, and fails open when content or persistence is unavailable.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma/PostgreSQL, Radix UI primitives, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-22-dashboard-guided-tours-design.md`

## Global Constraints

- Phase 1 dashboard tours are offered only to `owner` and `admin`; do not invent a `staff` tour.
- Mobile navigation must be complete and verified before tours are enabled.
- Onboarding configures, the checklist measures real data, and tours only educate; never mutate checklist state from tour progress.
- Do not add React Joyride, Shepherd, Driver.js, analytics SDKs, state libraries, or animation libraries.
- Reuse `Popover`, `Sheet`, `Dialog`, `Button`, design tokens, and `UnsavedChangesProvider` already in the repository.
- Tour targets use stable `data-tour-id`; never select by visible text, Tailwind class, or DOM index.
- The client never sends `userId` or `businessId`; all tenant and role identity comes from the authenticated server context.
- `completed` and `dismissed` are terminal for automatic offers in the same version; stale updates cannot regress `completed`.
- Tours fail open: target, network, positioning, or persistence failures must not block dashboard actions.
- Do not automatically navigate between routes or execute product mutations from a tour.
- Read the applicable guides in `node_modules/next/dist/docs/` before editing App Router code, especially layouts/pages, linking/navigation, Server/Client Components, forms, authentication, and Playwright.
- Use RED → GREEN for every behavior change, run `git diff --check`, and commit each task independently.

---

## File and responsibility map

### Navigation

- `src/lib/dashboard/navigation.ts`: canonical route metadata, roles, placement, active matching, and tour target IDs.
- `src/components/dashboard/sidebar.tsx`: desktop presentation and primary mobile items only.
- `src/components/dashboard/mobile-more-menu.tsx`: accessible mobile sheet for secondary destinations, Help, and logout.
- `src/app/dashboard/layout.tsx`: passes the authenticated role and minimal tour context.

### Persistence and server contracts

- `prisma/schema.prisma`: `TourStatus`, `UserTourProgress`, and relations.
- `prisma/migrations/20260822180000_user_tour_progress/migration.sql`: forward migration and indexes.
- `src/lib/tours/catalog.ts`: server/client-safe tour keys, versions, route and role metadata; no component imports.
- `src/lib/tours/progress.ts`: pure monotonic transition policy.
- `src/server/actions/tour-progress.ts`: authenticated reads/writes with tenant-derived keys.

### Client runtime

- `src/components/dashboard/tours/tour-definitions.tsx`: lazy step copy and target definitions.
- `src/components/dashboard/tours/tour-target.ts`: target lookup, bounded wait, rectangle and cleanup helpers.
- `src/components/dashboard/tours/tour-surface.tsx`: desktop Popover and mobile Sheet presentation.
- `src/components/dashboard/tours/dashboard-tour-provider.tsx`: state machine, lazy definitions, persistence debounce, replay and conflict coordination.
- `src/components/dashboard/tours/tour-invitation.tsx`: explicit post-onboarding invitation.
- `src/components/dashboard/tours/tour-help-menu.tsx`: replay launcher and available-tour list.
- `src/components/dashboard/tours/tour-context.ts`: typed provider API and no-op-safe consumer hook.

### Product targets and rollout

- `src/components/dashboard/setup-checklist.tsx`: intro target.
- `src/app/dashboard/page.tsx`: invitation eligibility data and intro targets.
- `src/app/dashboard/bookings/page.tsx`, booking row/action components: bookings targets and empty-state alternative.
- `src/app/dashboard/payments/page.tsx`, finance/payment components: payments targets.
- `src/components/dashboard/settings/settings-navigation.tsx`, `settings-save-bar.tsx`, `public-profile-preview.tsx`, and policies page: settings targets.
- `src/lib/env.ts` and `.env.example`: `DASHBOARD_TOURS_ENABLED` server-side rollout flag.
- `tests/e2e/dashboard-tours.spec.ts`: owner/admin responsive journeys, role filtering, reload, replay, dirty guard, and target fallback.

---

### Task 1: Canonical navigation registry and mobile “Más”

**Files:**
- Create: `src/lib/dashboard/navigation.ts`
- Create: `src/components/dashboard/mobile-more-menu.tsx`
- Modify: `src/components/dashboard/sidebar.tsx`
- Modify: `src/app/dashboard/layout.tsx`
- Modify: `src/app/dashboard/billing/page.tsx`
- Test: `tests/unit/dashboard-navigation.test.ts`
- Test: `tests/unit/dashboard-navigation-layout.test.ts`
- Test: `tests/e2e/dashboard-mobile-navigation.spec.ts`

**Interfaces:**
- Produces: `getDashboardNavItems(vocabulary, role): DashboardNavItem[]`, `isDashboardNavItemActive(item, pathname): boolean`, and `MobileMoreMenu`.
- Consumes: authenticated `BusinessRole`, `Vocabulary`, `GuardedLink`, `useUnsavedChanges`, and existing Radix `Sheet`.

- [ ] **Step 1: Read the local Next navigation and client-component guides**

Read:

```bash
sed -n '1,240p' node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
```

Expected: confirm `Link`/App Router navigation remains client-side and only serializable role/business props cross the layout boundary.

- [ ] **Step 2: Write failing navigation-registry tests**

Create tests with exact contracts:

```ts
import { describe, expect, it } from 'vitest'
import { getDashboardNavItems, isDashboardNavItemActive } from '@/lib/dashboard/navigation'

const vocabulary = { Professionals: 'Profesionales', Clients: 'Clientes' } as never

describe('dashboard navigation registry', () => {
  it('keeps settings and billing out of staff navigation', () => {
    const hrefs = getDashboardNavItems(vocabulary, 'staff').map((item) => item.href)
    expect(hrefs).not.toContain('/dashboard/settings')
    expect(hrefs).not.toContain('/dashboard/billing')
    expect(hrefs).toContain('/dashboard/bookings')
    expect(hrefs).toContain('/dashboard/calendar')
  })

  it('exposes every destination to owner and admin', () => {
    expect(getDashboardNavItems(vocabulary, 'owner')).toHaveLength(15)
    expect(getDashboardNavItems(vocabulary, 'admin')).toHaveLength(15)
  })

  it('marks descendants active without marking dashboard for every route', () => {
    const [summary, bookings] = getDashboardNavItems(vocabulary, 'owner')
    expect(isDashboardNavItemActive(summary, '/dashboard/bookings')).toBe(false)
    expect(isDashboardNavItemActive(bookings, '/dashboard/bookings/new')).toBe(true)
  })
})
```

- [ ] **Step 3: Run the navigation tests to verify RED**

Run:

```bash
npm test -- tests/unit/dashboard-navigation.test.ts tests/unit/dashboard-navigation-layout.test.ts
```

Expected: FAIL because the registry and “Más” contracts do not exist.

- [ ] **Step 4: Implement the registry with explicit role and placement metadata**

Create the canonical interface and resolver:

```ts
export type DashboardNavItem = {
  href: string
  label: string
  icon: LucideIcon
  roles: BusinessRole[]
  mobile: 'primary' | 'more'
  tourId: string
}

export function getDashboardNavItems(v: Vocabulary, role: BusinessRole) {
  return dashboardNavDefinitions(v).filter((item) => item.roles.includes(role))
}

export function isDashboardNavItemActive(item: DashboardNavItem, pathname: string) {
  return item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href)
}
```

Use `owner/admin/staff` for read-capable operational destinations. Restrict Settings and Billing to `owner/admin`, matching their server access. Do not weaken any page or action authorization.

- [ ] **Step 5: Implement the mobile sheet and refactor the sidebar**

The bottom navigation renders three primary destinations plus “Más”. The new component receives already-filtered secondary items and uses:

```tsx
<Sheet open={open} onOpenChange={setOpen}>
  <SheetTrigger asChild>
    <button type="button" aria-label="Más opciones" data-tour-id="nav-mobile-more">…</button>
  </SheetTrigger>
  <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
    <SheetHeader>
      <SheetTitle>Más opciones</SheetTitle>
      <SheetDescription>Administra las demás áreas de tu negocio.</SheetDescription>
    </SheetHeader>
    <nav aria-label="Más secciones del dashboard">…</nav>
  </SheetContent>
</Sheet>
```

Use `GuardedLink` for every destination and the existing guarded logout sequence. Closing the sheet restores focus to its trigger through Radix.

- [ ] **Step 6: Fail closed at the Billing page for staff**

Replace the page’s generic membership read with the same owner/admin access contract used by Settings. Add a test asserting a staff user redirects before subscription queries run.

- [ ] **Step 7: Run unit tests and typecheck**

Run:

```bash
npm test -- tests/unit/dashboard-navigation.test.ts tests/unit/dashboard-navigation-layout.test.ts tests/unit/settings-access.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Add mobile E2E coverage**

At 375 px, assert the three primary links plus “Más”, open the sheet, navigate to Payments and Settings as owner, verify active state, keyboard focus restoration, no horizontal overflow, and guarded logout. Seed/use a staff identity to assert Settings and Billing are absent.

- [ ] **Step 9: Run focused Playwright and commit**

Run:

```bash
npx playwright test tests/e2e/dashboard-mobile-navigation.spec.ts --project=chromium
git diff --check
git add src/lib/dashboard/navigation.ts src/components/dashboard/mobile-more-menu.tsx src/components/dashboard/sidebar.tsx src/app/dashboard/layout.tsx src/app/dashboard/billing/page.tsx tests/unit/dashboard-navigation.test.ts tests/unit/dashboard-navigation-layout.test.ts tests/e2e/dashboard-mobile-navigation.spec.ts
git commit -m "feat: complete mobile dashboard navigation"
```

Expected: owner/admin and staff cases pass; commit contains no tour runtime yet.

---

### Task 2: Persisted and monotonic tour progress

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260822180000_user_tour_progress/migration.sql`
- Create: `src/lib/tours/catalog.ts`
- Create: `src/lib/tours/progress.ts`
- Create: `src/server/actions/tour-progress.ts`
- Test: `tests/unit/tour-progress.test.ts`
- Test: `tests/unit/tour-progress-actions.test.ts`
- Test: `tests/integration/tour-progress.test.ts`

**Interfaces:**
- Produces: `TOUR_CATALOG`, `TourKey`, `TourProgressSnapshot`, `getTourProgress()`, and `recordTourProgress(input)`.
- Consumes: `requireBusinessRole(['owner', 'admin'])`, `action()`, `acquireAdvisoryXactLock()`, Prisma transaction/upsert, and server-derived user/business IDs.

- [ ] **Step 1: Write the failing pure transition tests**

Test exact monotonic policy:

```ts
expect(nextTourState({ status: 'completed', lastStep: 3 }, { type: 'start' }))
  .toEqual({ status: 'completed', lastStep: 3 })
expect(nextTourState({ status: 'in_progress', lastStep: 2 }, { type: 'step', step: 1 }))
  .toEqual({ status: 'in_progress', lastStep: 2 })
expect(nextTourState(null, { type: 'dismiss' }).status).toBe('dismissed')
```

- [ ] **Step 2: Run the pure tests to verify RED**

Run `npm test -- tests/unit/tour-progress.test.ts`.

Expected: FAIL with missing `@/lib/tours/progress`.

- [ ] **Step 3: Define the catalog and transition types**

`catalog.ts` must stay free of React/component imports:

```ts
export const TOUR_CATALOG = {
  dashboard_intro: { version: 1, route: '/dashboard', roles: ['owner', 'admin'] },
  bookings: { version: 1, route: '/dashboard/bookings', roles: ['owner', 'admin'] },
  payments: { version: 1, route: '/dashboard/payments', roles: ['owner', 'admin'] },
  settings: { version: 1, route: '/dashboard/settings/profile', roles: ['owner', 'admin'] },
} as const

export type TourKey = keyof typeof TOUR_CATALOG
export type TourProgressEvent =
  | { type: 'offer' }
  | { type: 'start' }
  | { type: 'step'; step: number }
  | { type: 'complete' }
  | { type: 'dismiss' }
```

Implement `nextTourState` so `lastStep` only increases and `completed` cannot regress. A manual replay does not call a resetting server event.

- [ ] **Step 4: Add Prisma schema and forward migration**

Add relations to `User` and `Business`, the `TourStatus` enum, and the model from the design. Migration SQL must include the enum, table, foreign keys with `ON DELETE CASCADE`, unique key `(userId, businessId, tourKey, tourVersion)`, and index `(businessId, status, updatedAt)`.

Do not edit existing migrations.

- [ ] **Step 5: Write failing action security and idempotency tests**

Cover:

```ts
expect(requireBusinessRole).toHaveBeenCalledWith(['owner', 'admin'])
expect(prisma.userTourProgress.upsert).toHaveBeenCalledWith(expect.objectContaining({
  where: { userId_businessId_tourKey_tourVersion: expect.objectContaining({
    userId: 'user-1', businessId: 'business-1', tourKey: 'bookings', tourVersion: 1,
  }) },
}))
```

Also assert unknown keys, wrong versions, negative/out-of-range steps, and `staff` are rejected before DB mutation. The input type must have no `userId` or `businessId`.

- [ ] **Step 6: Implement authenticated actions**

Public signatures:

```ts
export type TourProgressSnapshot = {
  key: TourKey
  version: number
  status: TourStatus
  lastStep: number
}

export const getTourProgress: () => Promise<ActionResult<TourProgressSnapshot[]>>
export const recordTourProgress: (input: {
  key: TourKey
  version: number
  event: TourProgressEvent
}) => Promise<ActionResult<TourProgressSnapshot>>
```

Inside a transaction, acquire
`acquireAdvisoryXactLock(tx, `tour:${userId}:${businessId}:${key}:${version}`)`
before loading the row, then apply `nextTourState` and upsert the result. This
serializes concurrent tabs before their read/modify/write sequence; a plain
transactional read followed by upsert is not sufficient at PostgreSQL Read
Committed. Derive timestamps from the accepted event and never clear terminal
timestamps. Validate the catalog version/role before reading or writing.

- [ ] **Step 7: Add real PostgreSQL integration tests**

Apply all migrations to an ephemeral local PostgreSQL 16 database. Create two businesses and two users. Prove:

- progress is isolated by user and business;
- stale `step/start` after `complete` leaves the row completed;
- duplicate complete/dismiss operations are idempotent;
- deleting the user or business cascades rows;
- the unique key prevents duplicate progress rows under concurrent starts.

- [ ] **Step 8: Run database and static gates**

Run:

```bash
npx prisma validate
npx prisma generate
npm test -- tests/unit/tour-progress.test.ts tests/unit/tour-progress-actions.test.ts
TEST_DATABASE_URL="$LOCAL_TEST_DATABASE_URL" npm test -- tests/integration/tour-progress.test.ts
npm run typecheck
git diff --check
```

Expected: all pass; the PostgreSQL URL must be loopback and disposable.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260822180000_user_tour_progress src/lib/tours src/server/actions/tour-progress.ts tests/unit/tour-progress.test.ts tests/unit/tour-progress-actions.test.ts tests/integration/tour-progress.test.ts
git commit -m "feat: persist dashboard tour progress"
```

---

### Task 3: Tour definitions, eligibility, and stable-target contract

**Files:**
- Create: `src/components/dashboard/tours/tour-types.ts`
- Create: `src/components/dashboard/tours/tour-definitions.tsx`
- Create: `src/lib/tours/eligibility.ts`
- Test: `tests/unit/tour-definitions.test.tsx`
- Test: `tests/unit/tour-eligibility.test.ts`
- Test: `tests/unit/tour-target-contract.test.ts`

**Interfaces:**
- Produces: `loadTourDefinition(key)`, `getAvailableTours(context)`, `TourDefinition`, `TourStep`, and target-contract verification.
- Consumes: `TOUR_CATALOG`, role, pathname, onboarding state, viewport class, progress snapshots, and optional feature/data predicates.

- [ ] **Step 1: Write RED tests for eligibility**

Use a pure context:

```ts
const base = {
  role: 'owner', pathname: '/dashboard', onboardingCompleted: true,
  viewport: 'desktop', progress: [], toursEnabled: true,
} as const

expect(getAvailableTours(base).map((tour) => tour.key)).toContain('dashboard_intro')
expect(getAvailableTours({ ...base, role: 'staff' })).toEqual([])
expect(getAvailableTours({ ...base, onboardingCompleted: false })).toEqual([])
expect(getAvailableTours({ ...base, toursEnabled: false })).toEqual([])
expect(getAvailableTours({ ...base, progress: [{ key: 'dashboard_intro', version: 1, status: 'dismissed', lastStep: 0 }] })).toEqual([])
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- tests/unit/tour-eligibility.test.ts tests/unit/tour-definitions.test.tsx tests/unit/tour-target-contract.test.ts
```

Expected: FAIL because definitions and eligibility do not exist.

- [ ] **Step 3: Define strict step types and dynamic loading**

Use discriminated target alternatives:

```ts
export type TourStep = {
  id: string
  targetId: string
  fallbackTargetId?: string
  title: string
  body: string
  viewports: Array<'mobile' | 'desktop'>
  waitMs: number
}

export type TourDefinition = {
  key: TourKey
  version: number
  title: string
  steps: TourStep[]
}

export async function loadTourDefinition(key: TourKey) {
  return (await import(`./definitions/${key}`)).definition
}
```

Use an explicit loader map instead of an unconstrained dynamic path so bundling and type checking remain deterministic.

- [ ] **Step 4: Implement pure eligibility**

Eligibility excludes wrong route, staff, incomplete onboarding, disabled flag, unsupported viewport, and terminal same-version progress. `in_progress` remains resumable at its clamped `lastStep`.

- [ ] **Step 5: Add the target contract test**

Maintain a target manifest next to definitions:

```ts
export const TOUR_TARGET_FILES = {
  'nav-desktop': ['src/components/dashboard/sidebar.tsx'],
  'nav-mobile-more': ['src/components/dashboard/mobile-more-menu.tsx'],
  'dashboard-checklist': ['src/components/dashboard/setup-checklist.tsx'],
} as const
```

The test reads every listed file and asserts it contains the exact `data-tour-id="<id>"`. Data-dependent steps must declare `fallbackTargetId`; reject duplicate step IDs and empty role/viewport sets.

- [ ] **Step 6: Run focused tests, typecheck, and commit**

```bash
npm test -- tests/unit/tour-eligibility.test.ts tests/unit/tour-definitions.test.tsx tests/unit/tour-target-contract.test.ts
npm run typecheck
git diff --check
git add src/lib/tours src/components/dashboard/tours tests/unit/tour-eligibility.test.ts tests/unit/tour-definitions.test.tsx tests/unit/tour-target-contract.test.ts
git commit -m "feat: define role aware dashboard tours"
```

---

### Task 4: Accessible tour runtime and fail-open target handling

**Files:**
- Create: `src/components/dashboard/tours/tour-target.ts`
- Create: `src/components/dashboard/tours/tour-context.ts`
- Create: `src/components/dashboard/tours/tour-surface.tsx`
- Create: `src/components/dashboard/tours/dashboard-tour-provider.tsx`
- Modify: `src/components/dashboard/unsaved-changes-provider.tsx`
- Test: `tests/unit/tour-target.test.ts`
- Test: `tests/unit/tour-surface.test.tsx`
- Test: `tests/unit/dashboard-tour-provider.test.tsx`

**Interfaces:**
- Produces: `DashboardTourProvider`, `useDashboardTours()`, `waitForTourTarget()`, and accessible desktop/mobile surfaces.
- Consumes: lazy definitions, progress actions, `hasUnsavedChanges`, route/viewport context, Popover and Sheet.

- [ ] **Step 1: Write RED tests for bounded target lookup and cleanup**

Cover target present immediately, target appearing after a mutation, fallback target, timeout returning `null`, abort/unmount, and removal of observers/listeners.

```ts
const target = await waitForTourTarget({ targetId: 'booking-row', fallbackTargetId: 'bookings-empty', waitMs: 50, signal })
expect(target?.dataset.tourId).toBe('bookings-empty')
```

- [ ] **Step 2: Implement `waitForTourTarget`**

Use direct lookup first and a short-lived `MutationObserver` second. Always disconnect observer and timeout on resolve, abort, or rejection. Return `null`; do not throw for a missing target.

- [ ] **Step 3: Write RED component tests for accessibility and responsive surface**

Assert:

- desktop uses a Popover anchored to the target rectangle proxy;
- mobile uses bottom Sheet with safe-area padding;
- title/description are associated;
- progress and buttons have accessible names;
- Escape dismisses only after confirmation policy;
- focus returns to launcher/target;
- reduced motion disables scroll animation;
- no overlay remains after target timeout.

- [ ] **Step 4: Implement surface primitives without a new dependency**

Render a fixed, pointer-events-none highlight around `DOMRect`; the card itself restores pointer events. Use an invisible fixed anchor element for `PopoverAnchor` on desktop and `SheetContent side="bottom"` on mobile. Recompute on resize/scroll only while active and throttle with `requestAnimationFrame`.

- [ ] **Step 5: Write RED provider state-machine tests**

Cover:

```ts
expect(screen.queryByRole('dialog')).not.toBeInTheDocument() // no auto-start
await user.click(screen.getByRole('button', { name: 'Iniciar recorrido' }))
expect(recordTourProgress).toHaveBeenCalledWith(expect.objectContaining({ event: { type: 'start' } }))
```

Also test resume, monotonic next/back UI, debounced step persistence, completion, dismiss, replay without server reset, route change cleanup, network failure, target timeout, and dirty form pause.

- [ ] **Step 6: Expose read-only unsaved state to the provider**

Keep the existing API stable. `useUnsavedChanges()` already returns `hasUnsavedChanges`; the tour provider consumes it and shows “Termina o descarta tus cambios para continuar” instead of navigating or advancing to an unavailable target.

- [ ] **Step 7: Implement the provider**

Public API:

```ts
type DashboardTourContextValue = {
  available: TourKey[]
  active: { key: TourKey; step: number } | null
  start(key: TourKey, options?: { replay?: boolean }): Promise<void>
  next(): Promise<void>
  previous(): void
  dismiss(): Promise<void>
  closeReplay(): void
}
```

Lazy-load only the active definition. Catch persistence failures, keep local interaction usable, and prevent state updates after unmount or superseded requests with a generation token/abort signal.

- [ ] **Step 8: Run focused gates and commit**

```bash
npm test -- tests/unit/tour-target.test.ts tests/unit/tour-surface.test.tsx tests/unit/dashboard-tour-provider.test.tsx
npm run typecheck
npm run lint -- --quiet
git diff --check
git add src/components/dashboard/tours src/components/dashboard/unsaved-changes-provider.tsx tests/unit/tour-target.test.ts tests/unit/tour-surface.test.tsx tests/unit/dashboard-tour-provider.test.tsx
git commit -m "feat: add accessible dashboard tour runtime"
```

---

### Task 5: Introduction invitation, Help launcher, and rollout flag

**Files:**
- Create: `src/components/dashboard/tours/tour-invitation.tsx`
- Create: `src/components/dashboard/tours/tour-help-menu.tsx`
- Modify: `src/components/dashboard/sidebar.tsx`
- Modify: `src/components/dashboard/mobile-more-menu.tsx`
- Modify: `src/components/dashboard/setup-checklist.tsx`
- Modify: `src/app/dashboard/layout.tsx`
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`
- Test: `tests/unit/tour-invitation.test.tsx`
- Test: `tests/unit/tour-help-menu.test.tsx`
- Test: `tests/unit/tour-env.test.ts`

**Interfaces:**
- Produces: explicit “Conoce Agendita en 2 minutos” invitation and “Ayuda y recorridos” replay launcher.
- Consumes: provider API, catalog/progress, server `DASHBOARD_TOURS_ENABLED`, and intro targets.

- [ ] **Step 1: Write RED flag and invitation tests**

Assert invalid boolean values fail env validation, absent/false hides provider invitation, and true plus eligible progress renders the invitation without opening a dialog.

- [ ] **Step 2: Implement the server-side flag**

Add an optional strict boolean `DASHBOARD_TOURS_ENABLED`, default false. Do not expose it as `NEXT_PUBLIC_*`; resolve it in the dashboard layout and pass a boolean prop.

- [ ] **Step 3: Implement invitation semantics**

The card has two explicit actions:

```tsx
<Button onClick={() => start('dashboard_intro')}>Iniciar recorrido</Button>
<Button variant="ghost" onClick={dismiss}>Ahora no</Button>
```

Render it only on `/dashboard`, after onboarding, when intro v1 is not terminal. Recording `offer` must be idempotent and must not open the tour.

- [ ] **Step 4: Implement Help in desktop and mobile navigation**

Desktop places “Ayuda y recorridos” above the user/logout block; mobile places it inside “Más”. It lists only role/route-compatible tours, marks completed ones, and starts them with `{ replay: true }` without mutating completion back to in-progress.

- [ ] **Step 5: Add stable intro targets**

Annotate exact elements:

```tsx
data-tour-id="dashboard-checklist"
data-tour-id="nav-desktop"
data-tour-id="nav-mobile-more"
data-tour-id="bookings-new"
data-tour-id="tour-help"
```

The intro has a mobile and desktop navigation step; it never clicks “Nueva reserva” or changes route.

- [ ] **Step 6: Test priority and no double interruption**

Mock an open dialog/dirty state and prove invitation/tour remains paused. If an install/Push prompt surface is mounted in the same test harness, it must remain hidden until the tour closes; implement this as a small provider-owned `data-interruptive-surface` check rather than a new global framework.

- [ ] **Step 7: Run gates and commit**

```bash
npm test -- tests/unit/tour-env.test.ts tests/unit/tour-invitation.test.tsx tests/unit/tour-help-menu.test.tsx tests/unit/tour-target-contract.test.ts
npm run typecheck
npm run lint -- --quiet
git diff --check
git add .env.example src/lib/env.ts src/app/dashboard src/components/dashboard tests/unit/tour-env.test.ts tests/unit/tour-invitation.test.tsx tests/unit/tour-help-menu.test.tsx tests/unit/tour-target-contract.test.ts
git commit -m "feat: introduce dashboard help tours"
```

---

### Task 6: Bookings, Payments, and Settings microtours

**Files:**
- Create: `src/components/dashboard/tours/definitions/bookings.tsx`
- Create: `src/components/dashboard/tours/definitions/payments.tsx`
- Create: `src/components/dashboard/tours/definitions/settings.tsx`
- Modify: `src/app/dashboard/bookings/page.tsx`
- Modify: `src/components/dashboard/booking-row-actions.tsx`
- Modify: `src/app/dashboard/payments/page.tsx`
- Modify: `src/components/dashboard/finance-stats.tsx`
- Modify: `src/components/dashboard/payment-form.tsx`
- Modify: `src/components/dashboard/settings/settings-navigation.tsx`
- Modify: `src/components/dashboard/settings/public-profile-preview.tsx`
- Modify: `src/components/dashboard/settings/settings-save-bar.tsx`
- Modify: `src/components/dashboard/settings/policy-settings-form.tsx`
- Test: `tests/unit/dashboard-microtour-targets.test.tsx`
- Test: `tests/unit/tour-definitions.test.tsx`

**Interfaces:**
- Produces: three route-local definitions with data-present/empty-state alternatives.
- Consumes: stable target contract and runtime from Tasks 3–5.

- [ ] **Step 1: Write failing target and definition tests**

Bookings definition must use alternatives:

```ts
expect(bookings.steps.find((step) => step.id === 'status')?.fallbackTargetId)
  .toBe('bookings-empty')
expect(bookings.steps.find((step) => step.id === 'transfer')?.fallbackTargetId)
  .toBe('bookings-search')
```

Payments must target stats, register-payment, filters/history and settings link. Settings must target section navigation, preview, save bar and policy controls. Assert every tour has at most five steps.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/dashboard-microtour-targets.test.tsx tests/unit/tour-definitions.test.tsx tests/unit/tour-target-contract.test.ts
```

Expected: FAIL for absent definitions/targets.

- [ ] **Step 3: Add bookings targets without changing behavior**

Annotate the search form, transfer verification section when present, first rendered booking row/status/action menu, and empty-state container. The tour explains “Nueva reserva” but does not open it. Do not add wrappers that alter table/grid geometry.

- [ ] **Step 4: Add payments targets without changing behavior**

Annotate `FinanceStats`, `PaymentForm` trigger, date/history controls, ledger empty/list container, and the settings destination. Do not load provider account status from the tour.

- [ ] **Step 5: Add settings targets without changing behavior**

Annotate local navigation, profile preview, save bar, and cancellation policy section. The tour never edits fields or changes routes. If current route is not Profile, only steps whose targets exist are shown.

- [ ] **Step 6: Implement concise definitions**

Keep titles under roughly 55 characters and bodies to one or two short sentences. Use existing product vocabulary; do not duplicate business-state calculations in the definitions.

- [ ] **Step 7: Run regression tests and commit**

```bash
npm test -- tests/unit/dashboard-microtour-targets.test.tsx tests/unit/tour-definitions.test.tsx tests/unit/tour-target-contract.test.ts tests/unit/dashboard-bookings-advanced.test.ts tests/unit/settings-shell.test.tsx
npm run typecheck
npm run lint -- --quiet
git diff --check
git add src/app/dashboard/bookings src/app/dashboard/payments src/components/dashboard src/components/dashboard/tours/definitions tests/unit/dashboard-microtour-targets.test.tsx tests/unit/tour-definitions.test.tsx tests/unit/tour-target-contract.test.ts
git commit -m "feat: add contextual dashboard tours"
```

---

### Task 7: Responsive E2E, rollout documentation, and final gates

**Files:**
- Create: `tests/e2e/dashboard-tours.spec.ts`
- Modify: `docs/testing.md`
- Modify: `docs/testing-qa-plan.md`
- Modify: `docs/superpowers/specs/2026-08-22-dashboard-guided-tours-design.md`
- Test: all focused unit/integration suites from Tasks 1–6

**Interfaces:**
- Produces: deployment-ready, documented phase-1 feature behind `DASHBOARD_TOURS_ENABLED`.
- Consumes: complete feature and disposable local PostgreSQL/E2E identities.

- [ ] **Step 1: Read the local Playwright guide**

Read:

```bash
sed -n '1,240p' node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md
```

- [ ] **Step 2: Write end-to-end journeys before final fixes**

At 375, 768 and 1440 px cover:

1. eligible owner sees invitation but no automatic dialog;
2. starts and completes intro, reloads, and invitation stays absent;
3. dismisses a microtour and it is not re-offered;
4. replays a completed tour from Help without regressing DB status;
5. mobile “Más” exposes all permitted routes and Help;
6. staff sees neither Settings/Billing nor tour invitation;
7. bookings tour works with a row and with empty state;
8. target removed/hidden causes skip/clean close, not blocked clicks;
9. dirty Settings form pauses tour and preserves the edit;
10. no horizontal overflow, trapped focus, Escape, focus restoration and reduced motion.

Use test-only fixture creation/cleanup with `try/finally`. Query Prisma to assert persisted `(userId, businessId, tourKey, version)` state rather than trusting only visible UI.

- [ ] **Step 3: Run Playwright and fix only observed defects**

Run:

```bash
DASHBOARD_TOURS_ENABLED=true npx playwright test tests/e2e/dashboard-mobile-navigation.spec.ts tests/e2e/dashboard-tours.spec.ts --project=chromium
```

Expected: PASS at all specified widths with no leaked tour rows/fixtures.

- [ ] **Step 4: Run the full focused matrix**

```bash
npm test -- \
  tests/unit/dashboard-navigation.test.ts \
  tests/unit/dashboard-navigation-layout.test.ts \
  tests/unit/tour-progress.test.ts \
  tests/unit/tour-progress-actions.test.ts \
  tests/unit/tour-eligibility.test.ts \
  tests/unit/tour-definitions.test.tsx \
  tests/unit/tour-target-contract.test.ts \
  tests/unit/tour-target.test.ts \
  tests/unit/tour-surface.test.tsx \
  tests/unit/dashboard-tour-provider.test.tsx \
  tests/unit/tour-invitation.test.tsx \
  tests/unit/tour-help-menu.test.tsx \
  tests/unit/dashboard-microtour-targets.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run integration, schema, static, build, and full-unit gates**

Run against disposable local PostgreSQL 16:

```bash
TEST_DATABASE_URL="$LOCAL_TEST_DATABASE_URL" npm run test:integration
npx prisma validate
npx prisma generate
npm run typecheck
npm run lint
npm run build
npm test -- --maxWorkers=1
git diff --check
```

Record exact file/test counts. Any full-suite failure must be compared against the exact base `dcb72e9`; do not classify it as baseline only because it passes alone.

- [ ] **Step 6: Update operational documentation**

Document:

- `DASHBOARD_TOURS_ENABLED=false` as default and rollback switch;
- migration order and post-deploy verification query;
- QA matrix owner/admin/staff, desktop/mobile and empty/data states;
- metrics queries for offered→started, started→completed and dismissed;
- phase-2 decision gate based on real usage, not calendar time.

Mark the spec implemented only after all code and migration gates pass. Keep real-device QA explicit if it was not executed.

- [ ] **Step 7: Independent review and fixes**

Request a fresh exact-diff review against `dcb72e9` covering security/tenant isolation, concurrency, accessibility, responsive behavior, fail-open cleanup, and spec coverage. Reproduce every valid finding with RED tests, fix minimally, rerun affected gates, and obtain READY before merge.

- [ ] **Step 8: Commit final tests/docs**

```bash
git add tests/e2e/dashboard-tours.spec.ts docs/testing.md docs/testing-qa-plan.md docs/superpowers/specs/2026-08-22-dashboard-guided-tours-design.md
git commit -m "test: cover dashboard guided tours"
git status --short
git log --oneline dcb72e9..HEAD
```

Expected: clean worktree and a task-by-task commit series ready for PR review.

---

## Final self-review checklist

- [ ] Every phase-1 spec requirement maps to a task above.
- [ ] Mobile navigation ships before any tour offer can be enabled.
- [ ] Staff is fail-closed for tours and known owner/admin destinations.
- [ ] No client-controlled user/business identity enters persistence actions.
- [ ] Terminal progress cannot regress under stale multi-tab updates.
- [ ] Missing targets and persistence errors leave no click-blocking overlay.
- [ ] Dirty forms, focus, Escape, reduced motion and safe areas have executable tests.
- [ ] Tour completion never mutates onboarding or checklist state.
- [ ] No new runtime dependency or external analytics provider is introduced.
- [ ] Rollout defaults disabled and can be stopped without rolling back schema.
