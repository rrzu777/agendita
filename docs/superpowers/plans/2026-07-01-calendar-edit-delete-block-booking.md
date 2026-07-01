# Editar o eliminar bloqueo o reserva desde el calendario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poder editar o eliminar un bloqueo, y ver/cancelar/reprogramar una reserva, directamente desde `/dashboard/calendar` (día/semana/mes), sin navegar a otra pantalla.

**Architecture:** Un nuevo diálogo controlado (`EditBlockDialog`) reutiliza campos de formulario compartidos (`BlockFormFields`) y una nueva acción de servidor (`updateTimeBlock`); la conversión de zona horaria para precargar el formulario vive en un helper puro y testeado por separado (`deriveBlockFormValues`). La vista de mes gana interactividad por reserva usando el patrón "stretched link" (link de fondo + contenido encima con capas de `pointer-events`), sin sacrificar la navegación por teclado que ya tiene hoy.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind, Radix Dialog (`@/components/ui/dialog`), Prisma, Vitest (jsdom).

**Spec:** `docs/superpowers/specs/2026-06-30-calendar-edit-delete-block-booking-design.md`

**Nota sobre cobertura de tests:** este proyecto no tiene `@testing-library/react`; los tests de componentes React usan `renderToStaticMarkup` (SSR) sobre el árbol ya montado — ver `tests/unit/calendar-views-fill.test.tsx`. Los diálogos de Radix (`Dialog`/`DialogContent`) renderizan su contenido dentro de un **Portal**, que `renderToStaticMarkup` no puede representar (no hay DOM real). Por eso: la lógica pura (Task 1, Task 2) tiene TDD completo y real; los componentes sin Portal (`BlockFormFields`, `BlockBand`, `MonthView`) tienen tests SSR reales sobre su marcado; `EditBlockDialog` solo puede verificarse con un test de "no lanza al renderizar" — su corrección de contenido depende de piezas ya testeadas por separado (`deriveBlockFormValues` + `BlockFormFields`). La verificación interactiva real (clic abre el diálogo, el flujo de confirmar/eliminar funciona) queda para revisión manual del usuario, como ya se acordó para el resto de esta feature de calendario.

---

## File Structure

- **Modify** `src/server/actions/time-blocks.ts` — nueva función `updateTimeBlock` (única exportación nueva).
- **Create** `src/lib/calendar/block-form-values.ts` — helper puro `deriveBlockFormValues` (conversión de zona horaria).
- **Create** `src/components/dashboard/block-form-fields.tsx` — componente presentacional compartido (4 campos: fecha, hora inicio, hora fin, motivo).
- **Modify** `src/components/dashboard/block-time-modal.tsx` — usa `BlockFormFields` en vez de los campos inline. Sin cambios de API pública.
- **Create** `src/components/dashboard/edit-block-dialog.tsx` — `EditBlockDialog`: diálogo de edición/eliminación de un bloqueo, siempre controlado por el padre.
- **Modify** `src/components/dashboard/calendar-views.tsx` — `BlockBand` pasa a botón; `CalendarViews` gana estado `activeBlock` y monta `EditBlockDialog`; `MonthView` gana `onBookingClick` y el patrón "stretched link".
- **Modify** `tests/unit/time-blocks.test.ts` — tests de `updateTimeBlock` (agrega métodos al mock de Prisma ya existente).
- **Create** `tests/unit/block-form-values.test.ts`.
- **Create** `tests/unit/block-form-fields.test.tsx`.
- **Create** `tests/unit/edit-block-dialog.test.tsx`.
- **Create** `tests/unit/block-time-modal.test.tsx` (no existe hoy).
- **Modify** `tests/unit/calendar-views-fill.test.tsx` — agrega mock de `edit-block-dialog`, y tests para `BlockBand` y para la reserva clicable en mes.

**Comandos de test:**
- Un archivo: `npx vitest --run tests/unit/<archivo>`
- Todo: `npm run test:unit`

---

### Task 1: Acción de servidor `updateTimeBlock`

**Files:**
- Modify: `src/server/actions/time-blocks.ts`
- Modify: `tests/unit/time-blocks.test.ts`

- [ ] **Step 1: Ampliar el mock de Prisma en el test existente**

En `tests/unit/time-blocks.test.ts`, reemplaza el objeto `mockPrisma` (líneas 3–12) por:

```ts
const mockPrisma = {
  timeBlock: {
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  booking: {
    findMany: vi.fn(),
  },
}
```

- [ ] **Step 2: Escribir los tests que fallan, al final del archivo**

Añade al final de `tests/unit/time-blocks.test.ts`:

