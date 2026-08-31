import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getBookingFunnelUrl, publicAcquisitionSearch } from '@/lib/business/urls'

/** Redirector confiable app-host → funnel del tenant. El destino sale de la DB
 *  (slug/subdomain del negocio), nunca del parámetro: no es open redirect.
 *  `/ir/<slug>` es root-relative → sanitizeNext lo acepta como `next` post-OAuth.
 *  `?continuar=1` le dice al wizard que restaure su estado guardado. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const business = await prisma.business.findUnique({
    where: { slug },
    select: { slug: true, subdomain: true },
  })
  if (!business) {
    return new NextResponse('Negocio no encontrado', { status: 404 })
  }
  const search = new URLSearchParams(publicAcquisitionSearch(new URL(request.url).searchParams))
  search.set('continuar', '1')
  return NextResponse.redirect(getBookingFunnelUrl(business, search.toString()), 302)
}
