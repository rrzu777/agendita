# Bloqueos de horario recurrentes (#1) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir crear bloqueos de horario recurrentes (semanal por días elegidos, fin forever/1 mes/N semanas), con saltar/editar ocurrencia individual o editar/eliminar la serie completa.

**Architecture:** Modelo expand-on-read (Google Calendar / RFC 5545). Se guarda la regla en `TimeBlockSeries` + excepciones en `TimeBlockException`; `TimeBlock` (bloqueos sueltos) no cambia. Una función pura `expandSeries` genera ocurrencias en tiempo de lectura; un helper `getEffectiveBlocks` une sueltos + ocurrencias y se enruta en los 4 sitios que hoy leen bloqueos. Sin materialización ni cron.

**Tech Stack:** Next.js (App Router, custom), Prisma/Postgres, date-fns + date-fns-tz, Zod, Vitest (unit + integration), React Server/Client Components, Radix Dialog.

**Spec:** `docs/superpowers/specs/2026-07-01-recurring-time-blocks-design.md`

**Landmines (NO negociable):**
- En archivos `'use server'` **solo** exportar funciones `async` (tipos/consts no-función crashean en runtime).
- `revalidateBusinessPublicPaths` **siempre** con `await` (sin await mata el proceso, exit 128).
- Tests de componentes client con `useRouter`: `vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))` antes de importar, o `renderToStaticMarkup` lanza "invariant expected app router to be mounted".

**Convenciones verificadas:**
- `daysOfWeek`: 0=domingo…6=sábado (igual que `getLocalDayOfWeek`, que hace `getISODay(zoned) % 7`).
- Comparar "qué día es" por string local `yyyy-MM-dd` (`getLocalDateStr`), nunca por instante UTC crudo.
- Componer instantes con `fromZonedTime(\`${localDateStr} ${HH:mm}\`, timezone)` (DST-safe).
- Tests: `npm run test:unit` (vitest), `npm run test:integration` (necesita DB de test; usa `requireTestDatabase()`).

---

## Task 1: Schema — TimeBlockSeries + TimeBlockException

**Files:**
- Modify: `prisma/schema.prisma` (modelo `Business` ~línea 29-48; añadir dos modelos tras `TimeBlock`, línea 268)

- [ ] **Step 1: Añadir relaciones al modelo `Business`**

En el bloque `model Business { ... }`, junto a `timeBlocks TimeBlock[]` (línea 32), añadir:

```prisma
  timeBlockSeries      TimeBlockSeries[]
```

- [ ] **Step 2: Añadir los dos modelos nuevos**

Tras el cierre de `model TimeBlock { ... }` (línea 268), añadir:

```prisma
model TimeBlockSeries {
  id          String   @id @default(cuid())
  businessId  String
  daysOfWeek  Int[]
  startTime   String
  endTime     String
  reason      String?
  anchorDate  DateTime
  until       DateTime?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())

  business    Business             @relation(fields: [businessId], references: [id], onDelete: Cascade)
  exceptions  TimeBlockException[]

  @@index([businessId, isActive])
}

model TimeBlockException {
  id             String    @id @default(cuid())
  seriesId       String
  occurrenceDate DateTime
  isSkipped      Boolean   @default(false)
  startDateTime  DateTime?
  endDateTime    DateTime?
  reason         String?

  series         TimeBlockSeries @relation(fields: [seriesId], references: [id], onDelete: Cascade)

  @@unique([seriesId, occurrenceDate])
}
```

- [ ] **Step 3: Validar y crear la migración**

Run: `npx prisma validate && npx prisma migrate dev --name recurring_time_blocks`
Expected: "The migration ... has been applied" y `prisma generate` regenera el client sin errores.

- [ ] **Step 4: Verificar que compila**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: el mismo baseline de errores que antes de empezar (los tipos nuevos no añaden errores). Anota el baseline al inicio.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(#1): schema TimeBlockSeries + TimeBlockException"
```

---

## Task 2: `expandSeries` — función pura de expansión

**Files:**
- Create: `src/lib/calendar/expand-series.ts`
- Test: `tests/unit/expand-series.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect } from 'vitest'
import { expandSeries, type SeriesLike } from '@/lib/calendar/expand-series'

const TZ = 'America/Santiago'

// Almuerzo 13:00-14:00, Lun(1)-Jue(4), ancla lunes 2026-06-01, forever.
const base: SeriesLike = {
  id: 'series-1',
  daysOfWeek: [1, 2, 3, 4],
  startTime: '13:00',
  endTime: '14:00',
  reason: 'Almuerzo',
  anchorDate: new Date('2026-06-01T04:00:00.000Z'), // 2026-06-01 00:00 local
  until: null,
}

function range(startLocal: string, endLocal: string) {
  // instantes UTC que cubren [startLocal 00:00, endLocal 23:59] en TZ
  return {
    start: new Date(`${startLocal}T00:00:00-04:00`),
    end: new Date(`${endLocal}T23:59:59-04:00`),
  }
}

describe('expandSeries', () => {
  it('genera una ocurrencia por cada día de la semana en daysOfWeek dentro del rango', () => {
    const { start, end } = range('2026-06-01', '2026-06-07') // Lun a Dom
    const occ = expandSeries(base, [], start, end, TZ)
    // Lun 1, Mar 2, Mié 3, Jue 4 -> 4 ocurrencias (Vie/Sáb/Dom excluidos)
    expect(occ).toHaveLength(4)
    expect(occ[0].id).toBe('series-1:2026-06-01')
    expect(occ[0].reason).toBe('Almuerzo')
  })

  it('compone las horas en el timezone del negocio (13:00 local = 17:00Z)', () => {
    const { start, end } = range('2026-06-01', '2026-06-01')
    const [occ] = expandSeries(base, [], start, end, TZ)
    expect(occ.startDateTime.toISOString()).toBe('2026-06-01T17:00:00.000Z')
    expect(occ.endDateTime.toISOString()).toBe('2026-06-01T18:00:00.000Z')
  })

  it('excluye días anteriores al anchorDate', () => {
    const { start, end } = range('2026-05-25', '2026-06-02') // ancla es 06-01
    const occ = expandSeries(base, [], start, end, TZ)
    expect(occ.every((o) => o.id >= 'series-1:2026-06-01')).toBe(true)
    expect(occ.find((o) => o.id === 'series-1:2026-05-26')).toBeUndefined()
  })

  it('respeta until (excluye días estrictamente posteriores)', () => {
    const withUntil: SeriesLike = { ...base, until: new Date('2026-06-02T04:00:00.000Z') } // hasta 06-02
    const { start, end } = range('2026-06-01', '2026-06-30')
    const occ = expandSeries(withUntil, [], start, end, TZ)
    expect(occ.map((o) => o.id)).toEqual(['series-1:2026-06-01', 'series-1:2026-06-02'])
  })

  it('omite una ocurrencia con excepción isSkipped', () => {
    const { start, end } = range('2026-06-01', '2026-06-04')
    const occ = expandSeries(
      base,
      [{ occurrenceDate: new Date('2026-06-02T04:00:00.000Z'), isSkipped: true, startDateTime: null, endDateTime: null, reason: null }],
      start,
      end,
      TZ,
    )
    expect(occ.map((o) => o.id)).toEqual(['series-1:2026-06-01', 'series-1:2026-06-03', 'series-1:2026-06-04'])
  })

  it('aplica un override de hora/motivo a la ocurrencia', () => {
    const { start, end } = range('2026-06-01', '2026-06-01')
    const [occ] = expandSeries(
      base,
      [{
        occurrenceDate: new Date('2026-06-01T04:00:00.000Z'),
        isSkipped: false,
        startDateTime: new Date('2026-06-01T18:00:00.000Z'), // 14:00 local
        endDateTime: new Date('2026-06-01T19:00:00.000Z'),
        reason: 'Almuerzo tardío',
      }],
      start, end, TZ,
    )
    expect(occ.startDateTime.toISOString()).toBe('2026-06-01T18:00:00.000Z')
    expect(occ.reason).toBe('Almuerzo tardío')
  })

  it('acota la expansión a MAX_EXPANSION_DAYS aunque el rango sea enorme', () => {
    const { start } = range('2026-06-01', '2026-06-01')
    const end = new Date('2035-01-01T00:00:00.000Z') // ~9 años
    const occ = expandSeries(base, [], start, end, TZ)
    // no explota; devuelve una cantidad acotada
    expect(occ.length).toBeLessThan(365)
  })

  it('compone la hora correctamente cruzando la transición DST de Chile', () => {
    // Chile pasa a horario de verano (UTC-3) en septiembre. El lunes 2026-09-07
    // ya es DST -> 13:00 local = 16:00Z (en junio, UTC-4, sería 17:00Z).
    const start = new Date('2026-09-07T00:00:00-03:00')
    const end = new Date('2026-09-07T23:59:59-03:00')
    const [occ] = expandSeries(base, [], start, end, TZ)
    expect(occ.startDateTime.toISOString()).toBe('2026-09-07T16:00:00.000Z')
    expect(occ.endDateTime.toISOString()).toBe('2026-09-07T17:00:00.000Z')
  })
})
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npm run test:unit -- expand-series`
Expected: FAIL — "Cannot find module '@/lib/calendar/expand-series'".

- [ ] **Step 3: Implementar `expand-series.ts`**

```ts
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { addDays, getISODay, parseISO } from 'date-fns'