```ts
describe('updateTimeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.timeBlock.findFirst.mockResolvedValue({
      id: 'block-1',
      businessId: 'biz-1',
      startDateTime: baseInput.startDateTime,
      endDateTime: baseInput.endDateTime,
      reason: baseInput.reason,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    mockPrisma.timeBlock.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.booking.findMany.mockResolvedValue([])
  })

  it('updates a time block when no overlap and the time window changed', async () => {
    const result = await updateTimeBlock('block-1', {
      startDateTime: new Date('2026-06-01T11:00:00Z'),
      endDateTime: new Date('2026-06-01T12:00:00Z'),
      reason: 'Updated reason',
      confirmOverlap: false,
    })

    expect('id' in result && result.id).toBe('block-1')
    expect(mockPrisma.timeBlock.updateMany).toHaveBeenCalledWith({
      where: { id: 'block-1', businessId: 'biz-1' },
      data: {
        startDateTime: new Date('2026-06-01T11:00:00Z'),
        endDateTime: new Date('2026-06-01T12:00:00Z'),
        reason: 'Updated reason',
      },
    })
  })

  it('checks overlap when the time window changed', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await updateTimeBlock('block-1', {
      startDateTime: new Date('2026-06-01T11:00:00Z'),
      endDateTime: new Date('2026-06-01T12:00:00Z'),
      reason: 'Updated reason',
      confirmOverlap: false,
    })

    expect(result).toEqual({
      requiresConfirmation: true,
      message: expect.stringMatching(/solapa con reservas/),
    })
    expect(mockPrisma.timeBlock.updateMany).not.toHaveBeenCalled()
  })

  it('does not re-check overlap when only the reason changed (same time window)', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await updateTimeBlock('block-1', {
      startDateTime: baseInput.startDateTime,
      endDateTime: baseInput.endDateTime,
      reason: 'Solo cambia el motivo',
      confirmOverlap: false,
    })

    expect(mockPrisma.booking.findMany).not.toHaveBeenCalled()
    expect('id' in result && result.id).toBe('block-1')
    expect(mockPrisma.timeBlock.updateMany).toHaveBeenCalledTimes(1)
  })

  it('updates when overlapping bookings exist and confirmOverlap is true', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }])

    const result = await updateTimeBlock('block-1', {
      startDateTime: new Date('2026-06-01T11:00:00Z'),
      endDateTime: new Date('2026-06-01T12:00:00Z'),
      reason: baseInput.reason,
      confirmOverlap: true,
    })

    expect('id' in result && result.id).toBe('block-1')
    expect(mockPrisma.timeBlock.updateMany).toHaveBeenCalledTimes(1)
  })

  it('rejects when end is before start', async () => {
    await expect(
      updateTimeBlock('block-1', {
        startDateTime: new Date('2026-06-01T10:00:00Z'),
        endDateTime: new Date('2026-06-01T09:00:00Z'),
        reason: null,
        confirmOverlap: false,
      }),
    ).rejects.toThrow(/fecha de fin debe ser posterior/)
  })

  it('rejects when duration exceeds 32 days', async () => {
    await expect(
      updateTimeBlock('block-1', {
        startDateTime: new Date('2026-06-01T00:00:00Z'),
        endDateTime: new Date('2026-07-05T00:00:00Z'),
        reason: null,
        confirmOverlap: false,
      }),
    ).rejects.toThrow(/duración máxima/)
  })

  it('throws ForbiddenError when the block does not exist for this business', async () => {
    mockPrisma.timeBlock.findFirst.mockResolvedValue(null)

    await expect(
      updateTimeBlock('nonexistent', {
        startDateTime: baseInput.startDateTime,
        endDateTime: baseInput.endDateTime,
        reason: null,
        confirmOverlap: false,
      }),
    ).rejects.toThrow('Bloque no encontrado')
  })

  it('scopes the existence check to businessId', async () => {
    await updateTimeBlock('block-1', {
      startDateTime: new Date('2026-06-01T11:00:00Z'),
      endDateTime: new Date('2026-06-01T12:00:00Z'),
      reason: baseInput.reason,
      confirmOverlap: false,
    })

    expect(mockPrisma.timeBlock.findFirst).toHaveBeenCalledWith({
      where: { id: 'block-1', businessId: 'biz-1' },
    })
  })
})
```

También cambia la línea de import dinámico (línea 44):
```ts
const { createTimeBlock, deleteTimeBlock } = await import('@/server/actions/time-blocks')
```
por:
```ts
const { createTimeBlock, deleteTimeBlock, updateTimeBlock } = await import('@/server/actions/time-blocks')
```

- [ ] **Step 3: Ejecutar y confirmar que falla**

Run: `npx vitest --run tests/unit/time-blocks.test.ts`
Expected: FAIL — `updateTimeBlock` no existe todavía.

- [ ] **Step 4: Implementar `updateTimeBlock`**

En `src/server/actions/time-blocks.ts`, añade al final del archivo (después de `deleteTimeBlock`):

