'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import { MarketingShell } from '@/components/platform/platform-shell'

type RootErrorContext = { kind: 'client' | 'tenant' | 'platform'; label: string; homeHref: string }

export function getRootErrorContext(pathname: string, hostname: string): RootErrorContext {
  if (pathname.startsWith('/mi')) return { kind: 'client', label: 'Mi cuenta', homeHref: '/mi' }
  const clientTenantRoute = ['/book', '/b/', '/paquetes', '/tarjeta', '/review'].some((prefix) => pathname.startsWith(prefix))
  const appDomain = (process.env.NEXT_PUBLIC_APP_DOMAIN || 'agendita.cl').replace(/^https?:\/\//, '').split(':')[0]
  const cleanHost = hostname.toLowerCase().split(':')[0]
  const tenantHost = cleanHost.endsWith('.localhost') || (cleanHost.endsWith(`.${appDomain}`) && cleanHost !== `www.${appDomain}`)
  if (clientTenantRoute || tenantHost) return { kind: 'tenant', label: 'Tu reserva', homeHref: '/' }
  return { kind: 'platform', label: 'Agendita', homeHref: '/' }
}

const subscribeToLocation = (onChange: () => void) => {
  window.addEventListener('popstate', onChange)
  return () => window.removeEventListener('popstate', onChange)
}

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const pathname = usePathname()
  const hostname = useSyncExternalStore(subscribeToLocation, () => window.location.hostname, () => '')
  const context = getRootErrorContext(pathname, hostname)
  const content = <main className="flex min-h-[calc(100dvh-4rem)] flex-col items-center justify-center px-4 py-20">
      <AlertTriangle className="mb-4 size-12 text-destructive" />
      <h1 className="mb-2 text-2xl font-semibold text-primary">Algo salió mal</h1>
      <p className="mb-6 max-w-sm text-center text-muted-foreground">
        Ocurrió un error inesperado. Por favor intenta nuevamente.
      </p>
      {process.env.NODE_ENV === 'development' && error?.digest && (
        <code className="mb-4 max-w-full truncate rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
          {error.digest}
        </code>
      )}
      <Button onClick={retry} size="touch" className="rounded-lg font-semibold">
        Reintentar
      </Button>
      {context.kind !== 'platform' && <Link href={context.homeHref} className="mt-3 inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">Volver a {context.label.toLowerCase()}</Link>}
    </main>

  if (context.kind === 'platform') return <MarketingShell>{content}</MarketingShell>
  return <div data-root-error-context={context.kind} className="min-h-screen bg-background text-foreground"><header className="border-b border-border/70 bg-card"><div className="mx-auto flex min-h-16 max-w-3xl items-center px-4 font-heading text-lg font-semibold text-primary">{context.label}</div></header>{content}</div>
}
