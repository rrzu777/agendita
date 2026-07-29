import { NextRequest, NextResponse } from 'next/server'
import { runAutomaticLoyalty } from '@/lib/cron/loyalty-automatic'
import { logger } from '@/lib/logger'
import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'

/**
 * Cron de condiciones automáticas de fidelización (cumpleaños/aniversario/win-back).
 * Lo dispara GitHub Actions (POST) cada hora; idempotente por dedupeKey de ocasión.
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 */
async function handler(request: NextRequest) {
  if (!hasValidBearerSecret(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runAutomaticLoyalty()

  logger.info('loyalty.automatic_cron', `Cron loyalty-automatic: businesses=${result.businesses} emitted=${result.emitted} errors=${result.errors}`)

  return NextResponse.json(result)
}

export const GET = handler
export const POST = handler
