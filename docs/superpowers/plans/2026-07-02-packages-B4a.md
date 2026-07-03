# Paquetes prepagados B4a — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vender paquetes de N sesiones prepagadas (venta manual) y consumirlos automáticamente en reservas, reusando el motor de grants; con reembolso manual y vencimiento.

**Architecture:** `PackageProduct` (catálogo) + `PackagePurchase` (venta, con snapshot de cobertura) emiten N `PromotionGrant` (`free_service`, `packagePurchaseId`) apuntando a UNA `Promotion` marcador por negocio (`triggerType 'granted'`). El consumo usa una nueva `applyPackageInTx` (auto-select por clienta+servicio) que reusa el flip atómico y crea una `PromotionRedemption` (para que el release existente reactive el grant). Cancelación/no-show/vencimiento reusan el engine.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Prisma 5.22 + Postgres, Zod, Vitest (+ integration config), Playwright.

**Spec:** `docs/superpowers/specs/2026-07-02-packages-B4a-design.md`

**Reglas de repo (no negociables):** módulos `'use server'` exportan solo funciones async (helpers module-local sin export); todo `revalidate*` con `await`; currency-clean (`formatMoney`); mantener la suite verde; migración aditiva aplicada SOLO con OK explícito vía DIRECT_URL + `prisma db execute` (NUNCA `migrate deploy`), borrando la línea 1 si trae `zsh: command not found: _nvm_load`; NO mergear hasta OK; PR al final.

**Comandos:** unit `npx vitest --run <path>` / suite `npm run test`; integración `npm run test:integration`; e2e `npm run test:e2e -- <spec>`; typecheck `npx tsc --noEmit` (hay ~17 errores PRE-EXISTENTES en tests/unit/{metrics,time-blocks}, create-booking-no-deposit, mercado-pago-oauth — confirmar CERO nuevos); lint `npx eslint <files>`.

---

## File Structure

- **Modificar** `prisma/schema.prisma` — modelos `PackageProduct`, `PackagePurchase`; `PromotionGrant.packagePurchaseId`; relaciones inversas. Migración `prisma/migrations/<ts>_add_packages/migration.sql`.
- **Crear** `src/lib/packages/schema.ts` — zod (`packageProductSchema`, `sellPackageSchema`) + helpers puros (`computePackageRefund`, `perGrantRequestId`).
- **Crear** `src/lib/packages/consume.ts` — `findApplicablePackageGrant`, `applyPackageInTx`.
- **Crear** `src/lib/booking/recompute.ts` — `recomputeBookingAmountsAfterDiscount` (helper compartido extraído).
- **Crear** `src/server/actions/packages.ts` — `'use server'`: CRUD de productos, `sellPackage`, `refundPackagePurchase`, `getActivePackagesForCustomer`, `getCustomerPackages`.
- **Modificar** `src/server/actions/bookings.ts` — wire consumo (público + manual) usando el helper compartido + precedencia; `createBookingSchema` += `skipPackage`.
- **Modificar** `src/lib/promotions/release.ts` — sin cambios (ya rutea `'granted'`); NO tocar.
- **Modificar** `src/app/tarjeta/[token]/page.tsx` y `src/server/actions/loyalty.ts` (`getCustomerLoyalty`) — filtrar `packagePurchaseId: null` en las listas de recompensas; sección "Mis paquetes".
- **Crear** `src/app/dashboard/paquetes/page.tsx` + `package-catalog.tsx` — CRUD + total de ventas.
- **Modificar** UI de panel de clienta (vender/reembolsar) + funnel (`step-payment.tsx`) + form manual (`new-booking-form.tsx`) — toggle de paquete.
- **Tests:** `tests/unit/packages-*.test.ts`, `tests/integration/packages-*.test.ts`, `tests/e2e/packages.spec.ts`.

---

### Task 1: Schema Prisma + migración aditiva

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/<timestamp>_add_packages/migration.sql`.

- [ ] **Step 1: Agregar modelos y campos.** En `prisma/schema.prisma`:

Agregar al modelo `PromotionGrant` (junto a los otros campos escalares) y su índice:
```prisma
  packagePurchaseId String?
```
En las relaciones de `PromotionGrant` agregar:
```prisma
  packagePurchase PackagePurchase? @relation(fields: [packagePurchaseId], references: [id])
```
Y en sus `@@index`:
```prisma
  @@index([packagePurchaseId])
```

Nuevos modelos:
```prisma
model PackageProduct {
  id              String   @id @default(cuid())
  businessId      String
  name            String
  quantity        Int
  bonusQuantity   Int      @default(0)
  price           Int
  expiryDays      Int?
  appliesToAll    Boolean  @default(true)
  isActive        Boolean  @default(true)
  createdByUserId String?
  updatedByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  business  Business          @relation(fields: [businessId], references: [id], onDelete: Cascade)
  services  Service[]         @relation("PackageProductServices")
  purchases PackagePurchase[]

  @@index([businessId, isActive])
}

