# Form Design System PR 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introducir densidades semánticas compatibles y aplicarlas a los cuatro formularios de Configuración sin cambiar lógica de negocio.

**Architecture:** Las primitives conservan su apariencia compacta por defecto y exponen `density="form" | "touch"` de forma opt-in. Un `FormField` presentacional centraliza label, ayuda, error y atributos ARIA; cada formulario sigue siendo dueño de React Hook Form, estado y persistencia.

**Tech Stack:** Next.js 16.2.6 App Router, React 19, TypeScript, Tailwind CSS 4, CVA, Radix UI, React Hook Form, Vitest 4 y Playwright 1.59.

**Spec:** `docs/superpowers/specs/2026-08-19-form-design-system.md`

## Global Constraints

- No cambiar schemas, Server Actions, persistencia, copy ni reglas de negocio.
- `compact` conserva exactamente el alto y ancho actuales; no hay cambio global implícito.
- `form` usa 44 px en móvil, 40 px desde `md`, ancho completo y texto 16 px móvil/14 px desktop.
- `touch` usa al menos 48 px y texto de 16 px.
- No añadir dependencias ni runtime de estilos.
- Mantener `size="sm" | "default"` de `SelectTrigger` como API compatible.
- Leer antes de modificar UI: `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`.
- Cada tarea debe completar RED → GREEN → revisión → verificación → commit antes de avanzar.
- Esta sesión ejecuta los gates inline porque no hay autorización para delegar subagentes.

## File Map

- `src/components/ui/input.tsx`: densidad semántica de inputs.
- `src/components/ui/textarea.tsx`: densidad semántica de textareas.
- `src/components/ui/select.tsx`: densidad y ancho semánticos del trigger.
- `src/components/ui/button.tsx`: tamaños `form` y `touch` compatibles.
- `src/components/ui/form-field.tsx`: label, ayuda, error y contrato ARIA.
- `src/components/dashboard/settings/{profile,reservation,policy}-settings-form.tsx`: consumidores `form` y retiro de `FieldError` local.
- `src/app/dashboard/settings/payments/bank-transfer-form.tsx`: consumidor `form` y campos compartidos.
- `tests/unit/form-controls.test.tsx`: contrato de clases y compatibilidad.
- `tests/unit/form-field.test.tsx`: semántica y accesibilidad.
- `tests/unit/{profile,reservation,policy}-settings-form.test.tsx`: regresiones de Configuración.
- `tests/unit/bank-transfer-form.test.tsx`: regresión de Pagos.
- `tests/e2e/settings.spec.ts`: geometría responsive y overflow.

---

### Task 1: Semantic control densities

**Files:**
- Modify: `src/components/ui/input.tsx`
- Modify: `src/components/ui/textarea.tsx`
- Modify: `src/components/ui/select.tsx`
- Modify: `src/components/ui/button.tsx`
- Create: `tests/unit/form-controls.test.tsx`

**Interfaces:**
- Produces: `ControlDensity = 'compact' | 'form' | 'touch'` from `input.tsx`.
- Produces: `<Input density?>`, `<Textarea density?>`, `<SelectTrigger density?>`.
- Produces: `<Button size="form" | "touch">`.
- Preserves: all current props and default rendered classes.

- [ ] **Step 1: Write failing render tests**

```tsx
it('keeps compact input as the compatible default', () => {
  const html = renderToStaticMarkup(<Input />)
  expect(html).toContain('h-8')
  expect(html).not.toContain('md:h-10')
})

it('renders form and touch densities with their responsive contract', () => {
  expect(renderToStaticMarkup(<Input density="form" />)).toContain('h-11')
  expect(renderToStaticMarkup(<Input density="form" />)).toContain('md:h-10')
  expect(renderToStaticMarkup(<Textarea density="touch" />)).toContain('text-base')
})

it('makes only form selects full width', () => {
  expect(renderToStaticMarkup(<SelectTrigger density="form" />)).toContain('w-full')
  expect(renderToStaticMarkup(<SelectTrigger />)).toContain('w-fit')
})
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/unit/form-controls.test.tsx`

Expected: compile/test failure because `density` and new button sizes do not exist.

- [ ] **Step 3: Implement static density maps**

Use module constants and `cn`, not conditional template strings that Tailwind cannot discover:

```ts
export type ControlDensity = 'compact' | 'form' | 'touch'

const inputDensityClasses: Record<ControlDensity, string> = {
  compact: 'h-8 px-2.5 py-1 md:text-sm',
  form: 'h-11 bg-card px-3 py-2 text-base md:h-10 md:text-sm',
  touch: 'min-h-12 bg-card px-4 py-2 text-base',
}
```

Move only density-owned classes out of the common string. Apply equivalent maps to `Textarea` and `SelectTrigger`; `SelectTrigger` resolves `density ?? 'compact'` while retaining its existing `size` height when no density prop is passed. Add CVA button sizes:

```ts
form: 'h-11 gap-1.5 px-4 text-base md:h-10 md:text-sm',
touch: 'min-h-12 gap-2 px-5 text-base',
```

- [ ] **Step 4: Verify GREEN and compatibility**

