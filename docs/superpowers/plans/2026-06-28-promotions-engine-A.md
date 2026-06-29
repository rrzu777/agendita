# Motor de Promociones (rebanada A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el motor de promociones por código (descuentos %/fijo/gratis) aplicado server-side a las reservas pública y manual, con panel de gestión y reporte de canjes.

**Architecture:** `Promotion` (condición+recompensa+límites) + `PromotionRedemption` (libro de canjes). Lógica pura y testeable en `@/lib/promotions/`; los server actions (`'use server'`) solo orquestan. El descuento se recalcula y persiste dentro de la transacción de creación de reserva, **antes** de cualquier `Payment`/preferencia Mercado Pago, escribiendo `Booking.discountAmount`/`finalAmount`/`depositRequired` capeado. Los canjes se liberan (cancel/no-show/hold-vencido/reembolso) con decremento atómico del contador.

**Tech Stack:** Next.js 16, React 19, Prisma 5 + Postgres (Supabase), Zod, Vitest (unit), Playwright (e2e), Tailwind 4.

**Spec de referencia:** `docs/superpowers/specs/2026-06-28-promotions-engine-design.md`

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/money.ts` | `formatMoney(monto, currency)` — formateo currency-agnostic (Crear) |
| `prisma/schema.prisma` | modelos `Promotion`/`PromotionRedemption` + enums + relaciones (Modificar) |
| `prisma/migrations/<ts>_add_promotions/migration.sql` | migración aditiva (Crear) |
| `src/lib/promotions/schema.ts` | zod create/update + normalización de código + tipos (Crear) |
| `src/lib/promotions/evaluate.ts` | `isRedeemable()` + `computeDiscount()` puros (Crear) |
| `src/lib/promotions/release.ts` | `releaseRedemptionForBooking(tx, bookingId, reason)` + `reconcileRedemptionCount()` (Crear) |
| `src/server/actions/promotions.ts` | `'use server'` CRUD + `previewPromotion` + reporte (Crear) |
| `src/lib/rate-limit.ts` | entrada `preview-promotion` (Modificar) |
| `src/server/actions/bookings.ts` | aplicar descuento en create (público/manual) + release en cancel/no-show (Modificar) |
| `src/lib/cron/expire-holds.ts` | liberar canjes de expiradas (Modificar) |
| `src/app/api/webhooks/mercado-pago/route.ts` | liberar canje en refund/charged-back (Modificar) |
| `src/components/booking/wizard.tsx`, `step-payment.tsx` | campo de código + preview (Modificar) |
| `src/app/dashboard/bookings/new/new-booking-form.tsx` | campo de código (Modificar) |
| `src/components/dashboard/sidebar.tsx` | ítem "Promociones" (Modificar) |
| `src/app/dashboard/promociones/*` | lista, form, reporte, export (Crear) |
| `tests/unit/*`, `tests/e2e/*` | cobertura |

---

## Task 1: `formatMoney` helper (currency-clean)

**Files:**
- Create: `src/lib/money.ts`
- Test: `tests/unit/money.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/money.test.ts
import { describe, it, expect } from 'vitest'
import { formatMoney } from '@/lib/money'

describe('formatMoney', () => {
  it('formats CLP without decimals', () => {
    expect(formatMoney(20000, 'CLP')).toBe('$20.000')
  })
  it('formats 0', () => {
    expect(formatMoney(0, 'CLP')).toBe('$0')
  })
  it('falls back to CLP when currency is missing', () => {
    expect(formatMoney(1500)).toBe('$1.500')
  })
  it('formats a 2-decimal currency in minor-agnostic whole units (USD)', () => {
    // A: amounts are whole units; decimals/minor-units son del track E.
    expect(formatMoney(20, 'USD')).toMatch(/\$?20/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/money.test.ts`
Expected: FAIL — `Cannot find module '@/lib/money'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/money.ts
const ZERO_DECIMAL = new Set(['CLP', 'JPY', 'KRW', 'PYG', 'CLF'])

/** Formatea un monto entero en la moneda del negocio. Currency-clean:
 *  usar SIEMPRE este helper en código nuevo de plata (nada de 'es-CL' hardcodeado). */
