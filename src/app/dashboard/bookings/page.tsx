import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { getBookings } from '@/server/actions/bookings'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { updateBookingStatus } from '@/server/actions/bookings'
import { CalendarDays, Clock, User, CreditCard, Phone, Plus, RefreshCw } from 'lucide-react'
import { BookingContactButtons } from '@/components/dashboard/booking-contact-buttons'
import { CancelBookingButton } from '@/components/dashboard/cancel-booking-button'
import { ManualPaymentDialog } from '@/components/dashboard/manual-payment-dialog'
import { isManualPaymentAllowed } from '@/components/dashboard/manual-payment-utils'
import { formatBookingNumber } from '@/lib/bookings/number'
import { formatMoney } from '@/lib/money'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { PaymentRevertedBadge } from '@/components/dashboard/payment-reverted-badge'
import { BookingRowActions } from '@/components/dashboard/booking-row-actions'
import { ReviveBookingButton } from '@/components/dashboard/revive-booking-dialog'
import { getReviveReopenState } from '@/components/dashboard/revive-utils'
import { PendingTransfersSection, type PendingTransferItem } from '@/components/dashboard/pending-transfers-section'
import { BT_BALANCE_PREFIX, hasPendingBalanceTransfer, hasPendingDeclaredTransfer } from '@/lib/bank-transfer/declared'
import { getBankTransferInfo } from '@/server/actions/bank-transfer-public'

const PENDING_TRANSFER_BADGE_CLASS =
  'inline-flex items-center rounded-md border border-transparent bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800 dark:bg-orange-500/15 dark:text-orange-300'

const PENDING_BALANCE_BADGE_CLASS =
  'inline-flex items-center rounded-md border border-transparent bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'

function EmptyState() {
  return (
    <div className="studio-card p-8 text-center">
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
        <CalendarDays className="size-7 text-muted-foreground" />
      </div>
      <h3 className="mb-2 text-lg font-semibold text-primary">No tienes reservas todavía</h3>
      <p className="mb-6 text-sm text-muted-foreground">
        Cuando un cliente reserve a través de tu enlace, aparecerá aquí.
      </p>
    </div>
  )
}