model PackagePurchase {
  id                String    @id @default(cuid())
  businessId        String
  customerId        String
  packageProductId  String
  pricePaid         Int
  quantity          Int
  bonusQuantity     Int       @default(0)
  coversAll         Boolean   @default(true)
  coveredServiceIds String[]
  source            String    // 'manual' | 'online'
  paymentMethod     String?
  paidAt            DateTime  @default(now())
  status            String    @default("active") // 'active' | 'refunded'
  expiresAt         DateTime?
  refundedAt        DateTime?
  refundedAmount    Int?
  createdByUserId   String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  business Business         @relation(fields: [businessId], references: [id], onDelete: Cascade)
  customer Customer         @relation(fields: [customerId], references: [id], onDelete: Cascade)
  product  PackageProduct   @relation(fields: [packageProductId], references: [id])
  grants   PromotionGrant[]

  @@index([businessId, status])
  @@index([customerId, status])
}
```
En `model Business` agregar las relaciones inversas:
```prisma
  packageProducts  PackageProduct[]
  packagePurchases PackagePurchase[]
```
En `model Customer` agregar:
```prisma
  packagePurchases PackagePurchase[]
```
En `model Service` agregar (relación inversa del m2m):
```prisma
  packageProducts PackageProduct[] @relation("PackageProductServices")
```

- [ ] **Step 2: Formatear y validar el schema.**

Run: `npx prisma format` → luego `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Generar la migración SQL (NO aplicar).**

Run:
```bash
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --script > prisma/migrations/tmp_packages.sql 2>/dev/null || npx prisma migrate diff --from-schema-datamodel /dev/stdin --to-schema-datamodel prisma/schema.prisma --script > /dev/null
```
Si ese enfoque falla en este entorno, generar el diff con el patrón usado en B1/B2/B3:
```bash
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/20260702_add_packages_tmp.sql
```
Abrir el `.sql`. **Si la línea 1 es `zsh: command not found: _nvm_load`, borrarla.** Verificar que contenga: `CREATE TABLE "PackageProduct"`, `CREATE TABLE "PackagePurchase"`, `ALTER TABLE "PromotionGrant" ADD COLUMN "packagePurchaseId"`, la tabla de join `_PackageProductServices`, y los índices/foreign keys. Mover el archivo a `prisma/migrations/20260702_add_packages/migration.sql` (crear la carpeta). Borrar el `_tmp` si quedó.

- [ ] **Step 4: Regenerar el cliente Prisma.**

Run: `npx prisma generate`
Expected: `Generated Prisma Client`. Luego `npx tsc --noEmit` → CERO errores nuevos (los nuevos tipos `PackageProduct`/`PackagePurchase` existen).

- [ ] **Step 5: Commit.**
```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(packages): schema PackageProduct/PackagePurchase + grant.packagePurchaseId (migración aditiva)"
```

**Nota:** la migración NO se aplica a la DB en esta task. Se aplica en la Task 9 con OK explícito del usuario.

---

### Task 2: Zod schemas + helpers puros

**Files:** Create `src/lib/packages/schema.ts`; Test `tests/unit/packages-schema.test.ts`.

- [ ] **Step 1: Escribir el test** `tests/unit/packages-schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { packageProductSchema, computePackageRefund, perGrantRequestId } from '@/lib/packages/schema'

describe('packageProductSchema', () => {
  it('acepta un producto válido', () => {
    const r = packageProductSchema.safeParse({
      name: 'Pack 5 manicuras', quantity: 5, bonusQuantity: 1, price: 50000,
      expiryDays: 90, appliesToAll: true, serviceIds: [], isActive: true,
    })
    expect(r.success).toBe(true)
  })
  it('rechaza quantity < 1', () => {
    expect(packageProductSchema.safeParse({ name: 'x', quantity: 0, price: 1, appliesToAll: true, serviceIds: [] }).success).toBe(false)
  })
  it('exige servicios si no appliesToAll', () => {
    expect(packageProductSchema.safeParse({ name: 'x', quantity: 1, price: 1, appliesToAll: false, serviceIds: [] }).success).toBe(false)
  })
})

describe('computePackageRefund', () => {
  it('prorratea por total de sesiones (quantity+bonus), tope pricePaid', () => {
    // pricePaid 60000, quantity 5, bonus 1 (total 6), unused 3 → 3 * 60000/6 = 30000
    expect(computePackageRefund({ pricePaid: 60000, quantity: 5, bonusQuantity: 1, unusedSessions: 3 })).toBe(30000)
  })
  it('nunca supera pricePaid', () => {
    expect(computePackageRefund({ pricePaid: 60000, quantity: 5, bonusQuantity: 1, unusedSessions: 6 })).toBe(60000)
  })
  it('0 usos no usados → 0', () => {
    expect(computePackageRefund({ pricePaid: 60000, quantity: 5, bonusQuantity: 1, unusedSessions: 0 })).toBe(0)
  })
})

describe('perGrantRequestId', () => {
  it('deriva ids distintos y deterministas', () => {
    expect(perGrantRequestId('sale-abc', 0)).toBe('sale-abc#0')
    expect(perGrantRequestId('sale-abc', 2)).toBe('sale-abc#2')
    expect(perGrantRequestId('sale-abc', 0)).not.toBe(perGrantRequestId('sale-abc', 1))
  })
})
```

