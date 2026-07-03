'use client'

import { useState, useMemo, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BookingData } from './wizard'
import { createBooking } from '@/server/actions/bookings'
import { previewPromotion } from '@/server/actions/promotions'
import { usePackageAvailability } from '@/lib/packages/use-package-availability'
import { initiatePayment, verifyAndConfirmPayment, getOnlinePaymentAvailability } from '@/server/actions/payments'
import { formatMoney } from '@/lib/money'
import { AlertCircle, Loader2 } from 'lucide-react'

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

export function StepPayment({ data, businessId, cancellationPolicy, referralToken, onSuccess, onBack }: { data: BookingData; businessId: string; cancellationPolicy?: string | null; referralToken?: string; onSuccess: (id: string, mode: 'paid' | 'pending', promo?: { discountAmount: number; finalAmount: number } | null) => void; onBack: () => void }) {
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'review' | 'processing' | 'success' | 'error'>('review')
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
              <span className="font-semibold text-green-700">−{formatMoney(appliedPromo.discount)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Precio final</span>
              <span className="font-semibold text-primary">{formatMoney(appliedPromo.finalAmount)}</span>
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
    getOnlinePaymentAvailability(businessId)
      .then(setAvailability)
      .catch(() => {
        const reason = 'No pudimos verificar pago online. Puedes confirmar la reserva y el negocio coordinará el abono.'
        setAvailabilityError(reason)
        setAvailability({
          available: false,
          provider: null,
          isMock: false,
          reason,
        })
      })
  }, [businessId, noDepositNeeded])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Generar una key estable por montaje de StepPayment.
  // Retry dentro del mismo montaje (ej. "Intentar de nuevo") usa la misma key.
  // Si el usuario va "Atrás" y vuelve, el componente se remonta → nueva key.
  const idempotencyKey = useMemo(() => data.idempotencyKey || generateIdempotencyKey(), [data.idempotencyKey])

  async function handleManualBooking() {
    setLoading(true)
    setStep('processing')
    setErrorMessage('')

    try {
      const booking = await createBooking({
        serviceId: data.serviceId!,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail,
        startDateTime: data.timeSlot!.start,
        idempotencyKey,
        acceptedTerms,
        promotionCode: appliedPromo?.code,
        referralToken,
        skipPackage: !usePackage,
      }, businessId)

      setStep('success')
      const mode = noDepositNeeded ? 'paid' as const : 'pending' as const
      onSuccess(booking.id, mode, appliedPromo ? { discountAmount: appliedPromo.discount, finalAmount: appliedPromo.finalAmount } : null)
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
      const booking = await createBooking({
        serviceId: data.serviceId!,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail,
        startDateTime: data.timeSlot!.start,
        idempotencyKey,
        acceptedTerms,
        promotionCode: appliedPromo?.code,
        referralToken,
        skipPackage: !usePackage,
      }, businessId)

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
      onSuccess(booking.id, 'paid', appliedPromo ? { discountAmount: appliedPromo.discount, finalAmount: appliedPromo.finalAmount } : null)
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
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fecha y hora</span><span className="font-semibold text-primary">{data.date?.toLocaleDateString('es-CL')} {data.timeSlot?.start.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio total</span><span className="font-semibold text-primary">{formatMoney(data.servicePrice)}</span></div>
          {appliedPromo && (
            <>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Descuento</span><span className="font-semibold text-green-700">−{formatMoney(appliedPromo.discount)}</span></div>
              <div className="flex justify-between gap-4 border-t border-border/60 pt-3"><span className="text-muted-foreground">Precio final</span><span className="font-semibold text-primary">{formatMoney(effectiveFinalPrice)}</span></div>
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
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fecha y hora</span><span className="font-semibold text-primary">{data.date?.toLocaleDateString('es-CL')} {data.timeSlot?.start.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio total</span><span className="font-semibold text-primary">{formatMoney(data.servicePrice)}</span></div>
          {appliedPromo && (
            <>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Descuento</span><span className="font-semibold text-green-700">−{formatMoney(appliedPromo.discount)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio final</span><span className="font-semibold text-primary">{formatMoney(effectiveFinalPrice)}</span></div>
            </>
          )}
          <div className="flex justify-between gap-4 border-t border-border/60 pt-3"><span className="text-muted-foreground">Abono requerido</span><span className="font-semibold text-primary">{formatMoney(effectiveDeposit)}</span></div>
        </div>

        {packageSection}
        {!packageCovers && promoSection}

        <div className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">
              {availabilityError || 'Este negocio coordina el abono directamente por WhatsApp o transferencia'}
            </p>
            {!availabilityError && (
              <p className="mt-1">Tu reserva quedará pendiente hasta que el negocio confirme el abono.</p>
            )}
          </div>
        </div>

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
            {loading ? 'Creando reserva...' : 'Confirmar reserva'}
          </Button>
        </div>
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
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fecha y hora</span><span className="font-semibold text-primary">{data.date?.toLocaleDateString('es-CL')} {data.timeSlot?.start.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio total</span><span className="font-semibold text-primary">{formatMoney(data.servicePrice)}</span></div>
        {appliedPromo && (
          <>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Descuento</span><span className="font-semibold text-green-700">−{formatMoney(appliedPromo.discount)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio final</span><span className="font-semibold text-primary">{formatMoney(effectiveFinalPrice)}</span></div>
          </>
        )}
        <div className="flex justify-between gap-4 border-t border-border/60 pt-3"><span className="text-muted-foreground">Abono a pagar</span><span className="font-semibold text-primary">{formatMoney(effectiveDeposit)}</span></div>
      </div>

      {packageSection}
      {!packageCovers && promoSection}

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
        <Button className="h-12 flex-1 rounded-full text-base font-semibold" onClick={handlePayment} disabled={loading || !acceptedTerms}>
          {loading ? 'Procesando...' : `Pagar abono ${formatMoney(effectiveDeposit)}`}
        </Button>
      </div>
    </div>
  )
}
