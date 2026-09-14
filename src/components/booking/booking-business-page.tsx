import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { BookingWizard } from '@/components/booking/wizard'
import type { BookingBusiness } from '@/lib/business/public'
import type { FunnelSession } from '@/lib/customers/session-prefill'
import { getVocabulary } from '@/lib/vocabulary'
import { toFunnelProfessionals } from '@/lib/professionals/eligible'
import { cancellationPolicyRevision } from '@/lib/bookings/cancellation-policy-revision'
import { BusinessTheme } from '@/components/theme/business-theme'
import Image from 'next/image'

interface BookingBusinessPageProps {
  business: BookingBusiness
  profileHref: string
  referralToken?: string
  session: Pick<FunnelSession, 'email' | 'name' | 'phone'> | null
}

export function BookingBusinessPage({ business, profileHref, referralToken, session }: BookingBusinessPageProps) {
  return (
    <BusinessTheme business={business}>
    <main className="studio-shell min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <Link href={profileHref} className="flex size-11 items-center justify-center rounded-lg text-primary transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label="Volver al perfil">
            <ArrowLeft className="size-6" />
          </Link>
          <div className="min-w-0 px-3 text-center">
            <h1 className="truncate font-heading text-lg font-semibold tracking-tight text-primary">{business.name}</h1>
            <p className="text-xs text-muted-foreground">Reserva online</p>
          </div>
          {business.logoUrl || business.profileImageUrl ? <Image src={business.logoUrl || business.profileImageUrl!} alt="" width={44} height={44} unoptimized className="size-11 rounded-lg border border-border object-cover" /> : <div className="flex size-11 items-center justify-center rounded-lg bg-secondary text-sm font-semibold text-primary" aria-hidden="true">{business.name.slice(0, 1).toUpperCase()}</div>}
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-9">
        <BookingWizard
          businessId={business.id}
          slug={business.slug}
          business={{
            name: business.name,
            addressText: business.addressText,
            whatsapp: business.whatsapp,
          }}
          timezone={business.timezone || 'America/Santiago'}
          currency={business.currency || 'CLP'}
          services={business.services}
          // La relación se aplana acá, en el borde servidor→cliente: al wizard le
          // sirve la lista de ids y no el objeto anidado que devuelve Prisma.
          professionals={toFunnelProfessionals(business.professionals)}
          professionalWords={getVocabulary(business.category)}
          cancellationPolicy={business.cancellationPolicy}
          cancellationPolicyRevision={cancellationPolicyRevision({
            businessId: business.id,
            cutoffHours: business.selfServiceCutoffHours,
            additionalPolicy: business.cancellationPolicy,
          })}
          selfServiceCutoffHours={business.selfServiceCutoffHours}
          manualHoldHours={business.manualHoldHours}
          referralToken={referralToken}
          session={session}
        />
      </div>
    </main>
    </BusinessTheme>
  )
}