export interface SeriesLike {
  id: string
  daysOfWeek: number[]
  startTime: string
  endTime: string
  reason: string | null
  anchorDate: Date
  until: Date | null
}

export interface ExceptionLike {
  occurrenceDate: Date
  isSkipped: boolean
  startDateTime: Date | null
  endDateTime: Date | null
  reason: string | null
}

export interface EffectiveBlock {
  id: string
  startDateTime: Date
  endDateTime: Date
  reason: string | null
  seriesId?: string
  occurrenceDate?: Date
}

/** Tope de días que expande una serie de una sola pasada (evita rangos patológicos). */
export const MAX_EXPANSION_DAYS = 366

function localDateStr(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd')
}

/** Día de la semana (0=dom…6=sáb) de una fecha local yyyy-MM-dd. */
function dayOfWeekOfLocalDate(dateStr: string): number {
  return getISODay(parseISO(`${dateStr}T00:00:00Z`)) % 7
}

/** Siguiente fecha local yyyy-MM-dd (aritmética segura a mediodía UTC). */
function nextLocalDate(dateStr: string): string {
  return formatInTimeZone(addDays(parseISO(`${dateStr}T12:00:00Z`), 1), 'UTC', 'yyyy-MM-dd')
}

export function expandSeries(
  series: SeriesLike,
  exceptions: ExceptionLike[],
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
): EffectiveBlock[] {
  const anchorStr = localDateStr(series.anchorDate, timezone)
  const untilStr = series.until ? localDateStr(series.until, timezone) : null

  const exceptionByDate = new Map<string, ExceptionLike>()
  for (const exc of exceptions) {
    exceptionByDate.set(localDateStr(exc.occurrenceDate, timezone), exc)
  }

  const startStr = localDateStr(rangeStart, timezone)
  const endStr = localDateStr(rangeEnd, timezone)

  const result: EffectiveBlock[] = []
  let cursor = startStr
  let guard = 0

  while (cursor <= endStr && guard < MAX_EXPANSION_DAYS) {
    guard++
    const dow = dayOfWeekOfLocalDate(cursor)
    const inRule =
      series.daysOfWeek.includes(dow) &&
      cursor >= anchorStr &&
      (untilStr === null || cursor <= untilStr)

    if (inRule) {
      const exc = exceptionByDate.get(cursor)
      if (!exc?.isSkipped) {
        const start = exc?.startDateTime ?? fromZonedTime(`${cursor} ${series.startTime}`, timezone)
        const end = exc?.endDateTime ?? fromZonedTime(`${cursor} ${series.endTime}`, timezone)
        const reason = exc ? exc.reason : series.reason
        result.push({
          id: `${series.id}:${cursor}`,
          startDateTime: start,
          endDateTime: end,
          reason,
          seriesId: series.id,
          occurrenceDate: fromZonedTime(`${cursor} 00:00:00`, timezone),
        })
      }
    }
    cursor = nextLocalDate(cursor)
  }

  return result
}
```

- [ ] **Step 4: Correr para ver que pasa**

Run: `npm run test:unit -- expand-series`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/expand-series.ts tests/unit/expand-series.test.ts
git commit -m "feat(#1): expandSeries pure occurrence generator"
```

---

## Task 3: `computeSeriesUntil` — cálculo de fin de serie

**Files:**
- Modify: `src/lib/calendar/expand-series.ts`
- Test: `tests/unit/expand-series.test.ts` (añadir describe)

- [ ] **Step 1: Añadir tests que fallan**

Añadir al final de `tests/unit/expand-series.test.ts`:

```ts
import { computeSeriesUntil } from '@/lib/calendar/expand-series'

describe('computeSeriesUntil', () => {
  const anchor = new Date('2026-06-01T04:00:00.000Z') // 2026-06-01 local America/Santiago

  it('forever -> null', () => {
    expect(computeSeriesUntil(anchor, 'forever', null, 'America/Santiago')).toBeNull()
  })

  it('month -> mismo día un mes después (local)', () => {
    const until = computeSeriesUntil(anchor, 'month', null, 'America/Santiago')
    expect(formatUntil(until)).toBe('2026-07-01')
  })

  it('weeks -> anchor + N semanas (local)', () => {
    const until = computeSeriesUntil(anchor, 'weeks', 3, 'America/Santiago')
    expect(formatUntil(until)).toBe('2026-06-22')
  })
})

function formatUntil(d: Date | null): string {
  if (!d) return 'null'
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npm run test:unit -- expand-series`
Expected: FAIL — "computeSeriesUntil is not a function".

- [ ] **Step 3: Implementar en `expand-series.ts`**

Añadir imports `addMonths, addWeeks` a la línea de `date-fns` y añadir:

```ts
export type SeriesEndMode = 'forever' | 'month' | 'weeks'

/**
 * Calcula el instante `until` (último día incluido, 00:00 local) a partir del
 * modo de fin. `forever` -> null. `weeks` usa `weeks` (>=1).
 */
export function computeSeriesUntil(
  anchorDate: Date,
  mode: SeriesEndMode,
  weeks: number | null,
  timezone: string,
): Date | null {
  if (mode === 'forever') return null
  const anchorStr = formatInTimeZone(anchorDate, timezone, 'yyyy-MM-dd')
  const anchorNoon = parseISO(`${anchorStr}T12:00:00Z`)
  const lastNoon = mode === 'month' ? addMonths(anchorNoon, 1) : addWeeks(anchorNoon, Math.max(1, weeks ?? 1))
  const lastStr = formatInTimeZone(lastNoon, 'UTC', 'yyyy-MM-dd')
  return fromZonedTime(`${lastStr} 00:00:00`, timezone)
}
```

- [ ] **Step 4: Correr para ver que pasa**

Run: `npm run test:unit -- expand-series`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/expand-series.ts tests/unit/expand-series.test.ts
git commit -m "feat(#1): computeSeriesUntil helper"
```

---

## Task 4: `getEffectiveBlocks` — unión sueltos + ocurrencias

**Files:**
- Create: `src/lib/availability/effective-blocks.ts`
- Test: `tests/integration/effective-blocks.test.ts`

- [ ] **Step 1: Escribir test de integración que falla**

```ts
import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { requireTestDatabase } from './setup'
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'

requireTestDatabase()

