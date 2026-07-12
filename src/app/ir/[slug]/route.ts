import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getBookingFunnelUrl } from '@/lib/business/urls'

/** Redirector confiable app-host → funnel del tenant. El destino sale de la DB
 *  (slug/subdomain del negocio), nunca del parámetro: no es open redirect.
 *  `/ir/<slug>` es root-relative → sanitizeNext lo acepta como `next` post-OAuth.
 *  `?continuar=1` le dice al wizard que restaure su estado guardado. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const business = await prisma.business.findUnique({
    where: { slug },
    select: { slug: true, subdomain: true },
  })
  if (!business) {
    return new NextResponse('Negocio no encontrado', { status: 404 })
  }
  return NextResponse.redirect(getBookingFunnelUrl(business, 'continuar=1'), 302)
}
