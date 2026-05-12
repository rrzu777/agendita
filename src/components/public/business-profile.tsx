import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import { mockBusiness } from '@/lib/data/mock-business'
import { CalendarDays, Camera, Clock3, MapPin, MessageCircle, Star } from 'lucide-react'

export function BusinessProfile() {
  const business = mockBusiness

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="mx-auto mb-5 flex size-28 items-center justify-center rounded-full border-4 border-white bg-secondary text-3xl font-semibold text-primary shadow-xl">
          {business.name.slice(0, 2).toUpperCase()}
        </div>
        <h1 className="mb-3 text-4xl font-semibold tracking-normal text-primary">{business.name}</h1>
        <p className="mx-auto max-w-xl text-lg text-muted-foreground">{business.bio}</p>
        <div className="flex gap-6 justify-center mt-5 text-sm">
          {business.whatsapp && (
            <a 
              href={`https://wa.me/${business.whatsapp}`} 
              className="flex size-12 items-center justify-center rounded-full border border-border bg-card text-primary shadow-sm"
            >
              <MessageCircle className="size-5" />
            </a>
          )}
          {business.instagram && (
            <a 
              href={`https://instagram.com/${business.instagram.replace('@', '')}`} 
              className="flex size-12 items-center justify-center rounded-full border border-border bg-card text-primary shadow-sm"
            >
              <Camera className="size-5" />
            </a>
          )}
          {business.addressText && (
            <span className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="size-4" /> {business.addressText}
            </span>
          )}
        </div>
      </div>
      
      {/* Services */}
      <div className="mb-12">
        <h2 className="mb-6 text-center text-2xl font-semibold tracking-normal text-primary">Servicios</h2>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {business.services.map((service) => (
            <Card 
              key={service.id} 
              className="studio-card overflow-hidden transition-shadow hover:shadow-[var(--cream-shadow)]"
            >
              <div className="h-2" style={{ backgroundColor: service.pastelColor }} />
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-primary">{service.name}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-muted-foreground text-sm mb-4">{service.description}</p>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-lg text-primary">${service.price.toLocaleString('es-CL')}</span>
                  <span className="flex items-center gap-1 text-sm text-muted-foreground"><Clock3 className="size-4" />{service.durationMinutes} min</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Abono requerido: <span className="font-semibold text-primary">${service.depositAmount.toLocaleString('es-CL')}</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link href="/book">
            <Button size="lg" className="h-14 rounded-lg px-8 text-lg font-semibold shadow-[0_14px_32px_rgba(51,41,32,0.18)]">
              <CalendarDays className="mr-2 size-5" />
              Agendar hora
            </Button>
          </Link>
        </div>
      </div>
      
      {/* Reviews */}
      {business.reviews.length > 0 && (
        <div className="mb-12">
          <h2 className="mb-6 text-center text-2xl font-semibold tracking-normal text-primary">Reseñas</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {business.reviews.map((review) => (
              <Card key={review.id} className="studio-card">
                <CardContent className="pt-5">
                  <div className="flex items-center gap-1 mb-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={`size-4 ${i < review.rating ? 'fill-primary text-primary' : 'text-border'}`} />
                    ))}
                  </div>
                  <p className="italic mb-3 text-foreground">"{review.comment}"</p>
                  <p className="text-sm text-muted-foreground font-semibold">— {review.customerName}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
