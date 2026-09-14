# Product experience refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Independent review is mandatory before each track commit.

**Goal:** Resolve all nine owner observations, verify the behavior and deliver the finished changes.

**Architecture:** Extend the existing tenant design system and domain boundaries. Keep setup optional, compact operational UI, canonical safe message rendering, and explicitly reviewed identity resolution.

**Tech Stack:** Next.js 16.3.2, React 19, Tailwind 4, Radix, Prisma/PostgreSQL, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-product-experience-refinements-design.md`.

## Global Constraints

- Preserve tenant/auth isolation, payment facts, consent, booking lifecycle and analytics definitions.
- Spanish es-CL, tuteo, shared vocabulary and existing DESIGN.md; actions at least 44px.
- No staging, real bookings/payments/messages, provider activation or automatic production customer merges.
- Use apply_patch; preserve other worktrees. Read relevant bundled Next documentation before code.
- RED → GREEN regression evidence, independent review, fix/re-review, lint/typecheck/build before track commit; full integration/E2E and release checks before publication.
- Keep all nine outcomes in scope. Document uncertain runtime verification as pending, never completed.

## Tracks and proof ledger

| Task | Scope | State |
|---|---|---|
| 1 | Non-blocking onboarding tabs | Verified; review and re-review clean, local commit ready |
| 2 | Public service proportions + shared picker/favorites | Pending |
| 3 | Booking action menu + truthful calendar geometry | Pending |
| 4 | Contact deduplication and reviewed merge | Pending |
| 5 | Compact chart-led metrics | Pending |
| 6 | Loyalty information architecture | Pending |
| 7 | Message settings, safe renderer and all producers | Pending |
| 8 | Cross-track review, DB/E2E/visual QA, exact-head release | Pending |

### Task 1: Non-blocking onboarding tabs

**Files:**
- Modify `src/app/dashboard/page.tsx`, `src/app/dashboard/onboarding/page.tsx`, `src/components/onboarding/onboarding-wizard.tsx`, `src/server/actions/onboarding.ts`.
- Extend `src/components/dashboard/setup-checklist.tsx` only if needed for a discoverable setup entry point.
- Reuse `src/components/ui/tabs.tsx`, `Button` and existing settings destinations.
- Tests: `tests/unit/onboarding.test.ts`, `tests/unit/onboarding-navigation.test.tsx`, add `tests/unit/onboarding-dashboard-entry.test.tsx` and focused Playwright coverage in `tests/e2e/settings.spec.ts` or a dedicated onboarding spec.

**Interfaces:** Keep `OnboardingWizard` exported for existing consumers; implementation is a tabbed setup screen. Keep `saveOnboardingStep(businessId, step)` and `completeOnboarding(businessId)` ActionResult contracts. No schema migration. `onboardingCompletedAt` is explicit completion, never set by a GET or visiting a tab.

- [x] Write failing behavior tests. Rendering Hoy with `onboardingCompletedAt: null` must return its dashboard rather than redirect to setup. The setup component offers all five tabs directly; visiting Horarios from Tu negocio reveals its content without Siguiente. Current tab has `aria-selected`, panels are labelled, arrow-key navigation works. Invalid persisted indices render a valid first panel. Completion only succeeds after the server confirms both active services and business-level availability. Prevent duplicate completion and preserve retryable errors.

```tsx
// Representative observable assertions, using the repository's React DOM harness:
await act(async () => horariosTab.click())
expect(horariosTab.getAttribute('aria-selected')).toBe('true')
expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('horario')
expect(container.textContent).not.toContain('Siguiente')
```

- [x] Run `npm test -- tests/unit/onboarding.test.ts tests/unit/onboarding-navigation.test.tsx tests/unit/onboarding-dashboard-entry.test.tsx` and record expected RED.
- [x] Remove only the incomplete-onboarding redirect from Hoy (preserve missing-user/business guards). Add a compact optional setup entry for incomplete accounts; after completion it disappears. Keep completed accounts redirecting away from initial setup to Hoy.
- [x] Replace inert step list and Previous/Next gate with shared Radix Tabs, retaining all five sections and meaningful edit links. Rename final tab to a non-misleading label such as Listo para recibir reservas: public visibility is not newly published by this flow. Use actual data readiness, not visited-tab position, for check indicators. Allow owner to return to Hoy without finishing. Finish is explicit, disabled until requirements, safely retryable, and navigates with refreshed server state.
- [x] Validate saved index as integer 0–4; serialize or safely handle tab persistence so fast tab changes cannot regress the saved tab. Clipboard success only after fulfilled write, with inline error and retry on failure. No automatic writes on mount.
- [x] Update existing orientation tests to assert tabs and target size rather than preserve obsolete wizard structure. Add completed-account and missing-user/business route behavior.
- [x] Run focused tests and real-browser narrow/desktop keyboard/finish/error checks with isolated fixtures. Obtain independent spec+quality review, resolve findings, run lint/typecheck/build and commit the track.


Verification: independent review and scoped re-review closed all findings. Root lint/typecheck passed; final affected filter run reported 9 files / 71 passing tests. Real-PostgreSQL browser spec passed 5/5 without retries (390/834/1440, keyboard/reload, explicit completion and failed-request retry); all three captures inspected. `APP_ENV=e2e npm run build` passed with 61 generated pages, using the same isolated build mode as CI. No production mutations. Track ready for local commit.
### Task 2: Public catalogue and color controls

**Files:**
- Modify `src/components/public/business-profile.tsx`, `src/components/dashboard/service-form.tsx`, `src/components/dashboard/settings/profile-settings-form.tsx`.
- Wire initial favorites and mutation permission in `src/app/dashboard/services/page.tsx`, `src/app/dashboard/settings/profile/page.tsx`; use one shared provider around the service table instead of a request per row/dialog.
- Create `src/components/ui/color-picker.tsx`, `src/components/dashboard/color-favorites-provider.tsx`, `src/lib/business/color-favorites.ts`, `src/server/actions/color-favorites.ts` and an additive Prisma model/migration.
- Modify `src/components/dashboard/service-table.tsx` or `service-row-actions.tsx` only where consuming shared favorites requires it. Existing order, active state and service-money behavior remain untouched.
- Tests: new shared control/favorites unit tests, existing service/profile form tests, real-PostgreSQL favorite isolation/concurrency tests and focused catalogue/picker E2E.

**Binding decisions and interfaces:**
- `BusinessColorFavorite` is a tenant-scoped collection with `id`, `businessId`, `color`, `createdAt`, a Business relation and unique `(businessId,color)`. Uppercase `#RRGGBB`, maximum 12 favorites per tenant. Enable RLS using the repository's server-only table policy; expose no anonymous browser-DB access. No changes to current service or brand color values in the migration.
- Server reads derive business from `requireBusiness`; add/remove use `requireBusinessRole(['owner','admin'])`, rate limiting and `ActionResult`. No client-provided business ID is an authority. A shared repository helper inside a real transaction acquires `acquireAdvisoryXactLock(tx, 'business-color-favorites:' + businessId)` before checking existence/count and mutating. Add/remove are idempotent, return the authoritative list and never replace the entire collection. Validate before DB access. Deleting an already-absent favorite succeeds; adding an existing favorite at the limit also succeeds.
- The provider serializes its mutations, exposes pending/error/retry and uses the canonical result only after success. A failed favorite save never clears or rewrites a service/profile draft. Favorites are clearly saved separately from the service/profile form. Selecting a favorite changes only that form's color draft, not persisted brand/service color. Do not auto-save on mount or send any external request outside app server actions.
- The shared picker owns native `input[type=color]`, visible HEX text input, selected-color preview and favorites UI. The native OS color dialog is intentionally platform-owned. One controlled raw HEX value is authoritative; invalid/incomplete text must not silently save the last valid color. Normalize only valid values. Native input uses a valid fallback while HEX is incomplete, without altering the user's text. Brand color may be cleared for automatic/default theme; service color is required. Preserve RHF dirty/errors/draft recovery through `setValue`/Controller rather than bypassing the profile form. Favorite/preset controls and native picker have accessible names, pressed state when selected and at least 44px targets.
- Reuse the existing pastel suggestions as optional presets; favorites are a distinct labelled group, not silently persisted presets. Add and remove favorites are separate explicit controls, never nested buttons. Bound/wrap the group at narrow widths. Use shared tokens, no new visual theme.
- Public services get a flexible name/description column and a consistent price/action rail at wide widths; on narrow widths stack cleanly. Equal CTA dimensions for peer cards at a given viewport. Use the actual service color as a restrained decorative cue, while names/prices remain readable with semantic text colors. No truncation that hides essential description/pricing, no giant stretched blank action column. Preserve service query links, duration, deposit/no-deposit facts and service categories.

