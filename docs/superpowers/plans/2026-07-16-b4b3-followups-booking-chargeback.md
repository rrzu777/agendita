# Follow-ups B4b-3: chargeback de reservas + fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El webhook MP procesa chargebacks/refunds de reservas post-approved (marcar + restaurar montos + clawback + alarma), la dueña ve y puede recobrar, y las transferencias de paquete declaradas dejan de volverse zombies invisibles.

**Architecture:** Núcleo `reverseBookingPaymentInTx` (espejo de `reversePackagePurchaseInTx`, idempotente por flip CAS del Payment) + rama nueva en el webhook antes del early-return `approved` + guard anti-redelivery en la rama vieja. Montos restaurados reusando `recalcBookingFromPayments` (se exporta con override de paymentStatus). Badge compartido "Pago revertido" + 3 guards chicos (loyalty al completar, declarar con hold vencido, pago manual en completed).

**Tech Stack:** Next.js App Router (custom — leer `node_modules/next/dist/docs/` ante dudas), Prisma + PostgreSQL, Vitest 4 (`renderToStaticMarkup` para componentes, NO @testing-library), TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-07-16-b4b3-followups-booking-chargeback-design.md` (rev. 2 — leerla entera antes de empezar).

**Convenciones del repo que aplican a TODAS las tasks:**
- Rama de trabajo: `claude/b4b3-followups` (ya existe, sobre main). Worktree: usar `git -C <worktree>` y `git add` con archivos explícitos, nunca `-A`.
- Correr tests: `npx vitest run <archivo> --project unit` (unit) / `--project integration` (integración; requiere Docker `agendita-test-pg` en :5433).
- `tsc` chequea también `tests/` — si agregás un método a una interfaz, actualizá TODOS los mocks inline.
- **Sin migración en esta rebanada** — no tocar `prisma/schema.prisma`.
- Los tests de componentes usan `renderToStaticMarkup`; si el componente usa `useRouter`, mockear `next/navigation` (landmine conocida).

---

## Estado actual (leer antes de tocar)

- `src/app/api/webhooks/mercado-pago/route.ts:347-397` — rama de chargeback de PAQUETE (B4b-3), el patrón a espejar. `:399-406` — early-return `approved` que hoy se traga los chargebacks de reserva. `:564-618` — rama vieja de degradación (rejected/cancelled/refunded/charged_back pre-approval) cuyo guard actual solo corta `approved`.
- `src/lib/packages/reverse.ts` — `reversePackagePurchaseInTx`, el espejo conceptual del núcleo nuevo.
- `src/server/services/finance.ts:287-390` — `recalcBookingFromPayments` (privada hoy): suma payments `approved` con signo por dirección, deriva `depositPaid`/`remainingBalance`/`paymentStatus`.
- `src/lib/loyalty/credit.ts:53` — `reverseVisitPoints(tx, bookingId)` idempotente. `src/lib/loyalty/automatic.ts:122` — `reverseAutoRewardsForBooking(tx, bookingId, now, businessId)` idempotente.
- El Payment del webhook ya viene con `include: { booking: true }` (`route.ts:193-196`).

---

### Task 1: Exportar `recalcBookingFromPayments` con override de paymentStatus

**Files:**
- Modify: `src/server/services/finance.ts:287` (firma) y `:319-390` (usos de `newPaymentStatus`)
- Test: `tests/unit/recalc-payment-status-override.test.ts` (nuevo)

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi } from 'vitest'
import { BookingPaymentStatus } from '@prisma/client'

// El override de paymentStatus se aplica en el update final; los montos
// (depositPaid/remainingBalance) se derivan igual de los payments approved.
describe('recalcBookingFromPayments — paymentStatusOverride', () => {
  function makeTx(booking: Record<string, unknown>, approvedPayments: Array<Record<string, unknown>>) {
    return {
      booking: {
        findUnique: vi.fn(async () => booking),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...booking, ...data })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      payment: {
        findMany: vi.fn(async () => approvedPayments),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    }
  }

  it('sin override deriva paymentStatus de los payments (comportamiento actual)', async () => {
    const { recalcBookingFromPayments } = await import('@/server/services/finance')
    const booking = { id: 'b1', status: 'confirmed', businessId: 'biz', customerId: 'c1', totalPrice: 10000, depositRequired: 5000, depositPaid: 5000, remainingBalance: 5000, finalAmount: 10000, paymentStatus: 'deposit_paid' }
    const tx = makeTx(booking, []) // el pago fue flipeado a refunded → 0 approved
    const { booking: updated } = await recalcBookingFromPayments(tx as never, 'b1')
    expect(tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ depositPaid: 0, remainingBalance: 10000, paymentStatus: BookingPaymentStatus.unpaid }),
    }))
    expect(updated.paymentStatus).toBe(BookingPaymentStatus.unpaid)
  })

  it('con override escribe el paymentStatus dado y los montos derivados', async () => {
    const { recalcBookingFromPayments } = await import('@/server/services/finance')
    const booking = { id: 'b1', status: 'confirmed', businessId: 'biz', customerId: 'c1', totalPrice: 10000, depositRequired: 5000, depositPaid: 5000, remainingBalance: 5000, finalAmount: 10000, paymentStatus: 'deposit_paid' }
    const tx = makeTx(booking, [])
    await recalcBookingFromPayments(tx as never, 'b1', { paymentStatusOverride: BookingPaymentStatus.refunded })
    expect(tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ depositPaid: 0, remainingBalance: 10000, paymentStatus: BookingPaymentStatus.refunded }),
    }))
  })
})
```

Nota: mirar cómo otros tests de finance mockean (buscar tests existentes que importen `@/server/services/finance`) y copiar el patrón de mocks de módulo si `finance.ts` importa cosas con side effects (p. ej. `@/lib/bank-transfer/declared` es puro, no necesita mock).

- [ ] **Step 2: Correr el test — debe fallar** (`recalcBookingFromPayments` no está exportada)

Run: `npx vitest run tests/unit/recalc-payment-status-override.test.ts --project unit`
Expected: FAIL — `recalcBookingFromPayments is not a function` / no export.

- [ ] **Step 3: Implementar**

En `src/server/services/finance.ts`:

1. Cambiar `async function recalcBookingFromPayments(` por `export async function recalcBookingFromPayments(` y agregar el tercer parámetro:

```ts
export async function recalcBookingFromPayments(
  tx: Prisma.TransactionClient,
  bookingId: string,
  opts?: { paymentStatusOverride?: BookingPaymentStatus },
): Promise<{ booking: { /* …mismo tipo actual, sin cambios… */ }; wasConfirmed: boolean }> {
```

2. Después del bloque que deriva `newPaymentStatus` (líneas ~319-326), agregar:

```ts
  // Reversión de pago (chargeback/refund MP): el caller quiere los montos
  // verdaderos pero con el marcador 'refunded' en vez del estado derivado.
  const effectivePaymentStatus = opts?.paymentStatusOverride ?? newPaymentStatus
```

