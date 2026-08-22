# Legacy form styles — final inventory

Date: 2026-08-22
Branch base: `4b4b6c98476f0f1ad7ddb81df76a9b57f0b88859`

## Closed in this rollout

- `studio-input`: **0 product consumers and 0 CSS definitions**.
- Shared native select: `src/components/ui/native-select.tsx` with `compact`, `form`, and `touch` densities.
- Migrated surfaces: operational bookings, manual payments, customers, promotion/campaign dialogs, reward fields, auth, the public customer step, Fidelización, Reseñas, and CSV date filters.
- Guard: `tests/unit/legacy-form-style-guard.test.ts` scans `src/**/*.{css,ts,tsx}` and rejects `studio-input`, visible text-like native inputs, unapproved native selects, and product textareas outside the shared primitives.

## Native controls that remain

The repository contains 44 literal JSX native controls in 25 files:

- 41 `input`: checkbox, radio, hidden, and file controls plus the shared `Input` primitive. There are no remaining product-native text, search, date, number, email, URL, tel, or password inputs.
- 2 `select`: the explicitly documented compact calendar selector and the shared `NativeSelect` primitive.
- 1 `textarea`: the shared `Textarea` primitive.

Most are not migration candidates: hidden inputs preserve form payloads; checkbox/radio controls preserve native semantics; file inputs are intentionally hidden behind accessible buttons.

## Visual debt disposition

The P2 visual-form inventory is closed. Fidelización now uses shared fields, inputs, selects, and form-size buttons without changing its schemas or server actions. Reseñas now has semantic filter/rating groups and shared search/comment controls. CSV date filters now use compact shared fields with explicit label associations.

Native checkbox, radio, hidden, and file elements are not counted as visual-form debt because replacing them would remove useful browser semantics or add abstraction without a product benefit.

## Delivery evidence

- Fidelización: `e0fa74f`.
- Reseñas: `15d1a2e`.
- CSV: `5fd7c64`.
- Architecture guard: `3cf6935`.
- Responsive browser coverage: `5d39755`.
- Full unit suite: 384 files passed; 3,511 tests passed and 1 skipped.
- Production Playwright rollout: 15/15 passed at 375, 768, and 1,440 px.
- TypeScript, Prisma validation/generation, and the Next.js production build passed.
- ESLint completed with 0 errors and 29 pre-existing warnings outside this rollout.

### Intentional native exceptions

- `src/components/dashboard/calendar-views.tsx`: native select is explicitly documented for compact calendar navigation.
- Booking/payment legal acceptance, modality selection, recurrence, package terms, overlap confirmation, campaign modes, and admin plan choice: native checkbox/radio semantics are deliberate.
- Customer photos and CSV upload/export: hidden file inputs are triggered by labeled buttons.
- Hidden payload inputs in settings, bookings, loyalty, and services remain required for native form submission.

## Verification commands

```sh
rg -n 'studio-input' src
npm test -- tests/unit/legacy-form-style-guard.test.ts
rg -n -U -o '<input\b[^>]*>' src --glob '*.{ts,tsx}'
rg -n -U -o '<(select|textarea)\b[^>]*>' src --glob '*.{ts,tsx}'
```

Expected: the first command returns no matches; the guard passes. The native-control searches remain an auditable inventory, while the test enforces the approved semantic exceptions.
