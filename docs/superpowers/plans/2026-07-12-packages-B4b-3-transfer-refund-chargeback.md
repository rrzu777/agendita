# B4b-3 — Transferencia de paquetes + refund real MP + chargeback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar la compra online de paquetes con transferencia bancaria como segundo método, refund real por Mercado Pago (monto prorrateado) y una política de chargeback de paquete activo (reversión total + clawback de puntos).

**Architecture:** Un solo PR sobre la rama `claude/b4b-packages-online` (rebaseada sobre `origin/main` post-#75). Migración aditiva de un campo (`PackagePurchase.chargebackAt`). Se extrae un núcleo de reversión reusable (`reversePackagePurchaseInTx`) invocado por la owner-action (con auth) y por el webhook (sin auth), espejo de `activatePackagePurchaseInTx`. Se agrega `refundPayment` a la interfaz `PaymentProvider`. La transferencia de paquete reusa los helpers de `src/lib/bank-transfer/declared.ts` con un **prefijo propio** `bt-pkg-declared:`.

**Tech Stack:** Next.js 16 App Router, Prisma + PostgreSQL (Supabase), Mercado Pago (OAuth por negocio), Vitest 4, TypeScript strict, zod v4.

**Spec:** `docs/superpowers/specs/2026-07-12-packages-B4b-3-transfer-refund-chargeback-design.md`

---

## Landmines (leer antes de empezar)

- **Idempotencia del asiento de reembolso:** NO reusar `paymentId` con upsert — el `@@unique([paymentId])` ya lo consume el asiento `package_sale` (`activate.ts:95`). Idempotencia = flip atómico de `purchase.status` (`updateMany where status:'active'`) + asiento `refund_issued` con `paymentId: null`.
- **Guard del webhook en `route.ts:346`** (`if payment.status === 'approved' return 200`): un paquete activo tiene el Payment `approved`, así que la rama de chargeback debe insertarse **antes** de ese return, gateada por `packagePurchaseId && !bookingId && mpStatus in (charged_back|refunded)` y actuar sólo si `purchase.status === 'active'`.
- **Prefijo de transferencia de paquete `bt-pkg-declared:` distinto de `bt-declared:`** — un `bt-declared:pkg:` satisface `startsWith('bt-declared:')` y sería barrido por queries booking-scoped. Verificar que `'bt-pkg-declared:'.startsWith('bt-declared:') === false` (lo es).
- **`refundPayment` en la interfaz rompe 4 objetos:** `manual-provider`, `mock-provider`, `createMercadoPagoProvider` (retornado) y el wrapper literal `mercadoPagoPaymentProvider`. El case `webpay` de `factory.ts` sólo `throw` (sin objeto).
- **`tsc` no corre en vitest/lint:** antes de cada commit relevante, `npx prisma generate && npx tsc --noEmit | grep '^src/'` (0 líneas).
- **Migración:** aplicar a Supabase con `db execute` + `migrate resolve --applied`; verificar antes que la columna no exista. Cargar env: `set -a; source /Users/robertozamorautrera/Projects/agendita/.env.local; set +a`.
- **DB de test:** Postgres Docker `agendita-test-pg` :5433 para integración.
- **NO tocar** `sanitizeNext` ni `signOut`. **NO** usar `relationLoadStrategy:'join'`.
- Módulos `'use server'` exportan SOLO funciones async — consts/tipos van en libs planas.

---

## File Structure

**Nuevos:**
- `src/lib/packages/status.ts` — const/tipo de los estados de `PackagePurchase` (evita magic strings).
- `src/lib/packages/reverse.ts` — `reversePackagePurchaseInTx` (núcleo de reversión: voluntary + chargeback), reusable por action y webhook.
- `tests/unit/package-reverse.test.ts`, `tests/unit/mercado-pago-refund-payment.test.ts`, `tests/unit/bt-pkg-declared.test.ts`, `tests/integration/packages.chargeback.integration.test.ts`, `tests/integration/packages.transfer.integration.test.ts`.

**Modificados (responsabilidad):**
- `prisma/schema.prisma` — `PackagePurchase.chargebackAt DateTime?`.
- `src/lib/payments/types.ts` — `RefundPaymentInput`/`RefundPaymentResult` + `refundPayment` en `PaymentProvider`.
- `src/lib/payments/{manual,mock,mercado-pago}-provider.ts` — implementaciones de `refundPayment`.
- `src/server/actions/packages.ts` — `refundPackagePurchase` method-aware; `getPackageSalesTotal` clamp; `getCustomerPackages` incluye pending/expired.
- `src/app/api/webhooks/mercado-pago/route.ts` — rama de chargeback de paquete.
- `src/lib/bank-transfer/declared.ts` — helpers `bt-pkg-declared`.
- `src/server/actions/bank-transfer-public.ts` — declaración de transferencia de paquete.
- `src/server/actions/bank-transfer-verify.ts` — confirmar/rechazar transferencia de paquete.
- `src/server/actions/packages-checkout.ts` — camino transferencia en la compra.
- `src/components/packages/package-checkout.tsx` — paso "método → transferencia".
- `src/lib/payments/package-confirmation-state.ts` — estados `expired`/`refunded`/`disputed`.
- `src/app/paquetes/confirmation/page.tsx` — copy de los estados nuevos.
- `src/app/dashboard/customers/[id]/package-panel.tsx` — badges pending/expired/disputed + gate refund.
- `src/lib/notifications/{types,email-provider,index}.ts` — shapes `PackageTransferDeclared`, `PackageDisputed`.
- `src/lib/cron/expire-holds.ts` — sweep de `PackagePurchase` pending.
- Superficie de la dueña: contador/lista de transferencias de paquete pendientes (dashboard).

---

## Task 1: Migración `chargebackAt` + const de estados

**Files:**
- Modify: `prisma/schema.prisma` (model `PackagePurchase`, tras `refundedAmount`)
- Create: `src/lib/packages/status.ts`
- Create: `prisma/migrations/20260712140000_package_chargeback/migration.sql`

- [ ] **Step 1: Agregar el campo al schema**

En `model PackagePurchase`, tras `refundedAmount Int?`:

```prisma
  refundedAmount    Int?
  chargebackAt      DateTime?
```

- [ ] **Step 2: Crear el archivo de migración a mano** (evita el ruido de `migrate diff`, ver landmine del initiative)

`prisma/migrations/20260712140000_package_chargeback/migration.sql`:

```sql
-- Distingue un chargeback (status 'refunded' + chargebackAt set) de un refund
-- voluntario (status 'refunded', chargebackAt null).
ALTER TABLE "PackagePurchase" ADD COLUMN "chargebackAt" TIMESTAMP(3);
```

- [ ] **Step 3: Crear la const de estados**

`src/lib/packages/status.ts`:

```ts
/** Estados de PackagePurchase.status (String libre en Prisma; centralizado acá
 *  para no repetir magic strings ni arriesgar typos silenciosos). */
export const PACKAGE_STATUS = {
  active: 'active',
  pending: 'pending',
  expired: 'expired',
  refunded: 'refunded',
  rejected: 'rejected',
} as const

export type PackageStatus = (typeof PACKAGE_STATUS)[keyof typeof PACKAGE_STATUS]
```

- [ ] **Step 4: Generar el cliente y verificar tipos**

Run: `npx prisma generate && npx tsc --noEmit | grep '^src/'`
Expected: sin salida (0 errores src).

- [ ] **Step 5: Aplicar la migración a Supabase**

```bash
set -a; source /Users/robertozamorautrera/Projects/agendita/.env.local; set +a
# Verificar que la columna NO exista todavía
npx prisma db execute --url "$DIRECT_URL" --stdin <<'SQL'
SELECT column_name FROM information_schema.columns WHERE table_name='PackagePurchase' AND column_name='chargebackAt';
SQL
# Aplicar y marcar como aplicada
npx prisma db execute --url "$DIRECT_URL" --file prisma/migrations/20260712140000_package_chargeback/migration.sql
npx prisma migrate resolve --applied 20260712140000_package_chargeback
```
Expected: la SELECT no devuelve filas antes; resolve confirma "applied".

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260712140000_package_chargeback src/lib/packages/status.ts
git commit -m "feat(packages): migración chargebackAt + const de estados de PackagePurchase"
```

---

## Task 2: `getCustomerPackages` incluye pending/expired + badges del panel

**Files:**
- Modify: `src/server/actions/packages.ts` (`getCustomerPackages`, ~:187)
- Modify: `src/app/dashboard/customers/[id]/package-panel.tsx` (`PackagePurchaseItem`, badge ~:105, gate refund ~:109)

- [ ] **Step 1: Incluir pending/expired y exponer chargebackAt en la query**

En `getCustomerPackages` (`packages.ts`), cambiar el `where.status` y traer `chargebackAt`:

```ts
export async function getCustomerPackages(customerId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const now = new Date()
  return prisma.packagePurchase.findMany({
    where: { businessId, customerId, status: { in: ['active', 'refunded', 'pending', 'expired'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { name: true } },
      _count: { select: { grants: { where: { status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] } } } },
    },
  })
}
```

Y en el `select` de `PackagePurchase` agregar `chargebackAt: true` — como `findMany` sin `select` trae todos los escalares, `chargebackAt` ya viene; sólo hay que tiparlo en el componente.

- [ ] **Step 2: Extender el tipo del panel + badges**

En `package-panel.tsx`, agregar `chargebackAt` al tipo:

```ts
type PackagePurchaseItem = {
  id: string
  pricePaid: number
  quantity: number
  bonusQuantity: number
  status: string
  chargebackAt: Date | null
  expiresAt: Date | null
  paymentMethod: string | null
  source: string
  createdAt: Date
  product: { name: string }
  _count: { grants: number }
}
```

Reemplazar el `<Badge>` (líneas ~105-107) por una función de badge que distinga disputado:

```tsx
function packageBadge(p: PackagePurchaseItem): { label: string; className: string } {
  if (p.status === 'active') return { label: 'Activo', className: 'bg-green-100 text-green-800' }
  if (p.status === 'refunded' && p.chargebackAt) return { label: 'Disputado', className: 'bg-red-100 text-red-800' }
  if (p.status === 'refunded') return { label: 'Reembolsado', className: 'bg-muted text-muted-foreground' }
  if (p.status === 'pending') return { label: 'Por confirmar', className: 'bg-amber-100 text-amber-800' }
  if (p.status === 'expired') return { label: 'Vencido', className: 'bg-muted text-muted-foreground' }
  return { label: p.status, className: 'bg-muted text-muted-foreground' }
}
```

Y en el JSX:

```tsx
{(() => { const b = packageBadge(p); return <Badge className={b.className}>{b.label}</Badge> })()}
```

- [ ] **Step 3: El botón Reembolsar ya está gateado por `p.status === 'active'`** (línea ~109) — verificar que sigue así; pending/expired/refunded no muestran el botón. Sin cambios adicionales.

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit | grep '^src/'`
Expected: sin salida.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/packages.ts src/app/dashboard/customers/\[id\]/package-panel.tsx
git commit -m "feat(packages): panel de dueña ve pending/expired + badge Disputado"
```

---

## Task 3: `refundPayment` en la interfaz + manual/mock no-op

**Files:**
- Modify: `src/lib/payments/types.ts`
- Modify: `src/lib/payments/manual-provider.ts`
- Modify: `src/lib/payments/mock-provider.ts`

- [ ] **Step 1: Escribir el test de contrato (manual/mock no-op)**

`tests/unit/refund-payment-noop.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { manualPaymentProvider } from '@/lib/payments/manual-provider'
import { mockPaymentProvider } from '@/lib/payments/mock-provider'

describe('refundPayment no-op providers', () => {
  const input = { providerPaymentId: 'x', amount: 1000, currency: 'CLP', idempotencyKey: 'refund:pkg:p1' }
  it('manual devuelve refunded sin refundId', async () => {
    const r = await manualPaymentProvider.refundPayment(input)
    expect(r.status).toBe('refunded')
    expect(r.refundId).toBeNull()
  })
  it('mock devuelve refunded sin refundId', async () => {
    const r = await mockPaymentProvider.refundPayment(input)
    expect(r.status).toBe('refunded')
    expect(r.refundId).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx vitest run tests/unit/refund-payment-noop.test.ts`
Expected: FAIL — `refundPayment` no existe en la interfaz.

- [ ] **Step 3: Agregar los tipos + el método a la interfaz** (`types.ts`, tras `WebhookPaymentResult`)

```ts
export interface RefundPaymentInput {
  /** id del pago en el provider (MP payment id). */
  providerPaymentId: string
  /** monto a reembolsar (parcial permitido). */
  amount: number
  currency: string
  /** clave determinística para dedupe del refund en el provider. */
  idempotencyKey: string
  /** token OAuth del negocio (MP per-tenant); ignorado por manual/mock. */
  accessToken?: string
}

export interface RefundPaymentResult {
  /** id del refund en el provider; null para manual/mock. */
  refundId: string | null
  status: 'refunded' | 'pending' | 'failed'
  rawResponse: unknown
}
```

Y en `interface PaymentProvider`:

```ts
export interface PaymentProvider {
  name: string
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>
  handleWebhook(payload: unknown): Promise<WebhookPaymentResult>
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>
}
```

- [ ] **Step 4: Implementar el no-op en manual y mock**

En `manual-provider.ts`, importar los tipos y agregar al objeto:

```ts
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by PaymentProvider interface
  async refundPayment(_input: RefundPaymentInput): Promise<RefundPaymentResult> {
    // Sin pasarela: el reembolso de transferencia/manual es out-of-band (contable).
    return { refundId: null, status: 'refunded', rawResponse: { manual: true } }
  },
```

Idéntico en `mock-provider.ts` (con `rawResponse: { mock: true }`). Actualizar los `import { ... } from './types'` para incluir `RefundPaymentInput, RefundPaymentResult`.

- [ ] **Step 5: Correr el test**

Run: `npx vitest run tests/unit/refund-payment-noop.test.ts`
Expected: PASS. Luego `npx tsc --noEmit | grep '^src/'` → sin salida (verifica que MP y el wrapper aún NO compilan; se completan en Task 4 — si tsc rompe acá, seguí a Task 4 antes de commitear).

- [ ] **Step 6: Commit** (junto con Task 4, porque la interfaz deja a MP incompleto). Continuar a Task 4.

---

## Task 4: MP `refundPayment` + idempotency-key en `mpRequestWithToken`

**Files:**
- Modify: `src/lib/payments/mercado-pago-provider.ts`
- Test: `tests/unit/mercado-pago-refund-payment.test.ts`

- [ ] **Step 1: Escribir el test (MP arma el POST correcto con idempotency-key)**

`tests/unit/mercado-pago-refund-payment.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMercadoPagoProvider } from '@/lib/payments/mercado-pago-provider'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

describe('MP refundPayment', () => {
  beforeEach(() => fetchMock.mockReset())

  it('POST /refunds con amount, Authorization del negocio y X-Idempotency-Key', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 999, status: 'approved' }) })
    const provider = createMercadoPagoProvider('token-del-negocio')
    const r = await provider.refundPayment({
      providerPaymentId: 'mp-123', amount: 30000, currency: 'CLP', idempotencyKey: 'refund:pkg:p1',
    })
    expect(r.refundId).toBe('999')
    expect(r.status).toBe('refunded')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/v1/payments/mp-123/refunds')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ amount: 30000 })
    expect(opts.headers['Authorization']).toBe('Bearer token-del-negocio')
    expect(opts.headers['X-Idempotency-Key']).toBe('refund:pkg:p1')
  })

  it('propaga error si MP responde no-ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: () => Promise.resolve('bad') })
    const provider = createMercadoPagoProvider('t')
    await expect(provider.refundPayment({
      providerPaymentId: 'mp-1', amount: 1, currency: 'CLP', idempotencyKey: 'k',
    })).rejects.toThrow(/Mercado Pago API error 400/)
  })
})
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx vitest run tests/unit/mercado-pago-refund-payment.test.ts`
Expected: FAIL — `refundPayment` no existe.

- [ ] **Step 3: Threadear `X-Idempotency-Key` en `mpRequestWithToken`** — la firma actual pasa `options.headers`, así que se puede pasar el header por `options`. Agregar el método dentro de `createMercadoPagoProvider` (tras `handleWebhook`):

```ts
    async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
      const refund = await mpRequestWithToken<{ id: number | string; status: string }>(
        `/v1/payments/${input.providerPaymentId}/refunds`,
        {
          method: 'POST',
          body: JSON.stringify({ amount: input.amount }),
          headers: { 'X-Idempotency-Key': input.idempotencyKey },
        },
      )
      const statusMap: Record<string, RefundPaymentResult['status']> = {
        approved: 'refunded', refunded: 'refunded', pending: 'pending', in_process: 'pending',
      }
      return {
        refundId: String(refund.id),
        status: statusMap[refund.status] ?? 'failed',
        rawResponse: refund,
      }
    },