```ts
export async function updateTimeBlock(
  id: string,
  data: Omit<TimeBlock, 'id' | 'createdAt' | 'businessId'> & { confirmOverlap?: boolean },
) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-timeblock', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const raw = data as unknown as Record<string, unknown>
  const { startDateTime, endDateTime, reason, confirmOverlap } = parseTimeBlockInput(raw)

  const parsed = createTimeBlockSchema.safeParse({ startDateTime, endDateTime, reason, confirmOverlap })
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const durationMs = differenceInMilliseconds(endDateTime, startDateTime)
  if (durationMs > MAX_BLOCK_DURATION_MS) {
    throw new Error('La duración máxima de un bloqueo es de 32 días')
  }

  const existing = await prisma.timeBlock.findFirst({
    where: { id, businessId },
  })
  if (!existing) {
    throw new ForbiddenError('Bloque no encontrado')
  }

  const timeChanged =
    existing.startDateTime.getTime() !== startDateTime.getTime() ||
    existing.endDateTime.getTime() !== endDateTime.getTime()

  if (timeChanged) {
    const overlappingBookings = await prisma.booking.findMany({
      where: {
        businessId,
        status: { in: ['pending_payment', 'confirmed', 'completed'] },
        startDateTime: { lt: endDateTime },
        endDateTime: { gt: startDateTime },
      },
      select: { id: true },
      take: 1,
    })

    if (overlappingBookings.length > 0 && confirmOverlap !== true) {
      return {
        requiresConfirmation: true as const,
        message:
          'El bloqueo se solapa con reservas existentes. ' +
          'Marca la casilla de confirmación si deseas guardarlo de todas formas ' +
          '(no se cancelarán las reservas existentes).',
      }
    }
  }

  await prisma.timeBlock.updateMany({
    where: { id, businessId },
    data: { startDateTime, endDateTime, reason },
  })

  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)

  return { ...existing, startDateTime, endDateTime, reason }
}
```

**Importante:** la última línea de revalidación debe ser `await revalidateBusinessPublicPaths(businessId)` — omitir el `await` ya ha colgado el proceso (exit 128) en este proyecto. No agregues ninguna otra exportación a este archivo (es un módulo `'use server'`; exportar algo que no sea una función `async` rompe en runtime).

- [ ] **Step 5: Ejecutar y confirmar que pasa**

Run: `npx vitest --run tests/unit/time-blocks.test.ts`
Expected: PASS (todos los tests, incluidos los preexistentes de `createTimeBlock`/`deleteTimeBlock`).

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/time-blocks.ts tests/unit/time-blocks.test.ts
git commit -m "feat(calendar): acción de servidor updateTimeBlock

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Helper puro `deriveBlockFormValues` (conversión de zona horaria)

**Files:**
- Create: `src/lib/calendar/block-form-values.ts`
- Test: `tests/unit/block-form-values.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/block-form-values.test.ts
import { describe, it, expect } from 'vitest'
import { deriveBlockFormValues } from '@/lib/calendar/block-form-values'

describe('deriveBlockFormValues', () => {
  it('convierte un bloqueo UTC a fecha/hora local del negocio', () => {
    const block = {
      startDateTime: '2026-06-01T17:00:00.000Z', // 13:00 en America/Santiago (UTC-4)
      endDateTime: '2026-06-01T18:00:00.000Z', // 14:00 en America/Santiago
      reason: 'Almuerzo',
    }
    const result = deriveBlockFormValues(block, 'America/Santiago')
    expect(result).toEqual({
      date: '2026-06-01',
      startTime: '13:00',
      endTime: '14:00',
      reason: 'Almuerzo',
    })
  })

  it('usa string vacío cuando no hay motivo', () => {
    const block = {
      startDateTime: '2026-06-01T17:00:00.000Z',
      endDateTime: '2026-06-01T18:00:00.000Z',
      reason: null,
    }
    const result = deriveBlockFormValues(block, 'America/Santiago')
    expect(result.reason).toBe('')
  })

  it('la fecha se calcula en hora local, no en la fecha UTC', () => {
    const block = {
      startDateTime: '2026-06-02T02:00:00.000Z', // 2026-06-01 22:00 en America/Santiago
      endDateTime: '2026-06-02T03:00:00.000Z', // 2026-06-01 23:00 en America/Santiago
      reason: 'Emergencia',
    }
    const result = deriveBlockFormValues(block, 'America/Santiago')
    expect(result.date).toBe('2026-06-01')
    expect(result.startTime).toBe('22:00')
    expect(result.endTime).toBe('23:00')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run tests/unit/block-form-values.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/calendar/block-form-values.ts
import { formatInTimeZone } from 'date-fns-tz'

export interface BlockFormValues {
  date: string
  startTime: string
  endTime: string
  reason: string
}

export function deriveBlockFormValues(
  block: { startDateTime: string; endDateTime: string; reason?: string | null },
  timezone: string,
): BlockFormValues {
  return {
    date: formatInTimeZone(new Date(block.startDateTime), timezone, 'yyyy-MM-dd'),
    startTime: formatInTimeZone(new Date(block.startDateTime), timezone, 'HH:mm'),
    endTime: formatInTimeZone(new Date(block.endDateTime), timezone, 'HH:mm'),
    reason: block.reason || '',
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run tests/unit/block-form-values.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/block-form-values.ts tests/unit/block-form-values.test.ts
git commit -m "feat(calendar): helper para precargar el formulario de bloqueo en hora local

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Extraer `BlockFormFields` y refactorizar `BlockTimeModal`

**Files:**
- Create: `src/components/dashboard/block-form-fields.tsx`
- Modify: `src/components/dashboard/block-time-modal.tsx`
- Test: `tests/unit/block-form-fields.test.tsx`
- Test: `tests/unit/block-time-modal.test.tsx`

- [ ] **Step 1: Write the failing test for `BlockFormFields`**

```tsx
// tests/unit/block-form-fields.test.tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BlockFormFields } from '@/components/dashboard/block-form-fields'

