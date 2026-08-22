# Legacy form styles — final inventory

Date: 2026-08-22
Branch base: `19dbe900e5f6a2d13353386aa0471d25b3ad4162`

## Closed in this rollout

- `studio-input`: **0 product consumers and 0 CSS definitions**.
- Shared native select: `src/components/ui/native-select.tsx` with `compact`, `form`, and `touch` densities.
- Migrated surfaces: operational bookings, manual payments, customers, promotion/campaign dialogs, reward fields, auth, and the public customer step.
- Guard: `tests/unit/legacy-form-style-guard.test.ts` scans `src/**/*.{css,ts,tsx}` and rejects any reintroduction of `studio-input`.

## Native controls that remain

The repository contains 53 literal JSX native controls in 28 files:

- 44 `input`: 24 checkbox, 9 radio, 5 hidden, 2 file, 2 date, 1 text, and the shared `Input` primitive.
- 7 `select`: 5 legacy/product consumers, 1 explicitly documented calendar selector, and the shared `NativeSelect` primitive.
- 2 `textarea`: the public review form and the shared `Textarea` primitive.

Most are not migration candidates: hidden inputs preserve form payloads; checkbox/radio controls preserve native semantics; file inputs are intentionally hidden behind accessible buttons.

## Remaining visual debt, prioritized

### P2 — migrate as coherent feature work

1. **Fidelización settings and automation**
   - `src/app/dashboard/fidelizacion/automatic-rules.tsx`
   - `src/app/dashboard/fidelizacion/loyalty-config-form.tsx`
   - `src/app/dashboard/fidelizacion/redemption-catalog.tsx`
   - Why: hand-written selects and mixed compact/default inputs make the page internally inconsistent. This should be a separate feature because the forms are dense, conditional, and business-rule heavy.

2. **Reviews**
   - `src/app/dashboard/reviews/reviews-client.tsx`
   - `src/app/review/[bookingId]/review-form.tsx`
   - Why: hand-written search input and textarea duplicate focus, border, and error styles. Safe candidates for `Input density="form"` / `Textarea density="touch"` plus `FormField`.

3. **CSV date filters**
   - `src/components/dashboard/export-csv-button.tsx`
   - Why: two hand-written date inputs duplicate the compact input primitive and labels lack explicit `htmlFor` links.

### Intentional native exceptions

- `src/components/dashboard/calendar-views.tsx`: native select is explicitly documented for compact calendar navigation.
- Booking/payment legal acceptance, modality selection, recurrence, package terms, overlap confirmation, campaign modes, and admin plan choice: native checkbox/radio semantics are deliberate.
- Customer photos and CSV upload/export: hidden file inputs are triggered by labeled buttons.
- Hidden payload inputs in settings, bookings, loyalty, and services remain required for native form submission.

## Verification commands

```sh
rg -n 'studio-input' src
npm test -- tests/unit/legacy-form-style-guard.test.ts
rg -n '<(input|select|textarea)\b' src --glob '*.{ts,tsx}'
```

Expected: the first command returns no matches; the guard passes. The native-control search is an inventory, not a zero-target gate.
