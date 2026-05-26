import { NextRequest, NextResponse } from 'next/server'
import { sendReminders } from '@/lib/cron/send-reminders'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await sendReminders()

  console.log(`[cron:send-reminders] Sent ${result.sent}, skipped ${result.skipped}, errors ${result.errors} at ${new Date().toISOString()}`)
  logger.info('booking.reminder_sent', `Cron send-reminders completed: sent=${result.sent} skipped=${result.skipped} errors=${result.errors}`)

  return NextResponse.json(result)
}
