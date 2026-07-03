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
