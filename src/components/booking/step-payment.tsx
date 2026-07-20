'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BookingData } from './wizard'
import { createBooking } from '@/server/actions/bookings'
import { previewPromotion } from '@/server/actions/promotions'
import { usePackageAvailability } from '@/lib/packages/use-package-availability'
import { initiatePayment, verifyAndConfirmPayment, getOnlinePaymentAvailability } from '@/server/actions/payments'
import { getBankTransferInfo, declareBankTransfer } from '@/server/actions/bank-transfer-public'
import { BANK_TRANSFER_METHOD } from '@/lib/bank-transfer/declared'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'
import { TransferDetails } from './transfer-details'
import { formatMoney } from '@/lib/money'
import { AlertCircle, Clock, Loader2 } from 'lucide-react'
import { formatBookingDateTime } from '@/lib/booking/format-booking-datetime'

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Fallback para entornos sin crypto.randomUUID (muy poco probable en navegadores modernos)
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function LegalAcceptanceLabel() {
  return (
    <span>
      Acepto la{' '}
      <a href="/refund-policy" target="_blank" className="font-semibold text-primary underline">
        política de cancelación y reembolso
      </a>{' '}
      del negocio, la{' '}
      <a href="/privacy" target="_blank" className="font-semibold text-primary underline">
        Política de Privacidad
      </a>{' '}
      y los{' '}
      <a href="/terms" target="_blank" className="font-semibold text-primary underline">
        Términos y Condiciones
      </a>{' '}
      de Agendita
    </span>
  )
}

function BusinessCancellationPolicy({ policy }: { policy?: string | null }) {
  if (!policy) return null
  return (
    <div className="mb-4 rounded-xl border border-border/70 bg-muted/40 p-4 text-sm text-muted-foreground">
      <p className="font-semibold text-primary">Política de cancelación del negocio</p>
      <p className="mt-1 whitespace-pre-line">{policy}</p>
    </div>
  )
}