- [ ] **Step 2: Correr y ver fallar.** Run: `npx vitest --run tests/unit/packages-schema.test.ts` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar** `src/lib/packages/schema.ts`:
```ts
import { z } from 'zod'

const optPositiveInt = z.coerce.number().int().optional().nullable().transform((v) => (v && v > 0 ? v : null))

export const packageProductSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(80),
  quantity: z.coerce.number().int().min(1, 'La cantidad debe ser al menos 1').max(1000),
  bonusQuantity: z.coerce.number().int().min(0).max(1000).optional().default(0),
  price: z.coerce.number().int().min(0),
  expiryDays: optPositiveInt,
  appliesToAll: z.boolean(),
  serviceIds: z.array(z.string().min(1)).optional().default([]),
  isActive: z.boolean().optional().default(true),
}).strip()
  .refine((d) => d.appliesToAll || d.serviceIds.length > 0, {
    message: 'Elegí al menos un servicio o aplicá a todos', path: ['serviceIds'],
  })

export const sellPackageSchema = z.object({
  packageProductId: z.string().min(1),
  customerId: z.string().min(1),
  paymentMethod: z.string().trim().max(40).optional().nullable().transform((v) => (v ? v : null)),
  requestId: z.string().min(1).max(100),
}).strip()

export type PackageProductInput = z.infer<typeof packageProductSchema>
export type PackageProductFormInput = z.input<typeof packageProductSchema>
export type SellPackageInput = z.infer<typeof sellPackageSchema>

/** Reembolso default: prorratea las sesiones no usadas sobre el total (pagadas + bonus),
 *  con tope en lo pagado. Editable por la dueña; la exactitud fina no bloquea. */
export function computePackageRefund(a: {
  pricePaid: number; quantity: number; bonusQuantity: number; unusedSessions: number
}): number {
  const total = a.quantity + a.bonusQuantity
  if (total <= 0 || a.unusedSessions <= 0) return 0
  return Math.min(a.pricePaid, Math.round(a.unusedSessions * a.pricePaid / total))
}

/** requestId determinista por grant (evita P2002 con @@unique([customerId, requestId])). */
export function perGrantRequestId(saleRequestId: string, i: number): string {
  return `${saleRequestId}#${i}`
}
```

- [ ] **Step 4: Correr y ver pasar.** Run: `npx vitest --run tests/unit/packages-schema.test.ts` → PASS. Luego `npx tsc --noEmit` (cero nuevos).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/packages/schema.ts tests/unit/packages-schema.test.ts
git commit -m "feat(packages): zod de producto/venta + computePackageRefund + perGrantRequestId"
```

---

### Task 3: Consumo — `findApplicablePackageGrant` + `applyPackageInTx` + recompute compartido

**Files:** Create `src/lib/packages/consume.ts`, `src/lib/booking/recompute.ts`; Test `tests/integration/packages-consume.test.ts` (usa DB real vía la config de integración).

**Contexto:** el flip a copiar está en `src/lib/promotions/apply.ts:19-51` (rama grant). El bloque de recálculo a extraer está en `src/server/actions/bookings.ts:325-343`.

- [ ] **Step 1: Implementar el helper de recálculo** `src/lib/booking/recompute.ts`:
```ts
import { addMinutes } from 'date-fns'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'

/** Recomputa montos/estado de una reserva tras aplicar un descuento (código o paquete).
 *  Extraído de bookings.ts para reusarlo en ambos caminos. Devuelve el objeto `data`
 *  del booking.update. `now` inyectable para test. */
export function recomputeBookingAmountsAfterDiscount(args: {
  price: number; depositAmount: number; discountAmount: number; now?: Date
}): {
  discountAmount: number; finalAmount: number; depositRequired: number; remainingBalance: number
  status: BookingStatus; holdExpiresAt: Date | null; paymentStatus: BookingPaymentStatus
} {
  const now = args.now ?? new Date()
  const discountedFinal = args.price - args.discountAmount
  const discountedDeposit = Math.min(args.depositAmount, discountedFinal)
  const noDeposit = discountedDeposit <= 0
  const free = discountedFinal <= 0
  const status = noDeposit ? BookingStatus.confirmed : BookingStatus.pending_payment
  return {
    discountAmount: args.discountAmount,
    finalAmount: discountedFinal,
    depositRequired: discountedDeposit,
    remainingBalance: discountedFinal,
    status,
    holdExpiresAt: status === BookingStatus.pending_payment ? addMinutes(now, 15) : null,
    paymentStatus: free ? BookingPaymentStatus.fully_paid : BookingPaymentStatus.unpaid,
  }
}
```

