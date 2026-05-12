export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Metadata } from 'next'

interface ProfilePageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { slug } = await params
  const business = await prisma.business.findUnique({
    where: { slug },
  })

  if (!business) return { title: 'Perfil no encontrado' }

  return {
    title: `${business.name} — Reserva tu hora`,
    description: business.bio || `Reserva tu hora en ${business.name}`,
  }
}

export default async function PublicProfilePage({ params }: ProfilePageProps) {
  const { slug } = await params

  const business = await prisma.business.findUnique({
    where: { slug },
    include: {
      services: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
      availability: {
        where: { isActive: true },
        orderBy: { dayOfWeek: 'asc' },
      },
      reviews: {
        where: { isApproved: true },
        orderBy: { createdAt: 'desc' },
        take: 3,
        include: { customer: true },
      },
    },
  })

  if (!business || !business.isActive) {
    notFound()
  }

  const daysOfWeek = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

  return (
    <div className="min-h-screen bg-gradient-to-b from-pink-50 to-white">
      <div className="max-w-lg mx-auto px-4 py-12">
        {/* Profile Header */}
        <div className="text-center mb-8">
          {business.profileImageUrl ? (
            <img
              src={business.profileImageUrl}
              alt={business.name}
              className="w-24 h-24 rounded-full mx-auto mb-4 object-cover border-4 border-white shadow-lg"
            />
          ) : (
            <div className="w-24 h-24 rounded-full mx-auto mb-4 bg-pink-200 flex items-center justify-center text-4xl">
              💅
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{business.name}</h1>
          {business.bio && <p className="text-gray-600 text-sm leading-relaxed">{business.bio}</p>}
          
          {/* Social Links */}
          <div className="flex justify-center gap-3 mt-4">
            {business.whatsapp && (
              <a
                href={`https://wa.me/${business.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-green-500 text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-green-600 transition"
              >
                WhatsApp
              </a>
            )}
            {business.instagram && (
              <a
                href={`https://instagram.com/${business.instagram.replace('@', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-full text-sm font-medium hover:opacity-90 transition"
              >
                Instagram
              </a>
            )}
          </div>

          {business.addressText && (
            <p className="text-gray-500 text-sm mt-3">📍 {business.addressText}</p>
          )}
        </div>

        {/* Book Button */}
        <div className="mb-8">
          <Link href={`/book/${business.slug}`}>
            <Button className="w-full bg-pink-500 hover:bg-pink-600 text-lg py-6 rounded-xl shadow-lg hover:shadow-xl transition-all">
              Reservar ahora
            </Button>
          </Link>
        </div>

        {/* Services */}
        <div className="bg-white rounded-2xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-bold mb-4 text-gray-900">Servicios</h2>
          <div className="space-y-4">
            {business.services.map((service) => (
              <div
                key={service.id}
                className="flex items-center justify-between p-4 rounded-xl border hover:border-pink-300 transition-colors"
                style={{ backgroundColor: service.pastelColor + '15' }}
              >
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{service.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {service.durationMinutes} min • ${service.price.toLocaleString('es-CL')}
                  </p>
                  {service.description && (
                    <p className="text-xs text-gray-400 mt-1">{service.description}</p>
                  )}
                </div>
                <div className="text-right ml-4">
                  <span className="text-pink-600 font-bold text-lg">
                    ${service.price.toLocaleString('es-CL')}
                  </span>
                  <p className="text-xs text-gray-400">
                    Abono ${service.depositAmount.toLocaleString('es-CL')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Availability */}
        <div className="bg-white rounded-2xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-bold mb-4 text-gray-900">Horarios</h2>
          <div className="space-y-2">
            {business.availability.map((rule) => (
              <div key={rule.id} className="flex justify-between text-sm py-2 border-b last:border-0">
                <span className="font-medium text-gray-700">{daysOfWeek[rule.dayOfWeek]}</span>
                <span className="text-gray-500">
                  {rule.startTime} - {rule.endTime}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Reviews */}
        {business.reviews.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border p-6">
            <h2 className="text-lg font-bold mb-4 text-gray-900">Reseñas</h2>
            <div className="space-y-4">
              {business.reviews.map((review) => (
                <div key={review.id} className="border-b last:border-0 pb-4 last:pb-0">
                  <div className="flex items-center gap-1 mb-2">
                    {Array.from({ length: review.rating }).map((_, i) => (
                      <span key={i} className="text-yellow-400 text-sm">⭐</span>
                    ))}
                  </div>
                  <p className="text-sm text-gray-600">{review.comment}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    — {review.customer?.name || 'Clienta'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 pb-8">
          <p className="text-xs text-gray-400">
            Reservas gestionadas con 💖 por <span className="font-semibold text-pink-500">Agendita</span>
          </p>
        </div>
      </div>
    </div>
  )
}
