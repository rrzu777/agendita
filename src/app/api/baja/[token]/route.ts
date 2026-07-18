import { NextResponse } from 'next/server'
import { setMarketingOptOutByToken } from '@/server/actions/marketing-optout'
import { ForbiddenError } from '@/lib/auth/server'
import { logger } from '@/lib/logger'

// One-click List-Unsubscribe (RFC 8058). El cliente de correo hace POST sin abrir
// la página. setMarketingOptOutByToken ya aplica rate limit ('optout-public') y
// resuelve el token; token inválido → 404.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    await setMarketingOptOutByToken(token, true)
    return new NextResponse(null, { status: 200 })
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return new NextResponse(null, { status: 404 })
    }
    logger.error('marketing.unsubscribe_oneclick_failed', `baja one-click falló: ${String(e)}`)
    return new NextResponse(null, { status: 500 })
  }
}
