# B2 · Canje de puntos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir gastar puntos: la dueña define un catálogo de canje, la clienta canjea puntos por una recompensa (un `PromotionGrant` con código), y ese código se aplica a una reserva reusando el motor de A.

**Architecture:** Una opción de catálogo es una `Promotion(triggerType='granted')` con `pointsCost`. Canjear descuenta puntos (asiento negativo `redemption`) y emite un `PromotionGrant`; el código del grant viaja por el campo `promotionCode` existente y se aplica extendiendo `applyPromotionInTx`. El ciclo de release de la reserva reactiva la recompensa. Todo aditivo sobre A + B1.

**Tech Stack:** Next.js 16, React 19, Prisma 5.22 + Postgres (Supabase), Zod 4.4.3, Vitest (jsdom, globals), Playwright, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-06-29-loyalty-redemption-B2-design.md`

**Reglas de repo (no romper):** módulos `'use server'` exportan SOLO funciones async; todo `revalidate*` se hace con `await`; currency-clean (`formatMoney`, nada `es-CL` hardcodeado). NO aplicar migración a prod sin confirmación explícita del usuario. NUNCA tipear contraseñas en e2e — usar el bypass por headers.

---

## File Structure

**Nuevos:**
- `src/lib/loyalty/grant.ts` — `reconcileExpiredGrants` (vencimiento lazy).
- `src/lib/loyalty/redeem.ts` — `redeemForGrant` + `generateGrantCode` (núcleo del canje).
- `src/app/dashboard/fidelizacion/redemption-catalog.tsx` — CRUD del catálogo (client).
- `tests/unit/loyalty-redeem.test.ts`, `tests/unit/loyalty-grant-reconcile.test.ts`, `tests/unit/promotions-apply-grant.test.ts`, `tests/unit/promotions-release-grant.test.ts`, `tests/unit/loyalty-redemption-schema.test.ts`.

**Modificados:**
- `prisma/schema.prisma` + nueva migración aditiva.
- `src/lib/loyalty/view.ts` — labels nuevos + `canAfford`.
- `src/lib/loyalty/schema.ts` — config toggles + `redemptionOptionSchema` + `redeemSchema`.
- `src/lib/promotions/apply.ts` — rama grant en `applyPromotionInTx`.
- `src/lib/promotions/release.ts` — `releaseRedemptionForBooking` grant-aware.
- `src/server/actions/loyalty.ts` — actions de catálogo + canje + `getCustomerLoyalty`.
- `src/server/actions/promotions.ts` — `previewPromotion` grant-aware + `listPromotions` filtra granted.
- `src/app/dashboard/fidelizacion/{page,loyalty-config-form}.tsx` — sección catálogo + toggles.
- `src/app/dashboard/customers/[id]/{page,loyalty-panel}.tsx` — canjear + grants activos.
- `src/app/tarjeta/[token]/page.tsx` — canjear + mis recompensas.
- `tests/unit/loyalty-view.test.ts`, `tests/unit/loyalty-actions.test.ts` — extender.

---

### Task 1: Schema Prisma + migración aditiva

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_redemption/migration.sql`

- [ ] **Step 1: Editar el enum `LoyaltyReason`** (alrededor de la línea 480) para sumar dos valores:

```prisma
enum LoyaltyReason {
  visit
  visit_reversal
  adjustment
  redemption
  redemption_reversal
}
```

- [ ] **Step 2: Agregar el enum `GrantStatus`** justo después de `enum PromotionTrigger`:

```prisma
enum GrantStatus {
  active
  redeemed
  expired
  reversed
}
```

- [ ] **Step 3: Agregar campos a `Promotion`** (dentro del `model Promotion`, junto a los otros escalares, antes del bloque de relaciones). Y la relación inversa:

```prisma
  pointsCost      Int?
  grantExpiryDays Int?
```
Y en el bloque de relaciones de `Promotion`, sumar:
```prisma
  grants      PromotionGrant[]
```

- [ ] **Step 4: Agregar campos a `LoyaltyConfig`** (junto a los otros, antes de `updatedByUserId`):

```prisma
  grantExpiryDays      Int?
  refundPointsOnExpiry Boolean  @default(true)
  forfeitGrantOnNoShow Boolean  @default(false)
```

- [ ] **Step 5: Agregar la relación inversa en `Customer` y `Business`.** En `model Customer` (donde está `loyaltyToken`), sumar al bloque de relaciones:
```prisma
  loyaltyGrants PromotionGrant[]
```
En `model Business`, sumar al bloque de relaciones:
```prisma
  promotionGrants PromotionGrant[]
```

- [ ] **Step 6: Agregar el modelo `PromotionGrant`** al final de la sección de modelos de promociones:

```prisma
model PromotionGrant {
  id                String      @id @default(cuid())
  businessId        String
  promotionId       String
  customerId        String
  code              String
  pointsSpent       Int
  status            GrantStatus @default(active)
  expiresAt         DateTime?
  refundOnExpiry    Boolean
  forfeitOnNoShow   Boolean
  requestId         String
  redeemedBookingId String?     @unique
  redeemedAt        DateTime?
  reversedAt        DateTime?
  metadata          Json?
  createdByUserId   String?
  createdAt         DateTime    @default(now())

  business  Business  @relation(fields: [businessId], references: [id], onDelete: Cascade)
  promotion Promotion @relation(fields: [promotionId], references: [id])
  customer  Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@unique([businessId, code])
  @@unique([customerId, requestId])
  @@index([customerId, status])
  @@index([businessId, promotionId])
}
```

> **Nota — `redeemedBookingId` es un soft-link a propósito** (un `String?` con `@unique`, SIN relación FK a `Booking`). Así la baja de una reserva no toca el historial del grant y `Booking` no necesita campo inverso. La reactivación lo busca por `findFirst({ where: { redeemedBookingId } })`.
>
> **Nota — enum en transacción:** la migración hace `ALTER TYPE "LoyaltyReason" ADD VALUE` y en el mismo archivo crea/usa `GrantStatus`. En Postgres 12+ (Supabase es 15) esto aplica sin problema porque los nuevos valores de `LoyaltyReason` NO se usan dentro de la misma migración. Si `migrate deploy` (Step en Task 13) llegara a quejarse por "ALTER TYPE ... ADD VALUE cannot run inside a transaction block", separar los dos `ADD VALUE` a su propia migración previa.

- [ ] **Step 7: Validar que el schema es válido**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 8: Generar el SQL de la migración (sin aplicar)** — no hay Postgres local; se genera por diff entre la DB viva y el datamodel nuevo, igual que en B1:

Run:
```bash
TS=$(date +%Y%m%d%H%M%S)_add_redemption && mkdir -p prisma/migrations/$TS && \
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/$TS/migration.sql && \
cat prisma/migrations/$TS/migration.sql
```
Expected: un SQL **puramente aditivo** que: `ALTER TYPE "LoyaltyReason" ADD VALUE 'redemption'` (+ `'redemption_reversal'`), `CREATE TYPE "GrantStatus"`, `ALTER TABLE "Promotion" ADD COLUMN "pointsCost"`/`"grantExpiryDays"`, `ALTER TABLE "LoyaltyConfig" ADD COLUMN ...` (3 columnas), `CREATE TABLE "PromotionGrant"` con sus índices únicos y 3 FKs. **No** debe contener ningún `DROP`. Si aparece un `DROP`, parar y revisar el schema.

- [ ] **Step 9: Regenerar el cliente Prisma** (para que el resto del plan compile):

Run: `npx prisma generate`
Expected: `Generated Prisma Client`

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(loyalty): schema B2 — PromotionGrant + campos de canje (migración aditiva, sin aplicar)"
```

> La migración se **aplica en la Task 14** con confirmación del usuario (gate). No aplicar acá.

---

### Task 2: Helpers de vista (labels + canAfford)

**Files:**
- Modify: `src/lib/loyalty/view.ts`
- Test: `tests/unit/loyalty-view.test.ts`

- [ ] **Step 1: Escribir el test que falla** — agregar a `tests/unit/loyalty-view.test.ts`:

```ts
import { loyaltyReasonLabel, canAfford } from '@/lib/loyalty/view'

describe('loyaltyReasonLabel (B2)', () => {
  it('etiqueta canje y reembolso de canje', () => {
    expect(loyaltyReasonLabel('redemption')).toBe('Canje')
    expect(loyaltyReasonLabel('redemption_reversal')).toBe('Reembolso de canje')
  })
})

