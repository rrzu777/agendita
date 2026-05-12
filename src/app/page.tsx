import { headers } from 'next/headers'
import { BusinessProfile } from '@/components/public/business-profile'

function LandingPage() {
  return (
    <div className="studio-shell">
      <main className="container mx-auto px-4 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="studio-eyebrow mb-4">Agenda boutique para estudios de belleza</p>
          <h1 className="mb-6 text-5xl font-semibold tracking-normal text-primary md:text-7xl">
            Agenda online para manicuristas
          </h1>
          <p className="mb-10 text-xl leading-relaxed text-muted-foreground">
            Permite que tus clientas reserven hora, paguen abono y reciban confirmación 
            sin escribirte mil veces por WhatsApp.
          </p>
          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <a href="/register" className="inline-block rounded-lg bg-primary px-8 py-3 font-semibold text-primary-foreground shadow-[0_14px_32px_rgba(51,41,32,0.18)] transition hover:bg-primary/90">
              Crear cuenta
            </a>
            <a href="/login" className="inline-block rounded-lg border border-border bg-card px-8 py-3 font-semibold text-primary transition hover:bg-muted">
              Iniciar sesión
            </a>
          </div>
        </div>
      </main>
    </div>
  )
}

export default async function HomePage() {
  const subdomain = (await headers()).get('x-business-subdomain')
  
  if (subdomain) {
    return <BusinessProfile />
  }
  
  return <LandingPage />
}