3. Reemplazar los TRES usos de `paymentStatus: newPaymentStatus` (en el updateMany de confirmación ~línea 340, en el update post-carrera ~372, y en el update final ~385) por `paymentStatus: effectivePaymentStatus`. También el `paymentStatus: newPaymentStatus` del objeto retornado en el camino confirmado (~357) pasa a `effectivePaymentStatus`.

- [ ] **Step 4: Correr el test — debe pasar**

Run: `npx vitest run tests/unit/recalc-payment-status-override.test.ts --project unit`
Expected: PASS (2 tests)

- [ ] **Step 5: Correr los tests existentes de finance/payments para no romper nada**

Run: `npx vitest run tests/unit --project unit -t "recalc" ; npx vitest run tests/unit/manual-payment*.test.ts tests/unit/apply-approved*.test.ts --project unit 2>/dev/null || npx vitest run tests/unit --project unit`
Expected: verde (si algún archivo no existe con ese nombre, correr la suite unit entera).

- [ ] **Step 6: Commit**

```bash
git add src/server/services/finance.ts tests/unit/recalc-payment-status-override.test.ts
git commit -m "feat(chargeback): exportar recalcBookingFromPayments con paymentStatusOverride"
```

---

### Task 2: Núcleo `reverseBookingPaymentInTx`

**Files:**
- Create: `src/lib/bookings/reverse-payment.ts`
- Test: `tests/unit/reverse-booking-payment.test.ts` (nuevo)

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const recalcMock = vi.fn(async () => ({ booking: { id: 'b1' }, wasConfirmed: false }))
vi.mock('@/server/services/finance', () => ({ recalcBookingFromPayments: recalcMock }))
const reverseVisitMock = vi.fn(async () => {})
vi.mock('@/lib/loyalty/credit', () => ({ reverseVisitPoints: reverseVisitMock }))
const reverseAutoMock = vi.fn(async () => {})
vi.mock('@/lib/loyalty/automatic', () => ({ reverseAutoRewardsForBooking: reverseAutoMock }))

function makeTx(flipCount: number, clawbackCfg: { clawbackAutoRewardOnRefund: boolean } | null = { clawbackAutoRewardOnRefund: true }) {
  return {
    payment: { updateMany: vi.fn(async () => ({ count: flipCount })) },
    ledgerEntry: { create: vi.fn(async () => ({})) },
    loyaltyConfig: { findUnique: vi.fn(async () => clawbackCfg) },
    promotionRedemption: { updateMany: vi.fn(async () => ({ count: 0 })) },
  }
}

const OPTS = {
  paymentId: 'pay1', bookingId: 'b1', businessId: 'biz', customerId: 'c1',
  amount: 8000, currency: 'CLP', mode: 'chargeback' as const, now: new Date('2026-07-16T12:00:00Z'),
}

beforeEach(() => { vi.clearAllMocks() })

describe('reverseBookingPaymentInTx', () => {
  it('flip ganado: flipea el Payment con CAS, asienta expense con paymentId null, recalca con override refunded y hace clawback', async () => {
    const { reverseBookingPaymentInTx } = await import('@/lib/bookings/reverse-payment')
    const tx = makeTx(1)
    const res = await reverseBookingPaymentInTx(tx as never, OPTS)
    expect(res.reversed).toBe(true)
    expect(tx.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pay1', status: 'approved' },
      data: expect.objectContaining({ status: 'refunded' }),
    }))
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bookingId: 'b1', paymentId: null, type: 'refund_issued', direction: 'expense', amount: 8000,
      }),
    }))
    expect(recalcMock).toHaveBeenCalledWith(tx, 'b1', { paymentStatusOverride: 'refunded' })
    expect(reverseVisitMock).toHaveBeenCalledWith(tx, 'b1')
    expect(reverseAutoMock).toHaveBeenCalledWith(tx, 'b1', OPTS.now, 'biz')
  })

  it('flip perdido (count 0): retorna reversed false y CERO side effects', async () => {
    const { reverseBookingPaymentInTx } = await import('@/lib/bookings/reverse-payment')
    const tx = makeTx(0)
    const res = await reverseBookingPaymentInTx(tx as never, OPTS)
    expect(res.reversed).toBe(false)
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled()
    expect(recalcMock).not.toHaveBeenCalled()
    expect(reverseVisitMock).not.toHaveBeenCalled()
    expect(reverseAutoMock).not.toHaveBeenCalled()
  })

  it('clawbackAutoRewardOnRefund apagado: revierte visit points pero NO auto-rewards', async () => {
    const { reverseBookingPaymentInTx } = await import('@/lib/bookings/reverse-payment')
    const tx = makeTx(1, { clawbackAutoRewardOnRefund: false })
    await reverseBookingPaymentInTx(tx as never, OPTS)
    expect(reverseVisitMock).toHaveBeenCalled()
    expect(reverseAutoMock).not.toHaveBeenCalled()
  })

  it('NO libera la redención de promo (la reserva sigue viva)', async () => {
    const { reverseBookingPaymentInTx } = await import('@/lib/bookings/reverse-payment')
    const tx = makeTx(1)
    await reverseBookingPaymentInTx(tx as never, OPTS)
    expect(tx.promotionRedemption.updateMany).not.toHaveBeenCalled()
  })

  it('flipData del webhook viaja al update del Payment', async () => {
    const { reverseBookingPaymentInTx } = await import('@/lib/bookings/reverse-payment')
    const tx = makeTx(1)
    await reverseBookingPaymentInTx(tx as never, { ...OPTS, flipData: { providerPaymentId: 'mp-99', rawPayload: { id: 'mp-99' } } })
    expect(tx.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'refunded', providerPaymentId: 'mp-99' }),
    }))
  })
})
```

- [ ] **Step 2: Correr — debe fallar** (módulo no existe)

Run: `npx vitest run tests/unit/reverse-booking-payment.test.ts --project unit`
Expected: FAIL — cannot resolve `@/lib/bookings/reverse-payment`.

- [ ] **Step 3: Implementar `src/lib/bookings/reverse-payment.ts`**

```ts
import type { Prisma } from '@prisma/client'
import { BookingPaymentStatus } from '@prisma/client'
import { reverseVisitPoints } from '@/lib/loyalty/credit'
import { reverseAutoRewardsForBooking } from '@/lib/loyalty/automatic'
import { recalcBookingFromPayments } from '@/server/services/finance'

export interface ReverseBookingPaymentOptions {
  paymentId: string
  bookingId: string
  businessId: string
  customerId: string | null
  /** monto completo del pago según MP (transaction_amount). */
  amount: number
  currency: string
  /** 'chargeback' = disputa (alarma fuera de acá); 'voluntary' = refund desde el panel de MP. */
  mode: 'chargeback' | 'voluntary'
  now: Date
  /** trazabilidad del webhook en el flip (providerPaymentId / rawPayload). */
  flipData?: { providerPaymentId?: string; rawPayload?: Prisma.InputJsonValue }
}