- [ ] **Step 2: Implementar el consumo** `src/lib/packages/consume.ts`:
```ts
import type { Prisma } from '@prisma/client'

export interface PackageApplyResult { discountAmount: number; packagePurchaseId: string; promotionId: string }

/** Selecciona el grant de paquete activo, no vencido, cuya COMPRA (snapshot) cubre el
 *  servicio. Vence primero lo que vence antes (nulls al final). Filtra expiración en la
 *  query (el reconcile es lazy). */
export async function findApplicablePackageGrant(
  tx: Prisma.TransactionClient,
  args: { businessId: string; customerId: string; serviceId: string; now?: Date },
) {
  const now = args.now ?? new Date()
  const grants = await tx.promotionGrant.findMany({
    where: {
      businessId: args.businessId, customerId: args.customerId, status: 'active',
      packagePurchaseId: { not: null },
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }],
      packagePurchase: {
        status: 'active',
        OR: [{ coversAll: true }, { coveredServiceIds: { has: args.serviceId } }],
      },
    },
    include: { packagePurchase: { select: { id: true } } },
    orderBy: [{ expiresAt: 'asc' }],
  })
  // Postgres ordena NULLS LAST por defecto en ASC, así que expiresAt null cae al final.
  return grants[0] ?? null
}

/** Aplica un grant de paquete a la reserva (auto-select + flip atómico + PromotionRedemption).
 *  Devuelve null si no hay paquete aplicable. Reusa la mecánica de apply.ts (rama grant). */
export async function applyPackageInTx(
  tx: Prisma.TransactionClient,
  args: {
    businessId: string; customerId: string; serviceId: string; bookingId: string
    totalPrice: number; source: 'public_booking' | 'dashboard_booking'
    createdByUserId?: string | null; now?: Date
  },
): Promise<PackageApplyResult | null> {
  const now = args.now ?? new Date()
  const grant = await findApplicablePackageGrant(tx, {
    businessId: args.businessId, customerId: args.customerId, serviceId: args.serviceId, now,
  })
  if (!grant || !grant.packagePurchase) return null
  // free_service cubre el total del servicio.
  const discount = Math.max(0, args.totalPrice)
  const flipped = await tx.promotionGrant.updateMany({
    where: { id: grant.id, status: 'active' },
    data: { status: 'redeemed', redeemedBookingId: args.bookingId, redeemedAt: now },
  })
  if (flipped.count === 0) return null // carrera: otro booking lo tomó
  await tx.promotionRedemption.create({
    data: {
      businessId: args.businessId, promotionId: grant.promotionId, bookingId: args.bookingId,
      customerId: args.customerId, discountAmount: discount, source: args.source,
      createdByUserId: args.createdByUserId ?? null,
    },
  })
  return { discountAmount: discount, packagePurchaseId: grant.packagePurchase.id, promotionId: grant.promotionId }
}
```

- [ ] **Step 3: Escribir el test de integración** `tests/integration/packages-consume.test.ts`. Mirar un test de integración existente (p.ej. `tests/integration/` de B2/B3) para el patrón de setup de DB (prisma real, limpieza). El test debe: crear negocio+servicio+cliente, una Promotion marcador (`triggerType 'granted'`, `rewardType 'free_service'`, `appliesToAll true`), una `PackagePurchase` (coversAll true, status active) y 2 grants activos (`packagePurchaseId`). Luego crear una reserva y llamar `applyPackageInTx` en una tx:
  - devuelve discount = price y `packagePurchaseId`;
  - deja 1 grant `redeemed` con `redeemedBookingId`, 1 `active`;
  - crea una `PromotionRedemption` para la reserva;
  - segunda llamada sobre otra reserva consume el 2º grant; una tercera devuelve null (sin saldo).
  - un grant vencido (`expiresAt` pasado) NO se selecciona.
  Verificar además que `recomputeBookingAmountsAfterDiscount({ price:10000, depositAmount:3000, discountAmount:10000 })` da `finalAmount 0`, `depositRequired 0`, `status confirmed`, `paymentStatus fully_paid` (esto puede ir como unit en `tests/unit/booking-recompute.test.ts`).

- [ ] **Step 4: Correr integración + unit.** Run: `npx vitest --run tests/unit/booking-recompute.test.ts` (PASS) y `npm run test:integration` (el nuevo verde). `npx tsc --noEmit` cero nuevos.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/packages/consume.ts src/lib/booking/recompute.ts tests/integration/packages-consume.test.ts tests/unit/booking-recompute.test.ts
git commit -m "feat(packages): findApplicablePackageGrant + applyPackageInTx + recompute compartido"
```

---

### Task 4: Server actions de paquetes (backing promo, vender, reembolsar, queries)

**Files:** Create `src/server/actions/packages.ts`; Test `tests/integration/packages-actions.test.ts`.

**Contexto:** `'use server'` → solo exports async. Patrones a mirar: `upsertRedemptionOption`/`sellPackage`-análogo en `src/server/actions/loyalty.ts`; resolución de cliente por teléfono en `src/lib/loyalty/token.ts`/reservas; `checkRateLimit`, `requireBusinessRole`, `revalidatePath`.

- [ ] **Step 1: Implementar** `src/server/actions/packages.ts` con estas exports async y helpers module-local:
```ts
'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { packageProductSchema, sellPackageSchema, computePackageRefund, perGrantRequestId } from '@/lib/packages/schema'
import { generateGrantCode } from '@/lib/loyalty/redeem'

// ── helpers module-local ──────────────────────────────────────────────
const PACKAGE_MARKER_NAME = 'package-coverage'

/** Una Promotion marcador por negocio a la que apuntan los grants de paquete.
 *  triggerType 'granted' (para que release reactive el grant), free_service, appliesToAll,
 *  pointsCost null (excluida del catálogo de canje). Creada lazily. */
async function getOrCreatePackageMarkerPromotion(tx: Prisma.TransactionClient, businessId: string): Promise<string> {
  const existing = await tx.promotion.findFirst({
    where: { businessId, triggerType: 'granted', name: PACKAGE_MARKER_NAME, pointsCost: null },
    select: { id: true },
  })
  if (existing) return existing.id
  const created = await tx.promotion.create({
    data: {
      businessId, name: PACKAGE_MARKER_NAME, triggerType: 'granted',
      rewardType: 'free_service', rewardValue: 0, appliesToAll: true, isActive: true,
      metadata: { kind: 'package-coverage' } as Prisma.InputJsonValue,
    },
    select: { id: true },
  })
  return created.id
}

