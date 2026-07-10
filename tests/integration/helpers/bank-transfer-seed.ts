import { addMinutes } from 'date-fns'
import { prisma } from '@/lib/db'
import { btDeclaredId } from '@/lib/bank-transfer/declared'

// Helpers compartidos por los tests de integración de "verificar transferencia"
// (Tasks 1, 3, 4, 5, 6 del plan PR C). El negocio/usuario/servicio/cuenta se
// crean una sola vez (idempotente) y cada seedDeclaredTransfer agrega un cliente
// + reserva + Payment declarado nuevos, con un slot único por llamada para que
// las validaciones de solape de un test no choquen con reservas de otro.

export const BT_VERIFY_BIZ = 'btv-biz-1'
export const BT_VERIFY_OWNER = 'btv-owner-1'
export const BT_VERIFY_SLUG = 'btv-biz'
export const BT_VERIFY_SVC = 'btv-svc-1'

// El slug es la clave que usa el mock de auth (literal, sin binding) para
// resolver requireBusiness()/requireBusinessRole() al negocio sembrado.

let slotCounter = 0

function nextSlot(): { startDateTime: Date; endDateTime: Date } {
  slotCounter += 1
  // Base futura (para no chocar con lead-time), separando cada llamada por días
  // distintos → slots que no se solapan entre tests.
  const start = new Date()
  start.setUTCDate(start.getUTCDate() + 5 + slotCounter)
  start.setUTCHours(15, 0, 0, 0)
  return { startDateTime: start, endDateTime: addMinutes(start, 60) }
}

async function ensureBusiness(): Promise<void> {
  await prisma.user.upsert({
    where: { id: BT_VERIFY_OWNER },
    update: {},
    create: { id: BT_VERIFY_OWNER, email: 'btv-owner@btv.test', name: 'BTV Owner' },
  })
  await prisma.business.upsert({
    where: { id: BT_VERIFY_BIZ },
    update: {},
    create: {
      id: BT_VERIFY_BIZ,
      name: 'BTV Biz',
      slug: BT_VERIFY_SLUG,
      subdomain: 'btvbiz',
      ownerUserId: BT_VERIFY_OWNER,
      city: 'Santiago',
      country: 'CL',
      currency: 'CLP',
      timezone: 'America/Santiago',
      bookingWindowDays: 90,
    },
  })
  await prisma.businessUser.upsert({
    where: { businessId_userId: { businessId: BT_VERIFY_BIZ, userId: BT_VERIFY_OWNER } },
    update: {},
    create: { id: 'btv-bu-1', businessId: BT_VERIFY_BIZ, userId: BT_VERIFY_OWNER, role: 'owner' },
  })
  await prisma.bankTransferAccount.upsert({
    where: { businessId: BT_VERIFY_BIZ },
    update: { isEnabled: true, verifyHours: 48 },
    create: {
      businessId: BT_VERIFY_BIZ,
      accountHolder: 'BTV Holder',
      rut: '1-9',
      bankName: 'BancoEstado',
      accountType: 'vista',
      accountNumber: '123',
      isEnabled: true,
      holdHours: 24,
      verifyHours: 48,
    },
  })
  await prisma.service.upsert({
    where: { id: BT_VERIFY_SVC },
    update: {},
    create: {
      id: BT_VERIFY_SVC,
      businessId: BT_VERIFY_BIZ,
      name: 'Corte',
      durationMinutes: 60,
      price: 20000,
      depositAmount: 10000,
      pastelColor: '#FFD700',
    },
  })
}

export interface SeedDeclaredTransferOptions {
  /** Email del cliente. `undefined` → default; `null` → cliente sin email. */
  customerEmail?: string | null
  /** Abono requerido de la reserva (y monto por defecto del Payment declarado). */
  depositRequired?: number
  /** Monto del Payment declarado. Default = depositRequired. */
  amount?: number
  /** finalAmount/remainingBalance de la reserva. Default 20000. */
  finalAmount?: number
  /** hold de la reserva. `undefined` → futuro (+1h); `null` → sin hold. */
  holdExpiresAt?: Date | null
  /** Override del slot (si no, se asigna uno único por llamada). */
  startDateTime?: Date
  endDateTime?: Date
}

