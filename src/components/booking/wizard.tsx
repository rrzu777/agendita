'use client'

import { useEffect, useState } from 'react'
import { StepService } from './step-service'
import { StepProfessional } from './step-professional'
import { StepDate } from './step-date'
import { StepTime } from './step-time'
import { StepCustomer } from './step-customer'
import { StepPayment, type BookingCreated } from './step-payment'
import { StepConfirmation, type ConfirmationBusiness } from './step-confirmation'
import type { Service, ServiceModality } from '@prisma/client'
import type { FunnelSession } from '@/lib/customers/session-prefill'
import type { ProfessionalWords } from '@/lib/vocabulary'
import { professionalChoice, type FunnelProfessional, type ProfessionalChoice } from '@/lib/professionals/eligible'
import { entryStepAfterRestore, stepAfter, stepBefore, stepsFor, type StepKey } from '@/lib/bookings/wizard-steps'
import { restoreWizardState, serializeWizardState, wizardStorageKey } from '@/lib/bookings/wizard-storage'

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

/**
 * A nombre de quién queda la reserva, para el servicio que se acaba de elegir.
 *
 * Con una sola persona elegible se asigna sin preguntar; con varias queda vacío
 * hasta que la clienta elija. Se escribe en el estado al elegir SERVICIO —y no se
 * deriva en cada render— porque cambiar de servicio tiene que soltar a la persona
 * anterior: si no, quien eligió a Ana para un corte se lleva a Ana a un servicio
 * que Ana no hace.
 */
function professionalFieldsFor(choice: ProfessionalChoice): Pick<BookingData, 'professionalId' | 'professionalName'> {
  return choice.kind === 'auto'
    ? { professionalId: choice.professional.id, professionalName: choice.professional.name }
    : { professionalId: null, professionalName: '' }
}

export type BookingData = {
  serviceId: string | null
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
  /** Con quién. `null` = sin persona: es el caso de un negocio sin equipo cargado,
   *  y contra la agenda significa que la reserva choca contra todas. */
  professionalId: string | null
  /** Denormalizado para mostrarlo en la confirmación, igual que `serviceName`. */
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
  professionalId: null,
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
  referralToken?: string
  session: WizardSession
}

