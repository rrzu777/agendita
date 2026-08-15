import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BellRing, CalendarCheck2, Smartphone } from 'lucide-react'
import { InstallAppPanel } from '@/components/pwa/install-app-panel'
import { getAppUrl } from '@/lib/business/urls'

export const metadata: Metadata = {
  title: 'Instalar Agendita',
  description: 'Instala Agendita para tener tus citas y recordatorios a mano.',
}

export default async function InstallPage() {
  const requestHeaders = await headers()
  const requestHost = (
    requestHeaders.get('x-forwarded-host')?.split(',')[0]?.trim()
    || requestHeaders.get('host')
  )?.toLowerCase()
  const canonicalUrl = getAppUrl('/instalar')
  const canonicalHost = new URL(canonicalUrl).host.toLowerCase()

  if (requestHost !== canonicalHost) redirect(canonicalUrl)

  return (
    <main className="studio-shell relative flex min-h-screen items-center overflow-hidden px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -right-32 -top-28 size-80 rounded-full bg-secondary/70 blur-3xl" />
        <div className="absolute -bottom-36 -left-20 size-72 rounded-full bg-accent/45 blur-3xl" />
      </div>

      <section className="studio-card mx-auto w-full max-w-md p-6 sm:p-8">
        <div className="mx-auto flex size-16 items-center justify-center rounded-[1.4rem] bg-primary text-primary-foreground shadow-[0_14px_30px_rgba(51,41,32,0.18)]">
          <Smartphone className="size-8" aria-hidden="true" />
        </div>

        <div className="mt-6 text-center">
          <p className="studio-eyebrow">Agendita en tu teléfono</p>
          <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-primary">
            Instala Agendita
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Tus próximas citas, a un toque y sin buscar enlaces en tus mensajes.
          </p>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-secondary/60 p-4">
            <CalendarCheck2 className="size-5 text-primary" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-primary">Tus reservas</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Ábrelas desde tu pantalla de inicio.</p>
          </div>
          <div className="rounded-2xl bg-secondary/60 p-4">
            <BellRing className="size-5 text-primary" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-primary">Recordatorios</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Recibe avisos importantes de tus citas.</p>
          </div>
        </div>

        <InstallAppPanel />

        <p className="mt-5 text-center text-sm">
          <Link href="/" className="font-semibold text-muted-foreground underline decoration-border underline-offset-4 hover:text-primary">
            Volver a Agendita
          </Link>
        </p>
      </section>
    </main>
  )
}
