# PR 1 — Honestidad de la UI + fixes chicos: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la disponibilidad no mienta: rate limit humano, errores distinguibles de "sin horas", lead time visible y compartido, walk-ins para la dueña, reglas de horario no invertibles, y fix del exclude de vitest.

**Architecture:** Cambios quirúrgicos sin migración. Se extrae `LEAD_TIME_MINUTES` a una constante compartida (`src/lib/availability/constants.ts`) consumida por `slots.ts`, `validation.ts` y la UI. `assertSlotIsAvailable` gana un override opcional `leadTimeMinutes` que los flujos de la dueña fijan en 0. Ver spec: `docs/superpowers/specs/2026-07-05-availability-fixes-design.md`.

**Tech Stack:** Next.js (App Router, server actions), Prisma, date-fns/date-fns-tz, vitest (jsdom, tests de componente con `react-dom/client` + `act`, sin testing-library).

**Runner:** los tests se corren DESDE el worktree (`cd` al worktree y `npx vitest run ...`): node resuelve `node_modules` subiendo hasta el checkout principal (`/Users/robertozamorautrera/Projects/agendita`). Los unit tests no tocan DB (todo mockeado). Git: usar siempre `git -C <worktree>` y `git add` con archivos explícitos.

---

### Task 1: Constante `LEAD_TIME_MINUTES` compartida + override en `assertSlotIsAvailable`

