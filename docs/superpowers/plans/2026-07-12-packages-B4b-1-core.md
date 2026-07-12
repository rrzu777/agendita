# B4b-1 — Generalización del core de paquetes (ledger unificado) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que TODA venta de paquete (hoy solo la manual de B4a) quede registrada en el ledger financiero como ingreso, y dejar el core de pagos listo para pagos no-booking (`Payment` polimórfico + `activatePackagePurchaseInTx`), sin construir aún UI pública ni webhooks.

**Architecture:** Migración aditiva que vuelve `Payment.bookingId` nullable, agrega `Payment.packagePurchaseId`/`LedgerEntry.packagePurchaseId`/`PackagePurchase.holdExpiresAt` y los valores de enum `package_purchase`/`package_sale`. Se extrae un único matcher de `Customer` (`findOrCreateCustomerInTx`) que reemplaza el inline duplicado en los dos caminos de reserva, y un único activador de paquete (`activatePackagePurchaseInTx`) que emite grants + escribe el asiento de ledger — invocado por `sellPackage` (manual, ahora con ledger) y por una nueva rama de pago de paquete lista pero **sin caller público en esta rebanada**. `getPackageSalesTotal` pasa a derivarse del ledger (fuente única). El camino de reserva de `applyApprovedPayment` queda **con contrato externo idéntico** (cero ripple sobre los ~8 callers de booking).

**Tech Stack:** Next.js 16 (App Router, server actions `'use server'`), Prisma + PostgreSQL, Vitest 4, TypeScript estricto.

**Spec:** `docs/superpowers/specs/2026-07-12-packages-B4b-design.md` (rebanada B4b-1, líneas 104).

---

## File Structure

**Nuevos:**
- `src/lib/customers/find-or-create.ts` — `findOrCreateCustomerInTx(tx, input)`: matcher único por `(businessId, normalizePhone)`, crea si falta, backfillea email, linkea sesión. Único responsable de resolver la `Customer` en reservas y (a futuro) compras.
- `src/lib/packages/activate.ts` — `getOrCreatePackageMarkerPromotion` (movido desde `packages.ts`) + `activatePackagePurchaseInTx(tx, purchase, opts)`: emite grants + asiento de ledger. Único activador de paquete.
- `tests/unit/find-or-create-customer.test.ts`, `tests/unit/activate-package.test.ts`, `tests/unit/package-sales-total.test.ts` — tests nuevos.

**Modificados:**
- `prisma/schema.prisma` — `Payment` polimórfico, `LedgerEntry.packagePurchaseId`, `PackagePurchase.holdExpiresAt`, enums.
- `src/server/services/finance.ts` — mappers ganan `package_purchase`; se extrae `upsertApprovedPayment` (tronco compartido); nueva `applyApprovedPackagePayment` (rama paquete). `applyApprovedPayment` conserva firma/retorno.
- `src/server/actions/packages.ts` — `sellPackage` delega en `activatePackagePurchaseInTx`; `refundPackagePurchase` escribe asiento `refund_issued`; `getPackageSalesTotal` deriva del ledger.
- `src/server/actions/bookings.ts` — `createBooking` y `createBookingFromDashboard` usan `findOrCreateCustomerInTx`.
- `src/components/dashboard/ledger-table.tsx` — label `package_sale`.
- Tests existentes de finance (`tests/unit/finance-service.test.ts`) ganan casos de mapeo.

---

## Task 1: Migración aditiva (Payment polimórfico + enums)

**Files:**
- Modify: `prisma/schema.prisma:436-463` (Payment), `:490-515` (LedgerEntry), `:481-488` (PaymentType), `:517-528` (LedgerEntryType), `:739-767` (PackagePurchase)
- Create: `prisma/migrations/20260712120000_packages_polymorphic_payment/migration.sql`

> **Landmines (memoria del initiative):** (a) NO usar `prisma migrate diff` contra la DB compartida — arrastra DROPs de migraciones de worktrees hermanos; hand-escribir el `.sql`. (b) Aplicar con `db execute` **y luego** `migrate resolve --applied` o el deploy de Vercel (`migrate deploy`) se rompe.

- [ ] **Step 1: Editar `prisma/schema.prisma` — Payment polimórfico**

En `model Payment` (línea 439) cambiar `bookingId String` → `bookingId String?`, agregar `packagePurchaseId String?`, cambiar la relación `booking` a opcional y agregar la relación + índice:

```prisma
model Payment {
  id                String          @id @default(cuid())
  businessId        String
  bookingId         String?
  packagePurchaseId String?
  customerId        String
  provider          PaymentProvider
  providerPaymentId String?
  amount            Int
  currency          String          @default("CLP")
  status            PaymentStatus
  paymentType       PaymentType
  paymentMethod     String?
  paidAt            DateTime?
  rawPayload        Json?
  createdAt         DateTime        @default(now())

  business        Business         @relation(fields: [businessId], references: [id], onDelete: Cascade)
  booking         Booking?         @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  packagePurchase PackagePurchase? @relation(fields: [packagePurchaseId], references: [id], onDelete: Cascade)
  customer        Customer         @relation(fields: [customerId], references: [id], onDelete: Cascade)
  ledgerEntries   LedgerEntry[]

  @@unique([bookingId, provider, providerPaymentId])
  @@index([businessId, status])
  @@index([packagePurchaseId])
}
```

- [ ] **Step 2: Editar `prisma/schema.prisma` — LedgerEntry gana packagePurchaseId**

En `model LedgerEntry` (línea 490) agregar el campo, la relación y el índice:

```prisma
model LedgerEntry {
  id                String          @id @default(cuid())
  businessId        String
  bookingId         String?
  packagePurchaseId String?
  paymentId         String?
  customerId        String?
  type              LedgerEntryType
  direction         LedgerDirection
  amount            Int
  currency          String          @default("CLP")
  description       String?
  occurredAt        DateTime
  createdAt         DateTime        @default(now())
  createdByUserId   String?

  business        Business         @relation(fields: [businessId], references: [id], onDelete: Cascade)
  booking         Booking?         @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  packagePurchase PackagePurchase? @relation(fields: [packagePurchaseId], references: [id], onDelete: Cascade)
  payment         Payment?         @relation(fields: [paymentId], references: [id], onDelete: Cascade)

  @@unique([paymentId])
  @@index([businessId, occurredAt])
  @@index([bookingId])
  @@index([packagePurchaseId])
}
```

- [ ] **Step 3: Editar `prisma/schema.prisma` — enums + relaciones inversas en PackagePurchase**

Agregar el valor a cada enum:

```prisma
enum PaymentType {
  deposit
  final_payment
  full_payment
  refund
  cancellation_fee
  manual_adjustment
  package_purchase
}
```

```prisma
enum LedgerEntryType {
  booking_created
  deposit_paid
  final_payment_paid
  full_payment_paid
  refund_issued
  discount_applied
  cancellation_fee_charged
  manual_income
  manual_expense
  adjustment
  package_sale
}
```

En `model PackagePurchase` (línea 739) agregar `holdExpiresAt` y las relaciones inversas `payments`/`ledgerEntries`:

```prisma
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
  source            String
  paymentMethod     String?
  paidAt            DateTime  @default(now())
  status            String    @default("active")
  holdExpiresAt     DateTime?
  expiresAt         DateTime?
  refundedAt        DateTime?
  refundedAmount    Int?
  createdByUserId   String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  business      Business         @relation(fields: [businessId], references: [id], onDelete: Cascade)
  customer      Customer         @relation(fields: [customerId], references: [id], onDelete: Cascade)
  product       PackageProduct   @relation(fields: [packageProductId], references: [id])
  grants        PromotionGrant[]
  payments      Payment[]
  ledgerEntries LedgerEntry[]

  @@index([businessId, status])
  @@index([customerId, status])
}
```

- [ ] **Step 4: Regenerar el client y verificar que compila el schema**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` sin errores (valida que las relaciones inversas Payment↔PackagePurchase↔LedgerEntry cierran).

- [ ] **Step 5: Hand-escribir la migración SQL**

Create `prisma/migrations/20260712120000_packages_polymorphic_payment/migration.sql` con EXACTAMENTE estas sentencias (solo las de esta rama; no correr `migrate diff`):

```sql
-- Payment: bookingId nullable + packagePurchaseId polimórfico
ALTER TABLE "Payment" ALTER COLUMN "bookingId" DROP NOT NULL;
ALTER TABLE "Payment" ADD COLUMN "packagePurchaseId" TEXT;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_packagePurchaseId_fkey" FOREIGN KEY ("packagePurchaseId") REFERENCES "PackagePurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Payment_packagePurchaseId_idx" ON "Payment"("packagePurchaseId");

-- LedgerEntry: packagePurchaseId (para netear reembolsos de paquete en getPackageSalesTotal)
ALTER TABLE "LedgerEntry" ADD COLUMN "packagePurchaseId" TEXT;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_packagePurchaseId_fkey" FOREIGN KEY ("packagePurchaseId") REFERENCES "PackagePurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "LedgerEntry_packagePurchaseId_idx" ON "LedgerEntry"("packagePurchaseId");

-- PackagePurchase: hold para transferencias (usado recién en B4b-3, columna aditiva ahora)
ALTER TABLE "PackagePurchase" ADD COLUMN "holdExpiresAt" TIMESTAMP(3);

-- Enums (ADD VALUE es idempotente-seguro con IF NOT EXISTS)
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'package_purchase';
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'package_sale';
```

- [ ] **Step 6: Aplicar la migración a la DB compartida y marcarla aplicada**

Run:
```bash
npx prisma db execute --file prisma/migrations/20260712120000_packages_polymorphic_payment/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20260712120000_packages_polymorphic_payment
```
Expected: `Script executed successfully.` y `Migration ... marked as applied.` (sin este `resolve`, `migrate deploy` en Vercel intentará re-aplicar y romperá el build).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260712120000_packages_polymorphic_payment/migration.sql
git commit -m "feat(packages): Payment polimórfico + packagePurchaseId en ledger + enums package_sale/package_purchase"
```

---

## Task 2: Mappers de finance ganan `package_purchase`

**Files:**
- Modify: `src/server/services/finance.ts:15-72` (los tres switches exhaustivos)
- Test: `tests/unit/finance-service.test.ts`

> El switch exhaustivo con `const _exhaustive: never` obliga a manejar el nuevo valor de enum en `mapPaymentTypeToLedgerEntryType` y `getLedgerDescription`, o `tsc` falla. Este task cierra esos gaps.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/unit/finance-service.test.ts`, dentro del `describe('mapPaymentTypeToLedgerEntryType')` agregar:

```ts
  it('package_purchase → package_sale', async () => {
    const { mapPaymentTypeToLedgerEntryType } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerEntryType(PaymentType.package_purchase)).toBe('package_sale')
  })
