# PR 2 — Timezone del negocio en todo el flujo de reserva: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la clienta y la dueña siempre vean y reserven en el timezone del negocio, sin importar el timezone de su dispositivo.

**Architecture:** El wizard público recibe `business.timezone` como prop (ya viene en `BookingBusiness`, es el modelo completo) y lo baja a StepDate/StepTime/StepPayment/StepConfirmation. StepDate deja de mandar la medianoche del dispositivo: selecciona por string `yyyy-MM-dd` y emite el instante del mediodía local del negocio (`fromZonedTime`, inmune a bordes DST). Toda hora visible usa `formatInTimeZone`. El form del dashboard replica el patrón ya correcto de `reschedule-form.tsx`.

**Tech Stack:** date-fns-tz (`formatInTimeZone`, `fromZonedTime`), vitest + createRoot/act.

**Branch:** `claude/availability-pr2` (colgada del PR 1; al mergear #44, rebasear con `git rebase --onto origin/main claude/keen-wright-cd2fef claude/availability-pr2`).

**Truco de test:** la máquina de CI/dev suele estar en el mismo tz que el negocio, así que un test con `America/Santiago` no falla con el código viejo. Los tests usan un negocio en `Asia/Tokyo`: el código viejo (formato de dispositivo) renderiza hora de la máquina y el nuevo renderiza hora de Tokio — diferencia garantizada.

---

### Task 1: Helper de formato + wizard propaga `timezone`

**Files:**
- Create: `src/lib/booking/format-booking-datetime.ts`
- Modify: `src/components/booking/booking-business-page.tsx:30-35`, `src/components/booking/wizard.tsx` (prop nueva), `src/components/booking/step-time.tsx`, `src/components/booking/step-payment.tsx:366,424,491`, `src/components/booking/step-confirmation.tsx:43`
- Test: `tests/unit/format-booking-datetime.test.ts`, `tests/unit/step-time-states.test.tsx` (ampliar)

- [ ] **Step 1: Test del helper (falla por módulo inexistente)**

Create `tests/unit/format-booking-datetime.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatBookingDate, formatBookingTime, formatBookingDateTime } from '@/lib/booking/format-booking-datetime'

describe('format-booking-datetime', () => {
  // 2026-07-09T13:00Z = 09:00 en Santiago (UTC-4), 22:00 en Tokio
  const instant = new Date('2026-07-09T13:00:00Z')

  it('formats in the business timezone, not the device timezone', () => {
    expect(formatBookingTime(instant, 'America/Santiago')).toBe('09:00')
    expect(formatBookingTime(instant, 'Asia/Tokyo')).toBe('22:00')
  })

  it('formats dates crossing midnight in the business timezone', () => {
    // 2026-07-10T01:00Z = 9 de julio 21:00 en Santiago, 10 de julio 10:00 en Tokio
    const lateInstant = new Date('2026-07-10T01:00:00Z')
    expect(formatBookingDate(lateInstant, 'America/Santiago')).toBe('09-07-2026')
    expect(formatBookingDate(lateInstant, 'Asia/Tokyo')).toBe('10-07-2026')
  })

  it('combines date and time', () => {
    expect(formatBookingDateTime(instant, 'America/Santiago')).toBe('09-07-2026 09:00')
  })
})
```

- [ ] **Step 2: Verificar que falla** — `npx vitest run tests/unit/format-booking-datetime.test.ts` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar el helper**

Create `src/lib/booking/format-booking-datetime.ts`:

```ts
import { formatInTimeZone } from 'date-fns-tz'

/** Fecha local del negocio en formato chileno dd-MM-yyyy. */
export function formatBookingDate(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'dd-MM-yyyy')
}

/** Hora local del negocio HH:mm. */
export function formatBookingTime(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'HH:mm')
}

/** Fecha y hora locales del negocio. */
export function formatBookingDateTime(date: Date, timezone: string): string {
  return `${formatBookingDate(date, timezone)} ${formatBookingTime(date, timezone)}`
}
```

- [ ] **Step 4: Propagar la prop**

En `booking-business-page.tsx` agregar `timezone={business.timezone || 'America/Santiago'}` al `<BookingWizard>`. En `wizard.tsx`: agregar `timezone: string` a `BookingWizardProps`, y pasarla a `<StepDate>`, `<StepTime>`, `<StepPayment>` y `<StepConfirmation>` (interfaces de cada step ganan `timezone: string`).

Reemplazos de formato (usando el helper):
- `step-time.tsx:100`: `{data.serviceName} · {data.date ? formatBookingDate(data.date, timezone) : ''}` y `:120` (hora del slot): `{formatBookingTime(slot.start, timezone)}` (elimina el `format` de date-fns si queda sin uso).
- `step-payment.tsx:366,424,491` y `step-confirmation.tsx:43`: `{data.date ? formatBookingDate(data.date, timezone) : ''} {data.timeSlot ? formatBookingTime(data.timeSlot.start, timezone) : ''}`.

- [ ] **Step 5: Test de render con negocio en Tokio (falla con el código viejo, pasa con el nuevo)**

En `tests/unit/step-time-states.test.tsx`: pasar `timezone="Asia/Tokyo"` al `<StepTime>` del helper `render()` y agregar:

```tsx
  it('renders slot times in the business timezone', async () => {
    vi.mocked(getAvailableTimeSlots).mockResolvedValue([
      { start: new Date('2026-07-09T13:00:00Z'), end: new Date('2026-07-09T14:30:00Z') },
    ])
    await render()
    expect(container.textContent).toContain('22:00') // Tokio, no la hora de la máquina
  })
```

- [ ] **Step 6: Verificar** — `npx vitest run tests/unit/format-booking-datetime.test.ts tests/unit/step-time-states.test.tsx` → PASS. `npx tsc --noEmit` sin errores nuevos (baseline 17).

- [ ] **Step 7: Commit**

```bash
git -C <worktree> add src/lib/booking/format-booking-datetime.ts src/components/booking/ tests/unit/format-booking-datetime.test.ts tests/unit/step-time-states.test.tsx
git -C <worktree> commit -m "Format booking dates and times in the business timezone"
```

---

### Task 2: StepDate selecciona el día en el calendario del negocio

**Files:**
- Modify: `src/components/booking/step-date.tsx`
- Test: `tests/unit/step-date-timezone.test.tsx` (nuevo)

- [ ] **Step 1: Test que falla**

Create `tests/unit/step-date-timezone.test.tsx` (patrón createRoot/act; sin mocks de red — StepDate es puro):

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { formatInTimeZone } from 'date-fns-tz'
import { StepDate } from '@/components/booking/step-date'
import type { BookingData } from '@/components/booking/wizard'

const data = { date: null, serviceName: 'Esmaltado', serviceDuration: 90 } as unknown as BookingData

describe('StepDate timezone', () => {
  let root: Root | null = null

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
  })

  it('emits the business-local noon instant for the clicked day', async () => {
    const onSelect = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(<StepDate data={data} timezone="Asia/Tokyo" onSelect={onSelect} onBack={() => {}} />)
    })

    // Click en un día futuro habilitado (el último habilitado del mes visible)
    const dayButtons = Array.from(container.querySelectorAll('button[data-day]')).filter(b => !(b as HTMLButtonElement).disabled)
    const target = dayButtons[dayButtons.length - 1] as HTMLButtonElement
    const dayStr = target.getAttribute('data-day')!
    act(() => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const continueBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Continuar'))!
    act(() => {
      continueBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelect).toHaveBeenCalledTimes(1)
    const emitted: Date = onSelect.mock.calls[0][0]
    // El instante emitido debe ser exactamente el mediodía de ese día EN TOKIO
    expect(formatInTimeZone(emitted, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm')).toBe(`${dayStr} 12:00`)
  })
})
```

- [ ] **Step 2: Verificar que falla** — `npx vitest run tests/unit/step-date-timezone.test.tsx` → FAIL (no existe `data-day`; el instante emitido es medianoche del dispositivo).

- [ ] **Step 3: Implementar en `step-date.tsx`**

Cambios:
- Props: `{ data, timezone, onSelect, onBack }` con `timezone: string`.
- Estado de selección por string: `const [selectedDay, setSelectedDay] = useState<string | null>(data.date ? formatInTimeZone(data.date, timezone, 'yyyy-MM-dd') : null)`.
- "Hoy" del negocio: `const businessToday = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')`.
- En el map de días: `const dayStr = format(day, 'yyyy-MM-dd')`; `const isPast = dayStr < businessToday` (comparación lexicográfica de yyyy-MM-dd es correcta); `const isSelected = selectedDay === dayStr`; botón con `data-day={dayStr}` y `onClick={() => setSelectedDay(dayStr)}`.
- Continuar: `onClick={() => selectedDay && onSelect(fromZonedTime(`${selectedDay} 12:00`, timezone))}` — mediodía local del negocio, inmune al bug DST de medianoche (backlog #1 del spec).
- Imports: quitar `isSameDay`, `isBefore`, `startOfDay` si quedan sin uso; agregar `formatInTimeZone, fromZonedTime` de `date-fns-tz`.

El grid del mes sigue construyéndose con date-fns local (un mes calendario es el mismo set de fechas en cualquier tz; solo importan las etiquetas `yyyy-MM-dd`).

- [ ] **Step 4: Verificar** — `npx vitest run tests/unit/step-date-timezone.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/components/booking/step-date.tsx tests/unit/step-date-timezone.test.tsx
git -C <worktree> commit -m "Select booking dates on the business calendar, not the device's"
```

---

### Task 3: Form del dashboard construye el instante en el tz del negocio

**Files:**
- Modify: `src/app/dashboard/bookings/new/new-booking-form.tsx:238,278` (+ props), `src/app/dashboard/bookings/new/page.tsx:27`
- Test: `tests/unit/new-booking-timezone.test.ts` (nuevo, si el form no tiene test; si el patrón de test del form existente lo permite, ampliar ese)

- [ ] **Step 1: Implementar (espejo de `reschedule-form.tsx`)**

- `page.tsx`: `<NewBookingForm services={services} businessId={userData.business.id} timezone={userData.business.timezone || 'America/Santiago'} />`.
- `new-booking-form.tsx`: prop `timezone: string`; línea 238: `const startDateTime = fromZonedTime(`${date} ${time}`, timezone)` (import de `date-fns-tz`); línea 278: `const today = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')`.

- [ ] **Step 2: Test**

Si existe test del form, ampliar con el caso Tokio (mismo truco); si el form no tiene test unitario, testear al menos el submit path si es extraíble; si no es razonable sin reestructurar, documentarlo en el PR y cubrir con `tsc` + verificación manual del flujo (crear reserva desde dashboard en dev).

- [ ] **Step 3: Verificar** — `npx tsc --noEmit` (sin errores nuevos) + suite completa `npx vitest run` → PASS.

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add src/app/dashboard/bookings/new/
git -C <worktree> commit -m "Build dashboard booking instants in the business timezone"
```

---

### Task 4: Suite completa + PR

- [ ] **Step 1:** `npx vitest run` → PASS; `npx eslint` sobre los archivos tocados → sin errores.
- [ ] **Step 2:** Si #44 ya mergeó: `git fetch origin && git rebase --onto origin/main claude/keen-wright-cd2fef claude/availability-pr2`, re-correr suite.
- [ ] **Step 3:** Push + `gh pr create` — título "Business timezone across the booking flow (PR 2/5)", body con el bug (clienta en otro huso ve/reserva horas corridas), los 3 cambios y los tests. Firma estándar.