**Files:**
- Create: `src/lib/availability/constants.ts`
- Modify: `src/lib/availability/slots.ts:57-62`
- Modify: `src/lib/availability/validation.ts:7-15,41-48`
- Test: `tests/unit/availability-validation.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final del `describe('assertSlotIsAvailable', ...)` en `tests/unit/availability-validation.test.ts` (el reloj fake es `2026-05-19T00:00:00Z` = lunes 18 de mayo 20:00 en Santiago, UTC-4):

```ts
  it('accepts a near-term slot when leadTimeMinutes is 0 (walk-in de la dueña)', async () => {
    // 30 min desde ahora: 2026-05-19T00:30Z = lunes 18 20:30 Santiago
    const soonStart = new Date('2026-05-19T00:30:00Z')
    const soonEnd = new Date('2026-05-19T01:30:00Z')
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '22:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: soonStart, endDateTime: soonEnd, timezone, leadTimeMinutes: 0 }))
      .resolves.toBeUndefined()
  })

  it('still rejects a near-term slot with the default lead time', async () => {
    const soonStart = new Date('2026-05-19T00:30:00Z')
    const soonEnd = new Date('2026-05-19T01:30:00Z')
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '22:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: soonStart, endDateTime: soonEnd, timezone }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects a slot in the past even with leadTimeMinutes 0', async () => {
    const pastStart = new Date('2026-05-18T20:00:00Z') // 4h antes de "ahora"
    const pastEnd = new Date('2026-05-18T21:00:00Z')
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '22:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: pastStart, endDateTime: pastEnd, timezone, leadTimeMinutes: 0 }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run tests/unit/availability-validation.test.ts`
Expected: FAIL — TypeScript no conoce `leadTimeMinutes` en `AssertSlotInput` / el primer test rechaza en el chequeo de lead time.

- [ ] **Step 3: Implementar**

Create `src/lib/availability/constants.ts`:

```ts
/**
 * Anticipación mínima (en minutos) para reservar en el flujo público.
 * Compartida entre generación de slots (slots.ts), validación (validation.ts)
 * y la UI (step-time.tsx) para que nunca se ofrezca un horario que la
 * validación rechazaría — y para que el copy de la UI no se desincronice.
 */
export const LEAD_TIME_MINUTES = 120
```

En `src/lib/availability/slots.ts`: importar la constante y usarla como default (reemplaza el literal `120` en la destructuración de options):

```ts
import { LEAD_TIME_MINUTES } from './constants'
// ...
    leadTimeMinutes = LEAD_TIME_MINUTES,
```

En `src/lib/availability/validation.ts`: agregar a `AssertSlotInput`:

```ts
  /** Anticipación mínima en minutos; los flujos de la dueña pasan 0 (walk-ins). Default: LEAD_TIME_MINUTES. */
  leadTimeMinutes?: number
```

y reemplazar el bloque de lead time (líneas 43-48):

```ts
  // Lead time mínimo (default 2 horas); 0 = permitir desde "ahora" (dueña)
  const leadTimeMinutes = input.leadTimeMinutes ?? LEAD_TIME_MINUTES
  const minStart = addMinutes(now, leadTimeMinutes)
  if (startDateTime < minStart) {
    logEvent('slot_validation_rejected', { businessId, reason: 'lead_time', slotStart: startDateTime.toISOString() })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }
```

con `import { LEAD_TIME_MINUTES } from './constants'`.

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run tests/unit/availability-validation.test.ts tests/unit/slots.test.ts`
Expected: PASS (todos, incluidos los preexistentes).

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/lib/availability/constants.ts src/lib/availability/slots.ts src/lib/availability/validation.ts tests/unit/availability-validation.test.ts
git -C <worktree> commit -m "Extract shared lead time constant with per-call override"
```

---

### Task 2: Flujos de la dueña con lead time 0 (walk-ins)

**Files:**
- Modify: `src/server/actions/bookings.ts:741-748` (createBookingFromDashboard) y `:1028-1036` (rescheduleBooking)

- [ ] **Step 1: Agregar el override en ambos call sites**

En `createBookingFromDashboard` (línea ~741) y en `rescheduleBooking` (línea ~1028), agregar `leadTimeMinutes: 0,` al objeto de `assertSlotIsAvailable`. Ejemplo (reschedule):

```ts
    await assertSlotIsAvailable({
      tx,
      businessId,
      serviceId: booking.serviceId,
      startDateTime: newStartDateTime,
      endDateTime,
      timezone: business.timezone || 'America/Santiago',
      excludeBookingId: bookingId,
      leadTimeMinutes: 0,
    })
```

El `createBooking` público (línea ~245) NO se toca (mantiene el default 120).

- [ ] **Step 2: Verificar tipos y suite relacionada**

Run: `npx tsc --noEmit` y `npx vitest run tests/unit/reschedule-availability.test.ts tests/unit/dashboard-bookings-advanced.test.ts`
Expected: PASS. (Si algún test existente afirmaba el rechazo por lead time en flujos de dueña, actualizarlo: el nuevo comportamiento es el deseado.)

- [ ] **Step 3: Commit**

```bash
git -C <worktree> add src/server/actions/bookings.ts
git -C <worktree> commit -m "Allow owner flows to book walk-ins with zero lead time"
```

---

### Task 3: Rate limit de disponibilidad a 60/min

**Files:**
- Modify: `src/server/actions/availability.ts:37`

- [ ] **Step 1: Usar la config `get-availability`**

Reemplazar en `getAvailableTimeSlots`:

```ts
  const limit = await checkRateLimit('available-slots', 10, 60000)
```

por:

```ts
  const limit = await checkRateLimit('get-availability')
```

(`RATE_LIMITS['get-availability']` = 60/min ya existe en `src/lib/rate-limit.ts:44`.)

- [ ] **Step 2: Verificar que no quedan referencias al action viejo**

Run: `grep -rn "available-slots" src/ tests/`
Expected: sin resultados (si algún test lo referencia, actualizarlo al nuevo action name).

- [ ] **Step 3: Verificar suite**

Run: `npx vitest run tests/unit/rate-limit.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add src/server/actions/availability.ts
git -C <worktree> commit -m "Use get-availability rate limit config (60/min) for slot queries"
```

---

### Task 4: `step-time.tsx` — error ≠ "sin horas" + lead time visible

**Files:**
- Modify: `src/components/booking/step-time.tsx`
- Test: `tests/unit/step-time-states.test.tsx` (nuevo)

- [ ] **Step 1: Escribir el test que falla**

Create `tests/unit/step-time-states.test.tsx` (convención del repo: `createRoot` + `act`; el server action se mockea a nivel de módulo):

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StepTime } from '@/components/booking/step-time'
import type { BookingData } from '@/components/booking/wizard'

vi.mock('@/server/actions/availability', () => ({
  getAvailableTimeSlots: vi.fn(),
}))

import { getAvailableTimeSlots } from '@/server/actions/availability'

const data = {
  date: new Date('2026-07-09T16:00:00Z'),
  serviceId: 'svc-1',
  serviceName: 'Esmaltado',
} as unknown as BookingData

describe('StepTime states', () => {
  let root: Root | null = null
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
    vi.clearAllMocks()
  })

  async function render() {
    root = createRoot(container)
    await act(async () => {
      root?.render(<StepTime businessId="biz-1" data={data} onSelect={() => {}} onBack={() => {}} />)
    })
  }

  it('shows a retryable error state, not "No hay horarios", when the fetch fails', async () => {
    vi.mocked(getAvailableTimeSlots).mockRejectedValue(new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.'))
    await render()
    expect(container.textContent).toContain('No pudimos cargar los horarios')
    expect(container.textContent).toContain('Demasiadas solicitudes')
    expect(container.textContent).not.toContain('No hay horarios disponibles')
    const retry = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Reintentar'))
    expect(retry).toBeTruthy()
  })

  it('retry button re-fetches and can recover', async () => {
    vi.mocked(getAvailableTimeSlots)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([{ start: new Date('2026-07-09T13:00:00Z'), end: new Date('2026-07-09T14:30:00Z') }])
    await render()
    const retry = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Reintentar'))!
    await act(async () => {
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(vi.mocked(getAvailableTimeSlots)).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Elige una hora')
  })

  it('empty state explains the minimum lead time', async () => {
    vi.mocked(getAvailableTimeSlots).mockResolvedValue([])
    await render()
    expect(container.textContent).toContain('No hay horarios disponibles')
    expect(container.textContent).toContain('2 horas de anticipación')
  })

  it('slot grid shows the lead time hint', async () => {
    vi.mocked(getAvailableTimeSlots).mockResolvedValue([
      { start: new Date('2026-07-09T13:00:00Z'), end: new Date('2026-07-09T14:30:00Z') },
    ])
    await render()
    expect(container.textContent).toContain('Elige una hora')
    expect(container.textContent).toContain('2 horas de anticipación')
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/unit/step-time-states.test.tsx`
Expected: FAIL — hoy el catch cae en el layout "No hay horarios disponibles" y no existe "Reintentar" ni el hint.

- [ ] **Step 3: Implementar en `step-time.tsx`**

Cambios sobre el componente actual:

```tsx
import { LEAD_TIME_MINUTES } from '@/lib/availability/constants'

const LEAD_TIME_HINT = `Los horarios con menos de ${LEAD_TIME_MINUTES / 60} horas de anticipación no se muestran.`
```

Estado nuevo dentro del componente:

```tsx
  const [hasError, setHasError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
```

En el `useEffect`: agregar `retryKey` a las dependencias, resetear `setHasError(false)` junto a los otros resets, y en el `.catch` setear `setHasError(true)` además del mensaje. Después del bloque `if (loading)`, ANTES del bloque de slots vacíos:

```tsx
  if (hasError) {
    return (
      <div>
        <h2 className="mb-2 font-heading text-2xl font-semibold tracking-tight text-primary sm:text-3xl">No pudimos cargar los horarios</h2>
        <p className="mb-6 text-muted-foreground">
          {errorMessage || 'Ocurrió un error al cargar los horarios. Intenta de nuevo.'}
        </p>
        <div className="flex gap-3">
          <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
          <Button className="h-12 rounded-full px-6" onClick={() => setRetryKey((k) => k + 1)}>Reintentar</Button>
        </div>
      </div>
    )
  }
```

En el estado vacío, agregar tras el `<p>` existente:

```tsx
        <p className="mb-6 text-sm text-muted-foreground">{LEAD_TIME_HINT}</p>
```

Y bajo la grilla de slots (antes del div de botones):

```tsx
      <p className="mt-5 text-sm text-muted-foreground">{LEAD_TIME_HINT}</p>
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run tests/unit/step-time-states.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/components/booking/step-time.tsx tests/unit/step-time-states.test.tsx
git -C <worktree> commit -m "Distinguish load errors from empty availability and surface lead time"
```

---

### Task 5: Reglas de horario — impedir inicio ≥ fin

**Files:**
- Create: `src/lib/availability/time-range.ts`
- Modify: `src/server/actions/availability.ts:15-19` (schema)
- Modify: `src/components/dashboard/availability-editor.tsx`
- Test: `tests/unit/time-range.test.ts` (nuevo), `tests/unit/availability-editor.test.tsx` (ampliar)

Nota: el schema vive en un módulo `'use server'` — NO exportarlo (los exports no-función de módulos `'use server'` revientan en runtime; ya pasó dos veces). Por eso la lógica comparadora va en un helper aparte testeable.

- [ ] **Step 1: Tests que fallan**

Create `tests/unit/time-range.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isValidTimeRange, timeToMinutes } from '@/lib/availability/time-range'

describe('time-range', () => {
  it('converts HH:MM to minutes', () => {
    expect(timeToMinutes('09:00')).toBe(540)
    expect(timeToMinutes('14:30')).toBe(870)
  })

  it('accepts start < end and rejects start >= end', () => {
    expect(isValidTimeRange('09:00', '18:00')).toBe(true)
    expect(isValidTimeRange('18:00', '09:00')).toBe(false)
    expect(isValidTimeRange('09:00', '09:00')).toBe(false)
  })
})
```

Ampliar `tests/unit/availability-editor.test.tsx` (seguir el patrón de mock/render ya presente en ese archivo) con un caso: cambiar la hora de inicio a un valor ≥ fin muestra el mensaje `'La hora de inicio debe ser anterior a la de término'` y NO llama `updateAvailabilityRule`; corregir la hora de término a un valor válido limpia el error y sí persiste.

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run tests/unit/time-range.test.ts tests/unit/availability-editor.test.tsx`
Expected: FAIL (helper no existe; editor no valida).

- [ ] **Step 3: Implementar**

Create `src/lib/availability/time-range.ts`:

```ts
/** Convierte "HH:MM" a minutos desde medianoche. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Un rango horario es válido solo si el inicio es estrictamente anterior al fin. */
export function isValidTimeRange(startTime: string, endTime: string): boolean {
  return timeToMinutes(startTime) < timeToMinutes(endTime)
}
```

En `src/server/actions/availability.ts`, importar `isValidTimeRange` y encadenar al schema:

```ts
const updateAvailabilityRuleSchema = z.object({
  startTime: z.string().regex(timeRegex, 'Formato de hora inválido (HH:MM)'),
  endTime: z.string().regex(timeRegex, 'Formato de hora inválido (HH:MM)'),
  isActive: z.boolean(),
}).refine((d) => isValidTimeRange(d.startTime, d.endTime), {
  message: 'La hora de inicio debe ser anterior a la de término',
})
```

En `availability-editor.tsx`: estado `const [errors, setErrors] = useState<Record<string, string>>({})`. En `handleTimeChange`, calcular los tiempos candidatos; si `!isValidTimeRange(candidateStart, candidateEnd)` → actualizar el estado local del campo (para que la dueña pueda seguir editando el otro campo), setear `errors[id] = 'La hora de inicio debe ser anterior a la de término'` y NO llamar al server; si es válido → limpiar el error, persistir y actualizar estado. En `handleToggle`, si se activa una regla con rango inválido, mostrar el mismo error y no persistir. Render: bajo la fila de la regla, si `errors[rule.id]`:

```tsx
          {errors[rule.id] ? (
            <p className="text-sm text-destructive">{errors[rule.id]}</p>
          ) : null}
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run tests/unit/time-range.test.ts tests/unit/availability-editor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/lib/availability/time-range.ts src/server/actions/availability.ts src/components/dashboard/availability-editor.tsx tests/unit/time-range.test.ts tests/unit/availability-editor.test.tsx
git -C <worktree> commit -m "Reject inverted availability rule time ranges in editor and action"
```

---

### Task 6: Fix del exclude de vitest para worktrees

**Files:**
- Modify: `vitest.config.ts:15`

- [ ] **Step 1: Agregar el patrón**

En el array `exclude`, después de `'**/.worktrees/**'`:

```ts
      '**/.claude/**',
```

- [ ] **Step 2: Verificar desde el worktree que los tests se siguen encontrando**

Run (cwd = worktree): `npx vitest run tests/unit/timezone.test.ts`
Expected: PASS con tests ejecutados (si reporta "No test files found", el patrón está matcheando rutas absolutas — en ese caso usar `path.resolve`-relativo o el patrón `'.claude/**'` y re-verificar ambos escenarios).

- [ ] **Step 3: Verificar que excluye los duplicados (simulando desde el principal)**

Run: `cd /Users/robertozamorautrera/Projects/agendita && npx vitest run --config /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef/vitest.config.ts --root /Users/robertozamorautrera/Projects/agendita tests/unit/timezone.test.ts 2>&1 | grep -c "claude/worktrees"`
Expected: `0` apariciones de rutas de worktree.

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add vitest.config.ts
git -C <worktree> commit -m "Exclude .claude worktrees from vitest discovery"
```

---

### Task 7: Suite completa + PR

- [ ] **Step 1: Suite completa desde el worktree**

Run: `npx vitest run`
Expected: PASS. Si hay fallas, comparar contra el baseline del checkout principal (verde al inicio, 53/53 en disponibilidad) antes de tocar nada: solo son aceptables fallas que ya existían en main.

- [ ] **Step 2: Lint + tipos**

Run: `npx tsc --noEmit && npx eslint src/components/booking/step-time.tsx src/components/dashboard/availability-editor.tsx src/lib/availability src/server/actions/availability.ts`
Expected: sin errores.

- [ ] **Step 3: Push + PR**

```bash
git -C <worktree> push -u origin claude/keen-wright-cd2fef
gh pr create --title "Availability UI honesty + small fixes (PR 1/5)" --body "..."
```

Cuerpo del PR: resumen del diagnóstico (link al spec), lista de los 6 cambios, nota de que es el PR 1 de 5 del batch de disponibilidad. Cierre con la firma estándar de Claude Code.