```

Actualizar el `import { ... } from './types'` para incluir `RefundPaymentInput, RefundPaymentResult`.

- [ ] **Step 4: Implementar el método en el wrapper literal `mercadoPagoPaymentProvider`** (delegación al global):

```ts
export const mercadoPagoPaymentProvider: PaymentProvider = {
  name: 'mercado_pago',
  createPayment(input: CreatePaymentInput) { return getGlobalProvider().createPayment(input) },
  verifyPayment(input: VerifyPaymentInput) { return getGlobalProvider().verifyPayment(input) },
  handleWebhook(payload: unknown) { return getGlobalProvider().handleWebhook(payload) },
  refundPayment(input: RefundPaymentInput) { return getGlobalProvider().refundPayment(input) },
}
```

- [ ] **Step 5: Correr el test + tsc**

Run: `npx vitest run tests/unit/mercado-pago-refund-payment.test.ts tests/unit/refund-payment-noop.test.ts && npx tsc --noEmit | grep '^src/'`
Expected: 2 archivos PASS; tsc sin salida (los 4 objetos ya implementan la interfaz).

- [ ] **Step 6: Commit**

```bash
git add src/lib/payments/types.ts src/lib/payments/manual-provider.ts src/lib/payments/mock-provider.ts src/lib/payments/mercado-pago-provider.ts tests/unit/refund-payment-noop.test.ts tests/unit/mercado-pago-refund-payment.test.ts
git commit -m "feat(payments): refundPayment en PaymentProvider (MP real + manual/mock no-op)"
```

---

## Task 5: `reversePackagePurchaseInTx` (modo voluntary)

**Files:**
- Create: `src/lib/packages/reverse.ts`
- Test: `tests/unit/package-reverse.test.ts`

- [ ] **Step 1: Escribir el test (modo voluntary: revierte grants active + asiento con paymentId null + idempotente por status)**

`tests/unit/package-reverse.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { reversePackagePurchaseInTx } from '@/lib/packages/reverse'

