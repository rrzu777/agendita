'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { BellRing, Copy, MessageCircle } from 'lucide-react'
import {
  buildWhatsappUrl,
  buildBookingConfirmationWhatsappMessage,
  buildWhatsappBookingSummaryText,
  buildWhatsappReminderMessage,
} from '@/lib/notifications'
import { effectiveBookingStatus } from '@/lib/bookings/status-labels'
import type { BookingWhere } from '@/lib/services/modality'

/** `BookingWhere` trae el "dónde" completo, no una dirección suelta. */
export interface BookingContactData extends BookingWhere {
  id: string
  bookingNumber?: number | null
  customerName: string
  customerPhone: string | null
  serviceName: string
  professionalName: string | null
  startDateTime: Date | string
  businessTimezone: string
  businessCurrency: string
  totalPrice: number
  depositPaid: number
  remainingBalance: number
  businessName?: string | null
}

export interface BookingContactAvailability {
  status: string
  paymentStatus: string
  holdExpiresAt: Date | null
  /** Reloj del servidor compartido con la fila/card/drawer. */
  now: Date
}

type CopyKind = 'summary' | 'confirmation' | 'reminder'
type CopyFeedback = { kind: CopyKind; outcome: 'success' | 'error' } | null
type ContactContextInstance = { key: string }
type StoredCopyFeedback = Exclude<CopyFeedback, null> & { context: ContactContextInstance }

export interface BookingContactController {
  hasPhone: boolean
  neutralWhatsappUrl: string | null
  confirmationWhatsappUrl: string | null
  reminderWhatsappUrl: string | null
  canConfirm: boolean
  canRemind: boolean
  feedback: CopyFeedback
  copy: (kind: CopyKind) => Promise<void>
  retry: () => Promise<void>
}

const COPY_LABEL: Record<CopyKind, { noun: string; article: 'el' | 'la'; participle: 'copiado' | 'copiada' }> = {
  summary: { noun: 'resumen', article: 'el', participle: 'copiado' },
  confirmation: { noun: 'confirmación', article: 'la', participle: 'copiada' },
  reminder: { noun: 'recordatorio', article: 'el', participle: 'copiado' },
}

/**
 * Estado persistente para las acciones de contacto. BookingRowActions llama
 * este hook por encima del portal de Radix: cerrar el menú no desmonta el
 * resultado de clipboard ni su reintento.
 */
export function useBookingContactController(
  booking: BookingContactData | null,
  availability: BookingContactAvailability,
): BookingContactController {
  const [storedFeedback, setStoredFeedback] = useState<StoredCopyFeedback | null>(null)
  const phone = booking?.customerPhone || ''
  const hasPhone = phone.replace(/\D/g, '').length >= 8
  const start = booking
    ? typeof booking.startDateTime === 'string'
      ? new Date(booking.startDateTime)
      : booking.startDateTime
    : availability.now
  const canConfirm = !!booking && effectiveBookingStatus(availability, availability.now) === 'confirmed'
  const canRemind = canConfirm && start.getTime() > availability.now.getTime()

  const bookingData = booking ? {
    ...booking,
    customerPhone: phone,
    startDateTime: start,
    totalPrice: booking.totalPrice || 0,
    depositPaid: booking.depositPaid || 0,
    remainingBalance: booking.remainingBalance || 0,
  } : null

  const texts: Partial<Record<CopyKind, string>> = bookingData ? {
    summary: buildWhatsappBookingSummaryText(bookingData),
    ...(canConfirm ? { confirmation: buildBookingConfirmationWhatsappMessage(bookingData) } : {}),
    ...(canRemind ? { reminder: buildWhatsappReminderMessage(bookingData) } : {}),
  } : {}
  const contextKey = booking ? JSON.stringify([
    booking.id,
    booking.bookingNumber,
    booking.customerName,
    booking.customerPhone,
    booking.serviceName,
    booking.professionalName,
    start.toISOString(),
    booking.businessTimezone,
    booking.businessCurrency,
    booking.totalPrice,
    booking.depositPaid,
    booking.remainingBalance,
    booking.modality,
    booking.serviceAddress,
    booking.meetingUrl,
    booking.businessAddress,
    availability.status,
    availability.paymentStatus,
    availability.holdExpiresAt?.toISOString() ?? null,
    canConfirm,
    canRemind,
  ]) : 'no-booking'
  // La identidad importa además del contenido: si la misma reserva reaparece
  // después de otra (A → B → A), es una instancia nueva y no debe revivir el
  // feedback ni aceptar una promesa iniciada en la primera A.
  const context = useMemo<ContactContextInstance>(() => ({ key: contextKey }), [contextKey])
  const currentContext = useRef<ContactContextInstance | null>(context)
  useEffect(() => {
    currentContext.current = context
    return () => {
      if (currentContext.current === context) currentContext.current = null
    }
  }, [context])
  const feedback: CopyFeedback = storedFeedback &&
    storedFeedback.context === context &&
    texts[storedFeedback.kind]
    ? { kind: storedFeedback.kind, outcome: storedFeedback.outcome }
    : null

  async function copy(kind: CopyKind) {
    const text = texts[kind]
    if (!text) return
    const operationContext = context
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(text)
      if (currentContext.current === operationContext) {
        setStoredFeedback({ kind, outcome: 'success', context: operationContext })
      }
    } catch {
      if (currentContext.current === operationContext) {
        setStoredFeedback({ kind, outcome: 'error', context: operationContext })
      }
    }
  }

  async function retry() {
    if (feedback?.outcome === 'error' && texts[feedback.kind]) await copy(feedback.kind)
  }

  // Mensaje deliberadamente neutral. Task 7 puede personalizarlo sin tocar
  // estas reglas de disponibilidad ni volver a afirmar un estado falso.
  const neutralMessage = booking ? `Hola ${booking.customerName}, te escribo por tu reserva.` : ''

  return {
    hasPhone,
    neutralWhatsappUrl: booking && hasPhone ? buildWhatsappUrl(phone, neutralMessage) : null,
    confirmationWhatsappUrl: bookingData && hasPhone && canConfirm
      ? buildWhatsappUrl(phone, texts.confirmation!)
      : null,
    reminderWhatsappUrl: bookingData && hasPhone && canRemind
      ? buildWhatsappUrl(phone, texts.reminder!)
      : null,
    canConfirm,
    canRemind,
    feedback,
    copy,
    retry,
  }
}

