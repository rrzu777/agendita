import Link from 'next/link'

/** CTA de cuenta post-reserva, compartido entre la confirmación del wizard y
 *  /book/confirmation. Sin sesión solo aparece si la reserva tiene email (la
 *  vinculación automática depende del match con el email verificado); con
 *  sesión lleva a /mi (home, nunca 404ea aunque no haya vinculado). */
export function AccountCta({ sessionActive, customerEmail, className }: {
  sessionActive: boolean
  customerEmail: string | null
  className?: string
}) {
  if (!sessionActive && customerEmail) {
    return (
      <div className={`rounded-2xl border border-primary/25 bg-secondary/40 p-4 text-sm text-primary ${className ?? ''}`}>
        <p className="mb-2">
          ¿Quieres ver y gestionar esta reserva? Crea tu cuenta ingresando con{' '}
          <span className="font-semibold">{customerEmail}</span> (el mismo email de la reserva).
        </p>
        <Link href="/ingresar?next=/mi" className="font-semibold underline">Crear mi cuenta</Link>
      </div>
    )
  }
  if (sessionActive) {
    return (
      <p className={`text-sm ${className ?? ''}`}>
        <Link href="/mi" className="font-semibold text-primary underline">Ver mis reservas</Link>
      </p>
    )
  }
  return null
}