describe('canAfford', () => {
  it('true si el saldo alcanza el costo', () => {
    expect(canAfford(100, 80)).toBe(true)
    expect(canAfford(80, 80)).toBe(true)
  })
  it('false si no alcanza', () => {
    expect(canAfford(79, 80)).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/unit/loyalty-view.test.ts`
Expected: FAIL (`redemption` no está en `REASON_LABELS`; `canAfford` no existe).

- [ ] **Step 3: Implementar** — en `src/lib/loyalty/view.ts`, sumar las dos labels al record y la función:

```ts
const REASON_LABELS: Record<LoyaltyReason, string> = {
  visit: 'Visita',
  visit_reversal: 'Reembolso',
  adjustment: 'Ajuste',
  redemption: 'Canje',
  redemption_reversal: 'Reembolso de canje',
}
```
Y al final del archivo:
```ts
/** La clienta puede pagar la recompensa si su saldo cubre el costo en puntos. */
export function canAfford(balance: number, pointsCost: number): boolean {
  return balance >= pointsCost
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run tests/unit/loyalty-view.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/view.ts tests/unit/loyalty-view.test.ts
git commit -m "feat(loyalty): labels de canje + helper canAfford"
```

---

### Task 3: Zod — config toggles + redemptionOptionSchema + redeemSchema

**Files:**
- Modify: `src/lib/loyalty/schema.ts`
- Test: `tests/unit/loyalty-redemption-schema.test.ts`

- [ ] **Step 1: Escribir el test que falla** — crear `tests/unit/loyalty-redemption-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { redemptionOptionSchema, redeemSchema, loyaltyConfigSchema } from '@/lib/loyalty/schema'

describe('redemptionOptionSchema', () => {
  const base = { name: 'Servicio gratis', rewardType: 'free_service', rewardValue: 0,
    pointsCost: 100, appliesToAll: true }
  it('acepta una opción válida y fuerza rewardValue 0 en free_service', () => {
    const r = redemptionOptionSchema.parse({ ...base, rewardValue: 99 })
    expect(r.rewardValue).toBe(0)
    expect(r.pointsCost).toBe(100)
    expect(r.isActive).toBe(true)
  })
  it('rechaza pointsCost <= 0', () => {
    expect(redemptionOptionSchema.safeParse({ ...base, pointsCost: 0 }).success).toBe(false)
  })
  it('rechaza percentage fuera de 1..100', () => {
    expect(redemptionOptionSchema.safeParse({ ...base, rewardType: 'percentage', rewardValue: 150 }).success).toBe(false)
  })
  it('exige al menos un servicio si no aplica a todos', () => {
    expect(redemptionOptionSchema.safeParse({ ...base, appliesToAll: false, serviceIds: [] }).success).toBe(false)
  })
})

describe('redeemSchema', () => {
  it('exige optionId y requestId', () => {
    expect(redeemSchema.safeParse({ optionId: 'p1', requestId: 'r1' }).success).toBe(true)
    expect(redeemSchema.safeParse({ optionId: '', requestId: 'r1' }).success).toBe(false)
  })
})

describe('loyaltyConfigSchema (B2)', () => {
  it('default refundPointsOnExpiry=true, forfeitGrantOnNoShow=false', () => {
    const r = loyaltyConfigSchema.parse({ isActive: true, programName: 'X', pointsPerVisit: 1 })
    expect(r.refundPointsOnExpiry).toBe(true)
    expect(r.forfeitGrantOnNoShow).toBe(false)
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npx vitest run tests/unit/loyalty-redemption-schema.test.ts`
Expected: FAIL (`redemptionOptionSchema`/`redeemSchema` no existen).

- [ ] **Step 3: Implementar** — en `src/lib/loyalty/schema.ts`:

En `loyaltyConfigSchema`, agregar tres campos antes de `cardMessage`:
```ts
  grantExpiryDays: optPositiveInt,
  refundPointsOnExpiry: z.boolean().optional().default(true),
  forfeitGrantOnNoShow: z.boolean().optional().default(false),
```
Y al final del archivo, los dos schemas nuevos:
```ts
export const redemptionOptionSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(60),
  rewardType: z.enum(['percentage', 'fixed_amount', 'free_service']),
  rewardValue: z.coerce.number().int().nonnegative(),
  maxDiscount: optPositiveInt,
  pointsCost: z.coerce.number().int().positive('El costo en puntos debe ser mayor a 0'),
  appliesToAll: z.boolean(),
  serviceIds: z.array(z.string().min(1)).optional().default([]),
  grantExpiryDays: optPositiveInt,
  maxRedemptions: optPositiveInt,
  maxPerCustomer: optPositiveInt,
  isActive: z.boolean().optional().default(true),
}).strip()
  .transform((d) => (d.rewardType === 'free_service' ? { ...d, rewardValue: 0 } : d))
  .refine((d) => d.rewardType !== 'percentage' || (d.rewardValue >= 1 && d.rewardValue <= 100),
    { message: 'El porcentaje debe estar entre 1 y 100', path: ['rewardValue'] })
  .refine((d) => d.appliesToAll || d.serviceIds.length > 0,
    { message: 'Elige al menos un servicio o aplica a todos', path: ['serviceIds'] })

export const redeemSchema = z.object({
  optionId: z.string().min(1),
  requestId: z.string().min(1).max(100),
}).strip()

export type RedemptionOptionInput = z.infer<typeof redemptionOptionSchema>
export type RedemptionOptionFormInput = z.input<typeof redemptionOptionSchema>
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run tests/unit/loyalty-redemption-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/schema.ts tests/unit/loyalty-redemption-schema.test.ts
git commit -m "feat(loyalty): zod — toggles de config + redemptionOption + redeem"
```

---

### Task 4: `reconcileExpiredGrants` (vencimiento lazy)

**Files:**
- Create: `src/lib/loyalty/grant.ts`
- Test: `tests/unit/loyalty-grant-reconcile.test.ts`

- [ ] **Step 1: Escribir el test que falla** — crear `tests/unit/loyalty-grant-reconcile.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { reconcileExpiredGrants } from '@/lib/loyalty/grant'

function db(grants: any[]) {
  const create = vi.fn().mockResolvedValue({})
  const updateMany = vi.fn().mockResolvedValue({ count: 1 })
  return {
    db: {
      promotionGrant: { findMany: vi.fn().mockResolvedValue(grants), updateMany },
      loyaltyLedger: { create },
    } as any,
    create, updateMany,
  }
}
const NOW = new Date('2026-06-29T00:00:00Z')

describe('reconcileExpiredGrants', () => {
  it('refundOnExpiry=true => marca reversed e inserta reembolso', async () => {
    const { db: d, create, updateMany } = db([
      { id: 'g1', businessId: 'b1', customerId: 'c1', pointsSpent: 50, refundOnExpiry: true },
    ])
    await reconcileExpiredGrants(d, 'c1', 'b1', NOW)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'reversed' }) }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ points: 50, reason: 'redemption_reversal' }) }))
  })
  it('refundOnExpiry=false => marca expired sin reembolso', async () => {
    const { db: d, create, updateMany } = db([
      { id: 'g2', businessId: 'b1', customerId: 'c1', pointsSpent: 50, refundOnExpiry: false },
    ])
    await reconcileExpiredGrants(d, 'c1', 'b1', NOW)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'expired' } }))
    expect(create).not.toHaveBeenCalled()
  })
  it('no reembolsa si el flip no ganó la carrera (count 0)', async () => {
    const { db: d, create } = db([
      { id: 'g3', businessId: 'b1', customerId: 'c1', pointsSpent: 50, refundOnExpiry: true },
    ])
    d.promotionGrant.updateMany = vi.fn().mockResolvedValue({ count: 0 })
    await reconcileExpiredGrants(d, 'c1', 'b1', NOW)
    expect(create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npx vitest run tests/unit/loyalty-grant-reconcile.test.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar** — crear `src/lib/loyalty/grant.ts`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client'

type TxLike = Prisma.TransactionClient | PrismaClient

/** Reconcilia los grants vencidos de una clienta (lazy, sin cron). Idempotente:
 *  el guard `updateMany` garantiza que sólo la llamada que hace el flip inserta el
 *  reembolso. Corre en toda superficie que muestre saldo.
 *  IMPORTANTE: debe ejecutarse DENTRO de una transacción para que el flip a
 *  `reversed` y el asiento de reembolso sean atómicos (un crash entre ambos dejaría
 *  el grant consumido sin devolver los puntos). `redeemForGrant` ya la llama dentro
 *  de su tx; los demás callers la envuelven en `prisma.$transaction(tx => ...)`. */
export async function reconcileExpiredGrants(
  db: TxLike,
  customerId: string,
  businessId: string,
  now: Date = new Date(),
): Promise<void> {
  const expired = await db.promotionGrant.findMany({
    where: { customerId, businessId, status: 'active', expiresAt: { lt: now } },
    select: { id: true, businessId: true, customerId: true, pointsSpent: true, refundOnExpiry: true },
  })
  for (const g of expired) {
    if (g.refundOnExpiry) {
      const flipped = await db.promotionGrant.updateMany({
        where: { id: g.id, status: 'active' },
        data: { status: 'reversed', reversedAt: now },
      })
      if (flipped.count === 1) {
        await db.loyaltyLedger.create({
          data: {
            businessId: g.businessId, customerId: g.customerId, points: g.pointsSpent,
            reason: 'redemption_reversal', metadata: { grantId: g.id },
          },
        })
      }
    } else {
      await db.promotionGrant.updateMany({
        where: { id: g.id, status: 'active' },
        data: { status: 'expired' },
      })
    }
  }
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run tests/unit/loyalty-grant-reconcile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/grant.ts tests/unit/loyalty-grant-reconcile.test.ts
git commit -m "feat(loyalty): reconcileExpiredGrants — vencimiento lazy idempotente"
```

---

### Task 5: `redeemForGrant` + `generateGrantCode` (núcleo del canje)

**Files:**
- Create: `src/lib/loyalty/redeem.ts`
- Test: `tests/unit/loyalty-redeem.test.ts`

- [ ] **Step 1: Escribir el test que falla** — crear `tests/unit/loyalty-redeem.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { redeemForGrant } from '@/lib/loyalty/redeem'

const PROMO = { id: 'p1', businessId: 'b1', triggerType: 'granted', isActive: true,
  pointsCost: 80, grantExpiryDays: 30, maxRedemptions: null, maxPerCustomer: null }
const CONFIG = { isActive: true, grantExpiryDays: 90, refundPointsOnExpiry: true, forfeitGrantOnNoShow: false }

function fakeTx(opts: { balance: number; existing?: any; claimed?: number } ) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    promotionGrant: {
      findUnique: vi.fn().mockResolvedValue(opts.existing ?? null),
      findMany: vi.fn().mockResolvedValue([]),       // reconcile: sin vencidos
      findFirst: vi.fn().mockResolvedValue(null),    // generateGrantCode: sin colisión
      count: vi.fn().mockResolvedValue(opts.claimed ?? 0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 'g1', code: 'ABC123' }),
    },
    promotion: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    loyaltyLedger: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { points: opts.balance } }),
      create: vi.fn().mockResolvedValue({}),
    },
  } as any
}

