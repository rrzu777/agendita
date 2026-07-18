import type { Customer, Prisma } from '@prisma/client'
import { normalizePhone } from '@/lib/customers/phone'
import { linkCustomerFromBookingSession } from '@/lib/customers/link'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-lock'

export interface FindOrCreateCustomerInput {
  businessId: string
  phone: string
  name: string
  email?: string | null
  /** Cumpleaños (medianoche UTC). Se setea al crear y backfillea sin pisar. */
  birthDate?: Date | null
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
  // Cierra la carrera check-then-act: sin lock, dos requests concurrentes con el
  // mismo teléfono nuevo pasan ambas el findFirst (null) y crean dos Customers
  // (ficha duplicada → parte loyalty/paquetes/historial). El lock serializa
  // find-or-create por (businessId, phone). Se libera al commit de la tx.
  await acquireAdvisoryXactLock(tx, `customer:${input.businessId}:${phone}`)
  let customer = await tx.customer.findFirst({ where: { phone, businessId: input.businessId } })
  let created = false

  if (customer) {
    if (input.email && !customer.email) {
      await tx.customer.update({ where: { id: customer.id }, data: { email: input.email } })
      customer = { ...customer, email: input.email }
    }
    if (input.birthDate && !customer.birthDate) {
      await tx.customer.update({ where: { id: customer.id }, data: { birthDate: input.birthDate } })
      customer = { ...customer, birthDate: input.birthDate }
    }
  } else {
    customer = await tx.customer.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        phone,
        email: input.email || null,
        birthDate: input.birthDate ?? null,
      },
    })
    created = true
  }

  if (input.sessionUser) {
    await linkCustomerFromBookingSession(tx, customer, input.sessionUser, input.businessId)
  }

  return { customer, created }
}