```

Y un nuevo `describe` para la dirección:

```ts
describe('mapPaymentTypeToLedgerDirection', () => {
  it('package_purchase → income', async () => {
    const { mapPaymentTypeToLedgerDirection } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerDirection(PaymentType.package_purchase)).toBe('income')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/unit/finance-service.test.ts`
Expected: FAIL — `package_sale` no se retorna aún (y `tsc` marcaría el switch incompleto).

- [ ] **Step 3: Agregar el caso a `mapPaymentTypeToLedgerEntryType`**

En `src/server/services/finance.ts`, dentro del `switch (paymentType)` de `mapPaymentTypeToLedgerEntryType` (antes del `default`):

```ts
    case 'manual_adjustment':
      return 'adjustment'
    case 'package_purchase':
      return 'package_sale'
    default: {
```

- [ ] **Step 4: Agregar el caso a `getLedgerDescription`**

`mapPaymentTypeToLedgerDirection` ya retorna `income` por default (solo `refund` es expense), no hay que tocarla. Pero `getLedgerDescription` tiene otro switch exhaustivo; agregar el caso (aunque la rama paquete escribe su propia descripción, `tsc` exige el caso):

```ts
    case 'manual_adjustment':
      return `Ajuste manual para ${suffix}`
    case 'package_purchase':
      return `Venta de paquete`
    default: {
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/unit/finance-service.test.ts`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add src/server/services/finance.ts tests/unit/finance-service.test.ts
git commit -m "feat(finance): mapear package_purchase → package_sale en el ledger"
```

---

## Task 3: `findOrCreateCustomerInTx` (matcher único)

**Files:**
- Create: `src/lib/customers/find-or-create.ts`
- Test: `tests/unit/find-or-create-customer.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `tests/unit/find-or-create-customer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const linkMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/customers/link', () => ({ linkCustomerFromBookingSession: linkMock }))

const { findOrCreateCustomerInTx } = await import('@/lib/customers/find-or-create')

function makeTx(existing: any) {
  return {
    customer: {
      findFirst: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'new', userId: null, ...data })),
      update: vi.fn().mockResolvedValue({}),
    },
  } as any
}

describe('findOrCreateCustomerInTx', () => {
  beforeEach(() => linkMock.mockReset().mockResolvedValue(false))

  it('crea la Customer cuando no hay match por teléfono', async () => {
    const tx = makeTx(null)
    const { customer, created } = await findOrCreateCustomerInTx(tx, {
      businessId: 'b1', phone: '9 1234 5678', name: 'Ana', email: 'ana@x.cl',
    })
    expect(created).toBe(true)
    expect(tx.customer.create).toHaveBeenCalledWith({
      data: { businessId: 'b1', name: 'Ana', phone: '56912345678', email: 'ana@x.cl' },
    })
    expect(customer.id).toBe('new')
  })

  it('reusa la Customer existente y backfillea email vacío', async () => {
    const tx = makeTx({ id: 'c1', userId: null, email: null, name: 'Ana', phone: '56912345678' })
    const { customer, created } = await findOrCreateCustomerInTx(tx, {
      businessId: 'b1', phone: '56912345678', name: 'Ana', email: 'ana@x.cl',
    })
    expect(created).toBe(false)
    expect(customer.id).toBe('c1')
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { email: 'ana@x.cl' } })
  })

  it('NO pisa un email existente', async () => {
    const tx = makeTx({ id: 'c1', userId: null, email: 'old@x.cl', name: 'Ana', phone: '56912345678' })
    await findOrCreateCustomerInTx(tx, { businessId: 'b1', phone: '56912345678', name: 'Ana', email: 'new@x.cl' })
    expect(tx.customer.update).not.toHaveBeenCalled()
  })

  it('llama a linkCustomerFromBookingSession cuando hay sesión', async () => {
    const tx = makeTx(null)
    const sessionUser = { id: 'u1', email: 'ana@x.cl', email_confirmed_at: '2026-01-01' }
    await findOrCreateCustomerInTx(tx, { businessId: 'b1', phone: '56912345678', name: 'Ana', email: 'ana@x.cl', sessionUser })
    expect(linkMock).toHaveBeenCalledWith(tx, expect.objectContaining({ id: 'new' }), sessionUser, 'b1')
  })

  it('no linkea si no hay sesión', async () => {
    const tx = makeTx(null)
    await findOrCreateCustomerInTx(tx, { businessId: 'b1', phone: '56912345678', name: 'Ana', email: 'ana@x.cl' })
    expect(linkMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/find-or-create-customer.test.ts`
Expected: FAIL — `Cannot find module '@/lib/customers/find-or-create'`.

- [ ] **Step 3: Implementar el helper**

Create `src/lib/customers/find-or-create.ts`:

```ts
import type { Customer, Prisma } from '@prisma/client'
import { normalizePhone } from '@/lib/customers/phone'
import { linkCustomerFromBookingSession } from '@/lib/customers/link'

export interface FindOrCreateCustomerInput {
  businessId: string
  phone: string
  name: string
  email?: string | null
  /** Sesión activa (vía 3 de vinculación). Sin sesión, no se linkea. */
  sessionUser?: { id: string; email?: string | null; email_confirmed_at?: string | null } | null
}

/**
 * Resuelve la Customer de un negocio por (businessId, normalizePhone) — NO por
 * nombre, para no duplicar cuando la misma persona escribe su nombre distinto.
 * Crea si falta, backfillea el email cuando el existente está vacío, y linkea la
 * sesión (vía 3) si se pasa. Único matcher: lo usan createBooking,
 * createBookingFromDashboard y (a futuro) la compra de paquetes.
 *
 * Devuelve `created` para que el caller decida lógica solo-para-nuevas
 * (p.ej. atribución de referida en createBooking).
 */
export async function findOrCreateCustomerInTx(
  tx: Prisma.TransactionClient,
  input: FindOrCreateCustomerInput,
): Promise<{ customer: Customer; created: boolean }> {
  const phone = normalizePhone(input.phone)
  let customer = await tx.customer.findFirst({ where: { phone, businessId: input.businessId } })
  let created = false

  if (customer) {
    if (input.email && !customer.email) {
      await tx.customer.update({ where: { id: customer.id }, data: { email: input.email } })
      customer = { ...customer, email: input.email }
    }
  } else {
    customer = await tx.customer.create({
      data: { businessId: input.businessId, name: input.name, phone, email: input.email || null },
    })
    created = true
  }

  if (input.sessionUser) {
    await linkCustomerFromBookingSession(tx, customer, input.sessionUser, input.businessId)
  }

  return { customer, created }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/find-or-create-customer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/customers/find-or-create.ts tests/unit/find-or-create-customer.test.ts
git commit -m "feat(customers): findOrCreateCustomerInTx — matcher único por teléfono"
```

---

## Task 4: Refactorizar los dos caminos de reserva al helper

**Files:**
- Modify: `src/server/actions/bookings.ts:311-347` (createBooking), `:830-856` (createBookingFromDashboard, rama sin customerId)

> Preserva semántica exacta: en `createBooking`, la atribución de referida sigue siendo SOLO para clientas nuevas (`created`), y el link de sesión ahora vive en el helper. En `createBookingFromDashboard`, solo se refactoriza la rama "sin `customerId`" (la rama con `customerId` explícito queda intacta; ese camino no matchea por teléfono).

- [ ] **Step 1: Correr los tests de reserva existentes como red de seguridad (verde ANTES)**

Run: `npx vitest run tests/unit/create-booking-no-deposit.test.ts tests/unit/customers-search-booking.test.ts`
Expected: PASS. (Baseline: el refactor no debe cambiar este resultado.)

- [ ] **Step 2: Importar el helper en `bookings.ts`**

Verificar/añadir junto a los imports existentes de `src/server/actions/bookings.ts`:

```ts
import { findOrCreateCustomerInTx } from '@/lib/customers/find-or-create'
```

- [ ] **Step 3: Reemplazar el bloque inline de `createBooking`**

En `src/server/actions/bookings.ts`, reemplazar el bloque de las líneas 311-347 (desde el comentario `// Buscar o crear cliente...` hasta el cierre del `if (sessionUser) { linkCustomerFromBookingSession(...) }`) por:

```ts
      // Buscar o crear cliente dentro de la transacción (matcher único por
      // teléfono; el link de sesión — vía 3 — vive en el helper).
      const { customer, created } = await findOrCreateCustomerInTx(tx, {
        businessId,
        phone: data.customerPhone,
        name: data.customerName,
        email: data.customerEmail || null,
        sessionUser,
      })

      // Atribución de referida: SOLO clientas nuevas (recién creadas).
      if (created && data.referralToken) {
        await captureReferral(tx, {
          businessId,
          referredCustomerId: customer.id,
          referrerToken: data.referralToken,
          referredPhone: normalizePhone(data.customerPhone),
        })
      }
```

- [ ] **Step 4: Reemplazar la rama "sin customerId" de `createBookingFromDashboard`**

En `src/server/actions/bookings.ts`, reemplazar el bloque `else { ... }` de las líneas 830-856 (la rama que normaliza teléfono, busca por teléfono, backfillea email o crea) por:

```ts
    } else {
      const result = await findOrCreateCustomerInTx(tx, {
        businessId,
        phone: data.customerPhone,
        name: data.customerName,
        email: data.customerEmail || null,
      })
      customer = result.customer
    }
```

> `customer` está declarado arriba como `let customer: { id: string; name: string; phone: string; email: string | null }`. `findOrCreateCustomerInTx` retorna `Customer` (superset), asignable a ese tipo estructural. Si `tsc` se queja del tipo, ampliar la declaración a `let customer: Customer` importando `Customer` de `@prisma/client`.

- [ ] **Step 5: Verificar que `linkCustomerFromBookingSession` no quedó importado sin uso**

Run: `grep -n "linkCustomerFromBookingSession\|captureReferral" src/server/actions/bookings.ts`
Expected: `linkCustomerFromBookingSession` ya NO aparece (se movió al helper) → borrar su import si quedó huérfano. `captureReferral` sigue usándose.

- [ ] **Step 6: Correr tests + tsc**

Run: `npx vitest run tests/unit/create-booking-no-deposit.test.ts tests/unit/customers-search-booking.test.ts && npx tsc --noEmit | grep '^src/' || echo "0 src errors"`
Expected: PASS y `0 src errors`.

- [ ] **Step 7: Commit**

```bash
git add src/server/actions/bookings.ts
git commit -m "refactor(bookings): usar findOrCreateCustomerInTx en ambos caminos de reserva"
```

---

## Task 5: `activatePackagePurchaseInTx` (activador único)

**Files:**
- Create: `src/lib/packages/activate.ts`
- Test: `tests/unit/activate-package.test.ts`

> Extrae `getOrCreatePackageMarkerPromotion` de `packages.ts` (se mueve, no se duplica) y agrega el activador que emite N grants + escribe el asiento de ledger `package_sale`. El asiento usa `upsert` cuando hay `paymentId` (idempotencia por `@@unique([paymentId])`) y `create` cuando es venta manual (`paymentId` null).

- [ ] **Step 1: Escribir el test que falla**

Create `tests/unit/activate-package.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/loyalty/redeem', () => ({ generateGrantCode: vi.fn().mockResolvedValue('CODE') }))

const { activatePackagePurchaseInTx } = await import('@/lib/packages/activate')

function makeTx() {
  return {
    promotion: {
      findFirst: vi.fn().mockResolvedValue({ id: 'marker' }),
      create: vi.fn().mockResolvedValue({ id: 'marker' }),
    },
    promotionGrant: { create: vi.fn().mockResolvedValue({}) },
    packagePurchase: { update: vi.fn().mockResolvedValue({}) },
    ledgerEntry: { create: vi.fn().mockResolvedValue({}), upsert: vi.fn().mockResolvedValue({}) },
  } as any
}

const purchase = {
  id: 'p1', businessId: 'b1', customerId: 'c1', pricePaid: 30000,
  quantity: 3, bonusQuantity: 1, expiresAt: null, createdByUserId: 'u1',
}

describe('activatePackagePurchaseInTx', () => {
  it('emite quantity+bonus grants, activa la compra y escribe el asiento de ledger', async () => {
    const tx = makeTx()
    await activatePackagePurchaseInTx(tx, purchase, { requestId: 'req' })
    expect(tx.promotionGrant.create).toHaveBeenCalledTimes(4)
    expect(tx.packagePurchase.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'active' } })
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: 'b1', packagePurchaseId: 'p1', customerId: 'c1',
        type: 'package_sale', direction: 'income', amount: 30000, paymentId: null,
      }),
    }))
  })

  it('usa ledgerEntry.upsert (no create) cuando hay paymentId', async () => {
    const tx = makeTx()
    await activatePackagePurchaseInTx(tx, purchase, { requestId: 'req', paymentId: 'pay1' })
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled()
    expect(tx.ledgerEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { paymentId: 'pay1' },
    }))
  })

  it('usa requestId determinista por grant', async () => {
    const tx = makeTx()
    await activatePackagePurchaseInTx(tx, purchase, { requestId: 'req' })
    const requestIds = tx.promotionGrant.create.mock.calls.map((c: any) => c[0].data.requestId)
    expect(requestIds).toEqual(['req#0', 'req#1', 'req#2', 'req#3'])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/activate-package.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/lib/packages/activate.ts`**

Create `src/lib/packages/activate.ts` (mover `getOrCreatePackageMarkerPromotion` verbatim desde `packages.ts`):

```ts
import type { Prisma } from '@prisma/client'
import { generateGrantCode } from '@/lib/loyalty/redeem'
import { perGrantRequestId } from '@/lib/packages/schema'

const PACKAGE_MARKER_NAME = 'package-coverage'

/** Una Promotion marcador por negocio a la que apuntan los grants de paquete.
 *  triggerType 'granted' (para que release reactive el grant), free_service, appliesToAll,
 *  pointsCost null (excluida del catálogo de canje). Creada lazily. */
export async function getOrCreatePackageMarkerPromotion(tx: Prisma.TransactionClient, businessId: string): Promise<string> {
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

/** Datos mínimos de la compra que necesita el activador. */
export interface ActivatablePurchase {
  id: string
  businessId: string
  customerId: string
  pricePaid: number
  quantity: number
  bonusQuantity: number
  expiresAt: Date | null
  createdByUserId: string | null
}

export interface ActivateOptions {
  /** Base para el requestId idempotente de cada grant (perGrantRequestId). */
  requestId: string
  /** Payment que originó la activación (online). Null/undefined para venta manual. */
  paymentId?: string | null
  /** Override del autor; por defecto el de la compra. */
  createdByUserId?: string | null
}

/**
 * Activa una PackagePurchase: emite quantity+bonus grants (idempotentes por
 * perGrantRequestId), marca la compra `active` y escribe el asiento de ledger
 * `package_sale` (income = pricePaid). Único activador — lo invocan la venta
 * manual (sellPackage) y, a futuro, el pago online (webhook MP / transferencia).
 */
export async function activatePackagePurchaseInTx(
  tx: Prisma.TransactionClient,
  purchase: ActivatablePurchase,
  opts: ActivateOptions,
): Promise<void> {
  const markerId = await getOrCreatePackageMarkerPromotion(tx, purchase.businessId)
  const total = purchase.quantity + purchase.bonusQuantity
  const author = opts.createdByUserId ?? purchase.createdByUserId

  for (let i = 0; i < total; i++) {
    await tx.promotionGrant.create({
      data: {
        businessId: purchase.businessId, promotionId: markerId, customerId: purchase.customerId,
        code: await generateGrantCode(tx, purchase.businessId), pointsSpent: 0, status: 'active',
        expiresAt: purchase.expiresAt, refundOnExpiry: false, forfeitOnNoShow: false,
        requestId: perGrantRequestId(opts.requestId, i), packagePurchaseId: purchase.id,
        createdByUserId: author,
      },
    })
  }

  await tx.packagePurchase.update({ where: { id: purchase.id }, data: { status: 'active' } })

  const ledgerData = {
    businessId: purchase.businessId,
    packagePurchaseId: purchase.id,
    paymentId: opts.paymentId ?? null,
    customerId: purchase.customerId,
    type: 'package_sale' as const,
    direction: 'income' as const,
    amount: purchase.pricePaid,
    currency: 'CLP',
    description: 'Venta de paquete',
    occurredAt: new Date(),
    createdByUserId: author,
  }

  // Con paymentId: upsert para respetar @@unique([paymentId]) ante reintentos
  // del pago online. Venta manual (paymentId null): create directo (múltiples
  // NULLs permitidos en el índice único).
  if (opts.paymentId) {
    await tx.ledgerEntry.upsert({ where: { paymentId: opts.paymentId }, update: {}, create: ledgerData })
  } else {
    await tx.ledgerEntry.create({ data: ledgerData })
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/activate-package.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/packages/activate.ts tests/unit/activate-package.test.ts
git commit -m "feat(packages): activatePackagePurchaseInTx — grants + asiento de ledger"
```

---

## Task 6: `sellPackage` delega en el activador (escribe al ledger)

**Files:**
- Modify: `src/server/actions/packages.ts:14-34` (borrar el marker local), `:86-142` (sellPackage)

> `sellPackage` deja de emitir grants inline y de crear la promo marcador; crea la `PackagePurchase` y llama `activatePackagePurchaseInTx`. Resultado: la venta manual ahora escribe un asiento `package_sale` (antes invisible en finanzas). La idempotencia por `requestId` se conserva (mismo `perGrantRequestId` dentro del activador → mismo P2002 atrapado por el caller).

- [ ] **Step 1: Escribir el test que falla**

Create `tests/unit/sell-package-ledger.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireRole = vi.hoisted(() => vi.fn())
const activateMock = vi.hoisted(() => vi.fn())
const txClient = vi.hoisted(() => ({
  packagePurchase: { create: vi.fn().mockResolvedValue({ id: 'p1', businessId: 'b1', customerId: 'c1', pricePaid: 30000, quantity: 3, bonusQuantity: 0, expiresAt: null, createdByUserId: 'u1' }) },
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: requireRole,
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/packages/activate', () => ({ activatePackagePurchaseInTx: activateMock, getOrCreatePackageMarkerPromotion: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    packageProduct: { findFirst: vi.fn().mockResolvedValue({ id: 'prod1', price: 30000, quantity: 3, bonusQuantity: 0, appliesToAll: true, expiryDays: null, services: [] }) },
    customer: { findFirst: vi.fn().mockResolvedValue({ id: 'c1' }) },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(txClient)),
  },
}))

beforeEach(() => {
  requireRole.mockResolvedValue({ businessId: 'b1', user: { id: 'u1' } })
  activateMock.mockReset().mockResolvedValue(undefined)
})

const { sellPackage } = await import('@/server/actions/packages')

describe('sellPackage', () => {
  it('crea la compra y delega la activación (grants + ledger) al activador', async () => {
    await sellPackage({ packageProductId: 'prod1', customerId: 'c1', paymentMethod: 'efectivo', requestId: 'req-1' })
    expect(txClient.packagePurchase.create).toHaveBeenCalled()
    expect(activateMock).toHaveBeenCalledWith(
      txClient,
      expect.objectContaining({ id: 'p1' }),
      expect.objectContaining({ requestId: 'req-1', createdByUserId: 'u1' }),
    )
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/sell-package-ledger.test.ts`
Expected: FAIL — `activatePackagePurchaseInTx` aún no se llama (la venta actual emite grants inline).

- [ ] **Step 3: Borrar el marker local y ajustar imports en `packages.ts`**

En `src/server/actions/packages.ts`:
- Borrar el bloque `const PACKAGE_MARKER_NAME` + `getOrCreatePackageMarkerPromotion` (líneas 13-34, ahora vive en `activate.ts`).
- Borrar los imports que quedan huérfanos: `generateGrantCode` (línea 10) y `perGrantRequestId` del import de `schema` (línea 9). Verificar con `grep -n "generateGrantCode\|perGrantRequestId" src/server/actions/packages.ts` tras editar — no deben quedar usos.
- Agregar el import del activador:

```ts
import { activatePackagePurchaseInTx } from '@/lib/packages/activate'
```

- [ ] **Step 4: Reescribir el cuerpo transaccional de `sellPackage`**

Reemplazar el `try { await prisma.$transaction(...) } catch (e) {...}` (líneas 108-140) por:

```ts
  try {
    await prisma.$transaction(async (tx) => {
      const purchase = await tx.packagePurchase.create({
        data: {
          businessId, customerId: customer.id, packageProductId: product.id,
          pricePaid: product.price, quantity: product.quantity, bonusQuantity: product.bonusQuantity,
          coversAll: product.appliesToAll, coveredServiceIds: product.services.map(s => s.id),
          source: 'manual', paymentMethod: d.paymentMethod, paidAt: now, status: 'active',
          expiresAt, createdByUserId: user.id,
        },
      })
      await activatePackagePurchaseInTx(tx, purchase, { requestId: d.requestId, createdByUserId: user.id })
    })
  } catch (e) {
    // Reintento idempotente: si los grants ya existían por este requestId (P2002 en
    // @@unique([customerId, requestId])), la venta ya ocurrió → no-op.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      await revalidatePath('/dashboard/customers/' + customer.id)
      return
    }
    throw e
  }
```

> `activatePackagePurchaseInTx` recibe el `purchase` recién creado (que ya trae `id/businessId/customerId/pricePaid/quantity/bonusQuantity/expiresAt/createdByUserId`, superset de `ActivatablePurchase`). La compra se crea `status: 'active'` y el activador la re-setea a `active` (no-op idempotente); esto mantiene el shape para cuando B4b-2/3 creen compras `pending` y activen después.

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/sell-package-ledger.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/packages.ts src/lib/packages/activate.ts tests/unit/sell-package-ledger.test.ts
git commit -m "feat(packages): sellPackage escribe al ledger vía activatePackagePurchaseInTx"
```

---

## Task 7: `applyApprovedPayment` — tronco compartido + rama paquete

**Files:**
- Modify: `src/server/services/finance.ts:74-224` (extraer `upsertApprovedPayment`, agregar `applyApprovedPackagePayment`)
- Test: `tests/unit/finance-service.test.ts`

> El contrato externo de `applyApprovedPayment` (booking) queda **idéntico** — `bookingId` requerido, retorno `{ booking, wasConfirmed }` — para no tocar los ~8 callers de reserva. Se extrae el upsert del `Payment` a un helper compartido y se agrega `applyApprovedPackagePayment` (rama paquete, exportada, **sin caller público en B4b-1**; la usará el webhook en B4b-2).

- [ ] **Step 1: Regresión — correr TODA la suite de finance verde ANTES de tocar**

Run: `npx vitest run tests/unit/finance-service.test.ts`
Expected: PASS. (Es la red de seguridad del camino de reserva; debe seguir verde tras el refactor.)

- [ ] **Step 2: Escribir el test de la rama paquete que falla**

En `tests/unit/finance-service.test.ts` agregar el mock de `activate` arriba (junto a los otros `vi.mock`) y un `describe` nuevo:

```ts
const activatePkg = vi.hoisted(() => vi.fn())
vi.mock('@/lib/packages/activate', () => ({ activatePackagePurchaseInTx: activatePkg }))
```

```ts
describe('applyApprovedPackagePayment', () => {
  beforeEach(() => {
    activatePkg.mockReset().mockResolvedValue(undefined)
    Object.values(mockPrisma.payment).forEach((f: any) => f.mockReset?.())
    mockPrisma.packagePurchase = { findUnique: vi.fn(), update: vi.fn() }
  })

  it('activa la compra pending y NO toca booking', async () => {
    const { applyApprovedPackagePayment } = await import('@/server/services/finance')
    mockPrisma.packagePurchase.findUnique.mockResolvedValue({
      id: 'p1', businessId: 'b1', customerId: 'c1', status: 'pending',
      pricePaid: 30000, quantity: 3, bonusQuantity: 0, expiresAt: null, createdByUserId: null,
    })
    mockPrisma.payment.findFirst.mockResolvedValue(null)
    mockPrisma.payment.create.mockResolvedValue({ id: 'pay1', status: 'approved', paymentType: 'package_purchase', amount: 30000 })

    await applyApprovedPackagePayment({
      tx: mockPrisma, packagePurchaseId: 'p1', businessId: 'b1', amount: 30000,
      currency: 'CLP', provider: PaymentProvider.mercado_pago, providerPaymentId: 'mp-1',
      paymentType: PaymentType.package_purchase,
    })

    expect(mockPrisma.booking.findUnique).not.toHaveBeenCalled()
    expect(activatePkg).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ id: 'p1' }),
      expect.objectContaining({ requestId: 'p1', paymentId: 'pay1' }),
    )
  })

  it('es idempotente: compra ya active no re-activa', async () => {
    const { applyApprovedPackagePayment } = await import('@/server/services/finance')
    mockPrisma.packagePurchase.findUnique.mockResolvedValue({ id: 'p1', businessId: 'b1', customerId: 'c1', status: 'active', pricePaid: 30000, quantity: 3, bonusQuantity: 0, expiresAt: null, createdByUserId: null })
    mockPrisma.payment.findFirst.mockResolvedValue({ id: 'pay1', status: 'approved', paymentType: 'package_purchase', amount: 30000 })

    await applyApprovedPackagePayment({
      tx: mockPrisma, packagePurchaseId: 'p1', businessId: 'b1', amount: 30000,
      currency: 'CLP', provider: PaymentProvider.mercado_pago, providerPaymentId: 'mp-1',
      paymentType: PaymentType.package_purchase,
    })
    expect(activatePkg).not.toHaveBeenCalled()
  })
})
```

Añadir `packagePurchase: { findUnique: vi.fn(), update: vi.fn() }` al objeto `mockPrisma` inicial (junto a `payment`/`ledgerEntry`).

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/finance-service.test.ts`
Expected: FAIL — `applyApprovedPackagePayment` no existe.

- [ ] **Step 4: Extraer `upsertApprovedPayment` en `finance.ts`**

En `src/server/services/finance.ts`, agregar el helper compartido (antes de `applyApprovedPayment`). Encapsula el find/create/approve del `Payment`, parametrizado por dueño (`bookingId` XOR `packagePurchaseId`):

```ts
interface UpsertApprovedPaymentInput {
  tx: Prisma.TransactionClient
  businessId: string
  bookingId?: string | null
  packagePurchaseId?: string | null
  customerId: string
  amount: number
  currency: string
  provider: PaymentProvider
  providerPaymentId: string | null
  paymentType: PaymentType
  paymentMethod?: string | null
  rawPayload?: Prisma.InputJsonValue | undefined
  explicitPaymentId?: string
}

/** Upsert idempotente del Payment aprobado (tronco compartido reserva/paquete).
 *  Devuelve el Payment y si ya estaba aprobado (para cortar temprano). */
async function upsertApprovedPayment(input: UpsertApprovedPaymentInput): Promise<{ payment: { id: string; amount: number; status: string; provider: string; providerPaymentId: string | null; paymentType: PaymentType }; alreadyApproved: boolean }> {
  const { tx, businessId, bookingId, packagePurchaseId, customerId, amount, currency, provider, providerPaymentId, paymentType, paymentMethod, rawPayload, explicitPaymentId } = input
  let payment: { id: string; amount: number; status: string; provider: string; providerPaymentId: string | null; paymentType: PaymentType } | null = null

  if (explicitPaymentId) {
    const found = await tx.payment.findUnique({ where: { id: explicitPaymentId } })
    if (!found) throw new Error('Pago no encontrado')
    if (bookingId && found.bookingId !== bookingId) throw new Error('El pago no corresponde a esta reserva')
    if (packagePurchaseId && found.packagePurchaseId !== packagePurchaseId) throw new Error('El pago no corresponde a esta compra')
    if (found.businessId !== businessId) throw new Error('El pago no pertenece al negocio')
    if (found.amount !== amount) throw new Error('El monto no coincide con el pago registrado')
    if (found.provider !== provider) throw new Error('El proveedor no coincide con el pago registrado')
    if (found.providerPaymentId !== providerPaymentId) throw new Error('El providerPaymentId no coincide con el pago registrado')
    if (found.paymentType !== paymentType) throw new Error('El tipo de pago no coincide con el pago registrado')
    payment = found
  } else if (providerPaymentId) {
    payment = await tx.payment.findFirst({
      where: { ...(bookingId ? { bookingId } : { packagePurchaseId }), provider, providerPaymentId },
    })
  }

  if (payment && payment.status === 'approved') {
    return { payment, alreadyApproved: true }
  }

  if (payment) {
    payment = await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'approved', paidAt: new Date(), ...(rawPayload !== undefined && { rawPayload }) },
    })
  } else {
    payment = await tx.payment.create({
      data: {
        businessId, bookingId: bookingId ?? null, packagePurchaseId: packagePurchaseId ?? null, customerId,
        provider, providerPaymentId, amount, currency, status: 'approved',
        paymentType, paymentMethod: paymentMethod ?? null, paidAt: new Date(),
        ...(rawPayload !== undefined && { rawPayload }),
      },
    })
  }
  return { payment, alreadyApproved: false }
}
```

- [ ] **Step 5: Reescribir el cuerpo de `applyApprovedPayment` (booking) usando el helper**

Reemplazar el bloque de `applyApprovedPayment` que va desde `let payment: {...} | null = null` (línea 129) hasta el cierre del `upsert` de `ledgerEntry` (línea 221), por:

```ts
  const { payment, alreadyApproved } = await upsertApprovedPayment({
    tx, businessId, bookingId, customerId: booking.customerId, amount, currency,
    provider, providerPaymentId, paymentType, paymentMethod, rawPayload,
    explicitPaymentId,
  })

  if (alreadyApproved) {
    // Idempotencia: ya aprobado; solo recalcular y retornar.
    return recalcBookingFromPayments(tx, bookingId)
  }

  // Exactly one LedgerEntry per payment (upsert atómico sobre @@unique([paymentId])).
  await tx.ledgerEntry.upsert({
    where: { paymentId: payment.id },
    update: {},
    create: {
      businessId,
      bookingId,
      paymentId: payment.id,
      customerId: booking.customerId,
      type: mapPaymentTypeToLedgerEntryType(payment.paymentType),
      direction: mapPaymentTypeToLedgerDirection(payment.paymentType),
      amount: payment.amount,
      currency,
      description: getLedgerDescription(payment.paymentType, booking.id, booking.bookingNumber),
      occurredAt: new Date(),
      createdByUserId: createdByUserId ?? null,
    },
  })

  return recalcBookingFromPayments(tx, bookingId)
```

> El resto de `applyApprovedPayment` (validación `booking.findUnique`, `assertBookingPayable`, guard de `businessId`) queda **sin cambios**. La firma y el retorno no cambian.

- [ ] **Step 6: Agregar `applyApprovedPackagePayment` (rama paquete)**

Al final de `finance.ts` (o tras `applyApprovedPayment`), agregar el import del activador arriba del archivo:

```ts
import { activatePackagePurchaseInTx } from '@/lib/packages/activate'
```

Y la función:

```ts
export interface ApplyApprovedPackagePaymentInput {
  tx: Prisma.TransactionClient
  packagePurchaseId: string
  businessId: string
  amount: number
  currency: string
  provider: PaymentProvider
  providerPaymentId: string | null
  paymentType: PaymentType
  paymentMethod?: string | null
  rawPayload?: Prisma.InputJsonValue | undefined
  createdByUserId?: string | null
  paymentId?: string
}

/**
 * Rama paquete de la aprobación de pago (polimórfica con applyApprovedPayment).
 * Carga la PackagePurchase, upserta el Payment (packagePurchaseId, sin booking)
 * y, si la compra estaba pending, la activa (grants + asiento de ledger). NO
 * toca recalcBookingFromPayments. Idempotente. Sin caller público en B4b-1 —
 * la usará el webhook MP en B4b-2.
 */
export async function applyApprovedPackagePayment({
  tx, packagePurchaseId, businessId, amount, currency, provider, providerPaymentId,
  paymentType, paymentMethod, rawPayload, createdByUserId, paymentId: explicitPaymentId,
}: ApplyApprovedPackagePaymentInput): Promise<void> {
  if (amount <= 0) throw new Error('El monto debe ser positivo')

  const purchase = await tx.packagePurchase.findUnique({ where: { id: packagePurchaseId } })
  if (!purchase) throw new Error('Compra de paquete no encontrada')
  if (purchase.businessId !== businessId) throw new Error('La compra no pertenece al negocio')

  const { payment, alreadyApproved } = await upsertApprovedPayment({
    tx, businessId, packagePurchaseId, customerId: purchase.customerId, amount, currency,
    provider, providerPaymentId, paymentType, paymentMethod, rawPayload, explicitPaymentId,
  })

  // Idempotencia: si el pago ya estaba aprobado o la compra ya está activa, no
  // re-emitir grants ni re-asentar (los grants ya son idempotentes, pero cortar
  // temprano evita trabajo y un asiento manual duplicado).
  if (alreadyApproved || purchase.status === 'active') return

  await activatePackagePurchaseInTx(tx, purchase, { requestId: purchase.id, paymentId: payment.id, createdByUserId })
}
```

- [ ] **Step 7: Correr toda la suite de finance y verificar verde**

Run: `npx vitest run tests/unit/finance-service.test.ts`
Expected: PASS (booking intacto + las 2 nuevas de paquete).

- [ ] **Step 8: Commit**

```bash
git add src/server/services/finance.ts tests/unit/finance-service.test.ts
git commit -m "feat(finance): applyApprovedPackagePayment + tronco compartido upsertApprovedPayment"
```

---

## Task 8: `refundPackagePurchase` escribe el asiento de reembolso

**Files:**
- Modify: `src/server/actions/packages.ts:170-179` (la `$transaction` del refund)
- Test: `tests/unit/refund-package-ledger.test.ts`

> El reembolso escribe, en la MISMA tx, un `LedgerEntry(refund_issued, expense, amount = refundedAmount prorrateado, packagePurchaseId)`. Reusa `refund_issued` → `totalRefunded` lo captura sin cambios, y el `packagePurchaseId` permite netearlo en `getPackageSalesTotal` (Task 9).

- [ ] **Step 1: Escribir el test que falla**

Create `tests/unit/refund-package-ledger.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireRole = vi.hoisted(() => vi.fn())
const tx = vi.hoisted(() => ({
  promotionGrant: { updateMany: vi.fn().mockResolvedValue({}) },
  packagePurchase: { update: vi.fn().mockResolvedValue({}) },
  ledgerEntry: { create: vi.fn().mockResolvedValue({}) },
}))

vi.mock('@/lib/auth/server', () => ({ requireBusinessRole: requireRole, ForbiddenError: class extends Error {} }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/packages/activate', () => ({ activatePackagePurchaseInTx: vi.fn(), getOrCreatePackageMarkerPromotion: vi.fn() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    packagePurchase: { findFirst: vi.fn().mockResolvedValue({ id: 'p1', customerId: 'c1', status: 'active', pricePaid: 30000, quantity: 3, bonusQuantity: 0, _count: { grants: 3 } }) },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
  },
}))

beforeEach(() => { requireRole.mockResolvedValue({ businessId: 'b1' }); tx.ledgerEntry.create.mockClear() })

const { refundPackagePurchase } = await import('@/server/actions/packages')

describe('refundPackagePurchase', () => {
  it('escribe un asiento refund_issued prorrateado con packagePurchaseId', async () => {
    await refundPackagePurchase('p1')
    // 3 sesiones sin usar de 3 → reembolso completo = 30000
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: 'b1', packagePurchaseId: 'p1', customerId: 'c1',
        type: 'refund_issued', direction: 'expense', amount: 30000,
      }),
    }))
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/refund-package-ledger.test.ts`
Expected: FAIL — `ledgerEntry.create` no se llama en el refund actual.

- [ ] **Step 3: Agregar el asiento a la tx de `refundPackagePurchase`**

En `src/server/actions/packages.ts`, dentro de la `$transaction` del refund (líneas 170-179), agregar el `ledgerEntry.create` tras el `packagePurchase.update`:

```ts
  await prisma.$transaction(async (tx) => {
    await tx.promotionGrant.updateMany({
      where: { packagePurchaseId: purchase.id, status: 'active' },
      data: { status: 'reversed', reversedAt: new Date() },
    })
    await tx.packagePurchase.update({
      where: { id: purchase.id },
      data: { status: 'refunded', refundedAt: new Date(), refundedAmount: refund },
    })
    // Asiento de reembolso: monto = prorrateo (NO pricePaid). Reusa refund_issued
    // para que totalRefunded lo capture; packagePurchaseId lo neteará en ventas.
    if (refund > 0) {
      await tx.ledgerEntry.create({
        data: {
          businessId, packagePurchaseId: purchase.id, customerId: purchase.customerId,
          type: 'refund_issued', direction: 'expense', amount: refund, currency: 'CLP',
          description: 'Reembolso de paquete', occurredAt: new Date(),
        },
      })
    }
  })
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/refund-package-ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/packages.ts tests/unit/refund-package-ledger.test.ts
git commit -m "feat(packages): asiento de ledger al reembolsar un paquete"
```

---

## Task 9: `getPackageSalesTotal` deriva del ledger

**Files:**
- Modify: `src/server/actions/packages.ts:219-226`
- Test: `tests/unit/package-sales-total.test.ts`

> Fuente única: total = `sum(package_sale)` − `sum(refund_issued con packagePurchaseId)`. Reemplaza el `aggregate(pricePaid)` sobre `PackagePurchase` (que ignoraba reembolsos y no distinguía estados). Sin backfill: solo cuenta ventas asentadas de acá en adelante (consistente con la decisión 4 del spec).

- [ ] **Step 1: Escribir el test que falla**

Create `tests/unit/package-sales-total.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireRole = vi.hoisted(() => vi.fn())
const aggregate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/server', () => ({ requireBusinessRole: requireRole, ForbiddenError: class extends Error {} }))
vi.mock('@/lib/db', () => ({ prisma: { ledgerEntry: { aggregate } } }))

beforeEach(() => { requireRole.mockResolvedValue({ businessId: 'b1' }); aggregate.mockReset() })

const { getPackageSalesTotal } = await import('@/server/actions/packages')

describe('getPackageSalesTotal', () => {
  it('netea ventas menos reembolsos de paquete', async () => {
    aggregate
      .mockResolvedValueOnce({ _sum: { amount: 100000 } }) // package_sale
      .mockResolvedValueOnce({ _sum: { amount: 30000 } })  // refund_issued (paquete)
    expect(await getPackageSalesTotal()).toBe(70000)
  })

  it('trata sumas null como 0', async () => {
    aggregate.mockResolvedValue({ _sum: { amount: null } })
    expect(await getPackageSalesTotal()).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/package-sales-total.test.ts`
Expected: FAIL — la impl actual llama `packagePurchase.aggregate`, no `ledgerEntry.aggregate`.

- [ ] **Step 3: Reescribir `getPackageSalesTotal`**

Reemplazar el cuerpo (líneas 219-226) por:

```ts
export async function getPackageSalesTotal(): Promise<number> {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  // Fuente única: ledger. Ventas (package_sale) netas de reembolsos de paquete
  // (refund_issued con packagePurchaseId). Sin backfill del histórico de B4a.
  const [sales, refunds] = await Promise.all([
    prisma.ledgerEntry.aggregate({ _sum: { amount: true }, where: { businessId, type: 'package_sale' } }),
    prisma.ledgerEntry.aggregate({ _sum: { amount: true }, where: { businessId, type: 'refund_issued', packagePurchaseId: { not: null } } }),
  ])
  return (sales._sum.amount ?? 0) - (refunds._sum.amount ?? 0)
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/package-sales-total.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/packages.ts tests/unit/package-sales-total.test.ts
git commit -m "feat(packages): getPackageSalesTotal deriva del ledger (fuente única)"
```

---

## Task 10: Label `package_sale` en el LedgerTable

**Files:**
- Modify: `src/components/dashboard/ledger-table.tsx:8-19`

- [ ] **Step 1: Agregar el label**

En `src/components/dashboard/ledger-table.tsx`, dentro de `typeLabels`, agregar la entrada:

```ts
  manual_income: 'Ingreso manual',
  manual_expense: 'Gasto manual',
  adjustment: 'Ajuste',
  package_sale: 'Venta de paquete',
}
```

- [ ] **Step 2: Verificar el render (no rompe tipos)**

Run: `npx tsc --noEmit | grep '^src/' || echo "0 src errors"`
Expected: `0 src errors`.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/ledger-table.tsx
git commit -m "feat(dashboard): label 'Venta de paquete' en el ledger"
```

---

## Task 11: Gate final de la rebanada

**Files:** ninguno nuevo — verificación integral.

- [ ] **Step 1: Suite unitaria completa**

Run: `npx vitest run`
Expected: PASS (0 fallos; incluye los 5 archivos de test nuevos + finance ampliado).

- [ ] **Step 2: Prisma generate + tsc (gate del ciclo)**

Run: `npx prisma generate && npx tsc --noEmit | grep '^src/' || echo "0 src errors"`
Expected: `0 src errors`. (Los errores preexistentes en `tests/` no cuentan — el gate es `^src/`.)

- [ ] **Step 3: ESLint sobre lo tocado**

Run: `npx eslint src/server/services/finance.ts src/server/actions/packages.ts src/server/actions/bookings.ts src/lib/customers/find-or-create.ts src/lib/packages/activate.ts src/components/dashboard/ledger-table.tsx`
Expected: sin errores.

- [ ] **Step 4: `/simplify` sobre el diff de la rama**

Correr `/simplify` (4 agentes: reuse / simplification / efficiency / altitude) sobre `git diff main...HEAD`. Aplicar los fixes válidos; anotar los skips. Prestar atención a: imports huérfanos en `packages.ts` (`generateGrantCode`/`perGrantRequestId`), duplicación residual entre las dos ramas de pago, y que `findOrCreateCustomerInTx` no dejó código muerto en `bookings.ts`.

- [ ] **Step 5: Code review 5-finders con verificación**

Dispatch de 5 agentes de review (correctness / regresiones / seguridad / concurrencia-idempotencia / tests) sobre el diff. Foco crítico: (a) el camino de reserva de `applyApprovedPayment` quedó behaviorally idéntico (upsert extraído sin cambiar semántica); (b) idempotencia de grants y del asiento de ledger; (c) `Payment.bookingId` nullable no rompió ninguna query que asuma no-null; (d) la migración es puramente aditiva. Verificar cada hallazgo antes de reportarlo.

- [ ] **Step 6: Re-correr el gate tras los fixes de simplify/review**

Run: `npx vitest run && npx prisma generate && npx tsc --noEmit | grep '^src/' || echo "0 src errors"`
Expected: PASS + `0 src errors`.

- [ ] **Step 7: Push + PR sin auto-merge**

```bash
git push -u origin claude/b4b-packages-online
gh pr create --title "B4b-1: ledger unificado de paquetes + Payment polimórfico (core, sin UI pública)" --body "$(cat <<'EOF'
## Qué

Primera rebanada de B4b (compra online de paquetes). Generaliza el core de pagos SIN construir aún UI pública ni webhooks:

- **Migración aditiva:** `Payment.bookingId` nullable + `Payment.packagePurchaseId`; `LedgerEntry.packagePurchaseId`; `PackagePurchase.holdExpiresAt`; enums `PaymentType.package_purchase` / `LedgerEntryType.package_sale`.
- **`findOrCreateCustomerInTx`:** matcher único de Customer por teléfono; reemplaza el inline duplicado en `createBooking` y `createBookingFromDashboard`.
- **`activatePackagePurchaseInTx`:** activador único (grants + asiento de ledger). Lo usa la venta manual y (a futuro) el pago online.
- **`sellPackage`** ahora escribe al ledger → la plata de paquetes por fin se ve en finanzas.
- **`applyApprovedPackagePayment`:** rama paquete de la aprobación de pago (lista, sin caller público en esta rebanada). `applyApprovedPayment` (booking) conserva firma/retorno idénticos.
- **`refundPackagePurchase`** asienta el reembolso prorrateado; **`getPackageSalesTotal`** deriva del ledger (fuente única).
- Label `Venta de paquete` en el LedgerTable.

## Valor inmediato

Toda venta de paquete (manual, de acá en adelante) queda registrada como ingreso en el ledger. Riesgo mínimo sobre reservas (contrato de `applyApprovedPayment` intacto; regresión de finance verde).

## Fuera de alcance (próximas rebanadas)

- B4b-2: página pública `/paquetes` + wizard + webhook MP + confirmación.
- B4b-3: transferencia bancaria + sweep de holds + confirmación de la dueña.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**NO** hacer merge — esperar OK explícito del usuario.

---

## Notas de seguridad / landmines aplicables

- **NO** tocar `sanitizeNext` ni `signOut` (fuera de alcance en B4b-1 de todos modos).
- Migración vía `db execute` **+** `migrate resolve --applied` (si no, Vercel `migrate deploy` se rompe).
- **NO** correr `prisma migrate diff` contra la DB compartida (arrastra DROPs de worktrees hermanos) — la SQL está hand-escrita.
- El gate de tipos es `tsc --noEmit | grep '^src/'` → 0; los errores preexistentes en `tests/` no bloquean.
- `git` en worktree: usar `git add <archivos>` explícitos (no `-A`) por el drift de cwd documentado.
