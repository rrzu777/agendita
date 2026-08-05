import { formatBookingDateTime } from '@/lib/bookings/format-booking-datetime'
import { formatMoney } from '@/lib/money'

type PromotionSummary = {
  discount: number
  finalPrice: number
}

type DepositSummary = {
  label: string
  amount: number
}

function SummaryRow({
  label,
  value,
  className = '',
  valueClassName = 'text-primary',
}: {
  label: string
  value: string
  className?: string
  valueClassName?: string
}) {
  return (
    <div className={`flex justify-between gap-4 ${className}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${valueClassName}`}>{value}</span>
    </div>
  )
}

export function BookingSummary({
  serviceName,
  startsAt,
  timezone,
  price,
  currency,
  promotion,
  deposit,
  emphasizeFinalPrice = false,
  shape = '2xl',
}: {
  serviceName: string
  startsAt?: Date
  timezone: string
  price: number
  currency: string
  promotion?: PromotionSummary
  deposit?: DepositSummary
  emphasizeFinalPrice?: boolean
  shape?: 'xl' | '2xl'
}) {
  const shapeClassName = shape === 'xl' ? 'rounded-xl' : 'rounded-2xl'

  return (
    <div className={`mb-6 space-y-3 ${shapeClassName} bg-muted/55 p-5`}>
      <SummaryRow label="Servicio" value={serviceName} />
      <SummaryRow
        label="Fecha y hora"
        value={startsAt ? formatBookingDateTime(startsAt, timezone) : ''}
      />
      <SummaryRow label="Precio total" value={formatMoney(price, currency)} />
      {promotion && (
        <>
          <SummaryRow
            label="Descuento"
            value={`−${formatMoney(promotion.discount, currency)}`}
            valueClassName="text-green-700"
          />
          <SummaryRow
            label="Precio final"
            value={formatMoney(promotion.finalPrice, currency)}
            className={emphasizeFinalPrice ? 'border-t border-border/60 pt-3' : ''}
          />
        </>
      )}
      {deposit && (
        <SummaryRow
          label={deposit.label}
          value={formatMoney(deposit.amount, currency)}
          className="border-t border-border/60 pt-3"
        />
      )}
    </div>
  )
}
