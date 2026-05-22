'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { MessageCircle, Copy, Check } from 'lucide-react'
import {
  buildWhatsappUrl,
  buildBookingConfirmationWhatsappMessage,
  buildWhatsappBookingSummaryText,
} from '@/lib/notifications'

export interface BookingContactData {
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
}

interface BookingContactButtonsProps {
  booking: BookingContactData
  /** Extra fields shown in the summary (optional) */
  variant?: 'default' | 'compact'
}

export function BookingContactButtons({ booking, variant = 'default' }: BookingContactButtonsProps) {
  const [copied, setCopied] = useState(false)

  const phone = booking.customerPhone || ''
  const hasPhone = phone.replace(/\D/g, '').length >= 8
  const start = typeof booking.startDateTime === 'string'
    ? new Date(booking.startDateTime)
    : booking.startDateTime

  const summaryText = buildWhatsappBookingSummaryText({
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
  })

  const whatsappMessage = buildBookingConfirmationWhatsappMessage({
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
  })

  const handleCopySummary = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(summaryText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API may not be available
    }
  }, [summaryText])

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
            {variant === 'compact' ? 'WhatsApp' : 'Enviar confirmación por WhatsApp'}
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
    </div>
  )
}
