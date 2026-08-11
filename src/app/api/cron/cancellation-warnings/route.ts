import { NextRequest, NextResponse } from 'next/server'
import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'
import { sendCancellationWarnings } from '@/lib/cron/send-cancellation-warnings'
import { logger } from '@/lib/logger'

async function handler(request: NextRequest) {
  if (!hasValidBearerSecret(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await sendCancellationWarnings()
  logger.info(
    'booking.cancellation_warning_cron',
    'Cancellation warning cron completed',
    { metadata: { ...result } },
  )
  return NextResponse.json(result)
}

export const GET = handler
export const POST = handler