export interface ReverseBookingPaymentResult { reversed: boolean }

/**
 * Núcleo de reversión de un pago APROBADO de reserva (chargeback/refund que
 * llega por webhook MP post-approved). Espejo de reversePackagePurchaseInTx,
 * pero acá la unidad de idempotencia es el Payment: el flip `approved→refunded`
 * es atómico (updateMany where status:'approved'); sólo el llamador que gana el
 * flip asienta, recalcula y hace clawback — redeliveries y carreras son no-ops.
 *
 * Política (spec §1): la reserva NO cambia de status (la dueña decide qué hacer)
 * y la redención de promo NO se libera (la reserva sigue viva con su descuento;
 * si la dueña cancela después, cancelBookingInTx la libera). Los montos SÍ se
 * restauran vía recalc (depositPaid baja, remainingBalance sube → recobrable)
 * con paymentStatus overrideado a 'refunded' como marcador de la disputa.
 * El asiento refund_issued va con paymentId:null (el @@unique([paymentId]) ya
 * lo consume el asiento original del pago).
 */
export async function reverseBookingPaymentInTx(
  tx: Prisma.TransactionClient,
  opts: ReverseBookingPaymentOptions,
): Promise<ReverseBookingPaymentResult> {
  const flip = await tx.payment.updateMany({
    where: { id: opts.paymentId, status: 'approved' },
    data: {
      status: 'refunded',
      ...(opts.flipData?.providerPaymentId ? { providerPaymentId: opts.flipData.providerPaymentId } : {}),
      ...(opts.flipData?.rawPayload !== undefined ? { rawPayload: opts.flipData.rawPayload } : {}),
    },
  })
  if (flip.count === 0) return { reversed: false } // eco / redelivery / carrera

  if (opts.amount > 0) {
    await tx.ledgerEntry.create({
      data: {
        businessId: opts.businessId,
        bookingId: opts.bookingId,
        paymentId: null,
        customerId: opts.customerId,
        type: 'refund_issued',
        direction: 'expense',
        amount: opts.amount,
        currency: opts.currency,
        description: opts.mode === 'chargeback' ? 'Contracargo de reserva' : 'Reembolso de reserva',
        occurredAt: opts.now,
      },
    })
  }

  // Montos verdaderos (el pago flipeado ya no cuenta) + marcador de disputa.
  await recalcBookingFromPayments(tx, opts.bookingId, {
    paymentStatusOverride: BookingPaymentStatus.refunded,
  })

  // Clawback de loyalty — ambos idempotentes; visit es no-op si nunca se completó.
  await reverseVisitPoints(tx, opts.bookingId)
  const cfg = await tx.loyaltyConfig.findUnique({
    where: { businessId: opts.businessId },
    select: { clawbackAutoRewardOnRefund: true },
  })
  if (cfg?.clawbackAutoRewardOnRefund) {
    await reverseAutoRewardsForBooking(tx, opts.bookingId, opts.now, opts.businessId)
  }

  return { reversed: true }
}
```

- [ ] **Step 4: Correr — debe pasar**

Run: `npx vitest run tests/unit/reverse-booking-payment.test.ts --project unit`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookings/reverse-payment.ts tests/unit/reverse-booking-payment.test.ts
git commit -m "feat(chargeback): núcleo reverseBookingPaymentInTx (flip CAS + ledger + recalc + clawback)"
```

---

### Task 3: Notificación `BookingDisputed`

**Files:**
- Modify: `src/lib/notifications/types.ts` (después de `PackageDisputedEmailData`, ~línea 221)
- Modify: `src/lib/notifications/templates.ts` (junto a `packageDisputedBusinessHtml`, ~línea 776)
- Modify: `src/lib/notifications/email-provider.ts` (junto a `sendPackageDisputedToBusiness`, ~línea 585)
- Modify: `src/lib/notifications/index.ts` (re-exports, espejo de PackageDisputed)
- Test: `tests/unit/booking-disputed-notification.test.ts` (nuevo)

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect } from 'vitest'
import { bookingDisputedBusinessHtml, bookingDisputedBusinessText } from '@/lib/notifications/templates'

const DATA = {
  businessName: 'Estudio Mimo', customerName: 'Caro P', serviceName: 'Manicure',
  bookingLabel: '#4738', startDateTime: new Date('2026-07-20T15:00:00Z'),
  businessTimezone: 'America/Santiago', amount: 8000, businessCurrency: 'CLP',
}

describe('BookingDisputed templates', () => {
  it('html incluye clienta, servicio, número, monto y aviso de contracargo', () => {
    const html = bookingDisputedBusinessHtml(DATA)
    expect(html).toContain('Contracargo')
    expect(html).toContain('Caro P')
    expect(html).toContain('Manicure')
    expect(html).toContain('#4738')
    expect(html).toContain('8.000')
  })
  it('text plano incluye lo mismo', () => {
    const text = bookingDisputedBusinessText(DATA)
    expect(text).toContain('Caro P')
    expect(text).toContain('#4738')
  })
})
```

- [ ] **Step 2: Correr — debe fallar.** Run: `npx vitest run tests/unit/booking-disputed-notification.test.ts --project unit` → FAIL (exports inexistentes).

- [ ] **Step 3: Implementar (calcado del trío PackageDisputed)**

`types.ts` — después de `PackageDisputedEmailData`:

```ts
export interface BookingDisputedEmailData {
  businessName: string
  customerName: string
  serviceName: string
  /** formatBookingNumber(bookingNumber, id) — p.ej. "#4738". */
  bookingLabel: string
  startDateTime: Date
  businessTimezone: string
  amount: number
  businessCurrency: string
}
```

`templates.ts` — después de `packageDisputedBusinessText` (usar el `fmtCurrency`/`baseHtml`/`header`/`footer`/`escapeHtml` del archivo; mirar cómo otros templates formatean fecha con timezone — buscar `formatInTimeZone` o el helper local del archivo y reusarlo):

```ts
export function bookingDisputedBusinessHtml(data: BookingDisputedEmailData): string {
  const amount = fmtCurrency(data.amount, data.businessCurrency)
  return baseHtml(`
    ${header('Contracargo de reserva')}
    <p style="font-size:15px">Se registró un contracargo (chargeback) del pago de una reserva de ${escapeHtml(data.customerName)}. El pago fue revertido y la reserva quedó marcada — revisá si querés cancelarla, recobrar o atender igual.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Clienta</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.customerName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Reserva</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.bookingLabel)} — ${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha</td><td style="padding:8px 0;font-weight:600">${fmtDateTime(data.startDateTime, data.businessTimezone)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Monto</td><td style="padding:8px 0;font-weight:600">${amount}</td></tr>
    </table>
    ${footer(data.businessName)}
  `)
}

