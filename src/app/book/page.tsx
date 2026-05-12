import Link from 'next/link'
import { prisma } from '@/lib/db'

export default async function BookIndexPage() {
  const businesses = await prisma.business.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
    take: 10,
  })

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Reserva tu hora</h1>
          <p className="text-gray-600">Selecciona un negocio para continuar</p>
        </div>
        <div className="space-y-4">
          {businesses.map((business) => (
            <Link
              key={business.id}
              href={`/book/${business.slug}`}
              className="block bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow"
            >
              <h2 className="text-lg font-semibold text-gray-900">{business.name}</h2>
              <p className="text-pink-600 mt-1">Hacer reserva →</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
