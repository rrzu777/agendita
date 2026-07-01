import { Button } from '@/components/ui/button'
import Link from 'next/link'
import type { PublicBusiness } from '@/lib/business/public'
import { formatDuration } from '@/lib/format-duration'
import { BadgeCheck, CalendarDays, Camera, Clock, Clock3, MapPin, MessageCircle, Sparkles, Star } from 'lucide-react'

interface BusinessProfileProps {
  business: PublicBusiness
  bookingHref?: string
}

export function BusinessProfile({ business, bookingHref = `/book/${business.slug}` }: BusinessProfileProps) {
  const daysOfWeek = ['Domingos', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábados']

  return (
    <main className="studio-shell pb-28">
      <div className="mx-auto max-w-[420px] px-4 py-12">
        <section className="mb-10 text-center">
          <div className="relative mx-auto mb-6 size-28">
            {business.profileImageUrl ? (
              <img
                src={business.profileImageUrl}
                alt={business.name}
                className="size-28 rounded-full border-4 border-white object-cover shadow-xl"
              />
            ) : (
              <div className="flex size-28 items-center justify-center rounded-full border-4 border-white bg-secondary text-4xl font-semibold text-primary shadow-xl">
                {business.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="absolute bottom-1 right-1 rounded-full border-2 border-white bg-primary p-1.5 text-primary-foreground">
              <BadgeCheck className="size-4" />
            </div>
          </div>
          <h1 className="mb-2 font-heading text-4xl font-semibold tracking-tight text-primary">{business.name}</h1>
          {business.bio && <p className="mx-auto max-w-[310px] text-base leading-relaxed text-muted-foreground">{business.bio}</p>}

          <div className="mt-6 flex justify-center gap-4">
            {business.whatsapp && (
              <a
                href={`https://wa.me/${business.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex size-12 items-center justify-center rounded-full border border-border bg-card text-primary shadow-sm transition-transform active:scale-95"
                aria-label="WhatsApp"
              >
                <MessageCircle className="size-5" />
              </a>
            )}
            {business.instagram && (
              <a
                href={`https://instagram.com/${business.instagram.replace('@', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex size-12 items-center justify-center rounded-full border border-border bg-card text-primary shadow-sm transition-transform active:scale-95"
                aria-label="Instagram"
              >
                <Camera className="size-5" />
              </a>
            )}
          </div>

          {business.addressText && (
            <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="size-4" />
              {business.addressText}
            </p>
          )}
        </section>

        <section className="mb-7">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-2xl font-semibold tracking-tight text-primary">Servicios</h2>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-primary">
              {business.services.length} disponibles
            </span>
          </div>
          <div className="space-y-3">
            {business.services.map((service) => {
              const color = service.pastelColor || '#f4dbca'
              return (
                <article
                  key={service.id}
                  className="flex items-center gap-4 rounded-[1.75rem] border p-4"
                  style={{ backgroundColor: `${color}24`, borderColor: `${color}66` }}
                >
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-card text-primary shadow-sm">
                    <Sparkles className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-heading text-lg font-semibold leading-snug text-primary">{service.name}</h3>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3.5" />
                        {formatDuration(service.durationMinutes)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-primary">${service.price.toLocaleString('es-CL')}</span>
                      {service.depositAmount > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>abono ${service.depositAmount.toLocaleString('es-CL')}</span>
                        </>
                      )}
                    </p>
                    {service.description && (
                      <p className="mt-1 line-clamp-1 text-sm text-muted-foreground/90">{service.description}</p>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="studio-card mb-7 p-6">
          <h2 className="mb-5 flex items-center gap-3 font-heading text-2xl font-semibold tracking-tight text-primary">
            <Clock3 className="size-6" />
            Horarios
          </h2>
          <div className="space-y-3">
            {business.availability.map((rule) => (
              <div key={rule.id} className="flex justify-between gap-4 text-sm">
                <span className="text-foreground">{daysOfWeek[rule.dayOfWeek]}</span>
                <span className="font-semibold text-primary">
                  {rule.startTime} - {rule.endTime}
                </span>
              </div>
            ))}
          </div>
        </section>

        {business.reviews.length > 0 && (
          <section className="mb-7">
            <h2 className="mb-4 font-heading text-2xl font-semibold tracking-tight text-primary">Reseñas</h2>
            <div className="space-y-3">
              {business.reviews.map((review) => (
                <article key={review.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-primary">
                      {review.customer?.name || 'Cliente'}
                    </p>
                    <div className="flex shrink-0 items-center gap-0.5" aria-label={`${review.rating} de 5 estrellas`}>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`size-4 ${i < review.rating ? 'fill-primary text-primary' : 'text-muted-foreground/25'}`}
                        />
                      ))}
                    </div>
                  </div>
                  {review.comment && (
                    <p className="text-sm leading-relaxed text-foreground">{review.comment}</p>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {business.addressText && (
          <section className="studio-card mb-7 flex items-center gap-4 p-5">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-primary">
              <MapPin className="size-5" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-primary">Ubicación</h2>
              <p className="text-sm text-muted-foreground">{business.addressText}</p>
            </div>
          </section>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-background/85 px-4 py-4 backdrop-blur">
        <div className="mx-auto max-w-[420px]">
          <Button asChild className="h-16 w-full rounded-full text-lg font-semibold shadow-[0_12px_28px_rgba(51,41,32,0.22)]">
            <Link href={bookingHref}>
              <CalendarDays className="mr-2 size-5" />
              Reservar ahora
            </Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