// ── CRUD de productos ─────────────────────────────────────────────────
export async function listPackageProducts() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.packageProduct.findMany({
    where: { businessId }, orderBy: { createdAt: 'desc' },
    include: { services: { select: { id: true, name: true } }, _count: { select: { purchases: true } } },
  })
}

export async function upsertPackageProduct(data: unknown, id?: string) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('package-product', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  const parsed = packageProductSchema.safeParse(data)
  if (!parsed.success) throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  const d = parsed.data
  if (!d.appliesToAll && d.serviceIds.length) {
    const count = await prisma.service.count({ where: { id: { in: d.serviceIds }, businessId } })
    if (count !== d.serviceIds.length) throw new Error('Servicio inválido')
  }
  const scalars = {
    name: d.name, quantity: d.quantity, bonusQuantity: d.bonusQuantity, price: d.price,
    expiryDays: d.expiryDays, appliesToAll: d.appliesToAll, isActive: d.isActive,
  }
  if (id) {
    const existing = await prisma.packageProduct.findFirst({ where: { id, businessId }, select: { id: true } })
    if (!existing) throw new ForbiddenError('Paquete no encontrado')
    await prisma.packageProduct.update({
      where: { id },
      data: { ...scalars, updatedByUserId: user.id,
        services: d.appliesToAll ? { set: [] } : { set: d.serviceIds.map(sid => ({ id: sid })) } },
    })
  } else {
    await prisma.packageProduct.create({
      data: { businessId, ...scalars, createdByUserId: user.id,
        services: d.appliesToAll ? undefined : { connect: d.serviceIds.map(sid => ({ id: sid })) } },
    })
  }
  await revalidatePath('/dashboard/paquetes')
}

export async function archivePackageProduct(id: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const existing = await prisma.packageProduct.findFirst({ where: { id, businessId }, select: { id: true } })
  if (!existing) throw new ForbiddenError('Paquete no encontrado')
  await prisma.packageProduct.update({ where: { id }, data: { isActive: false } })
  await revalidatePath('/dashboard/paquetes')
}

// ── vender ────────────────────────────────────────────────────────────
export async function sellPackage(data: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('package-sell', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  const parsed = sellPackageSchema.safeParse(data)
  if (!parsed.success) throw new Error('Datos inválidos')
  const d = parsed.data

  const [product, customer] = await Promise.all([
    prisma.packageProduct.findFirst({
      where: { id: d.packageProductId, businessId, isActive: true },
      include: { services: { select: { id: true } } },
    }),
    prisma.customer.findFirst({ where: { id: d.customerId, businessId }, select: { id: true } }),
  ])
  if (!product) throw new Error('Paquete no disponible')
  if (!customer) throw new ForbiddenError('Clienta no encontrada')

  const now = new Date()
  const expiresAt = product.expiryDays ? new Date(now.getTime() + product.expiryDays * 86_400_000) : null
  const total = product.quantity + product.bonusQuantity

  try {
    await prisma.$transaction(async (tx) => {
      const markerId = await getOrCreatePackageMarkerPromotion(tx, businessId)
      const purchase = await tx.packagePurchase.create({
        data: {
          businessId, customerId: customer.id, packageProductId: product.id,
          pricePaid: product.price, quantity: product.quantity, bonusQuantity: product.bonusQuantity,
          coversAll: product.appliesToAll, coveredServiceIds: product.services.map(s => s.id),
          source: 'manual', paymentMethod: d.paymentMethod, paidAt: now, status: 'active',
          expiresAt, createdByUserId: user.id,
        },
      })
      for (let i = 0; i < total; i++) {
        await tx.promotionGrant.create({
          data: {
            businessId, promotionId: markerId, customerId: customer.id,
            code: generateGrantCode(), pointsSpent: 0, status: 'active',
            expiresAt, refundOnExpiry: false, forfeitOnNoShow: false,
            requestId: perGrantRequestId(d.requestId, i), packagePurchaseId: purchase.id,
            createdByUserId: user.id,
          },
        })
      }
    })
  } catch (e) {
    // Reintento idempotente: si los grants ya existían por este requestId, no-op.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const already = await prisma.packagePurchase.findFirst({
        where: { businessId, customerId: customer.id, packageProductId: product.id },
        orderBy: { createdAt: 'desc' }, select: { id: true },
      })
      if (already) { await revalidatePath('/dashboard/customers/' + customer.id); return }
    }
    throw e
  }
  await revalidatePath('/dashboard/customers/' + customer.id)
}

// ── reembolsar ──────────────────────────────────────────────────────────
export async function refundPackagePurchase(purchaseId: string) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('package-refund', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  const purchase = await prisma.packagePurchase.findFirst({
    where: { id: purchaseId, businessId },
    include: { _count: { select: { grants: { where: { status: 'active' } } } } },
  })
  if (!purchase) throw new ForbiddenError('Compra no encontrada')
  if (purchase.status === 'refunded') return // idempotente
  const unused = purchase._count.grants
  const refund = computePackageRefund({
    pricePaid: purchase.pricePaid, quantity: purchase.quantity,
    bonusQuantity: purchase.bonusQuantity, unusedSessions: unused,
  })
  await prisma.$transaction(async (tx) => {
    await tx.promotionGrant.updateMany({
      where: { packagePurchaseId: purchase.id, status: 'active' },
      data: { status: 'reversed', reversedAt: new Date() },
    })
    await tx.packagePurchase.update({
      where: { id: purchase.id },
      data: { status: 'refunded', refundedAt: new Date(), refundedAmount: refund },
    })
  })
  await revalidatePath('/dashboard/customers/' + purchase.customerId)
}

