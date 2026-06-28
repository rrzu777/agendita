'use client'

import { useState } from 'react'
import { StepService } from './step-service'
import { StepDate } from './step-date'
import { StepTime } from './step-time'
import { StepCustomer } from './step-customer'
import { StepPayment } from './step-payment'
import { StepConfirmation } from './step-confirmation'
import type { Service } from '@prisma/client'

export type BookingData = {
  serviceId: string | null
  serviceName: string
  servicePrice: number
  serviceDuration: number
  serviceDeposit: number
  serviceColor: string
  date: Date | null
  timeSlot: { start: Date; end: Date } | null
  customerName: string
  customerPhone: string
  customerEmail: string
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
  date: null,
  timeSlot: null,
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  customerNotes: '',
  idempotencyKey: null,
}

const steps = [
  { id: 1, label: 'Servicio' },
  { id: 2, label: 'Fecha' },
  { id: 3, label: 'Hora' },
  { id: 4, label: 'Tus datos' },
  { id: 5, label: 'Pago' },
  { id: 6, label: 'Confirmación' },
]

interface BookingWizardProps {
  businessId: string
  services: Service[]
  cancellationPolicy?: string | null
}

export function BookingWizard({ businessId, services, cancellationPolicy }: BookingWizardProps) {
  const [currentStep, setCurrentStep] = useState(1)
  const [data, setData] = useState<BookingData>(initialData)
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [confirmationMode, setConfirmationMode] = useState<'paid' | 'pending'>('paid')

  function updateData(partial: Partial<BookingData>) {
    setData(prev => ({ ...prev, ...partial }))
  }

  function nextStep() {
    setCurrentStep(prev => Math.min(prev + 1, steps.length))
  }

  function prevStep() {
    setCurrentStep(prev => Math.max(prev - 1, 1))
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <div className="mb-3 flex items-center gap-1.5">
          {steps.map((step) => (
            <div
              key={step.id}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                step.id <= currentStep ? 'bg-primary' : 'bg-secondary'
              }`}
            />
          ))}
        </div>
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Paso {currentStep} de {steps.length}</p>
          <p className="font-heading text-base font-semibold text-primary">{steps[currentStep - 1]?.label}</p>
        </div>
      </div>

      <section className="rounded-[2rem] border border-border/50 bg-card p-5 shadow-[var(--cream-shadow)] sm:p-8">
        {currentStep === 1 && (
          <StepService data={data} services={services} onSelect={(service) => {
            updateData(service)
            nextStep()
          }} />
        )}
        {currentStep === 2 && (
          <StepDate data={data} onSelect={(date) => {
            updateData({ date })
            nextStep()
          }} onBack={prevStep} />
        )}
        {currentStep === 3 && data.date && (
          <StepTime 
            businessId={businessId}
            data={data} 
            onSelect={(timeSlot) => {
              updateData({ timeSlot })
              nextStep()
            }} onBack={prevStep} />
        )}
        {currentStep === 3 && !data.date && (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">Primero debes seleccionar una fecha</p>
            <button onClick={() => setCurrentStep(2)} className="font-semibold text-primary underline">Volver a seleccionar fecha</button>
          </div>
        )}
        {currentStep === 4 && data.timeSlot && (
          <StepCustomer data={data} onSubmit={(customerData) => {
            updateData(customerData)
            nextStep()
          }} onBack={prevStep} />
        )}
        {currentStep === 4 && !data.timeSlot && (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">Primero debes seleccionar un horario</p>
            <button onClick={() => setCurrentStep(3)} className="font-semibold text-primary underline">Volver a seleccionar horario</button>
          </div>
        )}
        {currentStep === 5 && data.serviceId && data.timeSlot && (
          <StepPayment data={data} businessId={businessId} cancellationPolicy={cancellationPolicy} onSuccess={(id, mode) => {
            setBookingId(id)
            setConfirmationMode(mode)
            nextStep()
          }} onBack={prevStep} />
        )}
        {currentStep === 5 && (!data.serviceId || !data.timeSlot) && (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">Faltan datos de la reserva</p>
            <button onClick={() => setCurrentStep(1)} className="font-semibold text-primary underline">Volver al inicio</button>
          </div>
        )}
        {currentStep === 6 && (
          <StepConfirmation data={data} bookingId={bookingId} mode={confirmationMode} />
        )}
      </section>
    </div>
  )
}