interface BookingContactButtonsProps {
  booking: BookingContactData
  availability: BookingContactAvailability
  variant?: 'default' | 'compact' | 'menu'
  /** Lo provee BookingRowActions para mantener feedback fuera del portal. */
  controller?: BookingContactController
}

export function BookingContactFeedback({ controller }: { controller: BookingContactController }) {
  const feedback = controller.feedback
  if (!feedback) return null
  const label = COPY_LABEL[feedback.kind]
  const capitalizedNoun = label.noun.charAt(0).toUpperCase() + label.noun.slice(1)

  if (feedback.outcome === 'success') {
    return <p role="status" className="text-xs text-success">{capitalizedNoun} {label.participle}</p>
  }

  return (
    <div role="alert" className="flex flex-wrap items-center justify-end gap-1 text-xs text-destructive">
      <span>No pudimos copiar {label.article} {label.noun}.</span>
      <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2" onClick={() => { void controller.retry() }}>
        Reintentar
      </Button>
    </div>
  )
}

export function BookingContactButtons({
  booking,
  availability,
  variant = 'default',
  controller: persistentController,
}: BookingContactButtonsProps) {
  const localController = useBookingContactController(booking, availability)
  const controller = persistentController ?? localController

  if (variant === 'menu') {
    return (
      <>
        {controller.neutralWhatsappUrl && (
          <DropdownMenuItem asChild className="min-h-11 cursor-pointer">
            <a href={controller.neutralWhatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" /> Contactar por WhatsApp
            </a>
          </DropdownMenuItem>
        )}
        {controller.confirmationWhatsappUrl && (
          <DropdownMenuItem asChild className="min-h-11 cursor-pointer">
            <a href={controller.confirmationWhatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" /> Enviar confirmación
            </a>
          </DropdownMenuItem>
        )}
        {controller.canConfirm && (
          <DropdownMenuItem className="min-h-11 cursor-pointer" onSelect={() => { void controller.copy('confirmation') }}>
            <Copy className="size-4" /> Copiar confirmación
          </DropdownMenuItem>
        )}
        {controller.reminderWhatsappUrl && (
          <DropdownMenuItem asChild className="min-h-11 cursor-pointer">
            <a href={controller.reminderWhatsappUrl} target="_blank" rel="noopener noreferrer">
              <BellRing className="size-4" /> Enviar recordatorio
            </a>
          </DropdownMenuItem>
        )}
        {controller.canRemind && (
          <DropdownMenuItem className="min-h-11 cursor-pointer" onSelect={() => { void controller.copy('reminder') }}>
            <Copy className="size-4" /> Copiar recordatorio
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="min-h-11 cursor-pointer" onSelect={() => { void controller.copy('summary') }}>
          <Copy className="size-4" /> Copiar resumen
        </DropdownMenuItem>
        {!controller.hasPhone && <DropdownMenuItem className="min-h-11" disabled>Sin teléfono registrado</DropdownMenuItem>}
      </>
    )
  }

  const compact = variant === 'compact'
  return (
    <div data-slot="booking-contact-actions" className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {controller.neutralWhatsappUrl && (
          <Button size={compact ? 'sm' : 'form'} variant="outline" className="min-h-11 gap-1" asChild>
            <a href={controller.neutralWhatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-3.5" /> Contactar por WhatsApp
            </a>
          </Button>
        )}
        {controller.confirmationWhatsappUrl && (
          <Button size={compact ? 'sm' : 'form'} variant="outline" className="min-h-11 gap-1" asChild>
            <a href={controller.confirmationWhatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-3.5" /> Enviar confirmación
            </a>
          </Button>
        )}
        {controller.canConfirm && (
          <Button size={compact ? 'sm' : 'form'} variant="ghost" className="min-h-11 gap-1" onClick={() => { void controller.copy('confirmation') }}>
            <Copy className="size-3.5" /> Copiar confirmación
          </Button>
        )}
        {controller.reminderWhatsappUrl && (
          <Button size={compact ? 'sm' : 'form'} variant="outline" className="min-h-11 gap-1" asChild>
            <a href={controller.reminderWhatsappUrl} target="_blank" rel="noopener noreferrer">
              <BellRing className="size-3.5" /> Enviar recordatorio
            </a>
          </Button>
        )}
        {controller.canRemind && (
          <Button size={compact ? 'sm' : 'form'} variant="ghost" className="min-h-11 gap-1" onClick={() => { void controller.copy('reminder') }}>
            <Copy className="size-3.5" /> Copiar recordatorio
          </Button>
        )}
        <Button size={compact ? 'sm' : 'form'} variant="ghost" className="min-h-11 gap-1" onClick={() => { void controller.copy('summary') }}>
          <Copy className="size-3.5" /> Copiar resumen
        </Button>
        {!controller.hasPhone && <p className="flex min-h-11 items-center text-xs text-muted-foreground">Sin teléfono registrado</p>}
      </div>
      <BookingContactFeedback controller={controller} />
    </div>
  )
}