Run: `npm test -- tests/unit/form-controls.test.tsx`

Expected: all tests pass, including default compact and legacy select size cases.

- [ ] **Step 5: Review and verify Task 1**

Run:

```bash
npx eslint src/components/ui/input.tsx src/components/ui/textarea.tsx src/components/ui/select.tsx src/components/ui/button.tsx tests/unit/form-controls.test.tsx
npm run typecheck
git diff --check
```

Inspect class precedence so caller `className` remains last and can intentionally override density.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/components/ui/input.tsx src/components/ui/textarea.tsx src/components/ui/select.tsx src/components/ui/button.tsx tests/unit/form-controls.test.tsx
git commit -m "feat: add semantic form control densities"
```

---

### Task 2: Shared FormField accessibility primitive

**Files:**
- Create: `src/components/ui/form-field.tsx`
- Create: `tests/unit/form-field.test.tsx`

**Interfaces:**
- Produces: `FormField({ id, label, help?, error?, required?, children })`.
- Produces child props: `{ 'aria-describedby': string | undefined, 'aria-invalid': boolean }`.
- Does not consume React Hook Form or maintain state.

- [ ] **Step 1: Write failing semantic tests**

```tsx
it('associates label, help and error with the control', () => {
  const html = renderToStaticMarkup(
    <FormField id="name" label="Nombre" help="Visible al público" error="Requerido">
      {(a11y) => <Input id="name" {...a11y} />}
    </FormField>,
  )
  expect(html).toContain('for="name"')
  expect(html).toContain('aria-describedby="name-help name-error"')
  expect(html).toContain('aria-invalid="true"')
  expect(html).toContain('id="name-error" role="alert"')
})
```

Add cases for help-only, no description, `required`, and ReactNode help.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/unit/form-field.test.tsx`

Expected: import failure because `form-field.tsx` does not exist.

- [ ] **Step 3: Implement the presentational primitive**

```tsx
type FormFieldA11yProps = {
  'aria-describedby': string | undefined
  'aria-invalid': boolean
}

export function FormField({ id, label, help, error, required, children }: FormFieldProps) {
  const helpId = help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div data-slot="form-field" className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</Label>
      {children({ 'aria-describedby': describedBy, 'aria-invalid': Boolean(error) })}
      {help && <p id={helpId} className="break-words text-xs text-muted-foreground">{help}</p>}
      {error && <p id={errorId} role="alert" className="break-words text-sm text-destructive">{error}</p>}
    </div>
  )
}
```

Do not duplicate a visible required word; the existing native `required` attribute remains the behavioral contract.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/unit/form-field.test.tsx`

Expected: all semantic cases pass.

- [ ] **Step 5: Review, verify and commit Task 2**

Run:

```bash
npx eslint src/components/ui/form-field.tsx tests/unit/form-field.test.tsx
npm run typecheck
git diff --check
git add src/components/ui/form-field.tsx tests/unit/form-field.test.tsx
git commit -m "feat: add accessible form field primitive"
```

---

### Task 3: Migrate Profile, Reservations and Policies

**Files:**
- Modify: `src/components/dashboard/settings/profile-settings-form.tsx`
- Modify: `src/components/dashboard/settings/reservation-settings-form.tsx`
- Modify: `src/components/dashboard/settings/policy-settings-form.tsx`
- Modify: `tests/unit/profile-settings-form.test.tsx`
- Modify: `tests/unit/reservation-settings-form.test.tsx`
- Modify: `tests/unit/policy-settings-form.test.tsx`

**Interfaces:**
- Consumes: `FormField`, `density="form"` controls.
- Removes: three local `FieldError` implementations and direct `Label` imports where unused.
- Preserves: IDs, visible labels/help/error copy, register/setValue calls and submit flow.

- [ ] **Step 1: Write failing migration tests**

For each form, render the existing component and assert:

```tsx
expect(html).toContain('data-slot="form-field"')
expect(html).toContain('data-density="form"')
```

For Reservations also assert both select triggers have the full-width form contract. Trigger one validation error in the existing interactive harness and assert its control references the error ID.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/unit/profile-settings-form.test.tsx tests/unit/reservation-settings-form.test.tsx tests/unit/policy-settings-form.test.tsx
```

Expected: failures because forms still use local `FieldError` and compact controls.

- [ ] **Step 3: Migrate Profile**

Replace each wrapper with:

```tsx
<FormField id="profile-name" label="Nombre del negocio" error={errors.name?.message}>
  {(a11y) => <Input id="profile-name" density="form" {...register('name')} {...a11y} />}
</FormField>
```

Use `Textarea density="form"`; preserve all existing IDs, types, placeholders and help copy. Delete only the local `FieldError` function and unused imports.

- [ ] **Step 4: Migrate Reservations**

Use `SelectTrigger density="form"`, `Input density="form"`, and `FormField`. Keep Switch layouts as the render-prop child so labels and help stay associated. Do not change timezone/slot values or `setValue` options.

- [ ] **Step 5: Migrate Policies**

