# Refactorización de Finanzas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear un servicio centralizado e idempotente `applyApprovedPayment` en `src/server/services/finance.ts` y refactorizar `confirmPayment`, `createManualPayment` y `verifyAndConfirmPayment` para que lo usen, garantizando consistencia financiera y evitando duplicados de Payment y LedgerEntry.

**Architecture:** Un único servicio `applyApprovedPayment` encapsula validación, creación/upsert de Payment, creación condicional de LedgerEntry y recálculo server-side de `depositPaid`, `remainingBalance`, `paymentStatus` y `status`. Las Server Actions existentes se convierten en thin wrappers que solo hacen validaciones de seguridad/frontend y delegan la lógica transaccional al servicio.

**Tech Stack:** TypeScript, Next.js Server Actions, Prisma, Vitest.

---

### Task 1: Crear el servicio `applyApprovedPayment` en `src/server/services/finance.ts`

**Files:**
- Create: `src/server/services/finance.ts`

- [ ] **Step 1: Escribir la implementación completa del servicio**

```typescript
import type { Prisma } from '@prisma/client'
import { BookingStatus, BookingPaymentStatus, PaymentProvider, PaymentType } from '@prisma/client'
import { assertBookingPayable } from '@/lib/booking-payments'

export interface ApplyApprovedPaymentInput {
  tx: Prisma.TransactionClient
  bookingId: string
  businessId: string
  amount: number
  provider: PaymentProvider
  providerPaymentId: string | null
  paymentType: PaymentType
  paymentMethod?: string | null
  rawPayload?: Prisma.JsonValue
  createdByUserId?: string | null
}

export async function applyApprovedPayment({
  tx,
  bookingId,
  businessId,
  amount,
  provider,
  providerPaymentId,
  paymentType,
  paymentMethod,
  rawPayload,
  createdByUserId,
}: ApplyApprovedPaymentInput) {
  if (amount <= 0) {
    throw new Error('El monto debe ser positivo')
  }

  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: { payments: true },
  })

  if (!booking) {
    throw new Error('Reserva no encontrada')
  }

  if (booking.businessId !== businessId) {
    throw new Error('La reserva no pertenece al negocio')
  }

  assertBookingPayable(booking)

  let payment = await tx.payment.findFirst({
    where: {
      bookingId,
      provider,
      providerPaymentId: providerPaymentId ?? undefined,
    },
  })

  if (payment && payment.status === 'approved') {
    // Idempotencia: ya existe y está aprobado; solo recalcular y retornar
    return recalcBookingFromPayments(tx, bookingId)
  }

  if (payment) {
    payment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'approved',
        paidAt: new Date(),
        ...(rawPayload !== undefined && { rawPayload }),
      },
    })
  } else {
    payment = await tx.payment.create({
      data: {
        businessId,
        bookingId,
        customerId: booking.customerId,
        provider,
        providerPaymentId,
        amount,
        currency: booking.currency || 'CLP',
        status: 'approved',
        paymentType,
        paymentMethod: paymentMethod ?? null,
        paidAt: new Date(),
        ...(rawPayload !== undefined && { rawPayload }),
      },
    })
  }

  const existingLedger = await tx.ledgerEntry.findFirst({
    where: { paymentId: payment.id },
  })

  if (!existingLedger) {
    const isFullPayment = payment.amount >= booking.finalAmount
    await tx.ledgerEntry.create({
      data: {
        businessId,
        bookingId,
        paymentId: payment.id,
        customerId: booking.customerId,
        type: isFullPayment ? 'full_payment_paid' : 'deposit_paid',
        direction: 'income',
        amount: payment.amount,
        currency: booking.currency || 'CLP',
        description: `${isFullPayment ? 'Pago total' : 'Abono'} para reserva ${booking.id.slice(-4)}`,
        occurredAt: new Date(),
        createdByUserId: createdByUserId ?? null,
      },
    })
  }

  return recalcBookingFromPayments(tx, bookingId)
}

async function recalcBookingFromPayments(tx: Prisma.TransactionClient, bookingId: string) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
  })
  if (!booking) throw new Error('Reserva no encontrada')

  const approvedPayments = await tx.payment.findMany({
    where: { bookingId, status: 'approved' },
  })

  const totalApproved = approvedPayments.reduce((sum, p) => sum + p.amount, 0)
  const newDepositPaid = totalApproved
  const newRemainingBalance = Math.max(0, booking.finalAmount - totalApproved)

  let newPaymentStatus: BookingPaymentStatus
  let newStatus: BookingStatus = booking.status

  if (totalApproved >= booking.finalAmount) {
    newPaymentStatus = BookingPaymentStatus.fully_paid
  } else if (totalApproved >= booking.depositRequired) {
    newPaymentStatus = BookingPaymentStatus.deposit_paid
  } else {
    newPaymentStatus = BookingPaymentStatus.pending_payment
  }

  if (
    booking.status === BookingStatus.pending_payment &&
    totalApproved >= booking.depositRequired
  ) {
    newStatus = BookingStatus.confirmed
  }

  const updated = await tx.booking.update({
    where: { id: bookingId },
    data: {
      depositPaid: newDepositPaid,
      remainingBalance: newRemainingBalance,
      paymentStatus: newPaymentStatus,
      status: newStatus,
    },
  })

  return updated
}
```

