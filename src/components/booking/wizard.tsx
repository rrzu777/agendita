'use client'

import { getBookingReturnPath } from '@/lib/business/urls'
import { signInWithGoogle } from '@/lib/auth/actions'

import { useEffect, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { usePublicAnalytics } from '@/components/analytics/public-analytics'
import type { SelectionContext } from '@/lib/analytics/contracts'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { StepService } from './step-service'
import { StepProfessional } from './step-professional'
import { StepDateTime } from './step-date-time'
import { wizardServiceIds } from '@/lib/bookings/wizard-selection'
import { formatDuration } from '@/lib/format-duration'
import { formatMoney } from '@/lib/money'
import { StepCustomer } from './step-customer'
import type { BookingCreated } from './step-payment'
import type { ConfirmationBusiness } from './step-confirmation'
import type { Service, ServiceModality } from '@prisma/client'
import type { FunnelSession } from '@/lib/customers/session-prefill'
import type { ProfessionalWords } from '@/lib/vocabulary'
import { NO_PROFESSIONAL, professionalChoiceForServices, professionalFields, samePick, type FunnelProfessional, type ProfessionalPick } from '@/lib/professionals/eligible'
import { entryStepAfterRestore, stepAfter, stepBefore, stepsFor, type StepKey, type WizardStep } from '@/lib/bookings/wizard-steps'
import { restoreWizardState, serializeWizardState, wizardStorageKey } from '@/lib/bookings/wizard-storage'
import { getAppUrl } from '@/lib/business/urls'

const StepPayment = dynamic(
  () => import('./step-payment').then((module) => module.StepPayment),
  { loading: () => <p className="py-8 text-center text-muted-foreground">Cargando pago…</p> },
)
const StepConfirmation = dynamic(
  () => import('./step-confirmation').then((module) => module.StepConfirmation),
  { loading: () => <p className="py-8 text-center text-muted-foreground">Cargando confirmación…</p> },
)

type WizardSession = Pick<FunnelSession, 'email' | 'name' | 'phone'> | null

// Prefill editable: los datos de la sesión pisan los de contacto (con fallback a
// lo ya tipeado/guardado cuando la sesión no trae nombre o teléfono).
function applySessionPrefill(data: BookingData, session: WizardSession): BookingData {
  if (!session) return data
  return {
    ...data,
    customerName: session.name || data.customerName,
    customerPhone: session.phone || data.customerPhone,
    customerEmail: session.email,
  }
}

export type BookingData = {
  serviceId: string | null
  /** Absent only in legacy drafts/callers. */
  serviceIds?: string[]
  services?: { id: string; name: string; price: number; durationMinutes: number; depositAmount: number }[]
  serviceName: string
  servicePrice: number
  serviceDuration: number
  serviceDeposit: number
  serviceColor: string
  /** Modalidades que ofrece el servicio elegido; el picker sólo aparece si hay >1. */
  serviceModalities: ServiceModality[]
  serviceModality: ServiceModality | null
  /** Dirección de la clienta; sólo se pide (y se manda) cuando es a domicilio. */
  serviceAddress: string
  /** Con quién. Ver `ProfessionalPick`: son tres casos, no un id nullable. */
  professional: ProfessionalPick
  /** Cómo se llama esa elección en pantalla: un nombre propio, "Cualquiera
   *  disponible", o vacío. Denormalizado igual que `serviceName`. */
  professionalName: string
  date: Date | null
  timeSlot: { start: Date; end: Date } | null
  customerName: string
  customerPhone: string
  customerEmail: string
  customerBirthDate?: string
  customerNotes: string
  idempotencyKey: string | null
  promotionCode?: string
}

const initialData: BookingData = {
  serviceId: null,
  serviceName: '',
  servicePrice: 0,
  serviceDuration: 0,
  serviceDeposit: 0,
  serviceColor: '',
  serviceModalities: [],
  serviceModality: null,
  serviceAddress: '',
  professional: NO_PROFESSIONAL,
  professionalName: '',
  date: null,
  timeSlot: null,
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  customerBirthDate: '',
  customerNotes: '',
  idempotencyKey: null,
}

interface BookingWizardProps {
  businessId: string
  slug: string
  /** Para contestar "¿dónde tengo que ir?" en la confirmación. */
  business: ConfirmationBusiness
  timezone: string
  currency: string
  services: Service[]
  /** El equipo activo del negocio. Vacío = el funnel de siempre. */
  professionals: FunnelProfessional[]
  /** El sustantivo de oficio del rubro; da el título y la etiqueta del paso nuevo. */
  professionalWords: ProfessionalWords
  cancellationPolicy?: string | null
  cancellationPolicyRevision: string
  selfServiceCutoffHours: number
  /** Ventana del hold cuando el negocio coordina el abono a mano; el aviso del
   *  paso de pago la muestra para que la promesa coincida con el server. */
  manualHoldHours: number
  referralToken?: string
  session: WizardSession
}

export function BookingWizard({ businessId, slug, business, timezone, currency, services, professionals, professionalWords, cancellationPolicy, cancellationPolicyRevision, selfServiceCutoffHours, manualHoldHours, referralToken, session }: BookingWizardProps) {
  const analytics = usePublicAnalytics()
  const restoredAnalytics = useRef<{ data: BookingData; step: StepKey } | null>(null)
  const lastObservedStep = useRef('')
  // A boolean UI fact only: no identity, event or storage before consent.
  const hasInteracted = useRef(false)
  const appliedProfessionalLink = useRef(false)
  const [currentStep, setCurrentStep] = useState<StepKey>('service')
  const [data, setData] = useState<BookingData>(() => applySessionPrefill(initialData, session))
  // La reserva ya escrita, tal como la devolvió el servidor: es lo único que
  // lee el paso de confirmación. Un solo estado y no un campo por dato porque
  // se escriben todos juntos y se leen todos juntos. Ver `BookingCreated`.
  const [reserva, setReserva] = useState<BookingCreated | null>(null)

  /**
   * Todo lo que depende del servicio elegido sale de acá, y de un solo lugar.
   *
   * Toma el `BookingData` como argumento en vez de leer `data` directo porque **cada
   * transición necesita derivarlo del estado SIGUIENTE**: cuando la clienta elige un
   * servicio, el `data` de este render todavía tiene el anterior, y avanzar con esa
   * lista saltea el paso que acaba de aparecer. Con esto, el render, el handler de
   * servicio y el restore usan la misma cuenta en vez de tres copias.
   */
  function derivar(d: BookingData): { choice: ReturnType<typeof professionalChoiceForServices>; steps: WizardStep[] } {
    const choice = professionalChoiceForServices(professionals, wizardServiceIds(d), d.serviceModality)
    return { choice, steps: stepsFor(choice.kind === 'ask' ? professionalWords.Professional : null) }
  }

  // El estado es la CLAVE del paso y no su índice justamente porque esta lista crece
  // a mitad del recorrido: un índice cambiaría de significado sin avisar.
  const { choice, steps } = derivar(data)
  const currentIndex = Math.max(0, steps.findIndex((s) => s.key === currentStep))

  // Restaura el estado guardado antes del viaje a /ingresar (solo con ?continuar=1;
  // el storage se limpia siempre para no restaurar dos veces ni dejar residuo).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!new URLSearchParams(window.location.search).has('continuar')) return
    const key = wizardStorageKey(businessId)
    let raw: string | null = null
    try { raw = sessionStorage.getItem(key); sessionStorage.removeItem(key) } catch { return }
    const restored = restoreWizardState(raw, services, professionals)
    if (!restored) return
    appliedProfessionalLink.current = true
    restoredAnalytics.current = { data: restored, step: entryStepAfterRestore(restored, derivar(restored).steps) }
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from sessionStorage on mount, gated by ?continuar=1 */
    setData(applySessionPrefill(restored, session))
    setCurrentStep(entryStepAfterRestore(restored, derivar(restored).steps))
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, [])

  function context(d: BookingData): SelectionContext | null {
    const serviceIds = wizardServiceIds(d)
    return d.serviceId && d.serviceModality ? { serviceId: d.serviceId, ...(serviceIds.length > 1 ? { serviceIds } : {}), modality: d.serviceModality, professional: d.professional.kind === 'person' ? { kind: 'person', professionalId: d.professional.id } : d.professional } : null
  }
  function localDate(d: BookingData) { return d.date ? formatInTimeZone(d.date, timezone, 'yyyy-MM-dd') : null }
  // Local-only selection identity. Never includes the customer form or travels as an event.
  function signature(d: BookingData) { return JSON.stringify([wizardServiceIds(d), context(d), localDate(d), d.timeSlot?.start.toISOString() ?? null]) }
  function changed(reason: 'service' | 'modality' | 'professional' | 'date' | 'time', next: BookingData) {
    analytics.changeSelection({ reason, context: context(next), localDate: localDate(next) })
  }
  useEffect(() => {
    if (!analytics.ready || currentStep === 'confirmation') return
    function observe() {
      if (document.visibilityState !== 'visible') return
      const restored = restoredAnalytics.current
      const observed = restored?.data ?? data
      const step = restored?.step ?? currentStep
      analytics.startAttempt(step === 'service' && !hasInteracted.current && !observed.serviceId && !new URLSearchParams(window.location.search).has('continuar') ? 'complete' : 'partial')
      analytics.reconcileSelection(signature(observed))
      const identity = analytics.attemptIdentity()
      if (!identity) return
      const key = `${identity}:${step}:${analytics.revision()}`
      if (lastObservedStep.current !== key) {
        analytics.track({ type: 'step_viewed', data: { step } })
        lastObservedStep.current = key
      }
      restoredAnalytics.current = null
    }
    observe()
    document.addEventListener('visibilitychange', observe)
    return () => document.removeEventListener('visibilitychange', observe)
    // Data is reconciled at entry and explicit handlers; contact edits are not observations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics.ready, currentStep])

  async function handleLoginCta(partial: Partial<BookingData>) {
    const merged = { ...data, ...partial }
    const raw = serializeWizardState(merged)
    try { if (raw) sessionStorage.setItem(wizardStorageKey(businessId), raw) } catch { /* login remains available */ }
    analytics.rememberSelection(signature(merged))
    const search = new URLSearchParams(window.location.search)
    // Browser Back from Google must restore the draft just like /ir does.
    search.set('continuar', '1')
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${search}`)
    await signInWithGoogle(getBookingReturnPath(slug, search))
  }

  function updateData(partial: Partial<BookingData>) {
    analytics.rememberSelection(signature({ ...data, ...partial }))
    setData(prev => ({ ...prev, ...partial }))
  }

  function nextStep() {
    setCurrentStep(stepAfter(steps, currentStep))
  }

  function prevStep() {
    setCurrentStep(stepBefore(steps, currentStep))
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <div className="mb-3 flex items-center gap-1.5">
          {steps.map((step, i) => (
            <div
              key={step.key}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                i <= currentIndex ? 'bg-primary' : 'bg-secondary'
              }`}
            />
          ))}
        </div>
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Paso {currentIndex + 1} de {steps.length}</p>
          <p className="font-heading text-base font-semibold text-primary">{steps[currentIndex]?.label}</p>
        </div>
      </div>

      {data.serviceId && currentStep !== 'service' && currentStep !== 'confirmation' && <aside aria-label="Tu selección" className="mb-5 space-y-2 px-2 text-sm">
        {(data.services ?? [{ id: data.serviceId, name: data.serviceName, price: data.servicePrice }]).map(service => <div key={service.id} className="flex justify-between gap-4"><span className="min-w-0 break-words">{service.name}</span><span className="shrink-0">{formatMoney(service.price, currency)}</span></div>)}
        <p className="font-semibold">{formatDuration(data.serviceDuration)} · Total {formatMoney(data.servicePrice, currency)} · {data.serviceDeposit ? `Abono ${formatMoney(data.serviceDeposit, currency)}` : 'Sin abono'}</p>
        {data.professionalName && <p>Te atiende: {data.professionalName}{choice.kind === 'ask' && currentStep !== 'professional' && <button type="button" className="ml-3 underline" onClick={() => setCurrentStep('professional')}>Cambiar profesional</button>}</p>}
      </aside>}
      <section className="rounded-[2rem] border border-border/50 bg-card p-5 shadow-[var(--cream-shadow)] sm:p-8">
        {currentStep === 'service' && (
          <StepService data={data} services={services} currency={currency} selectionError={choice.kind === 'unavailable' ? 'Ningún profesional realiza todos estos servicios. Quita uno o resérvalos por separado.' : null}
            selectionCompatible={(serviceIds, modality) => professionalChoiceForServices(professionals, serviceIds, modality).kind !== 'unavailable'}
            onInteraction={() => { hasInteracted.current = true }}
            onSelect={(selection) => {
              const siguiente = derivar({ ...data, ...selection })
              let previous = data.professional
              if (!appliedProfessionalLink.current && (selection.serviceIds?.length ?? 0) > 0) {
                appliedProfessionalLink.current = true
                const values = new URLSearchParams(window.location.search).getAll('professional')
                if (values.length === 1 && /^[A-Za-z0-9_-]{1,128}$/.test(values[0])) previous = { kind: 'person', id: values[0] }
              }
              const fields = siguiente.choice.kind === 'unavailable' ? { professional: NO_PROFESSIONAL, professionalName: '' } : professionalFields(siguiente.choice, previous)
              const next = { ...data, ...selection, ...fields }
              const selectionChanged = JSON.stringify(wizardServiceIds(data)) !== JSON.stringify(wizardServiceIds(next))
              const reset = selectionChanged || data.serviceModality !== next.serviceModality || !samePick(data.professional, next.professional)
              if (reset) changed(selectionChanged ? 'service' : 'modality', next)
              updateData({ ...next, ...(reset ? { date: null, timeSlot: null, idempotencyKey: null, promotionCode: undefined } : {}) })
            }}
            onContinue={() => {
              const selected = context(data)
              if (!selected || choice.kind === 'unavailable') return
              analytics.track({ type: 'service_selected', data: { ...selected, professionalStepRequired: steps.some(s => s.key === 'professional') } })
              nextStep()
            }}
          />
        )}
        {currentStep === 'professional' && choice.kind === 'ask' && (
          <StepProfessional
            options={choice.options}
            preview={{ businessId, timezone, data }}
            selected={data.professional}
            serviceName={data.serviceName}
            title={professionalWords.chooseProfessional}
            onSelect={(pick) => {
              // Cambiar de elección cambia la agenda: la hora que se había elegido
              // salió de otra y puede estar ocupada para esta. Vale igual al pasar de
              // una persona a "cualquiera" —la unión ofrece horas que ella no tenía—
              // y al revés.
              const cambio = !samePick(data.professional, pick)
              const selected = { ...data, ...professionalFields(choice, pick) }
              if (cambio) changed('professional', selected)
              const selectedContext = context(selected)
              if (selectedContext) analytics.track({ type: 'professional_selected', data: selectedContext })
              updateData({
                ...professionalFields(choice, pick),
                ...(cambio ? { timeSlot: null, idempotencyKey: null } : {}),
              })
              nextStep()
            }}
            onBack={prevStep}
          />
        )}
        {(currentStep === 'date' || currentStep === 'time') && (
          <StepDateTime businessId={businessId} timezone={timezone} data={data}
            onDate={(date) => {
              const next = { ...data, date }
              const different = localDate(data) !== localDate(next)
              if (different) changed('date', next)
              const selected = context(next)
              if (selected && date) analytics.track({ type: 'date_selected', data: { ...selected, localDate: localDate(next)! } })
              updateData({ date, ...(different ? { timeSlot: null, idempotencyKey: null } : {}) })
            }}
            onSelect={(timeSlot) => {
              const different = data.timeSlot?.start.getTime() !== timeSlot.start.getTime() || data.timeSlot?.end.getTime() !== timeSlot.end.getTime()
              if (different) changed('time', { ...data, timeSlot })
              const selected = context(data)
              const hour = Number(formatInTimeZone(timeSlot.start, timezone, 'H'))
              if (selected && localDate(data)) analytics.track({ type: 'time_selected', data: { ...selected, localDate: localDate(data)!, timeBucket: hour < 6 ? '00_06' : hour < 12 ? '06_12' : hour < 18 ? '12_18' : '18_24' } })
              updateData({ timeSlot, ...(different ? { idempotencyKey: null } : {}) })
              setCurrentStep('customer')
            }} onBack={prevStep}
          />
        )}
        {currentStep === 'customer' && data.timeSlot && (
          <StepCustomer data={data} sessionEmail={session?.email ?? null} onLoginCta={handleLoginCta} onSubmit={(customerData) => {
            analytics.track({ type: 'customer_step_completed', data: {} })
            updateData(customerData)
            nextStep()
          }} onBack={prevStep} />
        )}
        {currentStep === 'customer' && !data.timeSlot && (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">Primero debes seleccionar un horario</p>
            <button onClick={() => setCurrentStep('date')} className="font-semibold text-primary underline">Volver a seleccionar horario</button>
          </div>
        )}
        {currentStep === 'payment' && data.serviceId && data.timeSlot && (
          <StepPayment data={data} updateData={updateData} businessId={businessId} timezone={timezone} currency={currency} cancellationPolicy={cancellationPolicy} cancellationPolicyRevision={cancellationPolicyRevision} selfServiceCutoffHours={selfServiceCutoffHours} manualHoldHours={manualHoldHours} referralToken={referralToken} onSuccess={(creada) => {
            setReserva(creada)
            nextStep()
          }} onBack={prevStep} />
        )}
        {currentStep === 'payment' && (!data.serviceId || !data.timeSlot) && (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">Faltan datos de la reserva</p>
            <button onClick={() => setCurrentStep('service')} className="font-semibold text-primary underline">Volver al inicio</button>
          </div>
        )}
        {/* La confirmación pide la reserva de verdad. Antes entraba igual con
            nueve `?? default` tapando el objeto ausente, y esos defaults no son
            neutros: `mode: 'paid'` + `confirmed: false` le dicen a la clienta
            "Reserva recibida, ya pagaste" sobre una reserva que no existe. El
            resto del archivo ya resuelve así los pasos que dependen de un dato
            (ver 'time', 'customer' y 'payment' acá arriba). */}
        {currentStep === 'confirmation' && reserva && (
          <>
            <StepConfirmation data={data} timezone={timezone} currency={currency} bookingId={reserva.id} bookingNumber={reserva.bookingNumber} mode={reserva.mode} amounts={reserva.amounts} promo={reserva.promo} sessionEmail={session?.email ?? null} business={business} where={reserva.where} confirmed={reserva.confirmed} professionalName={reserva.professionalName} cancellationCutoffHours={reserva.cancellationCutoffHours} cancellationPolicySnapshot={reserva.cancellationPolicySnapshot} depositRequired={reserva.depositRequired} depositPaid={reserva.depositPaid} pushMode={reserva.pushMode} pushGrant={reserva.pushGrant} canonicalOrigin={getAppUrl('')} />
          </>
        )}
        {currentStep === 'confirmation' && !reserva && (
          /* Hoy no se llega: a 'confirmation' sólo se entra desde el `onSuccess`
             del paso de pago, que trae la reserva. La salida NO es "empezá de
             nuevo" —si la reserva sí existió, eso la haría reservar dos veces—
             sino mandarla a mirar sus reservas. */
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">No pudimos mostrar los datos de tu reserva. Si llegaste hasta el pago, revisá tus reservas antes de volver a intentar.</p>
            <Link href={`/mi/${slug}`} className="font-semibold text-primary underline">Ver mis reservas</Link>
          </div>
        )}
      </section>
    </div>
  )
}