describe('getEffectiveBlocks', () => {
  let prisma: PrismaClient
  const businessId = 'eb-biz-1'
  const TZ = 'America/Santiago'

  beforeAll(async () => {
    // Reloj fijo un viernes; el lunes 2026-06-01 queda en el futuro y dentro de
    // la ventana de reserva (necesario para los tests de slots/validación de
    // Tasks 5 y 6, que usan `new Date()` real vía lead-time/booking-window).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-29T12:00:00Z'))
    prisma = new PrismaClient()
    await prisma.timeBlockException.deleteMany()
    await prisma.timeBlockSeries.deleteMany()
    await prisma.timeBlock.deleteMany()
    await prisma.businessUser.deleteMany()
    await prisma.business.deleteMany()
    await prisma.user.deleteMany()

    const user = await prisma.user.create({ data: { id: 'eb-u1', email: 'eb@t.test', name: 'EB' } })
    await prisma.business.create({
      data: { id: businessId, name: 'EB', slug: 'eb', subdomain: 'eb', ownerUserId: user.id, city: 'Santiago', country: 'CL', currency: 'CLP', timezone: TZ, bookingWindowDays: 90 },
    })
    // suelto: 2026-06-05 10:00-11:00 local
    await prisma.timeBlock.create({
      data: { businessId, startDateTime: new Date('2026-06-05T14:00:00Z'), endDateTime: new Date('2026-06-05T15:00:00Z'), reason: 'Suelto' },
    })
    // serie almuerzo Lun-Jue 13:00-14:00 forever, ancla 2026-06-01
    await prisma.timeBlockSeries.create({
      data: { businessId, daysOfWeek: [1, 2, 3, 4], startTime: '13:00', endTime: '14:00', reason: 'Almuerzo', anchorDate: new Date('2026-06-01T04:00:00Z'), until: null },
    })
  })

  afterAll(async () => { await prisma.$disconnect(); vi.useRealTimers() })

  it('une bloqueos sueltos + ocurrencias expandidas de la serie', async () => {
    const start = new Date('2026-06-01T00:00:00-04:00')
    const end = new Date('2026-06-05T23:59:59-04:00')
    const blocks = await getEffectiveBlocks(businessId, start, end, TZ)
    const reasons = blocks.map((b) => b.reason).sort()
    // 4 almuerzos (Lun-Jue) + 1 suelto (viernes)
    expect(blocks).toHaveLength(5)
    expect(reasons.filter((r) => r === 'Almuerzo')).toHaveLength(4)
    expect(reasons.filter((r) => r === 'Suelto')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npm run test:integration -- effective-blocks`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Implementar `effective-blocks.ts`**

```ts
import { prisma } from '@/lib/db'
import { expandSeries, type EffectiveBlock } from '@/lib/calendar/expand-series'

export type { EffectiveBlock } from '@/lib/calendar/expand-series'

/**
 * Devuelve los bloqueos efectivos (sueltos + ocurrencias de series activas)
 * que solapan el rango [rangeStart, rangeEnd]. Forma compatible con los
 * consumidores existentes: { startDateTime, endDateTime, reason }.
 */
export async function getEffectiveBlocks(
  businessId: string,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
): Promise<EffectiveBlock[]> {
  const [oneOff, series] = await Promise.all([
    prisma.timeBlock.findMany({
      where: { businessId, startDateTime: { lte: rangeEnd }, endDateTime: { gte: rangeStart } },
      orderBy: { startDateTime: 'asc' },
    }),
    prisma.timeBlockSeries.findMany({
      where: {
        businessId,
        isActive: true,
        anchorDate: { lte: rangeEnd },
        OR: [{ until: null }, { until: { gte: rangeStart } }],
      },
      include: { exceptions: true },
    }),
  ])

  const blocks: EffectiveBlock[] = oneOff.map((b) => ({
    id: b.id,
    startDateTime: b.startDateTime,
    endDateTime: b.endDateTime,
    reason: b.reason,
  }))

  for (const s of series) {
    blocks.push(...expandSeries(s, s.exceptions, rangeStart, rangeEnd, timezone))
  }

  return blocks
}
```

- [ ] **Step 4: Correr para ver que pasa**

Run: `npm run test:integration -- effective-blocks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/availability/effective-blocks.ts tests/integration/effective-blocks.test.ts
git commit -m "feat(#1): getEffectiveBlocks union helper"
```

---

## Task 5: Enrutar disponibilidad pública por `getEffectiveBlocks`

**Files:**
- Modify: `src/server/actions/availability.ts` (dos `prisma.timeBlock.findMany`, líneas 62-69 y 129-136)
- Test: `tests/integration/effective-blocks.test.ts` (añadir caso de slots)

- [ ] **Step 1: Añadir test que falla (una serie recurrente bloquea un slot público)**

Añadir un `it` que llame a `getAvailableTimeSlots` para un día con almuerzo recurrente y verifique que el slot 13:00 NO aparece. Reutiliza el `businessId`/serie del describe; crea una `availabilityRule` 09:00-18:00 para ese día de semana y un `service` de 60 min. Assert: ningún slot tiene `start` == `2026-06-01T17:00:00Z` (13:00 local).

```ts
it('un almuerzo recurrente bloquea el slot correspondiente en getAvailableTimeSlots', async () => {
  const { getAvailableTimeSlots } = await import('@/server/actions/availability')
  await prisma.availabilityRule.deleteMany({ where: { businessId } })
  await prisma.availabilityRule.create({ data: { businessId, dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true } })
  const svc = await prisma.service.create({ data: { businessId, name: 'Corte', durationMinutes: 60, price: 10000, isActive: true } })
  const slots = await getAvailableTimeSlots(businessId, svc.id, new Date('2026-06-01T15:00:00Z'))
  expect(slots.some((s) => s.start.toISOString() === '2026-06-01T17:00:00.000Z')).toBe(false)
})
```

> Nota: `getAvailableTimeSlots` usa `new Date()` real vía lead-time/ventana. El `vi.setSystemTime(2026-05-29)` del `beforeAll` (Task 4) fija "ahora" un viernes, así que el lunes 2026-06-01 queda futuro y dentro de la ventana. Si `checkRateLimit` interfiere (backend redis no configurado en test), añade `vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true }) }))` al inicio del archivo.

- [ ] **Step 2: Correr para ver que falla**

Run: `npm run test:integration -- effective-blocks`
Expected: FAIL — el slot 13:00 sí aparece (aún no se enruta por series).

- [ ] **Step 3: Modificar `availability.ts`**

Añadir import al inicio (tras la línea 9):

```ts
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'
```

Reemplazar, en `getAvailableTimeSlots`, el elemento `prisma.timeBlock.findMany({...})` (líneas 62-69) del `Promise.all` por:

```ts
    getEffectiveBlocks(businessId, dayStart, dayEnd, timezone),
```

Reemplazar, en `getAvailableSlotsForReschedule`, el `prisma.timeBlock.findMany({...})` (líneas 129-136) por:

```ts
    getEffectiveBlocks(businessId, dayStart, dayEnd, timezone),
```

(`timeBlocks` resultante ya tiene forma `{ startDateTime, endDateTime, reason }`, compatible con `generateSlots`/`TimeBlockLike`.)

- [ ] **Step 4: Correr para ver que pasa**

Run: `npm run test:integration -- effective-blocks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/availability.ts tests/integration/effective-blocks.test.ts
git commit -m "feat(#1): route public availability through getEffectiveBlocks"
```

---

## Task 6: Enrutar la validación anti-doble-reserva por expansión en memoria

**Files:**
- Modify: `src/lib/availability/validation.ts` (bloque `const block = await tx.timeBlock.findFirst(...)`, líneas 99-110)
- Test: `tests/integration/effective-blocks.test.ts` (caso validación)

- [ ] **Step 1: Añadir test que falla (reservar dentro de una ocurrencia recurrente se rechaza; saltarla lo libera)**

```ts
it('assertSlotIsAvailable rechaza un slot dentro de una ocurrencia recurrente y lo libera al saltarla', async () => {
  const { assertSlotIsAvailable } = await import('@/lib/availability/validation')
  // Requisitos para llegar al chequeo de bloqueo: regla de disponibilidad que
  // cubra el horario y un servicio real de 60 min (mismo día de semana, lunes=1).
  await prisma.availabilityRule.deleteMany({ where: { businessId } })
  await prisma.availabilityRule.create({ data: { businessId, dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true } })
  const svc = await prisma.service.create({ data: { businessId, name: 'Corte V', durationMinutes: 60, price: 10000, isActive: true } })
  const series = await prisma.timeBlockSeries.findFirstOrThrow({ where: { businessId } })

  const start = new Date('2026-06-01T17:00:00Z') // 13:00 local, lunes (en daysOfWeek [1..4])
  const end = new Date('2026-06-01T18:00:00Z')
  const input = { businessId, serviceId: svc.id, startDateTime: start, endDateTime: end, timezone: TZ }

  // Antes de saltar: rechaza por solapar con la ocurrencia recurrente.
  await expect(
    prisma.$transaction((tx) => assertSlotIsAvailable({ tx, ...input })),
  ).rejects.toThrow()

  // Saltar esa ocurrencia la libera: ya no hay bloqueo ni reservas -> resuelve.
  await prisma.timeBlockException.create({ data: { seriesId: series.id, occurrenceDate: new Date('2026-06-01T04:00:00Z'), isSkipped: true } })
  await expect(
    prisma.$transaction((tx) => assertSlotIsAvailable({ tx, ...input })),
  ).resolves.toBeUndefined()
})
```

> `AssertSlotInput = { tx, businessId, serviceId, startDateTime, endDateTime, timezone, excludeBookingId? }`. El reloj fijo (2026-05-29) del `beforeAll` mantiene el lunes 2026-06-01 dentro de lead-time/ventana. Este `it` vive en el mismo `describe` que Tasks 4/5; ejecútalo después del de slots (o resetea `availabilityRule`/`service` como ya hace).

- [ ] **Step 2: Correr para ver que falla**

Run: `npm run test:integration -- effective-blocks`
Expected: FAIL — la validación aún no expande series, no rechaza.

- [ ] **Step 3: Modificar `validation.ts`**

Añadir import (junto a los demás, arriba del archivo):

```ts
import { expandSeries } from '@/lib/calendar/expand-series'
```

Reemplazar el bloque de líneas 99-110:

```ts
  const block = await tx.timeBlock.findFirst({
    where: {
      businessId,
      startDateTime: { lt: endDateTime },
      endDateTime: { gt: startDateTime },
    },
    select: { id: true },
  })
  if (block) {
    logEvent('slot_validation_rejected', { businessId, reason: 'timeblock_overlap' })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }
```

por:

```ts
  const [oneOffBlock, blockSeries] = await Promise.all([
    tx.timeBlock.findFirst({
      where: { businessId, startDateTime: { lt: endDateTime }, endDateTime: { gt: startDateTime } },
      select: { id: true },
    }),
    tx.timeBlockSeries.findMany({
      where: {
        businessId,
        isActive: true,
        anchorDate: { lte: endDateTime },
        OR: [{ until: null }, { until: { gte: startDateTime } }],
      },
      include: { exceptions: true },
    }),
  ])

  // El chequeo de bloqueo corre ANTES del advisory lock; expandir las series en
  // memoria aquí no pierde ninguna garantía de concurrencia (esta protege
  // booking-vs-booking, no bloqueos).
  const blockedBySeries = blockSeries.some((s) =>
    expandSeries(s, s.exceptions, startDateTime, endDateTime, timezone).some(
      (occ) => occ.startDateTime < endDateTime && startDateTime < occ.endDateTime,
    ),
  )

  if (oneOffBlock || blockedBySeries) {
    logEvent('slot_validation_rejected', { businessId, reason: 'timeblock_overlap' })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }
```

(`timezone` ya está disponible en el scope de la función — se usa en línea 78.)

- [ ] **Step 4: Correr para ver que pasa**

Run: `npm run test:integration -- effective-blocks && npm run test:unit -- availability-validation`
Expected: PASS (nuevo caso + no-regresión de validación existente).

- [ ] **Step 5: Commit**

```bash
git add src/lib/availability/validation.ts tests/integration/effective-blocks.test.ts
git commit -m "feat(#1): expand series in booking validation block check"
```

---

## Task 7: Enrutar el calendario del dashboard por `getEffectiveBlocks`

**Files:**
- Modify: `src/server/actions/time-blocks.ts` (`getTimeBlocksByRange`, líneas 92-111)
- Test: `tests/integration/effective-blocks.test.ts` (caso calendario)

- [ ] **Step 1: Añadir test que falla**

`getTimeBlocksByRange` requiere `requireBusiness()` (sesión). En integración es difícil de mockear; en su lugar, testea la forma de salida vía `getEffectiveBlocks` ya cubierta en Task 4, y añade aquí un test unitario ligero que verifique que las ocurrencias traen `seriesId` y `occurrenceDate` (para que el calendario pueda rutear al diálogo de serie):

Añadir a `tests/unit/expand-series.test.ts`:

```ts
it('las ocurrencias exponen seriesId y occurrenceDate para ruteo en UI', () => {
  const { start, end } = range('2026-06-01', '2026-06-01')
  const [occ] = expandSeries(base, [], start, end, 'America/Santiago')
  expect(occ.seriesId).toBe('series-1')
  expect(occ.occurrenceDate?.toISOString()).toBe('2026-06-01T04:00:00.000Z')
})
```

- [ ] **Step 2: Correr para ver que falla/pasa**

Run: `npm run test:unit -- expand-series`
Expected: PASS (ya implementado en Task 2; este test fija el contrato para la UI).

- [ ] **Step 3: Modificar `getTimeBlocksByRange`**

En `src/server/actions/time-blocks.ts`, añadir imports:

```ts
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'
```

Reemplazar el cuerpo de `getTimeBlocksByRange` (líneas 100-110, el `return prisma.timeBlock.findMany({...})`) por:

```ts
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } })
  const timezone = business?.timezone || 'America/Santiago'
  return getEffectiveBlocks(businessId, start, end, timezone)
```

(La validación de rango previa —líneas 94-99— se mantiene. `requireBusiness()` sigue devolviendo `businessId`.)

- [ ] **Step 4: Verificar tipos y unit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` (baseline) y `npm run test:unit -- expand-series`
Expected: baseline sin nuevos errores; PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/time-blocks.ts tests/unit/expand-series.test.ts
git commit -m "feat(#1): route dashboard calendar through getEffectiveBlocks"
```

---

## Task 8: Acción `createTimeBlockSeries` + aviso de solape

**Files:**
- Modify: `src/server/actions/time-blocks.ts`
- Test: `tests/integration/time-block-series.test.ts`

- [ ] **Step 1: Escribir test de integración que falla**

```ts
import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: async () => ({ businessId: 'tbs-biz-1' }),
  requireBusinessRole: async () => ({ businessId: 'tbs-biz-1' }),
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true }) }))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: async () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

describe('createTimeBlockSeries', () => {
  let prisma: PrismaClient
  const businessId = 'tbs-biz-1'

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.timeBlockException.deleteMany()
    await prisma.timeBlockSeries.deleteMany()
    await prisma.timeBlock.deleteMany()
    await prisma.businessUser.deleteMany()
    await prisma.business.deleteMany()
    await prisma.user.deleteMany()
    const u = await prisma.user.create({ data: { id: 'tbs-u1', email: 'tbs@t.test', name: 'T' } })
    await prisma.business.create({ data: { id: businessId, name: 'T', slug: 'tbs', subdomain: 'tbs', ownerUserId: u.id, city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90 } })
  })
  afterAll(async () => { await prisma.$disconnect() })

  it('crea una serie con until calculado para "weeks" y devuelve overlaps vacíos', async () => {
    const { createTimeBlockSeries } = await import('@/server/actions/time-blocks')
    const res = await createTimeBlockSeries({
      daysOfWeek: [1, 2, 3, 4], startTime: '13:00', endTime: '14:00', reason: 'Almuerzo',
      anchorDate: new Date('2026-06-01T04:00:00Z'), endMode: 'weeks', weeks: 3,
    })
    expect('series' in res).toBe(true)
    if ('series' in res) {
      expect(res.series.until).not.toBeNull()
      expect(res.overlappingDates).toEqual([])
    }
    const count = await prisma.timeBlockSeries.count({ where: { businessId } })
    expect(count).toBe(1)
  })
})
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npm run test:integration -- time-block-series`
Expected: FAIL — `createTimeBlockSeries` no existe.

- [ ] **Step 3: Implementar la acción**

En `src/server/actions/time-blocks.ts`, añadir imports:

```ts
import { computeSeriesUntil, expandSeries, type SeriesEndMode } from '@/lib/calendar/expand-series'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
```

Y ampliar el import existente de `date-fns` (línea 10) para incluir `addDays` (lo usa el split de Task 10):

```ts
import { differenceInMilliseconds, addDays } from 'date-fns'
```

Añadir la acción (todas exportadas son `async` — respeta el límite `'use server'`):

```ts
const createSeriesSchema = z.object({
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, 'Selecciona al menos un día'),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  reason: z.string().max(255).optional().nullable(),
  anchorDate: z.date(),
  endMode: z.enum(['forever', 'month', 'weeks']),
  weeks: z.number().int().min(1).max(52).optional().nullable(),
}).refine((d) => d.endTime > d.startTime, { message: 'La hora de fin debe ser posterior a la de inicio' })