function makeTx() {
  return {
    promotionGrant: { updateMany: vi.fn().mockResolvedValue({ count: 3 }), findMany: vi.fn().mockResolvedValue([]) },
    packagePurchase: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    ledgerEntry: { create: vi.fn().mockResolvedValue({}) },
    promotionRedemption: { updateMany: vi.fn(), findUnique: vi.fn() },
    booking: { updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    loyaltyConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    loyaltyLedger: { findUnique: vi.fn(), create: vi.fn() },
  }
}

const purchase = { id: 'pp1', businessId: 'b1', customerId: 'c1' }

describe('reversePackagePurchaseInTx voluntary', () => {
  it('flip atómico active→refunded, revierte grants active, asienta refund_issued con paymentId null', async () => {
    const tx = makeTx()
    const res = await reversePackagePurchaseInTx(tx as never, purchase, {
      mode: 'voluntary', amount: 30000, currency: 'CLP', paymentId: 'pay1', now: new Date('2026-07-12'),
    })
    expect(res.reversed).toBe(true)
    expect(tx.packagePurchase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pp1', status: 'active' },
      data: expect.objectContaining({ status: 'refunded', refundedAmount: 30000 }),
    }))
    // voluntary NO setea chargebackAt
    expect(tx.packagePurchase.updateMany.mock.calls[0][0].data.chargebackAt).toBeUndefined()
    expect(tx.promotionGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { packagePurchaseId: 'pp1', status: 'active' },
      data: expect.objectContaining({ status: 'reversed' }),
    }))
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'refund_issued', direction: 'expense', amount: 30000, currency: 'CLP', packagePurchaseId: 'pp1', paymentId: null }),
    }))
  })

  it('idempotente: si el flip no cambió nada (count 0), no asienta', async () => {
    const tx = makeTx()
    tx.packagePurchase.updateMany.mockResolvedValue({ count: 0 })
    const res = await reversePackagePurchaseInTx(tx as never, purchase, {
      mode: 'voluntary', amount: 30000, currency: 'CLP', paymentId: 'pay1', now: new Date(),
    })
    expect(res.reversed).toBe(false)
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled()
  })

  it('amount 0 no asienta pero igual marca refunded', async () => {
    const tx = makeTx()
    const res = await reversePackagePurchaseInTx(tx as never, purchase, {
      mode: 'voluntary', amount: 0, currency: 'CLP', paymentId: null, now: new Date(),
    })
    expect(res.reversed).toBe(true)
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx vitest run tests/unit/package-reverse.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar el núcleo (sólo modo voluntary por ahora; el modo chargeback se completa en Task 7)**

`src/lib/packages/reverse.ts`:

```ts
import type { Prisma } from '@prisma/client'

export interface ReversablePurchase {
  id: string
  businessId: string
  customerId: string
}

export interface ReverseOptions {
  mode: 'voluntary' | 'chargeback'
  /** prorrateo (voluntary) o monto completo de MP (chargeback). */
  amount: number
  currency: string
  /** Payment que originó la reversión; sólo para trazabilidad — el asiento va con paymentId null. */
  paymentId: string | null
  now: Date
}

export interface ReverseResult { reversed: boolean }

/**
 * Núcleo de reversión de una PackagePurchase, reusable por la owner-action (con
 * auth) y el webhook (sin auth). Corre dentro de la tx del caller.
 *
 * Idempotencia: el flip `active→refunded` es atómico (updateMany where status:'active').
 * Sólo el llamador que gana el flip (count===1) asienta y revierte — así el eco del
 * refund voluntario y el redelivery del webhook de chargeback son no-ops.
 * El asiento `refund_issued` va con paymentId:null (el @@unique([paymentId]) ya lo
 * consume el package_sale, no se puede reusar).
 */
export async function reversePackagePurchaseInTx(
  tx: Prisma.TransactionClient,
  purchase: ReversablePurchase,
  opts: ReverseOptions,
): Promise<ReverseResult> {
  const flip = await tx.packagePurchase.updateMany({
    where: { id: purchase.id, status: 'active' },
    data: {
      status: 'refunded',
      refundedAt: opts.now,
      refundedAmount: opts.amount,
      ...(opts.mode === 'chargeback' ? { chargebackAt: opts.now } : {}),
    },
  })
  if (flip.count === 0) return { reversed: false } // ya reversado / eco / redelivery

  // Grants libres (no atados a ninguna reserva) → reversed.
  await tx.promotionGrant.updateMany({
    where: { packagePurchaseId: purchase.id, status: 'active' },
    data: { status: 'reversed', reversedAt: opts.now },
  })

  if (opts.mode === 'chargeback') {
    await reverseChargebackExtras(tx, purchase, opts.now)
  }

  if (opts.amount > 0) {
    await tx.ledgerEntry.create({
      data: {
        businessId: purchase.businessId,
        packagePurchaseId: purchase.id,
        paymentId: null,
        customerId: purchase.customerId,
        type: 'refund_issued',
        direction: 'expense',
        amount: opts.amount,
        currency: opts.currency,
        description: opts.mode === 'chargeback' ? 'Contracargo de paquete' : 'Reembolso de paquete',
        occurredAt: opts.now,
      },
    })
  }

  return { reversed: true }
}

/** Placeholder de la reversión profunda del chargeback — se implementa en Task 7. */
async function reverseChargebackExtras(
  _tx: Prisma.TransactionClient,
  _purchase: ReversablePurchase,
  _now: Date,
): Promise<void> {
  // Task 7: revertir grants redeemed de reservas upcoming (descubrir reserva) +
  // clawback de puntos de sesiones completadas.
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run tests/unit/package-reverse.test.ts`
Expected: PASS (3 casos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/packages/reverse.ts tests/unit/package-reverse.test.ts
git commit -m "feat(packages): reversePackagePurchaseInTx núcleo (modo voluntary, idempotente por flip)"
```

---

## Task 6: `refundPackagePurchase` method-aware (refund real MP) + clamp del KPI

**Files:**
- Modify: `src/server/actions/packages.ts` (`refundPackagePurchase` ~:113, `getPackageSalesTotal` ~:200)
- Test: `tests/integration/packages.refund-mp.integration.test.ts`

- [ ] **Step 1: Escribir el test de integración (refund voluntario de un paquete pagado por MP llama al provider y asienta)**

`tests/integration/packages.refund-mp.integration.test.ts` (Postgres :5433). El test siembra un negocio con `PaymentAccount(mercado_pago, connected)`, un `PackageProduct`, una `PackagePurchase(active, source:'online')` con grants activos y un `Payment(mercado_pago, providerPaymentId:'mp-x', approved, packagePurchaseId)`; mockea `getMercadoPagoProviderForBusiness` para devolver un provider cuyo `refundPayment` registre la llamada; ejecuta `refundPackagePurchase(purchaseId)`; verifica que `refundPayment` fue llamado con `idempotencyKey: 'refund:pkg:<id>'` y `amount` prorrateado, que la compra quedó `refunded` sin `chargebackAt`, y que hay un `refund_issued` con `packagePurchaseId` y `paymentId null`.

```ts
// Esqueleto de aserciones clave (el setup sigue el patrón de finance.package-online.integration.test.ts):
expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({
  providerPaymentId: 'mp-x', idempotencyKey: `refund:pkg:${purchaseId}`,
}))
const after = await prisma.packagePurchase.findUnique({ where: { id: purchaseId } })
expect(after!.status).toBe('refunded')
expect(after!.chargebackAt).toBeNull()
const entry = await prisma.ledgerEntry.findFirst({ where: { packagePurchaseId: purchaseId, type: 'refund_issued' } })
expect(entry!.paymentId).toBeNull()
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npx vitest run tests/integration/packages.refund-mp.integration.test.ts`
Expected: FAIL — hoy `refundPackagePurchase` no llama a MP.

- [ ] **Step 3: Reescribir `refundPackagePurchase` method-aware** (`packages.ts`), reusando el núcleo:

```ts
import { getMercadoPagoProviderForBusiness } from '@/lib/payments/factory'
import { reversePackagePurchaseInTx } from '@/lib/packages/reverse'
// ...

export async function refundPackagePurchase(purchaseId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('package-refund', 30, 60000, { businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  const now = new Date()
  const purchase = await prisma.packagePurchase.findFirst({
    where: { id: purchaseId, businessId },
    include: {
      _count: { select: { grants: { where: { status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] } } } },
    },
  })
  if (!purchase) throw new ForbiddenError('Compra no encontrada')
  if (purchase.status === 'refunded') return // idempotente

  const refund = computePackageRefund({
    pricePaid: purchase.pricePaid, quantity: purchase.quantity,
    bonusQuantity: purchase.bonusQuantity, unusedSessions: purchase._count.grants,
  })

  // Payment de la compra (para saber si hay que devolver por MP).
  const payment = await prisma.payment.findFirst({
    where: { packagePurchaseId: purchase.id, paymentType: 'package_purchase' },
    orderBy: { createdAt: 'desc' },
  })

  // Refund REAL por MP: FUERA de la tx (I/O de red). Sólo si es online, hay id de MP y monto > 0.
  if (payment && payment.provider === 'mercado_pago' && payment.providerPaymentId && refund > 0) {
    const provider = await getMercadoPagoProviderForBusiness(businessId)
    await provider.refundPayment({
      providerPaymentId: payment.providerPaymentId,
      amount: refund,
      currency: payment.currency,
      idempotencyKey: `refund:pkg:${purchase.id}`,
    })
  }

  await prisma.$transaction(async (tx) => {
    await reversePackagePurchaseInTx(tx, purchase, {
      mode: 'voluntary',
      amount: refund,
      currency: payment?.currency ?? 'CLP',
      paymentId: payment?.id ?? null,
      now,
    })
  })

  revalidatePath('/dashboard/customers/' + purchase.customerId)
  revalidatePath('/dashboard/paquetes')
  await revalidateBusinessPublicPaths(businessId)
}
```

- [ ] **Step 4: Clamp del KPI** — en `getPackageSalesTotal` (`packages.ts`), envolver el retorno:

```ts
  return Math.max(0, (sales._sum.amount ?? 0) - (refunds._sum.amount ?? 0))
```

- [ ] **Step 5: Correr el test + tsc**

Run: el comando del Step 2 + `npx tsc --noEmit | grep '^src/'`
Expected: PASS; tsc sin salida.

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/packages.ts tests/integration/packages.refund-mp.integration.test.ts
git commit -m "feat(packages): refund real por MP (prorrateo, fuera de tx) + reversión vía núcleo + clamp KPI"
```

---

## Task 7: Modo chargeback — reversión total (redeemed/upcoming + clawback de puntos)

**Files:**
- Modify: `src/lib/packages/reverse.ts` (`reverseChargebackExtras`)
- Test: `tests/unit/package-reverse.test.ts` (casos chargeback)

- [ ] **Step 1: Escribir los tests de la reversión profunda**

Agregar a `tests/unit/package-reverse.test.ts`:

```ts
describe('reversePackagePurchaseInTx chargeback', () => {
  it('setea chargebackAt, revierte grants redeemed de reservas upcoming (descubre reserva) y clawback de puntos de completadas', async () => {
    const tx = makeTx()
    // 1 grant redeemed de reserva upcoming, 1 grant redeemed de reserva completada
    tx.promotionGrant.findMany.mockResolvedValue([
      { id: 'g-up', redeemedBookingId: 'bk-up', promotionId: 'promo1' },
      { id: 'g-done', redeemedBookingId: 'bk-done', promotionId: 'promo1' },
    ])
    tx.booking.findMany.mockResolvedValue([
      { id: 'bk-up', status: 'confirmed', serviceId: 's1', finalAmount: 0 },
      { id: 'bk-done', status: 'completed', serviceId: 's1', finalAmount: 0 },
    ])
    tx.loyaltyLedger.findUnique.mockResolvedValue({ id: 'll1', businessId: 'b1', customerId: 'c1', points: 5 })

    await reversePackagePurchaseInTx(tx as never, purchase, {
      mode: 'chargeback', amount: 50000, currency: 'CLP', paymentId: 'pay1', now: new Date('2026-07-12'),
    })

    // chargebackAt set
    expect(tx.packagePurchase.updateMany.mock.calls[0][0].data.chargebackAt).toBeInstanceOf(Date)
    // grant de reserva upcoming: liberado (redeemedBookingId null, reversed)
    expect(tx.promotionGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'g-up' }),
      data: expect.objectContaining({ status: 'reversed', redeemedBookingId: null }),
    }))
    // redemption de la upcoming liberado
    expect(tx.promotionRedemption.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ bookingId: 'bk-up' }),
    }))
    // reserva upcoming descubierta → pending_payment
    expect(tx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'bk-up' }),
      data: expect.objectContaining({ status: 'pending_payment' }),
    }))
    // clawback de puntos SOLO de la completada
    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ bookingId: 'bk-done', reason: 'visit_reversal' }),
    }))
  })
})
```

- [ ] **Step 2: Correr para verlo fallar**

Run: `npx vitest run tests/unit/package-reverse.test.ts`
Expected: FAIL — `reverseChargebackExtras` es un no-op.

- [ ] **Step 3: Implementar `reverseChargebackExtras`** (reversa profunda). Reusa `reverseVisitPoints`/`reverseAutoRewardsForBooking` de loyalty y recomputa la reserva descubierta:

```ts
import { reverseVisitPoints } from '@/lib/loyalty/credit'
import { reverseAutoRewardsForBooking } from '@/lib/loyalty/automatic'
// ...

async function reverseChargebackExtras(
  tx: Prisma.TransactionClient,
  purchase: ReversablePurchase,
  now: Date,
): Promise<void> {
  // Grants consumidos (redeemed) del paquete disputado y su reserva.
  const redeemed = await tx.promotionGrant.findMany({
    where: { packagePurchaseId: purchase.id, status: 'redeemed', redeemedBookingId: { not: null } },
    select: { id: true, redeemedBookingId: true },
  })
  const bookingIds = redeemed.map((g) => g.redeemedBookingId!).filter(Boolean)
  if (bookingIds.length === 0) return

  const bookings = await tx.booking.findMany({
    where: { id: { in: bookingIds } },
    select: { id: true, status: true },
  })
  const byId = new Map(bookings.map((b) => [b.id, b]))
  const UPCOMING = new Set(['pending_payment', 'confirmed'])

  const cfg = await tx.loyaltyConfig.findUnique({
    where: { businessId: purchase.businessId },
    select: { clawbackAutoRewardOnRefund: true },
  })

  for (const g of redeemed) {
    const bk = byId.get(g.redeemedBookingId!)
    if (!bk) continue

    if (UPCOMING.has(bk.status)) {
      // Reserva futura no completada: liberar la cobertura y descubrir la reserva.
      await tx.promotionRedemption.updateMany({
        where: { bookingId: bk.id, status: 'applied' },
        data: { status: 'released', releaseReason: 'refunded', releasedAt: now },
      })
      await tx.promotionGrant.updateMany({
        where: { id: g.id, status: 'redeemed', redeemedBookingId: bk.id },
        data: { status: 'reversed', reversedAt: now, redeemedBookingId: null, redeemedAt: null },
      })
      // Descubrir: la reserva vuelve a cobrable (owner-visible, sin auto-cancelar).
      await tx.booking.updateMany({
        where: { id: bk.id },
        data: { status: 'pending_payment', paymentStatus: 'unpaid' },
      })
    } else if (bk.status === 'completed') {
      // Sesión ya entregada: no se descubre; clawback de puntos.
      await reverseVisitPoints(tx, bk.id)
      if (cfg?.clawbackAutoRewardOnRefund) {
        await reverseAutoRewardsForBooking(tx, bk.id, now, purchase.businessId)
      }
      // El grant redeemed de una sesión completada se deja tal cual (servicio dado).
    }
  }
}
```

**Nota de diseño:** `reverseVisitPoints` es idempotente por `@@unique([bookingId,'visit_reversal'])`. La reserva descubierta NO recomputa `finalAmount` en esta tx (queda con el `finalAmount:0` que tenía) — la dueña la ve como `pending_payment` y decide el cobro; recomputar el precio del servicio es un follow-up si se quiere que el monto se refleje solo. Documentar en el spec de seguimiento.

- [ ] **Step 4: Correr el test + tsc**

Run: `npx vitest run tests/unit/package-reverse.test.ts && npx tsc --noEmit | grep '^src/'`
Expected: PASS (todos); tsc sin salida.

- [ ] **Step 5: Commit**

```bash
git add src/lib/packages/reverse.ts tests/unit/package-reverse.test.ts
git commit -m "feat(packages): chargeback reversión total — descubre reservas upcoming + clawback de puntos"
```

---

## Task 8: Notificación `PackageDisputed` a la dueña

**Files:**
- Modify: `src/lib/notifications/types.ts`, `src/lib/notifications/email-provider.ts`, `src/lib/notifications/index.ts`
- Test: `tests/unit/notifications-package-disputed.test.ts`

- [ ] **Step 1: Escribir el test del template desacoplado**

`tests/unit/notifications-package-disputed.test.ts`: verifica que `sendPackageDisputedToBusiness(businessId, data)` construye el email con `productName`/`customerName`/`amount`/`businessCurrency` y NO exige `serviceName`/`startDateTime`. Sigue el patrón de los tests existentes de `PackagePurchasedEmailData`.

- [ ] **Step 2: Correr para verlo fallar** (`vitest run` del archivo) — FAIL, función inexistente.

- [ ] **Step 3: Agregar el shape** en `types.ts` (siguiendo `PackagePurchasedEmailData`):

```ts
export interface PackageDisputedEmailData {
  businessName: string
  customerName: string
  productName: string
  amount: number
  businessCurrency: string
}
```

- [ ] **Step 4: Agregar `sendPackageDisputedToBusiness`** en `email-provider.ts` (usa `getBusinessOwnerEmails` + `sendEmail`, mismo shape que `sendPackageSoldNotificationToBusiness`; devuelve `Array<{success}>` para `sendMultiNotificationSafely`). Re-exportar en `index.ts`.

- [ ] **Step 5: Correr el test + tsc** → PASS; tsc sin salida.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/types.ts src/lib/notifications/email-provider.ts src/lib/notifications/index.ts tests/unit/notifications-package-disputed.test.ts
git commit -m "feat(notifications): shape desacoplado PackageDisputed (a la dueña)"
```

---

## Task 9: Rama de chargeback en el webhook MP

**Files:**
- Modify: `src/app/api/webhooks/mercado-pago/route.ts`
- Test: `tests/unit/mercado-pago-webhook-packages.test.ts` (casos chargeback)

- [ ] **Step 1: Escribir los tests del webhook** (agregar a `mercado-pago-webhook-packages.test.ts`):
  - `charged_back` de un paquete `active` → llama la reversión (mockear `reversePackagePurchaseInTx`), degrada el Payment, notifica `PackageDisputed`, responde 200.
  - `refunded` de un paquete YA `refunded` (eco del refund voluntario) → no revierte, responde 200 idempotente.
  - `charged_back` redelivery (segunda vez, purchase ya `refunded`) → no revierte.

Mock: `vi.mock('@/lib/packages/reverse', () => ({ reversePackagePurchaseInTx: vi.fn().mockResolvedValue({ reversed: true }) }))` y `packagePurchase.findUnique` devolviendo `{ status: 'active' | 'refunded', ... }`.

- [ ] **Step 2: Correr para verlo fallar** — FAIL (hoy el guard `:346` corta).

- [ ] **Step 3: Insertar la rama ANTES del early-return `if (payment.status === 'approved')`** (`route.ts` ~:345). Agregar:

```ts
    // B4b-3: chargeback/refund INVOLUNTARIO de un paquete YA ACTIVO. El Payment está
    // approved, así que hay que actuar ANTES del early-return de abajo. Exclusivo de
    // paquetes activos: reservas y refunds voluntarios (purchase ya 'refunded') no entran.
    if (
      (mpStatus === 'charged_back' || mpStatus === 'refunded') &&
      payment.packagePurchaseId &&
      !payment.bookingId
    ) {
      const packagePurchaseId = payment.packagePurchaseId
      const purchase = await prisma.packagePurchase.findUnique({ where: { id: packagePurchaseId } })
      if (purchase && purchase.status === 'active') {
        await prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'refunded', providerPaymentId: mpPayment.id, rawPayload: mpPayment as unknown as Prisma.InputJsonValue },
          })
          const { reversePackagePurchaseInTx } = await import('@/lib/packages/reverse')
          await reversePackagePurchaseInTx(tx, purchase, {
            mode: 'chargeback',
            amount: mpPayment.transaction_amount,
            currency: payment.currency,
            paymentId: payment.id,
            now: new Date(),
          })
        })
        await sendMultiNotificationSafely('package disputed business', async () => {
          const p = await prisma.packagePurchase.findUnique({
            where: { id: packagePurchaseId },
            include: { product: { select: { name: true } }, customer: { select: { name: true } }, business: { select: { name: true, currency: true } } },
          })
          if (!p) return [{ success: false as const, skipped: 'Compra no encontrada' }]
          return sendPackageDisputedToBusiness(payment.businessId, {
            businessName: p.business.name, customerName: p.customer.name, productName: p.product.name,
            amount: mpPayment.transaction_amount, businessCurrency: p.business.currency || 'CLP',
          })
        })
        revalidatePath(`/dashboard/customers/${purchase.customerId}`)
        revalidatePath('/dashboard/paquetes')
        return NextResponse.json({ success: true, message: 'Package chargeback processed', packagePurchaseId })
      }
      // purchase ya no está active (eco del refund voluntario / redelivery) → cae al 200 idempotente.
    }