describe('BlockFormFields', () => {
  it('renderiza los 4 campos con los valores dados', () => {
    const html = renderToStaticMarkup(
      <BlockFormFields
        date="2026-06-01"
        onDateChange={() => {}}
        startTime="13:00"
        onStartTimeChange={() => {}}
        endTime="14:00"
        onEndTimeChange={() => {}}
        reason="Almuerzo"
        onReasonChange={() => {}}
      />,
    )
    expect(html).toContain('value="2026-06-01"')
    expect(html).toContain('value="13:00"')
    expect(html).toContain('value="14:00"')
    expect(html).toContain('value="Almuerzo"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run tests/unit/block-form-fields.test.tsx`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Write `BlockFormFields`**

```tsx
// src/components/dashboard/block-form-fields.tsx
'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface BlockFormFieldsProps {
  date: string
  onDateChange: (value: string) => void
  startTime: string
  onStartTimeChange: (value: string) => void
  endTime: string
  onEndTimeChange: (value: string) => void
  reason: string
  onReasonChange: (value: string) => void
}

export function BlockFormFields({
  date,
  onDateChange,
  startTime,
  onStartTimeChange,
  endTime,
  onEndTimeChange,
  reason,
  onReasonChange,
}: BlockFormFieldsProps) {
  return (
    <>
      <div>
        <Label htmlFor="block-date">Fecha</Label>
        <Input
          id="block-date"
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="start-time">Hora inicio</Label>
          <Input
            id="start-time"
            type="time"
            value={startTime}
            onChange={(e) => onStartTimeChange(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="end-time">Hora fin</Label>
          <Input
            id="end-time"
            type="time"
            value={endTime}
            onChange={(e) => onEndTimeChange(e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="block-reason">Motivo (opcional)</Label>
        <Input
          id="block-reason"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Ej: Almuerzo, reunión..."
          maxLength={255}
        />
      </div>
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run tests/unit/block-form-fields.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write a characterization test for `BlockTimeModal` (antes de refactorizar)**

```tsx
// tests/unit/block-time-modal.test.tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BlockTimeModal } from '@/components/dashboard/block-time-modal'

describe('BlockTimeModal', () => {
  it('renderiza el botón para crear un bloqueo', () => {
    const html = renderToStaticMarkup(
      <BlockTimeModal defaultDate="2026-06-01" timezone="America/Santiago" />,
    )
    expect(html).toContain('Bloquear horario')
  })
})
```

Nota: el contenido del `Dialog` (campos, botones internos) no aparece en `renderToStaticMarkup` porque Radix lo renderiza en un Portal — este test solo puede verificar el botón trigger, que está fuera del `Dialog`.

- [ ] **Step 6: Run test to verify it passes against the current code**

Run: `npx vitest --run tests/unit/block-time-modal.test.tsx`
Expected: PASS (es una prueba de caracterización sobre el código actual, antes de refactorizar).

- [ ] **Step 7: Refactorizar `BlockTimeModal` para usar `BlockFormFields`**

En `src/components/dashboard/block-time-modal.tsx`:

Agrega el import:
```tsx
import { BlockFormFields } from './block-form-fields'
```

Reemplaza los tres bloques de campos (el `<div>` de fecha, el `<div className="grid grid-cols-2 gap-3">` de horas, y el `<div>` de motivo — el contenido entre el `<Select>` de presets y el bloque de "Si el horario se solapa...") por:

```tsx
<BlockFormFields
  date={date}
  onDateChange={setDate}
  startTime={startTime}
  onStartTimeChange={setStartTime}
  endTime={endTime}
  onEndTimeChange={setEndTime}
  reason={reason}
  onReasonChange={setReason}
/>
```

El resto del componente (selector de presets, checkbox de solape, botones del footer, `DeleteBlockButton`) no cambia.

- [ ] **Step 8: Run both tests to verify they still pass**

Run: `npx vitest --run tests/unit/block-form-fields.test.tsx tests/unit/block-time-modal.test.tsx`
Expected: PASS (2 archivos).

- [ ] **Step 9: Commit**

```bash
git add src/components/dashboard/block-form-fields.tsx src/components/dashboard/block-time-modal.tsx tests/unit/block-form-fields.test.tsx tests/unit/block-time-modal.test.tsx
git commit -m "refactor(calendar): extraer BlockFormFields de BlockTimeModal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `EditBlockDialog`

**Files:**
- Create: `src/components/dashboard/edit-block-dialog.tsx`
- Test: `tests/unit/edit-block-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/edit-block-dialog.test.tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EditBlockDialog } from '@/components/dashboard/edit-block-dialog'

const block = {
  id: 'block-1',
  startDateTime: '2026-06-01T17:00:00.000Z',
  endDateTime: '2026-06-01T18:00:00.000Z',
  reason: 'Almuerzo',
}

describe('EditBlockDialog', () => {
  it('renderiza sin lanzar errores', () => {
    expect(() =>
      renderToStaticMarkup(
        <EditBlockDialog block={block} timezone="America/Santiago" open={false} onOpenChange={() => {}} />,
      ),
    ).not.toThrow()
  })
})
```

Nota: como con `BlockTimeModal`, el contenido real del diálogo vive dentro de un Portal de Radix y no es verificable vía `renderToStaticMarkup`. La corrección de los valores precargados ya está cubierta por `deriveBlockFormValues` (Task 2) y el marcado de los campos por `BlockFormFields` (Task 3); este test solo confirma que el componente se ensambla sin errores de tipos/import/render.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run tests/unit/edit-block-dialog.test.tsx`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Write `EditBlockDialog`**

```tsx
// src/components/dashboard/edit-block-dialog.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { updateTimeBlock, deleteTimeBlock } from '@/server/actions/time-blocks'
import { fromZonedTime } from 'date-fns-tz'
import { deriveBlockFormValues } from '@/lib/calendar/block-form-values'
import { BlockFormFields } from './block-form-fields'
import type { CalendarTimeBlock } from './time-block-card'

interface EditBlockDialogProps {
  block: CalendarTimeBlock
  timezone: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function parseTimeUTC(dateStr: string, timeStr: string, timezone: string): Date {
  return fromZonedTime(`${dateStr} ${timeStr}`, timezone)
}

export function EditBlockDialog({ block, timezone, open, onOpenChange }: EditBlockDialogProps) {
  const initial = deriveBlockFormValues(block, timezone)
  const [date, setDate] = useState(initial.date)
  const [startTime, setStartTime] = useState(initial.startTime)
  const [endTime, setEndTime] = useState(initial.endTime)
  const [reason, setReason] = useState(initial.reason)
  const [confirmOverlap, setConfirmOverlap] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      setConfirmOverlap(false)
      setConfirmingDelete(false)
      setError(null)
    }
    onOpenChange(newOpen)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!date) {
      setError('Selecciona una fecha')
      return
    }
    if (!startTime || !endTime) {
      setError('Define hora de inicio y fin')
      return
    }

    startTransition(async () => {
      try {
        const start = parseTimeUTC(date, startTime, timezone)
        const end = parseTimeUTC(date, endTime, timezone)

        const result = await updateTimeBlock(block.id, {
          startDateTime: start,
          endDateTime: end,
          reason: reason || null,
          confirmOverlap,
        })
        if (result && 'requiresConfirmation' in result) {
          setError(result.message)
          return
        }
        router.refresh()
        handleOpenChange(false)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error al guardar el bloqueo')
      }
    })
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteTimeBlock(block.id)
        router.refresh()
        handleOpenChange(false)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error al eliminar el bloqueo')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {confirmingDelete ? (
          <>
            <DialogHeader>
              <DialogTitle>Eliminar bloqueo</DialogTitle>
              <DialogDescription>
                ¿Eliminar este bloqueo? Esta acción no se puede deshacer.
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={isPending}>
                {isPending ? 'Eliminando...' : 'Eliminar definitivamente'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Editar bloqueo</DialogTitle>
              <DialogDescription>Modifica el horario o el motivo de este bloqueo.</DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <BlockFormFields
                date={date}
                onDateChange={setDate}
                startTime={startTime}
                onStartTimeChange={setStartTime}
                endTime={endTime}
                onEndTimeChange={setEndTime}
                reason={reason}
                onReasonChange={setReason}
              />

              <div className="rounded-xl border border-muted-foreground/30 bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">
                  Si el nuevo horario se solapa con reservas existentes, el sistema requerirá
                  confirmación adicional. Las reservas no se cancelarán automáticamente.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="confirm-overlap-edit"
                    checked={confirmOverlap}
                    onChange={(e) => setConfirmOverlap(e.target.checked)}
                    className="size-3.5 rounded border-muted-foreground/50 accent-primary"
                  />
                  <label htmlFor="confirm-overlap-edit" className="text-xs text-muted-foreground">
                    Confirmar bloqueo aunque haya reservas en el horario
                  </label>
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <DialogFooter className="sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive/80"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={isPending}
                >
                  Eliminar
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? 'Guardando...' : 'Guardar cambios'}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run tests/unit/edit-block-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/edit-block-dialog.tsx tests/unit/edit-block-dialog.test.tsx
git commit -m "feat(calendar): diálogo de edición/eliminación de bloqueo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `BlockBand` clicable + wiring en `CalendarViews`

**Files:**
- Modify: `src/components/dashboard/calendar-views.tsx`
- Modify: `tests/unit/calendar-views-fill.test.tsx`

- [ ] **Step 1: Agregar el mock de `edit-block-dialog` al test existente**

Al inicio de `tests/unit/calendar-views-fill.test.tsx`, junto a los mocks ya existentes de `block-time-modal` y `booking-drawer`, agrega:

```tsx
vi.mock('@/components/dashboard/edit-block-dialog', () => ({
  EditBlockDialog: () => null,
}))
```

- [ ] **Step 2: Write the failing test**

Añade al final de `tests/unit/calendar-views-fill.test.tsx`:

```tsx
const timeBlock = {
  id: 'block-1',
  startDateTime: '2026-06-30T17:00:00.000Z',
  endDateTime: '2026-06-30T18:00:00.000Z',
  reason: 'Almuerzo',
}

describe('CalendarViews — bloqueo interactivo (día)', () => {
  it('el bloqueo se renderiza como botón con aria-label descriptivo', () => {
    const html = renderToStaticMarkup(
      // @ts-expect-error props mínimos de prueba
      <CalendarViews {...baseProps} view="day" date="2026-06-30" bookings={[]} timeBlocks={[timeBlock]} />,
    )
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="Bloqueo: Almuerzo"')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest --run tests/unit/calendar-views-fill.test.tsx`
Expected: FAIL — `BlockBand` hoy es un `<div>` sin `aria-label`.

- [ ] **Step 4: Actualizar imports en `calendar-views.tsx`**

Agrega junto a los demás imports de componentes:

```tsx
import { EditBlockDialog } from './edit-block-dialog'
```

- [ ] **Step 5: `CalendarViews` gana estado `activeBlock` y monta `EditBlockDialog`**

En la función `CalendarViews` (dentro de `src/components/dashboard/calendar-views.tsx`), junto al `useState` de `activeBooking`, agrega:

```tsx
const [activeBlock, setActiveBlock] = useState<CalendarTimeBlock | null>(null)
```

En las dos instancias de `<TimelineView ... />` (vista `week` y vista `day`), agrega la prop:

```tsx
onBlockClick={setActiveBlock}
```

Después del bloque `{activeBooking && <BookingDrawer ... />}`, agrega:

```tsx
{activeBlock && (
  <EditBlockDialog
    block={activeBlock}
    timezone={timezone}
    open={!!activeBlock}
    onOpenChange={(o) => !o && setActiveBlock(null)}
  />
)}
```

- [ ] **Step 6: `TimelineView` recibe y propaga `onBlockClick`**

En la firma de `TimelineView`, agrega el parámetro `onBlockClick: (b: CalendarTimeBlock) => void` (junto a `onBookingClick`).

Reemplaza:
```tsx
{/* Bloqueos (bandas grises) */}
{positionedBlocks.map((p) => (
  <BlockBand key={p.item.id} p={p} />
))}
```
por:
```tsx
{/* Bloqueos (bandas grises) */}
{positionedBlocks.map((p) => (
  <BlockBand key={p.item.id} p={p} onClick={() => onBlockClick(p.item)} />
))}
```

- [ ] **Step 7: `BlockBand` se convierte en botón**

Reemplaza la función `BlockBand` completa por:

```tsx
function BlockBand({ p, onClick }: { p: PositionedItem<CalendarTimeBlock>; onClick: () => void }) {
  const reason = p.item.reason || 'Bloqueado'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Bloqueo: ${reason}`}
      className="absolute inset-x-0.5 overflow-hidden rounded-md border border-dashed border-muted-foreground/40 bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(0,0,0,0.04)_6px,rgba(0,0,0,0.04)_12px)] px-1.5 py-1 text-left text-[10px] text-muted-foreground transition hover:border-muted-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
      style={{
        top: (p.topMin / 60) * HOUR_HEIGHT,
        height: Math.max((p.heightMin / 60) * HOUR_HEIGHT - 2, 16),
      }}
    >
      {reason}
    </button>
  )
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest --run tests/unit/calendar-views-fill.test.tsx`
Expected: PASS (todos los tests del archivo, incluidos los preexistentes de #3).

- [ ] **Step 9: Commit**

```bash
git add src/components/dashboard/calendar-views.tsx tests/unit/calendar-views-fill.test.tsx
git commit -m "feat(calendar): bloqueo clicable en día/semana abre EditBlockDialog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Reservas clicables en la vista de mes ("stretched link")

**Files:**
- Modify: `src/components/dashboard/calendar-views.tsx`
- Modify: `tests/unit/calendar-views-fill.test.tsx`

- [ ] **Step 1: Write the failing test**

Añade al final de `tests/unit/calendar-views-fill.test.tsx`:

```tsx
describe('CalendarViews — reserva clicable en vista de mes (stretched link)', () => {
  it('la celda mantiene un link de fondo y la reserva es un botón independiente', () => {
    const html = renderToStaticMarkup(
      // @ts-expect-error props mínimos de prueba
      <CalendarViews {...baseProps} view="month" date="2026-06-30" bookings={[booking]} />,
    )
    expect(html).toContain('view=day')
    expect(html).toContain('pointer-events-none')
    expect(html).toContain('pointer-events-auto')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run tests/unit/calendar-views-fill.test.tsx`
Expected: FAIL — la celda de mes hoy es un único `<Link>` sin capas de `pointer-events`.

- [ ] **Step 3: `MonthView` gana la prop `onBookingClick`**

En la firma de `MonthView`, agrega el parámetro `onBookingClick: (b: TimelineBooking) => void`.

- [ ] **Step 4: Reescribir la celda de día con el patrón "stretched link"**

Reemplaza el bloque `return (<Link key={key} href={hrefFor('day', day)} ...> ... </Link>)` completo (el `return` dentro del `.map` de `days`) por:

```tsx
return (
  <div
    key={key}
    className={`relative flex min-h-16 flex-col rounded-lg border p-1.5 transition hover:border-primary/50 md:min-h-24 ${
      inMonth ? 'border-border bg-card' : 'border-transparent bg-muted/30 text-muted-foreground'
    }`}
  >
    <Link
      href={hrefFor('day', day)}
      className="absolute inset-0 rounded-lg"
      aria-label={`Ver ${format(day, "EEEE d 'de' MMMM", { locale: es })}`}
    />
    <span
      className={`pointer-events-none relative text-xs font-medium ${
        isToday
          ? 'flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground'
          : ''
      }`}
    >
      {format(day, 'd')}
    </span>
    <div className="pointer-events-none relative mt-1 space-y-0.5 overflow-hidden">
      {dayBookings.slice(0, 3).map((b) => {
        const appearance = bookingAppearance(b.service?.pastelColor, b.status)
        return (
          <button
            key={b.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onBookingClick(b)
            }}
            className="pointer-events-auto flex w-full items-center gap-1 rounded px-1 text-left"
            style={{
              backgroundColor: appearance.background,
              color: appearance.textColor,
              opacity: appearance.opacity,
            }}
          >
            <span
              className="size-1.5 shrink-0 rounded-full ring-1 ring-white"
              style={{ backgroundColor: appearance.dotColor }}
            />
            <span
              className="truncate text-[10px] leading-tight"
              style={appearance.strikeThrough ? { textDecoration: 'line-through' } : undefined}
            >
              {b.customer?.name || b.service?.name || 'Reserva'}
            </span>
          </button>
        )
      })}
      {dayBookings.length > 3 && (
        <span className="text-[10px] text-muted-foreground">+{dayBookings.length - 3} más</span>
      )}
    </div>
  </div>
)
```

**Cómo funciona:** el `<Link>` cubre toda la celda como capa de fondo (`absolute inset-0`) — preserva teclado y clic derecho/central. El número del día y el contenedor de reservas llevan `pointer-events-none`, así que los clics ahí "atraviesan" hacia el `<Link>` de abajo (navegan al día). Cada botón de reserva reactiva los clics con `pointer-events-auto`, así que el navegador lo detecta a él primero — el clic nunca llega al `<Link>` subyacente (son hermanos en el DOM, no hay anidamiento inválido).

- [ ] **Step 5: `CalendarViews` pasa `onBookingClick` a `MonthView`**

Cambia:
```tsx
{view === 'month' && (
  <MonthView bookings={bookings} focus={focus} timezone={timezone} todayKey={todayKey} />
)}
```
por:
```tsx
{view === 'month' && (
  <MonthView
    bookings={bookings}
    focus={focus}
    timezone={timezone}
    todayKey={todayKey}
    onBookingClick={setActiveBooking}
  />
)}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest --run tests/unit/calendar-views-fill.test.tsx`
Expected: PASS (todos los tests del archivo).

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/calendar-views.tsx tests/unit/calendar-views-fill.test.tsx
git commit -m "feat(calendar): reserva clicable en vista de mes vía stretched link

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Verificación final

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en los archivos tocados por esta feature. (Pueden persistir errores preexistentes y no relacionados en `tests/unit/time-blocks.test.ts:70,91` — un problema de estrechamiento de tipos ya presente antes de este plan — y en `metrics.test.ts`/`create-booking-no-deposit.test.ts`/`mercado-pago-oauth.test.ts`; confirmar que no aparecen NUEVOS errores en esos archivos ni en los nuevos.)

- [ ] **Step 2: Lint**

Run: `npx eslint src/server/actions/time-blocks.ts src/lib/calendar/block-form-values.ts src/components/dashboard/block-form-fields.tsx src/components/dashboard/block-time-modal.tsx src/components/dashboard/edit-block-dialog.tsx src/components/dashboard/calendar-views.tsx tests/unit/time-blocks.test.ts tests/unit/block-form-values.test.ts tests/unit/block-form-fields.test.tsx tests/unit/block-time-modal.test.tsx tests/unit/edit-block-dialog.test.tsx tests/unit/calendar-views-fill.test.tsx`
Expected: sin errores.

- [ ] **Step 3: Suite completa**

Run: `npm run test:unit`
Expected: PASS en todos los archivos.

- [ ] **Step 4: Verificar el `await` en `revalidateBusinessPublicPaths`**

Run: `grep -n "revalidateBusinessPublicPaths" src/server/actions/time-blocks.ts`
Expected: las 3 llamadas (`createTimeBlock`, `deleteTimeBlock`, `updateTimeBlock`) están precedidas por `await`.

- [ ] **Step 5: Confirmar que `BlockTimeModal` no cambió su API pública**

Run: `grep -n "BlockTimeModal" src/app/dashboard/availability/page.tsx src/components/dashboard/calendar-views.tsx`
Expected: ambos usos siguen pasando solo `defaultDate` y `timezone`, sin nuevas props.

- [ ] **Step 6: Nota de verificación manual**

La revisión visual/interactiva (clic en un bloqueo abre el diálogo con los datos correctos; guardar/eliminar funciona; clic en una reserva de la vista de mes abre el drawer; el número de día sigue navegando) queda para revisión manual del usuario, según lo acordado para esta feature de calendario — este proyecto no tiene herramientas de testing de interacción en DOM (`@testing-library/react`), y los diálogos usan Portal, que `renderToStaticMarkup` no puede representar.

---

## Self-Review

**Spec coverage:**
- Bloqueo clicable en día/semana → botón, abre diálogo → Task 5. ✅
- `updateTimeBlock` con validación, revalidación de solape solo si cambia horario, `await` en `revalidateBusinessPublicPaths` → Task 1. ✅
- Diálogo de edición reutiliza campos, precarga en zona horaria correcta, botón Eliminar con confirmación in-place → Task 2 (precarga), Task 4 (diálogo). ✅
- `BlockTimeModal` no cambia su API pública (usado en 2 páginas) → Task 3 + Step 5 de Task 7. ✅
- `BlockFormFields` compartido entre creación y edición → Task 3 (extracción) + Task 4 (reutilización). ✅
- Reserva clicable en mes sin perder teclado/clic-derecho del día → Task 6 (stretched link). ✅
- "Eliminar reserva" = Cancelar (ya existe) → sin tarea nueva, `BookingDrawer` se reutiliza tal cual (Task 6 solo lo monta desde mes). ✅
- Reagendar sigue como enlace → sin cambios, ya confirmado en el spec. ✅
- `'use server'` boundary: única exportación nueva es la función → Task 1, Step 4. ✅
- Vista de mes para bloqueos: fuera de alcance → ninguna tarea la agrega. ✅
- Sin migración de base de datos → ninguna tarea toca `prisma/schema.prisma`. ✅

**Placeholder scan:** sin TBD/TODO; todo el código está completo e incluido en los pasos.

**Type consistency:** `EditBlockDialogProps.block: CalendarTimeBlock` (Task 4) coincide con el tipo que `CalendarViews`/`activeBlock` usan (Task 5) y con el parámetro de `deriveBlockFormValues` (Task 2, estructuralmente compatible: `{ startDateTime: string; endDateTime: string; reason?: string | null }`). `BlockFormFieldsProps` (Task 3) se usa con los mismos nombres de props en `BlockTimeModal` (Task 3) y `EditBlockDialog` (Task 4). `updateTimeBlock(id, data)` (Task 1) se llama con la misma forma de `data` en `EditBlockDialog` (Task 4). `onBlockClick`/`onBookingClick` se declaran y propagan con el mismo nombre y firma entre `TimelineView`/`MonthView`/`CalendarViews` (Task 5, Task 6).
