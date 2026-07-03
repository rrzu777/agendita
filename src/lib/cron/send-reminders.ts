import { prisma } from '@/lib/db'
import { BookingStatus } from '@prisma/client'
import {
  getBusinessReplyToEmail,
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

    // Atomically claim this reminder before sending. Vercel Cron has
    // at-least-once delivery, so two concurrent invocations can read the same
    // `reminderSentAt: null` batch. The conditional updateMany acts as a
    // compare-and-swap: only the worker whose update matches (count === 1) is
    // allowed to send, preventing duplicate emails.
    const claim = await prisma.booking.updateMany({
      where: { id: booking.id, reminderSentAt: null },
      data: { reminderSentAt: now },
    })
    if (claim.count === 0) {
      // Another concurrent run already claimed/sent this reminder.
      skipped++
      continue
    }

    try {
      const result = await sendReminderEmail({
        businessName: booking.business.name,
        bookingNumber: booking.bookingNumber,
        businessReplyToEmail: await getBusinessReplyToEmail(booking.business.id),
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
        sent++
      } else {
        // Release the claim so a later run can retry.
        await prisma.booking.updateMany({
          where: { id: booking.id, reminderSentAt: now },
          data: { reminderSentAt: null },
        })
        skipped++
      }
    } catch {
      // Release the claim so a later run can retry.
      await prisma.booking.updateMany({
        where: { id: booking.id, reminderSentAt: now },
        data: { reminderSentAt: null },
      })
      logger.error('reminder.failed', `Failed to send reminder for booking ${booking.id}`)
      errors++
    }
  }

  return { sent, skipped, errors }
}
