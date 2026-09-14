'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import type { BusinessCategory, BusinessVisualStyle } from '@prisma/client'
import { ArrowLeft, CalendarPlus, ChevronDown } from 'lucide-react'
import { BusinessTheme } from '@/components/theme/business-theme'

type ClientBusinessIdentity = {
  name: string
  logoUrl: string | null
  brandColor: string | null
  visualStyle: BusinessVisualStyle
  category: BusinessCategory
}

type CancellationNotice = { serviceName: string; startsAtLabel: string }
const ClientBookingNoticeContext = createContext<((notice: CancellationNotice) => void) | null>(null)

export function useClientBookingNotice() {
  return useContext(ClientBookingNoticeContext)
}

export function ClientAccountShell({
  children,
  accountAction,
}: {
  children: React.ReactNode
  accountAction: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-card">
        <div className="mx-auto flex min-h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/mi" className="flex min-h-11 items-center font-heading text-lg font-semibold text-primary">
            Mi cuenta
          </Link>
          <div className="[&_button]:min-h-11 [&_button]:px-3">{accountAction}</div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-8 sm:px-6 sm:pt-10">{children}</div>
    </div>
  )
}

const clientSections = [
  { id: 'proximas', href: '#proximas', label: 'Próximas' },
  { id: 'historial', href: '#historial', label: 'Historial' },
  { id: 'beneficios', href: '#beneficios', label: 'Beneficios' },
  { id: 'preferencias', href: '#preferencias', label: 'Preferencias' },
] as const

const subscribeToHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function ClientSectionNav({ businessName, sectionBaseHref }: { businessName: string; sectionBaseHref?: string }) {
  const activeHash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash.slice(1) || 'proximas',
    () => 'proximas',
  )

  return (
    <nav aria-label={`Secciones de ${businessName}`} className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
      {clientSections.map((item) => {
        const active = !sectionBaseHref && item.id === activeHash
        return (
          <a key={item.href} href={`${sectionBaseHref ?? ''}${item.href}`} aria-current={active ? 'location' : undefined} className={`flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-semibold hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'bg-secondary text-primary' : 'text-muted-foreground'}`}>
            {item.label}
          </a>
        )
      })}
    </nav>
  )
}

export function ClientBusinessShell({
  business,
  bookingHref,
  sectionBaseHref,
  children,
}: {
  business: ClientBusinessIdentity
  bookingHref: string
  /** Ruta de la cuenta cuando este shell envuelve una vista contextual. */
  sectionBaseHref?: string
  children: React.ReactNode
}) {
  const [cancellationNotice, setCancellationNotice] = useState<CancellationNotice | null>(null)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const announceCancellation = useCallback((notice: CancellationNotice) => setCancellationNotice(notice), [])
  useEffect(() => {
    if (cancellationNotice) noticeRef.current?.focus()
  }, [cancellationNotice])

  return (
    <BusinessTheme business={business}>
      <ClientBookingNoticeContext.Provider value={announceCancellation}>
      <div className="relative min-h-[calc(100vh-4rem)] bg-background pb-24 text-foreground">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background">
          <div className="mx-auto flex min-h-16 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
            <Link
              href="/mi"
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Volver a mis negocios"
            >
              <ArrowLeft className="size-5" aria-hidden="true" />
            </Link>
            {business.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={business.logoUrl} alt="" className="size-9 rounded-full object-cover" />
            ) : (
              <span className="flex size-9 items-center justify-center rounded-full bg-secondary font-semibold text-primary" aria-hidden="true">
                {business.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Mi cuenta en</p>
              <p className="truncate font-heading text-base font-semibold text-primary">{business.name}</p>
            </div>
            <Link href="/mi" className="hidden min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-primary hover:bg-secondary sm:flex">
              Cambiar negocio <ChevronDown className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <ClientSectionNav businessName={business.name} sectionBaseHref={sectionBaseHref} />
        </header>
        <div className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6 sm:py-10">
          {cancellationNotice && <p ref={noticeRef} role="status" tabIndex={-1} className="mb-5 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">Reserva cancelada: {cancellationNotice.serviceName} del {cancellationNotice.startsAtLabel}.</p>}
          {children}
        </div>
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-auto sm:border-0 sm:bg-transparent sm:p-0">
          <Link href={bookingHref} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <CalendarPlus className="size-5" aria-hidden="true" />
            Reservar
          </Link>
        </div>
      </div>
      </ClientBookingNoticeContext.Provider>
    </BusinessTheme>
  )
}

export function TenantPublicShell({
  business,
  backHref,
  backLabel,
  children,
  width = 'wide',
}: {
  business: ClientBusinessIdentity
  backHref?: string
  backLabel?: string
  children: React.ReactNode
  width?: 'narrow' | 'wide'
}) {
  return (
    <BusinessTheme business={business}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border/70 bg-card">
          <div className={`mx-auto flex min-h-16 w-full items-center gap-3 px-4 sm:px-6 ${width === 'narrow' ? 'max-w-xl' : 'max-w-3xl'}`}>
            {backHref && (
              <Link href={backHref} className="flex size-11 shrink-0 items-center justify-center rounded-full text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={backLabel ?? 'Volver'}>
                <ArrowLeft className="size-5" aria-hidden="true" />
              </Link>
            )}
            {business.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={business.logoUrl} alt="" className="size-9 rounded-full object-cover" />
            ) : (
              <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-secondary font-semibold text-primary">{business.name.slice(0, 1).toUpperCase()}</span>
            )}
            <p className="min-w-0 truncate font-heading text-base font-semibold text-primary">{business.name}</p>
          </div>
        </header>
        <main className={`mx-auto w-full px-4 py-8 sm:px-6 sm:py-12 ${width === 'narrow' ? 'max-w-xl' : 'max-w-3xl'}`}>
          {children}
        </main>
      </div>
    </BusinessTheme>
  )
}
