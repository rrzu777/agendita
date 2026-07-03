'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { MessageCircle, Copy, Check, BellRing } from 'lucide-react'
import {
  buildWhatsappUrl,
  buildBookingConfirmationWhatsappMessage,
  buildWhatsappBookingSummaryText,
  buildWhatsappReminderMessage,
} from '@/lib/notifications'

export interface BookingContactData {
  bookingNumber?: number | null
  customerName: string
  customerPhone: string | null
  serviceName: string
  startDateTime: Date | string
  businessTimezone: string
  businessCurrency: string
  totalPrice: number
  depositPaid: number
  remainingBalance: number
  businessAddress?: string | null
  businessName?: string | null
}

interface BookingContactButtonsProps {
  booking: BookingContactData
  variant?: 'default' | 'compact'
  showReminder?: boolean
}

export function BookingContactButtons({ booking, variant = 'default', showReminder = true }: BookingContactButtonsProps) {
  const [copied, setCopied] = useState(false)
  const [reminderCopied, setReminderCopied] = useState(false)

  const phone = booking.customerPhone || ''
  const hasPhone = phone.replace(/\D/g, '').length >= 8
  const start = typeof booking.startDateTime === 'string'
    ? new Date(booking.startDateTime)
    : booking.startDateTime

  const bookingData = {
    bookingNumber: booking.bookingNumber ?? null,
    customerName: booking.customerName,
    customerPhone: phone,
    serviceName: booking.serviceName,
    startDateTime: start,
    businessTimezone: booking.businessTimezone,
    businessCurrency: booking.businessCurrency,
    totalPrice: booking.totalPrice || 0,
    depositPaid: booking.depositPaid || 0,
    remainingBalance: booking.remainingBalance || 0,
    businessAddress: booking.businessAddress || null,
  }

  const summaryText = buildWhatsappBookingSummaryText(bookingData)

  const whatsappMessage = buildBookingConfirmationWhatsappMessage(bookingData)

  const reminderMessage = buildWhatsappReminderMessage(bookingData)

  // Plain handlers — summaryText/reminderMessage are recomputed every render, so
  // useCallback here memoized nothing. (React Compiler can't preserve it anyway.)
  const handleCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API may not be available
    }
  }

  const handleCopyReminder = async () => {
    try {
      await navigator.clipboard.writeText(reminderMessage)
      setReminderCopied(true)
      setTimeout(() => setReminderCopied(false), 2000)
    } catch {
      // clipboard API may not be available
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {hasPhone && (
        <Button
          size={variant === 'compact' ? 'xs' : 'sm'}
          variant="outline"
          className="gap-1"
          asChild
        >
          <a
            href={buildWhatsappUrl(phone, whatsappMessage)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle className="size-3.5" />
            {variant === 'compact' ? 'Confirmación' : 'Enviar confirmación'}
          </a>
        </Button>
      )}
      {showReminder && hasPhone && (
        <Button
          size={variant === 'compact' ? 'xs' : 'sm'}
          variant="outline"
          className="gap-1"
          asChild
        >
          <a
            href={buildWhatsappUrl(phone, reminderMessage)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <BellRing className="size-3.5" />
            {variant === 'compact' ? 'Recordatorio' : 'Enviar recordatorio'}
          </a>
        </Button>
      )}
      <Button
        size={variant === 'compact' ? 'xs' : 'sm'}
        variant="ghost"
        className="gap-1"
        onClick={handleCopySummary}
        disabled={copied}
      >
        {copied ? (
          <>
            <Check className="size-3.5" />
            Copiado
          </>
        ) : (
          <>
            <Copy className="size-3.5" />
            {variant === 'compact' ? 'Copiar' : 'Copiar resumen'}
          </>
        )}
      </Button>
      {showReminder && (
        <Button
          size={variant === 'compact' ? 'xs' : 'sm'}
          variant="ghost"
          className="gap-1"
          onClick={handleCopyReminder}
          disabled={reminderCopied}
        >
          {reminderCopied ? (
            <>
              <Check className="size-3.5" />
              Copiado
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              {variant === 'compact' ? 'Recordatorio' : 'Copiar recordatorio'}
            </>
          )}
        </Button>
      )}
      {!hasPhone && (
        <p className="text-xs text-muted-foreground py-1">Sin teléfono registrado</p>
      )}
    </div>
  )
}