export async function createTimeBlockSeries(data: {
  daysOfWeek: number[]
  startTime: string
  endTime: string
  reason?: string | null
  anchorDate: Date
  endMode: SeriesEndMode
  weeks?: number | null
}) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-timeblock', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createSeriesSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }

  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true, bookingWindowDays: true } })
  const timezone = business?.timezone || 'America/Santiago'
  const bookingWindowDays = business?.bookingWindowDays ?? 90

  const until = computeSeriesUntil(data.anchorDate, data.endMode, data.weeks ?? null, timezone)

  const series = await prisma.timeBlockSeries.create({
    data: {
      businessId,
      daysOfWeek: data.daysOfWeek,
      startTime: data.startTime,
      endTime: data.endTime,
      reason: data.reason ?? null,
      anchorDate: data.anchorDate,
      until,
    },
  })

  // Aviso "crear igual + avisar": listar días (yyyy-MM-dd) dentro de la ventana de
  // reserva cuyas ocurrencias se solapan con reservas existentes. No se cancela nada.
  const windowEnd = new Date(Date.now() + bookingWindowDays * 24 * 60 * 60 * 1000)
  const occurrences = expandSeries(series, [], data.anchorDate, windowEnd, timezone)
  const bookings = await prisma.booking.findMany({
    where: {
      businessId,
      status: { in: ['pending_payment', 'confirmed', 'completed'] },
      startDateTime: { lt: windowEnd },
      endDateTime: { gt: data.anchorDate },
    },
    select: { startDateTime: true, endDateTime: true },
  })
  const overlappingDates = occurrences
    .filter((occ) => bookings.some((b) => occ.startDateTime < b.endDateTime && b.startDateTime < occ.endDateTime))
    .map((occ) => formatInTimeZone(occ.startDateTime, timezone, 'yyyy-MM-dd'))

  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)

  return { series, overlappingDates }
}
```

- [ ] **Step 4: Correr para ver que pasa**

Run: `npm run test:integration -- time-block-series`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/time-blocks.ts tests/integration/time-block-series.test.ts
git commit -m "feat(#1): createTimeBlockSeries action with overlap notice"
```

---

## Task 9: Acciones `skipSeriesOccurrence` + `overrideSeriesOccurrence`

**Files:**
- Modify: `src/server/actions/time-blocks.ts`
- Test: `tests/integration/time-block-series.test.ts`

- [ ] **Step 1: Añadir tests que fallan**

```ts
it('skipSeriesOccurrence crea una excepción isSkipped', async () => {
  const { createTimeBlockSeries, skipSeriesOccurrence } = await import('@/server/actions/time-blocks')
  const { series } = await createTimeBlockSeries({ daysOfWeek: [1], startTime: '13:00', endTime: '14:00', reason: 'A', anchorDate: new Date('2026-06-01T04:00:00Z'), endMode: 'forever' }) as { series: { id: string } }
  await skipSeriesOccurrence(series.id, new Date('2026-06-08T04:00:00Z'))
  const exc = await prisma.timeBlockException.findFirst({ where: { seriesId: series.id } })
  expect(exc?.isSkipped).toBe(true)
})

it('overrideSeriesOccurrence hace upsert de un override', async () => {
  const { createTimeBlockSeries, overrideSeriesOccurrence } = await import('@/server/actions/time-blocks')
  const { series } = await createTimeBlockSeries({ daysOfWeek: [1], startTime: '13:00', endTime: '14:00', reason: 'A', anchorDate: new Date('2026-06-01T04:00:00Z'), endMode: 'forever' }) as { series: { id: string } }
  const occDate = new Date('2026-06-15T04:00:00Z')
  await overrideSeriesOccurrence(series.id, occDate, { startDateTime: new Date('2026-06-15T18:00:00Z'), endDateTime: new Date('2026-06-15T19:00:00Z'), reason: 'Movido' })
  await overrideSeriesOccurrence(series.id, occDate, { startDateTime: new Date('2026-06-15T19:00:00Z'), endDateTime: new Date('2026-06-15T20:00:00Z'), reason: 'Movido otra vez' })
  const exc = await prisma.timeBlockException.findMany({ where: { seriesId: series.id, isSkipped: false } })
  expect(exc).toHaveLength(1)
  expect(exc[0].reason).toBe('Movido otra vez')
})
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npm run test:integration -- time-block-series`
Expected: FAIL — funciones no existen.

- [ ] **Step 3: Implementar las acciones**

```ts
async function assertSeriesOwned(seriesId: string, businessId: string) {
  const series = await prisma.timeBlockSeries.findFirst({ where: { id: seriesId, businessId } })
  if (!series) throw new ForbiddenError('Serie no encontrada')
  return series
}

export async function skipSeriesOccurrence(seriesId: string, occurrenceDate: Date) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-timeblock', 20, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  await assertSeriesOwned(seriesId, businessId)

  await prisma.timeBlockException.upsert({
    where: { seriesId_occurrenceDate: { seriesId, occurrenceDate } },
    create: { seriesId, occurrenceDate, isSkipped: true },
    update: { isSkipped: true, startDateTime: null, endDateTime: null, reason: null },
  })

  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)
}

export async function overrideSeriesOccurrence(
  seriesId: string,
  occurrenceDate: Date,
  data: { startDateTime: Date; endDateTime: Date; reason?: string | null },
) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-timeblock', 20, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  if (data.endDateTime <= data.startDateTime) throw new Error('La hora de fin debe ser posterior a la de inicio')
  await assertSeriesOwned(seriesId, businessId)

  await prisma.timeBlockException.upsert({
    where: { seriesId_occurrenceDate: { seriesId, occurrenceDate } },
    create: { seriesId, occurrenceDate, isSkipped: false, startDateTime: data.startDateTime, endDateTime: data.endDateTime, reason: data.reason ?? null },
    update: { isSkipped: false, startDateTime: data.startDateTime, endDateTime: data.endDateTime, reason: data.reason ?? null },
  })

  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)
}
```

- [ ] **Step 4: Correr para ver que pasa**

Run: `npm run test:integration -- time-block-series`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/time-blocks.ts tests/integration/time-block-series.test.ts
git commit -m "feat(#1): skip + override series occurrence actions"
```

---

## Task 10: `updateTimeBlockSeries` (split en hoy) + `deleteTimeBlockSeries` + `getTimeBlockSeries`

**Files:**
- Modify: `src/server/actions/time-blocks.ts`
- Test: `tests/integration/time-block-series.test.ts`

- [ ] **Step 1: Añadir tests que fallan**

```ts
it('updateTimeBlockSeries hace split: cierra la vieja en hoy y crea una nueva', async () => {
  const { createTimeBlockSeries, updateTimeBlockSeries } = await import('@/server/actions/time-blocks')
  const { series } = await createTimeBlockSeries({ daysOfWeek: [1, 2, 3, 4], startTime: '13:00', endTime: '14:00', reason: 'A', anchorDate: new Date('2020-01-06T04:00:00Z'), endMode: 'forever' }) as { series: { id: string } }
  const res = await updateTimeBlockSeries(series.id, { daysOfWeek: [1, 2, 3, 4, 5], startTime: '13:00', endTime: '14:00', reason: 'A', endMode: 'forever', weeks: null })
  const old = await prisma.timeBlockSeries.findUniqueOrThrow({ where: { id: series.id } })
  expect(old.until).not.toBeNull() // cerrada en hoy
  expect(res.series.id).not.toBe(series.id) // serie nueva
  expect(res.series.daysOfWeek).toContain(5)
})

it('deleteTimeBlockSeries borra la serie y sus excepciones', async () => {
  const { createTimeBlockSeries, skipSeriesOccurrence, deleteTimeBlockSeries } = await import('@/server/actions/time-blocks')
  const { series } = await createTimeBlockSeries({ daysOfWeek: [1], startTime: '13:00', endTime: '14:00', reason: 'A', anchorDate: new Date('2026-06-01T04:00:00Z'), endMode: 'forever' }) as { series: { id: string } }
  await skipSeriesOccurrence(series.id, new Date('2026-06-08T04:00:00Z'))
  await deleteTimeBlockSeries(series.id)
  expect(await prisma.timeBlockSeries.findUnique({ where: { id: series.id } })).toBeNull()
  expect(await prisma.timeBlockException.count({ where: { seriesId: series.id } })).toBe(0)
})
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npm run test:integration -- time-block-series`
Expected: FAIL — funciones no existen.

- [ ] **Step 3: Implementar las acciones**

```ts
export async function updateTimeBlockSeries(
  seriesId: string,
  newRule: { daysOfWeek: number[]; startTime: string; endTime: string; reason?: string | null; endMode: SeriesEndMode; weeks?: number | null },
) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-timeblock', 20, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')

  const parsed = createSeriesSchema.safeParse({ ...newRule, anchorDate: new Date() })
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }

  const existing = await assertSeriesOwned(seriesId, businessId)
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } })
  const timezone = business?.timezone || 'America/Santiago'

  // Split en hoy: la serie vieja termina AYER (último día incluido); la nueva
  // arranca hoy. Importante: `until` de la vieja debe ser ayer (no hoy), porque
  // en expandSeries la comparación `cursor <= untilStr` es inclusiva — si fuera
  // hoy, vieja y nueva generarían ambas la ocurrencia de hoy (bloqueo duplicado).
  // El pasado queda inmutable; las excepciones futuras se resetean porque
  // pertenecen a la serie vieja (que ya no genera futuro).
  const todayStr = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')
  const yesterdayStr = formatInTimeZone(addDays(new Date(), -1), timezone, 'yyyy-MM-dd')
  const oldUntil = fromZonedTime(`${yesterdayStr} 00:00:00`, timezone)
  const anchorToday = fromZonedTime(`${todayStr} 00:00:00`, timezone)
  const until = computeSeriesUntil(anchorToday, newRule.endMode, newRule.weeks ?? null, timezone)

  const [, newSeries] = await prisma.$transaction([
    prisma.timeBlockSeries.update({ where: { id: seriesId }, data: { until: oldUntil, isActive: existing.anchorDate <= oldUntil } }),
    prisma.timeBlockSeries.create({
      data: {
        businessId,
        daysOfWeek: newRule.daysOfWeek,
        startTime: newRule.startTime,
        endTime: newRule.endTime,
        reason: newRule.reason ?? null,
        anchorDate: anchorToday,
        until,
      },
    }),
  ])

  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)

  return { series: newSeries }
}

