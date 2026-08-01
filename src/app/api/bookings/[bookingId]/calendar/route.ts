import { NextResponse, type NextRequest } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadBookingInvite } from '@/lib/calendar/booking-invite'
import { buildGoogleCalendarUrl } from '@/lib/calendar/ics'

/**
 * El evento de calendario de una reserva.
 *
 * - `GET .../calendar` baja el `.ics`: en el teléfono lo abre el calendario del
 *   sistema con la cita ya cargada.
 * - `GET .../calendar?app=google` redirige a Google Calendar, que es el camino
 *   del escritorio (ahí un `.ics` se baja como archivo suelto).
 *
 * Público, como `/book/confirmation`: la llave es el id de la reserva, que sólo
 * tiene quien reservó (o quien recibió el mail). No expone nada que esa pantalla
 * no muestre ya.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params

  // La ruta es pública y el id es adivinable sólo a fuerza de intentos; el
  // límite corta el barrido antes de que llegue a la base.
  const limit = await checkRateLimit('booking-calendar', 60, 60_000)
  if (!limit.success) {
    return new NextResponse('Demasiados pedidos', { status: 429 })
  }

  const invite = await loadBookingInvite(bookingId)
  // Reserva inexistente y reserva sin confirmar contestan lo mismo a propósito:
  // así la ruta no sirve para averiguar si un id existe.
  if (!invite) {
    return new NextResponse('No encontramos esa reserva', { status: 404 })
  }

  if (request.nextUrl.searchParams.get('app') === 'google') {
    return NextResponse.redirect(buildGoogleCalendarUrl(invite.event), 307)
  }

  return new NextResponse(invite.ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${invite.filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
