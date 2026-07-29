import { NextRequest, NextResponse } from 'next/server'
import { sendTransferReminders } from '@/lib/cron/transfer-reminders'
import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'

/**
 * Endpoint de cron para los recordatorios intermedios de transferencia:
 *  (1) empuja a la clienta que no declaró antes de que venza el hold;
 *  (2) empuja a la dueña a verificar una transferencia declarada que envejece.
 * Lo dispara el workflow horario de GitHub Actions (POST) con
 * Authorization: Bearer ${CRON_SECRET}; también acepta GET.
 */
async function handler(request: NextRequest) {
  if (!hasValidBearerSecret(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await sendTransferReminders()

  console.log(`[cron:transfer-reminders] ${JSON.stringify(result)} at ${new Date().toISOString()}`)

  return NextResponse.json(result)
}

export const GET = handler
export const POST = handler
