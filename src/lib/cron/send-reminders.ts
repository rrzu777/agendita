import { prisma } from '@/lib/db'
import { BookingStatus } from '@prisma/client'
import {
  sendReminderEmail,
} from '@/lib/notifications'
import { logger } from '@/lib/logger'

export interface SendRemindersResult {
  sent: number
  skipped: number
  errors: number
}

export async function sendReminders(now: Date = new Date()): Promise<SendRemindersResult> {
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000)

  const bookings = await prisma.booking.findMany({
    where: {
      status: BookingStatus.confirmed,
      startDateTime: { gte: windowStart, lte: windowEnd },
      reminderSentAt: null,
    },
    include: {
      service: { select: { name: true } },
      customer: { select: { name: true, phone: true, email: true } },
      business: {
        select: {
          id: true,
          name: true,
          timezone: true,
          whatsapp: true,
          addressText: true,
          currency: true,
          slug: true,
          subdomain: true,
        },
      },
    },
  })

  let sent = 0
  let skipped = 0
  let errors = 0

  for (const booking of bookings) {
    if (!booking.customer?.email) {
      skipped++
      continue
    }

    try {
      const result = await sendReminderEmail({
        businessName: booking.business.name,
        customerName: booking.customer!.name,
        customerEmail: booking.customer!.email!,
        serviceName: booking.service?.name ?? 'Servicio',
        startDateTime: booking.startDateTime,
        businessTimezone: booking.business.timezone || 'America/Santiago',
        businessWhatsapp: booking.business.whatsapp,
        businessAddress: booking.business.addressText,
        businessCurrency: booking.business.currency || 'CLP',
        totalPrice: booking.totalPrice,
        remainingBalance: booking.remainingBalance,
        depositPaid: booking.depositPaid,
      })

      if (result.success) {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { reminderSentAt: new Date() },
        })
        sent++
      } else {
        skipped++
      }
    } catch {
      logger.error('reminder.failed', `Failed to send reminder for booking ${booking.id}`)
      errors++
    }
  }

  return { sent, skipped, errors }
}