export async function deleteTimeBlockSeries(seriesId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('delete-timeblock', 20, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  await assertSeriesOwned(seriesId, businessId)

  // onDelete: Cascade en TimeBlockException borra las excepciones.
  await prisma.timeBlockSeries.delete({ where: { id: seriesId } })

  revalidatePath('/dashboard/availability')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)
}

export async function getTimeBlockSeries() {
  const { businessId } = await requireBusiness()
  return prisma.timeBlockSeries.findMany({
    where: { businessId, isActive: true, OR: [{ until: null }, { until: { gte: new Date() } }] },
    orderBy: { createdAt: 'desc' },
  })
}
```

> Nota: si `existing.anchorDate >= yesterdayEnd` (serie que empezaba hoy o después), `until: yesterdayEnd` la deja sin días → `isActive: false` la oculta limpiamente.

- [ ] **Step 4: Correr para ver que pasa**

Run: `npm run test:integration -- time-block-series`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/time-blocks.ts tests/integration/time-block-series.test.ts
git commit -m "feat(#1): update (split) + delete + list series actions"
```

---

## Task 11: UI de creación — `RecurrenceFields` + wiring en `BlockTimeModal`

**Files:**
- Create: `src/components/dashboard/recurrence-fields.tsx`
- Modify: `src/components/dashboard/block-time-modal.tsx`
- Test: `tests/unit/recurrence-fields.test.tsx`

- [ ] **Step 1: Escribir test de render que falla**

```tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecurrenceFields } from '@/components/dashboard/recurrence-fields'

describe('RecurrenceFields', () => {
  it('oculta los controles cuando no es recurrente', () => {
    const html = renderToStaticMarkup(
      <RecurrenceFields recurring={false} onRecurringChange={() => {}} daysOfWeek={[]} onDaysOfWeekChange={() => {}} endMode="forever" onEndModeChange={() => {}} weeks={3} onWeeksChange={() => {}} />,
    )
    expect(html).toContain('Repetir')
    expect(html).not.toContain('Días de la semana')
  })

  it('muestra días y opciones de fin cuando es recurrente', () => {
    const html = renderToStaticMarkup(
      <RecurrenceFields recurring={true} onRecurringChange={() => {}} daysOfWeek={[1, 2]} onDaysOfWeekChange={() => {}} endMode="weeks" onEndModeChange={() => {}} weeks={3} onWeeksChange={() => {}} />,
    )
    expect(html).toContain('Días de la semana')
    expect(html).toContain('Para siempre')
  })
})
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npm run test:unit -- recurrence-fields`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Implementar `recurrence-fields.tsx`**

```tsx
'use client'

import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { SeriesEndMode } from '@/lib/calendar/expand-series'

const DAYS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
]

interface RecurrenceFieldsProps {
  recurring: boolean
  onRecurringChange: (value: boolean) => void
  daysOfWeek: number[]
  onDaysOfWeekChange: (value: number[]) => void
  endMode: SeriesEndMode
  onEndModeChange: (value: SeriesEndMode) => void
  weeks: number
  onWeeksChange: (value: number) => void
}

export function RecurrenceFields({
  recurring, onRecurringChange,
  daysOfWeek, onDaysOfWeekChange,
  endMode, onEndModeChange,
  weeks, onWeeksChange,
}: RecurrenceFieldsProps) {
  function toggleDay(day: number) {
    onDaysOfWeekChange(daysOfWeek.includes(day) ? daysOfWeek.filter((d) => d !== day) : [...daysOfWeek, day])
  }

  return (
    <div className="rounded-xl border border-muted-foreground/30 bg-muted/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="recurring"
          checked={recurring}
          onChange={(e) => onRecurringChange(e.target.checked)}
          className="size-3.5 rounded border-muted-foreground/50 accent-primary"
        />
        <label htmlFor="recurring" className="text-sm font-medium">Repetir</label>
      </div>

      {recurring && (
        <>
          <div>
            <Label>Días de la semana</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {DAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  aria-pressed={daysOfWeek.includes(d.value)}
                  className={
                    'rounded-lg border px-2.5 py-1 text-xs ' +
                    (daysOfWeek.includes(d.value)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/30 text-muted-foreground')
                  }
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="end-mode">Repetir durante</Label>
            <div className="mt-1 space-y-1.5 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="end-mode" checked={endMode === 'forever'} onChange={() => onEndModeChange('forever')} className="accent-primary" />
                Para siempre
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="end-mode" checked={endMode === 'month'} onChange={() => onEndModeChange('month')} className="accent-primary" />
                1 mes
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="end-mode" checked={endMode === 'weeks'} onChange={() => onEndModeChange('weeks')} className="accent-primary" />
                <span className="flex items-center gap-1.5">
                  <Input id="end-weeks" type="number" min={1} max={52} value={weeks} onChange={(e) => onWeeksChange(Number(e.target.value))} className="h-7 w-16" onFocus={() => onEndModeChange('weeks')} />
                  semanas
                </span>
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Correr para ver que pasa**

Run: `npm run test:unit -- recurrence-fields`
Expected: PASS.

- [ ] **Step 5: Wire en `BlockTimeModal`**

En `src/components/dashboard/block-time-modal.tsx`:

1. Import:
```ts
import { createTimeBlock, deleteTimeBlock, createTimeBlockSeries } from '@/server/actions/time-blocks'
import { RecurrenceFields } from './recurrence-fields'
import type { SeriesEndMode } from '@/lib/calendar/expand-series'
```

2. Estado nuevo (tras `const [reason, setReason] = ...`, línea 51):
```ts
  const [recurring, setRecurring] = useState(false)
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([])
  const [endMode, setEndMode] = useState<SeriesEndMode>('forever')
  const [weeks, setWeeks] = useState(3)
  const [notice, setNotice] = useState<string | null>(null)
```

3. En `handleOpenChange`, al cerrar (dentro del `if (!newOpen)`), añadir `setNotice(null)`.

4. En `handleSubmit`, dentro del `startTransition` `try`, sustituir la llamada a `createTimeBlock` por una bifurcación:
```ts
        if (recurring) {
          if (daysOfWeek.length === 0) { setError('Selecciona al menos un día'); return }
          const anchorDate = fromZonedTime(`${date} 00:00:00`, timezone)
          const res = await createTimeBlockSeries({ daysOfWeek, startTime, endTime, reason: reason || null, anchorDate, endMode, weeks: endMode === 'weeks' ? weeks : null })
          if (res.overlappingDates.length > 0) {
            setNotice(`Serie creada. Estos días se solapan con reservas existentes (no se cancelaron): ${res.overlappingDates.join(', ')}`)
          }
          router.refresh()
          setOpen(false)
          return
        }
        const start = parseTimeUTC(date, startTime, timezone)
        const end = parseTimeUTC(date, endTime, timezone)
        const result = await createTimeBlock({ startDateTime: start, endDateTime: end, reason: reason || null, confirmOverlap })
        if (result && 'requiresConfirmation' in result) { setError(result.message); return }
        router.refresh()
        setOpen(false)
```

5. En el JSX, tras `<BlockFormFields .../>` (línea 183), insertar:
```tsx
            <RecurrenceFields
              recurring={recurring}
              onRecurringChange={setRecurring}
              daysOfWeek={daysOfWeek}
              onDaysOfWeekChange={setDaysOfWeek}
              endMode={endMode}
              onEndModeChange={setEndMode}
              weeks={weeks}
              onWeeksChange={setWeeks}
            />