```

Importar `sendPackageDisputedToBusiness` en el bloque de imports de notificaciones del route.

- [ ] **Step 4: Correr los tests + tsc**

Run: `npx vitest run tests/unit/mercado-pago-webhook-packages.test.ts && npx tsc --noEmit | grep '^src/'`
Expected: PASS; tsc sin salida.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/mercado-pago/route.ts tests/unit/mercado-pago-webhook-packages.test.ts
git commit -m "feat(webhook): rama de chargeback de paquete activo (perfora guard approved, idempotente por status)"
```

---

## Task 10: Helpers `bt-pkg-declared` en declared.ts

**Files:**
- Modify: `src/lib/bank-transfer/declared.ts`
- Test: `tests/unit/bt-pkg-declared.test.ts`

- [ ] **Step 1: Escribir el test (prefijo distinto, no capturado por el where de abono)**

`tests/unit/bt-pkg-declared.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { BT_PKG_DECLARED_PREFIX, btPkgDeclaredId, declaredPkgTransferPaymentWhere, isDeclaredPkgTransferPayment } from '@/lib/bank-transfer/declared'
import { BT_DECLARED_PREFIX } from '@/lib/bank-transfer/declared'

describe('bt-pkg-declared', () => {
  it('el id de paquete NO satisface el prefijo de abono de reserva', () => {
    const id = btPkgDeclaredId('pp1')
    expect(id).toBe('bt-pkg-declared:pp1')
    expect(id.startsWith(BT_DECLARED_PREFIX)).toBe(false) // clave: no lo barre el sweep booking-scoped
  })
  it('isDeclaredPkgTransferPayment matchea manual+pending+prefijo', () => {
    expect(isDeclaredPkgTransferPayment({ provider: 'manual', status: 'pending', providerPaymentId: btPkgDeclaredId('x') })).toBe(true)
    expect(isDeclaredPkgTransferPayment({ provider: 'manual', status: 'pending', providerPaymentId: 'bt-declared:x' })).toBe(false)
  })
  it('BT_PKG_DECLARED_PREFIX usable en where', () => {
    expect(declaredPkgTransferPaymentWhere.providerPaymentId).toEqual({ startsWith: BT_PKG_DECLARED_PREFIX })
  })
})
```