Use `Input density="form"`, `Textarea density="form"`, and `FormField`. Preserve exact policy/reminder copy and switch behavior.

- [ ] **Step 6: Verify GREEN**

Run the three-file command from Step 2.

Expected: all pre-existing and new migration tests pass.

- [ ] **Step 7: Review, verify and commit Task 3**

Run:

```bash
npx eslint src/components/dashboard/settings/profile-settings-form.tsx src/components/dashboard/settings/reservation-settings-form.tsx src/components/dashboard/settings/policy-settings-form.tsx tests/unit/profile-settings-form.test.tsx tests/unit/reservation-settings-form.test.tsx tests/unit/policy-settings-form.test.tsx
npm run typecheck
git diff --check
```

Review the diff specifically for changed labels, IDs, `register`, `setValue`, help text and submit logic. Commit only when those contracts are unchanged:

```bash
git add src/components/dashboard/settings tests/unit/profile-settings-form.test.tsx tests/unit/reservation-settings-form.test.tsx tests/unit/policy-settings-form.test.tsx
git commit -m "refactor: unify settings form fields"
```

---

### Task 4: Migrate bank transfer and verify in browser

**Files:**
- Modify: `src/app/dashboard/settings/payments/bank-transfer-form.tsx`
- Modify: `tests/unit/bank-transfer-form.test.tsx`
- Modify: `tests/e2e/settings.spec.ts`
- Create: `docs/superpowers/reports/2026-08-19-form-design-system-pr1.md`

**Interfaces:**
- Consumes: `FormField`, `density="form"`, `Button size="form"`.
- Preserves: bank settings state, normalization, draft verification and all actions.

- [ ] **Step 1: Write failing unit tests**

Assert the rendered form uses `data-slot="form-field"`, all textual controls expose `data-density="form"`, and the submit button exposes `data-size="form"`. Add a help association assertion for `bt-hold` and `bt-verify`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/unit/bank-transfer-form.test.tsx`

Expected: migration assertions fail while existing behavior tests pass.

- [ ] **Step 3: Migrate BankTransferForm**

Wrap the nine text/number fields and textarea with `FormField`. Preserve the two switch cards as they are. Use `Button size="form"` and remove only the ad-hoc `h-11`. Keep warning copy for empty `verifyHours` as contextual help by passing the appropriate ReactNode to `help`.

- [ ] **Step 4: Verify unit GREEN**

Run: `npm test -- tests/unit/bank-transfer-form.test.tsx`

Expected: all existing state/draft tests and new design-system assertions pass.

- [ ] **Step 5: Add browser geometry assertions**

Extend the existing authenticated Settings E2E to measure representative controls on Profile, Reservations and Payments:

```ts
const box = await page.getByLabel('Nombre del negocio').boundingBox()
expect(box?.height).toBeGreaterThanOrEqual(viewport.width < 768 ? 44 : 40)

const selectBox = await page.getByLabel('Zona horaria').boundingBox()
expect(selectBox?.width).toBeGreaterThan(300)
```

At 375 px, assert no document horizontal overflow. At 1440 px, capture screenshots for Profile, Reservations and Payments into the existing test-results visual location.

- [ ] **Step 6: Run focused browser RED/GREEN**

Use the existing local PostgreSQL/seed harness documented by `tests/e2e/settings.spec.ts`, then run:

```bash
npx playwright test tests/e2e/settings.spec.ts --project=chromium
```

Expected: all Settings journeys pass at their configured viewports and new geometry assertions pass.

- [ ] **Step 7: Run PR 1 verification matrix**

```bash
npm test -- tests/unit/form-controls.test.tsx tests/unit/form-field.test.tsx tests/unit/profile-settings-form.test.tsx tests/unit/reservation-settings-form.test.tsx tests/unit/policy-settings-form.test.tsx tests/unit/bank-transfer-form.test.tsx tests/unit/settings-shell.test.tsx
npm run typecheck
npm run lint -- --quiet
git diff --check origin/main...HEAD
```

Run the production build because shared UI primitives affect application-wide compilation. Run the full unit suite serially or with the repository's bounded worker configuration; classify any failure against exact `origin/main` before reporting.

- [ ] **Step 8: Adversarial review**

Inspect every changed consumer for:

- compact defaults unchanged outside Settings;
- `className` precedence and no conflicting height classes;
- stable labels/IDs/help/error copy;
- no missing `aria-describedby` or `aria-invalid`;
- no business/action/draft changes;
- no 32 px textual controls remaining inside the four migrated forms.

If a finding is confirmed, add a failing regression, fix it, rerun focused verification and repeat the review.

- [ ] **Step 9: Write report and commit Task 4**

Record RED/GREEN evidence, exact commands/counts, screenshots, full-suite disposition and residual risks in the report. Then:

```bash
git add src/app/dashboard/settings/payments/bank-transfer-form.tsx tests/unit/bank-transfer-form.test.tsx tests/e2e/settings.spec.ts docs/superpowers/reports/2026-08-19-form-design-system-pr1.md
git commit -m "refactor: align settings form controls"
```

Do not push or create a PR until PR #188 is resolved and this branch is refreshed from `origin/main`.
