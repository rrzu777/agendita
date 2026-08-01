import { CalendarPlus } from 'lucide-react'
import { getBookingCalendarPath } from '@/lib/business/urls'

/**
 * "Agregar al calendario", en las dos pantallas de confirmación.
 *
 * Son dos caminos porque los dispositivos se comportan distinto: en el teléfono
 * el `.ics` lo abre el calendario del sistema con la cita cargada, y en el
 * escritorio se baja como un archivo suelto que hay que importar a mano — ahí
 * sirve el link de Google.
 *
 * `<a>` y no `<Link>` a propósito: ninguno de los dos es una navegación interna.
 * Uno baja un archivo y el otro redirige afuera; con `<Link>`, Next intentaría
 * prefetch y navegación de cliente sobre respuestas que no son páginas.
 */
export function AddToCalendar({ bookingId, className }: { bookingId: string; className?: string }) {
  const path = getBookingCalendarPath(bookingId)

  return (
    <div className={`text-center ${className ?? ''}`}>
      <a
        href={path}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border bg-background px-6 text-base font-semibold text-primary transition-colors hover:bg-muted"
      >
        <CalendarPlus className="size-5" />
        Agregar al calendario
      </a>
      <p className="mt-2 text-sm text-muted-foreground">
        ¿Usas Google Calendar?{' '}
        <a
          href={`${path}?app=google`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-primary underline"
        >
          Agrégalo acá
        </a>
      </p>
    </div>
  )
}
