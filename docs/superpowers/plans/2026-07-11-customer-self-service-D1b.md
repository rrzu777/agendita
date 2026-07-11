# D1-b — Self-service de reservas (cancelar/reprogramar desde /mi) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la clienta logueada cancele o reprograme sus reservas desde `/mi/[slug]`, dentro de la ventana `Business.selfServiceCutoffHours` (default 24h, 0 = sin límite), con notificación a la dueña.

**Architecture:** Se extrae el core tx-aware de `cancelBooking`/`rescheduleBooking` a `src/lib/bookings/mutate.ts` (las actions de dueña quedan como wrappers con su auth actual, comportamiento idéntico). Las actions de clienta viven en `src/server/actions/my-bookings.ts` (módulo `'use server'`) con guards de sesión+ownership+status+ventana. El cómputo de slots de reprogramación se extrae a `src/lib/availability/reschedule-slots.ts` para compartirlo entre la variante dueña y la de clienta **sin exportar helpers desde módulos `'use server'`** (un export async en esos módulos se vuelve endpoint invocable sin auth). UI: acciones en la lista de próximas reservas de `/mi/[slug]` + página de reprogramación que replica el patrón del picker del dashboard.

**Tech Stack:** Next.js 16 App Router (server actions), Prisma/Postgres (pgbouncer `connection_limit=1` — NUNCA tx interactiva dentro de `Promise.all`), Vitest 4 (`vi.hoisted` para mocks), zod, date-fns/date-fns-tz.

**Spec:** `docs/superpowers/specs/2026-07-05-customer-login-D1-design.md` §5 (self-service), §7 (testing), §8 (seguridad).

---

## Landmines del repo (leer antes de tocar nada)

1. **Módulos `'use server'` solo pueden exportar funciones `async`.** Constantes/tipos exportados crashean en runtime. Helpers compartidos van a `src/lib/**`, no a `src/server/actions/**`. Y NUNCA exportes desde `'use server'` un helper que no valide auth: cada export async es un endpoint público.
2. **`await revalidateBusinessPublicPaths(...)` SIEMPRE con await** (sin await el proceso muere con exit 128).
3. **Tx interactiva nunca dentro de `Promise.all`** (P2028 con `connection_limit=1`).
4. **Vitest 4:** mocks dentro de `vi.mock` factories via `vi.hoisted()`. Component tests: `renderToStaticMarkup` + mock de `next/navigation`.
5. **tsc no corre en vitest/lint:** antes de push, `npx prisma generate && npx tsc --noEmit | grep '^src/'` (main arrastra errores pre-existentes en availability/bank-transfer que otro PR arregla — ignora los que no sean tuyos, no agregues NINGUNO nuevo).
6. **Worktrees:** el cwd de Bash puede driftear — usa `git -C <worktree>` y `git add` de archivos explícitos (nunca `-A`).
7. **Sin migración en D1-b:** `Business.selfServiceCutoffHours` YA existe en schema y en la DB (migración de D1-a).
8. **`getEffectiveBlocks` es el read path obligatorio** para bloqueos/disponibilidad (`src/lib/availability/effective-blocks.ts`); jamás leer `TimeBlock` directo. Evitar `relationLoadStrategy: 'join'` (panic de Prisma).

**Setup:** rama nueva desde `origin/main`: `git fetch origin main && git checkout -b claude/d1b-self-service origin/main && npm install && npx prisma generate`.

---

### Task 1: Helper puro de ventana — `src/lib/bookings/self-service.ts`

**Files:**
- Create: `src/lib/bookings/self-service.ts`
- Test: `tests/unit/self-service-window.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/self-service-window.test.ts
import { describe, expect, it } from 'vitest'
import { canSelfManage, SELF_MANAGEABLE_STATUSES } from '@/lib/bookings/self-service'

const NOW = new Date('2026-07-11T12:00:00Z')
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000)

describe('canSelfManage', () => {
  it('permite cuando falta más que la ventana', () => {
    expect(canSelfManage(hoursFromNow(25), 24, NOW)).toBe(true)
  })
  it('bloquea cuando falta menos que la ventana', () => {
    expect(canSelfManage(hoursFromNow(23), 24, NOW)).toBe(false)
  })
  it('borde exacto: exactamente 24h NO alcanza (la regla es estrictamente mayor)', () => {
    expect(canSelfManage(hoursFromNow(24), 24, NOW)).toBe(false)
  })
  it('0 = sin límite, pero solo para reservas futuras', () => {
    expect(canSelfManage(hoursFromNow(0.5), 0, NOW)).toBe(true)
    expect(canSelfManage(hoursFromNow(-1), 0, NOW)).toBe(false)
  })
  it('reserva pasada nunca es gestionable', () => {
    expect(canSelfManage(hoursFromNow(-2), 24, NOW)).toBe(false)
  })
})

describe('SELF_MANEABLE_STATUSES', () => {
  it('solo pending_payment y confirmed (únicos con transición válida a cancelled)', () => {
    expect(SELF_MANAGEABLE_STATUSES).toEqual(['pending_payment', 'confirmed'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/self-service-window.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/bookings/self-service.ts
/** Ventana de autogestión de la clienta (spec D1 §5): puede cancelar/reprogramar
 *  solo si startDateTime − now > cutoffHours (estrictamente). 0 = sin límite,
 *  pero una reserva pasada nunca es gestionable. La ventana aplica SOBRE EL
 *  HORARIO ACTUAL de la reserva; el slot nuevo se rige por las reglas del funnel. */
export function canSelfManage(startDateTime: Date, cutoffHours: number, now: Date = new Date()): boolean {
  const msUntilStart = startDateTime.getTime() - now.getTime()
  if (msUntilStart <= 0) return false
  if (cutoffHours === 0) return true
  return msUntilStart > cutoffHours * 3_600_000
}

/** Únicos status con transición válida a cancelled desde self-service. */
export const SELF_MANAGEABLE_STATUSES = ['pending_payment', 'confirmed'] as const
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/self-service-window.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookings/self-service.ts tests/unit/self-service-window.test.ts
git commit -m "feat(d1b): helper puro de ventana de autogestión canSelfManage"
```