export function formatMoney(amount: number, currency = 'CLP'): string {
  const fractionDigits = ZERO_DECIMAL.has(currency) ? 0 : 2
  try {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount)
  } catch {
    return `$${amount.toLocaleString('es-CL')}`
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/money.test.ts`
Expected: PASS (4 tests). If the CLP symbol renders as `CLP$`, adjust the assertion to `toContain('20.000')` — Node ICU may prefix the ISO code; prefer `toContain` for the symbol-sensitive cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/money.ts tests/unit/money.test.ts
git commit -m "feat(money): formatMoney helper currency-agnostic"
```

---

## Task 2: Modelo Prisma + migración

**Files:**
- Modify: `prisma/schema.prisma` (modelo `Customer`, `Booking`, `Service`, `Business`; + 2 modelos nuevos + 5 enums)
- Create: `prisma/migrations/20260628100000_add_promotions/migration.sql`

- [ ] **Step 1: Add enums + models to `schema.prisma`**

Agregar al final del archivo (o junto a los demás enums/modelos):

```prisma
enum PromotionTrigger {
  code
  automatic
  granted
}

enum PromotionReward {
  percentage
  fixed_amount
  free_service
}

enum RedemptionStatus {
  applied
  released
}

enum RedemptionSource {
  public_booking
  dashboard_booking
  system
}

enum RedemptionRelease {
  cancelled
  no_show
  hold_expired
  refunded
}

model Promotion {
  id              String           @id @default(cuid())
  businessId      String
  name            String
  description     String?
  triggerType     PromotionTrigger @default(code)
  code            String?
  conditions      Json?
  rewardType      PromotionReward
  rewardValue     Int
  maxDiscount     Int?
  appliesToAll    Boolean          @default(true)
  validFrom       DateTime?
  validUntil      DateTime?
  minSpend        Int?
  maxRedemptions  Int?
  maxPerCustomer  Int?
  redemptionCount Int              @default(0)
  isActive        Boolean          @default(true)
  metadata        Json?
  createdByUserId String?
  updatedByUserId String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  business        Business              @relation(fields: [businessId], references: [id], onDelete: Cascade)
  services        Service[]             @relation("PromotionServices")
  redemptions     PromotionRedemption[]

  @@unique([businessId, code])
  @@index([businessId, isActive])
}

model PromotionRedemption {
  id              String             @id @default(cuid())
  businessId      String
  promotionId     String
  bookingId       String
  customerId      String
  discountAmount  Int
  status          RedemptionStatus   @default(applied)
  releaseReason   RedemptionRelease?
  releasedAt      DateTime?
  source          RedemptionSource
  createdByUserId String?
  metadata        Json?
  createdAt       DateTime           @default(now())

  promotion       Promotion @relation(fields: [promotionId], references: [id])
  booking         Booking   @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  customer        Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@unique([bookingId])
  @@index([businessId, promotionId])
  @@index([promotionId, customerId])
}
```

Y agregar las relaciones recíprocas:
- En `model Business { ... }`: `promotions Promotion[]`
- En `model Service { ... }`: `promotions Promotion[] @relation("PromotionServices")`
- En `model Booking { ... }`: `redemption PromotionRedemption?`
- En `model Customer { ... }`: `redemptions PromotionRedemption[]`

- [ ] **Step 2: Create the migration SQL**

```sql
-- prisma/migrations/20260628100000_add_promotions/migration.sql

-- CreateEnum
CREATE TYPE "PromotionTrigger" AS ENUM ('code', 'automatic', 'granted');
CREATE TYPE "PromotionReward" AS ENUM ('percentage', 'fixed_amount', 'free_service');
CREATE TYPE "RedemptionStatus" AS ENUM ('applied', 'released');
CREATE TYPE "RedemptionSource" AS ENUM ('public_booking', 'dashboard_booking', 'system');
CREATE TYPE "RedemptionRelease" AS ENUM ('cancelled', 'no_show', 'hold_expired', 'refunded');

-- CreateTable Promotion
CREATE TABLE "Promotion" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "triggerType" "PromotionTrigger" NOT NULL DEFAULT 'code',
  "code" TEXT,
  "conditions" JSONB,
  "rewardType" "PromotionReward" NOT NULL,
  "rewardValue" INTEGER NOT NULL,
  "maxDiscount" INTEGER,
  "appliesToAll" BOOLEAN NOT NULL DEFAULT true,
  "validFrom" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "minSpend" INTEGER,
  "maxRedemptions" INTEGER,
  "maxPerCustomer" INTEGER,
  "redemptionCount" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable PromotionRedemption
CREATE TABLE "PromotionRedemption" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "promotionId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "discountAmount" INTEGER NOT NULL,
  "status" "RedemptionStatus" NOT NULL DEFAULT 'applied',
  "releaseReason" "RedemptionRelease",
  "releasedAt" TIMESTAMP(3),
  "source" "RedemptionSource" NOT NULL,
  "createdByUserId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromotionRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable join _PromotionServices
CREATE TABLE "_PromotionServices" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL
);

-- Indexes
CREATE UNIQUE INDEX "Promotion_businessId_code_key" ON "Promotion"("businessId", "code");
CREATE INDEX "Promotion_businessId_isActive_idx" ON "Promotion"("businessId", "isActive");
CREATE UNIQUE INDEX "PromotionRedemption_bookingId_key" ON "PromotionRedemption"("bookingId");
CREATE INDEX "PromotionRedemption_businessId_promotionId_idx" ON "PromotionRedemption"("businessId", "promotionId");
CREATE INDEX "PromotionRedemption_promotionId_customerId_idx" ON "PromotionRedemption"("promotionId", "customerId");
CREATE UNIQUE INDEX "_PromotionServices_AB_unique" ON "_PromotionServices"("A", "B");
CREATE INDEX "_PromotionServices_B_index" ON "_PromotionServices"("B");

-- FKs
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_PromotionServices" ADD CONSTRAINT "_PromotionServices_A_fkey" FOREIGN KEY ("A") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_PromotionServices" ADD CONSTRAINT "_PromotionServices_B_fkey" FOREIGN KEY ("B") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

> Nota: el orden A/B del join implícito lo determina Prisma alfabéticamente (`Promotion` < `Service` → A=Promotion, B=Service). Verificar tras `prisma generate` que coincide; si Prisma genera otro orden, regenerar el SQL con `prisma migrate diff`.

- [ ] **Step 3: Generate client + validate locally (NO aplicar a prod aún)**

Run: `npx prisma generate && npx prisma validate`
Expected: sin errores. La aplicación a prod (`prisma migrate deploy`) se hace al final del plan (Task 12), no ahora.

- [ ] **Step 4: Verify the migration matches the schema (shadow-less check)**

Run: `npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --exit-code`
Expected: exit 0 ("No difference"). Si falla por shadow DB en Supabase, omitir y confiar en `prisma validate` + el build de Task 11.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260628100000_add_promotions
git commit -m "feat(db): Promotion + PromotionRedemption models and migration"
```

---

## Task 3: Zod schema + normalización de código

**Files:**
- Create: `src/lib/promotions/schema.ts`
- Test: `tests/unit/promotions-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/promotions-schema.test.ts
import { describe, it, expect } from 'vitest'
import { createPromotionSchema, normalizeCode } from '@/lib/promotions/schema'

const base = {
  name: 'Verano',
  rewardType: 'percentage' as const,
  rewardValue: 20,
  appliesToAll: true,
}

describe('normalizeCode', () => {
  it('uppercases and trims', () => {
    expect(normalizeCode('  verano20 ')).toBe('VERANO20')
  })
  it('returns null for empty', () => {
    expect(normalizeCode('')).toBeNull()
    expect(normalizeCode(null)).toBeNull()
  })
})

describe('createPromotionSchema', () => {
  it('accepts a valid percentage promo and normalizes the code', () => {
    const r = createPromotionSchema.safeParse({ ...base, code: 'verano20' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.code).toBe('VERANO20')
  })
  it('rejects percentage > 100', () => {
    expect(createPromotionSchema.safeParse({ ...base, rewardValue: 120 }).success).toBe(false)
  })
  it('rejects negative fixed amount', () => {
    expect(createPromotionSchema.safeParse({ ...base, rewardType: 'fixed_amount', rewardValue: -1 }).success).toBe(false)
  })
  it('rejects validUntil before validFrom', () => {
    const r = createPromotionSchema.safeParse({ ...base, validFrom: '2026-07-10', validUntil: '2026-07-01' })
    expect(r.success).toBe(false)
  })
  it('requires services when appliesToAll is false', () => {
    const r = createPromotionSchema.safeParse({ ...base, appliesToAll: false, serviceIds: [] })
    expect(r.success).toBe(false)
  })
  it('free_service forces rewardValue 0', () => {
    const r = createPromotionSchema.safeParse({ ...base, rewardType: 'free_service', rewardValue: 999 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.rewardValue).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/promotions-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/promotions/schema.ts
import { z } from 'zod'

export function normalizeCode(code: string | null | undefined): string | null {
  if (!code) return null
  const t = code.trim().toUpperCase()
  return t === '' ? null : t
}

const dateStr = z.string().trim().optional().nullable().or(z.literal(''))
  .transform((v) => (v ? v : null))

export const createPromotionSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(100),
  description: z.string().trim().max(500).optional().nullable().or(z.literal('')).transform((v) => (v ? v : null)),
  code: z.string().trim().max(40).optional().nullable().or(z.literal(''))
    .transform((v) => normalizeCode(v))
    .refine((v) => v === null || /^[A-Z0-9_-]{2,40}$/.test(v), 'Código inválido (2–40, A–Z 0–9 _ -)'),
  rewardType: z.enum(['percentage', 'fixed_amount', 'free_service']),
  rewardValue: z.number().int().nonnegative(),
  maxDiscount: z.number().int().positive().optional().nullable(),
  appliesToAll: z.boolean(),
  serviceIds: z.array(z.string().min(1)).optional().default([]),
  validFrom: dateStr,
  validUntil: dateStr,
  minSpend: z.number().int().nonnegative().optional().nullable(),
  maxRedemptions: z.number().int().positive().optional().nullable(),
  maxPerCustomer: z.number().int().positive().optional().nullable(),
})
  .transform((d) => (d.rewardType === 'free_service' ? { ...d, rewardValue: 0 } : d))
  .refine((d) => d.rewardType !== 'percentage' || (d.rewardValue >= 1 && d.rewardValue <= 100),
    { message: 'El porcentaje debe estar entre 1 y 100', path: ['rewardValue'] })
  .refine((d) => d.appliesToAll || d.serviceIds.length > 0,
    { message: 'Elige al menos un servicio o aplica a todos', path: ['serviceIds'] })
  .refine((d) => !d.validFrom || !d.validUntil || new Date(d.validUntil) > new Date(d.validFrom),
    { message: 'La fecha de fin debe ser posterior a la de inicio', path: ['validUntil'] })

export const updatePromotionSchema = createPromotionSchema

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>
```

> Pitfall: este archivo es **lib puro** (no `'use server'`), por eso puede exportar tipos/schemas libremente.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/promotions-schema.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/promotions/schema.ts tests/unit/promotions-schema.test.ts
git commit -m "feat(promotions): zod schema + code normalization"
```

---

## Task 4: Motor puro `isRedeemable` + `computeDiscount`

**Files:**
- Create: `src/lib/promotions/evaluate.ts`
- Test: `tests/unit/promotions-evaluate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/promotions-evaluate.test.ts
import { describe, it, expect } from 'vitest'
import { computeDiscount, isRedeemable } from '@/lib/promotions/evaluate'

const now = new Date('2026-07-01T12:00:00Z')
function promo(over: Partial<Parameters<typeof isRedeemable>[0]['promo']> = {}) {
  return {
    isActive: true, validFrom: null, validUntil: null,
    maxRedemptions: null, maxPerCustomer: null, minSpend: null,
    appliesToAll: true, serviceIds: [] as string[],
    rewardType: 'percentage' as const, rewardValue: 20, maxDiscount: null,
    redemptionCount: 0, ...over,
  }
}

describe('computeDiscount', () => {
  it('percentage floors', () => {
    expect(computeDiscount(promo({ rewardValue: 15 }), 19990)).toBe(2998) // floor(2998.5)
  })
  it('percentage respects maxDiscount', () => {
    expect(computeDiscount(promo({ rewardValue: 50, maxDiscount: 5000 }), 20000)).toBe(5000)
  })
  it('fixed never exceeds total', () => {
    expect(computeDiscount(promo({ rewardType: 'fixed_amount', rewardValue: 30000 }), 20000)).toBe(20000)
  })
  it('free_service discounts the full total', () => {
    expect(computeDiscount(promo({ rewardType: 'free_service', rewardValue: 0 }), 20000)).toBe(20000)
  })
})

describe('isRedeemable', () => {
  const ctx = { serviceId: 'svc1', totalPrice: 20000, customerRedemptions: 0, now }
  it('ok by default', () => {
    expect(isRedeemable({ promo: promo(), ...ctx }).ok).toBe(true)
  })
  it('blocks inactive', () => {
    expect(isRedeemable({ promo: promo({ isActive: false }), ...ctx }).ok).toBe(false)
  })
  it('blocks outside window', () => {
    expect(isRedeemable({ promo: promo({ validUntil: new Date('2026-06-30T00:00:00Z') }), ...ctx }).ok).toBe(false)
  })
  it('blocks when sold out', () => {
    expect(isRedeemable({ promo: promo({ maxRedemptions: 5, redemptionCount: 5 }), ...ctx }).ok).toBe(false)
  })
  it('allows unlimited (maxRedemptions null)', () => {
    expect(isRedeemable({ promo: promo({ maxRedemptions: null, redemptionCount: 999 }), ...ctx }).ok).toBe(true)
  })
  it('blocks when customer over per-customer cap', () => {
    expect(isRedeemable({ promo: promo({ maxPerCustomer: 1 }), ...ctx, customerRedemptions: 1 }).ok).toBe(false)
  })
  it('blocks below minSpend', () => {
    expect(isRedeemable({ promo: promo({ minSpend: 25000 }), ...ctx }).ok).toBe(false)
  })
  it('blocks service out of scope', () => {
    expect(isRedeemable({ promo: promo({ appliesToAll: false, serviceIds: ['other'] }), ...ctx }).ok).toBe(false)
  })
  it('allows service in scope', () => {
    expect(isRedeemable({ promo: promo({ appliesToAll: false, serviceIds: ['svc1'] }), ...ctx }).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/promotions-evaluate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/promotions/evaluate.ts
export interface PromoCore {
  isActive: boolean
  validFrom: Date | null
  validUntil: Date | null
  maxRedemptions: number | null
  maxPerCustomer: number | null
  minSpend: number | null
  appliesToAll: boolean
  serviceIds: string[]
  rewardType: 'percentage' | 'fixed_amount' | 'free_service'
  rewardValue: number
  maxDiscount: number | null
  redemptionCount: number
}

export function computeDiscount(promo: PromoCore, totalPrice: number): number {
  if (promo.rewardType === 'percentage') {
    const raw = Math.floor((totalPrice * promo.rewardValue) / 100)
    return Math.min(raw, promo.maxDiscount ?? Infinity, totalPrice)
  }
  if (promo.rewardType === 'fixed_amount') {
    return Math.min(promo.rewardValue, totalPrice)
  }
  return totalPrice // free_service
}

export type RedeemReason =
  | 'inactive' | 'not_started' | 'expired' | 'sold_out'
  | 'per_customer_cap' | 'min_spend' | 'out_of_scope'

export function isRedeemable(input: {
  promo: PromoCore
  serviceId: string
  totalPrice: number
  customerRedemptions: number
  now: Date
}): { ok: true; discount: number } | { ok: false; reason: RedeemReason } {
  const { promo, serviceId, totalPrice, customerRedemptions, now } = input
  if (!promo.isActive) return { ok: false, reason: 'inactive' }
  if (promo.validFrom && now < promo.validFrom) return { ok: false, reason: 'not_started' }
  if (promo.validUntil && now > promo.validUntil) return { ok: false, reason: 'expired' }
  if (promo.maxRedemptions != null && promo.redemptionCount >= promo.maxRedemptions) return { ok: false, reason: 'sold_out' }
  if (promo.maxPerCustomer != null && customerRedemptions >= promo.maxPerCustomer) return { ok: false, reason: 'per_customer_cap' }
  if (promo.minSpend != null && totalPrice < promo.minSpend) return { ok: false, reason: 'min_spend' }
  if (!promo.appliesToAll && !promo.serviceIds.includes(serviceId)) return { ok: false, reason: 'out_of_scope' }
  return { ok: true, discount: computeDiscount(promo, totalPrice) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/promotions-evaluate.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/promotions/evaluate.ts tests/unit/promotions-evaluate.test.ts
git commit -m "feat(promotions): pure isRedeemable + computeDiscount engine"
```

---

## Task 5: Helper de liberación + reconciliación

**Files:**
- Create: `src/lib/promotions/release.ts`
- Test: `tests/unit/promotions-release.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/promotions-release.test.ts
import { describe, it, expect, vi } from 'vitest'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'

function tx(redemption: any) {
  return {
    promotionRedemption: {
      findUnique: vi.fn().mockResolvedValue(redemption),
      update: vi.fn().mockResolvedValue({}),
    },
    promotion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  } as any
}

describe('releaseRedemptionForBooking', () => {
  it('releases an applied redemption and decrements with a floor', async () => {
    const t = tx({ id: 'r1', promotionId: 'p1', status: 'applied' })
    await releaseRedemptionForBooking(t, 'b1', 'cancelled')
    expect(t.promotionRedemption.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1' },
      data: expect.objectContaining({ status: 'released', releaseReason: 'cancelled' }),
    }))
    expect(t.promotion.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', redemptionCount: { gt: 0 } },
      data: { redemptionCount: { decrement: 1 } },
    })
  })
  it('does nothing when there is no redemption', async () => {
    const t = tx(null)
    await releaseRedemptionForBooking(t, 'b1', 'cancelled')
    expect(t.promotionRedemption.update).not.toHaveBeenCalled()
  })
  it('does nothing when already released', async () => {
    const t = tx({ id: 'r1', promotionId: 'p1', status: 'released' })
    await releaseRedemptionForBooking(t, 'b1', 'no_show')
    expect(t.promotion.updateMany).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/promotions-release.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/promotions/release.ts
import type { Prisma, PrismaClient, RedemptionRelease } from '@prisma/client'

type TxLike = Prisma.TransactionClient | PrismaClient

/** Libera (si existe y está `applied`) el canje de una reserva y decrementa el
 *  contador con piso. Idempotente: no hace nada si ya está liberado o no existe. */
export async function releaseRedemptionForBooking(
  tx: TxLike,
  bookingId: string,
  reason: RedemptionRelease,
): Promise<void> {
  const r = await tx.promotionRedemption.findUnique({ where: { bookingId } })
  if (!r || r.status !== 'applied') return
  await tx.promotionRedemption.update({
    where: { id: r.id },
    data: { status: 'released', releaseReason: reason, releasedAt: new Date() },
  })
  await tx.promotion.updateMany({
    where: { id: r.promotionId, redemptionCount: { gt: 0 } },
    data: { redemptionCount: { decrement: 1 } },
  })
}

/** Recalcula redemptionCount de una promo desde el libro de canjes (sana drift). */
export async function reconcileRedemptionCount(
  db: PrismaClient,
  promotionId: string,
): Promise<number> {
  const count = await db.promotionRedemption.count({ where: { promotionId, status: 'applied' } })
  await db.promotion.update({ where: { id: promotionId }, data: { redemptionCount: count } })
  return count
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/promotions-release.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/promotions/release.ts tests/unit/promotions-release.test.ts
git commit -m "feat(promotions): release + reconcile helpers"
```

---

## Task 6: Server actions CRUD + reporte

**Files:**
- Create: `src/server/actions/promotions.ts` (`'use server'`)
- Test: `tests/unit/promotions-actions.test.ts`

> **Disciplina `'use server'`:** este módulo exporta **solo funciones async**. Tipos/schemas se importan desde `@/lib/promotions/*`, nunca se re-exportan acá. Patrón de auth/rate-limit: copiar de `src/server/actions/reviews.ts`.

- [ ] **Step 1: Write the implementation**

```ts
// src/server/actions/promotions.ts
'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { createPromotionSchema, updatePromotionSchema } from '@/lib/promotions/schema'

async function assertServicesBelong(businessId: string, serviceIds: string[]) {
  if (serviceIds.length === 0) return
  const count = await prisma.service.count({ where: { id: { in: serviceIds }, businessId } })
  if (count !== serviceIds.length) throw new Error('Servicio inválido')
}

export async function createPromotion(data: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('default', 30, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = createPromotionSchema.safeParse(data)
  if (!parsed.success) throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  const d = parsed.data
  await assertServicesBelong(businessId, d.serviceIds)

  const created = await prisma.promotion.create({
    data: {
      businessId,
      name: d.name, description: d.description,
      triggerType: 'code', code: d.code,
      rewardType: d.rewardType, rewardValue: d.rewardValue, maxDiscount: d.maxDiscount ?? null,
      appliesToAll: d.appliesToAll,
      services: d.appliesToAll ? undefined : { connect: d.serviceIds.map(id => ({ id })) },
      validFrom: d.validFrom ? new Date(d.validFrom) : null,
      validUntil: d.validUntil ? new Date(`${d.validUntil}T23:59:59`) : null,
      minSpend: d.minSpend ?? null, maxRedemptions: d.maxRedemptions ?? null, maxPerCustomer: d.maxPerCustomer ?? null,
      createdByUserId: user.id,
    },
  }).catch((e: { code?: string }) => {
    if (e.code === 'P2002') throw new Error('Ya existe una promoción con ese código')
    throw e
  })

  revalidatePath('/dashboard/promociones')
  return created
}

export async function updatePromotion(id: string, data: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const existing = await prisma.promotion.findFirst({ where: { id, businessId } })
  if (!existing) throw new ForbiddenError('Promoción no encontrada')

  const parsed = updatePromotionSchema.safeParse(data)
  if (!parsed.success) throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  const d = parsed.data
  await assertServicesBelong(businessId, d.serviceIds)

  // Si ya tiene canjes, el código queda bloqueado.
  const code = existing.redemptionCount > 0 ? existing.code : d.code

  const updated = await prisma.promotion.update({
    where: { id },
    data: {
      name: d.name, description: d.description, code,
      rewardType: d.rewardType, rewardValue: d.rewardValue, maxDiscount: d.maxDiscount ?? null,
      appliesToAll: d.appliesToAll,
      services: { set: d.appliesToAll ? [] : d.serviceIds.map(sid => ({ id: sid })) },
      validFrom: d.validFrom ? new Date(d.validFrom) : null,
      validUntil: d.validUntil ? new Date(`${d.validUntil}T23:59:59`) : null,
      minSpend: d.minSpend ?? null, maxRedemptions: d.maxRedemptions ?? null, maxPerCustomer: d.maxPerCustomer ?? null,
      updatedByUserId: user.id,
    },
  })
  revalidatePath('/dashboard/promociones')
  return updated
}

export async function setPromotionActive(id: string, isActive: boolean) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const existing = await prisma.promotion.findFirst({ where: { id, businessId } })
  if (!existing) throw new ForbiddenError('Promoción no encontrada')
  await prisma.promotion.update({ where: { id }, data: { isActive } })
  revalidatePath('/dashboard/promociones')
}

export async function listPromotions() {
  const { businessId } = await requireBusiness()
  return prisma.promotion.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
    include: { services: { select: { id: true, name: true } } },
  })
}

export async function getPromotionRedemptions(promotionId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.promotionRedemption.findMany({
    where: { promotionId, businessId },
    orderBy: { createdAt: 'desc' },
    include: { customer: { select: { id: true, name: true } }, booking: { select: { id: true, startDateTime: true } } },
  })
}
```

- [ ] **Step 2: Write the test (mock prisma, mirror reviews-actions.test.ts setup)**

```ts
// tests/unit/promotions-actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = {
  promotion: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  promotionRedemption: { findMany: vi.fn() },
  service: { count: vi.fn() },
}
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'biz-1', user: { id: 'u1' } }),
  ForbiddenError: class extends Error {},
}))

const { createPromotion, updatePromotion } = await import('@/server/actions/promotions')

describe('createPromotion', () => {
  beforeEach(() => vi.clearAllMocks())
  it('creates with a normalized code', async () => {
    mockPrisma.service.count.mockResolvedValue(0)
    mockPrisma.promotion.create.mockResolvedValue({ id: 'p1' })
    await createPromotion({ name: 'Verano', code: 'verano20', rewardType: 'percentage', rewardValue: 20, appliesToAll: true })
    expect(mockPrisma.promotion.create.mock.calls[0][0].data.code).toBe('VERANO20')
  })
  it('rejects services from another business', async () => {
    mockPrisma.service.count.mockResolvedValue(0) // pidió 1, existe 0
    await expect(createPromotion({ name: 'X', rewardType: 'percentage', rewardValue: 10, appliesToAll: false, serviceIds: ['s-foreign'] }))
      .rejects.toThrow('Servicio inválido')
  })
})

describe('updatePromotion', () => {
  beforeEach(() => vi.clearAllMocks())
  it('keeps the original code when the promo already has redemptions', async () => {
    mockPrisma.promotion.findFirst.mockResolvedValue({ id: 'p1', code: 'OLD', redemptionCount: 3 })
    mockPrisma.service.count.mockResolvedValue(0)
    mockPrisma.promotion.update.mockResolvedValue({ id: 'p1' })
    await updatePromotion('p1', { name: 'X', code: 'NEW', rewardType: 'percentage', rewardValue: 10, appliesToAll: true })
    expect(mockPrisma.promotion.update.mock.calls[0][0].data.code).toBe('OLD')
  })
})
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/unit/promotions-actions.test.ts`
Expected: PASS. Si `requireBusinessRole` no devuelve `user`, ajustar el mock al shape real (revisar `src/lib/auth/server.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/server/actions/promotions.ts tests/unit/promotions-actions.test.ts
git commit -m "feat(promotions): CRUD server actions + redemptions query"
```

---

## Task 7: `previewPromotion` (tenant-scoped, rate-limited)

**Files:**
- Modify: `src/lib/rate-limit.ts` (agregar entrada)
- Modify: `src/server/actions/promotions.ts` (agregar `previewPromotion`)
- Test: `tests/unit/promotions-preview.test.ts`

- [ ] **Step 1: Add the rate-limit bucket**

En `src/lib/rate-limit.ts`, dentro de `RATE_LIMITS`, agregar:

```ts
  'preview-promotion': { maxRequests: 30, windowMs: 60_000 },
```

- [ ] **Step 2: Add `previewPromotion` to `promotions.ts`**

```ts
// añadir imports arriba:
import { isRedeemable } from '@/lib/promotions/evaluate'
import { normalizeCode } from '@/lib/promotions/schema'

const GENERIC_INVALID = { ok: false as const, message: 'Código inválido o no aplicable' }

/** Preview público: NO crea canje. Tenant-scoped + rate-limited + respuesta genérica. */
export async function previewPromotion(input: { businessId: string; code: string; serviceId: string; phone?: string }) {
  const limit = await checkRateLimit('preview-promotion', 30, 60000)
  if (!limit.success) return GENERIC_INVALID

  const code = normalizeCode(input.code)
  if (!code) return GENERIC_INVALID

  const [promo, service] = await Promise.all([
    prisma.promotion.findFirst({
      where: { businessId: input.businessId, code, triggerType: 'code' },
      include: { services: { select: { id: true } } },
    }),
    prisma.service.findFirst({ where: { id: input.serviceId, businessId: input.businessId, isActive: true } }),
  ])
  if (!promo || !service) return GENERIC_INVALID

  let customerRedemptions = 0
  if (input.phone && promo.maxPerCustomer != null) {
    const customer = await prisma.customer.findFirst({ where: { businessId: input.businessId, phone: input.phone }, select: { id: true } })
    if (customer) {
      customerRedemptions = await prisma.promotionRedemption.count({
        where: { promotionId: promo.id, customerId: customer.id, status: 'applied' },
      })
    }
  }

  const result = isRedeemable({
    promo: { ...promo, serviceIds: promo.services.map(s => s.id) },
    serviceId: input.serviceId, totalPrice: service.price, customerRedemptions, now: new Date(),
  })
  if (!result.ok) return GENERIC_INVALID
  return { ok: true as const, discount: result.discount, finalAmount: service.price - result.discount }
}
```

- [ ] **Step 3: Write the test**

```ts
// tests/unit/promotions-preview.test.ts  (reusar el bloque de mocks de promotions-actions.test.ts)
// añadir al mockPrisma: promotion.findFirst, service.findFirst, customer.findFirst, promotionRedemption.count
import { describe, it, expect, vi, beforeEach } from 'vitest'
const mockPrisma: any = {
  promotion: { findFirst: vi.fn() }, service: { findFirst: vi.fn() },
  customer: { findFirst: vi.fn() }, promotionRedemption: { count: vi.fn() },
}
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/server', () => ({ requireBusiness: vi.fn(), requireBusinessRole: vi.fn(), ForbiddenError: class extends Error {} }))
const { previewPromotion } = await import('@/server/actions/promotions')

describe('previewPromotion', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns generic invalid for unknown code (no info leak)', async () => {
    mockPrisma.promotion.findFirst.mockResolvedValue(null)
    mockPrisma.service.findFirst.mockResolvedValue({ id: 'svc1', price: 20000 })
    const r = await previewPromotion({ businessId: 'biz-1', code: 'NOPE', serviceId: 'svc1' })
    expect(r.ok).toBe(false)
  })
  it('returns discount for a valid code', async () => {
    mockPrisma.promotion.findFirst.mockResolvedValue({ id: 'p1', isActive: true, validFrom: null, validUntil: null, maxRedemptions: null, maxPerCustomer: null, minSpend: null, appliesToAll: true, rewardType: 'percentage', rewardValue: 20, maxDiscount: null, redemptionCount: 0, services: [] })
    mockPrisma.service.findFirst.mockResolvedValue({ id: 'svc1', price: 20000 })
    const r = await previewPromotion({ businessId: 'biz-1', code: 'VERANO20', serviceId: 'svc1' })
    expect(r).toMatchObject({ ok: true, discount: 4000, finalAmount: 16000 })
  })
})
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run tests/unit/promotions-preview.test.ts` → PASS.

```bash
git add src/lib/rate-limit.ts src/server/actions/promotions.ts tests/unit/promotions-preview.test.ts
git commit -m "feat(promotions): previewPromotion tenant-scoped + rate-limited"
```

---

## Task 8: Aplicar descuento en la reserva pública (`createBooking`)

**Files:**
- Modify: `src/server/actions/bookings.ts` (`createBookingSchema`, `createBooking`)
- Create: `src/lib/promotions/apply.ts` (helper transaccional reutilizable)
- Test: `tests/unit/promotions-apply.test.ts`

> Leer primero `createBooking` (≈ líneas 142–300) para ubicar: el cálculo de
> `finalAmount = service.price`, `depositRequired = service.depositAmount`,
> `remainingBalance`, y el `prisma.$transaction(async (tx) => { … })`.

- [ ] **Step 1: Create the transactional apply helper**

```ts
// src/lib/promotions/apply.ts
import type { Prisma } from '@prisma/client'
import { isRedeemable } from './evaluate'
import { normalizeCode } from './schema'

export interface ApplyResult { discountAmount: number; promotionId: string }

/** Resuelve y consume una promo por código dentro de una transacción de reserva.
 *  Devuelve null si no hay código. Lanza si el código es inválido (la reserva no debe crearse).
 *  Inserta el canje e incrementa redemptionCount atómicamente. */
export async function applyPromotionInTx(tx: Prisma.TransactionClient, args: {
  businessId: string; code: string | null | undefined; serviceId: string; customerId: string
  totalPrice: number; bookingId: string; source: 'public_booking' | 'dashboard_booking'
  createdByUserId?: string | null; now?: Date
}): Promise<ApplyResult | null> {
  const code = normalizeCode(args.code)
  if (!code) return null

  const promo = await tx.promotion.findFirst({
    where: { businessId: args.businessId, code, triggerType: 'code' },
    include: { services: { select: { id: true } } },
  })
  if (!promo) throw new Error('El código de promoción no es válido')

  const customerRedemptions = promo.maxPerCustomer == null ? 0
    : await tx.promotionRedemption.count({ where: { promotionId: promo.id, customerId: args.customerId, status: 'applied' } })

  const r = isRedeemable({
    promo: { ...promo, serviceIds: promo.services.map(s => s.id) },
    serviceId: args.serviceId, totalPrice: args.totalPrice, customerRedemptions, now: args.now ?? new Date(),
  })
  if (!r.ok) throw new Error('El código ya no está disponible')

  // Incremento atómico (branch null = ilimitado).
  if (promo.maxRedemptions == null) {
    await tx.promotion.update({ where: { id: promo.id }, data: { redemptionCount: { increment: 1 } } })
  } else {
    const inc = await tx.promotion.updateMany({
      where: { id: promo.id, redemptionCount: { lt: promo.maxRedemptions } },
      data: { redemptionCount: { increment: 1 } },
    })
    if (inc.count === 0) throw new Error('El código ya no está disponible')
  }

  await tx.promotionRedemption.create({
    data: {
      businessId: args.businessId, promotionId: promo.id, bookingId: args.bookingId,
      customerId: args.customerId, discountAmount: r.discount, source: args.source,
      createdByUserId: args.createdByUserId ?? null,
    },
  })
  return { discountAmount: r.discount, promotionId: promo.id }
}
```

- [ ] **Step 2: Wire into `createBookingSchema` + `createBooking`**

En `createBookingSchema` agregar: `promotionCode: z.string().trim().max(40).optional()`.
En `createBooking(data, businessId)`, dentro del `$transaction`, **después** de crear la reserva (cuando ya existe `booking.id` y el `customer.id`) y **antes** de calcular el deposit/preferencia:

```ts
// dentro del tx, ya con `customer` y el booking creado con totalPrice/finalAmount = service.price
const promoRes = await applyPromotionInTx(tx, {
  businessId, code: data.promotionCode, serviceId: data.serviceId, customerId: customer.id,
  totalPrice: service.price, bookingId: booking.id, source: 'public_booking',
})
const discountAmount = promoRes?.discountAmount ?? 0
const finalAmount = service.price - discountAmount
const depositRequired = Math.min(service.depositAmount, finalAmount)
const remainingBalance = finalAmount // creación pública: aún no hay pago

await tx.booking.update({
  where: { id: booking.id },
  data: { discountAmount, finalAmount, depositRequired, remainingBalance },
})
```

Ajustar las decisiones de estado para que `isFreeService`/`noDepositRequired`
usen los valores **post-descuento** (`finalAmount`/`depositRequired` capeado), no
`service.price`/`service.depositAmount`. Leer el bloque actual (≈ líneas 252–270) y
reemplazar las referencias crudas por las variables descontadas.

- [ ] **Step 3: Write the test for the apply helper**

```ts
// tests/unit/promotions-apply.test.ts
import { describe, it, expect, vi } from 'vitest'
import { applyPromotionInTx } from '@/lib/promotions/apply'

function tx(promo: any, opts: { incCount?: number } = {}) {
  return {
    promotion: {
      findFirst: vi.fn().mockResolvedValue(promo),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: opts.incCount ?? 1 }),
    },
    promotionRedemption: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({}) },
  } as any
}
const P = { id: 'p1', code: 'V20', triggerType: 'code', isActive: true, validFrom: null, validUntil: null, maxRedemptions: null, maxPerCustomer: null, minSpend: null, appliesToAll: true, rewardType: 'percentage', rewardValue: 20, maxDiscount: null, redemptionCount: 0, services: [] }
const baseArgs = { businessId: 'b1', serviceId: 'svc1', customerId: 'c1', totalPrice: 20000, bookingId: 'bk1', source: 'public_booking' as const }

describe('applyPromotionInTx', () => {
  it('returns null when no code', async () => {
    expect(await applyPromotionInTx(tx(null), { ...baseArgs, code: '' })).toBeNull()
  })
  it('throws on unknown code (booking must not be created)', async () => {
    await expect(applyPromotionInTx(tx(null), { ...baseArgs, code: 'NOPE' })).rejects.toThrow('no es válido')
  })
  it('applies a 20% discount and inserts a redemption', async () => {
    const t = tx(P)
    const res = await applyPromotionInTx(t, { ...baseArgs, code: 'V20' })
    expect(res).toEqual({ discountAmount: 4000, promotionId: 'p1' })
    expect(t.promotionRedemption.create).toHaveBeenCalled()
  })
  it('throws when the atomic increment loses the race (sold out)', async () => {
    const t = tx({ ...P, maxRedemptions: 5 }, { incCount: 0 })
    await expect(applyPromotionInTx(t, { ...baseArgs, code: 'V20' })).rejects.toThrow('ya no está disponible')
  })
})
```

- [ ] **Step 4: Run + build + commit**

Run: `npx vitest run tests/unit/promotions-apply.test.ts` → PASS.
Run: `npm run build` → exit 0 (typecheck del wiring en bookings.ts).

```bash
git add src/lib/promotions/apply.ts src/server/actions/bookings.ts tests/unit/promotions-apply.test.ts
git commit -m "feat(promotions): apply discount in public createBooking (server-authoritative)"
```

---

## Task 9: Aplicar descuento en la reserva manual (`createBookingFromDashboard`)

**Files:**
- Modify: `src/server/actions/bookings.ts` (`createBookingFromDashboard`)

> Leer `createBookingFromDashboard` (≈ líneas 520–704). Hay un `finalAmount =
> service.price` (≈ 534) y los modos `deposit_paid`/`full_paid` construyen pagos
> desde `depositRequired`/`finalAmount` (≈ 647–696).

- [ ] **Step 1: Compute the discount once, before the payment branches**

Dentro del `$transaction`, tras resolver `customer` y crear la reserva base, usar el mismo helper:

```ts
const promoRes = await applyPromotionInTx(tx, {
  businessId, code: data.promotionCode, serviceId: data.serviceId, customerId: customer.id,
  totalPrice: service.price, bookingId: booking.id, source: 'dashboard_booking', createdByUserId: userId,
})
const discountAmount = promoRes?.discountAmount ?? 0
const finalAmount = service.price - discountAmount
const depositRequired = Math.min(service.depositAmount, finalAmount)
```

Reemplazar todas las referencias posteriores a `service.price`/`service.depositAmount`
en los modos de pago por `finalAmount`/`depositRequired`, y persistir
`discountAmount`/`finalAmount`/`depositRequired`/`remainingBalance` en la reserva.
Agregar `promotionCode` al schema/firma de esta acción igual que en Task 8.

- [ ] **Step 2: Build + manual check**

Run: `npm run build` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/server/actions/bookings.ts
git commit -m "feat(promotions): apply discount in manual dashboard booking"
```

---

## Task 10: Ciclo de vida — release en cancel/no-show/hold-vencido/reembolso

**Files:**
- Modify: `src/server/actions/bookings.ts` (`cancelBooking`, `updateBookingStatus`)
- Modify: `src/lib/cron/expire-holds.ts`
- Modify: `src/app/api/webhooks/mercado-pago/route.ts`
- Test: `tests/unit/expire-holds-release.test.ts`

- [ ] **Step 1: `cancelBooking` — envolver en `$transaction` + release**

Hoy es un `prisma.booking.update` pelado. Reemplazar por:

```ts
await prisma.$transaction(async (tx) => {
  await tx.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.cancelled, internalNotes: /* …igual que hoy… */ } })
  await releaseRedemptionForBooking(tx, bookingId, 'cancelled')
})
```
Importar `releaseRedemptionForBooking` desde `@/lib/promotions/release`.

- [ ] **Step 2: `updateBookingStatus(no_show)` — release**

En el camino `no_show`, envolver el `updateMany` de status + `releaseRedemptionForBooking(tx, id, 'no_show')` en un `$transaction`. (El camino `completed` ya genera el reviewToken; no toca canjes.)

- [ ] **Step 3: `expireStaleHolds` — liberar canjes de las expiradas**

Tras el `updateMany`, dentro de un `$transaction` (usar el `db` param), para cada `expiredIds`:

```ts
// reemplazar el updateMany suelto por:
await db.$transaction(async (tx) => {
  await tx.booking.updateMany({ where: { id: { in: expiredIds }, status: 'pending_payment', paymentStatus: 'unpaid', holdExpiresAt: { lt: now } }, data: { status: 'expired' } })
  const reds = await tx.promotionRedemption.findMany({ where: { bookingId: { in: expiredIds }, status: 'applied' }, select: { bookingId: true } })
  for (const r of reds) await releaseRedemptionForBooking(tx, r.bookingId, 'hold_expired')
})
```
(Si el tipo `db` no expone `$transaction`, ampliar el `Pick<PrismaClient, …>` a incluir `'$transaction'`.)

- [ ] **Step 4: Webhook — release en `refunded`/`charged_back`**

En el branch del webhook que maneja `refunded`/`charged_back` (≈ líneas 397–429), tras actualizar el `Payment`, llamar `releaseRedemptionForBooking(prisma, booking.id, 'refunded')`.

- [ ] **Step 5: Test de la liberación en expire-holds**

```ts
// tests/unit/expire-holds-release.test.ts
import { describe, it, expect, vi } from 'vitest'
import { expireStaleHolds } from '@/lib/cron/expire-holds'

it('releases redemptions of expired holds', async () => {
  const findMany = vi.fn()
    .mockResolvedValueOnce([{ id: 'b1', businessId: 'biz1' }]) // bookings expirados
  const tx = {
    booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    promotionRedemption: { findMany: vi.fn().mockResolvedValue([{ bookingId: 'b1' }]), findUnique: vi.fn().mockResolvedValue({ id: 'r1', promotionId: 'p1', status: 'applied' }), update: vi.fn().mockResolvedValue({}) },
    promotion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  }
  const db: any = { booking: { findMany }, $transaction: (fn: any) => fn(tx) }
  await expireStaleHolds(new Date(), db)
  expect(tx.promotionRedemption.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ releaseReason: 'hold_expired' }) }))
})
```

- [ ] **Step 6: Run + build + commit**

Run: `npx vitest run tests/unit/expire-holds-release.test.ts` and existing booking/expire tests → PASS.
Run: `npm run build` → exit 0.

```bash
git add src/server/actions/bookings.ts src/lib/cron/expire-holds.ts src/app/api/webhooks/mercado-pago/route.ts tests/unit/expire-holds-release.test.ts
git commit -m "feat(promotions): release redemptions on cancel/no-show/expire/refund"
```

---

## Task 11: UI — wizard público, reserva manual, panel y reporte

**Files:**
- Modify: `src/components/booking/wizard.tsx` (BookingData + threading del código)
- Modify: `src/components/booking/step-payment.tsx` (campo código + preview)
- Modify: `src/app/dashboard/bookings/new/new-booking-form.tsx` (campo código + preview)
- Modify: `src/components/dashboard/sidebar.tsx` (ítem "Promociones")
- Create: `src/app/dashboard/promociones/page.tsx` (lista)
- Create: `src/app/dashboard/promociones/promotion-form.tsx` (crear/editar)
- Create: `src/app/dashboard/promociones/redemptions-button.tsx` (reporte + CSV)
- Modify: `tests/e2e/public.spec.ts` (subtítulo/heading de la nueva página si aplica)

- [ ] **Step 1: Sidebar item**

En `src/components/dashboard/sidebar.tsx`, importar `Ticket` de `lucide-react` y agregar a `navItems` (después de "Pagos"): `{ href: '/dashboard/promociones', label: 'Promociones', icon: Ticket }`.

- [ ] **Step 2: Wizard — thread the code**

En `BookingData` (wizard.tsx) agregar `promotionCode?: string`. Pasarlo en ambas llamadas de submit a `createBooking` (incluirlo en el objeto que ya se arma). El `StepPayment` setea `data.promotionCode`.

- [ ] **Step 3: `StepPayment` — campo de código + preview**

Al inicio de `StepPayment` (que ya tiene `data.customerPhone` y `data.serviceId`), agregar un input opcional "¿Tienes un código?" + botón "Aplicar". Al aplicar, llamar `previewPromotion({ businessId, code, serviceId: data.serviceId, phone: data.customerPhone })`; si `ok`, mostrar `formatMoney(discount)` y `formatMoney(finalAmount)` y guardar `data.promotionCode = code`; si no, mostrar el mensaje genérico y limpiar el código. Usar `formatMoney` (no `es-CL`).

- [ ] **Step 4: Lista de promociones** (`/dashboard/promociones/page.tsx`)

Server component: `requireBusiness` + redirect patterns como las demás páginas; `const promos = await listPromotions()`. Render: header + botón "Nueva promoción" (abre `PromotionForm`) + tabla/cards con nombre, código, recompensa (`formatMoney`/`%`), alcance, `usos (redemptionCount/maxRedemptions ?? '∞')`, vigencia, **estado derivado** (función local `derivePromoStatus(promo, now)` → Activa/Programada/Vencida/Agotada/Inactiva), y acciones (editar, activar/desactivar via `setPromotionActive`, ver canjes).

- [ ] **Step 5: `PromotionForm`** (cliente)

Modal con los campos del schema (nombre, descripción, recompensa tipo+valor+tope, alcance con chips de servicios, vigencia, límites) + **preview en vivo** con `computeDiscount` sobre un precio de ejemplo. Submit → `createPromotion`/`updatePromotion`. Si la promo tiene canjes, deshabilitar el input de código (mostrar "bloqueado tras el primer uso"). Nudge cuando `free_service` + `appliesToAll`.

- [ ] **Step 6: Reporte de canjes + CSV**

`redemptions-button.tsx` (cliente): abre un panel que llama `getPromotionRedemptions(promotionId)` y lista clienta/reserva/monto (`formatMoney`)/fecha/source/estado. Botón "Exportar CSV" que arma el CSV con **BOM** (`'﻿' + …`) y descarga vía Blob. (El action ya está gateado a owner/admin.)

- [ ] **Step 7: Reserva manual — campo de código**

En `new-booking-form.tsx`, agregar el mismo input de código + preview (reusar el patrón del Step 3) y pasar `promotionCode` a `createBookingFromDashboard`.

- [ ] **Step 8: Build + lint + e2e local**

Run: `npm run build` → exit 0.
Run: `npx eslint src/app/dashboard/promociones src/components/dashboard/sidebar.tsx` → limpio.

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard/promociones src/components/dashboard/sidebar.tsx src/components/booking/wizard.tsx src/components/booking/step-payment.tsx src/app/dashboard/bookings/new/new-booking-form.tsx
git commit -m "feat(promotions): dashboard UI (list/form/report) + code field in booking flows"
```

---

## Task 12: e2e + aplicar migración a prod

**Files:**
- Modify: `tests/e2e/public.spec.ts` (o `smoke.spec.ts`)

- [ ] **Step 1: e2e — flujo completo**

Agregar un test (auth bypass owner): crear promo vía UI (`/dashboard/promociones`, código `E2EPROMO`, 10%) → ir a `/book/<slug>`, reservar el servicio, en el paso de pago aplicar `E2EPROMO`, verificar el descuento en el resumen → confirmar → en `/dashboard/promociones` ver "usos 1/—" y el canje en el reporte. (Si el flujo público de pago es complejo en e2e, como mínimo: crear promo + `previewPromotion` devuelve descuento + aparece en la lista.)

- [ ] **Step 2: Run the full suites**

Run: `npx vitest run tests/unit` → todo verde.
Run: `npm run test:e2e` (o el script de e2e) → verde.

- [ ] **Step 3: Aplicar la migración a producción**

```bash
set -a; source .env.local; set +a
npx prisma migrate deploy
npx prisma migrate status   # "Database schema is up to date!"
```

- [ ] **Step 4: Commit + PR**

```bash
git add tests/e2e
git commit -m "test(promotions): e2e flujo crear promo + aplicar en reserva"
git push -u origin feat/promotions-engine
gh pr create --title "feat(promotions): motor de promociones por código (rebanada A)" --body "Implementa el spec docs/superpowers/specs/2026-06-28-promotions-engine-design.md"
```

---

## Notas de ejecución

- **Orden:** las tasks son secuenciales (8–10 dependen de 1–7). Las puras (1,3,4,5) son
  independientes entre sí y pueden ir en cualquier orden al principio.
- **Memorias del repo a respetar:** `'use server'` solo exporta funciones async;
  `revalidate*` siempre `await`. (Ver `MEMORY.md`.)
- **Currency-clean:** ningún `toLocaleString('es-CL')`/`$` nuevo — usar `formatMoney`.
- **No aplicar la migración a prod hasta Task 12** (tras verde local).
