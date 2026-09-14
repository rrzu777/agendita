import Link from 'next/link'
import { prisma } from '@/lib/db'
import { prepareMiUser } from '@/lib/auth/mi-user'
import { getLoyaltyBalance } from '@/lib/loyalty/balance'
import { displayBalance } from '@/lib/loyalty/view'
import { PageMessage } from '@/components/ui/page-message'
import { businessThemeCssVariables } from '@/lib/theme/business-theme'
import type { CSSProperties } from 'react'
import { ClientAccountShell } from '@/components/client/client-shell'
import { signOut } from '@/lib/auth/actions'

async function salirAction() {
  'use server'
  await signOut()
}

export default async function MiHomePage() {
  // await la preparación (fila User + auto-link) ANTES de leer: el layout corre
  // en paralelo y no garantiza el link previo. Cacheada → no duplica trabajo.
  const result = await prepareMiUser()
  if (result.status !== 'ok') return null // layout maneja anon (redirect) / conflict
  const user = result.user

  const customers = await prisma.customer.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      business: {
        select: { id: true, name: true, slug: true, logoUrl: true, category: true, brandColor: true, visualStyle: true, loyaltyConfig: { select: { isActive: true, pointsLabel: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (customers.length === 0) {
    return (
      <ClientAccountShell accountAction={<form action={salirAction}><button type="submit" className="rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-primary">Salir</button></form>}>
        <PageMessage
          title="Todavía no hay nada por aquí"
          message="Abre el enlace de tu tarjeta de beneficios, o haz una reserva con este email, y tus negocios aparecerán acá."
        />
      </ClientAccountShell>
    )
  }

  // Lecturas simples (agregados), sin tx interactiva → paralelo seguro.
  const balances = await Promise.all(
    customers.map((c) => getLoyaltyBalance(prisma, c.id, c.business.id)),
  )

  return (
    <ClientAccountShell accountAction={<form action={salirAction}><button type="submit" className="rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-primary">Salir</button></form>}>
    <main>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tu espacio</p>
      <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-primary">Mis negocios</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Elige un negocio para revisar tus reservas, beneficios y preferencias.</p>
      <ul className="mt-7 grid gap-4 sm:grid-cols-2">
        {customers.map((c, i) => (
          <li key={c.id} style={businessThemeCssVariables(c.business) as CSSProperties}>
            <Link href={`/mi/${c.business.slug}`} className="group block min-h-36 rounded-[var(--radius)] border border-border bg-card p-5 shadow-sm transition hover:border-[var(--tenant-brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tenant-brand-strong)]">
              <div className="flex items-center gap-3">
                {c.business.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.business.logoUrl} alt="" className="size-11 rounded-full object-cover" />
                ) : (
                  <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-[var(--tenant-brand-soft)] font-semibold text-[var(--tenant-brand-strong)]">{c.business.name.slice(0, 1).toUpperCase()}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-heading text-lg font-semibold text-primary">{c.business.name}</div>
                  <div className="mt-0.5 text-sm font-semibold text-[var(--tenant-brand-strong)]">Abrir cuenta</div>
                </div>
              </div>
              {c.business.loyaltyConfig?.isActive && (
                <div className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
                  {displayBalance(balances[i])} {c.business.loyaltyConfig.pointsLabel}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </main>
    </ClientAccountShell>
  )
}