// ── queries para UI de reserva / cliente ─────────────────────────────────
export async function getActivePackagesForCustomer(phone: string, serviceId: string) {
  const { businessId } = await requireBusiness()
  const { normalizePhone } = await import('@/lib/phone')
  const normalized = normalizePhone(phone)
  if (!normalized) return { remaining: 0 }
  const customer = await prisma.customer.findFirst({ where: { businessId, phone: normalized }, select: { id: true } })
  if (!customer) return { remaining: 0 }
  const now = new Date()
  const remaining = await prisma.promotionGrant.count({
    where: {
      businessId, customerId: customer.id, status: 'active', packagePurchaseId: { not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      packagePurchase: { status: 'active', OR: [{ coversAll: true }, { coveredServiceIds: { has: serviceId } }] },
    },
  })
  return { remaining }
}

export async function getCustomerPackages(customerId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const now = new Date()
  const purchases = await prisma.packagePurchase.findMany({
    where: { businessId, customerId },
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { name: true } },
      _count: { select: { grants: { where: { status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] } } } },
    },
  })
  return purchases
}
```
**Nota:** confirmar que `generateGrantCode` se exporta de `src/lib/loyalty/redeem.ts` (B2). Si no, mirar dónde vive el generador de códigos de grant y usarlo. Confirmar el nombre real de `normalizePhone` (usado en B3 createBooking) y su ruta; ajustar el import.

- [ ] **Step 2: Test de integración** `tests/integration/packages-actions.test.ts`: `sellPackage` con quantity 5 + bonus 1 → 6 grants activos + 1 PackagePurchase (snapshot correcto); reintento con el mismo `requestId` → no duplica (idempotente). `refundPackagePurchase` → grants activos a `reversed`, `refundedAmount` correcto, idempotente. `getActivePackagesForCustomer` cuenta bien.

- [ ] **Step 3: Verificar.** `npm run test:integration` (verde), `npx tsc --noEmit` (cero nuevos), confirmar las 8 exports son async (`grep -n "export async function" src/server/actions/packages.ts`).

- [ ] **Step 4: Commit.**
```bash
git add src/server/actions/packages.ts tests/integration/packages-actions.test.ts
git commit -m "feat(packages): server actions (CRUD, sellPackage, refund, queries) + backing promo marcador"
```

---

### Task 5: Wire consumo en reservas (público + manual) + recompute compartido + precedencia

**Files:** Modify `src/server/actions/bookings.ts`.

**Contexto:** público en `bookings.ts:311-347`, manual análogo en `bookings.ts:~804-846`. `createBookingSchema` en `bookings.ts:33`.

- [ ] **Step 1: Refactor — usar el helper compartido en el camino de código (sin cambiar comportamiento).** En el bloque público (`bookings.ts:322-346`) reemplazar el cálculo inline por:
```ts
      if (!promoRes) return booking
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: recomputeBookingAmountsAfterDiscount({
          price: service.price, depositAmount: service.depositAmount, discountAmount: promoRes.discountAmount,
        }),
        include: { service: true, customer: true },
      })
      return updated
```
Agregar el import: `import { recomputeBookingAmountsAfterDiscount } from '@/lib/booking/recompute'` y `import { applyPackageInTx } from '@/lib/packages/consume'`. Hacer el refactor equivalente en el bloque manual (`~816-846`). Correr `npm run test` → la suite existente de reservas debe seguir verde (refactor sin cambio de comportamiento).

- [ ] **Step 2: Agregar `skipPackage` al schema.** En `createBookingSchema` (`bookings.ts:33`) agregar:
```ts
  skipPackage: z.boolean().optional(),
```
y al tipo de input correspondiente (`bookings.ts:~162`) `skipPackage?: boolean`.

- [ ] **Step 3: Aplicar paquete con precedencia (público).** Reemplazar el bloque que llama `applyPromotionInTx` por (público):
```ts
      // Precedencia: paquete prepago gana sobre código. Si aplica un paquete, se ignora el código.
      let discount: { discountAmount: number } | null = null
      if (!data.skipPackage) {
        discount = await applyPackageInTx(tx, {
          businessId, customerId: customer.id, serviceId: data.serviceId,
          bookingId: booking.id, totalPrice: service.price, source: 'public_booking',
        })
      }
      if (!discount) {
        discount = await applyPromotionInTx(tx, {
          businessId, code: parsed.data.promotionCode, serviceId: data.serviceId,
          customerId: customer.id, totalPrice: service.price, bookingId: booking.id,
          source: 'public_booking',
        })
      }
      if (!discount) return booking
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: recomputeBookingAmountsAfterDiscount({
          price: service.price, depositAmount: service.depositAmount, discountAmount: discount.discountAmount,
        }),
        include: { service: true, customer: true },
      })
      return updated
