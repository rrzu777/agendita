# Remove StepPayment Loading State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar el estado `loading` inobservable y sus ramas muertas sin cambiar el comportamiento del paso de pago.

**Architecture:** `Paso` sigue siendo la única máquina de estado visible. Al comenzar una operación, los handlers cambian a `{ k: 'processing' }`, cuya rama desmonta el formulario; por eso no se reemplaza `loading` por otro estado ni por una derivación.

**Tech Stack:** React 19, TypeScript, Next.js 16, Vitest.

## Global Constraints

- No cambiar payloads, llamadas server-side, transiciones de `Paso` ni manejo de errores.
- No agregar un test que inspeccione texto fuente o nombres privados.
- Preservar los textos alcanzables de los botones en reposo.

---

### Task 1: Eliminar el estado de carga duplicado

**Files:**
- Modify: `src/components/booking/step-payment.tsx`
- Test: `tests/unit/step-payment-pantalla-por-step.test.tsx`
- Test: `tests/unit/step-payment-plazo-transferencia.test.tsx`
- Test: `tests/unit/booking-legal-ui.test.tsx`

**Interfaces:**
- Consumes: la unión `Paso` existente y su rama `{ k: 'processing' }`.
- Produces: el mismo `StepPayment` público, sin estado `loading` ni setters asociados.

- [ ] **Step 1: Confirmar el contrato observable antes del refactor**

Run:

```bash
npx vitest run tests/unit/step-payment-pantalla-por-step.test.tsx tests/unit/step-payment-plazo-transferencia.test.tsx tests/unit/booking-legal-ui.test.tsx
```

Expected: PASS. Estos son tests de caracterización: una prueba nueva que fallara sólo por existir `loading` sería un detector de implementación y no se agrega.

- [ ] **Step 2: Escribir la implementación mínima**

En `step-payment.tsx`:

```tsx
// Eliminar:
const [loading, setLoading] = useState(false)

// Eliminar de los tres handlers:
setLoading(true)
setLoading(false)

// Los botones visibles sólo conservan condiciones observables:
disabled={!acceptedTerms}

// Los textos conservan la rama alcanzable:
Confirmar reserva
Continuar con transferencia
Pagar abono {formatMoney(effectiveDeposit, currency)}
```

- [ ] **Step 3: Verificar el contrato focalizado**

Run:

```bash
npx vitest run tests/unit/step-payment-pantalla-por-step.test.tsx tests/unit/step-payment-plazo-transferencia.test.tsx tests/unit/booking-legal-ui.test.tsx tests/unit/booking-review-ui.test.tsx
npx eslint src/components/booking/step-payment.tsx
git diff --check
```

Expected: todos los tests pasan, ESLint y diff-check sin errores.

- [ ] **Step 4: Pasar revisión independiente**

Solicitar revisión de `src/components/booking/step-payment.tsx` contra `origin/main`, comprobando doble envío, transiciones de error/reintento, redirect externo y que no cambien los contratos de pagos.

- [ ] **Step 5: Ejecutar verificación completa**

Run:

```bash
npm test
npx eslint src tests
npm run build
```

Expected: suite completa y build pasan; lint no agrega errores nuevos.

- [ ] **Step 6: Commit del track**

```bash
git add src/components/booking/step-payment.tsx docs/superpowers/plans/2026-08-05-remove-step-payment-loading.md
git commit -m "refactor: eliminar carga redundante en StepPayment"
```
