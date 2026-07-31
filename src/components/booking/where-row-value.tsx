import type { WhereRow } from '@/lib/services/modality'

/**
 * El valor de una fila de "dónde", clickeable o no.
 *
 * Las dos pantallas de confirmación arman la fila con su propio cromo —la del
 * wizard es una lista plana, la de volver del pago tiene ícono y tile— pero el
 * valor se ve igual en las dos, y con qué `rel` sale un link externo no es algo
 * que cada pantalla deba decidir por su cuenta.
 */
export function WhereRowValue({ row }: { row: WhereRow }) {
  if (!row.href) {
    return <span className="text-right font-semibold text-primary">{row.value}</span>
  }
  return (
    <a
      href={row.href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words text-right font-semibold text-primary underline"
    >
      {row.value}
    </a>
  )
}

/**
 * "¿Necesitas cambiar algo? Escríbele por WhatsApp". Va en las dos pantallas de
 * confirmación; `className` es lo único que cambia entre ellas (el margen).
 */
export function WhatsappHelpLine({ href, businessName, className }: { href: string; businessName: string; className?: string }) {
  return (
    <p className={`text-sm text-muted-foreground ${className ?? ''}`}>
      ¿Necesitas cambiar algo?{' '}
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">
        Escríbele a {businessName} por WhatsApp
      </a>
    </p>
  )
}