- [ ] **Step 2: Verificar que no hay errores de tipo**

Run: `npx tsc --noEmit --pretty`
Expected: No errors introduced by the new file (may show pre-existing errors).

---

### Task 2: Refactorizar `confirmPayment` en `src/server/actions/bookings.ts`

**Files:**
- Modify: `src/server/actions/bookings.ts:228-286`

- [ ] **Step 1: Reemplazar el cuerpo de `confirmPayment` para que use `applyApprovedPayment`**

Reemplazar desde la línea 233 (`export async function confirmPayment...`) hasta el final de la función (línea 286) con:

```typescript
export async function confirmPayment(bookingId: string, paymentId: string, amount: number) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('confirm-payment', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = confirmPaymentSchema.safeParse({ bookingId, paymentId, amount })
  if (!parsed.success) {
    throw new Error('Datos de pago inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
  })
  if (!booking) throw new ForbiddenError('Reserva no encontrada')

  const { assertBookingPayable } = await import('@/lib/booking-payments')
  try {
    assertBookingPayable(booking)
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'No se puede confirmar pago para esta reserva')
  }

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, businessId },
  })
  if (!payment) throw new ForbiddenError('Pago no encontrado')
  if (payment.bookingId !== bookingId) throw new ForbiddenError('El pago no corresponde a esta reserva')
  if (payment.amount !== amount) throw new ForbiddenError('El monto no coincide con el pago registrado')

  const updated = await prisma.$transaction(async (tx) => {
    const { applyApprovedPayment } = await import('@/server/services/finance')
    return applyApprovedPayment({
      tx,
      bookingId,
      businessId,
      amount: payment.amount,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      paymentType: payment.paymentType,
      paymentMethod: payment.paymentMethod,
    })
  })

  revalidatePath('/dashboard/bookings')
  if (updated) {
    await revalidateBusinessPublicPaths(updated.businessId)
  }
  return updated
}
```

- [ ] **Step 2: Eliminar import no usado `applyPaymentToBooking`**

Buscar y eliminar la línea:
```typescript
import { applyPaymentToBooking } from '@/lib/booking-payments'
```

---

### Task 3: Refactorizar `createManualPayment` en `src/server/actions/payments.ts`

**Files:**
- Modify: `src/server/actions/payments.ts:225-291`

- [ ] **Step 1: Reemplazar el cuerpo de `createManualPayment`**

Reemplazar desde la línea 225 (`export async function createManualPayment...`) hasta el final de la función (línea 291) con:

```typescript
export async function createManualPayment(data: {
  bookingId: string
  amount: number
  currency: string
  paymentType: string
  paymentMethod: string
}) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-manual-payment', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createManualPaymentSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const booking = await prisma.booking.findFirst({
    where: { id: data.bookingId, businessId },
  })
  if (!booking) {
    throw new ForbiddenError('Reserva no encontrada')
  }

  const { assertBookingPayable } = await import('@/lib/booking-payments')
  try {
    assertBookingPayable(booking)
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'No se puede registrar pago para esta reserva')
  }

  if (data.amount > booking.remainingBalance) {
    throw new Error('El monto excede el saldo pendiente')
  }

  if (data.paymentType === 'full_payment' && data.amount < booking.remainingBalance) {
    throw new Error('Un pago total debe cubrir el saldo completo')
  }

  const result = await prisma.$transaction(async (tx) => {
    const { applyApprovedPayment } = await import('@/server/services/finance')

    const payment = await tx.payment.create({
      data: {
        businessId,
        bookingId: data.bookingId,
        customerId: booking.customerId,
        paymentType: data.paymentType as PaymentType,
        provider: 'manual',
        providerPaymentId: null,
        amount: data.amount,
        currency: data.currency,
        status: 'approved',
        paymentMethod: data.paymentMethod,
        paidAt: new Date(),
      },
    })

    const updatedBooking = await applyApprovedPayment({
      tx,
      bookingId: data.bookingId,
      businessId,
      amount: data.amount,
      provider: 'manual',
      providerPaymentId: null,
      paymentType: data.paymentType as PaymentType,
      paymentMethod: data.paymentMethod,
    })

    return { payment, booking: updatedBooking }
  })

  revalidatePath('/dashboard/payments')
  revalidatePath('/dashboard/bookings')
  await revalidateBusinessPublicPaths(businessId)
  return result.payment
}
```

- [ ] **Step 2: Eliminar import no usado `applyPaymentToBooking`**

Buscar y eliminar:
```typescript
import { applyPaymentToBooking } from '@/lib/booking-payments'
```

---

### Task 4: Refactorizar `verifyAndConfirmPayment` en `src/server/actions/payments.ts`

**Files:**
- Modify: `src/server/actions/payments.ts:113-189`

- [ ] **Step 1: Reemplazar el cuerpo de `verifyAndConfirmPayment`**

Reemplazar desde la línea 113 (`export async function verifyAndConfirmPayment...`) hasta el final de la función (línea 189) con:

```typescript
export async function verifyAndConfirmPayment(paymentId: string, bookingId: string) {
  const limit = await checkRateLimit('verify-payment', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = verifyPaymentSchema.safeParse({ paymentId, bookingId })
  if (!parsed.success) {
    throw new Error('Datos de verificación inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { booking: true },
  })
  if (!payment) throw new Error('Pago no encontrado')

  if (payment.bookingId !== bookingId) {
    throw new Error('El pago no corresponde a esta reserva')
  }

  if (payment.businessId !== payment.booking.businessId) {
    throw new Error('Inconsistencia de negocio en el pago')
  }

  try {
    const { assertBookingPayable } = await import('@/lib/booking-payments')
    assertBookingPayable(payment.booking)
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : 'No se puede confirmar pago para esta reserva' }
  }

  const provider = getDefaultProvider()
  let approved = false

  if (payment.providerPaymentId) {
    const verification = await provider.verifyPayment({
      paymentId: payment.id,
      providerPaymentId: payment.providerPaymentId,
    })
    if (verification.status === 'approved') approved = true
  }

  if (payment.provider === 'mock') {
    if (process.env.NODE_ENV !== 'production') {
      approved = true
    }
  }

  if (!approved) {
    return { success: false, message: 'Pago no aprobado' }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const { applyApprovedPayment } = await import('@/server/services/finance')
    return applyApprovedPayment({
      tx,
      bookingId,
      businessId: payment.businessId,
      amount: payment.amount,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      paymentType: payment.paymentType,
      paymentMethod: payment.paymentMethod,
    })
  })

  if (!updated) throw new Error('Reserva no encontrada')

  revalidatePath('/dashboard/bookings')
  await revalidateBusinessPublicPaths(updated.businessId)
  return { success: true }
}
```

