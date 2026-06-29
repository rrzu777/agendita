# B1 · Núcleo de puntos (fidelización) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Programa de puntos por negocio: las clientas acumulan puntos al completar reservas, los ven por un link mágico "Mi tarjeta", y la dueña configura y ajusta puntos desde el panel.

**Architecture:** Saldo = `sum(LoyaltyLedger.points)` (append-only, server-authoritative). Earn en un único hook (`updateBookingStatus(completed)`), clawback en el webhook de MP (`refunded`). Motor de cálculo puro y aislado; helpers transaccionales reciben `tx` por parámetro (testeo por inyección, igual que `applyPromotionInTx` de A). Reusa el patrón de link mágico de `reviewToken` y el branding del negocio (`logoUrl`+`name`).

**Tech Stack:** Next.js 16 (modificado — leer `node_modules/next/dist/docs` antes de tocar rutas/metadata), React 19, Prisma 5.22 + Postgres (Supabase), Zod 4.4.3, Vitest (jsdom, `globals:true`, tests en `tests/unit/*.test.ts`), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-06-29-loyalty-points-B1-design.md`

**Reglas del repo (no romper):**
- Módulos `'use server'` exportan **solo funciones async** (tipos/constantes/enums van en `src/lib/loyalty/*`).
- Todo `revalidatePath`/`revalidate*` se llama con **`await`**.
- Currency-clean: usar `formatMoney(monto, currency)` de `src/lib/money.ts`; **nada** de `toLocaleString('es-CL')` ni `$` hardcodeado en código nuevo. Los puntos no son moneda: se muestran como `"{n} {pointsLabel}"`.
- **NO aplicar la migración a prod** hasta la Task 13 con confirmación explícita del usuario.

---

## File Structure

**Crear:**
- `src/lib/loyalty/earn.ts` — motor puro `computeEarnedPoints` (sin I/O).
- `src/lib/loyalty/schema.ts` — zod `loyaltyConfigSchema` + `adjustPointsSchema` + tipos derivados.
- `src/lib/loyalty/credit.ts` — `creditVisitPoints(tx, …)` / `reverseVisitPoints(tx, bookingId)`.
- `src/lib/loyalty/balance.ts` — `getLoyaltyBalance` / `getLoyaltyHistory`.
- `src/lib/loyalty/token.ts` — `ensureLoyaltyToken` / `resolveLoyaltyCustomer`.
- `src/lib/loyalty/view.ts` — helpers puros de presentación (`loyaltyReasonLabel`, `displayBalance`).
- `src/server/actions/loyalty.ts` — `'use server'` (solo async).
- `src/app/tarjeta/[token]/page.tsx` — "Mi tarjeta" pública (noindex).
- `src/app/dashboard/fidelizacion/page.tsx` + `loyalty-config-form.tsx` — config de la dueña.
- `src/app/dashboard/customers/[id]/loyalty-panel.tsx` — saldo+historial+ajuste (client form).
- Tests: `tests/unit/loyalty-earn.test.ts`, `loyalty-schema.test.ts`, `loyalty-credit.test.ts`, `loyalty-balance.test.ts`, `loyalty-view.test.ts`, `loyalty-actions.test.ts`.

**Modificar:**
- `prisma/schema.prisma` — enum + 2 modelos + `Customer.loyaltyToken` + back-relations.
- `src/server/actions/bookings.ts` — earn dentro del `$transaction` de `updateBookingStatus`.
- `src/app/api/webhooks/mercado-pago/route.ts` — clawback en branch `refunded`.
- `src/lib/notifications/types.ts` + `templates.ts` + `whatsapp.ts` — línea "Mi tarjeta".
- `src/server/actions/reviews.ts` — pasar `loyaltyCardLink` al pedir reseña (completada).
- `src/components/dashboard/sidebar.tsx` — ítem "Fidelización".
- `src/app/dashboard/customers/[id]/page.tsx` — montar `loyalty-panel`.

---

## Task 1: Schema Prisma + migración (aditiva, sin aplicar a prod)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_loyalty/migration.sql` (generada)

- [ ] **Step 1: Agregar enum + modelos a `prisma/schema.prisma`**

Agregar el enum junto a los demás enums:

```prisma
enum LoyaltyReason {
  visit
  visit_reversal
  adjustment
}
```

Agregar los modelos:

```prisma
model LoyaltyConfig {
  id              String   @id @default(cuid())
  businessId      String   @unique
  isActive        Boolean  @default(false)
  programName     String
  pointsLabel     String   @default("puntos")
  pointsPerVisit  Int      @default(0)
  spendPerPoint   Int?
  minSpendToEarn  Int?
  cardMessage     String?
  updatedByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  business        Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
}

model LoyaltyLedger {
  id              String        @id @default(cuid())
  businessId      String
  customerId      String
  points          Int
  reason          LoyaltyReason
  bookingId       String?
  note            String?
  metadata        Json?
  createdByUserId String?
  createdAt       DateTime      @default(now())

  business        Business  @relation(fields: [businessId], references: [id], onDelete: Cascade)
  customer        Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
  booking         Booking?  @relation(fields: [bookingId], references: [id], onDelete: SetNull)

  @@unique([bookingId, reason])
  @@index([businessId, customerId])
  @@index([customerId])
}
```

- [ ] **Step 2: Agregar campos y back-relations**

En `model Customer` agregar:

```prisma
  loyaltyToken String? @unique
  loyaltyLedger LoyaltyLedger[]
```

En `model Business` agregar las back-relations:

```prisma
  loyaltyConfig LoyaltyConfig?
  loyaltyLedger LoyaltyLedger[]
```

En `model Booking` agregar:

```prisma
  loyaltyLedger LoyaltyLedger[]
```

- [ ] **Step 3: Formatear y validar el schema**

Run: `npx prisma format && npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 4: Generar la migración (sin aplicar a prod)**

Run: `npx prisma migrate dev --name add_loyalty`
Expected: crea `prisma/migrations/<timestamp>_add_loyalty/migration.sql`, la aplica a la **DB local**, y regenera el cliente. (NO tocar la DB de prod — eso es la Task 13.)

- [ ] **Step 5: Verificar que el SQL es puramente aditivo**

Run: `grep -iE "DROP|ALTER COLUMN|RENAME" prisma/migrations/*_add_loyalty/migration.sql || echo "OK additive"`
Expected: `OK additive` (solo `CREATE TABLE`, `CREATE TYPE`, `CREATE INDEX`, `ALTER TABLE ... ADD COLUMN`).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(loyalty): schema LoyaltyConfig + LoyaltyLedger + Customer.loyaltyToken"
```

---

## Task 2: Motor puro de acumulación

**Files:**
- Create: `src/lib/loyalty/earn.ts`
- Test: `tests/unit/loyalty-earn.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest'
import { computeEarnedPoints } from '@/lib/loyalty/earn'

const cfg = (over = {}) => ({ pointsPerVisit: 10, spendPerPoint: 1000, minSpendToEarn: null, ...over })

describe('computeEarnedPoints', () => {
  it('suma puntos por visita + por gasto (floor)', () => {
    const r = computeEarnedPoints(cfg(), { finalAmount: 16500 })
    expect(r.pointsPerVisit).toBe(10)
    expect(r.pointsFromSpend).toBe(16) // floor(16500/1000)
    expect(r.total).toBe(26)
    expect(r.belowMinSpend).toBe(false)
  })
  it('solo por visita cuando spendPerPoint es null', () => {
    expect(computeEarnedPoints(cfg({ spendPerPoint: null }), { finalAmount: 16500 }).total).toBe(10)
  })
  it('solo por gasto cuando pointsPerVisit es 0', () => {
    expect(computeEarnedPoints(cfg({ pointsPerVisit: 0 }), { finalAmount: 2000 }).total).toBe(2)
  })
  it('reserva gratis sin piso igual da puntos por visita', () => {
    expect(computeEarnedPoints(cfg(), { finalAmount: 0 }).total).toBe(10)
  })
  it('spendPerPoint 0 se trata como off', () => {
    expect(computeEarnedPoints(cfg({ spendPerPoint: 0 }), { finalAmount: 5000 }).total).toBe(10)
  })
  it('bajo el piso no acredita nada (ni visita ni gasto)', () => {
    const r = computeEarnedPoints(cfg({ minSpendToEarn: 10000 }), { finalAmount: 5000 })
    expect(r.total).toBe(0)
    expect(r.belowMinSpend).toBe(true)
  })
  it('en o sobre el piso acredita normal', () => {
    expect(computeEarnedPoints(cfg({ minSpendToEarn: 10000 }), { finalAmount: 10000 }).total).toBe(20)
  })
  it('montos negativos se tratan como 0', () => {
    expect(computeEarnedPoints(cfg(), { finalAmount: -500 }).total).toBe(10)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/loyalty-earn.test.ts`
Expected: FAIL — `computeEarnedPoints` no existe.

- [ ] **Step 3: Implementar `src/lib/loyalty/earn.ts`**

```ts
export interface EarnConfig {
  pointsPerVisit: number
  spendPerPoint: number | null
  minSpendToEarn: number | null
}
export interface EarnInput { finalAmount: number }
export interface EarnBreakdown {
  total: number
  pointsPerVisit: number
  pointsFromSpend: number
  finalAmount: number
  spendPerPoint: number | null
  belowMinSpend: boolean
}

/** Puro: calcula puntos ganados al completar una reserva. Sin I/O. */
export function computeEarnedPoints(config: EarnConfig, input: EarnInput): EarnBreakdown {
  const finalAmount = Math.max(0, Math.trunc(input.finalAmount || 0))
  const spendPerPoint = config.spendPerPoint && config.spendPerPoint > 0 ? config.spendPerPoint : null
  const floor = config.minSpendToEarn && config.minSpendToEarn > 0 ? config.minSpendToEarn : null

  const belowMinSpend = floor != null && finalAmount < floor
  if (belowMinSpend) {
    return { total: 0, pointsPerVisit: 0, pointsFromSpend: 0, finalAmount, spendPerPoint, belowMinSpend }
  }
  const pointsPerVisit = Math.max(0, Math.trunc(config.pointsPerVisit || 0))
  const pointsFromSpend = spendPerPoint ? Math.floor(finalAmount / spendPerPoint) : 0
  return { total: pointsPerVisit + pointsFromSpend, pointsPerVisit, pointsFromSpend, finalAmount, spendPerPoint, belowMinSpend }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/loyalty-earn.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/earn.ts tests/unit/loyalty-earn.test.ts
git commit -m "feat(loyalty): motor puro computeEarnedPoints"
```

---

## Task 3: Zod schema (config + ajuste)

**Files:**
- Create: `src/lib/loyalty/schema.ts`
- Test: `tests/unit/loyalty-schema.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest'
import { loyaltyConfigSchema, adjustPointsSchema } from '@/lib/loyalty/schema'

describe('loyaltyConfigSchema', () => {
  const base = { isActive: true, programName: 'Puntos X', pointsLabel: 'estrellas', pointsPerVisit: 10, spendPerPoint: 1000, minSpendToEarn: null, cardMessage: null }
  it('acepta config válida', () => {
    expect(loyaltyConfigSchema.safeParse(base).success).toBe(true)
  })
  it('pointsLabel default = "puntos"', () => {
    const { pointsLabel } = loyaltyConfigSchema.parse({ ...base, pointsLabel: undefined })
    expect(pointsLabel).toBe('puntos')
  })
  it('programName vacío falla', () => {
    expect(loyaltyConfigSchema.safeParse({ ...base, programName: '   ' }).success).toBe(false)
  })
  it('pointsPerVisit negativo falla', () => {
    expect(loyaltyConfigSchema.safeParse({ ...base, pointsPerVisit: -1 }).success).toBe(false)
  })
  it('spendPerPoint 0 o negativo se normaliza a null', () => {
    expect(loyaltyConfigSchema.parse({ ...base, spendPerPoint: 0 }).spendPerPoint).toBeNull()
  })
  it('cardMessage vacío => null', () => {
    expect(loyaltyConfigSchema.parse({ ...base, cardMessage: '  ' }).cardMessage).toBeNull()
  })
})

describe('adjustPointsSchema', () => {
  it('acepta delta no-cero con nota', () => {
    expect(adjustPointsSchema.safeParse({ delta: -50, note: 'cortesía' }).success).toBe(true)
  })
  it('delta 0 falla', () => {
    expect(adjustPointsSchema.safeParse({ delta: 0, note: 'x' }).success).toBe(false)
  })
  it('nota vacía falla', () => {
    expect(adjustPointsSchema.safeParse({ delta: 10, note: '' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/loyalty-schema.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar `src/lib/loyalty/schema.ts`**

```ts
import { z } from 'zod'

// Entero opcional positivo; '' / 0 / negativo / null => null (off).
const optPositiveInt = z.coerce.number().int().optional().nullable()
  .transform((v) => (v && v > 0 ? v : null))

const optText = (max: number) => z.string().trim().max(max).optional().nullable()
  .transform((v) => (v ? v : null))

export const loyaltyConfigSchema = z.object({
  isActive: z.boolean(),
  programName: z.string().trim().min(1, 'El nombre del programa es requerido').max(60),
  pointsLabel: z.string().trim().min(1).max(20).optional().default('puntos'),
  pointsPerVisit: z.coerce.number().int().nonnegative().max(1_000_000),
  spendPerPoint: optPositiveInt,
  minSpendToEarn: optPositiveInt,
  cardMessage: optText(200),
}).strip()

export const adjustPointsSchema = z.object({
  delta: z.coerce.number().int().refine((v) => v !== 0, 'El ajuste no puede ser 0'),
  note: z.string().trim().min(1, 'La nota es requerida').max(200),
}).strip()

export type LoyaltyConfigInput = z.infer<typeof loyaltyConfigSchema>
export type LoyaltyConfigFormInput = z.input<typeof loyaltyConfigSchema>
export type AdjustPointsInput = z.infer<typeof adjustPointsSchema>
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/loyalty-schema.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/schema.ts tests/unit/loyalty-schema.test.ts
git commit -m "feat(loyalty): zod schema de config + ajuste"
```

---

## Task 4: Helpers de presentación puros (view)

**Files:**
- Create: `src/lib/loyalty/view.ts`
- Test: `tests/unit/loyalty-view.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest'
import { loyaltyReasonLabel, displayBalance } from '@/lib/loyalty/view'

describe('loyaltyReasonLabel', () => {
  it('mapea cada motivo', () => {
    expect(loyaltyReasonLabel('visit')).toBe('Visita')
    expect(loyaltyReasonLabel('visit_reversal')).toBe('Reembolso')
    expect(loyaltyReasonLabel('adjustment')).toBe('Ajuste')
  })
})

describe('displayBalance', () => {
  it('nunca muestra negativo', () => {
    expect(displayBalance(-30)).toBe(0)
    expect(displayBalance(120)).toBe(120)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/loyalty-view.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar `src/lib/loyalty/view.ts`**

```ts
import type { LoyaltyReason } from '@prisma/client'

const REASON_LABELS: Record<LoyaltyReason, string> = {
  visit: 'Visita',
  visit_reversal: 'Reembolso',
  adjustment: 'Ajuste',
}

export function loyaltyReasonLabel(reason: LoyaltyReason): string {
  return REASON_LABELS[reason] ?? 'Movimiento'
}

/** La cara a la clienta nunca muestra saldo negativo (el ledger sí guarda la verdad). */
export function displayBalance(balance: number): number {
  return Math.max(0, balance)
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/loyalty-view.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/view.ts tests/unit/loyalty-view.test.ts
git commit -m "feat(loyalty): helpers de presentación (labels + displayBalance)"
```

---

## Task 5: Saldo + historial

**Files:**
- Create: `src/lib/loyalty/balance.ts`
- Test: `tests/unit/loyalty-balance.test.ts`

`getLoyaltyBalance`/`getLoyaltyHistory` reciben el cliente por parámetro (`PrismaClient | Prisma.TransactionClient`) para poder testearlos con un fake.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi } from 'vitest'
import { getLoyaltyBalance, getLoyaltyHistory } from '@/lib/loyalty/balance'

function fakeDb() {
  return {
    loyaltyLedger: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { points: 140 } }),
      findMany: vi.fn().mockResolvedValue([{ id: 'l1', points: 10, reason: 'visit' }]),
    },
  } as any
}

describe('getLoyaltyBalance', () => {
  it('devuelve la suma de points', async () => {
    const db = fakeDb()
    expect(await getLoyaltyBalance(db, 'cus1')).toBe(140)
    expect(db.loyaltyLedger.aggregate).toHaveBeenCalledWith({
      where: { customerId: 'cus1' }, _sum: { points: true },
    })
  })
  it('devuelve 0 cuando no hay asientos', async () => {
    const db = { loyaltyLedger: { aggregate: vi.fn().mockResolvedValue({ _sum: { points: null } }) } } as any
    expect(await getLoyaltyBalance(db, 'cus1')).toBe(0)
  })
})

describe('getLoyaltyHistory', () => {
  it('pide los últimos N desc', async () => {
    const db = fakeDb()
    await getLoyaltyHistory(db, 'cus1', 50)
    expect(db.loyaltyLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId: 'cus1' }, orderBy: { createdAt: 'desc' }, take: 50,
    }))
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/loyalty-balance.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar `src/lib/loyalty/balance.ts`**

```ts
import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

export async function getLoyaltyBalance(db: Db, customerId: string): Promise<number> {
  const agg = await db.loyaltyLedger.aggregate({ where: { customerId }, _sum: { points: true } })
  return agg._sum.points ?? 0
}

export async function getLoyaltyHistory(db: Db, customerId: string, limit = 50) {
  return db.loyaltyLedger.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { booking: { select: { id: true, startDateTime: true } } },
  })
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/loyalty-balance.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/balance.ts tests/unit/loyalty-balance.test.ts
git commit -m "feat(loyalty): getLoyaltyBalance + getLoyaltyHistory"
```

---

## Task 6: Crédito + reversa transaccionales

**Files:**
- Create: `src/lib/loyalty/credit.ts`
- Test: `tests/unit/loyalty-credit.test.ts`

`creditVisitPoints` y `reverseVisitPoints` reciben `tx` por parámetro. La idempotencia se apoya en la unique `(bookingId, reason)`: ante el segundo intento, `create` lanza `P2002` y lo tratamos como no-op.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi } from 'vitest'
import { creditVisitPoints, reverseVisitPoints } from '@/lib/loyalty/credit'

function p2002() { const e: any = new Error('unique'); e.code = 'P2002'; return e }
const activeCfg = { isActive: true, pointsPerVisit: 10, spendPerPoint: 1000, minSpendToEarn: null }

function fakeTx(overrides: any = {}) {
  return {
    loyaltyLedger: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      ...overrides,
    },
  } as any
}

describe('creditVisitPoints', () => {
  const args = { businessId: 'b1', customerId: 'c1', finalAmount: 16000, bookingId: 'bk1', config: activeCfg }

  it('inserta un asiento visit con el desglose en metadata', async () => {
    const tx = fakeTx()
    const r = await creditVisitPoints(tx, args)
    expect(r?.total).toBe(26)
    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ businessId: 'b1', customerId: 'c1', bookingId: 'bk1', points: 26, reason: 'visit' }),
    }))
  })
  it('no hace nada si el programa está inactivo', async () => {
    const tx = fakeTx()
    expect(await creditVisitPoints(tx, { ...args, config: { ...activeCfg, isActive: false } })).toBeNull()
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled()
  })
  it('no hace nada si no hay customerId (walk-in)', async () => {
    const tx = fakeTx()
    expect(await creditVisitPoints(tx, { ...args, customerId: null as any })).toBeNull()
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled()
  })
  it('no inserta si total = 0', async () => {
    const tx = fakeTx()
    await creditVisitPoints(tx, { ...args, config: { ...activeCfg, pointsPerVisit: 0, spendPerPoint: null } })
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled()
  })
  it('es idempotente: P2002 en create se traga (no relanza)', async () => {
    const tx = fakeTx({ create: vi.fn().mockRejectedValue(p2002()) })
    await expect(creditVisitPoints(tx, args)).resolves.toBeNull()
  })
  it('config null => no-op', async () => {
    const tx = fakeTx()
    expect(await creditVisitPoints(tx, { ...args, config: null })).toBeNull()
  })
})

describe('reverseVisitPoints', () => {
  it('inserta el asiento negativo del visit original', async () => {
    const tx = fakeTx({ findUnique: vi.fn().mockResolvedValue({ id: 'led1', points: 26, businessId: 'b1', customerId: 'c1' }) })
    await reverseVisitPoints(tx, 'bk1')
    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ bookingId: 'bk1', points: -26, reason: 'visit_reversal' }),
    }))
  })
  it('no-op si no había visit', async () => {
    const tx = fakeTx({ findUnique: vi.fn().mockResolvedValue(null) })
    await reverseVisitPoints(tx, 'bk1')
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled()
  })
  it('idempotente: P2002 en la reversa se traga', async () => {
    const tx = fakeTx({
      findUnique: vi.fn().mockResolvedValue({ id: 'led1', points: 26, businessId: 'b1', customerId: 'c1' }),
      create: vi.fn().mockRejectedValue(p2002()),
    })
    await expect(reverseVisitPoints(tx, 'bk1')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/loyalty-credit.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar `src/lib/loyalty/credit.ts`**

```ts
import type { Prisma } from '@prisma/client'
import { computeEarnedPoints, type EarnBreakdown } from './earn'

type Tx = Prisma.TransactionClient

export interface CreditConfig {
  isActive: boolean
  pointsPerVisit: number
  spendPerPoint: number | null
  minSpendToEarn: number | null
}

function isP2002(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === 'P2002'
}

/** Acredita puntos por una reserva completada, dentro de la tx de la reserva.
 *  No-op si programa inactivo / sin clienta / total 0 / ya acreditado (P2002). */
export async function creditVisitPoints(tx: Tx, args: {
  businessId: string
  customerId: string | null
  finalAmount: number
  bookingId: string
  config: CreditConfig | null
}): Promise<EarnBreakdown | null> {
  const { config, customerId } = args
  if (!config || !config.isActive || !customerId) return null

  const breakdown = computeEarnedPoints(config, { finalAmount: args.finalAmount })
  if (breakdown.total <= 0) return null

  try {
    await tx.loyaltyLedger.create({
      data: {
        businessId: args.businessId,
        customerId,
        points: breakdown.total,
        reason: 'visit',
        bookingId: args.bookingId,
        metadata: breakdown as unknown as Prisma.InputJsonValue,
      },
    })
    return breakdown
  } catch (e) {
    if (isP2002(e)) return null // ya acreditado: idempotente
    throw e
  }
}

/** Reversa (clawback) del visit de una reserva reembolsada. Append-only. Idempotente. */
export async function reverseVisitPoints(tx: Tx, bookingId: string): Promise<void> {
  const original = await tx.loyaltyLedger.findUnique({
    where: { bookingId_reason: { bookingId, reason: 'visit' } },
  })
  if (!original) return

  try {
    await tx.loyaltyLedger.create({
      data: {
        businessId: original.businessId,
        customerId: original.customerId,
        points: -original.points,
        reason: 'visit_reversal',
        bookingId,
        metadata: { reversedLedgerId: original.id, originalPoints: original.points },
      },
    })
  } catch (e) {
    if (isP2002(e)) return // ya reversado
    throw e
  }
}
```

> Nota para el implementador: el nombre del índice compuesto en el `where` es `bookingId_reason` (Prisma lo deriva de `@@unique([bookingId, reason])`). Si Prisma genera otro nombre, usar el que aparezca en el cliente generado.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/loyalty-credit.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/credit.ts tests/unit/loyalty-credit.test.ts
git commit -m "feat(loyalty): creditVisitPoints + reverseVisitPoints (idempotentes)"
```

---

## Task 7: Token + resolución de clienta

**Files:**
- Create: `src/lib/loyalty/token.ts`
- Test: `tests/unit/loyalty-token.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi } from 'vitest'
import { ensureLoyaltyToken } from '@/lib/loyalty/token'

describe('ensureLoyaltyToken', () => {
  it('devuelve el token existente sin escribir', async () => {
    const db = { customer: { update: vi.fn() } } as any
    expect(await ensureLoyaltyToken(db, { id: 'c1', loyaltyToken: 'tok-existente' })).toBe('tok-existente')
    expect(db.customer.update).not.toHaveBeenCalled()
  })
  it('genera y persiste uno nuevo si falta', async () => {
    const db = { customer: { update: vi.fn().mockResolvedValue({}) } } as any
    const tok = await ensureLoyaltyToken(db, { id: 'c1', loyaltyToken: null })
    expect(typeof tok).toBe('string')
    expect(tok.length).toBeGreaterThan(10)
    expect(db.customer.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { loyaltyToken: tok } })
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/loyalty-token.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar `src/lib/loyalty/token.ts`**

```ts
import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/** Devuelve el loyaltyToken de la clienta, generándolo (lazy) si falta. */
export async function ensureLoyaltyToken(
  db: Db,
  customer: { id: string; loyaltyToken: string | null },
): Promise<string> {
  if (customer.loyaltyToken) return customer.loyaltyToken
  const token = crypto.randomUUID()
  await db.customer.update({ where: { id: customer.id }, data: { loyaltyToken: token } })
  return token
}

/** Resuelve la clienta + negocio + config a partir del token de "Mi tarjeta". */
export async function resolveLoyaltyCustomer(db: Db, token: string) {
  if (!token) return null
  const customer = await db.customer.findUnique({
    where: { loyaltyToken: token },
    select: {
      id: true, name: true, businessId: true,
      business: { select: { name: true, logoUrl: true, loyaltyConfig: true } },
    },
  })
  if (!customer || !customer.business) return null
  return customer
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/loyalty-token.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/token.ts tests/unit/loyalty-token.test.ts
git commit -m "feat(loyalty): ensureLoyaltyToken + resolveLoyaltyCustomer"
```

---

## Task 8: Server actions (`'use server'`)

**Files:**
- Create: `src/server/actions/loyalty.ts`
- Test: `tests/unit/loyalty-actions.test.ts`

Convenciones: **solo funciones async exportadas**; `revalidatePath` con `await`. Auth con `requireBusiness()` / `requireBusinessRole(['owner','admin'])` (de `@/lib/auth/server`). Rate-limit `checkRateLimit(key, limit, windowMs)` (de `@/lib/rate-limit`).

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'b1' }),
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'b1', user: { id: 'u1' } }),
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: {
  customer: { findFirst: vi.fn() },
  $transaction: vi.fn(),
} }))

import { adjustCustomerPoints } from '@/server/actions/loyalty'
import { prisma } from '@/lib/db'

beforeEach(() => vi.clearAllMocks())

describe('adjustCustomerPoints', () => {
  it('rechaza si dejaría el saldo negativo', async () => {
    ;(prisma.customer.findFirst as any).mockResolvedValue({ id: 'c1', businessId: 'b1' })
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn({
      loyaltyLedger: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { points: 10 } }),
        create: vi.fn(),
      },
    }))
    await expect(adjustCustomerPoints('c1', -50, 'x')).rejects.toThrow()
  })
  it('rechaza clienta de otro negocio', async () => {
    ;(prisma.customer.findFirst as any).mockResolvedValue(null)
    await expect(adjustCustomerPoints('c1', 10, 'x')).rejects.toThrow()
  })
  it('inserta el ajuste cuando el saldo queda >= 0', async () => {
    ;(prisma.customer.findFirst as any).mockResolvedValue({ id: 'c1', businessId: 'b1' })
    const create = vi.fn().mockResolvedValue({})
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn({
      loyaltyLedger: { aggregate: vi.fn().mockResolvedValue({ _sum: { points: 100 } }), create },
    }))
    await adjustCustomerPoints('c1', -50, 'cortesía')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customerId: 'c1', points: -50, reason: 'adjustment', note: 'cortesía', createdByUserId: 'u1' }),
    }))
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/loyalty-actions.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar `src/server/actions/loyalty.ts`**

```ts
'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { loyaltyConfigSchema, adjustPointsSchema } from '@/lib/loyalty/schema'
import { getLoyaltyBalance, getLoyaltyHistory } from '@/lib/loyalty/balance'

export async function getLoyaltyConfig() {
  const { businessId } = await requireBusiness()
  return prisma.loyaltyConfig.findUnique({ where: { businessId } })
}

export async function upsertLoyaltyConfig(data: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('loyalty-config', 30, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = loyaltyConfigSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }
  const d = parsed.data
  const saved = await prisma.loyaltyConfig.upsert({
    where: { businessId },
    create: { businessId, ...d, updatedByUserId: user.id },
    update: { ...d, updatedByUserId: user.id },
  })
  await revalidatePath('/dashboard/fidelizacion')
  return saved
}

export async function getCustomerLoyalty(customerId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } })
  if (!customer) throw new ForbiddenError('Clienta no encontrada')
  const [balance, history] = await Promise.all([
    getLoyaltyBalance(prisma, customerId),
    getLoyaltyHistory(prisma, customerId, 50),
  ])
  return { balance, history }
}

export async function adjustCustomerPoints(customerId: string, delta: unknown, note: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('loyalty-adjust', 30, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = adjustPointsSchema.safeParse({ delta, note })
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } })
  if (!customer) throw new ForbiddenError('Clienta no encontrada')

  // sum + insert en la MISMA tx para evitar TOCTOU en el chequeo de saldo >= 0.
  await prisma.$transaction(async (tx) => {
    const agg = await tx.loyaltyLedger.aggregate({ where: { customerId }, _sum: { points: true } })
    const balance = agg._sum.points ?? 0
    if (balance + parsed.data.delta < 0) {
      throw new Error('El ajuste dejaría el saldo en negativo')
    }
    await tx.loyaltyLedger.create({
      data: {
        businessId, customerId, points: parsed.data.delta, reason: 'adjustment',
        note: parsed.data.note, createdByUserId: user.id,
        metadata: { previousBalance: balance },
      },
    })
  })
  await revalidatePath(`/dashboard/customers/${customerId}`)
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/loyalty-actions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/loyalty.ts tests/unit/loyalty-actions.test.ts
git commit -m "feat(loyalty): server actions config + ajuste (TOCTOU-safe)"
```

---

## Task 8b: Verificar la regla `'use server'` (solo async)

**Files:** ninguno nuevo (chequeo).

- [ ] **Step 1: Confirmar que `loyalty.ts` no exporta no-funciones**

Run: `grep -nE "^export (const|type|interface|enum|class) " src/server/actions/loyalty.ts || echo "OK solo async"`
Expected: `OK solo async` (los tipos viven en `src/lib/loyalty/*`). Ver memoria `use-server-export-boundary-pitfall`.

- [ ] **Step 2: Confirmar que todo `revalidatePath` está awaiteado**

Run: `grep -nE "revalidatePath" src/server/actions/loyalty.ts`
Expected: cada ocurrencia precedida de `await`. Ver memoria `revalidate-must-be-awaited`.

---

## Task 9: Wire earn en `updateBookingStatus`

**Files:**
- Modify: `src/server/actions/bookings.ts` (función `updateBookingStatus`, ~381–452)

- [ ] **Step 1: Importar el helper y la config**

Al tope de `src/server/actions/bookings.ts`, junto a los otros imports:

```ts
import { creditVisitPoints } from '@/lib/loyalty/credit'
```

- [ ] **Step 2: Cargar la config antes de la transacción**

Dentro de `updateBookingStatus`, después del chequeo de `VALID_STATUS_TRANSITIONS` y antes de `const updateResult = await prisma.$transaction(...)`, agregar:

```ts
  // Config de fidelización (puede ser null si el negocio no la activó nunca).
  const loyaltyConfig =
    status === BookingStatus.completed
      ? await prisma.loyaltyConfig.findUnique({ where: { businessId } })
      : null
```

- [ ] **Step 3: Acreditar dentro de la transacción existente**

Dentro del `prisma.$transaction(async (tx) => { ... })`, después del bloque que libera el canje en `cancelled`/`no_show` y antes del `return res`, agregar:

```ts
    if (res.count > 0 && status === BookingStatus.completed && loyaltyConfig?.isActive) {
      await creditVisitPoints(tx, {
        businessId,
        customerId: existing.customerId,
        finalAmount: existing.finalAmount,
        bookingId: id,
        config: loyaltyConfig,
      })
    }
```

> `existing.customerId` y `existing.finalAmount` son escalares ya presentes (el fetch usa `include`, que NO recorta escalares). `creditVisitPoints` es idempotente por la unique `(bookingId, 'visit')`.

- [ ] **Step 4: Escribir/ajustar un test de integración del wiring**

Crear `tests/unit/loyalty-booking-credit.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { creditVisitPoints } from '@/lib/loyalty/credit'

// El wiring real corre dentro de updateBookingStatus; aquí verificamos el contrato
// que ese call site usa: programa activo + completed => un asiento visit.
describe('wiring earn', () => {
  it('acredita el total calculado al completar', async () => {
    const create = vi.fn().mockResolvedValue({})
    const tx = { loyaltyLedger: { create } } as any
    await creditVisitPoints(tx, {
      businessId: 'b1', customerId: 'c1', finalAmount: 20000, bookingId: 'bk1',
      config: { isActive: true, pointsPerVisit: 5, spendPerPoint: 1000, minSpendToEarn: null },
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ points: 25, reason: 'visit', bookingId: 'bk1' }),
    }))
  })
})
```

- [ ] **Step 5: Correr tests + typecheck**

Run: `npx vitest run tests/unit/loyalty-booking-credit.test.ts && npx tsc --noEmit`
Expected: PASS + sin errores de tipos.

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/bookings.ts tests/unit/loyalty-booking-credit.test.ts
git commit -m "feat(loyalty): acreditar puntos al completar reserva"
```

---

## Task 10: Wire clawback en el webhook de Mercado Pago

**Files:**
- Modify: `src/app/api/webhooks/mercado-pago/route.ts` (branch `refunded`, ~423–433)

- [ ] **Step 1: Importar el helper**

Junto a `import { releaseRedemptionForBooking } from '@/lib/promotions/release'`:

```ts
import { reverseVisitPoints } from '@/lib/loyalty/credit'
```

- [ ] **Step 2: Reversar en el mismo `$transaction` del refund**

Dentro del `await prisma.$transaction(async (tx) => { ... })` del branch `refunded`, justo después de la línea `await releaseRedemptionForBooking(tx, payment.bookingId, 'refunded')`:

```ts
        if (finalStatus === 'refunded' && payment.bookingId) {
          await reverseVisitPoints(tx, payment.bookingId)
        }
```

> Mantener el `releaseRedemptionForBooking` existente; esto se agrega a continuación, en la misma tx y bajo la misma guarda `finalStatus === 'refunded' && payment.bookingId`.

- [ ] **Step 3: Agregar un caso al test del webhook**

En `tests/unit/mercado-pago-webhook.test.ts`, agregar un test que verifique que en `refunded` se llama la reversa. Seguir el estilo de mock existente del archivo (mock de `@/lib/db` con `$transaction`). Test:

```ts
it('reversa puntos de fidelización en refund', async () => {
  // Arrange: payment con bookingId, mpStatus 'refunded'. (Reusar el harness del archivo.)
  // Assert: dentro de la tx, loyaltyLedger.findUnique('visit') seguido de create('visit_reversal'),
  // o spy sobre reverseVisitPoints si el archivo ya hace vi.mock de '@/lib/loyalty/credit'.
})
```

> El implementador adapta el assert al harness real del archivo (puede `vi.mock('@/lib/loyalty/credit')` y verificar que `reverseVisitPoints` fue llamado con el `bookingId`).

- [ ] **Step 4: Correr tests + typecheck**

Run: `npx vitest run tests/unit/mercado-pago-webhook.test.ts && npx tsc --noEmit`
Expected: PASS + sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/mercado-pago/route.ts tests/unit/mercado-pago-webhook.test.ts
git commit -m "feat(loyalty): clawback de puntos al reembolsar (webhook MP)"
```

---

## Task 11: Línea "Mi tarjeta" en notificaciones

**Files:**
- Modify: `src/lib/notifications/types.ts`, `templates.ts`, `whatsapp.ts`
- Modify: `src/server/actions/bookings.ts` (confirmación) y `src/server/actions/reviews.ts` (completada)
- Test: `tests/unit/notifications.test.ts` (agregar casos)

- [ ] **Step 1: Agregar el campo opcional a los tipos**

En `src/lib/notifications/types.ts`, agregar `loyaltyCardLink?: string` a **`BookingEmailData`** (~8, la que ya tiene `reviewLink?`, usada por confirmación) y a **`ReviewRequestEmailData`** (~38, la del pedido de reseña):

```ts
  loyaltyCardLink?: string
```

- [ ] **Step 2: Renderizar la sección en el template de email**

En `src/lib/notifications/templates.ts`, dentro de `bookingConfirmationCustomerHtml` (~44–77), junto a `reviewSection` (~54) agregar:

```ts
  const loyaltySection = data.loyaltyCardLink
    ? `<p style="margin-top:16px"><a href="${data.loyaltyCardLink}" style="color:#e91e63;text-decoration:none;font-weight:600">Ver mi tarjeta de puntos</a></p>`
    : ''
```

E incluir `${loyaltySection}` en el cuerpo (junto a `${reviewSection}`, ~73). En la versión texto `bookingConfirmationCustomerText` (~78–105), junto al push de `reviewLink` (~99) agregar:

```ts
  if (data.loyaltyCardLink) lines.push(``, `Tu tarjeta de puntos: ${data.loyaltyCardLink}`)
```

Replicar el mismo par de cambios (HTML + texto) en `reviewRequestHtml` (~257) y `reviewRequestText` (~270) para que el link también vaya en el pedido de reseña al completar.

- [ ] **Step 3: Renderizar en WhatsApp**

En `src/lib/notifications/whatsapp.ts`, donde se arma el cuerpo del mensaje correspondiente, agregar una línea condicional:

```ts
  if (data.loyaltyCardLink) body += `\n\nTu tarjeta de puntos: ${data.loyaltyCardLink}`
```

- [ ] **Step 4: Construir y pasar el link en la confirmación (bookings.ts)**

En `src/server/actions/bookings.ts`, en la función que dispara las notificaciones de confirmación al cliente (la que ya construye `cleanDomain`/`protocol`), después de tener el `customer` y antes de enviar:

```ts
  const loyaltyConfig = await prisma.loyaltyConfig.findUnique({ where: { businessId: business.id } })
  let loyaltyCardLink: string | undefined
  if (loyaltyConfig?.isActive) {
    const token = await ensureLoyaltyToken(prisma, { id: booking.customer.id, loyaltyToken: booking.customer.loyaltyToken ?? null })
    loyaltyCardLink = `${protocol}://${cleanDomain}/tarjeta/${token}`
  }
```

Agregar `loyaltyCardLink` al payload de `sendBookingReceivedToCustomer(...)`. Importar `ensureLoyaltyToken` de `@/lib/loyalty/token`. Asegurar que el `booking.customer` cargado incluya `id` y `loyaltyToken` (ajustar el `select`/`include` si hace falta).

- [ ] **Step 5: Construir y pasar el link en el pedido de reseña (reviews.ts)**

En `src/server/actions/reviews.ts`, donde se arma `reviewLink` (~390/444) y se conoce el `booking.customer`, agregar análogamente (la config se puede cargar por `businessId` del booking):

```ts
  const loyaltyConfig = await prisma.loyaltyConfig.findUnique({ where: { businessId: booking.businessId } })
  let loyaltyCardLink: string | undefined
  if (loyaltyConfig?.isActive) {
    const token = await ensureLoyaltyToken(prisma, { id: booking.customer.id, loyaltyToken: booking.customer.loyaltyToken ?? null })
    loyaltyCardLink = `${proto}://${host}/tarjeta/${token}`
  }
```

Pasar `loyaltyCardLink` al payload de la notificación de reseña. Ajustar el `select` del `customer` para incluir `id` y `loyaltyToken`.

- [ ] **Step 6: Tests de template**

En `tests/unit/notifications.test.ts`, agregar:

```ts
import { bookingConfirmationCustomerHtml } from '@/lib/notifications/templates'

it('incluye el link de Mi tarjeta cuando se provee', () => {
  const html = bookingConfirmationCustomerHtml({ ...baseData, loyaltyCardLink: 'https://x.test/tarjeta/abc' })
  expect(html).toContain('/tarjeta/abc')
  expect(html).toContain('tarjeta de puntos')
})
it('omite la sección si no hay link', () => {
  const html = bookingConfirmationCustomerHtml({ ...baseData, loyaltyCardLink: undefined })
  expect(html).not.toContain('tarjeta de puntos')
})
```

> `baseData` = un `BookingEmailData` válido (reusar el que ya arma los casos de `reviewLink` en el archivo).

- [ ] **Step 7: Correr tests + typecheck**

Run: `npx vitest run tests/unit/notifications.test.ts && npx tsc --noEmit`
Expected: PASS + sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/lib/notifications src/server/actions/bookings.ts src/server/actions/reviews.ts tests/unit/notifications.test.ts
git commit -m "feat(loyalty): link 'Mi tarjeta' en confirmación y pedido de reseña"
```

---

## Task 12: Página pública "Mi tarjeta"

**Files:**
- Create: `src/app/tarjeta/[token]/page.tsx`

> Antes de escribir: leer `node_modules/next/dist/docs` sobre `params` async y `export const metadata` en esta versión de Next. En Next 16 (modificado) `params` puede ser `Promise`.

- [ ] **Step 1: Implementar la página (server component, noindex)**

```tsx
import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { resolveLoyaltyCustomer } from '@/lib/loyalty/token'
import { getLoyaltyBalance, getLoyaltyHistory } from '@/lib/loyalty/balance'
import { loyaltyReasonLabel, displayBalance } from '@/lib/loyalty/view'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function LoyaltyCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const customer = await resolveLoyaltyCustomer(prisma, token)

  if (!customer) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">Tarjeta no disponible</h1>
        <p className="mt-2 text-gray-500">El enlace no es válido o ya no está activo.</p>
      </main>
    )
  }

  const config = customer.business.loyaltyConfig
  const [balance, history] = await Promise.all([
    getLoyaltyBalance(prisma, customer.id),
    getLoyaltyHistory(prisma, customer.id, 50),
  ])
  const label = config?.pointsLabel ?? 'puntos'
  const firstName = customer.name.split(' ')[0]

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      {customer.business.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={customer.business.logoUrl} alt={customer.business.name} className="mx-auto mb-4 h-12 w-auto" />
      )}
      <h1 className="text-center text-lg font-semibold">{config?.programName ?? 'Mi tarjeta'}</h1>
      <p className="text-center text-sm text-gray-500">Hola, {firstName}</p>

      {config?.isActive === false && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-center text-sm text-amber-700">
          El programa está pausado por el momento.
        </p>
      )}

      <div className="mt-6 rounded-2xl bg-pink-50 py-8 text-center">
        <div className="text-4xl font-bold text-pink-600">{displayBalance(balance)}</div>
        <div className="text-sm text-pink-700">{label}</div>
      </div>

      {config?.cardMessage && (
        <p className="mt-4 text-center text-sm text-gray-500">{config.cardMessage}</p>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Movimientos</h2>
        {history.length === 0 ? (
          <p className="text-sm text-gray-400">Todavía no tienes movimientos.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-gray-600">
                  {loyaltyReasonLabel(h.reason)}
                  <span className="ml-2 text-gray-400">
                    {new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short' }).format(h.createdAt)}
                  </span>
                </span>
                <span className={h.points >= 0 ? 'font-medium text-green-600' : 'font-medium text-gray-500'}>
                  {h.points >= 0 ? '+' : ''}{h.points}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
```

> `new Intl.DateTimeFormat('es-CL', …)` aplica solo a **fechas** (no es formato de moneda), así que no viola la regla currency-clean. Los puntos se muestran como número crudo + `label`.

- [ ] **Step 2: Verificar render manual (dev)**

Run: `npm run dev` y abrir `http://localhost:3000/tarjeta/<token-de-prueba>` (crear una clienta con `loyaltyToken` y unos asientos en la DB local).
Expected: muestra saldo + movimientos; token inválido → "Tarjeta no disponible".

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/app/tarjeta
git commit -m "feat(loyalty): página pública 'Mi tarjeta' (noindex)"
```

---

## Task 13: Panel de la dueña — config + ítem de sidebar

**Files:**
- Create: `src/app/dashboard/fidelizacion/page.tsx`, `src/app/dashboard/fidelizacion/loyalty-config-form.tsx`
- Modify: `src/components/dashboard/sidebar.tsx`

- [ ] **Step 1: Agregar el ítem al sidebar**

En `src/components/dashboard/sidebar.tsx`, importar `Sparkles` de `lucide-react` y agregar a la lista de items (después de Promociones):

```ts
  { href: '/dashboard/fidelizacion', label: 'Fidelización', icon: Sparkles },
```

- [ ] **Step 2: Página server que carga la config**

`src/app/dashboard/fidelizacion/page.tsx`:

```tsx
import { getLoyaltyConfig } from '@/server/actions/loyalty'
import { LoyaltyConfigForm } from './loyalty-config-form'

export default async function FidelizacionPage() {
  const config = await getLoyaltyConfig()
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-1 text-2xl font-semibold">Fidelización</h1>
      <p className="mb-6 text-sm text-gray-500">Programa de puntos para tus clientas.</p>
      <LoyaltyConfigForm config={config} />
    </div>
  )
}
```

- [ ] **Step 3: Form client component**

`src/app/dashboard/fidelizacion/loyalty-config-form.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { upsertLoyaltyConfig } from '@/server/actions/loyalty'
import type { LoyaltyConfig } from '@prisma/client'

export function LoyaltyConfigForm({ config }: { config: LoyaltyConfig | null }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null); setSaved(false)
    const fd = new FormData(e.currentTarget)
    const data = {
      isActive: fd.get('isActive') === 'on',
      programName: String(fd.get('programName') ?? ''),
      pointsLabel: String(fd.get('pointsLabel') ?? 'puntos'),
      pointsPerVisit: Number(fd.get('pointsPerVisit') ?? 0),
      spendPerPoint: fd.get('spendPerPoint') ? Number(fd.get('spendPerPoint')) : null,
      minSpendToEarn: fd.get('minSpendToEarn') ? Number(fd.get('minSpendToEarn')) : null,
      cardMessage: String(fd.get('cardMessage') ?? '') || null,
    }
    startTransition(async () => {
      try { await upsertLoyaltyConfig(data); setSaved(true) }
      catch (err) { setError(err instanceof Error ? err.message : 'Error al guardar') }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="isActive" defaultChecked={config?.isActive ?? false} />
        <span>Programa activo</span>
      </label>
      <Field name="programName" label="Nombre del programa" defaultValue={config?.programName ?? ''} required />
      <Field name="pointsLabel" label="Nombre de la unidad (ej. puntos, estrellas)" defaultValue={config?.pointsLabel ?? 'puntos'} />
      <Field name="pointsPerVisit" label="Puntos por visita" type="number" defaultValue={String(config?.pointsPerVisit ?? 0)} />
      <Field name="spendPerPoint" label="Pesos por punto (cada $X = 1 punto; vacío = off)" type="number" defaultValue={config?.spendPerPoint != null ? String(config.spendPerPoint) : ''} />
      <Field name="minSpendToEarn" label="Gasto mínimo para acreditar (vacío = sin mínimo)" type="number" defaultValue={config?.minSpendToEarn != null ? String(config.minSpendToEarn) : ''} />
      <Field name="cardMessage" label="Mensaje en la tarjeta (opcional)" defaultValue={config?.cardMessage ?? ''} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-600">Guardado.</p>}
      <button type="submit" disabled={isPending} className="rounded-md bg-pink-600 px-4 py-2 text-white disabled:opacity-50">
        {isPending ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  )
}

function Field({ name, label, defaultValue, type = 'text', required = false }: {
  name: string; label: string; defaultValue: string; type?: string; required?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <input name={name} type={type} defaultValue={defaultValue} required={required}
        className="w-full rounded-md border border-gray-300 px-3 py-2" />
    </label>
  )
}
```

- [ ] **Step 4: Typecheck + render manual**

Run: `npx tsc --noEmit`
Expected: sin errores. Abrir `/dashboard/fidelizacion`, guardar una config, verificar persistencia.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/fidelizacion src/components/dashboard/sidebar.tsx
git commit -m "feat(loyalty): página de configuración + ítem de sidebar"
```

---

## Task 14: Panel de puntos en el detalle de clienta

**Files:**
- Create: `src/app/dashboard/customers/[id]/loyalty-panel.tsx`
- Modify: `src/app/dashboard/customers/[id]/page.tsx`

- [ ] **Step 1: Implementar el panel (client) con saldo + historial + ajuste**

`src/app/dashboard/customers/[id]/loyalty-panel.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { adjustCustomerPoints } from '@/server/actions/loyalty'
import { loyaltyReasonLabel, displayBalance } from '@/lib/loyalty/view'
import type { LoyaltyLedger } from '@prisma/client'

export function LoyaltyPanel({ customerId, balance, history, label }: {
  customerId: string
  balance: number
  history: Array<Pick<LoyaltyLedger, 'id' | 'points' | 'reason' | 'note' | 'createdAt'>>
  label: string
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onAdjust(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const delta = Number(fd.get('delta') ?? 0)
    const note = String(fd.get('note') ?? '')
    startTransition(async () => {
      try { await adjustCustomerPoints(customerId, delta, note); e.currentTarget?.reset?.() }
      catch (err) { setError(err instanceof Error ? err.message : 'Error') }
    })
  }

  return (
    <section className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Fidelización</h2>
        <span className="text-2xl font-bold text-pink-600">{displayBalance(balance)} <span className="text-sm font-normal text-gray-500">{label}</span></span>
      </div>

      <form onSubmit={onAdjust} className="mt-3 flex flex-wrap items-end gap-2">
        <input name="delta" type="number" placeholder="±puntos" required className="w-28 rounded-md border border-gray-300 px-2 py-1" />
        <input name="note" type="text" placeholder="Motivo" required className="flex-1 rounded-md border border-gray-300 px-2 py-1" />
        <button type="submit" disabled={isPending} className="rounded-md bg-gray-800 px-3 py-1 text-sm text-white disabled:opacity-50">Ajustar</button>
      </form>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}

      <ul className="mt-3 divide-y divide-gray-100">
        {history.map((h) => (
          <li key={h.id} className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-gray-600">{loyaltyReasonLabel(h.reason)}{h.note ? ` · ${h.note}` : ''}</span>
            <span className={h.points >= 0 ? 'text-green-600' : 'text-gray-500'}>{h.points >= 0 ? '+' : ''}{h.points}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: Montar el panel en la página de detalle**

En `src/app/dashboard/customers/[id]/page.tsx`, importar `getCustomerLoyalty` y `getLoyaltyConfig`, cargar los datos y renderizar `<LoyaltyPanel/>` en el layout existente:

```tsx
import { getCustomerLoyalty, getLoyaltyConfig } from '@/server/actions/loyalty'
import { LoyaltyPanel } from './loyalty-panel'
// ...dentro del componente, junto a las otras cargas:
const [{ balance, history }, loyaltyConfig] = await Promise.all([
  getCustomerLoyalty(id),
  getLoyaltyConfig(),
])
// ...en el JSX:
<LoyaltyPanel customerId={id} balance={balance} history={history} label={loyaltyConfig?.pointsLabel ?? 'puntos'} />
```

> Ajustar `id` al nombre real del param en esa página (puede venir de `await params`). Seguir el patrón de carga que ya use la página.

- [ ] **Step 3: Typecheck + render manual**

Run: `npx tsc --noEmit`
Expected: sin errores. Abrir el detalle de una clienta, hacer un ajuste, ver el movimiento.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/customers/[id]
git commit -m "feat(loyalty): panel de puntos + ajuste en detalle de clienta"
```

---

## Task 15: Suite completa + lint + e2e + migración a prod + PR

**Files:** ninguno nuevo (verificación e integración).

- [ ] **Step 1: Suite unitaria completa**

Run: `npx vitest run`
Expected: toda la suite verde (los ~74 archivos previos + los nuevos de loyalty).

- [ ] **Step 2: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sin errores. Confirmar que el build no rompió ninguna ruta.

- [ ] **Step 3: Grep currency-clean en código nuevo**

Run: `grep -rnE "toLocaleString\('es-CL'\)|\\\$\{.*\}\s*CLP" src/lib/loyalty src/app/tarjeta src/app/dashboard/fidelizacion || echo "OK currency-clean"`
Expected: `OK currency-clean` (los puntos no usan formato de moneda; cualquier monto real usa `formatMoney`).

- [ ] **Step 4: E2E manual del loop completo (DB local o staging)**

Verificar en orden:
1. Prender el programa en `/dashboard/fidelizacion` (pointsPerVisit + spendPerPoint).
2. Crear una reserva, completarla (`updateBookingStatus(completed)`).
3. Confirmar en DB un asiento `LoyaltyLedger` `reason=visit` con el `total` correcto y `metadata` con desglose.
4. Abrir `/tarjeta/<token>` y ver el saldo.
5. Ajuste manual desde el detalle de clienta; confirmar asiento `adjustment` y que rechaza saldo negativo.
6. (Si hay flujo MP de refund disponible) reembolsar y confirmar asiento `visit_reversal`.

- [ ] **Step 5: PR (sin aplicar prod todavía)**

```bash
git push -u origin feat/loyalty-points-B1
gh pr create --title "feat(loyalty): núcleo de puntos (rebanada B1)" --body "Implementa B1 del roadmap de fidelización: LoyaltyConfig + LoyaltyLedger append-only, earn al completar (server-authoritative), clawback en refund, ajuste manual, 'Mi tarjeta' por link mágico. Spec: docs/superpowers/specs/2026-06-29-loyalty-points-B1-design.md"
```

- [ ] **Step 6: Aplicar la migración a PROD — SOLO con confirmación explícita del usuario**

> **GATE:** No ejecutar sin un "sí" explícito del usuario en el momento (igual que A).

Run (tras confirmación): `npx prisma migrate deploy`
Expected: aplica únicamente `<timestamp>_add_loyalty` (aditiva). Verificar con `npx prisma migrate status` que quedó al día.

- [ ] **Step 7: Merge**

Tras CI verde + confirmación: squash-merge del PR a `main`.

---

## Notas de ejecución (subagent-driven)

- Tasks 2–8 son **lógica pura / aislada** → modelo barato. Tasks 9–11 (wiring en booking/webhook/notifs) tocan archivos grandes y compartidos → modelo estándar, cuidado con los `select`/`include`. Tasks 12–14 (UI) → estándar; leer `node_modules/next/dist/docs` para `params` async y `metadata`.
- Revisar entre tasks: spec-compliance primero, luego code-quality (dos etapas).
- La migración **no** se aplica a prod hasta la Task 15 Step 6 con confirmación.
