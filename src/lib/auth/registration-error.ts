export class RegistrationError extends Error {
  constructor(
    message: string,
    public readonly code: 'EMAIL_TAKEN' | 'SUBDOMAIN_TAKEN' | 'VALIDATION' | 'AUTH_ERROR' | 'INTERNAL'
  ) {
    super(message)
    this.name = 'RegistrationError'
  }
}