---

### Task 5: Limpiar `src/lib/booking-payments.ts`

**Files:**
- Modify: `src/lib/booking-payments.ts`

- [ ] **Step 1: Eliminar `applyPaymentToBooking` y dejar solo `assertBookingPayable` y `BookingNotPayableError`**

Reemplazar TODO el contenido del archivo con:

```typescript
import { BookingStatus } from '@prisma/client'

export class BookingNotPayableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BookingNotPayableError'
  }
}

export function assertBookingPayable(booking: {
  status: BookingStatus
  holdExpiresAt: Date | null
}): void {
  const terminalStatuses: BookingStatus[] = [
    BookingStatus.cancelled,
    BookingStatus.expired,
    BookingStatus.no_show,
    BookingStatus.completed,
  ]
  if (terminalStatuses.includes(booking.status)) {
    throw new BookingNotPayableError('No se puede procesar pago para esta reserva')
  }

  if (
    booking.status === BookingStatus.pending_payment &&
    booking.holdExpiresAt &&
    booking.holdExpiresAt < new Date()
  ) {
    throw new BookingNotPayableError('El tiempo para pagar esta reserva ha expirado')
  }
}
```

---

### Task 6: Escribir tests unitarios para `applyApprovedPayment`

**Files:**
- Create: `tests/unit/finance-service.test.ts`

- [ ] **Step 1: Escribir el archivo de tests completo**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus, BookingPaymentStatus, PaymentProvider, PaymentType } from '@prisma/client'

const mockPrisma = {
  booking: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  payment: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  ledgerEntry: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/booking-payments', () => ({
  assertBookingPayable: vi.fn(),
  BookingNotPayableError: class extends Error {},
}))

const { applyApprovedPayment } = await import('@/server/services/finance')

