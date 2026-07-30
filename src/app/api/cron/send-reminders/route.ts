import { NextRequest, NextResponse } from 'next/server'
import { sendReminders } from '@/lib/cron/send-reminders'
import { logger } from '@/lib/logger'
import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'

/**
 * Endpoint de cron para enviar recordatorios ~24h antes de la cita.
 *
 * Lo dispara **GitHub Actions**, no Vercel: `.github/workflows/cron.yml` le pega
 * cada hora con `curl -X POST` y `Authorization: Bearer ${CRON_SECRET}`. NO hay
 * `vercel.json` y es a propósito — Vercel Hobby capea los crons a ~uno por día.
 * (El GET queda para invocación manual.)
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
