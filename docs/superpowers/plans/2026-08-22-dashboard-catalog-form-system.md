# Dashboard Catalog Form System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar el sistema semántico de formularios a los dialogs de Servicios y Equipo sin cambiar reglas de negocio ni contratos de datos.

**Architecture:** Los formularios cliente existentes conservarán su estado y sus Server Actions. `FormField` será dueño de labels y asociaciones ARIA para controles de texto; los grupos de checkbox seguirán siendo nativos pero usarán `fieldset` y `legend`. Las densidades `form` se aplicarán sólo a campos y submits del dialog, no a botones de tabla ni chips compactos.

**Tech Stack:** Next.js 16.2.6 App Router, React 19, TypeScript, Radix Dialog, Tailwind CSS 4, Vitest 4 y Playwright 1.59.

**Spec:** `docs/superpowers/specs/2026-08-19-form-design-system.md`

## Global Constraints

- Conservar la paleta, tipografía, radios y personalidad visual existentes.
- No cambiar schemas, Server Actions, payloads, validación ni reglas de negocio.
- `form` mide 44 px en móvil y 40 px desde `md`; los campos principales ocupan el ancho disponible.
- Mantener nativos los checkbox, hidden inputs, chips de duración y swatches de color.
- Labels reales, ayuda y errores deben quedar asociados semánticamente.
- No ampliar el bundle con dependencias ni nuevas suscripciones de estado.

---

### Task 1: Contrato RED de dialogs operacionales

**Files:**
- Create: `tests/unit/catalog-form-system.test.tsx`
- Test: `tests/unit/service-row-actions.test.tsx`
- Test: `tests/unit/professional-table.test.tsx`

**Interfaces:**
- Consumes: `FormField`, `Input density`, `Textarea density`, `Button size` ya integrados en PR #189.
- Produces: contrato verificable para los campos de Servicios, Equipo y grupos compartidos.

- [ ] **Step 1: Escribir el test que renderiza el contenido real de cada dialog**

Mockear únicamente los portals de Radix para que `DialogContent` permanezca en el árbol. Afirmar:

```tsx
expect(markup).toContain('data-density="form"')
expect(markup).toContain('data-size="form"')
expect(markup).toContain('data-slot="form-field"')
expect(markup).toMatch(/<fieldset[^>]*aria-describedby="service-modalities-help"/)
expect(markup).toMatch(/<legend[^>]*>¿Dónde se atiende\?<\/legend>/)
```

El test debe demostrar además que el campo hex no se encoge por `w-fit` y que los botones de tabla conservan sus tamaños existentes.

- [ ] **Step 2: Ejecutar RED**

Run:

```bash
npm test -- tests/unit/catalog-form-system.test.tsx
```

Expected: FAIL porque Servicios y Equipo aún usan `.studio-input`, labels sueltos y submits sin tamaño semántico.

- [ ] **Step 3: Confirmar que el fallo es contractual**

Nombrar la producción que haría pasar cada aserción: `FormField`, `density="form"`, `size="form"`, `fieldset/legend`. Corregir el test si falla por mocks o por no abrir el portal.

- [ ] **Step 4: Commit del test RED junto con la implementación GREEN de Tasks 2–3**

El test RED no se commitea solo; se conserva su salida en el reporte del PR y se incluye en el commit funcional después de GREEN.

### Task 2: Migrar ServiceForm

**Files:**
- Modify: `src/components/dashboard/service-form.tsx`
- Test: `tests/unit/catalog-form-system.test.tsx`

**Interfaces:**
- Consumes: `FormField({ id, label, help, required, children })`, `Input density="form"`, `Textarea density="form"`, `Button size="form"`.
- Produces: dialog de alta/edición de servicio con controles consistentes y payload `FormData` idéntico.

- [ ] **Step 1: Reemplazar wrappers de texto por FormField**

Patrón exacto:

```tsx
<FormField id="service-name" label="Nombre" required>
  {(a11y) => (
    <Input
      id="service-name"
      density="form"
      name="name"
      defaultValue={service?.name}
      required
      {...a11y}
    />
  )}
</FormField>
```

Aplicar el mismo patrón a descripción, precio, abono, horas, minutos y color hexadecimal. Mantener los `name`, `defaultValue`, handlers, límites y `inputMode` actuales.

- [ ] **Step 2: Conservar controles intencionales**

No reemplazar:

```tsx
<input type="hidden" name="durationMinutes" value={duration} />
```

Mantener chips de duración y swatches de color como botones. El hex usará `density="form"` con `className="max-w-32 font-mono"`, evitando clases de alto manuales.

- [ ] **Step 3: Alinear submit y estado**

Usar:

```tsx
<Button type="submit" size="form" className="w-full font-semibold" disabled={loading}>
  {loading ? 'Guardando…' : 'Guardar'}
</Button>
```

El error global existente conserva `text-destructive`; añadir `role="alert"` sin cambiar su copy.

- [ ] **Step 4: Ejecutar GREEN parcial**

Run:

```bash
npm test -- tests/unit/catalog-form-system.test.tsx tests/unit/service-row-actions.test.tsx
```

Expected: los casos de Servicio pasan; Equipo continúa RED hasta Task 3.

### Task 3: Migrar ProfessionalForm y grupos compartidos

**Files:**
- Modify: `src/components/dashboard/professional-form.tsx`
- Modify: `src/components/dashboard/modality-checkboxes.tsx`
- Test: `tests/unit/catalog-form-system.test.tsx`
- Test: `tests/unit/professional-table.test.tsx`