export function bookingDisputedBusinessText(data: BookingDisputedEmailData): string {
  const amount = fmtCurrency(data.amount, data.businessCurrency)
  return [
    'Contracargo de reserva', '',
    `Se registró un contracargo (chargeback) del pago de una reserva de ${data.customerName}. El pago fue revertido y la reserva quedó marcada.`, '',
    `Clienta: ${data.customerName}`,
    `Reserva: ${data.bookingLabel} — ${data.serviceName}`,
    `Fecha: ${fmtDateTime(data.startDateTime, data.businessTimezone)}`,
    `Monto: ${amount}`, '',
    `Enviado por ${data.businessName} a través de Agendita`,
  ].join('\n')
}
```

**Nota `fmtDateTime`:** si `templates.ts` no tiene un helper de fecha+timezone con ese nombre, buscar el que usan los templates de reserva existentes (bookingConfirmed/reminder usan formateo con `businessTimezone`) y usar ESE; si es inline, replicar el patrón inline. No inventar un helper nuevo si ya hay uno.

`email-provider.ts` — después de `sendPackageDisputedToBusiness` (mismo shape exacto):

```ts
/** Email a la(s) dueña(s)/admin(s) cuando llega un chargeback del pago de una reserva. */
export async function sendBookingDisputedToBusiness(
  businessId: string,
  data: BookingDisputedEmailData,
): Promise<EmailResult[]> {
  const ownerEmails = await getBusinessOwnerEmails(businessId)
  if (ownerEmails.length === 0) {
    return [{ success: false, skipped: 'No hay owners/admins con email para el negocio' }]
  }
  const html = bookingDisputedBusinessHtml(data)
  const text = bookingDisputedBusinessText(data)
  return Promise.all(
    ownerEmails.map((owner) =>
      sendEmail(owner.email, `Contracargo de reserva - ${data.customerName}`, html, text, {}),
    ),
  )
}
```

`index.ts` — agregar `sendBookingDisputedToBusiness` al import/re-export de email-provider y `BookingDisputedEmailData` al `export type` (espejo exacto de cómo está PackageDisputed en ambas líneas).

- [ ] **Step 4: Correr — debe pasar.** Run: `npx vitest run tests/unit/booking-disputed-notification.test.ts --project unit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/types.ts src/lib/notifications/templates.ts src/lib/notifications/email-provider.ts src/lib/notifications/index.ts tests/unit/booking-disputed-notification.test.ts
git commit -m "feat(chargeback): notificación BookingDisputed a la dueña"
```

---

### Task 4: Rama nueva de reservas en el webhook MP

**Files:**
- Modify: `src/app/api/webhooks/mercado-pago/route.ts` (insertar entre la rama de paquete ~397 y el early-return approved ~400; imports arriba)
- Test: `tests/unit/mercado-pago-webhook-bookings-chargeback.test.ts` (nuevo)

- [ ] **Step 1: Leer los mocks de `tests/unit/mercado-pago-webhook-packages.test.ts`** (setup de firma/fetch/prisma) y copiar EXACTAMENTE ese andamiaje para el archivo nuevo — es el patrón probado para testear esta ruta. Los casos de la rama de paquete `charged_back` (~línea 357) son el espejo directo.

- [ ] **Step 2: Escribir los tests que fallan** (con el andamiaje copiado; los mocks de prisma deben incluir `payment.findUnique` que devuelva un Payment de RESERVA `approved` con `booking` incluido):

Casos (assertions análogas a las de paquete, adaptadas):

```ts
// 1. charged_back sobre Payment de reserva approved:
//    - reverseBookingPaymentInTx llamado con mode 'chargeback' y flipData {providerPaymentId, rawPayload}
//    - sendBookingDisputedToBusiness llamado
//    - respuesta 200 con message 'Booking chargeback processed'
// 2. refunded sobre Payment de reserva approved:
//    - reverseBookingPaymentInTx con mode 'voluntary'
//    - sendBookingDisputedToBusiness NO llamado
//    - 200 'Booking refund processed'
// 3. redelivery: reverseBookingPaymentInTx devuelve { reversed: false } →
//    - sendBookingDisputedToBusiness NO llamado, 200 idempotente
// 4. payment de reserva con status ya 'refunded' (gate no matchea) → NO llama al núcleo
//    y cae al flujo existente (con el guard de Task 5 → 200 sin side effects; hasta esa task,
//    asertar solo que reverseBookingPaymentInTx NO fue llamado)
// 5. payment de PAQUETE (packagePurchaseId sin bookingId) con charged_back → sigue yendo a
//    reversePackagePurchaseInTx, NUNCA a reverseBookingPaymentInTx
```

Mockear el núcleo y la notif por módulo:

```ts
const reverseBookingMock = vi.fn(async () => ({ reversed: true }))
vi.mock('@/lib/bookings/reverse-payment', () => ({ reverseBookingPaymentInTx: reverseBookingMock }))
```

- [ ] **Step 3: Correr — deben fallar.** Run: `npx vitest run tests/unit/mercado-pago-webhook-bookings-chargeback.test.ts --project unit` → FAIL (la rama no existe; el evento cae en el early-return "already approved").

- [ ] **Step 4: Implementar la rama en `route.ts`**

Imports arriba (junto a los de la rama de paquete):

```ts
import { reverseBookingPaymentInTx } from '@/lib/bookings/reverse-payment'
import { sendBookingDisputedToBusiness } from '@/lib/notifications'
import { formatBookingNumber } from '@/lib/bookings/number'
```

Insertar DESPUÉS del cierre de la rama de paquete (línea ~397, después del comentario "purchase ya no está active…") y ANTES de `// Ya está approved → idempotente`:

