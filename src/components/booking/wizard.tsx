'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { StepService } from './step-service'
import { StepProfessional } from './step-professional'
import { StepDate } from './step-date'
import { StepTime } from './step-time'
import { StepCustomer } from './step-customer'
import type { BookingCreated } from './step-payment'
import type { ConfirmationBusiness } from './step-confirmation'
import type { Service, ServiceModality } from '@prisma/client'
import type { FunnelSession } from '@/lib/customers/session-prefill'
import type { ProfessionalWords } from '@/lib/vocabulary'
import { NO_PROFESSIONAL, professionalChoice, professionalFields, samePick, type FunnelProfessional, type ProfessionalPick } from '@/lib/professionals/eligible'
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
  const router = useRouter()
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
  function derivar(d: BookingData): { choice: ReturnType<typeof professionalChoice>; steps: WizardStep[] } {
    const choice = professionalChoice(professionals, d.serviceId, d.serviceModality)
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
    const raw = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    const restored = restoreWizardState(raw, services, professionals)
    if (!restored) return
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from sessionStorage on mount, gated by ?continuar=1 */
    setData(applySessionPrefill(restored, session))
    setCurrentStep(entryStepAfterRestore(restored, derivar(restored).steps))
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, [])

  function handleLoginCta(partial: Partial<BookingData>) {
    const merged = { ...data, ...partial }
    const raw = serializeWizardState(merged)
    if (raw) sessionStorage.setItem(wizardStorageKey(businessId), raw)
    router.push(`/ingresar?next=${encodeURIComponent(`/ir/${slug}`)}`)
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
            // Se deriva del estado SIGUIENTE, no del de este render: `steps` todavía
            // se calculó con el servicio anterior y avanzar con esa lista saltearía
            // el paso que acaba de aparecer.
            //
            // El destino igual sale de `stepAfter` y no escrito a mano: el orden de
            // los pasos tiene que vivir en `stepsFor` y en ningún otro lado, o la
            // barra de progreso y la navegación se separan en silencio.
            const siguiente = derivar({ ...data, ...service })
            // La persona elegida sobrevive si también hace el servicio nuevo; si no,
            // se suelta. Es la misma cuenta que hace el restore.
            updateData({ ...service, ...professionalFields(siguiente.choice, data.professional) })
            setCurrentStep(stepAfter(siguiente.steps, 'service'))
          }} />
        )}
        {currentStep === 'professional' && choice.kind === 'ask' && (
          <StepProfessional
            options={choice.options}
            selected={data.professional}
            serviceName={data.serviceName}
            title={professionalWords.chooseProfessional}
            onSelect={(pick) => {
              // Cambiar de elección cambia la agenda: la hora que se había elegido
              // salió de otra y puede estar ocupada para esta. Vale igual al pasar de
              // una persona a "cualquiera" —la unión ofrece horas que ella no tenía—
              // y al revés.
              const cambio = !samePick(data.professional, pick)
              updateData({
                ...professionalFields(choice, pick),
                ...(cambio ? { timeSlot: null, idempotencyKey: null } : {}),
              })
              nextStep()
            }}
            onBack={prevStep}
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
            <StepConfirmation data={data} timezone={timezone} currency={currency} bookingId={reserva.id} bookingNumber={reserva.bookingNumber} mode={reserva.mode} promo={reserva.promo} sessionEmail={session?.email ?? null} business={business} where={reserva.where} confirmed={reserva.confirmed} professionalName={reserva.professionalName} cancellationCutoffHours={reserva.cancellationCutoffHours} cancellationPolicySnapshot={reserva.cancellationPolicySnapshot} depositRequired={reserva.depositRequired} depositPaid={reserva.depositPaid} pushMode={reserva.pushMode} pushGrant={reserva.pushGrant} canonicalOrigin={getAppUrl('')} />
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
