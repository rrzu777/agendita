'use client'

import { useState } from 'react'
import { StepService } from './step-service'
import { StepDate } from './step-date'
import { StepTime } from './step-time'
import { StepCustomer } from './step-customer'
import { StepPayment } from './step-payment'
import { StepConfirmation } from './step-confirmation'

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
}

const steps = [
  { id: 1, label: 'Servicio' },
  { id: 2, label: 'Fecha' },
  { id: 3, label: 'Hora' },
  { id: 4, label: 'Tus datos' },
  { id: 5, label: 'Pago' },
  { id: 6, label: 'Confirmación' },
]

export function BookingWizard() {
  const [currentStep, setCurrentStep] = useState(1)
  const [data, setData] = useState<BookingData>(initialData)
  const [bookingId, setBookingId] = useState<string | null>(null)

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
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Stepper */}
      <div className="flex justify-between mb-8">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center">
            <div className={`
              w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
              ${currentStep >= step.id ? 'bg-pink-500 text-white' : 'bg-gray-200 text-gray-500'}
            `}>
              {step.id}
            </div>
            <span className={`ml-2 text-sm hidden sm:block ${currentStep >= step.id ? 'text-pink-600 font-medium' : 'text-gray-400'}`}>
              {step.label}
            </span>
            {index < steps.length - 1 && (
              <div className={`w-8 h-0.5 mx-2 ${currentStep > step.id ? 'bg-pink-500' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        {currentStep === 1 && (
          <StepService data={data} onSelect={(service) => {
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
        {currentStep === 3 && (
          <StepTime data={data} onSelect={(timeSlot) => {
            updateData({ timeSlot })
            nextStep()
          }} onBack={prevStep} />
        )}
        {currentStep === 4 && (
          <StepCustomer data={data} onSubmit={(customerData) => {
            updateData(customerData)
            nextStep()
          }} onBack={prevStep} />
        )}
        {currentStep === 5 && (
          <StepPayment data={data} onSuccess={(id) => {
            setBookingId(id)
            nextStep()
          }} onBack={prevStep} />
        )}
        {currentStep === 6 && (
          <StepConfirmation data={data} bookingId={bookingId} />
        )}
      </div>
    </div>
  )
}