```ts
    // FU-B4b-3: chargeback/refund del pago YA APROBADO de una RESERVA. Igual que
    // la rama de paquete de arriba, hay que actuar ANTES del early-return approved.
    // Política (spec §1-2): la reserva NO cambia de status (la dueña decide); los
    // montos cobrables se restauran vía recalc y paymentStatus queda 'refunded'
    // como marcador. 'charged_back' = disputa → alarma; 'refunded' = devolución
    // voluntaria desde el panel de MP → silencioso.
    // Garantía de reconciliación por eco: si una reversión local falla a mitad,
    // MP re-entrega este evento y el flip CAS lo reintenta idempotente.
    if (
      (mpStatus === 'charged_back' || mpStatus === 'refunded') &&
      payment.bookingId &&
      payment.booking &&
      payment.status === 'approved'
    ) {
      const bookingId = payment.bookingId
      const mode = mpStatus === 'charged_back' ? 'chargeback' : 'voluntary'
      let reversed = false
      await prisma.$transaction(async (tx) => {
        const result = await reverseBookingPaymentInTx(tx, {
          paymentId: payment.id,
          bookingId,
          businessId: payment.businessId,
          customerId: payment.booking!.customerId,
          amount: mpPayment.transaction_amount,
          currency: payment.currency,
          mode,
          now: new Date(),
          flipData: { providerPaymentId: mpPayment.id, rawPayload: mpPayment as unknown as Prisma.InputJsonValue },
        })
        reversed = result.reversed
      })
      if (reversed && mode === 'chargeback') {
        // Datos para la alarma: un fetch fuera de la tx (best-effort como todas las notifs).
        const bk = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: {
            bookingNumber: true, startDateTime: true,
            customer: { select: { name: true } },
            service: { select: { name: true } },
            business: { select: { name: true, currency: true, timezone: true } },
          },
        })
        if (bk) {
          await sendMultiNotificationSafely('booking disputed business', async () =>
            sendBookingDisputedToBusiness(payment.businessId, {
              businessName: bk.business.name,
              customerName: bk.customer?.name ?? 'Clienta',
              serviceName: bk.service?.name ?? 'servicio',
              bookingLabel: formatBookingNumber(bk.bookingNumber, bookingId),
              startDateTime: bk.startDateTime,
              businessTimezone: bk.business.timezone || 'America/Santiago',
              amount: mpPayment.transaction_amount,
              businessCurrency: bk.business.currency || 'CLP',
            }),
          )
        }
      }
      if (reversed) {
        revalidatePath('/dashboard/bookings')
        if (payment.booking.customerId) revalidatePath(`/dashboard/customers/${payment.booking.customerId}`)
      }
      return NextResponse.json({
        success: true,
        message: mode === 'chargeback' ? 'Booking chargeback processed' : 'Booking refund processed',
        bookingId,
      })
    }
```

Verificar que `sendMultiNotificationSafely` y `revalidatePath` ya están importados (los usa la rama de paquete). Verificar la firma real de `formatBookingNumber` en `src/lib/bookings/number.ts:33` antes de llamarla.

- [ ] **Step 5: Correr — deben pasar.** Run: `npx vitest run tests/unit/mercado-pago-webhook-bookings-chargeback.test.ts tests/unit/mercado-pago-webhook-packages.test.ts tests/unit/mercado-pago-webhook.test.ts --project unit` → PASS (los 3 archivos: la rama nueva no puede romper los existentes).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhooks/mercado-pago/route.ts tests/unit/mercado-pago-webhook-bookings-chargeback.test.ts
git commit -m "feat(chargeback): rama de reservas post-approved en el webhook MP"
```

---

### Task 5: Guard anti-redelivery en la rama vieja del webhook

**Files:**
- Modify: `src/app/api/webhooks/mercado-pago/route.ts:570-580` (el re-check dentro de la rama rejected/cancelled/refunded/charged_back)
- Test: agregar casos a `tests/unit/mercado-pago-webhook-bookings-chargeback.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// 6. redelivery REAL end-to-end: Payment local ya 'refunded' (la rama nueva ya corrió),
//    llega otro webhook 'refunded' → 200 idempotente y:
//    - releaseRedemptionForBooking NO llamado
//    - reverseVisitPoints NO llamado
//    - payment.update NO llamado (no re-escribe estado)
// 7. la rama vieja SIGUE degradando un Payment 'pending' con mpStatus 'rejected'
//    → payment.update con status 'rejected' (comportamiento actual intacto)
```

(Mockear `@/lib/promotions/release` y `@/lib/loyalty/credit` por módulo, igual que hace `mercado-pago-webhook.test.ts` para los casos refunded existentes — mirar ese archivo.)

- [ ] **Step 2: Correr — el caso 6 debe fallar** (hoy la rama vieja actúa sobre `refunded`).

- [ ] **Step 3: Implementar el guard**

En `route.ts`, dentro de la rama vieja (~570), reemplazar:

```ts
      // No degradar un Payment ya approved
      // (validado arriba, pero por seguridad repetimos el check)
      const currentPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      })
      if (currentPayment?.status === 'approved') {
        return NextResponse.json({
          success: true,
          message: 'Payment already approved, not downgrading',
        })
      }
```

por:

```ts
      // Degradar es SOLO para pagos que nunca se aprobaron (pending, el único
      // estado no-terminal local: in_process de MP se guarda como pending).
      // Un redelivery de refunded/charged_back sobre un Payment que la rama de
      // reversión ya dejó 'refunded' caería acá y re-liberaría la redención que
      // esa rama deliberadamente conserva (spec §2, corrupción de promo) — por
      // eso el guard es por 'pending', no por 'approved'.
      const currentPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      })
      if (currentPayment?.status !== 'pending') {
        return NextResponse.json({
          success: true,
          message: 'Payment not pending, not downgrading',
        })
      }
```

- [ ] **Step 4: Correr TODOS los tests de webhook — deben pasar.**

Run: `npx vitest run tests/unit/mercado-pago-webhook-bookings-chargeback.test.ts tests/unit/mercado-pago-webhook-packages.test.ts tests/unit/mercado-pago-webhook.test.ts --project unit`
Expected: PASS. **Ojo:** si algún test existente de `mercado-pago-webhook.test.ts` asertaba la degradación sobre un Payment no-pending (p. ej. refunded pre-approval con mock en otro estado), revisar si el test describe un comportamiento que el spec cambió a propósito — ajustar el test citando el spec §2, NO revertir el guard.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/mercado-pago/route.ts tests/unit/mercado-pago-webhook-bookings-chargeback.test.ts tests/unit/mercado-pago-webhook.test.ts
git commit -m "fix(webhook): la rama de degradación solo actúa sobre Payment pending (anti-redelivery)"
```

---

### Task 6: Badge "Pago revertido" en las superficies de la dueña

**Files:**
- Modify: `src/lib/bookings/status-labels.ts` (helper compartido)
- Create: `src/components/dashboard/payment-reverted-badge.tsx`
- Modify: `src/app/dashboard/bookings/page.tsx` (card móvil ~línea 107 y celda de monto ~324)
- Modify: `src/components/dashboard/booking-drawer.tsx` (fila "Pagado" ~84)
- Test: `tests/unit/payment-reverted-badge.test.tsx` (nuevo)

- [ ] **Step 1: Test que falla**

```tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PaymentRevertedBadge } from '@/components/dashboard/payment-reverted-badge'

describe('PaymentRevertedBadge', () => {
  it('renderiza el badge con paymentStatus refunded', () => {
    const html = renderToStaticMarkup(<PaymentRevertedBadge paymentStatus="refunded" />)
    expect(html).toContain('Pago revertido')
  })
  it.each(['unpaid', 'deposit_paid', 'fully_paid', 'failed'])('NO renderiza con %s', (s) => {
    const html = renderToStaticMarkup(<PaymentRevertedBadge paymentStatus={s} />)
    expect(html).toBe('')
  })
})
```

