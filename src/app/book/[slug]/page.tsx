export const dynamic = 'force-dynamic'

import { BookingWizard } from '@/components/booking/wizard'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

interface BookPageProps {
  params: Promise<{ slug: string }>
}

const getBookingBusiness = unstable_cache(async (slug: string) => {
  return prisma.business.findUnique({
    relationLoadStrategy: 'join',
    where: { slug },
    include: {
      services: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
}, ['booking-business'], { revalidate: 60, tags: ['booking-business'] })

export default async function BookPage({ params }: BookPageProps) {
  const { slug } = await params

  const business = await getBookingBusiness(slug)

  if (!business || !business.isActive) {
    notFound()
  }

  return (
    <main className="studio-shell">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <Link href={`/b/${business.slug}`} className="flex size-10 items-center justify-center rounded-full text-primary transition-colors hover:bg-muted" aria-label="Volver al perfil">
            <ArrowLeft className="size-6" />
          </Link>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-normal text-primary">Agendita</h1>
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
          services={business.services}
        />
      </div>
    </main>
  )
}
