export function isCanonicalBrowserOrigin(canonicalOrigin: string): boolean {
  try {
    return window.location.origin === new URL(canonicalOrigin).origin
  } catch {
    return false
  }
}

export function canonicalNotificationDestination(
  canonicalOrigin: string,
  grant: string | null,
): string {
  const origin = new URL(canonicalOrigin).origin
  const fragment = grant ? `#grant=${encodeURIComponent(grant)}` : ''
  return `${origin}/notificaciones${fragment}`
}

export function replaceBrowserLocation(destination: string): void {
  window.location.replace(destination)
}
