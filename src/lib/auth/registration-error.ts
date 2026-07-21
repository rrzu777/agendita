import { UserError } from '@/lib/actions/result'

/** Errores de registro con mensaje EN ESPAÑOL pensado para la persona que se
 *  registra. Extiende `UserError` para que el wrapper `action()` los devuelva
 *  verbatim en vez de reemplazarlos por el genérico (mismo criterio que
 *  AuthError/ForbiddenError). Nuevos mensajes acá deben mantener eso: español,
 *  user-facing, sin filtrar detalle interno. */
export class RegistrationError extends UserError {
  constructor(
    message: string,
    public readonly code: 'EMAIL_TAKEN' | 'SUBDOMAIN_TAKEN' | 'VALIDATION' | 'AUTH_ERROR' | 'INTERNAL'
  ) {
    super(message)
    this.name = 'RegistrationError'
  }
}