- [ ] **Step 2: Correr — debe fallar.** Run: `npx vitest run tests/unit/payment-reverted-badge.test.tsx --project unit`

- [ ] **Step 3: Implementar**

`src/lib/bookings/status-labels.ts` — agregar al final (fuente única de label + clase):

```ts
// Marcador de pago revertido (chargeback o refund vía panel MP — spec FU-B4b-3 §4).
// El único writer de paymentStatus 'refunded' es la rama de reversión del webhook.
export const PAYMENT_REVERTED_LABEL = 'Pago revertido'
export const PAYMENT_REVERTED_BADGE_CLASS =
  'inline-flex w-fit items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800'
```

`src/components/dashboard/payment-reverted-badge.tsx`:

```tsx
import { PAYMENT_REVERTED_LABEL, PAYMENT_REVERTED_BADGE_CLASS } from '@/lib/bookings/status-labels'

/** Badge ADICIONAL (no reemplaza el status de la reserva) cuando el pago fue
 *  revertido por chargeback/refund de MP. Null para cualquier otro paymentStatus. */
export function PaymentRevertedBadge({ paymentStatus }: { paymentStatus: string }) {
  if (paymentStatus !== 'refunded') return null
  return <span className={PAYMENT_REVERTED_BADGE_CLASS}>{PAYMENT_REVERTED_LABEL}</span>
}
```

Usos (importar el componente en cada archivo):

1. `src/app/dashboard/bookings/page.tsx` card móvil (~107-110) — debajo de la línea del monto:

```tsx
        <div className="flex items-center gap-3 text-sm">
          <CreditCard className="size-4 text-muted-foreground" />
          <span className={booking.paymentStatus === 'fully_paid' ? 'text-green-700' : 'text-primary'}>
            ${booking.depositPaid.toLocaleString('es-CL')} de ${booking.finalAmount.toLocaleString('es-CL')}
          </span>
          <PaymentRevertedBadge paymentStatus={booking.paymentStatus} />
        </div>
```

2. Misma página, celda de monto de la tabla (~323-332) — después del div de saldo:

```tsx
                      <TableCell className={`${TABLE_COL.money} whitespace-normal`}>
                        <span className={booking.paymentStatus === 'fully_paid' ? 'font-semibold text-green-700' : 'font-semibold text-primary'}>
                          ${booking.depositPaid.toLocaleString('es-CL')} / ${booking.finalAmount.toLocaleString('es-CL')}
                        </span>
                        {booking.remainingBalance > 0 && (
                          <div className="text-xs text-muted-foreground">
                            Saldo: ${booking.remainingBalance.toLocaleString('es-CL')}
                          </div>
                        )}
                        <PaymentRevertedBadge paymentStatus={booking.paymentStatus} />
                      </TableCell>
```

3. `src/components/dashboard/booking-drawer.tsx` — la fila "Pagado" (~83-88):

```tsx
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Pagado</span>
            <span className="flex items-center gap-2 text-sm font-medium">
              <PaymentRevertedBadge paymentStatus={booking.paymentStatus} />
              ${booking.depositPaid.toLocaleString('es-CL')} {businessCurrency}
            </span>
          </div>
```

**Verificar** que el tipo `booking` de cada superficie ya trae `paymentStatus` (la card y la tabla lo usan hoy para el color, así que sí; en el drawer chequear el tipo de la prop — si no lo trae, agregarlo al tipo y confirmar que el caller lo pasa).

- [ ] **Step 4: Correr — debe pasar.** También `npx vitest run tests/unit --project unit -t "booking"` para no romper tests de las superficies tocadas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookings/status-labels.ts src/components/dashboard/payment-reverted-badge.tsx src/app/dashboard/bookings/page.tsx src/components/dashboard/booking-drawer.tsx tests/unit/payment-reverted-badge.test.tsx
git commit -m "feat(chargeback): badge 'Pago revertido' en tabla, card y drawer"
```

---

### Task 7: Fix zombie del panel + declarar con hold vencido

**Files:**
- Modify: `src/lib/bank-transfer/declared.ts:140-151` (`pendingPackageTransferWhere`)
- Modify: `src/app/dashboard/page.tsx:39` y `src/server/actions/packages.ts:228` (callers)
- Modify: `src/server/actions/packages-checkout.ts:321-323` (`declarePackageTransfer`)
- Test: `tests/integration/packages.transfer.integration.test.ts` (casos nuevos)

- [ ] **Step 1: Tests que fallan** (en el archivo de integración existente — reusa su seed; requiere Docker `agendita-test-pg`):

```ts
  it('declarePackageTransfer acepta declarar con hold VENCIDO mientras siga pending (fix zombie lado clienta)', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { purchaseId } = await createPackagePurchase({
      packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
    })
    // Vencer el hold a mano (el sweep todavía no corrió).
    await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { holdExpiresAt: new Date('2026-01-01T00:00:00Z') } })
    await declarePackageTransfer({ purchaseId }) // NO debe tirar
    const pay = await prisma.payment.findFirst({ where: { packagePurchaseId: purchaseId } })
    expect(pay!.status).toBe('pending')
  })

  it('getPendingPackageTransfers muestra una declarada con hold VENCIDO (fix zombie lado dueña)', async () => {
    const { createPackagePurchase, declarePackageTransfer } = await import('@/server/actions/packages-checkout')
    const { getPendingPackageTransfers } = await import('@/server/actions/packages')
    const { purchaseId } = await createPackagePurchase({
      packageProductId: productId, name: 'Cli Xfer', phone: '+56900000009', acceptedTerms: true, method: 'transfer',
    })
    await declarePackageTransfer({ purchaseId })
    await prisma.packagePurchase.update({ where: { id: purchaseId }, data: { holdExpiresAt: new Date('2026-01-01T00:00:00Z') } })
    const list = await getPendingPackageTransfers()
    expect(list.map((p: { id: string }) => p.id)).toContain(purchaseId)
  })
```

(Chequear la firma real de `getPendingPackageTransfers` — si toma argumentos o deriva el negocio del mock de `requireBusinessRole` del archivo; adaptar la llamada al patrón del archivo.)

- [ ] **Step 2: Correr — deben fallar.** Run: `npx vitest run tests/integration/packages.transfer.integration.test.ts --project integration` → los 2 casos nuevos FAIL (throw de hold vencido; lista vacía).

- [ ] **Step 3: Implementar**

`declared.ts` — `pendingPackageTransferWhere` pierde `holdExpiresAt` y `now`:

```ts
/** "Compra de paquete con una transferencia declarada pendiente de verificar."
 *  Fuente única del predicado que usan la lista de la dueña (getPendingPackageTransfers)
 *  y el contador del home. Pinnea el prefijo bt-pkg-declared (via declaredPkgTransferPaymentWhere),
 *  así un pago manual registrado por otra vía no cuenta como transferencia por verificar.
 *  SIN filtro de hold a propósito (fix zombie): el sweep exime a las declaradas de
 *  expirar (la plata pudo enviarse), así que una declarada con hold vencido debe
 *  seguir visible hasta que la dueña confirme o rechace — filtrarla la dejaba
 *  pending invisible para siempre. */
