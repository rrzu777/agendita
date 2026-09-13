/** Presentation only; all amounts are revalidated at the booking transaction. */
export function bookingPricePreview(
  base: { price: number; deposit: number; serviceCount: number },
  prepaid?: { discountAmount?: number; depositRequired?: number } | null,
  promo?: { finalAmount: number; depositRequired?: number } | null,
) {
  const finalPrice = prepaid ? Math.max(0, base.price - (prepaid.discountAmount ?? (base.serviceCount === 1 ? base.price : 0))) : promo?.finalAmount ?? base.price
  const deposit = prepaid ? prepaid.depositRequired ?? Math.min(base.deposit, finalPrice) : promo?.depositRequired ?? Math.min(base.deposit, finalPrice)
  return { finalPrice, deposit }
}
export const STALE_BOOKING_QUOTE_MESSAGE = 'Los servicios o beneficios cambiaron. Actualiza la página para revisar precios y horarios antes de reservar.'
