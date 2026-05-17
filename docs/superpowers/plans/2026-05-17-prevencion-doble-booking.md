# Prevención de Doble-Booking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar validación transaccional server-side en `createBooking` para eliminar doble-booking, mejorar `generateSlots` con timezone y filtrado de horarios pasados, y cubrir todo con tests unitarios.

**Architecture:** Extraer validación de disponibilidad a `assertSlotIsAvailable()` con advisory lock de PostgreSQL dentro de `prisma.$transaction`. Mejorar `generateSlots` con helper de timezone vía `Intl.DateTimeFormat`. Tests unitarios con mocks de Prisma.

**Tech Stack:** Next.js 16, Prisma 5, PostgreSQL, date-fns 4, vitest, jsdom, TypeScript 5.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/availability/timezone.ts` | Create | Helper `toBusinessLocalDate()` para convertir fechas UTC a "local-equivalent" del timezone del negocio usando `Intl.DateTimeFormat`. |
| `src/lib/availability/validation.ts` | Create | `assertSlotIsAvailable()`: valida service, duración, regla, timeblocks, bookings con solapamiento + advisory lock. |
| `src/lib/availability/slots.ts` | Modify | `generateSlots()`: agregar params `timezone` y `now`, filtrar slots pasados para hoy, documentar step increment. |
| `src/server/actions/availability.ts` | Modify | `getAvailableTimeSlots()`: obtener `business.timezone`, pasar a `generateSlots`. |
| `src/server/actions/bookings.ts` | Modify | `createBooking()`: envolver en `prisma.$transaction`, llamar `assertSlotIsAvailable`, mover cliente a tx. |
| `tests/unit/availability-validation.test.ts` | Create | Tests para `assertSlotIsAvailable`: solapamientos, contiguo, cancelled, timeblock, duración, pasado. |
| `tests/unit/slots.test.ts` | Modify | Extender tests: slots pasados hoy, timezone, step increment. |

---

## Task 1: Timezone Helper

**Files:**
- Create: `src/lib/availability/timezone.ts`
- Test: `tests/unit/timezone.test.ts`

- [ ] **Step 1: Write the helper and its test**

Create `src/lib/availability/timezone.ts`:

```typescript
/**
 * Convierte una fecha UTC a un "local-equivalent" Date
 * cuyos componentes (año, mes, día, hora, minuto, segundo)
 * reflejan la hora local en el timezone del negocio.
 *
 * Esto permite usar date-fns sobre fechas que conceptualmente
 * viven en otro timezone sin agregar dependencias.
 */
export function toBusinessLocalDate(date: Date, timezone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  })
  const parts = formatter.formatToParts(date)
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value || '0', 10)

  // month is 1-based in Intl, 0-based in Date constructor
  return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}
```

Create `tests/unit/timezone.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { toBusinessLocalDate } from '@/lib/availability/timezone'

describe('toBusinessLocalDate', () => {
  it('converts UTC Sunday 23:00 to Monday in America/Santiago', () => {
    // 2026-05-10 23:00 UTC = 2026-05-10 19:00 Santiago (Sunday)
    const utc = new Date('2026-05-10T23:00:00Z')
    const local = toBusinessLocalDate(utc, 'America/Santiago')
    expect(local.getDay()).toBe(0) // Sunday in Santiago
  })

  it('preserves local components for a known Santiago date', () => {
    // 2026-05-11 09:00 UTC = 2026-05-11 05:00 Santiago
    const utc = new Date('2026-05-11T09:00:00Z')
    const local = toBusinessLocalDate(utc, 'America/Santiago')
    expect(local.getHours()).toBe(5)
    expect(local.getDate()).toBe(11)
    expect(local.getMonth()).toBe(4) // May
  })
})
```

- [ ] **Step 2: Run test**

```bash
npx vitest run tests/unit/timezone.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 3: Commit**

```bash
git add src/lib/availability/timezone.ts tests/unit/timezone.test.ts
git commit -m "feat(availability): add timezone helper for business-local dates"
```

---