export function pendingPackageTransferWhere(businessId: string): Prisma.PackagePurchaseWhereInput {
  return {
    businessId,
    status: 'pending',
    source: 'online',
    payments: { some: declaredPkgTransferPaymentWhere },
  }
}
```

Callers: en `src/app/dashboard/page.tsx:39` → `pendingPackageTransferWhere(business.id)`; en `src/server/actions/packages.ts:228` → `pendingPackageTransferWhere(businessId)` (y borrar el `now` que quede huérfano si ya no se usa en esa función — verificar con grep antes de borrar).

`packages-checkout.ts` — en `declarePackageTransfer`, borrar las líneas 321-323:

```ts
  const purchase = await loadOwnedPurchase(input.purchaseId, user.id)
  if (purchase.status !== 'pending') throw new Error('Esta compra ya fue procesada.')
  // SIN check de hold a propósito (fix zombie, spec §5): la plata pudo enviarse
  // aunque el hold venciera y acá no hay cupo en juego. La ventana la cierra el
  // sweep: cuando expira la compra no-declarada, el guard de status de arriba
  // rechaza. Una vez declarada, el sweep la exime y la dueña decide.
```

- [ ] **Step 4: Correr — deben pasar** (el archivo completo de integración, no solo los casos nuevos).

Run: `npx vitest run tests/integration/packages.transfer.integration.test.ts --project integration`
Expected: PASS completo (el caso existente del sweep sigue verde: el sweep no usa este predicado).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bank-transfer/declared.ts src/app/dashboard/page.tsx src/server/actions/packages.ts src/server/actions/packages-checkout.ts tests/integration/packages.transfer.integration.test.ts
git commit -m "fix(packages): transferencias declaradas con hold vencido — visibles para la dueña y declarables por la clienta"
```

---

### Task 8: Pago manual en reservas `completed` con saldo

**Files:**
- Modify: `src/server/actions/payments.ts:385-390` (`createManualPayment`) y el pase de `allowCompleted` a `applyApprovedPayment` (~431-442)
- Modify: `src/components/dashboard/manual-payment-utils.ts:26-31` (`isManualPaymentAllowed`)
- Test: `tests/unit/manual-payment-utils.test.ts` o el archivo de tests existente de esos utils (buscarlo con `grep -rl isManualPaymentAllowed tests/`); casos server en el archivo de tests existente de `createManualPayment` (buscar `grep -rl createManualPayment tests/unit/`)

- [ ] **Step 1: Tests que fallan**

Util (agregar al archivo de tests del util, o crear `tests/unit/manual-payment-utils.test.ts`):

```ts
  it('permite completed con saldo (recobro post-chargeback)', () => {
    expect(isManualPaymentAllowed({ status: 'completed', remainingBalance: 8000 })).toBe(true)
  })
  it('sigue rechazando completed sin saldo y estados muertos', () => {
    expect(isManualPaymentAllowed({ status: 'completed', remainingBalance: 0 })).toBe(false)
    expect(isManualPaymentAllowed({ status: 'cancelled', remainingBalance: 8000 })).toBe(false)
    expect(isManualPaymentAllowed({ status: 'expired', remainingBalance: 8000 })).toBe(false)
  })
```

Server (en el archivo de tests de `createManualPayment`, siguiendo su andamiaje de mocks): un caso donde el booking mockeado es `status: 'completed'` con `remainingBalance: 8000` → `createManualPayment` NO tira y llega a `applyApprovedPayment` con `allowCompleted: true`.

- [ ] **Step 2: Correr — deben fallar.**

- [ ] **Step 3: Implementar**

`manual-payment-utils.ts`:

```ts
export function isManualPaymentAllowed(booking: Pick<ManualPaymentBooking, 'status' | 'remainingBalance'>) {
  return (
    booking.remainingBalance > 0 &&
    // completed entra SOLO con saldo: recobro post-chargeback (spec FU-B4b-3 §6)
    // y saldo pendiente después de atender — mismo criterio que el saldo por
    // transferencia (allowCompleted).
    (booking.status === 'pending_payment' || booking.status === 'confirmed' || booking.status === 'completed')
  )
}
```

`payments.ts` — en `createManualPayment`:

```ts
  const { assertBookingPayable } = await import('@/lib/booking-payments')
  try {
    // allowCompleted: recobro post-chargeback y cobro de saldo tras atender
    // (spec FU-B4b-3 §6) — el guard de monto de abajo (remainingBalance) sigue
    // siendo el gate real: completed sin saldo rechaza igual.
    assertBookingPayable(booking, { allowCompleted: true })
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'No se puede registrar pago para esta reserva')
  }
```

Y en la llamada a `applyApprovedPayment` dentro de la tx (~431), agregar `allowCompleted: true` al objeto de argumentos (el input ya tiene el campo — `ApplyApprovedPaymentInput.allowCompleted`, usado por bank-transfer-verify).

**Verificar** `deriveManualPaymentType` (`src/lib/payments/derive-payment-type.ts`): confirmar que deriva por montos (depositPaid/remainingBalance) y no rechaza por status — si tiene un guard de status, el test del server lo va a delatar; ajustar ahí también con el mismo criterio.

- [ ] **Step 4: Correr — deben pasar** (los archivos tocados + `npx vitest run tests/unit --project unit -t "manual"`).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/payments.ts src/components/dashboard/manual-payment-utils.ts tests/unit/<archivos-de-test-tocados>
git commit -m "feat(chargeback): registrar pago manual en reservas completed con saldo (recobro)"
```

---

### Task 9: Guard de loyalty al completar una reserva con pago revertido

**Files:**
- Modify: `src/server/actions/bookings.ts` — bloque de completado en la tx (~513-533) y gate del bloque R-EMIT (~541)
- Test: el archivo de tests existente de `updateBookingStatus` (buscar `grep -rln "updateBookingStatus" tests/unit/` — probablemente `tests/unit/booking-status*.test.ts` o similar); agregar casos con su andamiaje

- [ ] **Step 1: Tests que fallan** (con el andamiaje del archivo existente; el booking mockeado en `findFirst` lleva `paymentStatus: 'refunded'`):

```ts
// 1. completar con paymentStatus 'refunded': creditVisitPoints NO llamado,
//    emitAutomaticReward / rewardReferralOnCompletion NO llamados,
//    la transición de status SÍ ocurre (updateMany llamado con status completed).
// 2. completar con paymentStatus 'deposit_paid' (control): creditVisitPoints SÍ llamado
//    (comportamiento actual intacto — probablemente ya exista este test; si existe, no duplicar).
```

- [ ] **Step 2: Correr — el caso 1 debe fallar** (hoy acredita igual).

- [ ] **Step 3: Implementar**

En `updateBookingStatus`, el bloque dentro de la tx (~513):

```ts
    if (res.count > 0 && status === BookingStatus.completed && existing.customerId) {
      // …(marca first/lastCompletedAt: SIN cambios, eso no es loyalty)…
      // Pago revertido (chargeback/refund MP, spec FU-B4b-3 §7): completar está
      // permitido ("atender igual"), pero NO se acreditan puntos por una visita
      // cuya plata se fue. Si la clienta re-paga antes, el recalc ya limpió el
      // marcador y esto no gatea.
      if (loyaltyConfig?.isActive && existing.paymentStatus !== 'refunded') {
        await creditVisitPoints(tx, {
          businessId,
          customerId: existing.customerId,
          finalAmount: existing.finalAmount,
          bookingId: id,
          config: loyaltyConfig,
        })
      }
    }