export function BookingCard({ booking, businessCurrency, businessTimezone, businessAddress, transferEnabled }: {
  booking: {
    id: string
    bookingNumber: number | null
    startDateTime: Date
    status: string
    depositPaid: number
    depositRequired: number
    finalAmount: number
    paymentStatus: string
    totalPrice: number
    remainingBalance: number
    paymentMethod?: string | null
    service: { name: string } | null
    customer: { name: string; phone: string | null; email?: string | null } | null
    payments: { id: string; providerPaymentId?: string | null }[]
  }
  businessCurrency: string
  businessTimezone: string
  businessAddress: string | null
  transferEnabled?: boolean
}) {
  const canRegisterPayment = isManualPaymentAllowed(booking)
  const isPendingTransfer = hasPendingDeclaredTransfer(booking)
  const isPendingBalanceTransfer = hasPendingBalanceTransfer(booking)
  const reviveState = booking.status === 'expired'
    ? getReviveReopenState({ startDateTime: booking.startDateTime, paymentMethod: booking.paymentMethod ?? null }, !!transferEnabled)
    : null

  return (
    <article className="studio-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-primary truncate">{booking.service?.name || 'Servicio'}</h3>
          <p className="text-sm text-muted-foreground">{formatBookingNumber(booking.bookingNumber, booking.id)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {isPendingTransfer ? (
            <span className={PENDING_TRANSFER_BADGE_CLASS}>Transferencia por verificar</span>
          ) : (
            <StatusBadge status={booking.status} />
          )}
          {isPendingBalanceTransfer && (
            <span className={PENDING_BALANCE_BADGE_CLASS}>Saldo por verificar</span>
          )}
        </div>
      </div>

      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-3 text-sm">
          <Clock className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            {new Date(booking.startDateTime).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: businessTimezone })}
            {' · '}
            {new Date(booking.startDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: businessTimezone })}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <User className="size-4 text-muted-foreground" />
          <span className="text-primary">{booking.customer?.name || 'Sin cliente'}</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <CreditCard className="size-4 text-muted-foreground" />
          <span className={booking.paymentStatus === 'fully_paid' ? 'text-green-700' : 'text-primary'}>
            {formatMoney(booking.depositPaid, businessCurrency)} de {formatMoney(booking.finalAmount, businessCurrency)}
          </span>
          <PaymentRevertedBadge paymentStatus={booking.paymentStatus} />
        </div>
        {booking.customer?.phone && (
          <div className="flex items-center gap-3 text-sm">
            <Phone className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">{booking.customer.phone}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <BookingContactButtons
          variant="compact"
          booking={{
            bookingNumber: booking.bookingNumber,
            customerName: booking.customer?.name || '',
            customerPhone: booking.customer?.phone || null,
            serviceName: booking.service?.name || '',
            startDateTime: booking.startDateTime.toISOString(),
            businessTimezone,
            businessCurrency,
            totalPrice: booking.totalPrice ?? 0,
            depositPaid: booking.depositPaid,
            remainingBalance: booking.remainingBalance ?? 0,
            businessAddress,
          }}
        />
      </div>

      {booking.status === 'confirmed' && (
        <div className="mt-4 flex gap-2 border-t border-border/50 pt-4">
          <form action={async () => {
            'use server'
            // Sin UI de error en esta card (vista móvil): si falla, la reserva
            // simplemente no se completa (misma semántica silenciosa que
            // TimeBlockList.handleDelete). El fallback con feedback vive en
            // BookingRowActions (tabla de escritorio).
            const res = await updateBookingStatus(booking.id, 'completed')
            if (!res.ok) return
          }} className="flex-1">
            <Button type="submit" variant="outline" className="w-full h-10 text-sm font-semibold">
              Completar
            </Button>
          </form>
          {/* prefetch={false}: esta card se renderiza por CADA reserva confirmada
              y getBookings() no está paginado; sin esto, cada fila visible haría
              un prefetch de su ruta de reprogramar (O(reservas)). Reprogramar es
              acción poco frecuente: fetch on-click alcanza. */}
          <Link href={`/dashboard/bookings/${booking.id}/reschedule`} prefetch={false} className="flex-1">
            <Button type="button" variant="outline" className="w-full h-10 text-sm font-semibold">
              <RefreshCw className="mr-1 size-3" />
              Reprogramar
            </Button>
          </Link>
          <div className="flex-1">
            <CancelBookingButton bookingId={booking.id} size="default" />
          </div>
          {canRegisterPayment && (
            <ManualPaymentDialog
              bookings={[booking]}
              businessCurrency={businessCurrency}
              defaultBookingId={booking.id}
              triggerVariant="outline"
              triggerClassName="flex-1 h-10 text-sm font-semibold"
            />
          )}
        </div>
      )}
      {booking.status === 'pending_payment' && (
        <div className="mt-4 flex gap-2 border-t border-border/50 pt-4">
          {canRegisterPayment && (
            <ManualPaymentDialog
              bookings={[booking]}
              businessCurrency={businessCurrency}
              defaultBookingId={booking.id}
              triggerVariant="outline"
              triggerClassName="flex-1 h-10 text-sm font-semibold"
            />
          )}
          {booking.status === 'pending_payment' && (
            <CancelBookingButton bookingId={booking.id} size="default" />
          )}
        </div>
      )}
      {booking.status === 'completed' && canRegisterPayment && (
        // Recobro (spec FU-B4b-3 §6): completed con saldo (post-chargeback o
        // saldo tras atender) — solo registrar pago, sin cancelar/reprogramar.
        <div className="mt-4 flex gap-2 border-t border-border/50 pt-4">
          <ManualPaymentDialog
            bookings={[booking]}
            businessCurrency={businessCurrency}
            defaultBookingId={booking.id}
            triggerVariant="outline"
            triggerClassName="flex-1 h-10 text-sm font-semibold"
          />
        </div>
      )}
      {reviveState && (
        <div className="mt-4 flex gap-2 border-t border-border/50 pt-4">
          <ReviveBookingButton
            bookingId={booking.id}
            serviceName={booking.service?.name || 'Servicio'}
            customerName={booking.customer?.name || 'Cliente'}
            customerHasEmail={!!booking.customer?.email}
            canReopen={reviveState.canReopen}
            reopenDisabledReason={reviveState.reason}
            triggerClassName="flex-1 h-10 text-sm font-semibold"
          />
        </div>
      )}
    </article>
  )
}