- [ ] **Step 2: Correr para verlo fallar** — FAIL, exports inexistentes.

- [ ] **Step 3: Agregar los helpers** en `declared.ts` (tras el bloque de `bt-balance`):

```ts
// ── Transferencia de PAQUETE (B4b-3) ──
// Prefijo PROPIO y explícito: 'bt-pkg-declared:' NO satisface startsWith('bt-declared:'),
// así que ningún sweep/consulta de reservas agarra un pago de paquete por accidente.
export const BT_PKG_DECLARED_PREFIX = 'bt-pkg-declared:'

export function btPkgDeclaredId(purchaseId: string): string {
  return `${BT_PKG_DECLARED_PREFIX}${purchaseId}`
}

export const declaredPkgTransferPaymentWhere = {
  provider: 'manual',
  status: 'pending',
  providerPaymentId: { startsWith: BT_PKG_DECLARED_PREFIX },
} satisfies Prisma.PaymentWhereInput

export function isDeclaredPkgTransferPayment(
  p: { provider: string; status: string; providerPaymentId?: string | null },
): boolean {
  return (
    p.provider === 'manual' &&
    p.status === 'pending' &&
    !!p.providerPaymentId?.startsWith(BT_PKG_DECLARED_PREFIX)
  )
}
```

- [ ] **Step 4: Correr el test** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bank-transfer/declared.ts tests/unit/bt-pkg-declared.test.ts
git commit -m "feat(bank-transfer): helpers bt-pkg-declared (prefijo propio, no barrido por reservas)"
```

---

## Task 11: Camino transferencia en la compra (`createPackagePurchase` + `declarePackageTransfer`)

**Files:**
- Modify: `src/server/actions/packages-checkout.ts` (rama transferencia + acción de declaración)
- Test: `tests/integration/packages.transfer.integration.test.ts`

- [ ] **Step 1: Identificar la ventana de hold de transferencia de reservas** — buscar la constante/config que usa la transferencia de `Booking` (grep `holdExpiresAt` en el flujo de declaración de reservas / settings de bank-transfer). Reusar ESA duración; no inventar setting. Documentar el nombre encontrado en el commit.

Run: `grep -rn "holdExpiresAt" src/server/actions/bank-transfer-public.ts src/lib/bank-transfer/`

- [ ] **Step 2: Escribir el test de integración** — `createPackagePurchase` en modo transferencia crea `PackagePurchase(pending, holdExpiresAt, source:'online')`; `declarePackageTransfer(purchaseId)` crea/asegura un `Payment(manual, 'Transferencia', pending, providerPaymentId: bt-pkg-declared:<id>)` idempotente (segundo llamado no duplica, por el `@@unique([packagePurchaseId, provider, providerPaymentId])`).

- [ ] **Step 3: Correr para verlo fallar** — FAIL.

- [ ] **Step 4: Agregar el método de pago transferencia** a `initiatePackagePayment` / o una acción nueva `initiatePackageTransfer`. Diseño mínimo: la compra ya se crea `pending` en `createPackagePurchase` (Task B4b-2). Agregar `declarePackageTransfer(input: { purchaseId: string })`:

```ts
import { btPkgDeclaredId } from '@/lib/bank-transfer/declared'