```

Y el gate del bloque R-EMIT (~541):

```ts
  if (
    status === BookingStatus.completed &&
    existing.customerId &&
    loyaltyConfig?.isActive &&
    existing.paymentStatus !== 'refunded' // spec FU-B4b-3 §7: sin emisiones sobre visita contracargada
  ) {
```

(`existing` es el booking completo del `findFirst` de la línea ~461 — ya trae `paymentStatus`.)

- [ ] **Step 4: Correr — deben pasar** (archivo tocado completo + `npx vitest run tests/unit --project unit -t "loyalty"`).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/bookings.ts tests/unit/<archivo-de-test-tocado>
git commit -m "feat(chargeback): completar con pago revertido no acredita loyalty"
```

---

### Task 10: Test de integración end-to-end (Docker PG)

**Files:**
- Create: `tests/integration/booking-chargeback.integration.test.ts`

- [ ] **Step 1: Escribir el test** (andamiaje calcado de `tests/integration/packages.transfer.integration.test.ts`: `requireTestDatabase()`, seed en `beforeAll`, cleanup en `afterAll` en orden FK-safe — ledgerEntry → loyaltyLedger → payment → booking → service → customer → loyaltyConfig → business → user):

Escenario (spec §Testing):

```ts
// Seed: business + LoyaltyConfig activa (pointsPerVisit: 10, clawbackAutoRewardOnRefund: true)
//   + customer + service + booking COMPLETED (finalAmount 10000, depositPaid 10000,
//   remainingBalance 0, paymentStatus fully_paid) + Payment mercado_pago 'approved'
//   (amount 10000) + earn de puntos real vía creditVisitPoints dentro de una tx
//   (o sembrar la fila LoyaltyLedger reason 'visit' directa con los mismos campos
//   que escribe creditVisitPoints — mirar credit.ts).
//
// Acción: prisma.$transaction(tx => reverseBookingPaymentInTx(tx, {
//   paymentId, bookingId, businessId, customerId, amount: 10000, currency: 'CLP',
//   mode: 'chargeback', now: new Date() }))
//
// Asserts:
//   - payment.status === 'refunded'
//   - booking: paymentStatus 'refunded', status 'completed' INTACTO,
//     depositPaid 0, remainingBalance 10000 (montos restaurados)
//   - LedgerEntry refund_issued/expense con bookingId y paymentId null existe
//   - LoyaltyLedger tiene la fila 'visit_reversal' con puntos negativos (neto 0)
//   - SEGUNDA corrida del núcleo → { reversed: false } y ningún asiento/ledger duplicado
//
// Recobro (spec §6): prisma.$transaction(tx => applyApprovedPayment({ tx, bookingId,
//   businessId, amount: 10000, currency: 'CLP', provider: 'manual',
//   providerPaymentId: null, paymentType: <el que derive: 'full_payment'>,
//   allowCompleted: true }))
//   → booking.paymentStatus vuelve a 'fully_paid' (recalc limpió el marcador),
//     remainingBalance 0.
```

- [ ] **Step 2: Correr contra el Docker PG**

Run: `npx vitest run tests/integration/booking-chargeback.integration.test.ts --project integration`
Expected: PASS. (Si el contenedor no está arriba: `docker start agendita-test-pg`. Si faltan columnas en la DB de test, verificar columnas reales ANTES de cualquier `migrate resolve` — landmine conocida.)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/booking-chargeback.integration.test.ts
git commit -m "test(chargeback): integración end-to-end reserva completada + recobro"
```

---

### Task 11: Gate final del PR

**Files:** ninguno nuevo (correcciones que surjan).

- [ ] **Step 1: Suite unit completa.** Run: `npx vitest run --project unit` → verde (fallo conocido flaky: `availability-editor.test.tsx` a veces falla bajo carga — re-correr aislado antes de culpar a la rama).
- [ ] **Step 2: Integración completa.** Run: `npx vitest run --project integration` → verde (Docker arriba).
- [ ] **Step 3: Types.** Run: `npx prisma generate && npx tsc --noEmit | grep '^src/'` → **0 errores en src/** (y revisar que tests/ tampoco sume errores nuevos: `npx tsc --noEmit | head -30`).
- [ ] **Step 4: Lint.** Run: `npx eslint src tests --max-warnings=0 || npx eslint src tests` → 0 warnings NUEVOS respecto de main (comparar si hay preexistentes).
- [ ] **Step 5: `/simplify`** (4 ángulos) sobre el diff de la rama; aplicar lo que corresponda.
- [ ] **Step 6: Code review 5-finders con verificación adversarial** sobre el diff completo; corregir hallazgos reales y re-correr los gates afectados.
- [ ] **Step 7: PR** — título `fix(payments): follow-ups B4b-3 — chargeback de reservas + panel zombie + recobro`; cuerpo con: qué incluye (§1-7 del spec), notas de diseño (flip CAS = idempotencia, redención NO liberada, guard pending en rama vieja), testing, y fuera de alcance (los 7 ítems del spec). **SIN auto-merge — mergear SOLO con OK explícito del usuario.**

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura del spec:** §1→T1+T2, §2→T4+T5, §3→T3, §4(badge)→T6, §5(zombie+declare)→T7, §6(recobro)→T8, §7(loyalty guard)→T9, §Testing integración→T10, comentario del eco→incluido en el bloque de T4. Los "fuera de alcance" no requieren tasks.
- **Sin placeholders:** cada step con código o comando concreto; donde el andamiaje depende de un archivo existente (mocks del webhook, tests de updateBookingStatus), el step manda a copiar el patrón del archivo nombrado — decisión deliberada, no un TBD.
- **Consistencia de tipos:** `reverseBookingPaymentInTx(tx, opts)` con `mode`/`flipData` idéntico entre T2 (definición), T4 (webhook) y T10 (integración); `recalcBookingFromPayments(tx, bookingId, opts?)` idéntico entre T1 y T2; `BookingDisputedEmailData` idéntico entre T3 y T4.