export function BookingWizard({ businessId, slug, business, timezone, currency, services, professionals, professionalWords, cancellationPolicy, referralToken, session }: BookingWizardProps) {
  const [currentStep, setCurrentStep] = useState<StepKey>('service')
  const [data, setData] = useState<BookingData>(() => applySessionPrefill(initialData, session))
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [bookingNumber, setBookingNumber] = useState<number | null>(null)
  const [confirmationMode, setConfirmationMode] = useState<'paid' | 'pending'>('paid')
  const [confirmationPromo, setConfirmationPromo] = useState<{ discountAmount: number; finalAmount: number } | null>(null)
  // El "dónde" de la reserva ya escrita, para la confirmación. Ver `BookingCreated`.
  const [confirmationWhere, setConfirmationWhere] = useState<BookingCreated['where']>({})

  // La lista de pasos depende del servicio elegido, así que se recalcula en cada
  // render. El estado es la CLAVE del paso y no su índice justamente por esto:
  // un índice cambia de significado cuando la lista crece a mitad del recorrido.
  const choice = professionalChoice(professionals, data.serviceId, data.serviceModality)
  const steps = stepsFor(choice.kind === 'ask' ? professionalWords.Professional : null)
  const currentIndex = Math.max(0, steps.findIndex((s) => s.key === currentStep))

  // Restaura el estado guardado antes del viaje a /ingresar (solo con ?continuar=1;
  // el storage se limpia siempre para no restaurar dos veces ni dejar residuo).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!new URLSearchParams(window.location.search).has('continuar')) return
    const key = wizardStorageKey(businessId)
    const raw = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    const restored = restoreWizardState(raw, services, professionals)
    if (!restored) return
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from sessionStorage on mount, gated by ?continuar=1 */
    setData(applySessionPrefill(restored, session))
    setCurrentStep(entryStepAfterRestore(
      restored,
      professionalChoice(professionals, restored.serviceId, restored.serviceModality).kind === 'ask',
    ))
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, [])

  function handleLoginCta(partial: Partial<BookingData>) {
    const merged = { ...data, ...partial }
    const raw = serializeWizardState(merged)
    if (raw) sessionStorage.setItem(wizardStorageKey(businessId), raw)
    window.location.href = `/ingresar?next=${encodeURIComponent(`/ir/${slug}`)}`
  }

  function updateData(partial: Partial<BookingData>) {
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

      <section className="rounded-[2rem] border border-border/50 bg-card p-5 shadow-[var(--cream-shadow)] sm:p-8">
        {currentStep === 'service' && (
          <StepService data={data} services={services} currency={currency} onSelect={(service) => {
            // El paso siguiente se decide con el servicio RECIÉN elegido y no con
            // `steps`, que todavía se calculó con el anterior: el estado de React
            // no cambió aún y `stepAfter` saltearía el paso que acaba de aparecer.
            const elegido = professionalChoice(professionals, service.serviceId ?? null, service.serviceModality ?? null)
            updateData({ ...service, ...professionalFieldsFor(elegido) })
            setCurrentStep(elegido.kind === 'ask' ? 'professional' : 'date')
          }} />
        )}
        {currentStep === 'professional' && choice.kind === 'ask' && (
          <StepProfessional
            options={choice.options}
            selectedId={data.professionalId}
            serviceName={data.serviceName}
            title={professionalWords.chooseProfessional}
            onSelect={(professional) => {
              // Cambiar de persona cambia la agenda: la hora que se había elegido
              // era de otra y puede estar ocupada para esta. Se sueltan hora y
              // fecha-derivados igual que al cambiar de servicio.
              const cambio = data.professionalId !== professional.id
              updateData({
                professionalId: professional.id,
                professionalName: professional.name,
                ...(cambio ? { timeSlot: null, idempotencyKey: null } : {}),
              })
              setCurrentStep('date')
            }}
            onBack={() => setCurrentStep('service')}
          />
        )}
        {currentStep === 'date' && (
          <StepDate data={data} timezone={timezone} onSelect={(date) => {
            updateData({ date })
            nextStep()
          }} onBack={prevStep} />
        )}
        {currentStep === 'time' && data.date && (
          <StepTime
            businessId={businessId}
            timezone={timezone}
            data={data}
            onSelect={(timeSlot) => {
              // Cambiar de hora abre un intento NUEVO: la key vieja apunta a la
              // reserva del horario anterior, y createBooking la devolvería en
              // vez de reservar el que se acaba de elegir.
              //
              // Sólo si CAMBIÓ. Volver atrás y reelegir la MISMA hora tiene que
              // conservar la key: si no, la reserva que ya está en pie queda
              // huérfana ocupando ese horario y la clienta se choca contra su
              // propia reserva ("ese horario ya no está disponible") hasta que
              // venza el hold — que con transferencia son horas.
              //
              // Alcanza con soltarla ACÁ, aunque el intento también cambie al
              // cambiar de servicio: no hay camino al pago que no pase por este
              // paso (el de datos está gateado por `data.timeSlot` y este
              // `onSelect` es su único setter). El server igual rechaza la key que
              // no corresponde, que es el fail-closed de verdad.
              const cambioDeHora = data.timeSlot?.start.getTime() !== timeSlot.start.getTime()
              updateData(cambioDeHora ? { timeSlot, idempotencyKey: null } : { timeSlot })
              nextStep()
            }} onBack={prevStep} />
        )}
        {currentStep === 'time' && !data.date && (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">Primero debes seleccionar una fecha</p>
            <button onClick={() => setCurrentStep('date')} className="font-semibold text-primary underline">Volver a seleccionar fecha</button>
          </div>
        )}
        {currentStep === 'customer' && data.timeSlot && (
          <StepCustomer data={data} sessionEmail={session?.email ?? null} onLoginCta={handleLoginCta} onSubmit={(customerData) => {
            updateData(customerData)
            nextStep()
          }} onBack={prevStep} />
        )}
        {currentStep === 'customer' && !data.timeSlot && (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">Primero debes seleccionar un horario</p>
            <button onClick={() => setCurrentStep('time')} className="font-semibold text-primary underline">Volver a seleccionar horario</button>
          </div>
        )}
        {currentStep === 'payment' && data.serviceId && data.timeSlot && (
          <StepPayment data={data} updateData={updateData} businessId={businessId} timezone={timezone} currency={currency} cancellationPolicy={cancellationPolicy} referralToken={referralToken} onSuccess={(reserva) => {
            setBookingId(reserva.id)
            setBookingNumber(reserva.bookingNumber)
            setConfirmationMode(reserva.mode)
            setConfirmationPromo(reserva.promo)
            setConfirmationWhere(reserva.where)
            nextStep()
          }} onBack={prevStep} />
        )}
        {currentStep === 'payment' && (!data.serviceId || !data.timeSlot) && (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">Faltan datos de la reserva</p>
            <button onClick={() => setCurrentStep('service')} className="font-semibold text-primary underline">Volver al inicio</button>
          </div>
        )}
        {currentStep === 'confirmation' && (
          <StepConfirmation data={data} timezone={timezone} currency={currency} bookingId={bookingId} bookingNumber={bookingNumber} mode={confirmationMode} promo={confirmationPromo} sessionEmail={session?.email ?? null} business={business} where={confirmationWhere} />
        )}
      </section>
    </div>
  )
}
