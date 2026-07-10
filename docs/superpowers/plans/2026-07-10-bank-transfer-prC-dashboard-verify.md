# Bank Transfer PR C — Dashboard verification + cron + cancel fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the business owner verify or reject a customer-declared bank transfer from the dashboard, keep the cron/cancel paths from orphaning the declared Payment, and surface "N por verificar" so a `verifyHours = null` config can't silently freeze slots.

**Architecture:** Two new session-authenticated server actions (`confirmBankTransfer`, `rejectBankTransfer`) in a new `'use server'` module, reusing the shared `declared.ts` helpers and `applyApprovedPayment`. `cancelBooking` and the `expireStaleHolds` cron gain a step that closes the orphan declared Payment. Dashboard grows a "Transferencias por verificar" section (Reservas page) and a home banner, both driven by `getBookings` now including the declared Payment via a narrow filtered relation. Two new best-effort customer emails (rejected, expired).

**Tech Stack:** Next.js App Router (custom fork — read `node_modules/next/dist/docs/` before touching framework APIs), Prisma/Postgres, React 19 server+client components, Vitest (unit + integration against Dockerized Postgres on port 5433), Resend emails.

---

## Landmines to respect (verified this session)

1. **`'use server'` export boundary** — the new actions module exports ONLY async functions. No schemas/consts/types exported from it (`business-settings.ts:15-16` precedent). Reuse the existing consts in `src/lib/bank-transfer/declared.ts`.
2. **tsc is NOT run by vitest/eslint** — before ANY push run `npx tsc --noEmit 2>&1 | grep -E '^src/'` (0 lines = build passes; `tests/**` errors are pre-existing Prisma-client drift and don't break `next build`). This broke PR B's CI `build` job.
3. **Reuse `declared.ts`, don't re-write the trio** — `declaredTransferPaymentWhere` (where-fragment), `isDeclaredTransferPayment` (in-memory predicate), `btDeclaredId`, `BANK_TRANSFER_METHOD`. Never hand-write `provider:'manual' + status:'pending' + startsWith('bt-declared:')` again.
4. **Guarded mutations only** — every status transition uses `updateMany` + status guard inside a `$transaction` (the cron runs in parallel). Never blind `update`.
5. **`revalidateBusinessPublicPaths` must be awaited** (exit-128 landmine).
6. **git in worktrees** — `git -C <worktree>` + explicit `git add <files>`, never `-A`.

## Test infra (local)

- Docker Postgres container `agendita-test-pg` (postgres:15) on **port 5433**. Start if down:
  `docker start agendita-test-pg` (already created this session).
- Integration: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- --config vitest.integration.config.ts`
- Unit/component: `npm test`
- Prisma against shared DB needs env: `set -a; source /Users/robertozamorautrera/Projects/agendita/.env.local; set +a` (this worktree has no `.env`).

## Existing anchors (exact, verified)

- `src/lib/bank-transfer/declared.ts` — shared helpers (see landmine 3).
- `src/server/services/finance.ts:90` `applyApprovedPayment({tx, bookingId, businessId, amount, currency, provider, providerPaymentId, paymentType, paymentMethod, paymentId})` — reuses/approves an existing Payment by `paymentId` but demands EXACT amount/provider/providerPaymentId/paymentType match (`finance.ts:137-148`); calls `assertBookingPayable` (throws on `pending_payment` + expired hold).
- `src/lib/booking-payments.ts` `assertBookingPayable({status, holdExpiresAt})`.
- `src/lib/payments/derive-payment-type.ts` `deriveManualPaymentType(booking, amount)`.
- `src/lib/availability/validation.ts:37` `assertSlotIsAvailable({tx, businessId, serviceId, startDateTime, endDateTime, timezone, excludeBookingId?, leadTimeMinutes?})`.
- `src/server/actions/bookings.ts:178` `getBookings()` (include: service, customer — NO payments); `:1008` `cancelBooking(bookingId, reason?)`.
- `src/lib/cron/expire-holds.ts:15` `expireStaleHolds(now, db)`; route `src/app/api/cron/expire-holds/route.ts`.
- `src/lib/promotions/release.ts` `releaseRedemptionForBooking(tx, bookingId, reason)`.
- `src/lib/notifications/` — `index.ts` barrel; `sendNotificationSafely(label, fn)`; `getBusinessReplyToEmail(businessId)`; templates paired `...Html`/`...Text`; types in `types.ts`.
- `src/components/dashboard/manual-payment-dialog.tsx` — existing manual-pay UI (do NOT overload; build a focused verify dialog — see Task 7 rationale).
- `src/components/ui/status-badge.tsx` — `StatusBadge`, `STATUS_MAPS`.
- `src/components/dashboard/service-fit-warnings.tsx` — server-safe banner pattern to mirror.
- `src/lib/notifications/whatsapp.ts` `buildWhatsappUrl(phone, message)`.
- `src/app/dashboard/bookings/page.tsx` (insert section between stat grid end ~L205 and table conditional ~L207); `src/app/dashboard/page.tsx` (home; Promise.all data fetch ~L30-36, content wrapper ~L73).

---

## Task 1: `getBookings` includes the declared Payment (narrow, filtered relation)

Enables both the dashboard section and the derived "por verificar" badge without a second query. The filtered relation returns an array that is non-empty ONLY when the booking has a pending declared transfer.

**Files:**
- Modify: `src/server/actions/bookings.ts:178-188`
- Test: `tests/integration/bank-transfer-verify.test.ts` (new file, shared by Tasks 1-5)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/bank-transfer-verify.test.ts`. Add a helper to seed a declared transfer (business + service + customer + booking `pending_payment` with `paymentMethod:'bank_transfer'` + Payment `manual/pending/deposit` with `providerPaymentId = btDeclaredId(bookingId)`), mirroring the seed style of `tests/integration/bank-transfer-public.test.ts`. First test:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { btDeclaredId } from '@/lib/bank-transfer/declared'
// ... reuse the auth mock pattern from bank-transfer-public.test.ts / packages-actions.test.ts
// so requireBusiness()/requireBusinessRole() resolve to the seeded businessId.

describe('getBookings includes declared transfer payment', () => {
  it('returns the pending bt-declared payment on the booking, empty for others', async () => {
    const { businessId, bookingId } = await seedDeclaredTransfer()
    const { getBookings } = await import('@/server/actions/bookings')
    const bookings = await getBookings()
    const target = bookings.find((b) => b.id === bookingId)!
    expect(target.payments).toHaveLength(1)
    expect(target.payments[0].providerPaymentId).toBe(btDeclaredId(bookingId))
    expect(target.payments[0].amount).toBeGreaterThan(0)
    expect(target.payments[0].createdAt).toBeInstanceOf(Date)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- --config vitest.integration.config.ts -t "getBookings includes declared"`
Expected: FAIL — `Property 'payments' does not exist` / undefined.

- [ ] **Step 3: Implement**

Edit `getBookings` to add a filtered payments relation:

```ts
import { declaredTransferPaymentWhere } from '@/lib/bank-transfer/declared'

export async function getBookings() {
  const { businessId } = await requireBusiness()
  return prisma.booking.findMany({
    where: { businessId },
    orderBy: { startDateTime: 'desc' },
    include: {
      service: true,
      customer: true,
      // Solo la declaración de transferencia pendiente (bt-declared). El array
      // queda vacío salvo que haya una por verificar → deriva el badge y la
      // sección del dashboard sin segunda query.
      payments: {
        where: declaredTransferPaymentWhere,
        select: { id: true, amount: true, createdAt: true, providerPaymentId: true },
      },
    },
  })
}
```

- [ ] **Step 4: Run to verify it passes** — same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/server/actions/bookings.ts tests/integration/bank-transfer-verify.test.ts
git -C <worktree> commit -m "feat(bank-transfer): getBookings incluye el pago bt-declared (relación filtrada)"
```

---

## Task 2: Customer emails — rejected + expired

Best-effort, single-recipient (`sendNotificationSafely`). Mirror `sendBookingCancelledNotification` / `sendBookingConfirmationToCustomer`.

**Files:**
- Modify: `src/lib/notifications/types.ts` (add two interfaces)
- Modify: `src/lib/notifications/templates.ts` (add 2× paired html/text)
- Modify: `src/lib/notifications/email-provider.ts` (add 2 senders)
- Modify: `src/lib/notifications/index.ts` (export new senders + templates)
- Test: `tests/notifications/bank-transfer-verify-emails.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  bankTransferRejectedCustomerHtml, bankTransferRejectedCustomerText,
  bankTransferExpiredCustomerHtml, bankTransferExpiredCustomerText,
} from '@/lib/notifications/templates'

const base = {
  businessName: 'Studio Bella', businessTimezone: 'America/Santiago',
  customerName: 'Ana', serviceName: 'Corte', startDateTime: new Date('2026-07-15T14:00:00Z'),
  bookingNumber: 4738 as number | null,
}

describe('bank transfer verify emails', () => {
  it('rejected mentions the reason and contacting the business', () => {
    const html = bankTransferRejectedCustomerHtml(base)
    expect(html).toContain('Ana')
    expect(html).toContain('no pudo verificar')
    expect(bankTransferRejectedCustomerText(base)).toContain('Corte')
  })
  it('expired tells the customer the hold lapsed', () => {
    const html = bankTransferExpiredCustomerHtml(base)
    expect(html).toContain('expiró')
    expect(bankTransferExpiredCustomerText(base)).toContain('Studio Bella')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/notifications/bank-transfer-verify-emails.test.ts`
Expected: FAIL — templates not exported.

- [ ] **Step 3: Implement**

In `types.ts`, add (reuse the `BankTransferDeclaredEmailData` shape minus amount):

```ts
export interface BankTransferVerifyCustomerEmailData {
  businessName: string
  businessTimezone: string
  customerName: string
  serviceName: string
  startDateTime: Date
  bookingNumber?: number | null
  customerEmail?: string
  businessReplyToEmail?: string | null
}
```

In `templates.ts`, add paired functions (mirror `bankTransferDeclaredBusinessHtml` structure + `bookingCancelledCustomerHtml`):

```ts
export function bankTransferRejectedCustomerHtml(data: BankTransferVerifyCustomerEmailData): string {
  return baseHtml(`
    ${header('Tu transferencia no pudo verificarse')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, ${escapeHtml(data.businessName)} no pudo verificar tu transferencia y tu reserva fue cancelada.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${fmtDate(data.startDateTime, data.businessTimezone)}</td></tr>
    </table>
    <p style="margin-top:16px;font-size:14px">Si transferiste, contactá directamente al negocio para resolverlo.</p>
    ${footer(data.businessName)}
  `)
}
export function bankTransferRejectedCustomerText(data: BankTransferVerifyCustomerEmailData): string {
  return `Hola ${data.customerName}, ${data.businessName} no pudo verificar tu transferencia y tu reserva (${data.serviceName}, ${fmtDate(data.startDateTime, data.businessTimezone)}) fue cancelada. Si transferiste, contactá al negocio directamente.`
}
export function bankTransferExpiredCustomerHtml(data: BankTransferVerifyCustomerEmailData): string {
  return baseHtml(`
    ${header('Tu reserva expiró')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, tu reserva en ${escapeHtml(data.businessName)} expiró porque no se verificó el pago a tiempo.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${fmtDate(data.startDateTime, data.businessTimezone)}</td></tr>
    </table>
    <p style="margin-top:16px;font-size:14px">Si transferiste, contactá al negocio directamente. Si no, podés reservar de nuevo cuando quieras.</p>
    ${footer(data.businessName)}
  `)
}
export function bankTransferExpiredCustomerText(data: BankTransferVerifyCustomerEmailData): string {
  return `Hola ${data.customerName}, tu reserva en ${data.businessName} (${data.serviceName}, ${fmtDate(data.startDateTime, data.businessTimezone)}) expiró porque no se verificó el pago a tiempo. Si transferiste, contactá al negocio.`
}
```

Import `BankTransferVerifyCustomerEmailData` at the top of `templates.ts` alongside the other type imports.

In `email-provider.ts`, add the two senders (mirror `sendBookingConfirmationToCustomer`):

```ts
export async function sendBankTransferRejectedToCustomer(data: BankTransferVerifyCustomerEmailData): Promise<EmailResult> {
  if (!data.customerEmail) return { success: false, skipped: 'Cliente sin email' }
  return sendEmail(
    data.customerEmail,
    `Tu transferencia no pudo verificarse - ${data.businessName}`,
    bankTransferRejectedCustomerHtml(data),
    bankTransferRejectedCustomerText(data),
    { replyTo: data.businessReplyToEmail },
  )
}
export async function sendBankTransferExpiredToCustomer(data: BankTransferVerifyCustomerEmailData): Promise<EmailResult> {
  if (!data.customerEmail) return { success: false, skipped: 'Cliente sin email' }
  return sendEmail(
    data.customerEmail,
    `Tu reserva expiró - ${data.businessName}`,
    bankTransferExpiredCustomerHtml(data),
    bankTransferExpiredCustomerText(data),
    { replyTo: data.businessReplyToEmail },
  )
}
```

Import the templates + type in `email-provider.ts`. Export the two senders (and the two template pairs if not re-exported via `*`) from `index.ts`.

- [ ] **Step 4: Run to verify it passes** — `npm test -- tests/notifications/bank-transfer-verify-emails.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/lib/notifications/ tests/notifications/bank-transfer-verify-emails.test.ts
git -C <worktree> commit -m "feat(bank-transfer): emails de transferencia rechazada y expirada (best-effort)"
```

---

## Task 3: `confirmBankTransfer(paymentId, amount)` action

New session-authenticated `'use server'` module. Implements spec §6.2 verify flow in one tx: guards → optional slot re-check + hold bump → update Payment amount/type → `applyApprovedPayment`.

**Files:**
- Create: `src/server/actions/bank-transfer-verify.ts`
- Test: `tests/integration/bank-transfer-verify.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to the integration file:

```ts
describe('confirmBankTransfer', () => {
  it('approves with an edited amount, confirms the booking, cancels no slot', async () => {
    const { paymentId, bookingId } = await seedDeclaredTransfer({ depositRequired: 10000 })
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await confirmBankTransfer(paymentId, 8000) // edited down
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(payment!.status).toBe('approved')
    expect(payment!.amount).toBe(8000)
    expect(booking!.status).toBe('confirmed')
    expect(booking!.depositPaid).toBe(8000)
  })

  it('rejects when the booking already has an approved payment (double pay)', async () => {
    const { paymentId, bookingId } = await seedDeclaredTransfer()
    await prisma.payment.create({ data: { /* an approved MP payment on the same booking */ } })
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await expect(confirmBankTransfer(paymentId, 5000)).rejects.toThrow(/ya tiene el abono/)
  })

  it('errors on an expired booking (terminal)', async () => {
    const { paymentId, bookingId } = await seedDeclaredTransfer()
    await prisma.booking.update({ where: { id: bookingId }, data: { status: 'expired' } })
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await expect(confirmBankTransfer(paymentId, 5000)).rejects.toThrow(/expiró|cancel/)
  })

  it('errors when hold expired and the slot was re-taken by another booking', async () => {
    const { paymentId, bookingId, businessId, serviceId, startDateTime, endDateTime } =
      await seedDeclaredTransfer()
    await prisma.booking.update({ where: { id: bookingId }, data: { holdExpiresAt: new Date(Date.now() - 3600_000) } })
    // seed a confirmed booking occupying the same slot
    await seedConfirmedBooking({ businessId, serviceId, startDateTime, endDateTime })
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await expect(confirmBankTransfer(paymentId, 5000)).rejects.toThrow(/horario|disponible/)
  })
})
```

(Fill the double-pay approved-payment `data` from the seed helper's booking/business/customer ids: `provider:'mercado_pago', status:'approved', paymentType:'deposit', amount, currency:'CLP', providerPaymentId:'mp-x'`.)

- [ ] **Step 2: Run to verify it fails** — integration command with `-t confirmBankTransfer`. Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
'use server'

import { addHours } from 'date-fns'
import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server' // VERIFIED: bookings.ts:10 imports from here (NOT @/lib/auth/guards)
import { revalidatePath } from 'next/cache'
import { revalidateBusinessPublicPaths } from '@/server/actions/revalidate-business'
import { isDeclaredTransferPayment } from '@/lib/bank-transfer/declared'
import { deriveManualPaymentType } from '@/lib/payments/derive-payment-type'
import { assertSlotIsAvailable } from '@/lib/availability/validation'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
// applyApprovedPayment se importa dinámicamente dentro de la tx (convención del
// repo: payments.ts:428, bookings.ts:963 — todas las server actions lo hacen así).
import {
  sendNotificationSafely, sendBookingConfirmedNotification,
  sendBankTransferRejectedToCustomer, getBusinessReplyToEmail,
} from '@/lib/notifications'

// NOTE: 'use server' — SOLO funciones async. Flujo DUEÑA: requiere sesión
// (owner/admin). Reusa los helpers de declared.ts y applyApprovedPayment.

export async function confirmBankTransfer(paymentId: string, amount: number): Promise<{ ok: true }> {
  const { business, businessId } = await requireBusinessRole(['owner', 'admin'])
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto debe ser positivo')

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!payment || payment.businessId !== businessId) throw new Error('Pago no encontrado')
    if (!isDeclaredTransferPayment(payment)) throw new Error('Este pago no es una transferencia por verificar')

    const booking = await tx.booking.findUnique({ where: { id: payment.bookingId } })
    if (!booking) throw new Error('Reserva no encontrada')
    if (booking.status === 'expired' || booking.status === 'cancelled') {
      throw new Error('Esta reserva expiró o fue cancelada. Registrá el pago creando la reserva de nuevo desde el calendario.')
    }

    // Doble cobro: pagó MP después de declarar.
    const approved = await tx.payment.findFirst({ where: { bookingId: booking.id, status: 'approved' } })
    if (approved) throw new Error('Esta reserva ya tiene el abono pagado.')

    if (amount > booking.remainingBalance) throw new Error('El monto excede el saldo pendiente')

    const now = new Date()
    const holdExpired = booking.holdExpiresAt != null && booking.holdExpiresAt < now
    if (holdExpired) {
      // Re-validar solape SOLO si el turno es FUTURO: con el hold vencido
      // availability volvió a ofertar ese horario y otra clienta pudo tomarlo
      // (§6.2 paso 2). Un turno ya pasado no tiene conflicto de cupo que
      // prevenir y assertSlotIsAvailable lo rechazaría por lead-time — falso
      // negativo que bloquearía registrar un pago legítimo el mismo día.
      if (booking.startDateTime > now) {
        await assertSlotIsAvailable({
          tx, businessId, serviceId: booking.serviceId,
          startDateTime: booking.startDateTime, endDateTime: booking.endDateTime,
          timezone: business.timezone || 'America/Santiago',
          excludeBookingId: booking.id, leadTimeMinutes: 0,
        })
      }
      // Bump corto SIEMPRE que el hold venció (futuro o pasado): assertBookingPayable
      // tira con pending_payment + hold vencido sin mirar startDateTime. Sin este
      // update la confirmación de un pago legítimo revienta. El paso final confirma ya.
      await tx.booking.updateMany({
        where: { id: booking.id, status: 'pending_payment' },
        data: { holdExpiresAt: addHours(now, 1) },
      })
    }

    // applyApprovedPayment exige amount/paymentType EXACTOS: actualizar antes.
    const derivedType = deriveManualPaymentType(booking, amount)
    await tx.payment.update({ where: { id: paymentId }, data: { amount, paymentType: derivedType } })

    const { applyApprovedPayment } = await import('@/server/services/finance')
    const { wasConfirmed } = await applyApprovedPayment({
      tx, bookingId: booking.id, businessId,
      amount, currency: payment.currency,
      provider: 'manual', providerPaymentId: payment.providerPaymentId,
      paymentType: derivedType, paymentMethod: payment.paymentMethod ?? 'Transferencia',
      paymentId,
    })
    return { wasConfirmed, bookingId: booking.id }
  })

  if (result.wasConfirmed) {
    await sendNotificationSafely('booking confirmed', () =>
      sendBookingConfirmedNotification(result.bookingId, businessId),
    )
  }
  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/payments')
  revalidatePath('/dashboard')
  await revalidateBusinessPublicPaths(businessId)
  return { ok: true }
}
```

Verify the actual import paths for `requireBusinessRole`, `sendBookingConfirmedNotification`, `getBusinessReplyToEmail`, `revalidateBusinessPublicPaths` against `bookings.ts`/`payments.ts` and fix if they differ (do NOT guess — grep). `deriveManualPaymentType` may need re-check: it takes `{depositPaid, remainingBalance}` — booking snapshot works.

- [ ] **Step 4: Run to verify it passes** — integration `-t confirmBankTransfer`. Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/server/actions/bank-transfer-verify.ts tests/integration/bank-transfer-verify.test.ts
git -C <worktree> commit -m "feat(bank-transfer): confirmBankTransfer (verificar) con re-chequeo de cupo y monto editable"
```

---

## Task 4: `rejectBankTransfer(paymentId)` action

Payment `pending`→`rejected`, booking `pending_payment`→`cancelled` (guarded) + release redemption + rejected email. Spec §6.3.

**Files:**
- Modify: `src/server/actions/bank-transfer-verify.ts` (append)
- Test: `tests/integration/bank-transfer-verify.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
describe('rejectBankTransfer', () => {
  it('rejects the payment, cancels the booking, releases redemption', async () => {
    const { paymentId, bookingId } = await seedDeclaredTransfer()
    const { rejectBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await rejectBankTransfer(paymentId)
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(payment!.status).toBe('rejected')
    expect(booking!.status).toBe('cancelled')
  })
  it('errors if the payment was already processed', async () => {
    const { paymentId } = await seedDeclaredTransfer()
    await prisma.payment.update({ where: { id: paymentId }, data: { status: 'approved' } })
    const { rejectBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await expect(rejectBankTransfer(paymentId)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails** — integration `-t rejectBankTransfer`. Expected: FAIL.

- [ ] **Step 3: Implement** (append to `bank-transfer-verify.ts`)

```ts
export async function rejectBankTransfer(paymentId: string): Promise<{ ok: true }> {
  const { business, businessId } = await requireBusinessRole(['owner', 'admin'])

  const rejected = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!payment || payment.businessId !== businessId) throw new Error('Pago no encontrado')
    if (!isDeclaredTransferPayment(payment)) throw new Error('Este pago no es una transferencia por verificar')

    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, status: 'pending' },
      data: { status: 'rejected' },
    })
    if (count === 0) throw new Error('Este pago ya fue procesado')

    const bookingUpd = await tx.booking.updateMany({
      where: { id: payment.bookingId, status: 'pending_payment' },
      data: { status: 'cancelled' },
    })
    if (bookingUpd.count > 0) {
      await releaseRedemptionForBooking(tx, payment.bookingId, 'cancelled')
    }
    return tx.booking.findUnique({
      where: { id: payment.bookingId }, include: { customer: true, service: true },
    })
  })

  if (rejected?.customer?.email) {
    // Hoist el await FUERA del callback: sendNotificationSafely recibe un
    // `() =>` no-async; un await adentro no compila (mismo motivo por el que
    // cancelBooking usa `async () =>`). Precedente: bookings.ts:1042.
    const replyTo = await getBusinessReplyToEmail(businessId)
    await sendNotificationSafely('bank transfer rejected', () =>
      sendBankTransferRejectedToCustomer({
        businessName: business.name,
        businessTimezone: business.timezone || 'America/Santiago',
        businessReplyToEmail: replyTo,
        customerName: rejected.customer!.name,
        customerEmail: rejected.customer!.email!,
        serviceName: rejected.service?.name ?? 'servicio',
        startDateTime: rejected.startDateTime,
        bookingNumber: rejected.bookingNumber,
      }),
    )
  }
  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/payments')
  revalidatePath('/dashboard')
  await revalidateBusinessPublicPaths(businessId)
  return { ok: true }
}
```

- [ ] **Step 4: Run to verify it passes** — integration `-t rejectBankTransfer`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/server/actions/bank-transfer-verify.ts tests/integration/bank-transfer-verify.test.ts
git -C <worktree> commit -m "feat(bank-transfer): rejectBankTransfer (rechazar) + email a la clienta"
```

---

## Task 5: `cancelBooking` closes the declared Payment (§6.4)

When the owner cancels a declared-transfer booking via the normal cancel button, mark its `bt-declared` pending Payment `cancelled` in the same tx — otherwise it's an orphan pending forever.

**Files:**
- Modify: `src/server/actions/bookings.ts:1028-1039` (inside the cancel tx)
- Test: `tests/integration/bank-transfer-verify.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
describe('cancelBooking closes the declared transfer payment', () => {
  it('marks the bt-declared payment cancelled', async () => {
    const { paymentId, bookingId } = await seedDeclaredTransfer()
    const { cancelBooking } = await import('@/server/actions/bookings')
    await cancelBooking(bookingId)
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    expect(payment!.status).toBe('cancelled')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — integration `-t "cancelBooking closes"`. Expected: FAIL (payment still pending).

- [ ] **Step 3: Implement**

In the `cancelBooking` transaction (`bookings.ts:1028`), after `releaseRedemptionForBooking`, add:

```ts
import { declaredTransferPaymentWhere } from '@/lib/bank-transfer/declared' // add to imports

// inside the $transaction, after releaseRedemptionForBooking(tx, bookingId, 'cancelled'):
await tx.payment.updateMany({
  where: { bookingId, ...declaredTransferPaymentWhere },
  data: { status: 'cancelled' },
})
```

- [ ] **Step 4: Run to verify it passes** — integration `-t "cancelBooking closes"`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/server/actions/bookings.ts tests/integration/bank-transfer-verify.test.ts
git -C <worktree> commit -m "fix(bank-transfer): cancelBooking cierra el Payment bt-declared huérfano"
```

---

## Task 6: Cron `expireStaleHolds` cancels declared Payments + emails the customer (§7)

Query unchanged (declared keeps `paymentStatus:'unpaid'`). After expiring the batch: for the bookings that ACTUALLY transitioned and had a declared Payment, mark it `cancelled` (in-tx) and send the expired email (best-effort, injectable for tests).

**Files:**
- Modify: `src/lib/cron/expire-holds.ts`
- Test: `tests/integration/expire-holds-bank-transfer.test.ts` (new) — OR append to existing `tests/integration/expire-holds*.test.ts` if present (grep first).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { expireStaleHolds } from '@/lib/cron/expire-holds'
import { btDeclaredId } from '@/lib/bank-transfer/declared'

describe('expireStaleHolds + declared transfers', () => {
  it('cancels the declared payment and calls the email sender for expired declared bookings', async () => {
    const { bookingId, paymentId } = await seedDeclaredTransfer({ holdExpiresAt: new Date(Date.now() - 3600_000), customerEmail: 'ana@x.com' })
    const spy = vi.fn().mockResolvedValue({ success: true })
    const res = await expireStaleHolds(new Date(), prisma, { sendExpiredEmail: spy })
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.status).toBe('expired')
    expect(payment!.status).toBe('cancelled')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('does not email when the customer has no email', async () => {
    await seedDeclaredTransfer({ holdExpiresAt: new Date(Date.now() - 3600_000), customerEmail: null })
    const spy = vi.fn().mockResolvedValue({ success: true })
    await expireStaleHolds(new Date(), prisma, { sendExpiredEmail: spy })
    expect(spy).not.toHaveBeenCalled()
  })

  it('leaves a declared transfer with a live hold untouched', async () => {
    const { bookingId, paymentId } = await seedDeclaredTransfer({ holdExpiresAt: new Date(Date.now() + 3600_000) })
    await expireStaleHolds(new Date(), prisma)
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    expect(booking!.status).toBe('pending_payment')
    expect(payment!.status).toBe('pending')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — integration for the new file. Expected: FAIL — payment stays pending / no deps param.

- [ ] **Step 3: Implement**

Extend the signature with an injectable deps object and add the post-expire step inside the existing tx:

```ts
import { declaredTransferPaymentWhere } from '@/lib/bank-transfer/declared'
import { sendNotificationSafely, sendBankTransferExpiredToCustomer, getBusinessReplyToEmail } from '@/lib/notifications'

export interface ExpireHoldsResult {
  expired: number
  businessIds: string[]
  declaredTransferExpired: number
}

interface ExpireHoldsDeps {
  sendExpiredEmail: typeof sendBankTransferExpiredToCustomer
}

export async function expireStaleHolds(
  now = new Date(),
  db: Pick<PrismaClient, 'booking' | 'payment' | '$transaction'> = prisma,
  deps: ExpireHoldsDeps = { sendExpiredEmail: sendBankTransferExpiredToCustomer },
): Promise<ExpireHoldsResult> {
  // ... existing findMany (unchanged) ...

  const { count, declaredBookingIds } = await db.$transaction(async (tx) => {
    const res = await tx.booking.updateMany({ /* unchanged expire guard */ })
    // ... existing redemption release (unchanged) ...

    // NEW: which candidates actually transitioned to expired this run
    const expiredNow = await tx.booking.findMany({
      where: { id: { in: expiredIds }, status: BookingStatus.expired },
      select: { id: true },
    })
    const expiredNowIds = expiredNow.map((b) => b.id)

    // NEW: cancel orphan declared-transfer Payments for those bookings
    const declaredPayments = await tx.payment.findMany({
      where: { bookingId: { in: expiredNowIds }, ...declaredTransferPaymentWhere },
      select: { bookingId: true },
    })
    const declaredBookingIds = declaredPayments.map((p) => p.bookingId)
    if (declaredBookingIds.length > 0) {
      await tx.payment.updateMany({
        where: { bookingId: { in: declaredBookingIds }, ...declaredTransferPaymentWhere },
        data: { status: 'cancelled' },
      })
    }
    return { count: res.count, declaredBookingIds }
  })

  // NEW: best-effort expired emails for declared transfers (post-tx)
  if (declaredBookingIds.length > 0) {
    const toNotify = await prisma.booking.findMany({
      where: { id: { in: declaredBookingIds } },
      include: { customer: true, service: true, business: true },
    })
    for (const b of toNotify) {
      if (!b.customer?.email) continue
      await sendNotificationSafely('bank transfer expired', () =>
        deps.sendExpiredEmail({
          businessName: b.business.name,
          businessTimezone: b.business.timezone || 'America/Santiago',
          businessReplyToEmail: await getBusinessReplyToEmail(b.businessId),
          customerName: b.customer!.name,
          customerEmail: b.customer!.email!,
          serviceName: b.service?.name ?? 'servicio',
          startDateTime: b.startDateTime,
          bookingNumber: b.bookingNumber,
        }),
      )
    }
  }

  const businessIds = [...new Set(expiredBookings.map((b) => b.businessId))]
  return { expired: count, businessIds, declaredTransferExpired: declaredBookingIds.length }
}
```

Note: `getBusinessReplyToEmail` inside a map arg — resolve it into a `const replyTo = await getBusinessReplyToEmail(b.businessId)` before the object literal to avoid an `await`-in-object gotcha. The cron route (`route.ts`) needs no change (it already ignores extra result fields), but confirm the return object still satisfies its usage.

- [ ] **Step 4: Run to verify it passes** — integration for the new file (all 3). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/lib/cron/expire-holds.ts tests/integration/expire-holds-bank-transfer.test.ts
git -C <worktree> commit -m "feat(bank-transfer): el cron cancela el Payment declarado y avisa a la clienta al expirar"
```

---

## Task 7: Dashboard "Transferencias por verificar" section (Reservas) + derived badge

Client component listing the declared bookings above the table: cliente, servicio, fecha, monto, antigüedad, wa.me link, Verificar (dialog with editable amount → `confirmBankTransfer`) / Rechazar (`rejectBankTransfer`). Derived "Transferencia por verificar" badge on those rows in the table.

**Rationale (altitude):** we build a focused `verify-transfer-dialog.tsx` rather than overloading `ManualPaymentDialog`. That dialog is coupled to `createManualPayment` + a booking `<select>` and always creates a NEW Payment; the verify flow targets an existing pending Payment by id. A small dedicated dialog (amount field + confirm/reject) is the honest reuse of the *UX*, not the component, and keeps both flows simple.

**Files:**
- Create: `src/components/dashboard/verify-transfer-dialog.tsx` (client)
- Create: `src/components/dashboard/pending-transfers-section.tsx` (client)
- Modify: `src/app/dashboard/bookings/page.tsx` (render section above table; derive badge on rows)
- Test: `tests/components/pending-transfers-section.test.tsx` (new)

- [ ] **Step 1: Write the failing component test**

`renderToStaticMarkup` + `vi.mock('next/navigation')` (component-test landmine). Assert the section renders a row with the customer name, formatted amount, an "hace" antigüedad string, a `wa.me/` link, and Verificar/Rechazar controls; and returns null/empty when the list is empty.

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
import { PendingTransfersSection } from '@/components/dashboard/pending-transfers-section'

const row = {
  paymentId: 'p1', bookingId: 'b1', customerName: 'Ana', customerPhone: '+56911112222',
  serviceName: 'Corte', startDateTime: new Date('2026-07-15T14:00:00Z'),
  amount: 8000, declaredAt: new Date(Date.now() - 3 * 3600_000),
}

describe('PendingTransfersSection', () => {
  it('renders a pending transfer row with wa.me and actions', () => {
    const html = renderToStaticMarkup(
      <PendingTransfersSection items={[row]} businessCurrency="CLP" businessTimezone="America/Santiago" />,
    )
    expect(html).toContain('Ana')
    expect(html).toContain('wa.me/')
    expect(html).toContain('Verificar')
    expect(html).toContain('Rechazar')
  })
  it('renders nothing when empty', () => {
    const html = renderToStaticMarkup(
      <PendingTransfersSection items={[]} businessCurrency="CLP" businessTimezone="America/Santiago" />,
    )
    expect(html).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/components/pending-transfers-section.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement**

`verify-transfer-dialog.tsx`: `'use client'` dialog, props `{ paymentId, defaultAmount, businessCurrency, open, onOpenChange }`, an amount `<input type="number">` prefilled with `defaultAmount`, a "Verificar pago" submit calling `confirmBankTransfer(paymentId, amount)` inside `useTransition` + `router.refresh()`, and a secondary "Rechazar" calling `rejectBankTransfer(paymentId)` (with a confirm). Mirror `manual-payment-dialog.tsx` error/loading handling. Import actions from `@/server/actions/bank-transfer-verify`.

`pending-transfers-section.tsx`: `'use client'`. Props:

```ts
interface PendingTransferItem {
  paymentId: string; bookingId: string; customerName: string; customerPhone: string | null
  serviceName: string; startDateTime: Date; amount: number; declaredAt: Date
}
export function PendingTransfersSection({ items, businessCurrency, businessTimezone }: {
  items: PendingTransferItem[]; businessCurrency: string; businessTimezone: string
}) { if (items.length === 0) return null; /* ... */ }
```

Render a titled card ("Transferencias por verificar") with one row per item: name, service, `fmtDate(startDateTime, timezone)`, formatted amount, antigüedad via a small `timeAgo(declaredAt)` helper ("hace 3 h"), a `buildWhatsappUrl(customerPhone, msg)` `<a target="_blank" rel="noopener noreferrer">` (only if phone present), and a "Verificar" button that opens `VerifyTransferDialog` (controlled) + inline "Rechazar". Use `buildWhatsappUrl` from `@/lib/notifications`.

In `bookings.ts` `getBookings` the rows already carry `payments` (Task 1). In `dashboard/bookings/page.tsx`:
- Build `pendingTransfers` from `bookings.filter(b => b.status === 'pending_payment' && b.payments.length > 0)` mapping to `PendingTransferItem` (`paymentId: b.payments[0].id`, `amount: b.payments[0].amount`, `declaredAt: b.payments[0].createdAt`, `customerPhone: b.customer.phone`, etc.).
- Render `<PendingTransfersSection items={pendingTransfers} businessCurrency={...} businessTimezone={...} />` between the stat grid (~L205) and the table conditional (~L207). Fetch `businessCurrency`/`businessTimezone` (grep how the page currently gets the business; if it doesn't, add a `requireBusiness()`/`getBusiness()` call consistent with siblings).
- Derived badge: where each row renders `<StatusBadge status={booking.status} />` (~L239) and the mobile `BookingCard` (~L61), when `booking.status === 'pending_payment' && booking.payments.length > 0`, render an inline orange badge "Transferencia por verificar" instead. Keep it a local derivation (no new `STATUS_MAPS.booking` key).

- [ ] **Step 4: Run to verify it passes** — `npm test -- tests/components/pending-transfers-section.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/components/dashboard/verify-transfer-dialog.tsx src/components/dashboard/pending-transfers-section.tsx src/app/dashboard/bookings/page.tsx tests/components/pending-transfers-section.test.tsx
git -C <worktree> commit -m "feat(bank-transfer): sección 'por verificar' + verificar/rechazar en el dashboard de reservas"
```

---

## Task 8: Dashboard home banner + recent-bookings label

Banner "Tenés N transferencias por verificar" with a link to `/dashboard/bookings`, mirroring `service-fit-warnings.tsx`; and the recent-bookings rows show "Por verificar" instead of "Pendiente" for declared bookings. Spec §6.1.

**Files:**
- Create: `src/components/dashboard/pending-transfers-banner.tsx` (server-safe presentational)
- Modify: `src/app/dashboard/page.tsx` (count query in the Promise.all; render banner; recent-row label)
- Test: `tests/components/pending-transfers-banner.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PendingTransfersBanner } from '@/components/dashboard/pending-transfers-banner'

describe('PendingTransfersBanner', () => {
  it('renders count + link when > 0', () => {
    const html = renderToStaticMarkup(<PendingTransfersBanner count={3} />)
    expect(html).toContain('3')
    expect(html).toContain('/dashboard/bookings')
  })
  it('renders nothing when 0', () => {
    expect(renderToStaticMarkup(<PendingTransfersBanner count={0} />)).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/components/pending-transfers-banner.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement**

`pending-transfers-banner.tsx` (mirror `service-fit-warnings.tsx`, uses a `lucide-react` icon + `next/link`):

```tsx
import Link from 'next/link'
import { Landmark } from 'lucide-react'

export function PendingTransfersBanner({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <Link href="/dashboard/bookings" className="flex items-start gap-3 rounded-xl border border-orange-300/50 bg-orange-50 p-4 text-sm text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200" role="alert">
      <Landmark className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-semibold">
          {count === 1 ? 'Tenés 1 transferencia por verificar' : `Tenés ${count} transferencias por verificar`}
        </span>{' '}
        — revisá tu cuenta y confirmá o rechazá cada reserva.
      </p>
    </Link>
  )
}
```

In `dashboard/page.tsx`: the recent/upcoming list is derived from `getBookings()` (verify by grep — the gap review confirmed `dashboard/page.tsx:31` calls it), which already carries the filtered `payments` (Task 1). So **do NOT add a separate count query** — derive it:

```ts
const pendingTransfersCount = bookings.filter(
  (b) => b.status === 'pending_payment' && b.payments.length > 0,
).length
```

Render `<PendingTransfersBanner count={pendingTransfersCount} />` inside the content wrapper (~L73), just before the "Tu perfil público" card. In the recent-bookings row status span (~L171-173), branch the label: when `b.status === 'pending_payment' && b.payments.length > 0` show "Por verificar" instead of "Pendiente". (If grep shows the home list does NOT come from `getBookings()` but a separate `prisma.booking.findMany`, add the same filtered `payments` relation to that query rather than a count.) Use `business.id` (the page has `const business = userData.business`), not a bare `businessId`.

- [ ] **Step 4: Run to verify it passes** — `npm test -- tests/components/pending-transfers-banner.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/components/dashboard/pending-transfers-banner.tsx src/app/dashboard/page.tsx tests/components/pending-transfers-banner.test.tsx
git -C <worktree> commit -m "feat(bank-transfer): aviso 'N por verificar' en el home + label en reservas recientes"
```

---

## Task 9: Final verification + PR

- [ ] **Step 1: tsc gate (build-parity)**

Run: `npx tsc --noEmit 2>&1 | grep -E '^src/'`
Expected: NO output (0 `src/` errors). Fix any before proceeding — this is the CI `build` gate that vitest/eslint miss.

- [ ] **Step 2: Full unit + component suite**

Run: `npm test`
Expected: all pass (PR B baseline was 1356+ unit/component green).

- [ ] **Step 3: Full integration suite**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- --config vitest.integration.config.ts`
Expected: all pass.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 5: Push + PR**

```bash
git -C <worktree> push -u origin claude/bank-transfer-prC
gh pr create --title "Transferencia bancaria PR C: verificación en dashboard + cron + cancelación" --body "<summary of §6/§7 + testing>"
```

Wait for CI (build, unit, integration, lint required; e2e non-blocking/known-red). Merge only when the required checks are green.

---

## Self-review checklist (done while writing)

- **Spec coverage:** §6.1 → Tasks 7-8; §6.2 → Task 3; §6.3 → Task 4; §6.4 → Task 5; §7 → Task 6; §8 rejected/expired emails → Task 2; getBookings payments (§6.1) → Task 1. §5/§9 already shipped in PR A/B.
- **Type consistency:** `confirmBankTransfer(paymentId, amount)` / `rejectBankTransfer(paymentId)` names stable across Tasks 3/4/7. `PendingTransferItem` shape defined once (Task 7) and fed from `getBookings().payments[0]` (Task 1). `ExpireHoldsResult` gains `declaredTransferExpired` (Task 6) — route ignores it.
- **Reuse:** `declared.ts` helpers used in Tasks 1/5/6/8; `applyApprovedPayment`/`deriveManualPaymentType`/`assertSlotIsAvailable`/`releaseRedemptionForBooking`/`buildWhatsappUrl`/`sendNotificationSafely` all reused, none reimplemented.
- **Open verification points flagged for the implementer (grep, don't guess):** exact import path of `requireBusinessRole`, `sendBookingConfirmedNotification`, `getBusinessReplyToEmail`, `revalidateBusinessPublicPaths`; how `dashboard/bookings/page.tsx` and `dashboard/page.tsx` currently obtain the business (currency/timezone); whether the home recent list uses `getBookings()` or a separate query.
