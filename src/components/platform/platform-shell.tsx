import Link from 'next/link'

export function AuthShell({
  audience,
  children,
}: {
  audience: 'owner' | 'client'
  children: React.ReactNode
}) {
  const owner = audience === 'owner'
  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:py-12">
      <div className="mx-auto grid min-h-[calc(100dvh-4rem)] w-full max-w-5xl items-center gap-8 sm:min-h-[calc(100dvh-6rem)] lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <section className="hidden max-w-xl lg:block" aria-label={owner ? 'Acceso para negocios' : 'Acceso para clientes'}>
          <Link href="/" className="inline-flex min-h-11 items-center font-heading text-xl font-semibold text-primary">Agendita</Link>
          <p className="mt-10 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{owner ? 'Para negocios y equipos' : 'Para clientes'}</p>
          <p className="mt-3 font-heading text-4xl font-semibold leading-tight tracking-tight text-primary">
            {owner ? 'Gestiona tu negocio sin perder de vista el día.' : 'Tus reservas y beneficios, en un solo lugar.'}
          </p>
          <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
            {owner ? 'Agenda, clientes, cobros y crecimiento con una operación clara.' : 'Revisa tus próximas citas, reprograma cuando corresponda y vuelve a reservar.'}
          </p>
        </section>
        <div className="w-full">{children}</div>
      </div>
    </div>
  )
}

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-background">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 sm:px-6">
          <Link href="/" className="flex min-h-11 items-center font-heading text-lg font-semibold text-primary">Agendita</Link>
          <nav aria-label="Navegación principal" className="flex items-center gap-1 text-sm">
            <Link href="/login" className="flex min-h-11 items-center rounded-lg px-3 font-semibold text-muted-foreground hover:bg-secondary hover:text-primary">Para negocios</Link>
            <Link href="/ingresar" className="flex min-h-11 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground">Soy cliente</Link>
          </nav>
        </div>
      </header>
      {children}
    </div>
  )
}

export function LegalShell({ children, currentPage }: { children: React.ReactNode; currentPage: 'privacy' | 'terms' | 'refunds' }) {
  const links = [
    { href: '/privacy', key: 'privacy', label: 'Privacidad' },
    { href: '/terms', key: 'terms', label: 'Términos' },
    { href: '/refund-policy', key: 'refunds', label: 'Reembolsos' },
  ] as const
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-card">
        <div className="mx-auto flex min-h-16 w-full max-w-4xl flex-wrap items-center justify-between gap-2 px-4 sm:px-6">
          <Link href="/" className="flex min-h-11 items-center font-heading text-lg font-semibold text-primary">Agendita</Link>
          <nav aria-label="Documentos legales" className="flex flex-wrap items-center gap-1 text-sm">
            {links.map((item) => {
              const active = currentPage === item.key
              return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={`flex min-h-11 items-center rounded-lg px-3 font-medium ${active ? 'bg-secondary text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-primary'}`}>{item.label}</Link>
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">{children}</main>
    </div>
  )
}