describe('applyApprovedPayment', () => {
  const baseBooking = {
    id: 'booking-1',
    businessId: 'biz-1',
    customerId: 'cust-1',
    finalAmount: 20000,
    depositRequired: 10000,
    depositPaid: 0,
    remainingBalance: 20000,
    status: BookingStatus.pending_payment,
    currency: 'CLP',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setupTx() {
    return {
      ...mockPrisma,
      booking: { ...mockPrisma.booking },
      payment: { ...mockPrisma.payment },
      ledgerEntry: { ...mockPrisma.ledgerEntry },
    }
  }

  it('rejects amount <= 0', async () => {
    const tx = setupTx()
    await expect(
      applyApprovedPayment({
        tx,
        bookingId: 'booking-1',
        businessId: 'biz-1',
        amount: 0,
        provider: PaymentProvider.manual,
        providerPaymentId: null,
        paymentType: PaymentType.deposit,
      })
    ).rejects.toThrow('El monto debe ser positivo')
  })

  it('rejects booking not found', async () => {
    const tx = setupTx()
    tx.booking.findUnique.mockResolvedValue(null)
    await expect(
      applyApprovedPayment({
        tx,
        bookingId: 'booking-1',
        businessId: 'biz-1',
        amount: 5000,
        provider: PaymentProvider.manual,
        providerPaymentId: null,
        paymentType: PaymentType.deposit,
      })
    ).rejects.toThrow('Reserva no encontrada')
  })

  it('creates 1 Payment and 1 LedgerEntry for a deposit', async () => {
    const tx = setupTx()
    tx.booking.findUnique.mockResolvedValue(baseBooking)
    tx.payment.findFirst.mockResolvedValue(null)
    const createdPayment = { id: 'pay-1', amount: 5000, status: 'approved' }
    tx.payment.create.mockResolvedValue(createdPayment)
    tx.payment.findMany.mockResolvedValue([createdPayment])
    tx.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...baseBooking, depositPaid: 5000, remainingBalance: 15000, paymentStatus: BookingPaymentStatus.pending_payment }
    tx.booking.update.mockResolvedValue(updatedBooking)

    const result = await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 5000,
      provider: PaymentProvider.manual,
      providerPaymentId: null,
      paymentType: PaymentType.deposit,
    })

    expect(tx.payment.create).toHaveBeenCalledTimes(1)
    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(1)
    expect(result.depositPaid).toBe(5000)
    expect(result.remainingBalance).toBe(15000)
    expect(result.paymentStatus).toBe(BookingPaymentStatus.pending_payment)
    expect(result.status).toBe(BookingStatus.pending_payment)
  })

  it('accumulates partial payments and updates status to confirmed when depositRequired is met', async () => {
    const tx = setupTx()
    const existingPayment = { id: 'pay-1', amount: 5000, status: 'approved' }
    tx.booking.findUnique.mockResolvedValue({ ...baseBooking, depositPaid: 5000, remainingBalance: 15000 })
    tx.payment.findFirst.mockResolvedValue(null)
    const newPayment = { id: 'pay-2', amount: 5000, status: 'approved' }
    tx.payment.create.mockResolvedValue(newPayment)
    tx.payment.findMany.mockResolvedValue([existingPayment, newPayment])
    tx.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...baseBooking, depositPaid: 10000, remainingBalance: 10000, paymentStatus: BookingPaymentStatus.deposit_paid, status: BookingStatus.confirmed }
    tx.booking.update.mockResolvedValue(updatedBooking)

    const result = await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 5000,
      provider: PaymentProvider.manual,
      providerPaymentId: null,
      paymentType: PaymentType.deposit,
    })

    expect(tx.payment.create).toHaveBeenCalledTimes(1)
    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(1)
    expect(result.depositPaid).toBe(10000)
    expect(result.remainingBalance).toBe(10000)
    expect(result.paymentStatus).toBe(BookingPaymentStatus.deposit_paid)
    expect(result.status).toBe(BookingStatus.confirmed)
  })

  it('final payment leaves remainingBalance 0 and fully_paid', async () => {
    const tx = setupTx()
    const existingPayments = [
      { id: 'pay-1', amount: 10000, status: 'approved' },
    ]
    tx.booking.findUnique.mockResolvedValue({ ...baseBooking, depositPaid: 10000, remainingBalance: 10000, status: BookingStatus.confirmed })
    tx.payment.findFirst.mockResolvedValue(null)
    const newPayment = { id: 'pay-2', amount: 10000, status: 'approved' }
    tx.payment.create.mockResolvedValue(newPayment)
    tx.payment.findMany.mockResolvedValue([...existingPayments, newPayment])
    tx.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...baseBooking, depositPaid: 20000, remainingBalance: 0, paymentStatus: BookingPaymentStatus.fully_paid, status: BookingStatus.confirmed }
    tx.booking.update.mockResolvedValue(updatedBooking)

    const result = await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 10000,
      provider: PaymentProvider.manual,
      providerPaymentId: null,
      paymentType: PaymentType.final_payment,
    })

    expect(result.remainingBalance).toBe(0)
    expect(result.paymentStatus).toBe(BookingPaymentStatus.fully_paid)
  })

  it('does not duplicate Payment or LedgerEntry for same providerPaymentId', async () => {
    const tx = setupTx()
    const existingPayment = { id: 'pay-1', amount: 10000, status: 'approved', provider: PaymentProvider.mercado_pago, providerPaymentId: 'mp-123' }
    tx.booking.findUnique.mockResolvedValue({ ...baseBooking, depositPaid: 10000, remainingBalance: 10000 })
    tx.payment.findFirst.mockResolvedValue(existingPayment)
    tx.payment.findMany.mockResolvedValue([existingPayment])
    const updatedBooking = { ...baseBooking, depositPaid: 10000, remainingBalance: 10000 }
    tx.booking.update.mockResolvedValue(updatedBooking)

    const result = await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 10000,
      provider: PaymentProvider.mercado_pago,
      providerPaymentId: 'mp-123',
      paymentType: PaymentType.deposit,
    })

    expect(tx.payment.create).not.toHaveBeenCalled()
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled()
    expect(result.depositPaid).toBe(10000)
  })

  it('manual payment updates correctly', async () => {
    const tx = setupTx()
    tx.booking.findUnique.mockResolvedValue(baseBooking)
    tx.payment.findFirst.mockResolvedValue(null)
    const createdPayment = { id: 'pay-manual', amount: 20000, status: 'approved' }
    tx.payment.create.mockResolvedValue(createdPayment)
    tx.payment.findMany.mockResolvedValue([createdPayment])
    tx.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...baseBooking, depositPaid: 20000, remainingBalance: 0, paymentStatus: BookingPaymentStatus.fully_paid, status: BookingStatus.confirmed }
    tx.booking.update.mockResolvedValue(updatedBooking)

    const result = await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 20000,
      provider: PaymentProvider.manual,
      providerPaymentId: null,
      paymentType: PaymentType.full_payment,
      paymentMethod: 'Efectivo',
    })

    expect(result.depositPaid).toBe(20000)
    expect(result.remainingBalance).toBe(0)
    expect(result.paymentStatus).toBe(BookingPaymentStatus.fully_paid)
  })
})
```

- [ ] **Step 2: Ejecutar tests para verificar que fallan antes de implementar**

Run: `npx vitest run tests/unit/finance-service.test.ts`
Expected: FAIL (función aún no existe o import falla).

---

### Task 7: Verificar build y tests

**Files:** N/A

- [ ] **Step 1: Ejecutar build de Next.js**

Run: `npm run build`
Expected: Build exit 0.

- [ ] **Step 2: Ejecutar suite de tests unitarios completa**

Run: `npx vitest run tests/unit/`
Expected: Todos los tests pasan (incluyendo los nuevos).

- [ ] **Step 3: Commit de todos los cambios**

Run:
```bash
git add src/server/services/finance.ts src/server/actions/bookings.ts src/server/actions/payments.ts src/lib/booking-payments.ts tests/unit/finance-service.test.ts
git commit -m "refactor(finance): centraliza applyApprovedPayment en servicio finance