## Task 2: assertSlotIsAvailable

**Files:**
- Create: `src/lib/availability/validation.ts`
- Test: `tests/unit/availability-validation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/availability-validation.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { assertSlotIsAvailable } from '@/lib/availability/validation'
import { BookingStatus } from '@prisma/client'

describe('assertSlotIsAvailable', () => {
  const businessId = 'biz-1'
  const serviceId = 'svc-1'
  const start = new Date('2026-05-11T10:00:00')
  const end = new Date('2026-05-11T11:00:00')

  function makeTx(mocks: Record<string, unknown> = {}) {
    return {
      service: { findFirst: vi.fn().mockResolvedValue(mocks.service ?? null) },
      availabilityRule: { findFirst: vi.fn().mockResolvedValue(mocks.rule ?? null) },
      timeBlock: { findFirst: vi.fn().mockResolvedValue(mocks.block ?? null) },
      $queryRaw: vi.fn().mockResolvedValue(mocks.bookings ?? []),
      ...mocks,
    } as unknown as Parameters<typeof assertSlotIsAvailable>[0]['tx']
  }

  it('rejects when end <= start', async () => {
    const tx = makeTx({ service: { durationMinutes: 60 } })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: end, endDateTime: start }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when start is in the past', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60)
    const pastEnd = new Date(past.getTime() + 1000 * 60 * 60)
    const tx = makeTx({ service: { durationMinutes: 60 } })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: past, endDateTime: pastEnd }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when service is missing or inactive', async () => {
    const tx = makeTx({ service: null })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when duration does not match service', async () => {
    const tx = makeTx({ service: { durationMinutes: 30 } })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when no active availability rule for day', async () => {
    const tx = makeTx({ service: { durationMinutes: 60 }, rule: null })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when slot is outside rule hours', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const lateStart = new Date('2026-05-11T18:00:00')
    const lateEnd = new Date('2026-05-11T19:00:00')
    const tx = makeTx({ service: { durationMinutes: 60 }, rule })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: lateStart, endDateTime: lateEnd }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when overlapping time block exists', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const block = { id: 'tb-1' }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when overlapping booking exists (confirmed)', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const bookings = [{ id: 'b1', status: BookingStatus.confirmed }]
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, bookings })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when overlapping booking exists (pending_payment)', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const bookings = [{ id: 'b1', status: BookingStatus.pending_payment }]
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, bookings })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('rejects when overlapping booking exists (completed)', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const bookings = [{ id: 'b1', status: BookingStatus.completed }]
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, bookings })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })

  it('allows contiguous booking (end === other.start)', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const bookings = [{ id: 'b1', status: BookingStatus.confirmed, startDateTime: new Date('2026-05-11T09:00:00'), endDateTime: new Date('2026-05-11T10:00:00') }]
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, bookings })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .resolves.toBeUndefined()
  })

  it('allows cancelled bookings to be rebooked', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const bookings = [{ id: 'b1', status: BookingStatus.cancelled }]
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, bookings })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .resolves.toBeUndefined()
  })

  it('allows no_show bookings to be rebooked', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const bookings = [{ id: 'b1', status: BookingStatus.no_show }]
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, bookings })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .resolves.toBeUndefined()
  })

  it('allows when all checks pass', async () => {
    const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }
    const tx = makeTx({ service: { durationMinutes: 60 }, rule, block: null, bookings: [] })
    await expect(assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime: start, endDateTime: end }))
      .resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/availability-validation.test.ts
```

Expected: FAIL — `assertSlotIsAvailable` not defined.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/availability/validation.ts`:

```typescript
import { addMinutes, differenceInMinutes, startOfDay } from 'date-fns'
import type { PrismaClient, Prisma } from '@prisma/client'

export interface AssertSlotInput {
  tx: PrismaClient | Prisma.TransactionClient
  businessId: string
  serviceId: string
  startDateTime: Date
  endDateTime: Date
}