**Steps and evidence:**
- [ ] Write and run RED tests for native/HEX synchronization, invalid HEX preventing submit, clear optional brand color, failed-save draft preservation and favorite select/add/remove behavior.
- [ ] Write failing DB tests for normalized duplicates, tenant isolation, unauthorized staff, limit 12, same-color idempotency and concurrent distinct additions at count 11. Concurrent tests must use real shared PostgreSQL writers and the production repository helper, not mocked locks.
- [ ] Implement schema/action/helper/control/provider and wire both services and profile settings. Make service-form validation app-owned (`noValidate`) with first-invalid focus and inline association for touched color behavior; retain validation of existing required fields rather than disabling browser bubbles without replacement.
- [ ] Correct catalogue and service-preview proportions, wrap long price/abono/duration text and keep peer CTAs consistent.
- [ ] Run unit/integration checks and real-browser save/reload/reuse/delete across the two screens; a favorite saved in services must appear in profile after navigation/reload and another tenant must not see it. Exercise server failure without draft loss. Use disposable fixtures only.
- [ ] Browser matrix: 320/390/834/1440 widths, long service name/description, nonzero and zero abono, soft/balanced/contrast, keyboard focus, measured CTA/control sizes and no document overflow. Root coordinates the single local server and runs final build; worker must not start a second server/build.
- [ ] Independent spec/quality review, fixes/re-review, lint/typecheck/build and track commit. No production migration until release.