---

### Task 2: Extraer core de cancelación — `src/lib/bookings/mutate.ts` (parte 1)

**Files:**
- Create: `src/lib/bookings/mutate.ts`
- Modify: `src/server/actions/bookings.ts:1035-1052` (cuerpo de la tx de `cancelBooking`)
- Test: `tests/unit/bookings-mutate.test.ts`

El core replica EXACTAMENTE lo que hoy hace la tx de `cancelBooking` (bookings.ts:1035-1052): flip a `cancelled` + nota, `releaseRedemptionForBooking`, cierre de Payment bt-declared pendiente. Sin auth, tx-aware.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/bookings-mutate.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRelease } = vi.hoisted(() => ({ mockRelease: vi.fn() }))
vi.mock('@/lib/promotions/release', () => ({ releaseRedemptionForBooking: mockRelease }))

import { cancelBookingInTx } from '@/lib/bookings/mutate'
import { declaredTransferPaymentWhere } from '@/lib/bank-transfer/declared'

function makeTx() {
  return {
    booking: { update: vi.fn().mockResolvedValue({}) },
    payment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  }
}

describe('cancelBookingInTx', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flip a cancelled + release + cierra bt-declared pendiente', async () => {
    const tx = makeTx()
    await cancelBookingInTx(tx as never, { id: 'b1', internalNotes: 'nota' }, { reason: 'me enfermé' })
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { status: 'cancelled', internalNotes: 'nota\n[CANCELADA: me enfermé]' },
    })
    expect(mockRelease).toHaveBeenCalledWith(tx, 'b1', 'cancelled')
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { bookingId: 'b1', ...declaredTransferPaymentWhere },
      data: { status: 'cancelled' },
    })
  })

  it('sin reason conserva internalNotes tal cual', async () => {
    const tx = makeTx()
    await cancelBookingInTx(tx as never, { id: 'b1', internalNotes: null }, {})
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { status: 'cancelled', internalNotes: null },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/bookings-mutate.test.ts` → FAIL (módulo no existe).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/bookings/mutate.ts
import type { Prisma } from '@prisma/client'
import { BookingStatus } from '@prisma/client'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import { declaredTransferPaymentWhere } from '@/lib/bank-transfer/declared'

type Tx = Prisma.TransactionClient

/** Core tx-aware de cancelación (SIN auth — el caller valida quién puede).
 *  Réplica exacta de la tx histórica de cancelBooking: flip + release de
 *  promo/paquete + cierre del Payment bt-declared pendiente (§6.4 transferencias). */
export async function cancelBookingInTx(
  tx: Tx,
  booking: { id: string; internalNotes: string | null },
  opts: { reason?: string },
): Promise<void> {
  await tx.booking.update({
    where: { id: booking.id },
    data: {
      status: BookingStatus.cancelled,
      internalNotes: opts.reason
        ? `${booking.internalNotes || ''}\n[CANCELADA: ${opts.reason}]`.trim()
        : booking.internalNotes,
    },
  })
  await releaseRedemptionForBooking(tx, booking.id, 'cancelled')
  await tx.payment.updateMany({
    where: { bookingId: booking.id, ...declaredTransferPaymentWhere },
    data: { status: 'cancelled' },
  })
}
```

- [ ] **Step 4: Run test to verify it passes** → PASS

- [ ] **Step 5: Reemplazar el cuerpo de la tx en `cancelBooking` (dueña) por el core**

En `src/server/actions/bookings.ts`, dentro de `cancelBooking`, reemplaza el bloque `await prisma.$transaction(async (tx) => { ... })` (líneas ~1035-1052) por:

```ts
  await prisma.$transaction(async (tx) => {
    await cancelBookingInTx(tx, booking, { reason })
  })
```

y agrega el import `import { cancelBookingInTx } from '@/lib/bookings/mutate'`. NO toques guards, notificación ni revalidates de la action de dueña.

- [ ] **Step 6: Run suite + commit**

Run: `npx vitest run tests/unit/ 2>&1 | tail -3` → todo verde.

```bash
git add src/lib/bookings/mutate.ts src/server/actions/bookings.ts tests/unit/bookings-mutate.test.ts
git commit -m "refactor(d1b): extraer cancelBookingInTx a lib/bookings/mutate.ts"
```

---

### Task 3: Extraer core de reprogramación — `mutate.ts` (parte 2)

**Files:**
- Modify: `src/lib/bookings/mutate.ts`
- Modify: `src/server/actions/bookings.ts:1100-1133` (cuerpo de la tx de `rescheduleBooking`)
- Test: `tests/unit/bookings-mutate.test.ts` (ampliar)

Réplica exacta de la tx de `rescheduleBooking` (bookings.ts:1100-1133): `assertSlotIsAvailable` + `updateMany` guardado por status (anti-carrera). El caller decide `leadTimeMinutes` (dueña: 0; clienta: default del funnel = omitir).

- [ ] **Step 1: Write the failing test (agregar al mismo archivo)**

```ts
// agregar a tests/unit/bookings-mutate.test.ts
const { mockAssertSlot } = vi.hoisted(() => ({ mockAssertSlot: vi.fn() }))
vi.mock('@/lib/availability/validation', () => ({ assertSlotIsAvailable: mockAssertSlot }))

import { rescheduleBookingInTx } from '@/lib/bookings/mutate'

describe('rescheduleBookingInTx', () => {
  beforeEach(() => vi.clearAllMocks())

  const baseInput = {
    booking: {
      id: 'b1', businessId: 'biz1', serviceId: 's1',
      startDateTime: new Date('2026-07-20T15:00:00Z'), internalNotes: null,
    },
    newStartDateTime: new Date('2026-07-21T15:00:00Z'),
    durationMinutes: 60,
    timezone: 'America/Santiago',
  }

  it('valida slot y actualiza con guard de status', async () => {
    const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
    await rescheduleBookingInTx(tx as never, { ...baseInput, leadTimeMinutes: 0 })
    expect(mockAssertSlot).toHaveBeenCalledWith(expect.objectContaining({
      tx, businessId: 'biz1', serviceId: 's1',
      startDateTime: baseInput.newStartDateTime,
      endDateTime: new Date('2026-07-21T16:00:00Z'),
      excludeBookingId: 'b1', leadTimeMinutes: 0,
    }))
    expect(tx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'b1', businessId: 'biz1' }),
      data: expect.objectContaining({
        startDateTime: baseInput.newStartDateTime,
        endDateTime: new Date('2026-07-21T16:00:00Z'),
      }),
    }))
  })

  it('lanza si el updateMany no matchea (carrera de status)', async () => {
    const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } }
    await expect(rescheduleBookingInTx(tx as never, baseInput)).rejects.toThrow('No se puede reprogramar')
  })
})
```

- [ ] **Step 2: Run to verify FAIL**, luego **Step 3: implementación**

```ts
// agregar a src/lib/bookings/mutate.ts
import { addMinutes } from 'date-fns'
import { assertSlotIsAvailable } from '@/lib/availability/validation'

/** Core tx-aware de reprogramación (SIN auth). assertSlotIsAvailable cubre
 *  bloqueos (getEffectiveBlocks) + anti-doble-booking; el updateMany guardado
 *  por status evita la carrera con complete/cancel concurrente.
 *  leadTimeMinutes: dueña pasa 0 (la dueña manda); clienta omite (default del funnel). */
export async function rescheduleBookingInTx(
  tx: Tx,
  input: {
    booking: { id: string; businessId: string; serviceId: string; startDateTime: Date; internalNotes: string | null }
    newStartDateTime: Date
    durationMinutes: number
    timezone: string
    leadTimeMinutes?: number
  },
): Promise<{ endDateTime: Date }> {
  const { booking, newStartDateTime, durationMinutes, timezone, leadTimeMinutes } = input
  const endDateTime = addMinutes(newStartDateTime, durationMinutes)

  await assertSlotIsAvailable({
    tx,
    businessId: booking.businessId,
    serviceId: booking.serviceId,
    startDateTime: newStartDateTime,
    endDateTime,
    timezone,
    excludeBookingId: booking.id,
    ...(leadTimeMinutes !== undefined ? { leadTimeMinutes } : {}),
  })

  const historyNote = `[REPROGRAMADA de ${booking.startDateTime.toLocaleString('es-CL')}]`
  const updateResult = await tx.booking.updateMany({
    where: {
      id: booking.id,
      businessId: booking.businessId,
      status: { notIn: [BookingStatus.completed, BookingStatus.cancelled, BookingStatus.no_show, BookingStatus.expired] },
    },
    data: {
      startDateTime: newStartDateTime,
      endDateTime,
      internalNotes: booking.internalNotes ? `${booking.internalNotes}\n${historyNote}` : historyNote,
    },
  })
  if (updateResult.count === 0) {
    throw new Error('No se puede reprogramar una reserva en este estado')
  }
  return { endDateTime }
}
```

- [ ] **Step 4: Reemplazar la tx de `rescheduleBooking` (dueña) por el core**

En `src/server/actions/bookings.ts`, dentro de `rescheduleBooking`, reemplaza el bloque `await prisma.$transaction(async (tx) => { ...assertSlotIsAvailable... updateMany... })` por:

```ts
  await prisma.$transaction(async (tx) => {
    await rescheduleBookingInTx(tx, {
      booking,
      newStartDateTime,
      durationMinutes: service.durationMinutes,
      timezone: business.timezone || 'America/Santiago',
      leadTimeMinutes: 0, // Reagendar desde el dashboard no exige anticipación (la dueña manda)
    })
  })
```

Las variables locales que quedaron sin uso (`endDateTime`, `oldDate`) se eliminan; `previousStartDateTime` se conserva (lo usa la notificación). Import: `rescheduleBookingInTx` desde `@/lib/bookings/mutate`.

- [ ] **Step 5: Run suite (`npx vitest run tests/unit/ | tail -3`) → verde. Commit**

```bash
git add src/lib/bookings/mutate.ts src/server/actions/bookings.ts tests/unit/bookings-mutate.test.ts
git commit -m "refactor(d1b): extraer rescheduleBookingInTx a lib/bookings/mutate.ts"
```

---

### Task 4: Extraer cómputo de slots de reprogramación — `src/lib/availability/reschedule-slots.ts`

**Files:**
- Create: `src/lib/availability/reschedule-slots.ts`
- Modify: `src/server/actions/availability.ts:92-150` (`getAvailableSlotsForReschedule` pasa a usar el helper)
- Test: cubierto por los tests existentes de availability + un smoke nuevo

**Por qué:** la clienta necesita "slots disponibles para ESTA reserva excluyéndola a ella misma" con SU auth (ownership), y la dueña ya lo tiene con la suya (`requireBusinessRole`). El cómputo no puede exportarse desde `availability.ts` (módulo `'use server'` — cada export async es endpoint sin auth). Se mueve el cómputo puro-de-datos a lib y ambas actions lo llaman tras su propio guard.

- [ ] **Step 1: Crear el helper moviendo el código existente**

Copia de `src/server/actions/availability.ts` (líneas ~120-146, el bloque desde `const timezone =` hasta el `return generateSlots(...)`) a:

```ts
// src/lib/availability/reschedule-slots.ts
import { prisma } from '@/lib/db'
import { getBusinessDayRange } from '@/lib/availability' // ajustar al import real que usa availability.ts
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'
import { generateSlots } from '@/lib/availability' // ídem: usar exactamente los mismos imports que availability.ts

/** Slots disponibles para reprogramar una reserva (excluye la reserva misma).
 *  SIN auth: el caller (action de dueña o de clienta) valida ownership antes. */
export async function computeRescheduleSlots(booking: {
  id: string
  businessId: string
  service: { durationMinutes: number }
  business: { timezone: string | null; bookingWindowDays: number | null; slotStepMinutes: number | null }
}, date: Date) {
  const timezone = booking.business.timezone || 'America/Santiago'
  const bookingWindowDays = booking.business.bookingWindowDays ?? 90
  const { dayStart, dayEnd } = getBusinessDayRange(date, timezone)

  const [availabilityRules, timeBlocks, bookings] = await Promise.all([
    prisma.availabilityRule.findMany({ where: { businessId: booking.businessId, isActive: true }, orderBy: { dayOfWeek: 'asc' } }),
    getEffectiveBlocks(booking.businessId, dayStart, dayEnd, timezone),
    prisma.booking.findMany({
      where: {
        businessId: booking.businessId,
        id: { not: booking.id },
        status: { notIn: ['cancelled', 'no_show', 'expired'] },
        startDateTime: { lte: dayEnd },
        endDateTime: { gte: dayStart },
      },
      orderBy: { startDateTime: 'asc' },
    }),
  ])

  return generateSlots(date, booking.service.durationMinutes, availabilityRules, timeBlocks, bookings, {
    timezone,
    now: new Date(),
    bookingWindowDays,
    slotStepMinutes: booking.business.slotStepMinutes,
  })
}
```

**IMPORTANTE:** verifica los paths reales de `getBusinessDayRange` y `generateSlots` mirando los imports de `src/server/actions/availability.ts` y usa exactamente esos.

- [ ] **Step 2: `getAvailableSlotsForReschedule` (dueña) delega en el helper**

En `availability.ts`, tras los guards existentes (requireBusinessRole, zod, load booking, status, service activo), reemplaza el bloque de cómputo por `return computeRescheduleSlots(booking, date)`. El `include` del `findFirst` ya trae `service.durationMinutes` y `business.{timezone,bookingWindowDays,slotStepMinutes}` — no cambies el query.

- [ ] **Step 3: Run los tests de availability existentes**

Run: `npx vitest run tests/unit/ -t reschedule 2>&1 | tail -5` y luego la suite completa de unit. → verde (es un move sin cambio de comportamiento).

- [ ] **Step 4: Commit**

```bash
git add src/lib/availability/reschedule-slots.ts src/server/actions/availability.ts
git commit -m "refactor(d1b): extraer computeRescheduleSlots para compartir dueña/clienta"
```

---

### Task 5: Notificación a la dueña — `sendOwnerBookingChangedNotification`

**Files:**
- Modify: `src/lib/notifications/email-provider.ts` (nueva función junto a `sendNewBookingNotificationToBusiness`, :260)
- Modify: `src/lib/notifications/index.ts` (re-export)
- Test: `tests/unit/owner-booking-changed-notification.test.ts`

Sigue el patrón de `sendNewBookingNotificationToBusiness` (owner-directed, resuelve destinatarios con el helper local `getBusinessOwnerEmails(businessId)` de email-provider.ts:129). Payload:

```ts
export interface OwnerBookingChangedData {
  businessId: string
  businessName: string
  businessTimezone: string
  customerName: string
  serviceName: string
  bookingNumber: number | null
  change: { kind: 'cancelled' } | { kind: 'rescheduled'; previousStartDateTime: Date; newStartDateTime: Date }
  startDateTime: Date // horario (previo) de la reserva
}
```

- [ ] **Step 1: Test** — mockear el transport de email igual que hacen los tests existentes de notificaciones (busca `tests/unit/*notification*.test.ts` y copia el patrón de mock del provider); asertar: (a) resuelve destinatarios vía owners del negocio, (b) el subject dice "canceló" o "reprogramó" según `change.kind`, (c) el body incluye servicio + fecha formateada en timezone del negocio y, en reschedule, ambos horarios.
- [ ] **Step 2: FAIL → Step 3: implementar** siguiendo el estilo de las funciones vecinas (mismo builder de HTML, `formatInTimeZone` para fechas, retorno `EmailResult`). Re-exportar en `src/lib/notifications/index.ts`.
- [ ] **Step 4: PASS → Step 5: Commit**

```bash
git add src/lib/notifications/email-provider.ts src/lib/notifications/index.ts tests/unit/owner-booking-changed-notification.test.ts
git commit -m "feat(d1b): notificación a la dueña de cancelación/reprogramación self-service"
```

---

### Task 6: Action `cancelMyBooking` — `src/server/actions/my-bookings.ts`

**Files:**
- Create: `src/server/actions/my-bookings.ts`
- Test: `tests/unit/my-bookings-cancel.test.ts`

- [ ] **Step 1: Write the failing tests**

Mock (vía `vi.hoisted`): `@/lib/auth/server` (`requireUser`), `@/lib/db` (prisma con `booking.findFirst` y `$transaction: vi.fn(async (fn) => fn(mockTx))`), `@/lib/bookings/mutate` (`cancelBookingInTx`), `@/lib/rate-limit` (`checkRateLimit` → `{success:true}`), `@/lib/notifications` (todas las send* → `{ok:true}` y `sendNotificationSafely: vi.fn(async (_l, fn) => fn())`), `@/lib/revalidate` o el módulo real de `revalidateBusinessPublicPaths` (verificar path real en bookings.ts), `next/cache` (`revalidatePath`).

Casos:
1. **feliz:** user u1, booking de su Customer (`customer.userId === 'u1'`), status `confirmed`, start en 48h, cutoff 24 → llama `cancelBookingInTx`, notifica dueña (`sendOwnerBookingChangedNotification` con kind cancelled) y clienta (`sendBookingCancelledNotification` si hay email), revalida (`/dashboard/bookings`, `/dashboard/calendar`, business public paths con await, `/mi/[slug]`).
2. **ownership ajeno:** `booking.findFirst` con el where por `customer: { userId: user.id }` no encuentra → error "Reserva no encontrada" y NO llama a la tx.
3. **fuera de ventana:** start en 2h, cutoff 24 → error que incluye la política ("con menos de 24 horas") y NO muta.
4. **status no cancelable:** `completed` → error, NO muta. (El where ya filtra por `SELF_MANAGEABLE_STATUSES`, así que este caso también cae en "no encontrada" — asertar eso.)
5. **rate limit:** `checkRateLimit` → `{success:false}` → error, sin queries.

- [ ] **Step 2: FAIL → Step 3: implementación**

```ts
// src/server/actions/my-bookings.ts
'use server'

// LANDMINE: módulo 'use server' — SOLO exports async. Nada de constantes/tipos exportados.
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { canSelfManage, SELF_MANAGEABLE_STATUSES } from '@/lib/bookings/self-service'
import { cancelBookingInTx } from '@/lib/bookings/mutate'
// verificar path real de revalidateBusinessPublicPaths y de las funciones de notificación
// mirando los imports de src/server/actions/bookings.ts, y usar los mismos.

export async function cancelMyBooking(bookingId: string) {
  const user = await requireUser()
  const limit = await checkRateLimit('self-service-booking', 10, 60_000, { userId: user.id })
  if (!limit.success) throw new Error('Demasiados intentos. Espera un momento y vuelve a intentar.')

  // Ownership EN el where (customer.userId === user.id): jamás confiar en ids del cliente.
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      status: { in: [...SELF_MANAGEABLE_STATUSES] },
      customer: { userId: user.id },
    },
    include: {
      service: { select: { name: true } },
      customer: { select: { name: true, email: true } },
      business: { select: { id: true, name: true, slug: true, timezone: true, selfServiceCutoffHours: true } },
    },
  })
  if (!booking) throw new Error('Reserva no encontrada')

  const cutoff = booking.business.selfServiceCutoffHours
  if (!canSelfManage(booking.startDateTime, cutoff)) {
    throw new Error(
      cutoff === 0
        ? 'Esta reserva ya no se puede cancelar.'
        : `Las reservas se pueden cancelar hasta ${cutoff} horas antes. Contacta al negocio para cambios de último minuto.`,
    )
  }

  await prisma.$transaction(async (tx) => {
    await cancelBookingInTx(tx, booking, { reason: 'cancelada por la clienta desde /mi' })
  })

  // Notificaciones vía sendNotificationSafely (dueña + confirmación a clienta) — mismo patrón
  // que cancelBooking de dueña (bookings.ts:1054-1066) más sendOwnerBookingChangedNotification.
  // [código concreto: replicar el bloque de cancelBooking cambiando el destinatario/labels]

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(booking.business.id)
  revalidatePath(`/mi/${booking.business.slug}`)

  return { cancelled: true }
}
```

El bloque de notificaciones (reemplaza el comentario): 

```ts
  await sendNotificationSafely('self-service cancel (owner)', async () =>
    sendOwnerBookingChangedNotification({
      businessId: booking.business.id,
      businessName: booking.business.name,
      businessTimezone: booking.business.timezone || 'America/Santiago',
      customerName: booking.customer!.name,
      serviceName: booking.service!.name,
      bookingNumber: booking.bookingNumber,
      change: { kind: 'cancelled' },
      startDateTime: booking.startDateTime,
    }),
  )
  if (booking.customer?.email) {
    await sendNotificationSafely('self-service cancel (customer)', async () =>
      sendBookingCancelledNotification({
        businessName: booking.business.name,
        businessReplyToEmail: await getBusinessReplyToEmail(booking.business.id),
        customerName: booking.customer!.name,
        customerEmail: booking.customer!.email!,
        serviceName: booking.service!.name,
        startDateTime: booking.startDateTime,
        businessTimezone: booking.business.timezone || 'America/Santiago',
      }),
    )
  }
```

- [ ] **Step 4: PASS → Step 5: Commit**

```bash
git add src/server/actions/my-bookings.ts tests/unit/my-bookings-cancel.test.ts
git commit -m "feat(d1b): cancelMyBooking con guards de ownership/status/ventana"
```

---

### Task 7: Actions `rescheduleMyBooking` + `getMyRescheduleSlots`

**Files:**
- Modify: `src/server/actions/my-bookings.ts`
- Test: `tests/unit/my-bookings-reschedule.test.ts`

- [ ] **Step 1: Tests** (mismo esqueleto de mocks que Task 6, más `@/lib/bookings/mutate.rescheduleBookingInTx` y `@/lib/availability/reschedule-slots.computeRescheduleSlots`):

1. **feliz:** reserva propia confirmada en 48h, cutoff 24, nuevo slot en 72h → `rescheduleBookingInTx` llamado SIN `leadTimeMinutes` (usa default del funnel), notifica dueña (kind rescheduled con ambos horarios) + clienta (`sendBookingRescheduledNotification`), revalida los 4 paths.
2. **ventana sobre horario ACTUAL:** reserva en 2h con cutoff 24 → error aunque el nuevo slot esté lejos.
3. **nuevo slot fuera de `bookingWindowDays`:** negocio con window 90 → `newStart` a 120 días → error "fuera del período de reservas".
4. **negocio suspendido (`isActive: false` en el include del business):** → error "no está aceptando reservas" y NO muta.
5. **ownership ajeno → "Reserva no encontrada".**
6. **`getMyRescheduleSlots`:** con ownership OK delega en `computeRescheduleSlots(booking, date)`; ajeno → error.

- [ ] **Step 2: FAIL → Step 3: implementación**

```ts
// agregar a src/server/actions/my-bookings.ts
export async function rescheduleMyBooking(bookingId: string, newStartDateTime: Date) {
  const user = await requireUser()
  const limit = await checkRateLimit('self-service-booking', 10, 60_000, { userId: user.id })
  if (!limit.success) throw new Error('Demasiados intentos. Espera un momento y vuelve a intentar.')

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, status: { in: [...SELF_MANAGEABLE_STATUSES] }, customer: { userId: user.id } },
    include: {
      service: { select: { name: true, durationMinutes: true } },
      customer: { select: { name: true, email: true, phone: true } },
      business: {
        select: {
          id: true, name: true, slug: true, timezone: true, isActive: true,
          selfServiceCutoffHours: true, bookingWindowDays: true, whatsapp: true, addressText: true,
        },
      },
    },
  })
  if (!booking) throw new Error('Reserva no encontrada')
  // Guard de negocio suspendido: reprogramar crea un slot nuevo (spec §5).
  if (!booking.business.isActive) throw new Error('El negocio no está aceptando reservas en este momento.')

  const cutoff = booking.business.selfServiceCutoffHours
  if (!canSelfManage(booking.startDateTime, cutoff)) {
    throw new Error(
      cutoff === 0
        ? 'Esta reserva ya no se puede reprogramar.'
        : `Las reservas se pueden reprogramar hasta ${cutoff} horas antes. Contacta al negocio para cambios de último minuto.`,
    )
  }

  // El slot NUEVO se rige por las reglas del funnel: lead time default (omitimos
  // leadTimeMinutes) y dentro de bookingWindowDays.
  const windowDays = booking.business.bookingWindowDays ?? 90
  if (newStartDateTime.getTime() > Date.now() + windowDays * 24 * 3_600_000) {
    throw new Error('La nueva fecha está fuera del período de reservas del negocio.')
  }

  const previousStartDateTime = booking.startDateTime
  await prisma.$transaction(async (tx) => {
    await rescheduleBookingInTx(tx, {
      booking,
      newStartDateTime,
      durationMinutes: booking.service!.durationMinutes,
      timezone: booking.business.timezone || 'America/Santiago',
      // sin leadTimeMinutes → default del funnel público
    })
  })

  // notificaciones: sendOwnerBookingChangedNotification({change: {kind:'rescheduled', previousStartDateTime, newStartDateTime}, ...})
  // + sendBookingRescheduledNotification a la clienta (mismo payload que usa rescheduleBooking de dueña, bookings.ts:1135-1152)

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(booking.business.id)
  revalidatePath(`/mi/${booking.business.slug}`)

  return { rescheduled: true }
}

export async function getMyRescheduleSlots(bookingId: string, date: Date) {
  const user = await requireUser()
  const limit = await checkRateLimit('get-availability')
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, status: { in: [...SELF_MANAGEABLE_STATUSES] }, customer: { userId: user.id } },
    include: {
      service: { select: { id: true, durationMinutes: true, isActive: true } },
      business: { select: { timezone: true, bookingWindowDays: true, slotStepMinutes: true } },
    },
  })
  if (!booking) throw new Error('Reserva no encontrada')
  if (!booking.service?.isActive) throw new Error('Servicio no disponible')
  return computeRescheduleSlots(booking, date)
}
```

- [ ] **Step 4: PASS → Step 5: Commit**

```bash
git add src/server/actions/my-bookings.ts tests/unit/my-bookings-reschedule.test.ts
git commit -m "feat(d1b): rescheduleMyBooking + getMyRescheduleSlots"
```

---

### Task 8: Setting "ventana de autogestión" en el dashboard

**Files:**
- Modify: `src/lib/business/schema.ts` (updateBusinessSchema, :3)
- Modify: `src/server/actions/business-settings.ts` (updateBusinessSettings, :27 — incluir el campo en el update)
- Modify: `src/components/dashboard/settings-form.tsx` (campo numérico junto a `slotStepMinutes`, :206)
- Test: `tests/unit/business-schema.test.ts` (o el archivo de tests existente del schema — buscar `updateBusinessSchema` en tests/ y ampliar ahí)

- [ ] **Step 1: Test del schema**

```ts
it('selfServiceCutoffHours: default 24, rango 0-720, entero', () => {
  expect(updateBusinessSchema.parse({ ...minimalValid }).selfServiceCutoffHours).toBe(24)
  expect(updateBusinessSchema.parse({ ...minimalValid, selfServiceCutoffHours: 0 }).selfServiceCutoffHours).toBe(0)
  expect(() => updateBusinessSchema.parse({ ...minimalValid, selfServiceCutoffHours: 721 })).toThrow()
  expect(() => updateBusinessSchema.parse({ ...minimalValid, selfServiceCutoffHours: -1 })).toThrow()
})
```

(`minimalValid` = el fixture que ya usen los tests existentes del schema; si no hay tests del schema, crear el archivo con ese fixture mínimo leyendo los campos requeridos de `updateBusinessSchema`.)

- [ ] **Step 2: FAIL → Step 3: schema + action + form**

En `schema.ts` (dentro de `updateBusinessSchema`):

```ts
  selfServiceCutoffHours: z.coerce.number().int().min(0).max(720).default(24),
```

En `business-settings.ts`: agregar `selfServiceCutoffHours: parsed.selfServiceCutoffHours` al `data` del update (seguir el patrón exacto de los campos vecinos).

En `settings-form.tsx`: (a) default del form desde `business.selfServiceCutoffHours` (junto a los otros defaults, :68), (b) campo en la sección de reservas junto a `slotStepMinutes`:

```tsx
<div className="space-y-2">
  <Label htmlFor="selfServiceCutoffHours">Ventana de autogestión (horas)</Label>
  <Input
    id="selfServiceCutoffHours"
    type="number"
    min={0}
    max={720}
    {...register('selfServiceCutoffHours')}
  />
  <p className="text-xs text-muted-foreground">
    Hasta cuántas horas antes tus clientas pueden cancelar o reprogramar solas desde su cuenta. 0 = sin límite.
  </p>
</div>
```

(Ajustar `register` vs `value/onChange` al patrón que use el form — mirar cómo maneja los otros inputs numéricos.)

- [ ] **Step 4: PASS + suite de settings existente verde → Step 5: Commit**

```bash
git add src/lib/business/schema.ts src/server/actions/business-settings.ts src/components/dashboard/settings-form.tsx tests/unit/business-schema.test.ts
git commit -m "feat(d1b): setting de ventana de autogestión en settings del negocio"
```

---

### Task 9: UI — acciones en próximas reservas de `/mi/[slug]`

**Files:**
- Create: `src/app/mi/[slug]/booking-actions.tsx` (client component)
- Modify: `src/app/mi/[slug]/page.tsx` (sección "Próximas reservas", :77-97; y el select del business para traer `selfServiceCutoffHours`)
- Test: `tests/unit/mi-booking-actions.test.tsx`

- [ ] **Step 1: Component test** (renderToStaticMarkup + mock de `next/navigation` — landmine §4; mock de `@/server/actions/my-bookings`):

1. Con `canManage: true` renderiza botón "Cancelar" y link "Reprogramar" hacia `/mi/[slug]/reservas/[id]/reprogramar`.
2. Con `canManage: false` y cutoff 24 renderiza el mensaje "hasta 24 horas antes" + "contacta al negocio" y NO renderiza botones.

- [ ] **Step 2: FAIL → Step 3: implementación**

```tsx
// src/app/mi/[slug]/booking-actions.tsx
'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cancelMyBooking } from '@/server/actions/my-bookings'

export function BookingActions({ bookingId, slug, canManage, cutoffHours }: {
  bookingId: string
  slug: string
  canManage: boolean
  cutoffHours: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  if (!canManage) {
    return (
      <p className="mt-1 text-xs text-gray-400">
        {cutoffHours === 0
          ? 'Esta reserva ya no se puede modificar.'
          : `Se puede cancelar o reprogramar hasta ${cutoffHours} horas antes. Para cambios de último minuto, contacta al negocio.`}
      </p>
    )
  }

  function handleCancel() {
    setError('')
    startTransition(async () => {
      try {
        await cancelMyBooking(bookingId)
        setConfirming(false)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo cancelar')
      }
    })
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
      {confirming ? (
        <>
          <span className="text-gray-600">¿Cancelar esta reserva?</span>
          <button type="button" onClick={handleCancel} disabled={pending} className="font-semibold text-red-600 hover:underline disabled:opacity-50">
            {pending ? 'Cancelando…' : 'Sí, cancelar'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="text-gray-500 hover:underline">
            No
          </button>
        </>
      ) : (
        <>
          <Link href={`/mi/${slug}/reservas/${bookingId}/reprogramar`} className="font-semibold text-pink-700 hover:underline">
            Reprogramar
          </Link>
          <button type="button" onClick={() => setConfirming(true)} className="text-gray-500 hover:underline">
            Cancelar reserva
          </button>
        </>
      )}
      {error && <span className="w-full text-xs text-red-600">{error}</span>}
    </div>
  )
}
```

- [ ] **Step 4: Integrar en `page.tsx`**

En el select del business agregar `selfServiceCutoffHours: true`. En el `<li>` de cada reserva de `upcoming` (después de la línea de fecha/status/número):

```tsx
<BookingActions
  bookingId={b.id}
  slug={business.slug}
  canManage={canSelfManage(b.startDateTime, business.selfServiceCutoffHours)}
  cutoffHours={business.selfServiceCutoffHours}
/>
```

con imports de `BookingActions` y `canSelfManage` (`@/lib/bookings/self-service`). El server calcula `canManage` (el server igual re-valida en la action — el prop es solo UI).

- [ ] **Step 5: PASS (incluye `tests/unit/mi-business-detail-page.test.tsx` existente — puede necesitar el campo nuevo en su mock del business) → Step 6: Commit**

```bash
git add "src/app/mi/[slug]/booking-actions.tsx" "src/app/mi/[slug]/page.tsx" tests/unit/mi-booking-actions.test.tsx tests/unit/mi-business-detail-page.test.tsx
git commit -m "feat(d1b): acciones cancelar/reprogramar en próximas reservas de /mi/[slug]"
```

---

### Task 10: UI — página de reprogramación `/mi/[slug]/reservas/[bookingId]/reprogramar`

**Files:**
- Create: `src/app/mi/[slug]/reservas/[bookingId]/reprogramar/page.tsx` (server: guards + datos)
- Create: `src/app/mi/[slug]/reservas/[bookingId]/reprogramar/reprogramar-form.tsx` (client: picker)
- Test: `tests/unit/mi-reprogramar-page.test.tsx`

El form replica el patrón del dashboard (`src/app/dashboard/bookings/[id]/reschedule/reschedule-form.tsx` — input date + grid de slots + resumen + submit) pero llamando `getMyRescheduleSlots`/`rescheduleMyBooking` y sin el bloque de WhatsApp de dueña. **No** intentes extraer un componente compartido con el form del dashboard en esta pasada: los dos forms difieren en datos, acciones y copy; la deduplicación del picker es candidata a /simplify si el diff lo amerita.

- [ ] **Step 1: Test de la page (server):**

1. Sin sesión → redirect a `/ingresar?next=/mi`.
2. Booking ajeno o fuera de ventana → renderiza `PageMessage` con el mensaje de política (usa `canSelfManage` con `selfServiceCutoffHours` del negocio), sin form.
3. Booking propio en ventana → renderiza el form con serviceName/fecha actual.

- [ ] **Step 2: FAIL → Step 3: page**

```tsx
// src/app/mi/[slug]/reservas/[bookingId]/reprogramar/page.tsx
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { canSelfManage, SELF_MANAGEABLE_STATUSES } from '@/lib/bookings/self-service'
import { PageMessage } from '@/components/ui/page-message'
import { ReprogramarForm } from './reprogramar-form'
import { formatInTimeZone } from 'date-fns-tz'

export default async function ReprogramarPage({ params }: {
  params: Promise<{ slug: string; bookingId: string }>
}) {
  const { slug, bookingId } = await params
  const user = await getCurrentUser()
  if (!user) redirect('/ingresar?next=/mi')

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, status: { in: [...SELF_MANAGEABLE_STATUSES] }, customer: { userId: user.id }, business: { slug } },
    select: {
      id: true, startDateTime: true,
      service: { select: { name: true } },
      business: { select: { slug: true, name: true, timezone: true, selfServiceCutoffHours: true } },
    },
  })
  if (!booking) notFound()

  const timezone = booking.business.timezone || 'America/Santiago'
  const cutoff = booking.business.selfServiceCutoffHours
  if (!canSelfManage(booking.startDateTime, cutoff)) {
    return (
      <PageMessage
        title="Ya no se puede reprogramar"
        message={cutoff === 0
          ? 'Esta reserva ya no se puede modificar.'
          : `Las reservas se pueden reprogramar hasta ${cutoff} horas antes. Contacta al negocio para cambios de último minuto.`}
      />
    )
  }

  return (
    <main className="mx-auto max-w-md pb-10">
      <h1 className="pt-6 text-center text-xl font-semibold">Reprogramar reserva</h1>
      <ReprogramarForm
        bookingId={booking.id}
        slug={booking.business.slug}
        serviceName={booking.service!.name}
        currentDate={formatInTimeZone(booking.startDateTime, timezone, 'yyyy-MM-dd')}
        currentTime={formatInTimeZone(booking.startDateTime, timezone, 'HH:mm')}
        timezone={timezone}
      />
    </main>
  )
}
```

- [ ] **Step 4: form cliente** — copiar la estructura de `reschedule-form.tsx` del dashboard (estado date/slots/selectedSlot, `useEffect` con `requestIdRef`/`ignoreRef` anti-carrera, grid de botones de hora, resumen del cambio) con estos cambios: `getAvailableSlotsForReschedule` → `getMyRescheduleSlots`; `rescheduleBooking` → `rescheduleMyBooking`; success = mensaje "Reserva reprogramada" + botón "Volver a mi cuenta" con `router.push('/mi/' + slug); router.refresh()`; sin props/bloque de WhatsApp ni "Cliente:"; copy en segunda persona ("Tu reserva actual: …").

- [ ] **Step 5: PASS → Step 6: Commit**

```bash
git add "src/app/mi/[slug]/reservas/[bookingId]/reprogramar/page.tsx" "src/app/mi/[slug]/reservas/[bookingId]/reprogramar/reprogramar-form.tsx" tests/unit/mi-reprogramar-page.test.tsx
git commit -m "feat(d1b): página de reprogramación self-service con picker de slots"
```

---

### Task 11: Tests de integración (CI-only)

**Files:**
- Create: `tests/integration/self-service-bookings.test.ts`

Seguir el esqueleto de `tests/integration/customer-account-link.test.ts` (setup/teardown de negocio+customer+user reales contra la DB de CI). Casos (spec §7):

- [ ] `cancelMyBooking` feliz: booking confirmado a 48h, cutoff 24 → status `cancelled`, redemption liberada si había (usar el helper de seed de promos si existe; si no, asertar solo status + que el Payment bt-declared pendiente quede `cancelled`).
- [ ] ownership ajeno (user distinto) → "Reserva no encontrada", booking intacto.
- [ ] fuera de ventana (booking a 2h, cutoff 24) → error, booking intacto.
- [ ] status `completed` → "Reserva no encontrada" (filtrado por where), intacto.
- [ ] `rescheduleMyBooking` feliz → startDateTime/endDateTime nuevos + nota `[REPROGRAMADA de …]`.
- [ ] doble-booking en reschedule: otro booking confirmado ocupando el slot destino → error de slot, booking intacto.
- [ ] cutoff 0 = sin límite: booking a 1h se puede cancelar.
- [ ] Gate CI: el archivo respeta el patrón de skip local que usen los demás integration tests (mirar cómo se saltan sin DATABASE_URL de CI).
- [ ] Commit: `git add tests/integration/self-service-bookings.test.ts && git commit -m "test(d1b): integración self-service cancel/reschedule"`

---

### Task 12: e2e (mimosnails, header bypass) — smoke de cancelación

**Files:**
- Modify: `tests/e2e/customer-account.spec.ts` (o archivo nuevo `tests/e2e/self-service.spec.ts` siguiendo su patrón)

Estrategia D1-a: identidad del platform admin como "clienta" (el guard de miembros impide usar a la dueña); runtime-skip si la fila User del admin no existe (mismo guard que ya usa `customer-account.spec.ts`).

- [ ] Flujo: (1) como dueña (bypass owner) crear Customer con el email del admin + booking manual confirmado a >48h (dentro de `bookingWindowDays`, landmine e2e conocida); (2) como admin visitar `/mi` (auto-link vía 1) → entrar al negocio → ver la reserva con acciones; (3) cancelar → confirmar que desaparece de próximas y aparece en historial como Cancelada.
- [ ] Respetar `test.setTimeout(90_000)` y el patrón de selectores por texto único (landmines e2e del proyecto).
- [ ] No es check requerido en CI; correr local con `npm run test:e2e -- self-service` (ajustar al script real) y pegar el resultado en el resumen del task.
- [ ] Commit.

---

### Task 13: Gate final

- [ ] Suite completa: `npm test` → verde (≈1390+ tests).
- [ ] `npx prisma generate && npx tsc --noEmit | grep '^src/'` → CERO errores nuevos vs `origin/main` (comparar con `git stash` si hay duda de cuáles son pre-existentes).
- [ ] `npx eslint` sobre todos los archivos tocados → limpio.
- [ ] `/simplify` sobre el diff de la rama (4 ángulos). Candidato conocido a evaluar: deduplicar el picker de slots entre `reschedule-form.tsx` (dashboard) y `reprogramar-form.tsx` (/mi).
- [ ] Code review experto (5 finders + verificación adversarial) — focos: (a) ¿alguna export de `my-bookings.ts` invocable sin auth real?, (b) ownership en el WHERE y no después, (c) ventana sobre horario actual y no el nuevo, (d) ninguna tx interactiva en `Promise.all`, (e) todos los `revalidateBusinessPublicPaths` con await.
- [ ] PR contra main (sin migración). Merge SOLO con OK explícito del usuario.

---

## Self-review (hecho al escribir el plan)

- **Cobertura del spec §5:** refactor `mutate.ts` (Tasks 2-3) ✓ · `cancelMyBooking`/`rescheduleMyBooking` (6-7) ✓ · `getMyBookings` — NO se crea: `/mi/[slug]/page.tsx` ya consulta próximas/historial server-side desde D1-a; una action de lectura extra sería un export público redundante (decisión: reutilizar la page) · ventana + setting + UI (1, 8, 9) ✓ · notificación a dueña (5) ✓ · picker de reprogramación (4, 10) ✓ · guard suspendido (7) ✓ · rate limits + revalidates (6-7) ✓.
- **Tipos consistentes entre tasks:** `canSelfManage(Date, number, Date?)` (T1 y usos en T6/7/9/10) · `cancelBookingInTx(tx, {id, internalNotes}, {reason?})` (T2 y T6) · `rescheduleBookingInTx(tx, {booking, newStartDateTime, durationMinutes, timezone, leadTimeMinutes?})` (T3 y T7) · `computeRescheduleSlots(booking, date)` (T4 y T7).
- **Sin placeholders:** los dos puntos donde el ejecutor debe mirar el código vecino (paths de imports en T4, patrón de mock de notificaciones en T5, register del form en T8) están marcados con instrucciones de verificación explícitas, no con TBD.
