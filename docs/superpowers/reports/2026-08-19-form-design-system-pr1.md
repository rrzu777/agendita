# Form design system PR1 report

## Scope

This first delivery defines semantic control densities and migrates the four Settings forms without changing schemas, mutations, field IDs, or user-facing copy. Compact controls remain the default outside Settings.

## Delivered

- Added `compact`, `form`, and `touch` densities to Input, Textarea, SelectTrigger, and Button.
- Added a reusable FormField primitive with label, help, error, inline switch layout, and ARIA wiring.
- Migrated Profile, Reservations, Policies, and Bank Transfer Settings forms.
- Standardized the Settings save and bank submit buttons on the form density.
- Added responsive geometry assertions for 375, 768, 1024, and 1440 pixel viewports.

## TDD evidence

- Control densities: RED before the density API existed; GREEN 5/5.
- FormField: RED before the primitive and inline layout existed; GREEN 5/5.
- Settings migration: RED assertions for semantic wrappers and densities; GREEN 35/35.
- Bank transfer and save bar: RED assertions for FormField/density contracts; GREEN 12/12.
- Final focused matrix: 7 files, 52 tests passed.

## Verification

- TypeScript: passed.
- ESLint quiet mode: passed.
- `git diff --check origin/main`: passed.
- Next production build: passed, including 57/57 static-generation steps.
- Settings Playwright suite: 16/16 passed against an isolated PostgreSQL 16 database with all 53 migrations.
- Full unit suite: **not green under parallel load** — 371/374 files and 3479/3483 tests passed; three existing tests timed out (`loyalty-redeem-as-me`, `payment-qa-runner-safety`, and `sign-in-with-google`). The exact three files passed immediately in isolation, 20/20, so this is classified as runner pressure rather than a reproducible branch regression. The failure remains reported honestly.
- Dependency audit from the existing lockfile reported 15 advisories (2 low, 2 moderate, 11 high); this delivery changes no dependencies.

## Visual QA

Reviewed generated screenshots for Profile, Reservations, and Payments at desktop and mobile widths under `test-results/settings-visual` during the run. Controls have consistent heights, full-width form selects, associated help/error text, and coherent bank-transfer layout.

The sticky save bar overlap visible in the current screenshots is not introduced by this branch. It is the separate fix in PR #188 and must land before this branch is integrated or rebased for final visual approval.

## Residual rollout

- Do not merge this branch before PR #188 resolves the save-dock overlap.
- Dashboard filters/tables and the public booking flow are intentionally deferred to later, separately reviewable migrations.
- Compact defaults were preserved to avoid a global visual regression.