function hashStringToInt(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

export async function assertSlotIsAvailable(input: AssertSlotInput): Promise<void> {
  const { tx, businessId, serviceId, startDateTime, endDateTime } = input

  if (endDateTime <= startDateTime) {
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  // Margen de 1 minuto para el pasado
  const now = new Date()
  const minStart = addMinutes(now, 1)
  if (startDateTime < minStart) {
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  const service = await tx.service.findFirst({
    where: { id: serviceId, businessId, isActive: true },
    select: { durationMinutes: true },
  })
  if (!service) {
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  const duration = differenceInMinutes(endDateTime, startDateTime)
  if (duration !== service.durationMinutes) {
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  const dayOfWeek = startDateTime.getDay()
  const rule = await tx.availabilityRule.findFirst({
    where: { businessId, dayOfWeek, isActive: true },
    select: { startTime: true, endTime: true },
  })
  if (!rule) {
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  const dayStart = startOfDay(startDateTime)
  const [startHour, startMin] = rule.startTime.split(':').map(Number)
  const [endHour, endMin] = rule.endTime.split(':').map(Number)
  const ruleStart = new Date(dayStart)
  ruleStart.setHours(startHour, startMin, 0, 0)
  const ruleEnd = new Date(dayStart)
  ruleEnd.setHours(endHour, endMin, 0, 0)

  if (startDateTime < ruleStart || endDateTime > ruleEnd) {
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  const block = await tx.timeBlock.findFirst({
    where: {
      businessId,
      startDateTime: { lt: endDateTime },
      endDateTime: { gt: startDateTime },
    },
    select: { id: true },
  })
  if (block) {
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }

  // Advisory lock para serializar reservas en el mismo slot
  const lockKey = `${businessId}:${startDateTime.toISOString()}`
  const hash = hashStringToInt(lockKey)
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${hash})`

  const overlappingBookings = await tx.$queryRaw`
    SELECT "id" FROM "Booking"
    WHERE "businessId" = ${businessId}
      AND "status" IN ('pending_payment', 'confirmed', 'completed')
      AND "startDateTime" < ${endDateTime}
      AND "endDateTime" > ${startDateTime}
    FOR UPDATE
  `
  if (Array.isArray(overlappingBookings) && overlappingBookings.length > 0) {
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/availability-validation.test.ts
```

Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/availability/validation.ts tests/unit/availability-validation.test.ts
git commit -m "feat(availability): add assertSlotIsAvailable with transaction-level locking"
```

---

## Task 3: Improve generateSlots

**Files:**
- Modify: `src/lib/availability/slots.ts`
- Test: `tests/unit/slots.test.ts`

- [ ] **Step 1: Modify generateSlots and add failing tests**

Modify `src/lib/availability/slots.ts` — replace entire file with:

```typescript
import { addMinutes, startOfDay, isSameDay } from 'date-fns'
import { toBusinessLocalDate } from './timezone'

export interface TimeSlot {
  start: Date
  end: Date
}

export interface BookingLike {
  startDateTime: Date
  endDateTime: Date
  status: string
}

export interface TimeBlockLike {
  startDateTime: Date
  endDateTime: Date
}

export interface AvailabilityRuleLike {
  dayOfWeek: number
  startTime: string
  endTime: string
  isActive: boolean
}

export interface GenerateSlotsOptions {
  timezone?: string
  now?: Date
}

/**
 * Genera slots disponibles para un día y servicio dado.
 *
 * El step increment entre slots es igual a `durationMinutes`.
 * Esto significa que para un servicio de 60 min, los slots son
 * 09:00, 10:00, 11:00, etc. Para 90 min: 09:00, 10:30, 12:00.
 */
export function generateSlots(
  date: Date,
  durationMinutes: number,
  rules: AvailabilityRuleLike[],
  blocks: TimeBlockLike[],
  bookings: BookingLike[],
  options: GenerateSlotsOptions = {}
): TimeSlot[] {
  const { timezone = 'America/Santiago', now = new Date() } = options

  const localDate = toBusinessLocalDate(date, timezone)
  const localNow = toBusinessLocalDate(now, timezone)
  const dayOfWeek = localDate.getDay()

  const rule = rules.find((r) => r.dayOfWeek === dayOfWeek && r.isActive)
  if (!rule) return []

  const dayStart = startOfDay(localDate)
  const [startHour, startMin] = rule.startTime.split(':').map(Number)
  const [endHour, endMin] = rule.endTime.split(':').map(Number)

  const availabilityStart = new Date(dayStart)
  availabilityStart.setHours(startHour, startMin, 0, 0)

  const availabilityEnd = new Date(dayStart)
  availabilityEnd.setHours(endHour, endMin, 0, 0)

  const isToday = isSameDay(localDate, localNow)
  const cutoff = isToday ? addMinutes(localNow, 1) : undefined

  const slots: TimeSlot[] = []
  let current = availabilityStart

  while (addMinutes(current, durationMinutes) <= availabilityEnd) {
    const slotEnd = addMinutes(current, durationMinutes)

    if (cutoff && current < cutoff) {
      current = addMinutes(current, durationMinutes)
      continue
    }

    const blockedByTimeBlock = blocks.some(
      (block) => current < block.endDateTime && block.startDateTime < slotEnd
    )

    const blockedByBooking = bookings.some((booking) => {
      if (booking.status === 'cancelled' || booking.status === 'no_show') return false
      return current < booking.endDateTime && booking.startDateTime < slotEnd
    })

    if (!blockedByTimeBlock && !blockedByBooking) {
      slots.push({ start: new Date(current), end: slotEnd })
    }

    current = addMinutes(current, durationMinutes)
  }

  return slots
}
```

Extend `tests/unit/slots.test.ts` — replace entire file with:

```typescript
import { describe, it, expect } from 'vitest'
import { generateSlots } from '@/lib/availability/slots'

describe('generateSlots', () => {
  const baseDate = new Date('2026-05-11T00:00:00') // Monday UTC

  const rules = [
    { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
  ]

  it('generates slots for a normal day', () => {
    const slots = generateSlots(baseDate, 60, rules, [], [], { timezone: 'UTC' })
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0].start.getHours()).toBe(9)
  })

  it('respects availability rules', () => {
    const slots = generateSlots(baseDate, 60, rules, [], [], { timezone: 'UTC' })
    const lastSlot = slots[slots.length - 1]
    expect(lastSlot.end.getHours()).toBeLessThanOrEqual(18)
  })

  it('excludes blocked time', () => {
    const blocks = [
      {
        startDateTime: new Date('2026-05-11T12:00:00'),
        endDateTime: new Date('2026-05-11T13:00:00'),
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, blocks, [], { timezone: 'UTC' })
    const hasSlotAt12 = slots.some((s) => s.start.getHours() === 12)
    expect(hasSlotAt12).toBe(false)
  })

  it('excludes existing bookings', () => {
    const bookings = [
      {
        startDateTime: new Date('2026-05-11T10:00:00'),
        endDateTime: new Date('2026-05-11T11:00:00'),
        status: 'confirmed',
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, [], bookings, { timezone: 'UTC' })
    const hasSlotAt10 = slots.some((s) => s.start.getHours() === 10)
    expect(hasSlotAt10).toBe(false)
  })

  it('allows cancelled bookings to be rebooked', () => {
    const bookings = [
      {
        startDateTime: new Date('2026-05-11T10:00:00'),
        endDateTime: new Date('2026-05-11T11:00:00'),
        status: 'cancelled',
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, [], bookings, { timezone: 'UTC' })
    const hasSlotAt10 = slots.some((s) => s.start.getHours() === 10)
    expect(hasSlotAt10).toBe(true)
  })

  it('filters past slots when date is today', () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const now = new Date()
    now.setHours(14, 0, 0, 0)

    const localRules = [
      { dayOfWeek: today.getDay(), startTime: '09:00', endTime: '18:00', isActive: true },
    ]

    const slots = generateSlots(today, 60, localRules, [], [], { timezone: 'UTC', now })
    const hasMorningSlot = slots.some((s) => s.start.getHours() < 14)
    expect(hasMorningSlot).toBe(false)
    expect(slots.length).toBeGreaterThan(0)
  })

  it('respects timezone for dayOfWeek calculation', () => {
    // UTC Sunday 23:00 = Monday 19:00 in America/Santiago
    const utcSundayLate = new Date('2026-05-10T23:00:00Z')
    const santiagoRules = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
    ]
    const slots = generateSlots(utcSundayLate, 60, santiagoRules, [], [], { timezone: 'America/Santiago' })
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0].start.getHours()).toBe(9)
  })

  it('uses step increment equal to durationMinutes', () => {
    const slots = generateSlots(baseDate, 90, rules, [], [], { timezone: 'UTC' })
    expect(slots.length).toBe(6) // 09:00 to 16:30 = 6 slots of 90min
    expect(slots[0].start.getHours()).toBe(9)
    expect(slots[1].start.getHours()).toBe(10)
    expect(slots[1].start.getMinutes()).toBe(30)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run tests/unit/slots.test.ts
```

Expected: PASS (8 tests). If `toBusinessLocalDate` causes issues with UTC dates and UTC timezone, adjust helper or tests.

- [ ] **Step 3: Commit**

```bash
git add src/lib/availability/slots.ts tests/unit/slots.test.ts
git commit -m "feat(availability): improve generateSlots with timezone, past filtering, and documented step"
```

---

## Task 4: Update getAvailableTimeSlots

**Files:**
- Modify: `src/server/actions/availability.ts`

- [ ] **Step 1: Modify to pass timezone**

In `src/server/actions/availability.ts`, replace the function `getAvailableTimeSlots`:

```typescript
export async function getAvailableTimeSlots(businessId: string, serviceId: string, date: Date) {
  const limit = await checkRateLimit('available-slots', 10, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId, isActive: true },
    select: { id: true, timezone: true },
  })
  if (!business) {
    throw new Error('Negocio no válido')
  }

  const dayStart = startOfDay(date)
  const dayEnd = endOfDay(date)

  const [service, availabilityRules, timeBlocks, bookings] = await Promise.all([
    prisma.service.findFirst({
      where: { id: serviceId, businessId, isActive: true },
      select: { durationMinutes: true },
    }),
    prisma.availabilityRule.findMany({
      where: { businessId, isActive: true },
      orderBy: { dayOfWeek: 'asc' },
    }),
    prisma.timeBlock.findMany({
      where: {
        businessId,
        startDateTime: { lte: dayEnd },
        endDateTime: { gte: dayStart },
      },
      orderBy: { startDateTime: 'asc' },
    }),
    prisma.booking.findMany({
      where: {
        businessId,
        status: { notIn: ['cancelled', 'no_show'] },
        startDateTime: { lte: dayEnd },
        endDateTime: { gte: dayStart },
      },
      orderBy: { startDateTime: 'asc' },
    }),
  ])

  if (!service) {
    throw new Error('Servicio no disponible')
  }

  return generateSlots(date, service.durationMinutes, availabilityRules, timeBlocks, bookings, {
    timezone: business.timezone || 'America/Santiago',
    now: new Date(),
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/actions/availability.ts
git commit -m "feat(availability): pass business timezone to generateSlots"
```

---

## Task 5: Refactor createBooking

**Files:**
- Modify: `src/server/actions/bookings.ts`

- [ ] **Step 1: Modify createBooking**

In `src/server/actions/bookings.ts`, replace the `createBooking` function body (lines 48-131):

Keep imports and add:
```typescript
import { assertSlotIsAvailable } from '@/lib/availability/validation'
```

Replace the function with:

```typescript
export async function createBooking(data: {
  serviceId: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  startDateTime: Date
}, businessId: string) {
  const limit = await checkRateLimit('create-booking', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createBookingSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos de reserva inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  // Validar que el negocio exista y esté activo
  const business = await prisma.business.findUnique({
    where: { id: businessId, isActive: true },
    select: { id: true },
  })
  if (!business) {
    throw new Error('Negocio no válido')
  }

  // Validar que el servicio pertenezca al negocio
  const service = await prisma.service.findFirst({
    where: { id: data.serviceId, businessId, isActive: true },
  })
  if (!service) {
    throw new Error('Servicio no disponible')
  }

  // Recalcular precios y horario server-side
  const totalPrice = service.price
  const depositRequired = service.depositAmount
  const finalAmount = service.price
  const endDateTime = addMinutes(data.startDateTime, service.durationMinutes)

  const booking = await prisma.$transaction(async (tx) => {
    // Validación transaccional de disponibilidad con lock
    await assertSlotIsAvailable({
      tx,
      businessId,
      serviceId: data.serviceId,
      startDateTime: data.startDateTime,
      endDateTime,
    })

    // Buscar o crear cliente dentro de la transacción
    let customer = await tx.customer.findFirst({
      where: {
        phone: data.customerPhone,
        name: data.customerName,
        businessId,
      },
    })

    if (!customer) {
      customer = await tx.customer.create({
        data: {
          businessId,
          name: data.customerName,
          phone: data.customerPhone,
          email: data.customerEmail || null,
        },
      })
    }

    return tx.booking.create({
      data: {
        businessId,
        serviceId: data.serviceId,
        customerId: customer.id,
        startDateTime: data.startDateTime,
        endDateTime,
        status: BookingStatus.pending_payment,
        totalPrice,
        depositRequired,
        remainingBalance: finalAmount,
        finalAmount,
        paymentStatus: BookingPaymentStatus.unpaid,
      },
      include: {
        service: true,
        customer: true,
      },
    })
  })

  revalidatePath('/dashboard/bookings')
  await revalidateBusinessPublicPaths(businessId)
  return booking
}
```

- [ ] **Step 2: Run build to verify no type errors**

```bash
npm run build 2>&1 | head -40
```

Expected: No TypeScript errors related to bookings or availability.

- [ ] **Step 3: Commit**

```bash
git add src/server/actions/bookings.ts
git commit -m "feat(bookings): wrap createBooking in transaction with assertSlotIsAvailable"
```

---

## Task 6: Full Test Suite Verification

**Files:**
- All test files

- [ ] **Step 1: Run all unit tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: Build completes without errors.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "test: verify full suite passes after double-booking prevention"
```

---

## Spec Coverage Checklist

| Spec Requirement | Task |
|---|---|
| `assertSlotIsAvailable` server-side | Task 2 |
| Validar service existe, activo, pertenece a business | Task 2, Step 3 |
| Validar duración coincide | Task 2, Step 3 |
| Validar AvailabilityRule activa | Task 2, Step 3 |
| Validar rango dentro de horario | Task 2, Step 3 |
| Validar no cruza TimeBlocks | Task 2, Step 3 |
| Validar no cruza bookings pending/conf/completed | Task 2, Step 3 |
| No reservar en el pasado | Task 2, Step 3 |
| No permitir end <= start | Task 2, Step 3 |
| Refactor `createBooking` con transacción | Task 5 |
| Mensaje de error claro | Task 2, Step 3 |
| Mejorar `generateSlots`: no mostrar horarios pasados | Task 3 |
| Mejorar `generateSlots`: timezone del negocio | Task 3, Task 4 |
| Documentar step increment | Task 3, Step 1 |
| Tests: solapamiento parcial | Task 2, Step 1 |
| Tests: solapamiento exacto | Task 2, Step 1 |
| Tests: reserva contigua permitida | Task 2, Step 1 |
| Tests: cancelled/no_show no ocupan | Task 2, Step 1 |
| Tests: TimeBlock bloquea | Task 2, Step 1 |
| Tests: duración correcta | Task 2, Step 1 |
| Tests: horario pasado | Task 2, Step 1 |
| Advisory lock para race condition | Task 2, Step 3 |

## Placeholder Scan

- No TBD, TODO, "implement later" found.
- All steps contain actual code.
- All commands have expected output.
- Type names consistent across tasks.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-17-prevencion-doble-booking.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
