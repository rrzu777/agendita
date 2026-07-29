import { NextRequest, NextResponse } from 'next/server'
import { sendReminders } from '@/lib/cron/send-reminders'
import { logger } from '@/lib/logger'
import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'

/**
 * Endpoint de cron para enviar recordatorios ~24h antes de la cita.
 * Lo dispara Vercel Cron (GET) según el schedule en vercel.json; también acepta
 * POST para invocación manual. Vercel adjunta Authorization: Bearer ${CRON_SECRET}
 * automáticamente cuando CRON_SECRET está configurado.
 */
async function handler(request: NextRequest) {
  if (!hasValidBearerSecret(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await sendReminders()

  console.log(`[cron:send-reminders] Sent ${result.sent}, skipped ${result.skipped}, errors ${result.errors} at ${new Date().toISOString()}`)
  logger.info('booking.reminder_sent', `Cron send-reminders completed: sent=${result.sent} skipped=${result.skipped} errors=${result.errors}`)

  return NextResponse.json(result)
}

export const GET = handler
export const POST = handler
