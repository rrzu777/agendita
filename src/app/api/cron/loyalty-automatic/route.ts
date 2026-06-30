import { NextRequest, NextResponse } from 'next/server'
import { runAutomaticLoyalty } from '@/lib/cron/loyalty-automatic'
import { logger } from '@/lib/logger'

/**
 * Cron de condiciones automáticas de fidelización (cumpleaños/aniversario/win-back).
 * Lo dispara GitHub Actions (POST) cada hora; idempotente por dedupeKey de ocasión.
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 */
async function handler(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET

  // No configured secret => nobody can authenticate. Return 401 (not 500) so we
  // don't leak whether the secret is configured to anonymous callers.
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runAutomaticLoyalty()

  logger.info('loyalty.automatic_cron', `Cron loyalty-automatic: businesses=${result.businesses} emitted=${result.emitted} errors=${result.errors}`)

  return NextResponse.json(result)
}

export const GET = handler
export const POST = handler