```

6. Tras `{error && ...}` (línea 205), añadir el aviso de solape:
```tsx
            {notice && <p className="text-sm text-amber-600">{notice}</p>}
```

- [ ] **Step 6: Verificar render del modal**

Run: `npm run test:unit -- block-time-modal`
Expected: PASS (el test existente ya mockea `next/navigation`; sigue renderizando sin lanzar).

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/recurrence-fields.tsx src/components/dashboard/block-time-modal.tsx tests/unit/recurrence-fields.test.tsx
git commit -m "feat(#1): recurrence UI in create block modal"
```

---

## Task 12: `EditSeriesOccurrenceDialog` + ruteo en el calendario

**Files:**
- Modify: `src/components/dashboard/time-block-card.tsx` (extender `CalendarTimeBlock`)
- Create: `src/components/dashboard/edit-series-occurrence-dialog.tsx`
- Modify: `src/components/dashboard/calendar-views.tsx` (ruteo suelto vs recurrente)
- Modify: `src/app/dashboard/calendar/page.tsx` (serializar `occurrenceDate`)
- Test: `tests/unit/edit-series-occurrence-dialog.test.tsx`

- [ ] **Step 1: Extender el tipo `CalendarTimeBlock`**

En `src/components/dashboard/time-block-card.tsx`, líneas 8-13:

```ts
export type CalendarTimeBlock = {
  id: string
  startDateTime: string
  endDateTime: string
  reason?: string | null
  seriesId?: string
  occurrenceDate?: string
}
```

- [ ] **Step 2: Serializar `occurrenceDate` en la página del calendario**

En `src/app/dashboard/calendar/page.tsx`, reemplazar la llamada `timeBlocks={serializeDates(timeBlocks)}` (línea 100) por una serialización explícita que incluya `seriesId`/`occurrenceDate`:

```tsx
          timeBlocks={timeBlocks.map((tb) => ({
            id: tb.id,
            startDateTime: tb.startDateTime.toISOString(),
            endDateTime: tb.endDateTime.toISOString(),
            reason: tb.reason ?? null,
            seriesId: tb.seriesId,
            occurrenceDate: tb.occurrenceDate ? tb.occurrenceDate.toISOString() : undefined,
          }))}
```

- [ ] **Step 3: Escribir test de render que falla**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { EditSeriesOccurrenceDialog } from '@/components/dashboard/edit-series-occurrence-dialog'

describe('EditSeriesOccurrenceDialog', () => {
  it('renderiza sin lanzar', () => {
    const block = { id: 's1:2026-06-01', startDateTime: '2026-06-01T17:00:00.000Z', endDateTime: '2026-06-01T18:00:00.000Z', reason: 'Almuerzo', seriesId: 's1', occurrenceDate: '2026-06-01T04:00:00.000Z' }
    expect(() =>
      renderToStaticMarkup(<EditSeriesOccurrenceDialog block={block} timezone="America/Santiago" open={true} onOpenChange={() => {}} />),
    ).not.toThrow()
  })
})
```

- [ ] **Step 4: Correr para ver que falla**

Run: `npm run test:unit -- edit-series-occurrence-dialog`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 5: Implementar `edit-series-occurrence-dialog.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  skipSeriesOccurrence, overrideSeriesOccurrence, updateTimeBlockSeries, deleteTimeBlockSeries,
} from '@/server/actions/time-blocks'
import { fromZonedTime } from 'date-fns-tz'
import { deriveBlockFormValues } from '@/lib/calendar/block-form-values'
import { getLocalDayOfWeek } from '@/lib/availability/timezone'
import { BlockFormFields } from './block-form-fields'
import type { CalendarTimeBlock } from './time-block-card'

