import { BusinessProfile } from '@/components/public/business-profile'
import { getPublicBusinessBySubdomain } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { getAccountCta, getFunnelSession } from '@/lib/customers/session-prefill'
import { CalendarCheck, Wallet, Bell } from 'lucide-react'

const features = [
  { icon: CalendarCheck, title: 'Reservas 24/7', text: 'Tus clientes eligen hora desde su teléfono, sin esperar tu respuesta.' },
  { icon: Wallet, title: 'Abonos al instante', text: 'Cobra una seña al reservar y reduce las inasistencias.' },
  { icon: Bell, title: 'Confirmación automática', text: 'Cada reserva queda confirmada y registrada, sin perseguir mensajes.' },
]

function LandingPage() {
  return (
    <div className="studio-shell relative overflow-hidden">
      {/* Soft warm atmosphere */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-secondary/50 blur-3xl" />
        <div className="absolute -bottom-40 -left-24 size-96 rounded-full bg-accent/40 blur-3xl" />
      </div>

      <main className="container mx-auto px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="studio-eyebrow mb-4">Agenda boutique para belleza y barbería</p>
          <h1 className="mb-6 font-heading text-5xl font-semibold tracking-tight text-primary md:text-7xl">
            Reservas online para tu estudio
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-xl leading-relaxed text-muted-foreground">
            Deja que tus clientes reserven hora, paguen el abono y reciban confirmación —
            sin perseguir mensajes por WhatsApp.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <a href="/register" className="inline-block rounded-full bg-primary px-8 py-3.5 font-semibold text-primary-foreground shadow-[0_14px_32px_rgba(51,41,32,0.18)] transition hover:bg-primary/90">
              Crear cuenta gratis
            </a>
            <a href="/login" className="inline-block rounded-full border border-border bg-card px-8 py-3.5 font-semibold text-primary transition hover:bg-muted">
              Iniciar sesión
            </a>
          </div>
        </div>

        <div className="mx-auto mt-20 grid max-w-4xl gap-4 sm:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon
            return (
              <div key={feature.title} className="rounded-[1.75rem] border border-border/50 bg-card/70 p-6 text-left shadow-[var(--cream-shadow)] backdrop-blur">
                <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary text-primary">
                  <Icon className="size-6" />
                </div>
                <h2 className="mb-1.5 font-heading text-lg font-semibold tracking-tight text-primary">{feature.title}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{feature.text}</p>
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}

export default async function HomePage() {
  const tenant = await getTenantFromRequest()

  if (tenant) {
    const business = await getPublicBusinessBySubdomain(tenant.subdomain)

    if (business) {
      const session = await getFunnelSession(business.id)
      return <BusinessProfile business={business} bookingHref="/book" accountCta={getAccountCta(session, business.slug)} />
    }
  }

  return <LandingPage />
}
