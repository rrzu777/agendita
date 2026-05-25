const BLOCKED_SUBDOMAINS = [
  'www', 'app', 'admin', 'api', 'login', 'register', 'dashboard',
  'support', 'billing', 'payments', 'terms', 'privacy', 'book',
  'webhooks', 'mail', 'email', 'help', 'docs', 'blog', 'shop',
  'store', 'cdn', 'static', 'assets', 'images', 'img', 'css',
  'js', 'status', 'health', 'monitor', 'agendita',
]

const SUBDOMAIN_MIN_LENGTH = 3
const SUBDOMAIN_MAX_LENGTH = 30

const VALID_SUBDOMAIN_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/

export interface SubdomainValidationResult {
  valid: boolean
  error?: string
  sanitized?: string
}

export function validateSubdomain(raw: string): SubdomainValidationResult {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, error: 'El subdominio es requerido' }
  }

  const normalized = raw.toLowerCase().trim()

  if (normalized.length < SUBDOMAIN_MIN_LENGTH) {
    return { valid: false, error: `El subdominio debe tener al menos ${SUBDOMAIN_MIN_LENGTH} caracteres` }
  }

  if (normalized.length > SUBDOMAIN_MAX_LENGTH) {
    return { valid: false, error: `El subdominio debe tener máximo ${SUBDOMAIN_MAX_LENGTH} caracteres` }
  }

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(normalized)) {
    return {
      valid: false,
      error: 'El subdominio solo puede contener letras, números y guiones. No puede empezar ni terminar con guión.',
    }
  }

  if (BLOCKED_SUBDOMAINS.includes(normalized)) {
    return { valid: false, error: 'Este subdominio no está disponible. Elige otro nombre.' }
  }

  return { valid: true, sanitized: normalized }
}

export function generateDefaultSubdomain(email: string): string {
  const prefix = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')
  let subdomain = prefix.replace(/^-+|-+$/g, '')

  if (subdomain.length < SUBDOMAIN_MIN_LENGTH) {
    subdomain = subdomain + '-' + Math.random().toString(36).substring(2, 6)
  }

  if (subdomain.length > SUBDOMAIN_MAX_LENGTH) {
    subdomain = subdomain.substring(0, SUBDOMAIN_MAX_LENGTH).replace(/-$/, '')
  }

  if (BLOCKED_SUBDOMAINS.includes(subdomain) || !VALID_SUBDOMAIN_REGEX.test(subdomain)) {
    subdomain = subdomain + '-' + Math.random().toString(36).substring(2, 6)
  }

  return subdomain
}