describe('redeemForGrant', () => {
  it('toma el advisory lock, descuenta puntos y emite el grant', async () => {
    const tx = fakeTx({ balance: 100 })
    const grant = await redeemForGrant(tx, { businessId: 'b1', customerId: 'c1',
      promotion: PROMO as any, config: CONFIG, requestId: 'r1', createdByUserId: 'u1' })
    expect(tx.$executeRaw).toHaveBeenCalled()
    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ points: -80, reason: 'redemption' }) }))
    expect(tx.promotionGrant.create).toHaveBeenCalled()
    expect(grant).toEqual({ id: 'g1', code: 'ABC123' })
  })
  it('idempotente: si ya hay grant con ese requestId lo devuelve sin tocar nada', async () => {
    const tx = fakeTx({ balance: 100, existing: { id: 'gOld' } })
    const grant = await redeemForGrant(tx, { businessId: 'b1', customerId: 'c1',
      promotion: PROMO as any, config: CONFIG, requestId: 'r1' })
    expect(grant).toEqual({ id: 'gOld' })
    expect(tx.promotionGrant.create).not.toHaveBeenCalled()
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled()
  })
  it('rechaza si el saldo no alcanza', async () => {
    const tx = fakeTx({ balance: 50 })
    await expect(redeemForGrant(tx, { businessId: 'b1', customerId: 'c1',
      promotion: PROMO as any, config: CONFIG, requestId: 'r1' })).rejects.toThrow(/suficientes/)
    expect(tx.promotionGrant.create).not.toHaveBeenCalled()
  })
  it('rechaza si el stock se agotó (incremento condicional count 0)', async () => {
    const tx = fakeTx({ balance: 100 })
    tx.promotion.updateMany = vi.fn().mockResolvedValue({ count: 0 })
    await expect(redeemForGrant(tx, { businessId: 'b1', customerId: 'c1',
      promotion: { ...PROMO, maxRedemptions: 5 } as any, config: CONFIG, requestId: 'r1' })).rejects.toThrow(/agotó/)
  })
  it('rechaza si la clienta superó su tope', async () => {
    const tx = fakeTx({ balance: 100, claimed: 2 })
    await expect(redeemForGrant(tx, { businessId: 'b1', customerId: 'c1',
      promotion: { ...PROMO, maxPerCustomer: 2 } as any, config: CONFIG, requestId: 'r1' })).rejects.toThrow(/límite/)
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npx vitest run tests/unit/loyalty-redeem.test.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar** — crear `src/lib/loyalty/redeem.ts`:

```ts
import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { reconcileExpiredGrants } from './grant'

type Tx = Prisma.TransactionClient

// Crockford base32 sin caracteres ambiguos (sin I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function randomCode(len = 10): string {
  let s = ''
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return s
}

/** Genera un código de grant único en el negocio, sin colisionar con promo-códigos
 *  ni con otros grants. Ya viene normalizado (uppercase base32). */
export async function generateGrantCode(tx: Tx, businessId: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode()
    const [promo, grant] = await Promise.all([
      tx.promotion.findFirst({ where: { businessId, code }, select: { id: true } }),
      tx.promotionGrant.findFirst({ where: { businessId, code }, select: { id: true } }),
    ])
    if (!promo && !grant) return code
  }
  throw new Error('No se pudo generar un código de canje')
}

export interface RedeemConfig {
  isActive: boolean
  grantExpiryDays: number | null
  refundPointsOnExpiry: boolean
  forfeitGrantOnNoShow: boolean
}

export interface RedeemPromotion {
  id: string
  businessId: string
  triggerType: string
  isActive: boolean
  pointsCost: number | null
  grantExpiryDays: number | null
  maxRedemptions: number | null
  maxPerCustomer: number | null
}

const DAY_MS = 86_400_000

/** Canjea puntos por un grant, DENTRO de una $transaction. Toma un advisory lock
 *  por-clienta (serializa canjes/ajustes de la misma clienta). Devuelve el grant.
 *  Idempotente por (customerId, requestId): un doble-click devuelve el grant ya
 *  emitido sin descontar de nuevo. El P2002 del create (carrera extrema) se deja
 *  propagar: la action lo captura, hace rollback y re-lee el grant existente. */
export async function redeemForGrant(tx: Tx, args: {
  businessId: string
  customerId: string
  promotion: RedeemPromotion
  config: RedeemConfig
  requestId: string
  createdByUserId?: string | null
  now?: Date
}) {
  const now = args.now ?? new Date()
  const { businessId, customerId, promotion, config, requestId } = args

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${customerId}))`

  // Idempotencia (antes de tocar stock/saldo).
  const existing = await tx.promotionGrant.findUnique({
    where: { customerId_requestId: { customerId, requestId } },
  })
  if (existing) return existing

  await reconcileExpiredGrants(tx, customerId, businessId, now)

  if (promotion.triggerType !== 'granted' || !promotion.isActive || promotion.pointsCost == null) {
    throw new Error('La recompensa no está disponible')
  }
  const pointsCost = promotion.pointsCost

  if (promotion.maxPerCustomer != null) {
    const claimed = await tx.promotionGrant.count({
      where: { promotionId: promotion.id, customerId, status: { in: ['active', 'redeemed'] } },
    })
    if (claimed >= promotion.maxPerCustomer) throw new Error('Ya alcanzaste el límite de esta recompensa')
  }

  const agg = await tx.loyaltyLedger.aggregate({ where: { customerId, businessId }, _sum: { points: true } })
  const balance = agg._sum.points ?? 0
  if (balance < pointsCost) throw new Error('No tienes puntos suficientes')

  // Stock atómico (el lock per-customer NO cubre el stock compartido entre clientas).
  if (promotion.maxRedemptions == null) {
    await tx.promotion.update({ where: { id: promotion.id }, data: { redemptionCount: { increment: 1 } } })
  } else {
    const inc = await tx.promotion.updateMany({
      where: { id: promotion.id, redemptionCount: { lt: promotion.maxRedemptions } },
      data: { redemptionCount: { increment: 1 } },
    })
    if (inc.count === 0) throw new Error('La recompensa se agotó')
  }

  const expiryDays = promotion.grantExpiryDays ?? config.grantExpiryDays
  const expiresAt = expiryDays != null ? new Date(now.getTime() + expiryDays * DAY_MS) : null

  const code = await generateGrantCode(tx, businessId)
  const grant = await tx.promotionGrant.create({
    data: {
      businessId, promotionId: promotion.id, customerId, code, pointsSpent: pointsCost,
      status: 'active', expiresAt, refundOnExpiry: config.refundPointsOnExpiry,
      forfeitOnNoShow: config.forfeitGrantOnNoShow, requestId,
      createdByUserId: args.createdByUserId ?? null,
    },
  })

  await tx.loyaltyLedger.create({
    data: {
      businessId, customerId, points: -pointsCost, reason: 'redemption',
      metadata: { grantId: grant.id, promotionId: promotion.id },
      createdByUserId: args.createdByUserId ?? null,
    },
  })

  return grant
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run tests/unit/loyalty-redeem.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/redeem.ts tests/unit/loyalty-redeem.test.ts
git commit -m "feat(loyalty): redeemForGrant + generateGrantCode (núcleo del canje)"
```

---

### Task 6: Rama grant en `applyPromotionInTx`

**Files:**
- Modify: `src/lib/promotions/apply.ts`
- Test: `tests/unit/promotions-apply-grant.test.ts`

- [ ] **Step 1: Escribir el test que falla** — crear `tests/unit/promotions-apply-grant.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { applyPromotionInTx } from '@/lib/promotions/apply'

const PROMO = { id: 'p1', appliesToAll: true, services: [], minSpend: null,
  rewardType: 'percentage', rewardValue: 50, maxDiscount: null }

function fakeTx(grant: any) {
  return {
    promotionGrant: {
      findFirst: vi.fn().mockResolvedValue(grant),
      updateMany: vi.fn().mockResolvedValue({ count: grant ? 1 : 0 }),
    },
    promotion: { findFirst: vi.fn().mockResolvedValue(null) },
    promotionRedemption: { create: vi.fn().mockResolvedValue({}) },
  } as any
}
const ARGS = { businessId: 'b1', serviceId: 's1', customerId: 'c1', totalPrice: 1000,
  bookingId: 'bk1', source: 'public_booking' as const }

describe('applyPromotionInTx — rama grant', () => {
  it('aplica un grant activo, lo marca redeemed y NO incrementa redemptionCount', async () => {
    const tx = fakeTx({ id: 'g1', expiresAt: null, promotion: PROMO })
    const res = await applyPromotionInTx(tx, { ...ARGS, code: 'ABC123' })
    expect(res).toEqual({ discountAmount: 500, promotionId: 'p1' })
    expect(tx.promotionGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'redeemed', redeemedBookingId: 'bk1' }) }))
    expect(tx.promotionRedemption.create).toHaveBeenCalled()
    expect(tx.promotion.findFirst).not.toHaveBeenCalled() // no cae al camino de código
  })
  it('rechaza un grant vencido', async () => {
    const tx = fakeTx({ id: 'g1', expiresAt: new Date('2000-01-01'), promotion: PROMO })
    await expect(applyPromotionInTx(tx, { ...ARGS, code: 'ABC123', now: new Date('2026-01-01') }))
      .rejects.toThrow(/venció/)
  })
  it('rechaza si el grant ya fue usado (flip count 0)', async () => {
    const tx = fakeTx({ id: 'g1', expiresAt: null, promotion: PROMO })
    tx.promotionGrant.updateMany = vi.fn().mockResolvedValue({ count: 0 })
    await expect(applyPromotionInTx(tx, { ...ARGS, code: 'ABC123' })).rejects.toThrow(/ya fue usada/)
  })
  it('rechaza si el servicio está fuera de alcance', async () => {
    const tx = fakeTx({ id: 'g1', expiresAt: null,
      promotion: { ...PROMO, appliesToAll: false, services: [{ id: 'otro' }] } })
    await expect(applyPromotionInTx(tx, { ...ARGS, code: 'ABC123' })).rejects.toThrow(/no aplica/)
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npx vitest run tests/unit/promotions-apply-grant.test.ts`
Expected: FAIL (hoy `applyPromotionInTx` busca promo por código y tira "no es válido").

- [ ] **Step 3: Implementar** — en `src/lib/promotions/apply.ts`, importar `computeDiscount` y agregar la rama grant justo después del `if (!code) return null`:

```ts
import type { Prisma } from '@prisma/client'
import { isRedeemable, computeDiscount } from './evaluate'
import { normalizeCode } from './schema'

export interface ApplyResult { discountAmount: number; promotionId: string }

export async function applyPromotionInTx(tx: Prisma.TransactionClient, args: {
  businessId: string; code: string | null | undefined; serviceId: string; customerId: string
  totalPrice: number; bookingId: string; source: 'public_booking' | 'dashboard_booking'
  createdByUserId?: string | null; now?: Date
}): Promise<ApplyResult | null> {
  const code = normalizeCode(args.code)
  if (!code) return null

  // Rama grant (canje de puntos): el código puede ser un PromotionGrant al portador.
  const grant = await tx.promotionGrant.findFirst({
    where: { businessId: args.businessId, code, status: 'active' },
    include: { promotion: { include: { services: { select: { id: true } } } } },
  })
  if (grant) {
    const p = grant.promotion
    const now = args.now ?? new Date()
    if (grant.expiresAt && now > grant.expiresAt) throw new Error('La recompensa venció')
    // Stock y tope ya se consumieron al canjear; tampoco se exige p.isActive (la
    // clienta ya pagó los puntos, se honra). Sólo se valida alcance y mínimo.
    if (!p.appliesToAll && !p.services.some(s => s.id === args.serviceId))
      throw new Error('La recompensa no aplica a este servicio')
    if (p.minSpend != null && args.totalPrice < p.minSpend)
      throw new Error('La recompensa requiere un monto mínimo mayor')
    const discount = computeDiscount(
      { ...p, serviceIds: p.services.map(s => s.id) } as Parameters<typeof computeDiscount>[0],
      args.totalPrice,
    )
    // Flip atómico anti doble-aplicación concurrente del mismo código.
    const flipped = await tx.promotionGrant.updateMany({
      where: { id: grant.id, status: 'active' },
      data: { status: 'redeemed', redeemedBookingId: args.bookingId, redeemedAt: now },
    })
    if (flipped.count === 0) throw new Error('La recompensa ya fue usada')
    await tx.promotionRedemption.create({
      data: {
        businessId: args.businessId, promotionId: p.id, bookingId: args.bookingId,
        customerId: args.customerId, discountAmount: discount, source: args.source,
        createdByUserId: args.createdByUserId ?? null,
      },
    })
    return { discountAmount: discount, promotionId: p.id }
  }

  // Camino existente: promo por código (triggerType='code').
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

- [ ] **Step 4: Correr los tests (nuevos + regресión de A)**

Run: `npx vitest run tests/unit/promotions-apply-grant.test.ts tests/unit/promotions-apply.test.ts`
Expected: PASS (si el nombre del test de A difiere, correr `npx vitest run tests/unit/ -t apply`). Los tests de código existentes deben seguir verdes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/promotions/apply.ts tests/unit/promotions-apply-grant.test.ts
git commit -m "feat(promotions): applyPromotionInTx resuelve grants de canje (flip atómico)"
```

---

### Task 7: `releaseRedemptionForBooking` grant-aware

**Files:**
- Modify: `src/lib/promotions/release.ts`
- Test: `tests/unit/promotions-release-grant.test.ts`

- [ ] **Step 1: Escribir el test que falla** — crear `tests/unit/promotions-release-grant.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'

function fakeTx(triggerType: string, grant: any) {
  return {
    promotionRedemption: {
      findUnique: vi.fn().mockResolvedValue({ promotionId: 'p1', status: 'applied' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    promotion: {
      findUnique: vi.fn().mockResolvedValue({ triggerType }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    promotionGrant: {
      findFirst: vi.fn().mockResolvedValue(grant),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    loyaltyLedger: { create: vi.fn().mockResolvedValue({}) },
  } as any
}

describe('releaseRedemptionForBooking — grant-aware', () => {
  it('promo por código: decrementa redemptionCount (comportamiento de A)', async () => {
    const tx = fakeTx('code', null)
    await releaseRedemptionForBooking(tx, 'bk1', 'cancelled')
    expect(tx.promotion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { redemptionCount: { decrement: 1 } } }))
    expect(tx.promotionGrant.findFirst).not.toHaveBeenCalled()
  })
  it('grant: NO decrementa y reactiva la recompensa', async () => {
    const tx = fakeTx('granted', { id: 'g1', expiresAt: null, forfeitOnNoShow: false, refundOnExpiry: true, businessId: 'b1', customerId: 'c1', pointsSpent: 50 })
    await releaseRedemptionForBooking(tx, 'bk1', 'cancelled')
    expect(tx.promotion.updateMany).not.toHaveBeenCalled()
    expect(tx.promotionGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'active', redeemedBookingId: null }) }))
  })
  it('no_show con forfeitOnNoShow: pierde la recompensa (no reactiva)', async () => {
    const tx = fakeTx('granted', { id: 'g1', expiresAt: null, forfeitOnNoShow: true })
    await releaseRedemptionForBooking(tx, 'bk1', 'no_show')
    expect(tx.promotionGrant.updateMany).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npx vitest run tests/unit/promotions-release-grant.test.ts`
Expected: FAIL (hoy siempre decrementa, no mira grants).

- [ ] **Step 3: Implementar** — reescribir `releaseRedemptionForBooking` en `src/lib/promotions/release.ts` (mantener `reconcileRedemptionCount` igual). El import del tipo `RedemptionRelease` ya existe:

```ts
export async function releaseRedemptionForBooking(
  tx: TxLike,
  bookingId: string,
  reason: RedemptionRelease,
): Promise<void> {
  const r = await tx.promotionRedemption.findUnique({ where: { bookingId } })
  if (!r || r.status !== 'applied') return
  // Guard atómico: sólo la llamada que hace applied->released sigue.
  const flipped = await tx.promotionRedemption.updateMany({
    where: { bookingId, status: 'applied' },
    data: { status: 'released', releaseReason: reason, releasedAt: new Date() },
  })
  if (flipped.count === 0) return

  const promo = await tx.promotion.findUnique({
    where: { id: r.promotionId }, select: { triggerType: true },
  })
  if (promo?.triggerType === 'granted') {
    // El stock del grant se consumió al canjear (no al aplicar) => NO decrementar.
    await reactivateGrantForBooking(tx, bookingId, reason)
    return
  }

  await tx.promotion.updateMany({
    where: { id: r.promotionId, redemptionCount: { gt: 0 } },
    data: { redemptionCount: { decrement: 1 } },
  })
}

/** Al liberarse una reserva con grant aplicado: reactivar la recompensa para que la
 *  clienta la recupere. En no_show se reactiva salvo que el grant tenga el snapshot
 *  forfeitOnNoShow. Si el grant ya venció, se aplica la política de vencimiento. */
async function reactivateGrantForBooking(
  tx: TxLike,
  bookingId: string,
  reason: RedemptionRelease,
): Promise<void> {
  const grant = await tx.promotionGrant.findFirst({ where: { redeemedBookingId: bookingId } })
  if (!grant) return
  if (reason === 'no_show' && grant.forfeitOnNoShow) return // se pierde

  const now = new Date()
  const expired = grant.expiresAt != null && now > grant.expiresAt
  if (expired) {
    if (grant.refundOnExpiry) {
      const f = await tx.promotionGrant.updateMany({
        where: { id: grant.id, status: 'redeemed' },
        data: { status: 'reversed', reversedAt: now },
      })
      if (f.count === 1) {
        await tx.loyaltyLedger.create({
          data: {
            businessId: grant.businessId, customerId: grant.customerId, points: grant.pointsSpent,
            reason: 'redemption_reversal', metadata: { grantId: grant.id },
          },
        })
      }
    } else {
      await tx.promotionGrant.updateMany({
        where: { id: grant.id, status: 'redeemed' }, data: { status: 'expired' },
      })
    }
    return
  }

  await tx.promotionGrant.updateMany({
    where: { id: grant.id, status: 'redeemed', redeemedBookingId: bookingId },
    data: { status: 'active', redeemedBookingId: null, redeemedAt: null },
  })
}
```

- [ ] **Step 4: Correr los tests (nuevos + regresión)**

Run: `npx vitest run tests/unit/promotions-release-grant.test.ts tests/unit/promotions-release.test.ts`
Expected: PASS. Los tests de release de A deben seguir verdes (la rama `code` no cambió de comportamiento).

- [ ] **Step 5: Commit**

```bash
git add src/lib/promotions/release.ts tests/unit/promotions-release-grant.test.ts
git commit -m "feat(promotions): release grant-aware — reactiva recompensa, no decrementa stock"
```

---

### Task 8: Server actions de catálogo + canje

**Files:**
- Modify: `src/server/actions/loyalty.ts`
- Test: `tests/unit/loyalty-actions.test.ts`

- [ ] **Step 1: Escribir el test que falla** — agregar a `tests/unit/loyalty-actions.test.ts`. Ampliar el mock de `@/lib/db` para incluir `promotion`, `promotionGrant`, `loyaltyConfig`, `service`:

```ts
// añadir al vi.mock('@/lib/db', ...):
//   promotion: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
//   promotionGrant: { findUnique: vi.fn(), findMany: vi.fn() },
//   loyaltyConfig: { findUnique: vi.fn() },
//   service: { count: vi.fn() },

import { redeemPointsAsOwner } from '@/server/actions/loyalty'

describe('redeemPointsAsOwner', () => {
  it('rechaza clienta de otro negocio', async () => {
    ;(prisma.customer.findFirst as any).mockResolvedValue(null)
    await expect(redeemPointsAsOwner('c1', 'opt1', 'r1')).rejects.toThrow()
  })
  it('canjea: corre redeemForGrant dentro de la transacción', async () => {
    ;(prisma.customer.findFirst as any).mockResolvedValue({ id: 'c1' })
    ;(prisma.promotion.findFirst as any).mockResolvedValue({ id: 'opt1', businessId: 'b1',
      triggerType: 'granted', isActive: true, pointsCost: 50, grantExpiryDays: null,
      maxRedemptions: null, maxPerCustomer: null })
    ;(prisma.loyaltyConfig.findUnique as any).mockResolvedValue({ isActive: true,
      grantExpiryDays: 90, refundPointsOnExpiry: true, forfeitGrantOnNoShow: false })
    const create = vi.fn().mockResolvedValue({ id: 'g1' })
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn({
      $executeRaw: vi.fn().mockResolvedValue(1),
      promotionGrant: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), create },
      promotion: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn(), updateMany: vi.fn() },
      loyaltyLedger: { aggregate: vi.fn().mockResolvedValue({ _sum: { points: 100 } }), create: vi.fn() },
    }))
    await redeemPointsAsOwner('c1', 'opt1', 'r1')
    expect(create).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npx vitest run tests/unit/loyalty-actions.test.ts`
Expected: FAIL (`redeemPointsAsOwner` no existe).

- [ ] **Step 3: Implementar** — en `src/server/actions/loyalty.ts`, sumar imports y actions. **Importante (regla de repo): este módulo es `'use server'`, así que sólo se exportan funciones async; los helpers internos (`redemptionOptionWhere`, `runRedemption`) NO se exportan.**

```ts
// imports nuevos
import { redemptionOptionSchema, redeemSchema } from '@/lib/loyalty/schema'
import { reconcileExpiredGrants } from '@/lib/loyalty/grant'
import { redeemForGrant, type RedeemPromotion } from '@/lib/loyalty/redeem'
import { resolveLoyaltyCustomer } from '@/lib/loyalty/token'

// helper interno (NO exportar)
function redemptionOptionWhere(businessId: string) {
  return { businessId, triggerType: 'granted' as const, pointsCost: { not: null } }
}

const REDEEM_SELECT = {
  id: true, businessId: true, triggerType: true, isActive: true,
  pointsCost: true, grantExpiryDays: true, maxRedemptions: true, maxPerCustomer: true,
} as const

// helper interno (NO exportar): resuelve opción + config y corre el canje idempotente
async function runRedemption(args: {
  businessId: string; customerId: string; optionId: string; requestId: string
  createdByUserId: string | null
}): Promise<void> {
  const { businessId, customerId, optionId, requestId } = args
  const promotion = await prisma.promotion.findFirst({
    where: { id: optionId, ...redemptionOptionWhere(businessId) }, select: REDEEM_SELECT,
  })
  if (!promotion) throw new Error('La recompensa no está disponible')
  const cfg = await prisma.loyaltyConfig.findUnique({ where: { businessId } })
  const config = {
    isActive: cfg?.isActive ?? false,
    grantExpiryDays: cfg?.grantExpiryDays ?? null,
    refundPointsOnExpiry: cfg?.refundPointsOnExpiry ?? true,
    forfeitGrantOnNoShow: cfg?.forfeitGrantOnNoShow ?? false,
  }
  try {
    await prisma.$transaction((tx) => redeemForGrant(tx, {
      businessId, customerId, promotion: promotion as RedeemPromotion, config, requestId,
      createdByUserId: args.createdByUserId,
    }))
  } catch (e) {
    // Carrera extrema de doble-click: la tx hizo rollback; el grant ya existe.
    if ((e as { code?: string })?.code === 'P2002') {
      const existing = await prisma.promotionGrant.findUnique({
        where: { customerId_requestId: { customerId, requestId } },
      })
      if (existing) return
    }
    throw e
  }
}

export async function listRedemptionOptions() {
  const { businessId } = await requireBusiness()
  return prisma.promotion.findMany({
    where: redemptionOptionWhere(businessId),
    orderBy: { createdAt: 'desc' },
    include: { services: { select: { id: true, name: true } } },
  })
}

export async function upsertRedemptionOption(data: unknown, id?: string) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('redemption-option', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = redemptionOptionSchema.safeParse(data)
  if (!parsed.success) throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  const d = parsed.data
  if (d.serviceIds.length) {
    const count = await prisma.service.count({ where: { id: { in: d.serviceIds }, businessId } })
    if (count !== d.serviceIds.length) throw new Error('Servicio inválido')
  }
  const scalars = {
    name: d.name, rewardType: d.rewardType, rewardValue: d.rewardValue, maxDiscount: d.maxDiscount,
    appliesToAll: d.appliesToAll, pointsCost: d.pointsCost, grantExpiryDays: d.grantExpiryDays,
    maxRedemptions: d.maxRedemptions, maxPerCustomer: d.maxPerCustomer, isActive: d.isActive,
  }
  if (id) {
    const existing = await prisma.promotion.findFirst({ where: { id, businessId, triggerType: 'granted' }, select: { id: true } })
    if (!existing) throw new ForbiddenError('Recompensa no encontrada')
    await prisma.promotion.update({
      where: { id },
      data: { ...scalars, updatedByUserId: user.id,
        services: d.appliesToAll ? { set: [] } : { set: d.serviceIds.map(sid => ({ id: sid })) } },
    })
  } else {
    await prisma.promotion.create({
      data: { businessId, triggerType: 'granted', ...scalars, createdByUserId: user.id,
        services: d.appliesToAll ? undefined : { connect: d.serviceIds.map(sid => ({ id: sid })) } },
    })
  }
  await revalidatePath('/dashboard/fidelizacion')
}

export async function archiveRedemptionOption(id: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const existing = await prisma.promotion.findFirst({ where: { id, businessId, triggerType: 'granted' }, select: { id: true } })
  if (!existing) throw new ForbiddenError('Recompensa no encontrada')
  await prisma.promotion.update({ where: { id }, data: { isActive: false } })
  await revalidatePath('/dashboard/fidelizacion')
}

export async function redeemPointsAsOwner(customerId: string, optionId: unknown, requestId: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('loyalty-redeem', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  const parsed = redeemSchema.safeParse({ optionId, requestId })
  if (!parsed.success) throw new Error('Datos inválidos')
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } })
  if (!customer) throw new ForbiddenError('Clienta no encontrada')
  await runRedemption({ businessId, customerId, optionId: parsed.data.optionId, requestId: parsed.data.requestId, createdByUserId: user.id })
  await revalidatePath(`/dashboard/customers/${customerId}`)
}

export async function redeemPointsAsCustomer(loyaltyToken: string, optionId: unknown, requestId: unknown) {
  const parsed = redeemSchema.safeParse({ optionId, requestId })
  if (!parsed.success) throw new Error('Datos inválidos')
  const customer = await resolveLoyaltyCustomer(prisma, loyaltyToken)
  if (!customer) throw new ForbiddenError('Tarjeta no disponible')
  const config = customer.business.loyaltyConfig
  if (!config || !config.isActive) throw new Error('El programa no está disponible')
  const limit = await checkRateLimit('loyalty-redeem-public', 10, 60000, { businessId: customer.businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  await runRedemption({ businessId: customer.businessId, customerId: customer.id, optionId: parsed.data.optionId, requestId: parsed.data.requestId, createdByUserId: null })
  await revalidatePath(`/tarjeta/${loyaltyToken}`)
}
```

Y **modificar `getCustomerLoyalty`** para reconciliar vencidos y devolver grants + catálogo:
```ts
export async function getCustomerLoyalty(customerId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } })
  if (!customer) throw new ForbiddenError('Clienta no encontrada')
  await prisma.$transaction((tx) => reconcileExpiredGrants(tx, customerId, businessId))
  const [balance, history, grants, catalog] = await Promise.all([
    getLoyaltyBalance(prisma, customerId, businessId),
    getLoyaltyHistory(prisma, customerId, businessId, 50),
    prisma.promotionGrant.findMany({
      where: { customerId, businessId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: { promotion: { select: { name: true } } },
    }),
    prisma.promotion.findMany({
      where: { ...redemptionOptionWhere(businessId), isActive: true },
      orderBy: { pointsCost: 'asc' },
      include: { services: { select: { id: true, name: true } } },
    }),
  ])
  return { balance, history, grants, catalog }
}
```

> **Nota:** `resolveLoyaltyCustomer` ya devuelve `business: { select: { name, logoUrl, loyaltyConfig } }` (confirmado en `src/lib/loyalty/token.ts:32`), así que `customer.business.loyaltyConfig` está tipado y disponible — no hace falta tocar el include.

- [ ] **Step 4: Correr el test + typecheck del módulo**

Run: `npx vitest run tests/unit/loyalty-actions.test.ts && npx tsc --noEmit`
Expected: PASS y sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/loyalty.ts tests/unit/loyalty-actions.test.ts
git commit -m "feat(loyalty): actions de catálogo de canje + redeem (owner/clienta)"
```

---

### Task 9: `previewPromotion` grant-aware + `listPromotions` filtra granted

**Files:**
- Modify: `src/server/actions/promotions.ts`
- Test: `tests/unit/promotions-preview-grant.test.ts` (si el patrón de mock de `previewPromotion` ya existe en otro archivo, extenderlo)

- [ ] **Step 1: Escribir el test que falla** — crear `tests/unit/promotions-preview-grant.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'b1' }),
  requireBusinessRole: vi.fn(), ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: {
  promotionGrant: { findFirst: vi.fn() },
  promotion: { findFirst: vi.fn() },
  service: { findFirst: vi.fn() },
  customer: { findFirst: vi.fn() },
  promotionRedemption: { count: vi.fn() },
} }))

import { previewPromotion } from '@/server/actions/promotions'
import { prisma } from '@/lib/db'
beforeEach(() => vi.clearAllMocks())

describe('previewPromotion — grant', () => {
  it('un grant activo devuelve el descuento', async () => {
    ;(prisma.promotionGrant.findFirst as any).mockResolvedValue({ id: 'g1', expiresAt: null,
      promotion: { appliesToAll: true, services: [], minSpend: null, rewardType: 'percentage', rewardValue: 50, maxDiscount: null } })
    ;(prisma.service.findFirst as any).mockResolvedValue({ id: 's1', price: 1000 })
    const r = await previewPromotion({ businessId: 'b1', code: 'ABC123', serviceId: 's1' })
    expect(r).toMatchObject({ ok: true, discount: 500, finalAmount: 500 })
  })
  it('un grant vencido devuelve inválido genérico', async () => {
    ;(prisma.promotionGrant.findFirst as any).mockResolvedValue({ id: 'g1', expiresAt: new Date('2000-01-01'),
      promotion: { appliesToAll: true, services: [], minSpend: null, rewardType: 'percentage', rewardValue: 50, maxDiscount: null } })
    ;(prisma.service.findFirst as any).mockResolvedValue({ id: 's1', price: 1000 })
    const r = await previewPromotion({ businessId: 'b1', code: 'ABC123', serviceId: 's1' })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npx vitest run tests/unit/promotions-preview-grant.test.ts`
Expected: FAIL (preview no mira grants).

- [ ] **Step 3: Implementar** — en `src/server/actions/promotions.ts`:

(a) `computeDiscount` ya se puede importar de `@/lib/promotions/evaluate` (sumar al import existente de `isRedeemable`).

(b) En `previewPromotion`, dentro del `try`, buscar el servicio **una sola vez** al inicio y reusarlo en ambas ramas (evita el doble lookup). Reemplazar el `Promise.all([promo, service])` existente por: primero el `service`, luego intentar grant, y si no hay grant, buscar la promo por código:
```ts
    const service = await prisma.service.findFirst({
      where: { id: input.serviceId, businessId: input.businessId, isActive: true },
    })
    if (!service) return GENERIC_INVALID

    // Rama grant (canje de puntos)
    const grant = await prisma.promotionGrant.findFirst({
      where: { businessId: input.businessId, code, status: 'active' },
      include: { promotion: { include: { services: { select: { id: true } } } } },
    })
    if (grant) {
      const p = grant.promotion
      if (grant.expiresAt && new Date() > grant.expiresAt) return GENERIC_INVALID
      if (!p.appliesToAll && !p.services.some(s => s.id === input.serviceId)) return GENERIC_INVALID
      if (p.minSpend != null && service.price < p.minSpend) return GENERIC_INVALID
      const discount = computeDiscount({ ...p, serviceIds: p.services.map(s => s.id) } as Parameters<typeof computeDiscount>[0], service.price)
      return { ok: true as const, discount, finalAmount: service.price - discount }
    }

    // Rama código (triggerType='code') — reusa `service`, ya no se vuelve a buscar
    const promo = await prisma.promotion.findFirst({
      where: { businessId: input.businessId, code, triggerType: 'code' },
      include: { services: { select: { id: true } } },
    })
    if (!promo) return GENERIC_INVALID
```
Mantener desde acá el resto del flujo de código existente (cálculo de `customerRedemptions` por `phone`, `isRedeemable`, y el `return { ok, discount, finalAmount: service.price - result.discount }`), pero usando la variable `service` ya resuelta arriba en lugar del `service` que venía del `Promise.all`.

(c) **`listPromotions`**: filtrar para que las opciones de catálogo (`granted`) no aparezcan en la UI de promos por código:
```ts
export async function listPromotions() {
  const { businessId } = await requireBusiness()
  return prisma.promotion.findMany({
    where: { businessId, triggerType: { not: 'granted' } },
    orderBy: { createdAt: 'desc' },
    include: { services: { select: { id: true, name: true } } },
  })
}
```

- [ ] **Step 4: Correr los tests (nuevos + regresión de preview de A)**

Run: `npx vitest run tests/unit/promotions-preview-grant.test.ts && npx vitest run tests/unit/ -t preview`
Expected: PASS; el preview de código de A sigue verde.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/promotions.ts tests/unit/promotions-preview-grant.test.ts
git commit -m "feat(promotions): preview grant-aware + listPromotions excluye catálogo de canje"
```

---

### Task 10: UI — Catálogo de canje + toggles de config (dashboard/fidelizacion)

**Files:**
- Create: `src/app/dashboard/fidelizacion/redemption-catalog.tsx`
- Modify: `src/app/dashboard/fidelizacion/page.tsx`, `src/app/dashboard/fidelizacion/loyalty-config-form.tsx`

> UI: sin unit tests (RSC/client). Verificación = typecheck + build + revisión visual en la Task 14 (e2e).

- [ ] **Step 1: Cargar el catálogo y los servicios en la página.** En `src/app/dashboard/fidelizacion/page.tsx`, importar y cargar:
```ts
import { getLoyaltyConfig, listRedemptionOptions } from '@/server/actions/loyalty'
import { getServices } from '@/server/actions/services'
import { RedemptionCatalog } from './redemption-catalog'
```
Cargar en paralelo `const [config, options, services] = await Promise.all([getLoyaltyConfig(), listRedemptionOptions(), getServices()])` y renderizar `<RedemptionCatalog options={options} services={services} />` debajo del `<LoyaltyConfigForm config={config} />`, dentro del mismo contenedor `max-w-2xl`. (`getServices()` devuelve los servicios del negocio con `{ id, name, price, ... }`; la página de promociones lo usa igual en `src/app/dashboard/promociones/page.tsx:70`.)

- [ ] **Step 2: Agregar los 3 toggles a `loyalty-config-form.tsx`.** El form ya envía un objeto a `upsertLoyaltyConfig`. Sumar campos controlados:
  - `grantExpiryDays` → `<Input type="number" min={1}>` (vacío = sin vencimiento).
  - `refundPointsOnExpiry` → checkbox nativo (default checked).
  - `forfeitGrantOnNoShow` → checkbox nativo (default unchecked).
  Incluirlos en el payload que se manda a `upsertLoyaltyConfig` (mismo patrón que los campos B1 ya presentes). Etiquetas: "Días para vencer una recompensa (vacío = no vence)", "Devolver puntos si la recompensa vence", "Quitar la recompensa si la clienta no asiste (no-show)".

- [ ] **Step 3: Crear el componente `redemption-catalog.tsx`** (client). Lista las opciones con su costo y recompensa, un form de alta/edición (nombre, tipo de recompensa + valor + tope, `pointsCost`, alcance todos/servicios, días de vencimiento opcional, stock opcional, tope por clienta opcional, activa), y un botón "Archivar". Usa `upsertRedemptionOption` y `archiveRedemptionOption` vía `useTransition`. Patrón de referencia: `loyalty-panel.tsx` (form + `startTransition` + manejo de error) y los componentes `ui/button`, `ui/input`. Mostrar la recompensa con `formatMoney` para `fixed_amount`/`maxDiscount` (currency-clean, nada de `$` hardcodeado). Para servicios, checkboxes a partir de `services`.

```tsx
'use client'
import { useState, useTransition } from 'react'
import { upsertRedemptionOption, archiveRedemptionOption } from '@/server/actions/loyalty'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/money' // formatMoney(amount, currency='CLP') — helper currency-clean del repo

type Service = { id: string; name: string; price: number }
type Option = {
  id: string; name: string; rewardType: string; rewardValue: number; maxDiscount: number | null
  pointsCost: number | null; appliesToAll: boolean; grantExpiryDays: number | null
  maxRedemptions: number | null; maxPerCustomer: number | null; isActive: boolean
  services: { id: string; name: string }[]
}

export function RedemptionCatalog({ options, services }: { options: Option[]; services: Service[] }) {
  const [isPending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Option | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = e.currentTarget
    const fd = new FormData(form)
    const appliesToAll = fd.get('appliesToAll') === 'on'
    const data = {
      name: String(fd.get('name') ?? ''),
      rewardType: String(fd.get('rewardType') ?? 'free_service'),
      rewardValue: Number(fd.get('rewardValue') ?? 0),
      maxDiscount: fd.get('maxDiscount') ? Number(fd.get('maxDiscount')) : null,
      pointsCost: Number(fd.get('pointsCost') ?? 0),
      appliesToAll,
      serviceIds: appliesToAll ? [] : services.filter(s => fd.get(`svc_${s.id}`) === 'on').map(s => s.id),
      grantExpiryDays: fd.get('grantExpiryDays') ? Number(fd.get('grantExpiryDays')) : null,
      maxRedemptions: fd.get('maxRedemptions') ? Number(fd.get('maxRedemptions')) : null,
      maxPerCustomer: fd.get('maxPerCustomer') ? Number(fd.get('maxPerCustomer')) : null,
      isActive: fd.get('isActive') !== null ? fd.get('isActive') === 'on' : true,
    }
    start(async () => {
      try {
        await upsertRedemptionOption(data, editing?.id)
        form.reset(); setEditing(null)
      } catch (err) { setError(err instanceof Error ? err.message : 'Error') }
    })
  }

  function onArchive(id: string) {
    start(async () => {
      try { await archiveRedemptionOption(id) }
      catch (err) { setError(err instanceof Error ? err.message : 'Error') }
    })
  }

  return (
    <section className="studio-card mt-6 p-4">
      <h3 className="text-lg font-semibold text-primary">Catálogo de canje</h3>
      <p className="text-sm text-muted-foreground">Define qué recompensas pueden canjear tus clientas con sus puntos.</p>

      <ul className="mt-4 divide-y divide-border">
        {options.map(o => (
          <li key={o.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              <span className="font-medium">{o.name}</span>{' '}
              <span className="text-muted-foreground">· {o.pointsCost} pts</span>
              {!o.isActive && <span className="ml-2 text-xs text-muted-foreground">(archivada)</span>}
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(o)} disabled={isPending}>Editar</Button>
              {o.isActive && <Button size="sm" variant="ghost" onClick={() => onArchive(o.id)} disabled={isPending}>Archivar</Button>}
            </span>
          </li>
        ))}
        {options.length === 0 && <li className="py-2 text-sm text-muted-foreground">Todavía no hay recompensas.</li>}
      </ul>

      <form onSubmit={onSubmit} className="mt-4 grid gap-2" key={editing?.id ?? 'new'}>
        <Input name="name" placeholder="Nombre de la recompensa" defaultValue={editing?.name} required />
        <div className="flex gap-2">
          <select name="rewardType" defaultValue={editing?.rewardType ?? 'free_service'} className="rounded-md border px-2">
            <option value="free_service">Servicio gratis</option>
            <option value="percentage">% de descuento</option>
            <option value="fixed_amount">Monto fijo</option>
          </select>
          <Input name="rewardValue" type="number" placeholder="Valor" defaultValue={editing?.rewardValue} className="w-28" />
          <Input name="pointsCost" type="number" min={1} placeholder="Costo en puntos" defaultValue={editing?.pointsCost ?? undefined} required className="w-36" />
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Input name="maxDiscount" type="number" placeholder="Tope descuento (opc.)" defaultValue={editing?.maxDiscount ?? undefined} className="w-44" />
          <Input name="grantExpiryDays" type="number" min={1} placeholder="Días vencimiento (opc.)" defaultValue={editing?.grantExpiryDays ?? undefined} className="w-44" />
          <Input name="maxRedemptions" type="number" min={1} placeholder="Stock total (opc.)" defaultValue={editing?.maxRedemptions ?? undefined} className="w-40" />
          <Input name="maxPerCustomer" type="number" min={1} placeholder="Tope por clienta (opc.)" defaultValue={editing?.maxPerCustomer ?? undefined} className="w-44" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="appliesToAll" defaultChecked={editing?.appliesToAll ?? true} /> Aplica a todos los servicios
        </label>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Servicios específicos</summary>
          <div className="mt-2 grid grid-cols-2 gap-1">
            {services.map(s => (
              <label key={s.id} className="flex items-center gap-2">
                <input type="checkbox" name={`svc_${s.id}`} defaultChecked={editing?.services.some(es => es.id === s.id)} /> {s.name}
              </label>
            ))}
          </div>
        </details>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={editing?.isActive ?? true} /> Activa
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isPending}>{editing ? 'Guardar cambios' : 'Agregar recompensa'}</Button>
          {editing && <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>}
        </div>
      </form>
    </section>
  )
}
```

> Ajustar imports a los reales del repo: verificar la ruta de `formatMoney` (`grep -rn "export function formatMoney" src`) y de `listServices`. Las clases (`studio-card`, `text-primary`, etc.) y los componentes `ui/*` siguen el patrón de `loyalty-panel.tsx`.

- [ ] **Step 2.5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/fidelizacion
git commit -m "feat(loyalty): UI catálogo de canje + toggles de vencimiento/no-show"
```

---

### Task 11: UI — Canjear + grants activos en el panel de clienta

**Files:**
- Modify: `src/app/dashboard/customers/[id]/loyalty-panel.tsx`, `src/app/dashboard/customers/[id]/page.tsx`

- [ ] **Step 1: Pasar `catalog` y `grants` al panel.** En `customers/[id]/page.tsx:112`, cambiar el destructure `const [{ balance, history }, loyaltyConfig] = await Promise.all([getCustomerLoyalty(id), ...])` por `const [{ balance, history, grants, catalog }, loyaltyConfig] = ...`, y en el `<LoyaltyPanel ... />` (~línea 212) sumar las props `grants={grants}` y `catalog={catalog}` (además de las ya existentes `customerId`, `balance`, `history`, `label`).

- [ ] **Step 2: Extender `loyalty-panel.tsx`.** Sumar a las props `catalog` (opciones activas con `id, name, pointsCost`) y `grants` (activos con `id, code, expiresAt, promotion.name`). Debajo del form de ajuste, dos bloques:
  - **Canjear**: por cada opción del catálogo, un botón "Canjear (N pts)" deshabilitado si `!canAfford(balance, pointsCost)`. Al click: generar `requestId` con `crypto.randomUUID()` y llamar `redeemPointsAsOwner(customerId, optionId, requestId)` dentro de `startTransition`; en éxito refrescar (la action ya hace `revalidatePath`).
  - **Recompensas activas**: lista de `grants` con `code` destacado y, si `expiresAt`, "vence el …" (`Intl.DateTimeFormat`).

```tsx
// nuevas props
catalog: Array<{ id: string; name: string; pointsCost: number | null }>
grants: Array<{ id: string; code: string; expiresAt: Date | null; promotion: { name: string } }>
// import
import { adjustCustomerPoints, redeemPointsAsOwner } from '@/server/actions/loyalty'
import { loyaltyReasonLabel, displayBalance, canAfford } from '@/lib/loyalty/view'

function onRedeem(optionId: string) {
  setError(null)
  const requestId = crypto.randomUUID()
  startTransition(async () => {
    try { await redeemPointsAsOwner(customerId, optionId, requestId) }
    catch (err) { setError(err instanceof Error ? err.message : 'Error') }
  })
}
```
> Doble-click: el botón está `disabled={isPending}`, así que el segundo click queda bloqueado mientras corre la transición; el `requestId` cubre además reintentos de red (idempotencia en `redeemForGrant`).
Bloque de canje:
```tsx
{catalog.length > 0 && (
  <div className="mt-4">
    <h4 className="text-sm font-semibold text-primary">Canjear recompensa</h4>
    <ul className="mt-2 space-y-1">
      {catalog.map(o => (
        <li key={o.id} className="flex items-center justify-between text-sm">
          <span>{o.name} · {o.pointsCost} {label}</span>
          <Button size="sm" disabled={isPending || !canAfford(balance, o.pointsCost ?? 0)} onClick={() => onRedeem(o.id)}>Canjear</Button>
        </li>
      ))}
    </ul>
  </div>
)}
{grants.length > 0 && (
  <div className="mt-4">
    <h4 className="text-sm font-semibold text-primary">Recompensas activas</h4>
    <ul className="mt-2 space-y-1 text-sm">
      {grants.map(g => (
        <li key={g.id} className="flex items-center justify-between">
          <span>{g.promotion.name} — <code className="font-mono">{g.code}</code></span>
          {g.expiresAt && <span className="text-xs text-muted-foreground">vence {new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' }).format(new Date(g.expiresAt))}</span>}
        </li>
      ))}
    </ul>
  </div>
)}
```

- [ ] **Step 2.5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add "src/app/dashboard/customers/[id]"
git commit -m "feat(loyalty): canjear + recompensas activas en panel de clienta"
```

---

### Task 12: UI — Canjear + Mis recompensas en "Mi tarjeta"

**Files:**
- Modify: `src/app/tarjeta/[token]/page.tsx`

- [ ] **Step 1: Reconciliar vencidos + cargar catálogo y grants.** En la página (RSC), tras `resolveLoyaltyCustomer`, llamar `await prisma.$transaction((tx) => reconcileExpiredGrants(tx, customer.id, customer.businessId))` **antes** de leer saldo/historial (en tx: el flip + reembolso deben ser atómicos). Cargar también:
```ts
const catalog = config?.isActive
  ? await prisma.promotion.findMany({
      where: { businessId: customer.businessId, triggerType: 'granted', pointsCost: { not: null }, isActive: true },
      orderBy: { pointsCost: 'asc' }, select: { id: true, name: true, pointsCost: true },
    })
  : []
const grants = await prisma.promotionGrant.findMany({
  where: { customerId: customer.id, businessId: customer.businessId, status: 'active' },
  orderBy: { createdAt: 'desc' }, include: { promotion: { select: { name: true } } },
})
```
Imports: `import { reconcileExpiredGrants } from '@/lib/loyalty/grant'`, `import { canAfford } from '@/lib/loyalty/view'`, `import { redeemPointsAsCustomer } from '@/server/actions/loyalty'`.

- [ ] **Step 2: Sección "Canjear" con server action por form.** La página es RSC sin login; el canje va por un `<form action>` server-side que recibe `token`, `optionId` y un `requestId` generado en el server al renderizar (`crypto.randomUUID()`), evitando JS de cliente. Definir una server action inline (o en el módulo de actions) que envuelva `redeemPointsAsCustomer`:

```tsx
// en la página, arriba del componente:
import { redeemPointsAsCustomer } from '@/server/actions/loyalty'

async function redeemAction(formData: FormData) {
  'use server'
  await redeemPointsAsCustomer(
    String(formData.get('token')), String(formData.get('optionId')), String(formData.get('requestId')),
  )
}
```
Render (sólo si `config?.isActive`):
```tsx
{catalog.length > 0 && (
  <section className="mt-8">
    <h2 className="mb-2 text-sm font-semibold text-gray-700">Canjear puntos</h2>
    <ul className="space-y-2">
      {catalog.map(o => {
        const afford = canAfford(balance, o.pointsCost ?? 0)
        return (
          <li key={o.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
            <span className={afford ? '' : 'text-gray-400'}>{o.name} · {o.pointsCost} {label}</span>
            <form action={redeemAction}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="optionId" value={o.id} />
              <input type="hidden" name="requestId" value={crypto.randomUUID()} />
              <button type="submit" disabled={!afford} className="rounded-md bg-pink-600 px-3 py-1 text-white disabled:opacity-40">Canjear</button>
            </form>
          </li>
        )
      })}
    </ul>
  </section>
)}
{grants.length > 0 && (
  <section className="mt-8">
    <h2 className="mb-2 text-sm font-semibold text-gray-700">Mis recompensas</h2>
    <ul className="space-y-2">
      {grants.map(g => (
        <li key={g.id} className="rounded-lg bg-pink-50 px-3 py-2 text-sm">
          <div className="font-medium text-pink-700">{g.promotion.name}</div>
          <div>Código: <code className="font-mono text-base">{g.code}</code></div>
          {g.expiresAt && <div className="text-xs text-pink-700/70">Válido hasta {new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' }).format(g.expiresAt)}</div>}
        </li>
      ))}
    </ul>
  </section>
)}
```

> El `balance` que se muestra a la clienta usa `displayBalance` (clamp ≥0), pero la afford-check usa el `balance` crudo ya cargado — son consistentes porque el saldo real nunca es negativo.

- [ ] **Step 2.5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add "src/app/tarjeta/[token]/page.tsx"
git commit -m "feat(loyalty): Mi tarjeta — canjear puntos + mis recompensas"
```

---

### Task 13: Suite completa + lint + e2e + gate de migración + PR

**Files:**
- Create (no commit a `tests/e2e/`): `<scratchpad>/e2e-redemption.js`

- [ ] **Step 1: Suite unitaria completa + lint + typecheck**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: todo verde. Si algún test pre-existente falla por orden (flaky de rate-limit como en B1), re-correr aislado para confirmar que no es del código nuevo.

- [ ] **Step 2: GATE — aplicar la migración.** Confirmar con el usuario antes de tocar la DB (regla de repo: no migrar sin OK explícito). Con el OK:

Run: `npx prisma migrate deploy`
Expected: aplica `…_add_redemption`. Verificar que `PromotionGrant` existe y que `LoyaltyReason` tiene los nuevos valores:
```bash
npx prisma db execute --stdin <<'SQL'
SELECT unnest(enum_range(NULL::"LoyaltyReason"));
SQL
```

- [ ] **Step 3: e2e Playwright (validación one-off, NO commitear a `tests/e2e/`).** Levantar el dev server con el bypass: `ENABLE_E2E_AUTH_BYPASS=true nohup npm run dev &`. Script con `extraHTTPHeaders: { 'x-e2e-test-user-email': <owner>, 'x-e2e-auth-secret': <secret> }` (mismo mecanismo que B1, **sin tipear contraseñas**), `NODE_PATH=<repo>/node_modules`, `setDefaultNavigationTimeout(90000)`. Flujo a validar:
  1. En `/dashboard/fidelizacion`: crear una opción de catálogo (ej. "Servicio gratis", `free_service`, `pointsCost` ≤ saldo de una clienta de prueba). Guardar con `getByRole('button', { name: 'Agregar recompensa' })`.
  2. Asegurar saldo: ajustar puntos de la clienta de prueba desde su panel (o usar una con saldo).
  3. Abrir `/tarjeta/<loyaltyToken>` de esa clienta, click **Canjear** → aparece la recompensa en "Mis recompensas" con un código; el saldo baja `pointsCost` (polling hasta 15s por el commit async).
  4. Crear una reserva (pública o dashboard) para esa clienta usando el código del grant como `promotionCode` → verificar `Booking.discountAmount` > 0, el grant pasó a `redeemed`, y `PromotionRedemption` creado.
  5. Cancelar esa reserva → el grant vuelve a `active` (polling).
  Reportar N/N checks verdes.

- [ ] **Step 4: Limpiar artefactos de prueba** creados en el negocio real (opción de catálogo de prueba, reservas, grants) si se usó un negocio prod, como en B1.

- [ ] **Step 5: Commit final + push + PR**

```bash
git add -A && git commit -m "test(loyalty): validación e2e del canje (B2)" --allow-empty
git push -u origin feat/loyalty-redemption-B2
gh pr create --title "feat(loyalty): canje de puntos (rebanada B2)" --body "$(cat <<'EOF'
## Resumen
Rebanada B2: canje de puntos. Catálogo de canje (opciones = promos `granted` con `pointsCost`), emisión de `PromotionGrant` con código al portador, aplicación a la reserva reusando el motor de A, vencimiento configurable con reembolso, y release grant-aware (reactiva la recompensa).

## Cómo se probó
- Suite unitaria completa verde + typecheck + lint.
- e2e Playwright: config opción → canjear en Mi tarjeta → reservar con el código → descuento aplicado + grant redeemed → cancelar → grant reactivado.
- Migración aditiva aplicada a la DB.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> **No** mergear sin OK del usuario (mismo gate que B1).

---

## Notas de cierre / follow-ups (no bloquean B2)
- Cron de barrido de grants vencidos (hoy la reconciliación es lazy en superficies de saldo) → ops/B3.
- Notificación de confirmación de canje (email/WhatsApp con el código) → C.
- Auto-aplicación del grant sin código por identidad de clienta → D/login.
- Panel de pasivo de grants (vivos/canjeados/vencidos) para la dueña → opcional.