export interface SeededDeclaredTransfer {
  businessId: string
  bookingId: string
  paymentId: string
  serviceId: string
  customerId: string
  startDateTime: Date
  endDateTime: Date
}

export async function seedDeclaredTransfer(
  opts: SeedDeclaredTransferOptions = {},
): Promise<SeededDeclaredTransfer> {
  await ensureBusiness()

  const depositRequired = opts.depositRequired ?? 10000
  const finalAmount = opts.finalAmount ?? 20000
  const remainingBalance = finalAmount
  const amount = opts.amount ?? depositRequired
  const holdExpiresAt =
    opts.holdExpiresAt === undefined ? new Date(Date.now() + 3_600_000) : opts.holdExpiresAt

  const slot =
    opts.startDateTime && opts.endDateTime
      ? { startDateTime: opts.startDateTime, endDateTime: opts.endDateTime }
      : nextSlot()

  const customerEmail = opts.customerEmail === undefined ? 'cliente@btv.test' : opts.customerEmail

  const customer = await prisma.customer.create({
    data: {
      businessId: BT_VERIFY_BIZ,
      name: 'Ana Cliente',
      phone: `+5691100${String(slotCounter).padStart(4, '0')}`,
      email: customerEmail ?? null,
    },
  })

  const booking = await prisma.booking.create({
    data: {
      businessId: BT_VERIFY_BIZ,
      serviceId: BT_VERIFY_SVC,
      customerId: customer.id,
      startDateTime: slot.startDateTime,
      endDateTime: slot.endDateTime,
      status: 'pending_payment',
      totalPrice: finalAmount,
      depositRequired,
      depositPaid: 0,
      remainingBalance,
      discountAmount: 0,
      finalAmount,
      paymentStatus: 'unpaid',
      paymentMethod: 'bank_transfer',
      holdExpiresAt,
    },
  })

  const payment = await prisma.payment.create({
    data: {
      businessId: BT_VERIFY_BIZ,
      bookingId: booking.id,
      customerId: customer.id,
      provider: 'manual',
      providerPaymentId: btDeclaredId(booking.id),
      amount,
      currency: 'CLP',
      status: 'pending',
      paymentType: 'deposit',
      paymentMethod: 'Transferencia',
    },
  })

  return {
    businessId: BT_VERIFY_BIZ,
    bookingId: booking.id,
    paymentId: payment.id,
    serviceId: BT_VERIFY_SVC,
    customerId: customer.id,
    startDateTime: slot.startDateTime,
    endDateTime: slot.endDateTime,
  }
}

export async function seedConfirmedBooking({
  businessId,
  serviceId,
  startDateTime,
  endDateTime,
}: {
  businessId: string
  serviceId: string
  startDateTime: Date
  endDateTime: Date
}): Promise<{ bookingId: string; customerId: string }> {
  const customer = await prisma.customer.create({
    data: {
      businessId,
      name: 'Otra Cliente',
      phone: `+5691199${String(Date.now()).slice(-6)}`,
    },
  })
  const booking = await prisma.booking.create({
    data: {
      businessId,
      serviceId,
      customerId: customer.id,
      startDateTime,
      endDateTime,
      status: 'confirmed',
      totalPrice: 20000,
      depositRequired: 10000,
      depositPaid: 10000,
      remainingBalance: 10000,
      discountAmount: 0,
      finalAmount: 20000,
      paymentStatus: 'deposit_paid',
    },
  })
  return { bookingId: booking.id, customerId: customer.id }
}

/** Borra todo lo sembrado por estos helpers (para afterAll). */
export async function cleanupBankTransferSeed(): Promise<void> {
  await prisma.payment.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await prisma.booking.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await prisma.customer.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await prisma.bankTransferAccount.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await prisma.service.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await prisma.availabilityRule.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await prisma.businessUser.deleteMany({ where: { businessId: BT_VERIFY_BIZ } })
  await prisma.business.deleteMany({ where: { id: BT_VERIFY_BIZ } })
  await prisma.user.deleteMany({ where: { id: BT_VERIFY_OWNER } })
}