export function StepPayment({ data, updateData, businessId, timezone, currency, cancellationPolicy, referralToken, onSuccess, onBack }: { data: BookingData; updateData: (partial: Partial<BookingData>) => void; businessId: string; timezone: string; currency: string; cancellationPolicy?: string | null; referralToken?: string; onSuccess: (id: string, mode: 'paid' | 'pending', promo?: { discountAmount: number; finalAmount: number } | null, bookingNumber?: number | null) => void; onBack: () => void }) {
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'review' | 'processing' | 'success' | 'error' | 'transfer-details' | 'transfer-declared'>('review')
  const [bankInfo, setBankInfo] = useState<BankTransferPublicInfo | null>(null)
  const [method, setMethod] = useState<'online' | 'transfer'>('online')
  const [transferBooking, setTransferBooking] = useState<{ id: string; bookingNumber: number | null; deadline: Date | null } | null>(null)
  const [declaring, setDeclaring] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [availabilityError, setAvailabilityError] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [availability, setAvailability] = useState<{
    available: boolean
    provider: string | null
    reason?: string
    isMock: boolean
  } | null>(null)

  // El estado del código vive en este componente a propósito: StepPayment se
  // desmonta al ir "Atrás" (render condicional sin key en el wizard), así que el
  // código aplicado se limpia solo si la clienta cambia servicio/teléfono y vuelve.
  // Por eso acá NO hace falta el guard de "limpiar promo al cambiar servicio" que
  // sí tiene new-booking-form (componente long-lived). Si un refactor futuro sube
  // el promo a BookingData o agrega key/keep-alive, reintroducir ese guard.
  const [promoCode, setPromoCode] = useState('')
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discount: number; finalAmount: number } | null>(null)
  const [promoError, setPromoError] = useState<string | null>(null)
  const [promoPending, setPromoPending] = useState(false)

  // Paquete prepago: si la clienta tiene sesiones que cubren este servicio, se
  // ofrece usarlas (precedencia sobre promo). El servidor aplica el paquete en la
  // transacción; skipPackage:!usePackage respeta la elección de la clienta.
  const { remaining: packageRemaining, usePackage, setUsePackage } =
    usePackageAvailability(businessId, data.customerPhone, data.serviceId)

  const packageCovers = packageRemaining > 0 && usePackage

  // Valores efectivos: reflejan lo que el servidor cobrará (el servidor sigue siendo
  // autoritativo; esto es solo display). Un paquete que cubre el servicio deja la
  // reserva en $0 (el servidor la marca confirmada/pagada), así que tiene precedencia
  // sobre el código. depositRequired espeja la lógica server: min(depositAmount, finalAmount).
  const effectiveFinalPrice = packageCovers
    ? 0
    : appliedPromo
      ? appliedPromo.finalAmount
      : data.servicePrice
  const effectiveDeposit = packageCovers
    ? 0
    : appliedPromo
      ? Math.min(data.serviceDeposit, appliedPromo.finalAmount)
      : data.serviceDeposit

  // Un código 100%-off (finalAmount <= 0) o un paquete que cubre el servicio hacen que
  // la reserva no requiera pago online: el servidor la marca confirmada/pagada. Se trata
  // como path gratuito para no mostrar un botón "Pagar abono $0" ni llamar initiatePayment.
  const promoMakesFree = (appliedPromo != null && appliedPromo.finalAmount <= 0) || packageCovers

  const noDepositNeeded = effectiveDeposit <= 0
  const isFreeService = effectiveFinalPrice <= 0

  async function handleApplyPromo() {
    const code = promoCode.trim()
    if (!code || !data.serviceId) return
    setPromoPending(true)
    setPromoError(null)
    try {
      const res = await previewPromotion({
        businessId,
        code,
        serviceId: data.serviceId,
        phone: data.customerPhone || undefined,
      })
      if (res.ok) {
        setAppliedPromo({ code, discount: res.discount, finalAmount: res.finalAmount })
        setPromoError(null)
      } else {
        setPromoError(res.message)
        setAppliedPromo(null)
      }
    } catch {
      setPromoError('No se pudo validar el código')
      setAppliedPromo(null)
    } finally {
      setPromoPending(false)
    }
  }

  function handleRemovePromo() {
    setAppliedPromo(null)
    setPromoCode('')
    setPromoError(null)
  }

  const promoSection = (
      <div className="mb-6 rounded-xl border border-border/60 bg-card p-4">
        <label htmlFor="promo-code" className="text-sm font-semibold text-primary">
          ¿Tienes un código de descuento?
        </label>
        {appliedPromo ? (
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Código</span>
              <span className="font-semibold text-primary">{appliedPromo.code}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Descuento</span>
              <span className="font-semibold text-green-700">−{formatMoney(appliedPromo.discount, currency)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Precio final</span>
              <span className="font-semibold text-primary">{formatMoney(appliedPromo.finalAmount, currency)}</span>
            </div>
            <button
              type="button"
              onClick={handleRemovePromo}
              disabled={loading}
              className="font-semibold text-primary underline"
            >
              Quitar
            </button>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <Input
              id="promo-code"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
              placeholder="Ingresa tu código"
              className="h-11"
              disabled={promoPending}
            />
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-full px-6"
              onClick={handleApplyPromo}
              disabled={promoPending || !promoCode.trim() || !data.serviceId}
            >
              {promoPending ? 'Validando...' : 'Aplicar'}
            </Button>
          </div>
        )}
        {promoError && (
          <p className="mt-2 text-sm text-destructive">{promoError}</p>
        )}
      </div>
  )

  const packageSection = packageRemaining > 0 ? (
      <div className="mb-6 rounded-xl border border-border/60 bg-green-50 p-4">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={usePackage}
            onChange={(e) => setUsePackage(e.target.checked)}
            className="mt-0.5 size-4 rounded border-border accent-primary"
          />
          <span>
            <span className="font-semibold text-green-800">Usar mi paquete</span>
            <span className="mt-0.5 block text-green-800">
              Tenés un paquete que cubre este servicio (quedan {packageRemaining} sesiones).
              {usePackage && ' Se usará una sesión y no se cobrará pago.'}
            </span>
          </span>
        </label>
      </div>
  ) : null

  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset-before-async-fetch
     so stale availability isn't shown while re-checking; guarded by the deps. */
  useEffect(() => {
    if (noDepositNeeded) {
      setAvailability(null)
      setAvailabilityError('')
      return
    }
    setAvailability(null)
    setAvailabilityError('')
    Promise.all([getOnlinePaymentAvailability(businessId), getBankTransferInfo(businessId)])
      .then(([avail, bank]) => {
        setAvailability(avail)
        setBankInfo(bank)
      })
      .catch(() => {
        const reason = 'No pudimos verificar pago online. Puedes confirmar la reserva y el negocio coordinará el abono.'
        setAvailabilityError(reason)
        setAvailability({
          available: false,
          provider: null,
          isMock: false,
          reason,
        })
        setBankInfo(null)
      })
  }, [businessId, noDepositNeeded])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Generar una key estable por montaje de StepPayment.
  // Retry dentro del mismo montaje (ej. "Intentar de nuevo") usa la misma key.
  // Si el usuario va "Atrás" y vuelve, el componente se remonta → nueva key.
  const idempotencyKey = useMemo(() => data.idempotencyKey || generateIdempotencyKey(), [data.idempotencyKey])

  // Persistir la key en el estado del wizard: si la clienta vuelve atrás y
  // re-entra (p.ej. eligió transferencia y se arrepintió a MP), el remount
  // reusa la MISMA key → createBooking devuelve la booking existente en vez
  // de chocar contra su propio hold largo.
  useEffect(() => {
    if (!data.idempotencyKey) updateData({ idempotencyKey })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateData es estable (setState del wizard)
  }, [data.idempotencyKey, idempotencyKey])

  // Argumentos comunes de createBooking a los tres handlers (online / manual /
  // transferencia). Cada handler pasa solo lo que difiere (p.ej. paymentMethod).
  function bookingInput(extra?: { paymentMethod?: typeof BANK_TRANSFER_METHOD }) {
    return {
      serviceId: data.serviceId!,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail,
      customerBirthDate: data.customerBirthDate || undefined,
      startDateTime: data.timeSlot!.start,
      idempotencyKey,
      acceptedTerms,
      promotionCode: appliedPromo?.code,
      referralToken,
      skipPackage: !usePackage,
      ...extra,
    }
  }

  async function handleTransferBooking() {
    setLoading(true)
    setStep('processing')
    setErrorMessage('')
    try {
      const booking = await createBooking(bookingInput({ paymentMethod: BANK_TRANSFER_METHOD }), businessId)
      setTransferBooking({
        id: booking.id,
        bookingNumber: booking.bookingNumber ?? null,
        deadline: booking.holdExpiresAt ? new Date(booking.holdExpiresAt) : null,
      })
      setStep('transfer-details')
    } catch (err) {
      console.error('Transfer booking error:', err)
      setErrorMessage(err instanceof Error ? err.message : 'Error al crear la reserva')
      setStep('error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeclare(proof: { proofKey: string; proofContentType: string } | null) {
    if (!transferBooking) return
    setDeclaring(true)
    setErrorMessage('')
    try {
      await declareBankTransfer(transferBooking.id, proof ?? {})
      setStep('transfer-declared')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No pudimos registrar tu aviso')
    } finally {
      setDeclaring(false)
    }
  }

  async function handleManualBooking() {
    setLoading(true)
    setStep('processing')
    setErrorMessage('')

    try {
      const booking = await createBooking(bookingInput(), businessId)

      setStep('success')
      const mode = noDepositNeeded ? 'paid' as const : 'pending' as const
      onSuccess(booking.id, mode, appliedPromo ? { discountAmount: appliedPromo.discount, finalAmount: appliedPromo.finalAmount } : null, booking.bookingNumber)
    } catch (err) {
      console.error('Booking error:', err)
      setErrorMessage(err instanceof Error ? err.message : 'Error al crear la reserva')
      setStep('error')
    } finally {
      setLoading(false)
    }
  }

  async function handlePayment() {
    setLoading(true)
    setStep('processing')
    setErrorMessage('')

    if (effectiveDeposit <= 0) {
      await handleManualBooking()
      return
    }

    try {
      const booking = await createBooking(bookingInput(), businessId)

      const paymentResult = await initiatePayment({
        bookingId: booking.id,
        amount: effectiveDeposit,
        currency: 'CLP',
        description: `Abono para ${data.serviceName}`,
      })

      // Redirect-based providers (Mercado Pago): redirigir al usuario al checkout externo.
      // No llamar verifyAndConfirmPayment: la confirmación ocurre via webhook.
      if (paymentResult.redirectUrl) {
        window.location.href = paymentResult.redirectUrl
        return
      }

      // Flujo sin redirect (mock/dev): verificar y confirmar server-side
      await new Promise(resolve => setTimeout(resolve, 1500))

      const verifyPromise = verifyAndConfirmPayment(paymentResult.paymentId, booking.id)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout al verificar el pago')), 10000)
      )
      await Promise.race([verifyPromise, timeoutPromise])

      setStep('success')
      onSuccess(booking.id, 'paid', appliedPromo ? { discountAmount: appliedPromo.discount, finalAmount: appliedPromo.finalAmount } : null, booking.bookingNumber)
    } catch (err) {
      console.error('Payment error:', err)
      setErrorMessage(err instanceof Error ? err.message : 'Error al procesar el pago')
      setStep('error')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'processing') {
    return (
      <div className="py-14 text-center">
        <Loader2 className="mx-auto mb-4 size-8 animate-spin text-primary" />
        <h2 className="mb-2 font-heading text-2xl font-semibold tracking-tight text-primary">Procesando tu reserva...</h2>
        <p className="text-muted-foreground">Por favor no cierres esta ventana</p>
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div className="py-12 text-center">
        <AlertCircle className="mx-auto mb-4 size-9 text-destructive" />
        <h2 className="mb-2 font-heading text-2xl font-semibold tracking-tight text-primary">Error en el pago</h2>
        <p className="mb-5 text-muted-foreground">{errorMessage || 'No se pudo procesar el pago'}</p>
        <div className="flex justify-center gap-3">
          <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
          <Button className="h-12 rounded-full px-6" onClick={() => setStep('review')}>Intentar de nuevo</Button>
        </div>
      </div>
    )
  }

  if (noDepositNeeded) {
    return (
      <div>
        <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Confirmar reserva</h2>
        <p className="mb-8 text-lg text-muted-foreground">Resumen de tu reserva</p>

        <div className="mb-6 space-y-3 rounded-2xl bg-muted/55 p-5">
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Servicio</span><span className="font-semibold text-primary">{data.serviceName}</span></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fecha y hora</span><span className="font-semibold text-primary">{data.timeSlot ? formatBookingDateTime(data.timeSlot.start, timezone) : ''}</span></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio total</span><span className="font-semibold text-primary">{formatMoney(data.servicePrice, currency)}</span></div>
          {appliedPromo && (
            <>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Descuento</span><span className="font-semibold text-green-700">−{formatMoney(appliedPromo.discount, currency)}</span></div>
              <div className="flex justify-between gap-4 border-t border-border/60 pt-3"><span className="text-muted-foreground">Precio final</span><span className="font-semibold text-primary">{formatMoney(effectiveFinalPrice, currency)}</span></div>
            </>
          )}
        </div>

        {packageSection}
        {!packageCovers && promoSection}

        {isFreeService ? (
          <div className="mb-6 rounded-xl bg-green-50 p-4 text-sm text-green-800">
            <p className="font-semibold">{packageCovers ? 'Tu paquete cubre esta sesión' : promoMakesFree ? 'Tu código cubre el total' : 'Este servicio es gratuito'}</p>
            <p className="mt-1">No requiere pago. Tu reserva será confirmada inmediatamente.</p>
          </div>
        ) : (
          <div className="mb-6 rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
            <p className="font-semibold">Sin abono requerido</p>
            <p className="mt-1">El saldo se paga directamente al negocio.</p>
          </div>
        )}

        <BusinessCancellationPolicy policy={cancellationPolicy} />

        <div className="mb-4 flex items-start gap-3">
          <input
            type="checkbox"
            id="accept-terms"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5 size-4 rounded border-border accent-primary"
          />
          <label htmlFor="accept-terms" className="text-sm text-muted-foreground">
            <LegalAcceptanceLabel />
          </label>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack} disabled={loading}>Atrás</Button>
          <Button className="h-12 flex-1 rounded-full text-base font-semibold" onClick={handleManualBooking} disabled={loading || !acceptedTerms}>
            {loading ? 'Confirmando...' : 'Confirmar reserva'}
          </Button>
        </div>
      </div>
    )
  }

  if (availability && !availability.available) {
    return (
      <div>
        <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Confirmar reserva</h2>
        <p className="mb-8 text-lg text-muted-foreground">Resumen de tu reserva</p>

        <div className="mb-6 space-y-3 rounded-2xl bg-muted/55 p-5">
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Servicio</span><span className="font-semibold text-primary">{data.serviceName}</span></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fecha y hora</span><span className="font-semibold text-primary">{data.timeSlot ? formatBookingDateTime(data.timeSlot.start, timezone) : ''}</span></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio total</span><span className="font-semibold text-primary">{formatMoney(data.servicePrice, currency)}</span></div>
          {appliedPromo && (
            <>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Descuento</span><span className="font-semibold text-green-700">−{formatMoney(appliedPromo.discount, currency)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio final</span><span className="font-semibold text-primary">{formatMoney(effectiveFinalPrice, currency)}</span></div>
            </>
          )}
          <div className="flex justify-between gap-4 border-t border-border/60 pt-3"><span className="text-muted-foreground">Abono requerido</span><span className="font-semibold text-primary">{formatMoney(effectiveDeposit, currency)}</span></div>
        </div>

        {packageSection}
        {!packageCovers && promoSection}

        {!bankInfo && (
        <div className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">
              {availabilityError || 'Este negocio coordina el abono directamente contigo'}
            </p>
            {!availabilityError && (
              <p className="mt-1">Tu reserva quedará pendiente hasta que el negocio confirme el abono.</p>
            )}
          </div>
        </div>
        )}

        {bankInfo && (
          <div className="mb-6 rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
            <p className="font-semibold">Abono por transferencia bancaria</p>
            <p className="mt-1">Te mostramos los datos de la cuenta y nos avisás cuando transfieras. El negocio verifica y confirma tu reserva.</p>
          </div>
        )}

        <BusinessCancellationPolicy policy={cancellationPolicy} />

        <div className="mb-4 flex items-start gap-3">
          <input
            type="checkbox"
            id="accept-terms"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5 size-4 rounded border-border accent-primary"
          />
          <label htmlFor="accept-terms" className="text-sm text-muted-foreground">
            <LegalAcceptanceLabel />
          </label>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack} disabled={loading}>Atrás</Button>
          {bankInfo ? (
            <Button className="h-12 flex-1 rounded-full text-base font-semibold" onClick={handleTransferBooking} disabled={loading || !acceptedTerms}>
              {loading ? 'Creando reserva...' : 'Continuar con transferencia'}
            </Button>
          ) : (
            <Button className="h-12 flex-1 rounded-full text-base font-semibold" onClick={handleManualBooking} disabled={loading || !acceptedTerms}>
              {loading ? 'Creando reserva...' : 'Confirmar reserva'}
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (step === 'transfer-details' && bankInfo && transferBooking) {
    return (
      <div>
        <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Transferí el abono</h2>
        <p className="mb-6 text-lg text-muted-foreground">Tu horario queda reservado mientras transferís</p>
        {errorMessage && <p className="mb-4 text-sm text-destructive">{errorMessage}</p>}
        <TransferDetails bank={bankInfo} amount={effectiveDeposit} currency={currency} deadline={transferBooking.deadline} timezone={timezone} declaring={declaring} onDeclare={handleDeclare} bookingId={transferBooking.id} />
        <p className="mt-4 text-sm text-muted-foreground">
          También podés avisar más tarde desde{' '}
          <a className="font-semibold text-primary underline" href={`/book/confirmation?bookingId=${transferBooking.id}`}>tu página de reserva</a>
          {' '}(te mandamos los datos por email si dejaste uno).
        </p>
      </div>
    )
  }

  if (step === 'transfer-declared' && transferBooking) {
    return (
      <div className="py-10 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-amber-50">
          <Clock className="size-8 text-amber-500" />
        </div>
        <h2 className="mb-2 font-heading text-2xl font-semibold tracking-tight text-primary">Transferencia en verificación</h2>
        <p className="mb-2 text-muted-foreground">Avisamos al negocio. Te confirmaremos cuando verifique el pago.</p>
        {transferBooking.bookingNumber != null && (
          <p className="mb-5 text-sm text-muted-foreground">Tu código de reserva: <span className="font-mono font-semibold text-primary">#{transferBooking.bookingNumber}</span></p>
        )}
        <Button asChild className="h-12 rounded-full px-6">
          <Link href={`/book/confirmation?bookingId=${transferBooking.id}`}>Ver el estado de mi reserva</Link>
        </Button>
      </div>
    )
  }

  if (availability === null) {
    return (
      <div className="py-14 text-center">
        <Loader2 className="mx-auto mb-4 size-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Verificando disponibilidad de pago...</p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Pago de abono</h2>
      <p className="mb-8 text-lg text-muted-foreground">Resumen de tu reserva</p>

      <div className="mb-6 space-y-3 rounded-xl bg-muted/55 p-5">
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Servicio</span><span className="font-semibold text-primary">{data.serviceName}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fecha y hora</span><span className="font-semibold text-primary">{data.timeSlot ? formatBookingDateTime(data.timeSlot.start, timezone) : ''}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio total</span><span className="font-semibold text-primary">{formatMoney(data.servicePrice, currency)}</span></div>
        {appliedPromo && (
          <>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Descuento</span><span className="font-semibold text-green-700">−{formatMoney(appliedPromo.discount, currency)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio final</span><span className="font-semibold text-primary">{formatMoney(effectiveFinalPrice, currency)}</span></div>
          </>
        )}
        <div className="flex justify-between gap-4 border-t border-border/60 pt-3"><span className="text-muted-foreground">Abono a pagar</span><span className="font-semibold text-primary">{formatMoney(effectiveDeposit, currency)}</span></div>
      </div>

      {packageSection}
      {!packageCovers && promoSection}

      {bankInfo && (
        <div className="mb-6">
          <p className="mb-2 text-sm font-semibold text-primary">¿Cómo querés pagar el abono?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['online', 'Pagar online', 'Tarjeta, débito o crédito'],
              ['transfer', 'Transferencia bancaria', 'Te mostramos los datos y nos avisás cuando transfieras'],
            ] as const).map(([key, title, desc]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMethod(key)}
                className={`rounded-xl border p-4 text-left text-sm transition-colors ${method === key ? 'border-primary bg-primary/5' : 'border-border'}`}
              >
                <span className="block font-semibold text-primary">{title}</span>
                <span className="mt-0.5 block text-muted-foreground">{desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {availability.isMock && (
        <div className="mb-4 rounded-xl border border-border/70 bg-secondary/40 px-4 py-3 text-sm text-primary">
          <p>Entorno de prueba: los pagos se procesan de forma simulada.</p>
        </div>
      )}

      <BusinessCancellationPolicy policy={cancellationPolicy} />

      <div className="mb-4 flex items-start gap-3">
        <input
          type="checkbox"
          id="accept-terms"
          checked={acceptedTerms}
          onChange={(e) => setAcceptedTerms(e.target.checked)}
          className="mt-0.5 size-4 rounded border-border accent-primary"
        />
        <label htmlFor="accept-terms" className="text-sm text-muted-foreground">
          <LegalAcceptanceLabel />
        </label>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} disabled={loading}>Atrás</Button>
        {bankInfo && method === 'transfer' ? (
          <Button className="h-12 flex-1 rounded-full text-base font-semibold" onClick={handleTransferBooking} disabled={loading || !acceptedTerms}>
            {loading ? 'Procesando...' : 'Continuar con transferencia'}
          </Button>
        ) : (
          <Button className="h-12 flex-1 rounded-full text-base font-semibold" onClick={handlePayment} disabled={loading || !acceptedTerms}>
            {loading ? 'Procesando...' : `Pagar abono ${formatMoney(effectiveDeposit, currency)}`}
          </Button>
        )}
      </div>
    </div>
  )
}
