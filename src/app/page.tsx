import Link from 'next/link'
import { BusinessProfile } from '@/components/public/business-profile'
import { PublicAnalytics } from '@/components/analytics/public-analytics'
import { isPublicAnalyticsEligible } from '@/lib/analytics/public-context'
import { getConfiguredAnalyticsConsentVersion } from '@/lib/analytics/budget'
import { getPublicBusinessBySubdomain } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { getAccountCta, getFunnelSession } from '@/lib/customers/session-prefill'
import { prisma } from '@/lib/db'
import { appendPublicAcquisitionSearch } from '@/lib/business/urls'
import { CalendarCheck, Wallet, Bell } from 'lucide-react'
import { MarketingShell } from '@/components/platform/platform-shell'
import type { Metadata } from 'next'

const features = [
  { icon: CalendarCheck, title: 'Reserva online', text: 'Tus clientes eligen servicios y horarios disponibles desde su teléfono.' },
  { icon: Wallet, title: 'Cobros configurables', text: 'Ofrece los métodos de pago y condiciones de abono que realmente usa tu negocio.' },
  { icon: Bell, title: 'Seguimiento claro', text: 'Consulta el estado de cada reserva y configura los recordatorios disponibles.' },
]

function LandingPage() {
  return (
    <MarketingShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid items-end gap-10 border-b border-border pb-14 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
          <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Agenda para negocios de servicios</p>
          <h1 className="mb-6 font-heading text-5xl font-semibold tracking-tight text-primary md:text-7xl">
            Tu agenda, clara para ti y simple para tus clientes.
          </h1>
          <p className="mb-10 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            Organiza servicios, profesionales, horarios, cobros y reservas desde un mismo lugar. La experiencia pública conserva la identidad de cada negocio.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/register" className="flex min-h-12 items-center justify-center rounded-xl bg-primary px-8 font-semibold text-primary-foreground transition hover:bg-primary/90">
              Crear cuenta
            </Link>
            <Link href="/login" className="flex min-h-12 items-center justify-center rounded-xl border border-border bg-card px-8 font-semibold text-primary transition hover:bg-muted">
              Iniciar sesión
            </Link>
          </div>
          </div>
          <p className="max-w-sm border-l-2 border-primary pl-5 text-sm leading-relaxed text-muted-foreground">Belleza, barbería, terapia y otros servicios comparten la misma operación. El estilo visual lo decide cada negocio.</p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon
            return (
              <div key={feature.title} className="bg-card p-6 text-left sm:p-7">
                <div className="mb-5 flex size-12 items-center justify-center rounded-xl bg-secondary text-primary">
                  <Icon className="size-6" />
                </div>
                <h2 className="mb-1.5 font-heading text-lg font-semibold tracking-tight text-primary">{feature.title}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{feature.text}</p>
              </div>
            )
          })}
        </div>
      </main>
    </MarketingShell>
  )
}

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantFromRequest()
  if (!tenant) return {}
  const business = await getPublicBusinessBySubdomain(tenant.subdomain)
  if (!business) return {}
  return {
    title: business.name,
    description: `Reserva servicios y revisa la información de ${business.name}.`,
  }
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await getTenantFromRequest()

  if (tenant) {
    const business = await getPublicBusinessBySubdomain(tenant.subdomain)

    if (business) {
      const search = await searchParams
      const session = await getFunnelSession(business.id)
      const hasPackages = (await prisma.packageProduct.count({ where: { businessId: business.id, isActive: true } })) > 0
      return (
        <PublicAnalytics businessId={business.id} slug={business.slug} timezone={business.timezone || 'America/Santiago'} consentVersion={getConfiguredAnalyticsConsentVersion() ?? 1} eligible={await isPublicAnalyticsEligible(business.id)} surface="profile">
        <BusinessProfile
          business={business}
          bookingHref={appendPublicAcquisitionSearch('/book', search)}
          accountCta={getAccountCta(session, business.slug, search)}
          packagesHref={hasPackages ? '/paquetes' : undefined}
        />
        </PublicAnalytics>
      )
    }
  }

  return <LandingPage />
}
