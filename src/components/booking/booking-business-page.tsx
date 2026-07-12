import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { BookingWizard } from '@/components/booking/wizard'
import type { BookingBusiness } from '@/lib/business/public'

interface BookingBusinessPageProps {
  business: BookingBusiness
  profileHref: string
  referralToken?: string
  session: { email: string; name: string; phone: string } | null
}

export function BookingBusinessPage({ business, profileHref, referralToken, session }: BookingBusinessPageProps) {
  return (
    <main className="studio-shell">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <Link href={profileHref} className="flex size-10 items-center justify-center rounded-full text-primary transition-colors hover:bg-muted" aria-label="Volver al perfil">
            <ArrowLeft className="size-6" />
          </Link>
          <div className="text-center">
            <h1 className="font-heading text-xl font-semibold tracking-tight text-primary">Agendita</h1>
            <p className="text-sm text-muted-foreground">{business.name}</p>
          </div>
          <div className="flex size-10 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary">
            {business.name.slice(0, 1).toUpperCase()}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-8">
        <BookingWizard
          businessId={business.id}
          slug={business.slug}
          timezone={business.timezone || 'America/Santiago'}
          services={business.services}
          cancellationPolicy={business.cancellationPolicy}
          referralToken={referralToken}
          session={session}
        />
      </div>
    </main>
  )
}
