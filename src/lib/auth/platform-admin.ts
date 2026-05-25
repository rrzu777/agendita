const PLATFORM_ADMIN_EMAILS = (process.env.PLATFORM_ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export function getPlatformAdminEmails(): string[] {
  if (PLATFORM_ADMIN_EMAILS.length === 0) {
    return []
  }
  return PLATFORM_ADMIN_EMAILS
}

export function isPlatformAdmin(email: string | undefined): boolean {
  if (!email) return false
  if (PLATFORM_ADMIN_EMAILS.length === 0) return false
  return PLATFORM_ADMIN_EMAILS.includes(email.toLowerCase())
}

export function requirePlatformAdmin(email: string | undefined): void {
  if (!isPlatformAdmin(email)) {
    throw new Error('No tienes permisos para acceder a esta sección')
  }
}
