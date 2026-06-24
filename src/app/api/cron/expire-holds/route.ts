import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { revalidateBusinessPublicPaths } from '@/server/actions/revalidate-business'
import { expireStaleHolds } from '@/lib/cron/expire-holds'

/**
 * Endpoint de cron para expirar reservas pending_payment sin pago.
 * Debe ser llamado periódicamente (ej. cada 5 minutos) por un scheduler externo
 * como Vercel Cron, AWS EventBridge, o similar.
 *
 * Requiere header Authorization: Bearer ${CRON_SECRET}
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET

  // No configured secret => nobody can authenticate. Return 401 (not 500) so we
  // don't leak whether the secret is configured to anonymous callers.
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await expireStaleHolds()

  for (const businessId of result.businessIds) {
    revalidatePath('/dashboard/bookings')
    await revalidateBusinessPublicPaths(businessId)
  }

  console.log(`[cron:expire-holds] Expired ${result.expired} bookings at ${new Date().toISOString()}`)

  return NextResponse.json({ expired: result.expired })
}
