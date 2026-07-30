import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { revalidateBusinessPublicPaths } from '@/server/actions/revalidate-business'
import { expireStaleHolds } from '@/lib/cron/expire-holds'
import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'

/**
 * Endpoint de cron para expirar reservas pending_payment sin pago.
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

  const result = await expireStaleHolds()

  for (const businessId of result.businessIds) {
    revalidatePath('/dashboard/bookings')
    await revalidateBusinessPublicPaths(businessId)
  }

  console.log(`[cron:expire-holds] Expired ${result.expired} bookings at ${new Date().toISOString()}`)

  return NextResponse.json({ expired: result.expired })
}

export const GET = handler
export const POST = handler
