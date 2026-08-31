'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { usePublicAnalytics } from '@/components/analytics/public-analytics'
import { formatInTimeZone } from 'date-fns-tz'
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
import { DEFAULT_HOLD_MINUTES, holdDeadlinePhrase } from '@/lib/bookings/hold'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'
import { TransferDetails } from './transfer-details'
import { formatMoney } from '@/lib/money'
import { AlertCircle, Clock, Loader2 } from 'lucide-react'
import type { WhereFields } from '@/lib/services/modality'
import type { ServiceModality } from '@prisma/client'
import { BookingSummary } from './booking-summary'
import { BookingLegalAcceptance } from './booking-legal-acceptance'
import { guestPushGrantSessionKey } from '@/components/push/guest-push-link'

/**
 * Lo que el paso de pago le pasa a la confirmación: la reserva tal como quedó
 * escrita, no lo que el wizard creía.
 *
 * El "dónde" viene de acá y no del estado del wizard a propósito: el servidor es
 * quien manda (`resolveBookingDraft` pisa la modalidad pedida cuando el servicio
 * tiene una sola, y copia el link de la sala en la reserva), y en un reintento
 * con la misma idempotencyKey la reserva devuelta puede no ser la que la clienta
 * acaba de armar.
 */
export interface BookingCreated {
  id: string
  mode: 'paid' | 'pending'
  bookingNumber: number | null
  promo: { discountAmount: number; finalAmount: number } | null
  where: WhereFields
  /**
   * La reserva quedó CONFIRMADA de verdad, que no es lo mismo que `mode`:
   * `mode` habla de la plata (no había abono que pagar) y esto del estado de la
   * reserva, que además puede quedar esperando el visto bueno del negocio.
   *
   * Lo decide cada camino y no se deduce del status que devolvió `createBooking`
   * porque en el flujo de pago esa fila se leyó ANTES de cobrar: dice
   * `pending_payment` sobre una reserva que el cobro ya confirmó.
   */
  confirmed: boolean
  /** Con quién quedó. Vacío si la reserva no tiene persona. Con "Cualquiera
   *  disponible" es lo ÚNICO que sabe quién atiende: lo eligió el servidor. */
  professionalName: string
  cancellationCutoffHours: number
  cancellationPolicySnapshot: string | null
  depositRequired: number
  depositPaid: number
  pushMode: 'account' | 'guest' | null
  pushGrant: string | null
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Fallback para entornos sin crypto.randomUUID (muy poco probable en navegadores modernos)
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Cuál de las pantallas que eligen los DATOS corresponde, cuando el `step` no
 * mandó ninguna.
 *
 * Vive afuera del componente y devuelve un nombre en vez de JSX por un motivo:
 * la precedencia entre estas cuatro **es cargante y no se ve**. Que
 * `noDepositNeeded` vaya primero no es una preferencia de orden — el efecto de
 * disponibilidad hace early-return en ese caso, así que `availability` se queda
 * en `null` PARA SIEMPRE, y cualquier rama que mire el `null` antes deja al
 * servicio sin abono girando "Verificando disponibilidad de pago..." sin salida.
 * Escrito como una cadena de `if` eso es una trampa invisible, que es la misma
 * clase que #159 un piso más abajo. Acá se lee de una y la cuida un test.
 */
export function pantallaDeDatos({
  noDepositNeeded,
  availability,
}: {
  noDepositNeeded: boolean
  availability: { available: boolean } | null
}): 'sin-abono' | 'verificando' | 'sin-pago-online' | 'cobrar' {
  if (noDepositNeeded) return 'sin-abono'
  if (availability === null) return 'verificando'
  return availability.available ? 'cobrar' : 'sin-pago-online'
}

/** Lo que la pantalla de transferencia necesita saber de la reserva recién
 *  creada. Las dos fechas y no la frase ya armada: ver `handleTransferBooking`. */
type ReservaEnTransferencia = {
  id: string
  bookingNumber: number | null
  holdExpiresAt: Date | null
  endDateTime: Date
}

/**
 * En qué pantalla está el paso de pago, CON los datos que esa pantalla
 * necesita adentro.
 *
 * El #163 arregló la PRECEDENCIA (qué rama gana) pero no la REPRESENTACIÓN: el
 * `step` seguía siendo un string suelto y los datos vivían en estados aparte,
 * así que `'transfer-details'` era escribible sin la cuenta bancaria y sin la
 * reserva. Cuando eso pasaba, el `break` caía a las pantallas de datos — o sea
 * al formulario de pago de una reserva QUE YA EXISTE y ya tiene el horario
 * tomado. Y no era simétrico: `reserva` se setea en la línea de arriba del
 * cambio de pantalla, pero `bankInfo` lo escribe un efecto cuyo `catch` lo
 * pone en `null` sin mirar en qué pantalla estamos.
 *
 * Con los datos adentro no hay nada que chequear al renderizar: el guard se
 * corrió a ANTES de crear la reserva, que es donde sirve.
 */
type Paso =
  | { k: 'review' }
  | { k: 'processing' }
  | { k: 'success' }
  | { k: 'error' }
  | { k: 'transfer-details'; bank: BankTransferPublicInfo; reserva: ReservaEnTransferencia }
  | { k: 'transfer-declared'; reserva: ReservaEnTransferencia }

export function StepPayment({ data, updateData, businessId, timezone, currency, cancellationPolicy, cancellationPolicyRevision, selfServiceCutoffHours, manualHoldHours, referralToken, onSuccess, onBack }: { data: BookingData; updateData: (partial: Partial<BookingData>) => void; businessId: string; timezone: string; currency: string; cancellationPolicy?: string | null; cancellationPolicyRevision: string; selfServiceCutoffHours: number; manualHoldHours: number; referralToken?: string; onSuccess: (result: BookingCreated) => void; onBack: () => void }) {
  const analytics = usePublicAnalytics()
  const promoGeneration = useRef(0)
  const economicEvidence = useRef('')
  const branchEvidence = useRef('')
  const evidenceIdentity = useRef<string | null>(null)
  const [paso, setPaso] = useState<Paso>({ k: 'review' })
  const [bankInfo, setBankInfo] = useState<BankTransferPublicInfo | null>(null)
  const [method, setMethod] = useState<'online' | 'transfer'>('online')
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

  useEffect(() => {
    const counter = promoGeneration
    // Requests are scoped to the actual customer/service input, not a shared boolean.
    /* eslint-disable react-hooks/set-state-in-effect -- reset only when the preview's input identity changes */
    setPromoPending(false)
    setAppliedPromo(null)
    setPromoError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => { counter.current++ }
  }, [businessId, data.serviceId, data.customerPhone, data.serviceModality])

  const paymentScreen = pantallaDeDatos({ noDepositNeeded, availability })
  const economicCondition = packageCovers ? 'package' : appliedPromo && appliedPromo.finalAmount <= 0 ? 'promotion_zero' : isFreeService ? 'free_service' : noDepositNeeded ? 'no_deposit' : 'deposit_required'
  const offeredMethods: ('online' | 'transfer' | 'manual')[] = paymentScreen === 'verificando' ? [] : paymentScreen === 'sin-abono' ? ['manual'] : paymentScreen === 'sin-pago-online' ? [bankInfo ? 'transfer' : 'manual'] : bankInfo ? ['online', 'transfer'] : ['online']
  const branchKey = JSON.stringify([paymentScreen, economicCondition, offeredMethods])
  // Amounts remain only in component memory for invalidation; never in analytics state/events.
  const economicKey = JSON.stringify([effectiveFinalPrice, effectiveDeposit, packageCovers])
  useEffect(() => {
    if (!analytics.ready || paso.k !== 'review') return
    function observe() {
      if (document.visibilityState !== 'visible') return
      // Child effects run before Wizard's effect when consent arrives here.
      // Existing attempts are reused; this only starts partial when none is valid.
      analytics.startAttempt('partial')
      const identity = analytics.attemptIdentity()
      if (!identity) return
      if (evidenceIdentity.current !== identity) {
        evidenceIdentity.current = identity
        economicEvidence.current = ''
        branchEvidence.current = ''
      }
      if (economicEvidence.current && economicEvidence.current !== economicKey) {
        analytics.changeSelection({ reason: 'payment', context: data.serviceId && data.serviceModality ? { serviceId: data.serviceId, modality: data.serviceModality, professional: data.professional.kind === 'person' ? { kind: 'person', professionalId: data.professional.id } : data.professional } : null, localDate: data.date ? formatInTimeZone(data.date, timezone, 'yyyy-MM-dd') : null })
        branchEvidence.current = ''
      }
      economicEvidence.current = economicKey
      const observedKey = `${identity}:${branchKey}:${analytics.revision()}`
      if (branchEvidence.current !== observedKey) {
        analytics.track({ type: 'payment_branch_viewed', data: { screen: paymentScreen, condition: economicCondition, offeredMethods } })
        branchEvidence.current = observedKey
      }
    }
    observe()
    document.addEventListener('visibilitychange', observe)
    return () => document.removeEventListener('visibilitychange', observe)
    // Closed keys encode the actual rendered fields, avoiding unstable array dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics.ready, paso.k, branchKey, economicKey])

  async function handleApplyPromo() {
    const code = promoCode.trim()
    if (!code || !data.serviceId) return
    const generation = ++promoGeneration.current
    const revision = analytics.revision()
    const attemptIdentity = analytics.attemptIdentity()
    // Consent changes affect observation, never the customer's valid price preview.
    const current = () => generation === promoGeneration.current
    const observable = () => current() && attemptIdentity !== null && attemptIdentity === analytics.attemptIdentity() && revision === analytics.revision()
    setPromoPending(true)
    setPromoError(null)
    try {
      const res = await previewPromotion({
        businessId,
        code,
        serviceId: data.serviceId,
        phone: data.customerPhone || undefined,
      })
      if (!current()) return
      if (!res.ok) {
        if (observable()) analytics.track({ type: 'promotion_result', data: { result: 'error', category: 'unknown' } })
        setPromoError(res.error)
        setAppliedPromo(null)
        return
      }
      if (res.data.ok) {
        if (observable() && res.data.promotionId) analytics.track({ type: 'promotion_result', data: { result: 'accepted', promotionId: res.data.promotionId } })
        setAppliedPromo({ code, discount: res.data.discount, finalAmount: res.data.finalAmount })
        setPromoError(null)
      } else {
        if (observable()) analytics.track({ type: 'promotion_result', data: { result: 'rejected', category: res.data.category ?? 'unknown' } })
        setPromoError(res.data.message)
        setAppliedPromo(null)
      }
    } catch {
      if (!current()) return
      if (observable()) analytics.track({ type: 'promotion_result', data: { result: 'error', category: 'network' } })
      setPromoError('No se pudo validar el código')
      setAppliedPromo(null)
    } finally {
      if (generation === promoGeneration.current) setPromoPending(false)
    }
  }

  function handleRemovePromo() {
    promoGeneration.current++
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
    let cancelled = false
    if (noDepositNeeded) {
      setAvailability(null)
      setAvailabilityError('')
      return
    }
    setAvailability(null)
    setAvailabilityError('')
    Promise.all([getOnlinePaymentAvailability(businessId), getBankTransferInfo(businessId)])
      .then(([avail, bank]) => {
        if (cancelled) return
        setAvailability(avail)
        setBankInfo(bank)
      })
      .catch(() => {
        if (cancelled) return
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
    return () => { cancelled = true }
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
    const attribution = analytics.bookingCredential()
    return {
      ...(attribution ? { analytics: attribution } : {}),
      serviceId: data.serviceId!,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail,
      customerBirthDate: data.customerBirthDate || undefined,
      startDateTime: data.timeSlot!.start,
      idempotencyKey,
      acceptedTerms,
      cancellationPolicyRevision,
      promotionCode: appliedPromo?.code,
      referralToken,
      skipPackage: !usePackage,
      // El server re-deriva la modalidad contra las del servicio (y con una sola
      // ignora lo que llegue): esto es la elección, no la autoridad.
      modality: data.serviceModality ?? undefined,
      serviceAddress: data.serviceAddress || undefined,
      // Con quién. El server verifica que sea de este negocio, que siga
      // atendiendo y que haga este servicio en esta modalidad —y con "cualquiera"
      // elige él adentro de la transacción—: acá abajo llega lo que eligió la
      // clienta, no una autorización.
      professional: data.professional,
      ...extra,
    }
  }

  /** La cuenta llega por parámetro y no del estado: los dos botones que llaman
   *  acá ya la tienen en la mano, así que no hace falta un guard que se defienda
   *  de un caso imposible — y un guard silencioso sería un botón que no hace
   *  nada, que es el síntoma exacto del #159. */
  async function handleTransferBooking(bank: BankTransferPublicInfo) {
    analytics.track({ type: 'payment_method_selected', data: { method: 'transfer' } })
    analytics.track({ type: 'booking_submit_result', data: { result: 'submitted' } })
    setPaso({ k: 'processing' })
    setErrorMessage('')
    try {
      const res = await createBooking(bookingInput({ paymentMethod: BANK_TRANSFER_METHOD }), businessId)
      if (!res.ok) {
        analytics.track({ type: 'booking_submit_result', data: { result: 'rejected', category: 'unknown' } })
        setErrorMessage(res.error)
        setPaso({ k: 'error' })
        return
      }
      const booking = res.data
      analytics.completeAttempt()
      retainPushGrant(booking)
      setPaso({
        k: 'transfer-details',
        bank,
        reserva: {
          id: booking.id,
          bookingNumber: booking.bookingNumber ?? null,
          // Las dos fechas, no la frase ya armada: la frase se deriva al
          // renderizar, como en todas las otras superficies. Congelarla acá se
          // pasa de lista — la ventana de la transferencia son 24 h, así que una
          // pestaña abierta que cruza la medianoche seguiría diciendo "las 08:00"
          // cuando ya tendría que decir el día.
          holdExpiresAt: booking.holdExpiresAt ? new Date(booking.holdExpiresAt) : null,
          endDateTime: new Date(booking.endDateTime),
        },
      })
    } catch (err) {
      analytics.track({ type: 'booking_submit_result', data: { result: 'error', category: 'network' } })
      console.error('Transfer booking error:', err)
      setErrorMessage('Error al crear la reserva')
      setPaso({ k: 'error' })
    }
  }

  async function handleDeclare(
    reserva: ReservaEnTransferencia,
    proof: { proofKey: string; proofContentType: string } | null,
  ) {
    setDeclaring(true)
    setErrorMessage('')
    try {
      const res = await declareBankTransfer(reserva.id, proof ?? {})
      if (!res.ok) {
        setErrorMessage(res.error)
        return
      }
      setPaso({ k: 'transfer-declared', reserva })
    } catch {
      setErrorMessage('No se pudo procesar. Intenta nuevamente.')
    } finally {
      setDeclaring(false)
    }
  }

  /** Arma el resultado desde la reserva que devolvió el servidor. */
  function resultado(
    booking: {
      id: string
      bookingNumber: number | null
      modality: ServiceModality
      serviceAddress: string | null
      meetingUrl: string | null
      professional?: { name: string } | null
      cancellationCutoffHours: number | null
      cancellationPolicySnapshot: string | null
      depositRequired: number
      depositPaid: number
      pushGrant: string | null
      pushMode: 'account' | 'guest' | null
    },
    mode: 'paid' | 'pending',
    confirmed: boolean,
  ): BookingCreated {
    return {
      id: booking.id,
      mode,
      bookingNumber: booking.bookingNumber,
      promo: appliedPromo ? { discountAmount: appliedPromo.discount, finalAmount: appliedPromo.finalAmount } : null,
      where: { modality: booking.modality, serviceAddress: booking.serviceAddress, meetingUrl: booking.meetingUrl },
      confirmed,
      professionalName: booking.professional?.name ?? '',
      // Las reservas nuevas siempre traen snapshot; el fallback sólo protege
      // una respuesta legacy sin ese campo durante un despliegue escalonado.
      cancellationCutoffHours: booking.cancellationCutoffHours ?? selfServiceCutoffHours,
      cancellationPolicySnapshot: booking.cancellationPolicySnapshot,
      depositRequired: booking.depositRequired,
      depositPaid: booking.depositPaid,
      pushGrant: booking.pushGrant,
      pushMode: booking.pushMode,
    }
  }

  function retainPushGrant(booking: { id: string; pushMode: 'account' | 'guest' | null; pushGrant: string | null }) {
    if (booking.pushMode !== 'guest' || !booking.pushGrant) return
    try {
      sessionStorage.setItem(guestPushGrantSessionKey(booking.id), booking.pushGrant)
    } catch {
      // Storage can be unavailable in restricted browsing modes. The direct
      // confirmation path still carries the grant in BookingCreated.
    }
  }

  async function handleManualBooking() {
    analytics.track({ type: 'booking_submit_result', data: { result: 'submitted' } })
    setPaso({ k: 'processing' })
    setErrorMessage('')

    try {
      const res = await createBooking(bookingInput(), businessId)
      if (!res.ok) {
        analytics.track({ type: 'booking_submit_result', data: { result: 'rejected', category: 'unknown' } })
        setErrorMessage(res.error)
        setPaso({ k: 'error' })
        return
      }
      const booking = res.data
      analytics.completeAttempt()

      retainPushGrant(booking)

      setPaso({ k: 'success' })
      const mode = noDepositNeeded ? 'paid' as const : 'pending' as const
      // Sin abono que pagar la reserva nace confirmada, salvo que el negocio
      // confirme a mano: ahí queda esperando y todavía no hay nada que agendar.
      onSuccess(resultado(booking, mode, booking.status === 'confirmed'))
    } catch (err) {
      analytics.track({ type: 'booking_submit_result', data: { result: 'error', category: 'network' } })
      console.error('Booking error:', err)
      setErrorMessage('Error al crear la reserva')
      setPaso({ k: 'error' })
    }
  }

  async function handlePayment() {
    setPaso({ k: 'processing' })
    setErrorMessage('')

    if (effectiveDeposit <= 0) {
      await handleManualBooking()
      return
    }

    analytics.track({ type: 'booking_submit_result', data: { result: 'submitted' } })
    let bookingCreated = false
    try {
      const res = await createBooking(bookingInput(), businessId)
      if (!res.ok) {
        analytics.track({ type: 'booking_submit_result', data: { result: 'rejected', category: 'unknown' } })
        setErrorMessage(res.error)
        setPaso({ k: 'error' })
        return
      }
      const booking = res.data
      bookingCreated = true
      const binding = analytics.completeAttempt()

      retainPushGrant(booking)

      const paymentRes = await initiatePayment({
        bookingId: booking.id,
        amount: effectiveDeposit,
        currency: 'CLP',
        description: `Abono para ${data.serviceName}`,
      })
      if (!paymentRes.ok) {
        setErrorMessage(paymentRes.error)
        setPaso({ k: 'error' })
        return
      }
      const paymentResult = paymentRes.data

      // Redirect-based providers (Mercado Pago): redirigir al usuario al checkout externo.
      // No llamar verifyAndConfirmPayment: la confirmación ocurre via webhook.
      if (paymentResult.redirectUrl) {
        if (binding) analytics.track({ type: 'checkout_redirected', data: { provider: 'mercado_pago' } }, binding)
        window.location.href = paymentResult.redirectUrl
        return
      }

      // Flujo sin redirect (mock/dev): verificar y confirmar server-side
      await new Promise(resolve => setTimeout(resolve, 1500))

      const verifyPromise = verifyAndConfirmPayment(paymentResult.paymentId, booking.id)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout al verificar el pago')), 10000)
      )
      const verifyRes = await Promise.race([verifyPromise, timeoutPromise])
      if (!verifyRes.ok) {
        setErrorMessage(verifyRes.error)
        setPaso({ k: 'error' })
        return
      }

      // `{ ok: true, data: { success: false, message } }`: la action corrió bien pero
      // el pago no terminó en una reserva confirmada — pago no aprobado, MP todavía
      // pendiente de webhook, o el horario se ocupó mientras se pagaba. Antes esto
      // caía en la pantalla de éxito: la clienta se iba creyendo que tenía su hora.
      if (!verifyRes.data.success) {
        setErrorMessage(verifyRes.data.message ?? 'No se pudo confirmar tu reserva')
        setPaso({ k: 'error' })
        return
      }

      setPaso({ k: 'success' })
      // `verifyRes.data.success` es la reserva ya confirmada server-side; la fila
      // `booking` de acá se leyó antes de cobrar y todavía dice pendiente.
      onSuccess(resultado(booking, 'paid', true))
    } catch (err) {
      if (!bookingCreated) analytics.track({ type: 'booking_submit_result', data: { result: 'error', category: 'network' } })
      console.error('Payment error:', err)
      setErrorMessage('Error al procesar el pago')
      setPaso({ k: 'error' })
    }
  }

  /* Qué se ve lo decide PRIMERO el `step` y recién después los datos.
     `transfer-details` vivía debajo de la rama "no hay pago online", que sólo
     mira `availability`, y al negocio que cobra SÓLO por transferencia esa rama
     le ganaba siempre: la reserva se creaba de verdad y la pantalla no se movía
     (#159). Un `if` encadenado no puede impedir que vuelva a pasar —el orden es
     invisible— así que el `switch` es exhaustivo: un paso nuevo sin rama acá
     no compila. Lo de afuera son las pantallas que eligen los DATOS, que tienen
     su propia regla (`pantallaDeDatos`).
     El caso de #159 lo cuida `step-payment-plazo-transferencia.test.tsx`, que
     entra de verdad al camino de transferencia; el de `'success'`,
     `step-payment-pantalla-por-step.test.tsx`. */
  switch (paso.k) {
    // `'success'` comparte pantalla con `'processing'`: no tiene una propia
    // porque `onSuccess()` hace que el padre saque este paso del medio en el
    // mismo tick, así que en la práctica no llega a verse. Comparte el spinner
    // y no hace `break` a propósito — si algún día el padre tardara, lo que
    // tiene que verse es "esperá", no el formulario de pago de una reserva que
    // YA se creó (con `break` volvía justo a eso).
    case 'processing':
    case 'success':
      return (
        <div className="py-14 text-center">
          <Loader2 className="mx-auto mb-4 size-8 animate-spin text-primary" />
          <h2 className="mb-2 font-heading text-2xl font-semibold tracking-tight text-primary">Procesando tu reserva...</h2>
          <p className="text-muted-foreground">Por favor no cierres esta ventana</p>
        </div>
      )

    case 'error':
      return (
        <div className="py-12 text-center">
          <AlertCircle className="mx-auto mb-4 size-9 text-destructive" />
          <h2 className="mb-2 font-heading text-2xl font-semibold tracking-tight text-primary">Error en el pago</h2>
          <p className="mb-5 text-muted-foreground">{errorMessage || 'No se pudo procesar el pago'}</p>
          <div className="flex justify-center gap-3">
            <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
            <Button className="h-12 rounded-full px-6" onClick={() => setPaso({ k: 'review' })}>Intentar de nuevo</Button>
          </div>
        </div>
      )

    case 'transfer-details':
      return (
        <div>
          <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Transferí el abono</h2>
          <p className="mb-6 text-lg text-muted-foreground">Tu horario queda reservado mientras transferís</p>
          {errorMessage && <p className="mb-4 text-sm text-destructive">{errorMessage}</p>}
          <TransferDetails bank={paso.bank} amount={effectiveDeposit} currency={currency} deadlinePhrase={holdDeadlinePhrase(paso.reserva, timezone)} declaring={declaring} onDeclare={(proof) => handleDeclare(paso.reserva, proof)} bookingId={paso.reserva.id} />
          <p className="mt-4 text-sm text-muted-foreground">
            También podés avisar más tarde desde{' '}
            <Link className="font-semibold text-primary underline" href={`/book/confirmation?bookingId=${paso.reserva.id}`}>tu página de reserva</Link>
            {' '}(te mandamos los datos por email si dejaste uno).
          </p>
        </div>
      )

    case 'transfer-declared':
      return (
        <div className="py-10 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-amber-50">
            <Clock className="size-8 text-amber-500" />
          </div>
          <h2 className="mb-2 font-heading text-2xl font-semibold tracking-tight text-primary">Transferencia en verificación</h2>
          <p className="mb-2 text-muted-foreground">Avisamos al negocio. Te confirmaremos cuando verifique el pago.</p>
          {paso.reserva.bookingNumber != null && (
            <p className="mb-5 text-sm text-muted-foreground">Tu código de reserva: <span className="font-mono font-semibold text-primary">#{paso.reserva.bookingNumber}</span></p>
          )}
          <Button asChild className="h-12 rounded-full px-6">
            <Link href={`/book/confirmation?bookingId=${paso.reserva.id}`}>Ver el estado de mi reserva</Link>
          </Button>
        </div>
      )

    // El único que a propósito no tiene pantalla acá: la elige la data.
    case 'review':
      break

    // Un paso nuevo sin rama acá NO COMPILA, y eso es todo lo que hace este
    // bloque. En runtime es inalcanzable —`paso` sólo lo escribe `setPaso` con
    // literales—, así que degrada a las pantallas de datos en vez de tirar
    // abajo el wizard: no hay error boundary bajo `/book`.
    default:
      paso satisfies never
      break
  }

  /* De acá para abajo la pantalla la eligen los DATOS. Cada rama pregunta por
     un valor distinto de `pantallaDeDatos`, así que reordenarlas no cambia nada:
     la precedencia —lo único delicado— vive allá arriba, sola y testeada. */
  const pantalla = pantallaDeDatos({ noDepositNeeded, availability })

  if (pantalla === 'sin-abono') {
    return (
      <div>
        <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Confirmar reserva</h2>
        <p className="mb-8 text-lg text-muted-foreground">Resumen de tu reserva</p>

        <BookingSummary
          serviceName={data.serviceName}
          startsAt={data.timeSlot?.start}
          timezone={timezone}
          price={data.servicePrice}
          currency={currency}
          promotion={appliedPromo ? { discount: appliedPromo.discount, finalPrice: effectiveFinalPrice } : undefined}
          emphasizeFinalPrice
        />

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

        <BookingLegalAcceptance
          policy={cancellationPolicy}
          cutoffHours={selfServiceCutoffHours}
          hasDeposit={effectiveDeposit > 0}
          accepted={acceptedTerms}
          onAcceptedChange={setAcceptedTerms}
        />

        <div className="flex gap-3">
          <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
          <Button className="h-12 flex-1 rounded-full text-base font-semibold" onClick={handleManualBooking} disabled={!acceptedTerms}>
            Confirmar reserva
          </Button>
        </div>
      </div>
    )
  }

  if (pantalla === 'sin-pago-online') {
    return (
      <div>
        <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Confirmar reserva</h2>
        <p className="mb-8 text-lg text-muted-foreground">Resumen de tu reserva</p>

        <BookingSummary
          serviceName={data.serviceName}
          startsAt={data.timeSlot?.start}
          timezone={timezone}
          price={data.servicePrice}
          currency={currency}
          promotion={appliedPromo ? { discount: appliedPromo.discount, finalPrice: effectiveFinalPrice } : undefined}
          deposit={{ label: 'Abono requerido', amount: effectiveDeposit }}
        />

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
              <p className="mt-1">
                Tu reserva quedará pendiente hasta que el negocio confirme el abono.
                Te guardamos el horario hasta {manualHoldHours} horas, o hasta tu cita si es antes.
              </p>
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

        <BookingLegalAcceptance
          policy={cancellationPolicy}
          cutoffHours={selfServiceCutoffHours}
          hasDeposit={effectiveDeposit > 0}
          accepted={acceptedTerms}
          onAcceptedChange={setAcceptedTerms}
        />

        <div className="flex gap-3">
          <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
          {bankInfo ? (
            <Button className="h-12 flex-1 rounded-full text-base font-semibold" onClick={() => void handleTransferBooking(bankInfo)} disabled={!acceptedTerms}>
              Continuar con transferencia
            </Button>
          ) : (
            <Button className="h-12 flex-1 rounded-full text-base font-semibold" onClick={handleManualBooking} disabled={!acceptedTerms}>
              Confirmar reserva
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (pantalla === 'verificando') {
    return (
      <div className="py-14 text-center">
        <Loader2 className="mx-auto mb-4 size-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Verificando disponibilidad de pago...</p>
      </div>
    )
  }

  /** La cuenta con la que se va a pagar, o `null` si no es por transferencia.
   *  El objeto y no un booleano: un `Boolean(bankInfo) && …` tira justo el dato
   *  que el handler de abajo necesita y obliga a volver a buscarlo. */
  const bancoElegido = method === 'transfer' ? bankInfo : null

  return (
    <div>
      <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Pago de abono</h2>
      <p className="mb-8 text-lg text-muted-foreground">Resumen de tu reserva</p>

      <BookingSummary
        serviceName={data.serviceName}
        startsAt={data.timeSlot?.start}
        timezone={timezone}
        price={data.servicePrice}
        currency={currency}
        promotion={appliedPromo ? { discount: appliedPromo.discount, finalPrice: effectiveFinalPrice } : undefined}
        deposit={{ label: 'Abono a pagar', amount: effectiveDeposit }}
        shape="xl"
      />

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
                onClick={() => { analytics.track({ type: 'payment_method_selected', data: { method: key } }); setMethod(key) }}
                className={`rounded-xl border p-4 text-left text-sm transition-colors ${method === key ? 'border-primary bg-primary/5' : 'border-border'}`}
              >
                <span className="block font-semibold text-primary">{title}</span>
                <span className="mt-0.5 block text-muted-foreground">{desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* `?.` y no `!`: acá `availability` está cargado por construcción (es lo
          que decidió `pantallaDeDatos`), pero eso ya no lo sabe el tipo. Si un
          día no lo estuviera, el aviso de entorno de prueba no aparece — y no
          se cae la pantalla de pago entera. */}
      {availability?.isMock && (
        <div className="mb-4 rounded-xl border border-border/70 bg-secondary/40 px-4 py-3 text-sm text-primary">
          <p>Entorno de prueba: los pagos se procesan de forma simulada.</p>
        </div>
      )}

      <BookingLegalAcceptance
        policy={cancellationPolicy}
        cutoffHours={selfServiceCutoffHours}
        hasDeposit={effectiveDeposit > 0}
        accepted={acceptedTerms}
        onAcceptedChange={setAcceptedTerms}
      />

      {/* Sólo el camino online: la transferencia tiene su ventana larga y la
          dice en la pantalla siguiente (TransferDetails), ya topada contra la
          cita — acá serían dos plazos distintos en la misma pantalla. */}
      {!bancoElegido && (
        <p className="mb-4 text-sm text-muted-foreground">
          Al pagar, tu horario queda guardado por {DEFAULT_HOLD_MINUTES} minutos. Si el pago no se completa en ese tiempo, se libera.
        </p>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}>Atrás</Button>
        {bancoElegido ? (
          <Button className="h-12 flex-1 rounded-full text-base font-semibold" onClick={() => void handleTransferBooking(bancoElegido)} disabled={!acceptedTerms}>
            Continuar con transferencia
          </Button>
        ) : (
          <Button className="h-12 flex-1 rounded-full text-base font-semibold" onClick={handlePayment} disabled={!acceptedTerms}>
            Pagar abono {formatMoney(effectiveDeposit, currency)}
          </Button>
        )}
      </div>
    </div>
  )
}