interface Props {
  block: CalendarTimeBlock
  timezone: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Scope = 'occurrence' | 'series'

function parseTimeUTC(dateStr: string, timeStr: string, timezone: string): Date {
  return fromZonedTime(`${dateStr} ${timeStr}`, timezone)
}

export function EditSeriesOccurrenceDialog({ block, timezone, open, onOpenChange }: Props) {
  const initial = deriveBlockFormValues(block, timezone)
  const [date, setDate] = useState(initial.date)
  const [startTime, setStartTime] = useState(initial.startTime)
  const [endTime, setEndTime] = useState(initial.endTime)
  const [reason, setReason] = useState(initial.reason)
  const [error, setError] = useState<string | null>(null)
  const [pendingScope, setPendingScope] = useState<null | { action: 'save' | 'delete' }>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const seriesId = block.seriesId as string
  const occurrenceDate = new Date(block.occurrenceDate as string)

  function reset() {
    setPendingScope(null)
    setError(null)
  }
  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) reset()
    onOpenChange(newOpen)
  }

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      try {
        await fn()
        router.refresh()
        handleOpenChange(false)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error al guardar')
      }
    })
  }

  function saveScope(scope: Scope) {
    if (scope === 'occurrence') {
      run(() => overrideSeriesOccurrence(seriesId, occurrenceDate, {
        startDateTime: parseTimeUTC(date, startTime, timezone),
        endDateTime: parseTimeUTC(date, endTime, timezone),
        reason: reason || null,
      }))
    } else {
      // Editar toda la serie = split en hoy con la regla de este formulario,
      // conservando el mismo día de semana LOCAL de la ocurrencia editada.
      const dow = getLocalDayOfWeek(occurrenceDate, timezone)
      run(() => updateTimeBlockSeries(seriesId, {
        daysOfWeek: [dow], startTime, endTime, reason: reason || null, endMode: 'forever', weeks: null,
      }))
    }
  }

  function deleteScope(scope: Scope) {
    if (scope === 'occurrence') {
      run(() => skipSeriesOccurrence(seriesId, occurrenceDate))
    } else {
      run(() => deleteTimeBlockSeries(seriesId))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {pendingScope ? (
          <>
            <DialogHeader>
              <DialogTitle>{pendingScope.action === 'delete' ? 'Eliminar' : 'Guardar cambios'}</DialogTitle>
              <DialogDescription>
                ¿Aplicar solo a este día o a toda la serie? Editar toda la serie
                restablecerá los días que hayas editado individualmente de hoy en adelante.
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="outline" onClick={reset} disabled={isPending}>Cancelar</Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => (pendingScope.action === 'delete' ? deleteScope('occurrence') : saveScope('occurrence'))} disabled={isPending}>
                  Solo este día
                </Button>
                <Button type="button" variant={pendingScope.action === 'delete' ? 'destructive' : 'default'} onClick={() => (pendingScope.action === 'delete' ? deleteScope('series') : saveScope('series'))} disabled={isPending}>
                  Toda la serie
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Editar bloqueo recurrente</DialogTitle>
              <DialogDescription>Modifica esta ocurrencia o toda la serie.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <BlockFormFields
                date={date} onDateChange={setDate}
                startTime={startTime} onStartTimeChange={setStartTime}
                endTime={endTime} onEndTimeChange={setEndTime}
                reason={reason} onReasonChange={setReason}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter className="sm:justify-between">
                <Button type="button" variant="ghost" className="text-destructive hover:text-destructive/80" onClick={() => { setPendingScope({ action: 'delete' }); setError(null) }} disabled={isPending}>
                  Eliminar
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>Cancelar</Button>
                  <Button type="button" onClick={() => { setPendingScope({ action: 'save' }); setError(null) }} disabled={isPending}>Guardar cambios</Button>
                </div>
              </DialogFooter>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 6: Rutear en `calendar-views.tsx`**

En `src/components/dashboard/calendar-views.tsx`:

1. Import (junto al de `EditBlockDialog`, línea 26):
```ts
import { EditSeriesOccurrenceDialog } from './edit-series-occurrence-dialog'
```

2. Donde se monta el diálogo de bloqueo (líneas 185-191, el `{activeBlock && (...)}`), bifurcar por `seriesId`:
```tsx
      {activeBlock && (activeBlock.seriesId ? (
        <EditSeriesOccurrenceDialog
          key={activeBlock.id}
          block={activeBlock}
          timezone={timezone}
          open={!!activeBlock}
          onOpenChange={(o) => !o && setActiveBlock(null)}
        />
      ) : (
        <EditBlockDialog
          key={activeBlock.id}
          block={activeBlock}
          timezone={timezone}
          open={!!activeBlock}
          onOpenChange={(o) => !o && setActiveBlock(null)}
        />
      ))}
```

(Verifica las props exactas del `<EditBlockDialog>` existente y reprodúcelas; solo se añade la rama `seriesId`.)

- [ ] **Step 7: Correr tests de render y de calendario**

Run: `npm run test:unit -- edit-series-occurrence-dialog calendar-views-fill`
Expected: PASS. (Si `calendar-views-fill.test.tsx` mockea `edit-block-dialog`, añade un mock análogo `vi.mock('@/components/dashboard/edit-series-occurrence-dialog', () => ({ EditSeriesOccurrenceDialog: () => null }))`.)

- [ ] **Step 8: Commit**

```bash
git add src/components/dashboard/time-block-card.tsx src/components/dashboard/edit-series-occurrence-dialog.tsx src/components/dashboard/calendar-views.tsx src/app/dashboard/calendar/page.tsx tests/unit/edit-series-occurrence-dialog.test.tsx tests/unit/calendar-views-fill.test.tsx
git commit -m "feat(#1): edit/skip recurring occurrence dialog + calendar routing"
```

---

## Task 13: Sección "Bloqueos recurrentes" (solo lectura) en Disponibilidad

**Files:**
- Create: `src/components/dashboard/recurring-block-list.tsx`
- Modify: `src/app/dashboard/availability/page.tsx`
- Test: `tests/unit/recurring-block-list.test.tsx`

- [ ] **Step 1: Escribir test de render que falla**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { RecurringBlockList } from '@/components/dashboard/recurring-block-list'

describe('RecurringBlockList', () => {
  it('lista series con sus días y horario', () => {
    const html = renderToStaticMarkup(
      <RecurringBlockList series={[{ id: 's1', daysOfWeek: [1, 2, 3, 4], startTime: '13:00', endTime: '14:00', reason: 'Almuerzo', until: null }]} />,
    )
    expect(html).toContain('Almuerzo')
    expect(html).toContain('13:00')
    expect(html).toContain('Lun')
  })

  it('muestra vacío cuando no hay series', () => {
    const html = renderToStaticMarkup(<RecurringBlockList series={[]} />)
    expect(html).toContain('No tienes bloqueos recurrentes')
  })
})
```

- [ ] **Step 2: Correr para ver que falla**

Run: `npm run test:unit -- recurring-block-list`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Implementar `recurring-block-list.tsx`**

```tsx
'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Repeat, Trash2 } from 'lucide-react'
import { deleteTimeBlockSeries } from '@/server/actions/time-blocks'

const DAY_LABELS: Record<number, string> = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' }

export interface RecurringSeriesItem {
  id: string
  daysOfWeek: number[]
  startTime: string
  endTime: string
  reason?: string | null
  until: string | null
}

function DeleteSeriesButton({ seriesId }: { seriesId: string }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  return (
    <Button
      size="xs"
      variant="ghost"
      className="text-destructive hover:text-destructive/80"
      disabled={isPending}
      onClick={() => startTransition(async () => { try { await deleteTimeBlockSeries(seriesId); router.refresh() } catch { /* noop */ } })}
    >
      <Trash2 className="size-3" />
    </Button>
  )
}

export function RecurringBlockList({ series }: { series: RecurringSeriesItem[] }) {
  if (series.length === 0) {
    return <p className="text-sm text-muted-foreground">No tienes bloqueos recurrentes.</p>
  }
  return (
    <div className="space-y-3">
      {series.map((s) => {
        const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => s.daysOfWeek.includes(d)).map((d) => DAY_LABELS[d]).join(', ')
        return (
          <div key={s.id} className="flex items-center gap-3 rounded-xl border border-dashed border-muted-foreground/30 bg-muted/30 p-3 md:p-4">
            <Repeat className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-muted-foreground">{s.startTime} - {s.endTime} · {days}</div>
              <div className="text-xs text-muted-foreground">
                {s.reason ? `${s.reason} · ` : ''}{s.until ? 'hasta fecha límite' : 'indefinido'}
              </div>
            </div>
            <DeleteSeriesButton seriesId={s.id} />
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Correr para ver que pasa**

Run: `npm run test:unit -- recurring-block-list`
Expected: PASS.

- [ ] **Step 5: Wire en la página de Disponibilidad**

En `src/app/dashboard/availability/page.tsx`:

1. Imports:
```ts
import { getTimeBlocks, getTimeBlockSeries } from '@/server/actions/time-blocks'
import { RecurringBlockList } from '@/components/dashboard/recurring-block-list'
```

2. Cargar las series (mantén `const blocks = await getTimeBlocks()` tal cual; añade una línea):
```ts
  const recurringSeries = await getTimeBlockSeries()
```

3. Dentro de la sección "Bloqueos", tras `<TimeBlockList blocks={blocks} />` (línea 47), añadir:
```tsx
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Bloqueos recurrentes</h3>
            <RecurringBlockList
              series={recurringSeries.map((s) => ({
                id: s.id,
                daysOfWeek: s.daysOfWeek,
                startTime: s.startTime,
                endTime: s.endTime,
                reason: s.reason,
                until: s.until ? s.until.toISOString() : null,
              }))}
            />
          </div>
```

- [ ] **Step 6: Verificar**

Run: `npm run test:unit -- recurring-block-list && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: PASS; baseline de errores sin incrementos.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/recurring-block-list.tsx src/app/dashboard/availability/page.tsx tests/unit/recurring-block-list.test.tsx
git commit -m "feat(#1): read-only recurring blocks section on availability page"
```

---

## Task 14: Verificación final

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Typecheck completo**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: igual al baseline anotado en Task 1 (sin nuevos errores).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 3: Unit tests**

Run: `npm run test:unit`
Expected: PASS (incluye expand-series, computeSeriesUntil, recurrence-fields, edit-series-occurrence-dialog, recurring-block-list, y no-regresión de block-time-modal/calendar-views-fill).

- [ ] **Step 4: Integration tests**

Run: `npm run test:integration`
Expected: PASS (effective-blocks, time-block-series, y no-regresión de booking).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 6: `/simplify` + code review experto**

Correr `/simplify` sobre el diff, luego revisión con `superpowers:code-reviewer` contra este plan y el spec. Aplicar hallazgos Critical/Important.

- [ ] **Step 7: PR + merge**

Crear PR (base `main`), esperar checks requeridos (build/integration/lint/unit; `e2e` no es requerido), squash-merge.

---

## Self-Review (cobertura del spec)

- Modelo de datos (TimeBlockSeries, TimeBlockException, TimeBlock intacto) → Task 1. ✅
- `expandSeries` pura (días, until/forever, tope, skip, override) → Task 2. ✅
- `computeSeriesUntil` (forever/mes/N semanas) → Task 3. ✅
- `getEffectiveBlocks` (unión) → Task 4. ✅
- Enrutado 4 sitios (availability ×2, validation, getTimeBlocksByRange) → Tasks 5, 6, 7. ✅
- Creación (UI Repetir + días + fin; acción + aviso solape) → Tasks 8, 11. ✅
- Editar/saltar "este día / toda la serie" (+ aviso reset) → Tasks 9, 10, 12. ✅
- Split en hoy (pasado inmutable) → Task 10, 12. ✅
- Gestión: sección solo-lectura en disponibilidad → Task 13. ✅
- Timezone por día local, guardas (rol/rate-limit/await revalidate) → en cada acción/expansión. ✅
- Tests unit + integración + landmines → distribuidos + Task 14. ✅

**Nota de decisión pendiente para el implementador:** "editar toda la serie" desde una ocurrencia (Task 12) usa como regla los valores del formulario con **el mismo día de semana de la ocurrencia editada**. Si se quiere permitir cambiar el conjunto de días al editar la serie completa, habría que añadir los chips de `RecurrenceFields` al diálogo de edición (fuera de alcance del MVP; anotado como mejora futura).

## Mejoras futuras (fuera del MVP, no implementar ahora)

- **Default de días** (Task 11): al activar "Repetir", prellenar `daysOfWeek` con el día de semana local de la fecha ancla en vez de dejarlo vacío. Requiere derivar el weekday del `date` en `BlockTimeModal` cuando `recurring` pasa a `true`.
- **Limpiar excepciones huérfanas tras el split** (Task 10): las excepciones futuras de la serie vieja quedan sin uso (inofensivas). Podrían borrarse en la misma `$transaction` (`deleteMany` de excepciones con `occurrenceDate >= hoy`).
- **Distinguir visualmente las ocurrencias recurrentes** en el calendario (un icono de repetición en `BlockBand`), ya que hoy se renderizan igual que un bloqueo suelto.
