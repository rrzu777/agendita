import Link from 'next/link'
import { prisma } from '@/lib/db'

export default async function BookIndexPage() {
  const businesses = await prisma.business.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
    take: 10,
  })

  return (
    <div className="studio-shell py-10">
      <div className="mx-auto max-w-2xl px-4">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-semibold tracking-normal text-primary">Reserva tu hora</h1>
          <p className="mt-2 text-muted-foreground">Selecciona un negocio para continuar</p>
        </div>
        <div className="space-y-4">
          {businesses.map((business) => (
            <Link
              key={business.id}
              href={`/book/${business.slug}`}
              className="studio-card block p-6 transition-shadow hover:shadow-[var(--cream-shadow)]"
            >
              <h2 className="text-lg font-semibold text-primary">{business.name}</h2>
              <p className="mt-1 font-semibold text-muted-foreground">Hacer reserva →</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