### Task 3: Reservation action density and calendar

Files: `booking-row-actions.tsx`, `booking-contact-buttons.tsx`, booking list/card consumers, `calendar-views.tsx`, `src/lib/calendar/timeline.ts`, existing calendar and booking action tests. Derive lane clusters from real intervals; presentation must not claim a 20-minute service runs into the next appointment. Retain 44px accessible equivalent actions, mobile agenda, drawer focus and genuine concurrency lanes.

Core regression: 11:30–11:50 then 12:00–13:30 have no temporal overlap or displayed duration extension; 11:30–12:15 and 12:00–13:30 do overlap. Test actual bounding boxes and access, not only a constant. Every booking status has at most primary+overflow; expired records never display confirmation/reminder as if active. Preserve recovery/payment guards.

### Task 4: Contact identity

Files: `src/lib/customers/*`, `src/server/actions/customers.ts`, customer pages/list/detail, Prisma additive migration, integration tests. First enumerate all Customer writers and all Customer foreign keys. Write the identity/merge transaction contract in a dedicated task addendum before implementation; contract must cover locks, uniqueness, existing linked users, opt-out precedence, immutable booking/payment snapshots, loyalty/package ledgers and audit/idempotency. Test race/rollback with real shared PostgreSQL. Implement review groups and explicit confirmation, never email-only silent merging.

### Task 5: Metrics hierarchy

Files: `src/components/dashboard/analytics/analytics-{controls,dashboard,tables}.tsx`, chart primitives, tests. Preserve URL filter contracts and cohorts. Test preset hides irrelevant date inputs, custom date validation remains, operational charts render without capture, and unavailable values stay unavailable. Promote trend/funnel; add labelled booking-state/origin distribution where it helps comparison. All graph values derive from existing report facts; provide textual/table equivalents. Move methodology and population proofs into accessible disclosures.

### Task 6: Loyalty sections

Files: `src/app/dashboard/fidelizacion/*`, existing loyalty/preset/automatic tests and E2E. Inventory all current controls before moving them. Shared tabs with current-program summary, program rules, rewards and automatic benefits; all details remain reachable. Preserve drafts on tab switches and save/error focus, preset confirmations and monetary rules. Verify existing end-to-end flows against the rearranged UI.

### Task 7: Customer message settings

Files: dedicated `src/app/dashboard/settings/messages/*`, settings navigation registry, safe schema/renderers under `src/lib/notifications`, server settings actions, Prisma additive migration, all inventoried WhatsApp/email producers. Create a producer→kind→context→renderer→test inventory before editing. Render variables as data (no code/HTML execution), validate supported variables and lengths, preserve mandatory facts/links in system-owned blocks, use fallback defaults for absent configuration, previews explicitly synthetic. Bind editing to owner/admin settings access; stale revisions fail without discarding drafts. Save/reset does not dispatch. Test default parity and customized output at each producer, tenant isolation, malformed variables, escaping and no unintended sends.

### Task 8: Completion and release

- [ ] Map every spec row to exact code/tests/browser evidence; resolve gaps.
- [ ] Run fresh full unit, integration, E2E, lint, typecheck, build and Premium checks on exact HEAD. Review dependency audit reachability and resolve release-relevant problems without unbounded upgrades.
- [ ] Capture changed surfaces at 390×844, 834×1112, 1440×1000 and the user's desktop width; inspect 320px for long content. Keyboard/focus, all tenant styles, loading/empty/error, real and false calendar overlaps, saving/reloading templates and favorites, safe local merge are required.
- [ ] Independent branch/visual review, fixes and scoped re-review. No duplicate Impeccable detector loop in the same session.
- [ ] Publish PR(s), refresh exact HEAD/checks/threads/mergeability, merge through authorized workflow, verify Production SHA and health plus read-only live smoke. No live customer-data merge or test sends.
- [ ] Report changes, material decisions, evidence and any unrelated activation gates. Mark goal complete only when all nine rows are proven delivered.