export default async function BookingsPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const bookings = await getBookings()
  const businessCurrency = userData.business.currency || 'CLP'
  const businessTimezone = userData.business.timezone || 'America/Santiago'
  const businessAddress = userData.business.addressText || null
  // Solo alimenta el revive-UI de las expiradas: sin expiradas, ni consultamos.
  const transferEnabled = bookings.some(b => b.status === 'expired')
    ? !!(await getBankTransferInfo(userData.business.id))
    : false

  const confirmedCount = bookings.filter(b => b.status === 'confirmed').length
  const pendingCount = bookings.filter(b => b.status === 'pending_payment').length

  // Race orphans (spec §5): una reserva cancelada/expirada puede haber quedado
  // con un Payment pending sin barrer; no la mostramos como "por verificar".
  const pendingTransfers: PendingTransferItem[] = bookings
    .filter((b) => !['cancelled', 'expired'].includes(b.status))
    .flatMap((b) =>
      b.payments
        .filter((p) => p.providerPaymentId != null)
        .map((p) => ({
          paymentId: p.id,
          bookingId: b.id,
          customerName: b.customer?.name || 'Sin cliente',
          customerPhone: b.customer?.phone ?? null,
          serviceName: b.service?.name || 'Servicio',
          startDateTime: b.startDateTime,
          amount: p.amount,
          declaredAt: p.createdAt,
          proofKey: p.proofKey,
          proofContentType: p.proofContentType,
          kind: (p.providerPaymentId!.startsWith(BT_BALANCE_PREFIX) ? 'balance' : 'deposit') as PendingTransferItem['kind'],
        })),
    )

  return (
    <div>
      <DashboardHeader
        title="Reservas"
        subtitle="Administra tus citas y el estado de tus reservas."
      />
      <div className="space-y-6 p-5 md:p-10">
        <Link href="/dashboard/bookings/new">
          <Button className="h-11 rounded-lg font-semibold shadow-[0_14px_32px_rgba(51,41,32,0.18)]">
            <Plus className="mr-2 size-4" />
            Nueva reserva
          </Button>
        </Link>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Total</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{bookings.length}</p>
          </div>
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Confirmadas</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{confirmedCount}</p>
          </div>
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Pendientes de pago</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{pendingCount}</p>
          </div>
        </div>

        <PendingTransfersSection
          items={pendingTransfers}
          businessCurrency={businessCurrency}
          businessTimezone={businessTimezone}
        />

        {bookings.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="hidden lg:block studio-card overflow-hidden">
              <Table fixed className={TABLE_MIN_WIDTH}>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Servicio</TableHead>
                    <TableHead className={TABLE_COL.date}>Fecha</TableHead>
                    <TableHead className={TABLE_COL.customer}>Cliente</TableHead>
                    <TableHead className={TABLE_COL.status}>Estado</TableHead>
                    <TableHead className={TABLE_COL.money}>Pago</TableHead>
                    <TableHead className={`${TABLE_COL.actions} text-right`}>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((booking) => (
                    <TableRow key={booking.id}>
                      <TruncatedCell
                        className="font-semibold text-primary"
                        primary={booking.service?.name || 'Servicio'}
                        secondary={formatBookingNumber(booking.bookingNumber, booking.id)}
                      />
                      <TableCell className={TABLE_COL.date}>
                        <div>{new Date(booking.startDateTime).toLocaleDateString('es-CL', { timeZone: businessTimezone })}</div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(booking.startDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: businessTimezone })}
                        </div>
                      </TableCell>
                      <TruncatedCell className={TABLE_COL.customer} primary={booking.customer?.name || '—'} />
                      <TableCell className={TABLE_COL.status}>
                        <div className="flex flex-col items-start gap-1">
                          {hasPendingDeclaredTransfer(booking) ? (
                            <span className={PENDING_TRANSFER_BADGE_CLASS}>Transferencia por verificar</span>
                          ) : (
                            <StatusBadge status={booking.status} />
                          )}
                          {hasPendingBalanceTransfer(booking) && (
                            <span className={PENDING_BALANCE_BADGE_CLASS}>Saldo por verificar</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={`${TABLE_COL.money} whitespace-normal`}>
                        <span className={booking.paymentStatus === 'fully_paid' ? 'font-semibold text-green-700' : 'font-semibold text-primary'}>
                          {formatMoney(booking.depositPaid, businessCurrency)} / {formatMoney(booking.finalAmount, businessCurrency)}
                        </span>
                        {booking.remainingBalance > 0 && (
                          <div className="text-xs text-muted-foreground">
                            Saldo: {formatMoney(booking.remainingBalance, businessCurrency)}
                          </div>
                        )}
                        <PaymentRevertedBadge paymentStatus={booking.paymentStatus} />
                      </TableCell>
                      <TableCell className={`${TABLE_COL.actions} text-right`}>
                        <BookingRowActions
                          booking={booking}
                          businessCurrency={businessCurrency}
                          transferEnabled={transferEnabled}
                          contact={
                            <BookingContactButtons
                              variant="compact"
                              booking={{
                                bookingNumber: booking.bookingNumber,
                                customerName: booking.customer?.name || '',
                                customerPhone: booking.customer?.phone || null,
                                serviceName: booking.service?.name || '',
                                startDateTime: booking.startDateTime.toISOString(),
                                businessTimezone,
                                businessCurrency,
                                totalPrice: booking.totalPrice,
                                depositPaid: booking.depositPaid,
                                remainingBalance: booking.remainingBalance,
                                businessAddress,
                              }}
                            />
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-4 lg:hidden">
              {bookings.map((booking) => (
                <BookingCard
                  key={booking.id}
                  booking={booking}
                  businessCurrency={businessCurrency}
                  businessTimezone={businessTimezone}
                  businessAddress={businessAddress}
                  transferEnabled={transferEnabled}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