```
Hacer el equivalente en el camino manual (`source: 'dashboard_booking'`, `createdByUserId: user.id`, y respetar su `skipPackage`).

- [ ] **Step 4: Verificar.** `npm run test` (suite verde), `npx tsc --noEmit` (cero nuevos), `npx eslint src/server/actions/bookings.ts` (sin nuevos).

- [ ] **Step 5: Commit.**
```bash
git add src/server/actions/bookings.ts
git commit -m "feat(packages): consumo auto en reservas (público+manual) con precedencia + recompute compartido"
```

---

### Task 6: Filtrar grants de paquete de las listas de recompensas

**Files:** Modify `src/app/tarjeta/[token]/page.tsx`, `src/server/actions/loyalty.ts`.

- [ ] **Step 1: Filtrar en `getCustomerLoyalty`.** En `src/server/actions/loyalty.ts` (la query `grants` dentro del `Promise.all`, ~línea 100), agregar `packagePurchaseId: null` al `where`:
```ts
    prisma.promotionGrant.findMany({
      where: { customerId, businessId, status: 'active', packagePurchaseId: null },
      orderBy: { createdAt: 'desc' },
      include: { promotion: { select: { name: true } } },
    }),
```

- [ ] **Step 2: Filtrar en la tarjeta pública.** En `src/app/tarjeta/[token]/page.tsx` (~línea 53) agregar `packagePurchaseId: null`:
```ts
    prisma.promotionGrant.findMany({
      where: { customerId: customer.id, businessId: customer.businessId, status: 'active', packagePurchaseId: null },
      orderBy: { createdAt: 'desc' },
      include: { promotion: { select: { name: true } } },
    }),