/** Declaración pública "ya transferí" de una compra de paquete por transferencia. */
export async function declarePackageTransfer(input: { purchaseId: string }): Promise<{ ok: true }> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Debes iniciar sesión.')
  const limit = await checkRateLimit('declare-package-transfer', 20, 60000, { userId: user.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')

  const purchase = await loadOwnedPurchase(input.purchaseId, user.id)
  if (purchase.status !== 'pending') throw new Error('Esta compra ya fue procesada.')
  // Race-guard sobre el hold: no aceptar declaración si el hold venció.
  if (purchase.holdExpiresAt && purchase.holdExpiresAt < new Date()) {
    throw new Error('El tiempo para transferir venció. Iniciá la compra de nuevo.')
  }

  const declaredId = btPkgDeclaredId(purchase.id)
  // Idempotente por @@unique([packagePurchaseId, provider, providerPaymentId]).
  await prisma.payment.upsert({
    where: { packagePurchaseId_provider_providerPaymentId: {
      packagePurchaseId: purchase.id, provider: 'manual', providerPaymentId: declaredId,
    } },
    update: {},
    create: {
      businessId: purchase.businessId, packagePurchaseId: purchase.id, customerId: purchase.customerId,
      provider: 'manual', providerPaymentId: declaredId, amount: purchase.pricePaid,
      currency: purchase.business.currency || 'CLP', status: 'pending',
      paymentType: 'package_purchase', paymentMethod: 'Transferencia',
    },
  })

  // Notif a la dueña "declararon una transferencia de paquete" (Task 15).
  return { ok: true }
}
```

**Nota:** verificar el nombre exacto del índice compuesto que Prisma genera para `@@unique([packagePurchaseId, provider, providerPaymentId])` (`npx prisma studio`/schema); ajustar la key del upsert si difiere de `packagePurchaseId_provider_providerPaymentId`.

Además: en `createPackagePurchase` (B4b-2) el `holdExpiresAt` ya se setea a 30 min (MP). Para transferencia se necesita la ventana de reservas (Step 1). Si difieren, parametrizar el método elegido en `createPackagePurchase` (agregar `method: 'mp' | 'transfer'` al input y elegir la ventana). Mantener MP con su ventana actual.

- [ ] **Step 5: Correr el test + tsc** → PASS; tsc sin salida.

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/packages-checkout.ts tests/integration/packages.transfer.integration.test.ts
git commit -m "feat(packages): declaración pública de transferencia de paquete (idempotente)"
```

---

## Task 12: Confirmar/rechazar transferencia de paquete (dueña)

**Files:**
- Modify: `src/server/actions/bank-transfer-verify.ts` (o acción hermana `confirmPackageTransfer`/`rejectPackageTransfer`)
- Test: `tests/integration/packages.transfer.integration.test.ts` (extender: confirmar → active; rechazar → rejected)

- [ ] **Step 1: Escribir los tests** — `confirmPackageTransfer(paymentId)` sobre una compra `pending` con `bt-pkg-declared` → activa vía `activatePackagePurchaseInTx` (grants + ledger `package_sale` + `status:'active'`), Payment `approved`; `rejectPackageTransfer(paymentId)` → Payment `rejected`, compra `rejected`, sin grants ni ledger.

- [ ] **Step 2: Correr para verlo fallar** — FAIL.

- [ ] **Step 3: Agregar acciones dedicadas** en `bank-transfer-verify.ts` (NO reusar `loadDeclaredPayment`, que exige `bookingId`). Nueva sección:

```ts
import { isDeclaredPkgTransferPayment } from '@/lib/bank-transfer/declared'
import { activatePackagePurchaseInTx } from '@/lib/packages/activate'

export async function confirmPackageTransfer(paymentId: string): Promise<{ ok: true }> {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!payment || payment.businessId !== businessId) throw new Error('Pago no encontrado')
    if (!isDeclaredPkgTransferPayment(payment)) throw new Error('Este pago no es una transferencia de paquete por verificar')
    if (!payment.packagePurchaseId) throw new Error('El pago no está asociado a una compra')
    const purchase = await tx.packagePurchase.findUnique({ where: { id: payment.packagePurchaseId } })
    if (!purchase) throw new Error('Compra no encontrada')
    if (purchase.status !== 'pending') throw new Error('Esta compra ya fue procesada.')

    // Aprobar el Payment y activar (grants + ledger).
    await tx.payment.update({ where: { id: paymentId }, data: { status: 'approved' } })
    await activatePackagePurchaseInTx(tx, purchase, { requestId: `pkg-transfer:${purchase.id}`, paymentId })
    return { customerId: purchase.customerId }
  })
  // Notif de activación (reusa las de B4b-2: paquete activado + vendido) — best-effort.
  revalidatePath(`/dashboard/customers/${result.customerId}`)
  revalidatePath('/dashboard/paquetes')
  await revalidateBusinessPublicPaths(businessId)
  return { ok: true }
}

export async function rejectPackageTransfer(paymentId: string): Promise<{ ok: true }> {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!payment || payment.businessId !== businessId) throw new Error('Pago no encontrado')
    if (!isDeclaredPkgTransferPayment(payment)) throw new Error('Este pago no es una transferencia de paquete por verificar')
    const { count } = await tx.payment.updateMany({ where: { id: paymentId, status: 'pending' }, data: { status: 'rejected' } })
    if (count === 0) throw new Error('Este pago ya fue procesado')
    if (payment.packagePurchaseId) {
      await tx.packagePurchase.updateMany({ where: { id: payment.packagePurchaseId, status: 'pending' }, data: { status: 'rejected' } })
    }
    return { customerId: payment.customerId }
  })
  revalidatePath(`/dashboard/customers/${result.customerId}`)
  revalidatePath('/dashboard/paquetes')
  await revalidateBusinessPublicPaths(businessId)
  return { ok: true }
}
```

- [ ] **Step 4: Correr los tests + tsc** → PASS; tsc sin salida.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/bank-transfer-verify.ts tests/integration/packages.transfer.integration.test.ts
git commit -m "feat(packages): confirmar/rechazar transferencia de paquete (dueña)"
```

---

## Task 13: Wizard método transferencia (cliente)

**Files:**
- Modify: `src/components/packages/package-checkout.tsx` (paso método: MP y/o transferencia)
- Modify: `src/components/packages/package-catalog.tsx` (pasar disponibilidad de transferencia)

- [ ] **Step 1: Escribir el component test** (renderToStaticMarkup con mock de `next/navigation`): con transferencia disponible, el wizard muestra el botón "Transferencia bancaria"; al elegirlo, muestra instrucciones + botón "Ya transferí" que llama `declarePackageTransfer`. Con sólo MP, no muestra la opción transferencia.

- [ ] **Step 2: Correr para verlo fallar** — FAIL.

- [ ] **Step 3: Implementar el paso método** en `package-checkout.tsx`: tras crear la compra (`createPackagePurchase`), si el negocio tiene transferencia (`getBankTransferInfo` disponible, pasado como prop `transferInfo`), ofrecer las dos opciones. MP → `initiatePackagePayment` (redirect). Transferencia → mostrar `transferInfo` (datos bancarios) + botón que llama `declarePackageTransfer({ purchaseId })` y navega a `/paquetes/confirmation?purchaseId=`. Reusar el patrón del wizard de reservas (`StepPayment`/instrucciones de transferencia).

- [ ] **Step 4: Threadear `transferInfo` desde la page** — `src/app/paquetes/[slug]/page.tsx` (y subdominio) resuelven `getBankTransferInfo(businessId)` y lo pasan a `PackageCatalog` → `PackageCheckout`.

- [ ] **Step 5: Correr el test + tsc** → PASS; tsc sin salida.

- [ ] **Step 6: Commit**

```bash
git add src/components/packages src/app/paquetes
git commit -m "feat(packages): wizard con método transferencia (instrucciones + declarar)"
```

---

## Task 14: Estados de confirmación (`expired`/`disputed`/`refunded`)

**Files:**
- Modify: `src/lib/payments/package-confirmation-state.ts`
- Modify: `src/app/paquetes/confirmation/page.tsx`
- Test: `src/lib/payments/package-confirmation-state.test.ts`

- [ ] **Step 1: Extender el test** (`package-confirmation-state.test.ts`): compra `expired` → `'expired'`; compra `refunded` con `chargebackAt` → `'disputed'`; compra `refunded` sin chargeback → `'refunded'`; pending con pago pending → `'pending'`; rejected → `'rejected'`.

- [ ] **Step 2: Correr para verlo fallar** — FAIL.

- [ ] **Step 3: Reescribir `derivePackageConfirmationState`**:

```ts
export type PackageConfirmationState = 'active' | 'pending' | 'rejected' | 'expired' | 'refunded' | 'disputed'

interface DeriveInput {
  status: string
  chargebackAt?: Date | null
  payments: { status: string }[]
}

export function derivePackageConfirmationState(input: DeriveInput): PackageConfirmationState {
  if (input.status === 'active') return 'active'
  if (input.status === 'expired') return 'expired'
  if (input.status === 'refunded') return input.chargebackAt ? 'disputed' : 'refunded'
  if (input.status === 'rejected') return 'rejected'
  if (input.payments.some(p => p.status === 'approved')) return 'active'
  if (input.payments.some(p => p.status === 'pending' || p.status === 'in_process')) return 'pending'
  if (input.payments.some(p => p.status === 'rejected' || p.status === 'cancelled')) return 'rejected'
  return 'pending'
}
```

- [ ] **Step 4: Copy en `confirmation/page.tsx`** — agregar los estados nuevos: `expired` ("Tu compra expiró. Podés iniciarla de nuevo."), `refunded` ("Este pago fue reembolsado."), `disputed` ("Este pago fue reembolsado."). Distintos de `rejected` ("Pago no aprobado. Podés intentar de nuevo."). Pasar `chargebackAt` al derive.

- [ ] **Step 5: Correr los tests + tsc** → PASS; tsc sin salida.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payments/package-confirmation-state.ts src/lib/payments/package-confirmation-state.test.ts src/app/paquetes/confirmation/page.tsx
git commit -m "feat(packages): estados de confirmación expired/refunded/disputed"
```

---

## Task 15: Superficie de la dueña — transferencias de paquete pendientes + notif declarada

**Files:**
- Modify: `src/lib/notifications/{types,email-provider,index}.ts` (shape `PackageTransferDeclared`)
- Modify: `src/server/actions/packages-checkout.ts` (llamar la notif en `declarePackageTransfer`)
- Modify: `src/app/dashboard/paquetes/page.tsx` (lista de compras `pending` con confirmar/rechazar) + contador en `src/app/dashboard/page.tsx`
- Create: `src/components/packages/pending-package-transfers.tsx`

- [ ] **Step 1: Shape `PackageTransferDeclared`** en `types.ts` + `sendPackageTransferDeclaredToBusiness` en `email-provider.ts` (desacoplado, como `PackageDisputed`); re-export en `index.ts`. Test unit del template.

- [ ] **Step 2: Llamar la notif** en `declarePackageTransfer` (Task 11) vía `sendMultiNotificationSafely('package transfer declared business', ...)`.

- [ ] **Step 3: Query de pendientes** — en `packages.ts`, `getPendingPackageTransfers()`:

```ts
export async function getPendingPackageTransfers() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const now = new Date()
  return prisma.packagePurchase.findMany({
    where: { businessId, status: 'pending', source: 'online', holdExpiresAt: { gte: now } },
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { name: true } }, customer: { select: { name: true, phone: true } },
      payments: { where: { provider: 'manual', status: 'pending' }, select: { id: true, providerPaymentId: true } },
    },
  })
}
```

- [ ] **Step 4: Componente `PendingPackageTransfers`** — lista cada compra con "Confirmar"/"Rechazar" que llaman `confirmPackageTransfer(paymentId)`/`rejectPackageTransfer(paymentId)` (el `paymentId` del pago `bt-pkg-declared` de la compra). Renderizarlo arriba de `/dashboard/paquetes`. Contador en el home (`dashboard/page.tsx`) sumando `getPendingPackageTransfers().length` (fuente de respaldo del email — es el canal real con Resend caído).

- [ ] **Step 5: Component test** del panel (mock next/navigation) + tsc.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications src/server/actions/packages-checkout.ts src/server/actions/packages.ts src/app/dashboard/paquetes/page.tsx src/app/dashboard/page.tsx src/components/packages/pending-package-transfers.tsx
git commit -m "feat(packages): panel de transferencias de paquete pendientes + notif declarada (fallback dashboard)"
```

---

## Task 16: `expireStaleHolds` extendido a PackagePurchase pending

**Files:**
- Modify: `src/lib/cron/expire-holds.ts`
- Test: `tests/integration/packages.transfer.integration.test.ts` (caso expiración)

- [ ] **Step 1: Escribir el test** — una `PackagePurchase(pending, holdExpiresAt < now)` con su `Payment(manual, pending, bt-pkg-declared)` → tras `expireStaleHolds(now)`, la compra queda `expired` y el Payment `cancelled`. Una `pending` con hold vivo NO se toca.

- [ ] **Step 2: Correr para verlo fallar** — FAIL (hoy sólo barre bookings).

- [ ] **Step 3: Extender el tipo `db` y agregar el sweep de paquetes** al final de `expireStaleHolds`, dentro de una tx propia (mismo patrón que reservas):

```ts
db: Pick<PrismaClient, 'booking' | 'payment' | '$transaction' | 'packagePurchase'> = prisma,
```

Tras el bloque de reservas, antes del return:

```ts
  // ── Sweep de compras de paquete pending (B4b-3) ──
  const expiredPurchases = await db.packagePurchase.findMany({
    where: { status: 'pending', holdExpiresAt: { lt: now } },
    select: { id: true, businessId: true },
  })
  let packagesExpired = 0
  if (expiredPurchases.length > 0) {
    const pkgIds = expiredPurchases.map((p) => p.id)
    await db.$transaction(async (tx) => {
      const res = await tx.packagePurchase.updateMany({
        where: { id: { in: pkgIds }, status: 'pending', holdExpiresAt: { lt: now } },
        data: { status: 'expired' },
      })
      packagesExpired = res.count
      // Cancelar los Payment pending huérfanos de las compras que REALMENTE expiraron.
      await tx.payment.updateMany({
        where: { packagePurchaseId: { in: pkgIds }, status: 'pending', packagePurchase: { status: 'expired' } },
        data: { status: 'cancelled' },
      })
    })
  }
```

Agregar `packagesExpired` al `ExpireHoldsResult` y al return.

- [ ] **Step 4: Correr el test + tsc** → PASS; tsc sin salida.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cron/expire-holds.ts tests/integration/packages.transfer.integration.test.ts
git commit -m "feat(cron): expire-holds barre compras de paquete pending (transferencia sin declarar)"
```

---

## Task 17: Gate final del PR

- [ ] **Step 1: Suite unit completa**

Run: `npx vitest run --no-file-parallelism`
Expected: verde (los 3 flaky preexistentes por tiempo/carga son idénticos a main).

- [ ] **Step 2: Integración (Postgres :5433)**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npx vitest run tests/integration/packages.chargeback.integration.test.ts tests/integration/packages.transfer.integration.test.ts tests/integration/packages.refund-mp.integration.test.ts`
Expected: verde.

- [ ] **Step 3: tsc + eslint**

Run: `npx prisma generate && npx tsc --noEmit | grep '^src/'` (0 líneas) y `npx eslint src --max-warnings 0`.

- [ ] **Step 4: `/simplify`** (4 ángulos) sobre el diff del branch; aplicar los fixes sin cambiar comportamiento.

- [ ] **Step 5: Code review 5-finders** con verificación adversarial del delta; corregir hallazgos reales.

- [ ] **Step 6: Crear el PR SIN auto-merge**

```bash
git push -u origin claude/b4b-packages-online
gh pr create --title "feat(packages): B4b-3 transferencia + refund real MP + chargeback" --body "..."
```
Esperar OK explícito del usuario para mergear. NO bypass de checks requeridos.

---

## Self-Review (checklist del autor)

**Spec coverage:**
- Migración `chargebackAt` + estados → Task 1. ✓
- `refundPayment` interfaz + 4 impls → Tasks 3-4. ✓
- `reversePackagePurchaseInTx` (voluntary + chargeback) → Tasks 5, 7. ✓
- Refund real MP method-aware → Task 6. ✓
- Chargeback webhook (perforar guard :346, idempotente por status) → Task 9. ✓
- Reversión total (redeemed/upcoming descubre reserva + clawback puntos) → Task 7. ✓
- Prefijo `bt-pkg-declared:` + helpers → Task 10. ✓
- Transferencia: declarar/confirmar/rechazar/wizard → Tasks 11-13. ✓
- Confirmation states + panel badges + pending visibles → Tasks 2, 14. ✓
- Notif desacopladas + fallback dashboard → Tasks 8, 15. ✓
- `expireStaleHolds` paquetes → Task 16. ✓
- Clamp KPI + revalidación → Tasks 6, 12, 15. ✓

**Desvío justificado del spec:** el asiento de reembolso va con `paymentId: null` (no upsert por paymentId) porque el `@@unique([paymentId])` ya lo consume el `package_sale`; la idempotencia es el flip atómico de `purchase.status`. (Documentado en Landmines y Task 5.)

**Type consistency:** `reversePackagePurchaseInTx(tx, purchase, opts)` y `ReverseOptions.mode` consistentes entre Tasks 5/6/7/9. `btPkgDeclaredId`/`isDeclaredPkgTransferPayment`/`declaredPkgTransferPaymentWhere` consistentes entre Tasks 10/11/12/15. `derivePackageConfirmationState` firma con `chargebackAt` consistente Task 14. `RefundPaymentInput`/`Result` consistentes Tasks 3/4/6.

**Placeholders:** ninguno de los patrones prohibidos; la única búsqueda diferida (nombre exacto de la ventana de hold de transferencia y del índice compuesto de Prisma) tiene un Step explícito de identificación (Tasks 11 Step 1, Step 4 nota).
