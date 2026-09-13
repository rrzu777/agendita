import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { BusinessTheme } from '@/components/theme/business-theme'
import type { PublicBusiness } from '@/lib/business/public'
import { formatDuration } from '@/lib/format-duration'
import { formatMoney } from '@/lib/money'
import { getVocabulary } from '@/lib/vocabulary'
import { CalendarDays, Camera, Clock, Clock3, MapPin, MessageCircle, Package, Star } from 'lucide-react'

interface BusinessProfileProps {
  business: PublicBusiness
  bookingHref?: string
  packagesHref?: string
  accountCta?: { label: 'Ingresar' | 'Mi cuenta'; href: string }
}

const daysOfWeek = ['Domingos', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábados']

export function BusinessProfile({ business, bookingHref = `/book/${business.slug}`, packagesHref, accountCta }: BusinessProfileProps) {
  const v = getVocabulary(business.category)
  const identityImage = business.logoUrl || business.profileImageUrl
  const hasServices = business.services.length > 0

  return (
    <BusinessTheme business={business}>
      <main className="studio-shell min-h-screen pb-32">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
          <header className="mb-8 flex min-h-11 items-center justify-end">
            {accountCta && (
              <Link href={accountCta.href} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-primary hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                {accountCta.label}
              </Link>
            )}
          </header>

          <section className="mb-10 grid items-center gap-7 border-b border-border pb-10 md:grid-cols-[minmax(0,1fr)_18rem] md:gap-12">
            <div className="min-w-0">
              <div className="mb-5 flex items-center gap-4">
                {identityImage ? (
                  <Image src={identityImage} alt={`Identidad de ${business.name}`} width={88} height={88} unoptimized className="size-20 rounded-[var(--radius)] border border-border bg-card object-cover sm:size-22" />
                ) : (
                  <div className="flex size-20 shrink-0 items-center justify-center rounded-[var(--radius)] bg-secondary text-2xl font-semibold text-primary sm:size-22">
                    {business.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <h1 className="break-words font-heading text-4xl font-semibold tracking-[-0.03em] text-primary sm:text-5xl">{business.name}</h1>
                  {business.city && <p className="mt-1 text-sm text-muted-foreground">{business.city}</p>}
                </div>
              </div>
              {business.bio && <p className="max-w-2xl text-base leading-relaxed text-foreground sm:text-lg">{business.bio}</p>}
              <div className="mt-5 flex flex-wrap gap-2">
                {business.whatsapp && <a href={`https://wa.me/${business.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><MessageCircle className="size-4" />WhatsApp</a>}
                {business.instagram && <a href={`https://instagram.com/${business.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><Camera className="size-4" />Instagram</a>}
              </div>
            </div>
            <div className="rounded-[var(--radius)] bg-primary p-6 text-primary-foreground">
              <p className="font-heading text-xl font-semibold">Reserva a tu ritmo</p>
              <p className="mt-2 text-sm leading-relaxed opacity-85">Elige uno o varios servicios y revisa los horarios disponibles antes de compartir tus datos.</p>
              {hasServices ? <Button asChild variant="secondary" size="touch" className="mt-5 w-full"><Link href={bookingHref}><CalendarDays className="size-5" />Reservar ahora</Link></Button> : <p className="mt-5 rounded-lg bg-background/15 px-4 py-3 text-center text-sm font-semibold">Sin servicios disponibles</p>}
            </div>
          </section>

          <div className="grid gap-10 md:grid-cols-[minmax(0,1.55fr)_minmax(16rem,.75fr)]">
            <section aria-labelledby="public-services-title">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 id="public-services-title" className="font-heading text-2xl font-semibold tracking-tight text-primary">Servicios</h2>
                {hasServices && <span className="text-sm text-muted-foreground">{business.services.length} disponibles</span>}
              </div>
              {hasServices ? (
                <div className="divide-y divide-border rounded-[var(--radius)] border border-border bg-card px-4 sm:px-6">
                  {business.services.map((service) => (
                    <article key={service.id} className="grid gap-2 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
                      <div className="min-w-0"><h3 className="break-words font-heading text-lg font-semibold text-primary">{service.name}</h3>{service.description && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{service.description}</p>}</div>
                      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground sm:justify-end"><span className="inline-flex items-center gap-1"><Clock className="size-4" />{formatDuration(service.durationMinutes)}</span><span className="font-semibold text-primary">{formatMoney(service.price, business.currency)}</span>{service.depositAmount > 0 && <span className="basis-full sm:text-right">Abono {formatMoney(service.depositAmount, business.currency)}</span>}</p>
                    </article>
                  ))}
                </div>
              ) : <div className="rounded-[var(--radius)] border border-border bg-card p-6"><p className="font-semibold text-primary">Aún no hay servicios publicados</p><p className="mt-1 text-sm text-muted-foreground">Puedes contactar al negocio para consultar su oferta.</p></div>}
            </section>

            <aside className="space-y-6">
              <section className="rounded-[var(--radius)] border border-border bg-card p-5" aria-labelledby="public-hours-title"><h2 id="public-hours-title" className="flex items-center gap-2 font-heading text-xl font-semibold text-primary"><Clock3 className="size-5" />Horarios</h2>{business.availability.length ? <div className="mt-4 space-y-3">{business.availability.map((rule) => <div key={rule.id} className="flex justify-between gap-4 text-sm"><span>{daysOfWeek[rule.dayOfWeek]}</span><span className="font-semibold text-primary">{rule.startTime}–{rule.endTime}</span></div>)}</div> : <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Los horarios aparecerán cuando el negocio publique su disponibilidad.</p>}</section>
              {business.addressText && <section className="rounded-[var(--radius)] border border-border bg-card p-5" aria-labelledby="public-location-title"><h2 id="public-location-title" className="flex items-center gap-2 font-heading text-xl font-semibold text-primary"><MapPin className="size-5" />Ubicación</h2><p className="mt-3 break-words text-sm text-muted-foreground">{business.addressText}</p></section>}
              {packagesHref && <Button asChild variant="outline" size="touch" className="w-full"><Link href={packagesHref}><Package className="size-5" />Ver paquetes</Link></Button>}
            </aside>
          </div>

          {business.reviews.length > 0 && <section className="mt-10 border-t border-border pt-10" aria-labelledby="public-reviews-title"><div className="mb-4 flex items-end justify-between gap-4"><h2 id="public-reviews-title" className="font-heading text-2xl font-semibold text-primary">Reseñas</h2><span className="text-sm text-muted-foreground">{business._count.reviews} publicadas</span></div><div className="grid gap-4 md:grid-cols-3">{business.reviews.map((review) => <article key={review.id} className="rounded-[var(--radius)] border border-border bg-card p-5"><div className="flex items-start justify-between gap-3"><p className="font-semibold text-primary">{review.customer?.name || v.Client}</p><span className="flex shrink-0 gap-0.5" aria-label={`${review.rating} de 5 estrellas`}>{Array.from({ length: 5 }).map((_, index) => <Star key={index} className={`size-4 ${index < review.rating ? 'fill-primary text-primary' : 'text-muted-foreground/30'}`} />)}</span></div>{review.comment && <p className="mt-3 text-sm leading-relaxed text-foreground">{review.comment}</p>}</article>)}</div></section>}
        </div>

        {hasServices && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 sm:hidden"><Button asChild size="touch" className="w-full"><Link href={bookingHref}><CalendarDays className="size-5" />Reservar ahora</Link></Button></div>}
      </main>
    </BusinessTheme>
  )
}