**Interfaces:**
- Consumes: mismas primitives semánticas que Task 2.
- Produces: dialog de Equipo consistente y `ModalityCheckboxes` accesible para ambos formularios.

- [ ] **Step 1: Migrar Nombre y Presentación**

Usar `FormField` con IDs `professional-name` y `professional-bio`, `density="form"` y los mismos `name/defaultValue/required/placeholder` actuales.

- [ ] **Step 2: Dar semántica al grupo de servicios**

Reemplazar el wrapper visual por:

```tsx
<fieldset aria-describedby={serviceIds.length === 0 ? 'professional-services-warning' : undefined}>
  <legend className="text-sm font-medium text-foreground">¿Qué servicios hace?</legend>
  {/* checkboxes nativos y cards actuales */}
</fieldset>
```

El warning de cero servicios tendrá `id="professional-services-warning"`; no cambiar copy ni lógica de selección.

- [ ] **Step 3: Dar semántica reutilizable a modalidades**

`ModalityCheckboxes` debe generar un ID estable con `useId()` y renderizar:

```tsx
<fieldset aria-describedby={helpId}>
  <legend className="text-sm font-medium text-foreground">{label}</legend>
  {/* checkboxes nativos existentes */}
  <p id={helpId}>{hint}</p>
</fieldset>
```

No cambiar `MODALITY_ORDER`, labels, hints, `selected` ni `onToggle`.

- [ ] **Step 4: Alinear submit y error**

Usar `Button size="form"`, puntos suspensivos tipográficos en `Guardando…` y `role="alert"` en el error global.

- [ ] **Step 5: Ejecutar GREEN completo**

Run:

```bash
npm test -- tests/unit/catalog-form-system.test.tsx tests/unit/service-row-actions.test.tsx tests/unit/professional-table.test.tsx tests/unit/service-modality.test.ts
```

Expected: PASS sin alterar las expectativas de negocio existentes.

- [ ] **Step 6: Commit funcional**

```bash
git add tests/unit/catalog-form-system.test.tsx \
  src/components/dashboard/service-form.tsx \
  src/components/dashboard/professional-form.tsx \
  src/components/dashboard/modality-checkboxes.tsx
git commit -m "refactor: align catalog form controls"
```

### Task 4: E2E responsive y gates

**Files:**
- Create: `tests/e2e/catalog-forms.spec.ts`
- Modify: `docs/superpowers/reports/2026-08-22-dashboard-catalog-form-system.md`

**Interfaces:**
- Consumes: dialogs terminados de Tasks 2–3 y bypass E2E existente.
- Produces: prueba de usuario real en Servicios/Equipo y evidencia para PR.

- [ ] **Step 1: Escribir Playwright RED**

Con owner auth y seed existente, recorrer 375, 768 y 1440 px. En cada ancho:

```ts
await page.goto('/dashboard/services')
await page.getByRole('button', { name: 'Nuevo servicio' }).click()
await expect(page.getByLabel('Nombre', { exact: true })).toHaveCSS('font-size', width < 768 ? '16px' : '14px')
await expectNoHorizontalOverflow(page)
```

Verificar alto mínimo 44/40, dialog dentro del viewport, labels por nombre accesible y cierre sin mutar. Repetir en `/dashboard/equipo` con el botón `Agregar manicurista`. No crear registros persistentes en este PR visual.

- [ ] **Step 2: Ejecutar RED y ajustar sólo selectores incorrectos**

Run:

```bash
npx playwright test tests/e2e/catalog-forms.spec.ts --project=chromium
```

Expected: inicialmente FAIL antes de Tasks 2–3; tras GREEN debe pasar sin cambiar producción adicional.

- [ ] **Step 3: Gates focales**

```bash
npm test -- tests/unit/catalog-form-system.test.tsx \
  tests/unit/service-row-actions.test.tsx \
  tests/unit/professional-table.test.tsx \
  tests/unit/service-modality.test.ts \
  tests/unit/services-schema.test.ts \
  tests/unit/professionals-schema.test.ts \
  tests/unit/form-controls.test.tsx \
  tests/unit/form-field.test.tsx
npm run typecheck
npm run lint -- --quiet
git diff --check origin/main...HEAD
```

- [ ] **Step 4: Matriz proporcional**

Ejecutar la suite unitaria serial configurada en CI, integración PostgreSQL si cualquier test de actions/schema se ve afectado, Playwright focal y build de producción. Clasificar cualquier fallo contra `origin/main`; no llamarlo verde por pasar aislado.

- [ ] **Step 5: Revisión adversarial inline**

Inspeccionar el diff exacto buscando: cambios de `name`, pérdida de required/min/max/defaultValue, labels sin asociación, checkboxes sin grupo, tamaños compactos mutados, overflow y regresiones de dialog. Corregir Critical/Important antes del PR.

- [ ] **Step 6: Commit E2E/reporte**

```bash
git add tests/e2e/catalog-forms.spec.ts \
  docs/superpowers/reports/2026-08-22-dashboard-catalog-form-system.md
git commit -m "test: cover catalog form journeys"
```

- [ ] **Step 7: Crear PR y esperar gates remotos**

Push de `feature/dashboard-catalog-form-system`, PR contra `main`, refresh exacto de HEAD/base/checks/threads y merge sólo con unit, integración, E2E, build, lint, typecheck y Vercel verdes.