```

- [ ] **Step 3: Verificar.** `npm run test` (verde), `npx tsc --noEmit` (cero nuevos). (La cobertura real de que NO se filtren se agrega en la integración/e2e de las tasks siguientes; acá es el fix defensivo.)

- [ ] **Step 4: Commit.**
```bash
git add src/app/tarjeta/[token]/page.tsx src/server/actions/loyalty.ts
git commit -m "fix(packages): excluir grants de paquete de las listas de recompensas (packagePurchaseId null)"
```

---

### Task 7: UI — página "Paquetes" (catálogo CRUD + total de ventas)

**Files:** Create `src/app/dashboard/paquetes/page.tsx`, `src/app/dashboard/paquetes/package-catalog.tsx`; Modify el sidebar del dashboard.

**Contexto:** mirar `src/app/dashboard/fidelizacion/redemption-catalog.tsx` (patrón de CRUD con form, servicios, appliesToAll) y `src/app/dashboard/fidelizacion/page.tsx` (RSC que carga datos). Sidebar: buscar el componente de navegación del dashboard (grep `dashboard/fidelizacion` en `src/components`/`src/app` para encontrar dónde se listan las entradas) y agregar "Paquetes".

- [ ] **Step 1: RSC page** `src/app/dashboard/paquetes/page.tsx`: patrón idéntico a `fidelizacion/page.tsx` — auth guard (`getCurrentUserWithBusiness`), cargar `listPackageProducts()` + `getServices()`, computar el total de ventas (suma de `pricePaid` de `packagePurchase` activas del negocio — agregar una action `getPackageSalesTotal()` a packages.ts que haga `packagePurchase.aggregate({ _sum: { pricePaid }, where: { businessId, status: 'active' } })`), y renderizar `<DashboardHeader title="Paquetes" .../>` + el total (con `formatMoney(total, currency)`) + `<PackageCatalog products={...} services={...} currency={...} />`.

- [ ] **Step 2: Client `package-catalog.tsx`**: reusar la estructura de `redemption-catalog.tsx` — lista de productos con form de alta/edición (campos: nombre, cantidad, bonus, precio, días de vencimiento, checkbox "aplica a todos" + selección de servicios, activo), botones Crear/Guardar/Desactivar cableados a `upsertPackageProduct`/`archivePackageProduct` en `useTransition`. Currency-clean con `formatMoney` para mostrar precio.

- [ ] **Step 3: Sidebar.** Agregar la entrada "Paquetes" → `/dashboard/paquetes` junto a "Fidelización" en el componente de navegación.

- [ ] **Step 4: Verificar.** `npx tsc --noEmit` (cero nuevos), `npm run lint` (sin nuevos), y arrancar mentalmente que `getPackageSalesTotal` fue agregada a packages.ts (async export). `npm run test` verde.

- [ ] **Step 5: Commit.**
```bash
git add src/app/dashboard/paquetes/ src/server/actions/packages.ts && git add -A
git commit -m "feat(packages): página Paquetes (catálogo CRUD + total de ventas) + sidebar"
```

---

### Task 8: UI — vender/reembolsar en panel de clienta + "Mis paquetes" en tarjeta + toggle en reservas

**Files:** Modify el panel de detalle de clienta (`src/app/dashboard/customers/[id]/*`), `src/app/tarjeta/[token]/page.tsx`, `src/components/booking/step-payment.tsx`, `src/app/dashboard/.../new-booking-form.tsx`.

**Contexto:** panel de clienta → mirar `src/app/dashboard/customers/[id]/loyalty-panel.tsx` (grants + canje) como patrón. Toggle de reserva → `step-payment.tsx:97-177` (bloque de promo con `previewPromotion`) y `new-booking-form.tsx:121-159`.

- [ ] **Step 1: Panel de clienta — vender + paquetes activos.** Agregar una sección "Paquetes" que: (a) liste `getCustomerPackages(customerId)` (nombre, sesiones restantes, vencimiento, estado) con botón **Reembolsar** (→ `refundPackagePurchase`, con confirmación); (b) un mini-form "Vender paquete" (select de `listPackageProducts` activos + método de pago + botón) que llame `sellPackage({ packageProductId, customerId, paymentMethod, requestId: crypto.randomUUID() })` en `useTransition`. Currency-clean.

- [ ] **Step 2: "Mis paquetes" en la tarjeta pública.** En `tarjeta/[token]/page.tsx`, cargar los paquetes activos de la clienta (query `packagePurchase` con `_count` de grants activos no vencidos, como `getCustomerPackages` pero sin auth-owner: resolver por el token ya resuelto en la página) y renderizar una sección "Mis paquetes" (nombre, sesiones restantes, vencimiento). Solo lectura.

- [ ] **Step 3: Toggle en el funnel público.** En `step-payment.tsx`, tras conocer `data.customerPhone` + `data.serviceId`, llamar `getActivePackagesForCustomer(phone, serviceId)`; si `remaining > 0`, mostrar un bloque "Tenés un paquete que cubre esto (quedan N). Usarlo por defecto." con un checkbox default-on. Al enviar la reserva, pasar `skipPackage: !usePackage` en el payload de `createBooking`. Lift del estado a `BookingData` (`wizard.tsx`) si debe sobrevivir navegación.

- [ ] **Step 4: Toggle en el form manual.** En `new-booking-form.tsx`, cuando hay `selectedCustomerId`/`customerPhone` + `serviceId`, llamar `getActivePackagesForCustomer` reactivo (mirror de la invalidación al cambiar servicio, `new-booking-form.tsx:156-159`) y mostrar el mismo toggle; pasar `skipPackage` a la action manual.

- [ ] **Step 5: Verificar.** `npx tsc --noEmit` (cero nuevos), `npm run lint` (sin nuevos), `npm run test` verde.

- [ ] **Step 6: Commit.**
```bash
git add -A
git commit -m "feat(packages): vender/reembolsar en panel de clienta + Mis paquetes en tarjeta + toggle en reservas"
```

---

### Task 9: e2e + gate + aplicar migración (con OK) + PR

**Files:** Create `tests/e2e/packages.spec.ts`.

- [ ] **Step 1: Aplicar la migración a la DB (GATE — requiere OK explícito del usuario).** El controller pide OK. Con OK:
```bash
dotenvx run -f .env.local -- bash -c 'npx prisma db execute --url "$DIRECT_URL" --file prisma/migrations/20260702_add_packages/migration.sql'
```
Verificar: las tablas `PackageProduct`, `PackagePurchase`, `_PackageProductServices` y la columna `PromotionGrant.packagePurchaseId` existen. (Sin este paso el e2e contra el stack real falla.)

- [ ] **Step 2: e2e** `tests/e2e/packages.spec.ts` (reusar `setOwnerAuth` de `tests/e2e/helpers/auth`, `gotoStable`, `waitForHydration`; `test.setTimeout(90_000)`):
  - owner va a `/dashboard/paquetes` → crea "Pack 3 test-<ts>" (cantidad 3, aplica a todos, precio X);
  - va al detalle de una clienta (o crea una) → vende ese paquete;
  - crea una reserva manual del servicio para esa clienta (fecha dentro de `bookingWindowDays`) → la reserva queda **Confirmada** y cubierta (sin pedir depósito);
  - vuelve al panel de la clienta → el paquete muestra **2** sesiones restantes (bajó de 3).
  Aserciones robustas (fila por nombre único; hidratación + reintento).

- [ ] **Step 3: Correr e2e.** `npm run test:e2e -- packages` → verde. Iterar selectores si hace falta (sin debilitar aserciones).

- [ ] **Step 4: Gate final.** `npm run test` (suite verde), `npm run test:integration` (verde), `npm run lint` (sin nuevos), `npx tsc --noEmit` (cero nuevos).

- [ ] **Step 5: Commit + PR.**
```bash
git add tests/e2e/packages.spec.ts
git commit -m "test(packages): e2e venta manual + consumo en reserva"
```
Luego /simplify sobre el diff, code review experto, y `gh pr create --base main` (NO mergear hasta OK). Actualizar la memoria `promotions-loyalty-initiative` (B4a construida; B4b pendiente).

---

## Self-Review (autor del plan)

- **Cobertura del spec:** modelos+migración (T1); zod+refund+requestId (T2); consumo `applyPackageInTx`+recompute (T3); backing promo+vender+reembolsar+queries (T4); wire reservas+precedencia (T5); fix de fuga (T6); página Paquetes+total ventas (T7); panel cliente/tarjeta/toggles (T8); e2e+migración+PR (T9). Puntos-en-visita-cubierta = decisión documentada, sin código (correcto). Finanzas = documentado + total en T7. ✔
- **Placeholders:** los tasks de UI (T7/T8) referencian patrones existentes con código nuevo clave provisto; los tasks de lógica (T1-T6) tienen código completo. Puntos a confirmar por el implementador señalados explícitamente (`generateGrantCode`, `normalizePhone`, ubicación del sidebar). ✔
- **Consistencia de tipos:** `applyPackageInTx`/`findApplicablePackageGrant`/`recomputeBookingAmountsAfterDiscount`/`computePackageRefund`/`perGrantRequestId`/`sellPackage`/`getActivePackagesForCustomer` se definen en T2-T4 y se consumen con las mismas firmas en T5-T8. Backing promo `triggerType 'granted'` consistente con el reuso de `release.ts`. ✔