- Crea src/server/services/finance.ts con applyApprovedPayment
- Valida booking, evita duplicados por providerPaymentId
- Crea exactamente un LedgerEntry por Payment aprobado
- Recalcula depositPaid, remainingBalance, paymentStatus y status
- Refactoriza confirmPayment, createManualPayment, verifyAndConfirmPayment
- Elimina applyPaymentToBooking de booking-payments.ts
- Agrega tests unitarios para idempotencia y acumulación"
```

---

## Spec Coverage Check

- [x] Servicio centralizado `applyApprovedPayment` — Task 1.
- [x] Validación booking pertenece al business — Task 1.
- [x] Validación amount > 0 — Task 1.
- [x] Validación estado no terminal — Task 1 (vía `assertBookingPayable`).
- [x] Crear Payment aprobado si no existe — Task 1.
- [x] Evitar duplicados por provider + providerPaymentId — Task 1.
- [x] Crear exactamente un LedgerEntry por Payment aprobado — Task 1.
- [x] Recalcular booking desde pagos aprobados — Task 1 (`recalcBookingFromPayments`).
- [x] Reglas de paymentStatus y status — Task 1.
- [x] `confirmPayment` envuelve applyApprovedPayment — Task 2.
- [x] `createManualPayment` usa applyApprovedPayment — Task 3.
- [x] `verifyAndConfirmPayment` usa applyApprovedPayment — Task 4.
- [x] Tests de abono, acumulación, duplicados, saldo 0, manual — Task 6.
- [x] Build y tests pasan — Task 7.

## Placeholder Scan

- Sin TBD, TODO o referencias a implementación futura.
- Cada paso incluye código completo.
- Comandos de verificación incluidos.
