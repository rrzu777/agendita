import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db/prisma'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

async function getBusiness(subdomain: string) {
  return prisma.business.findUnique({
    where: { subdomain },
    include: {
      services: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
      galleryImages: {
        orderBy: { sortOrder: 'asc' },
      },
      reviews: {
        where: { isApproved: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { customer: { select: { name: true } } },
      },
    },
  })
}

function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-pink-50 to-white">
      <main className="container mx-auto px-4 py-16">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
            Agenda online para manicuristas
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Permite que tus clientas reserven hora, paguen abono y reciban confirmación 
            sin escribirte mil veces por WhatsApp.
          </p>
          <div className="flex gap-4 justify-center">
            <button className="bg-pink-500 text-white px-8 py-3 rounded-full font-semibold hover:bg-pink-600 transition">
              Crear cuenta
            </button>
            <button className="bg-white text-pink-500 border-2 border-pink-500 px-8 py-3 rounded-full font-semibold hover:bg-pink-50 transition">
              Iniciar sesión
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

async function PublicProfilePage({ subdomain }: { subdomain: string }) {
  const business = await getBusiness(subdomain)
  
  if (!business) {
    notFound()
  }
  
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-24 h-24 bg-pink-100 rounded-full mx-auto mb-4 flex items-center justify-center text-3xl">
          💅
        </div>
        <h1 className="text-3xl font-bold text-gray-900">{business.name}</h1>
        <p className="text-gray-600 mt-2">{business.bio}</p>
        <div className="flex gap-4 justify-center mt-4">
          {business.whatsapp && (
            <a href={`https://wa.me/${business.whatsapp}`} className="text-green-600 hover:underline">
              WhatsApp
            </a>
          )}
          {business.instagram && (
            <a href={`https://instagram.com/${business.instagram.replace('@', '')}`} className="text-pink-600 hover:underline">
              Instagram
            </a>
          )}
        </div>
      </div>
      
      {/* Services */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4">Servicios</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {business.services.map((service) => (
            <Card key={service.id} style={{ borderLeftColor: service.pastelColor, borderLeftWidth: '4px' }}>
              <CardHeader>
                <CardTitle>{service.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 mb-2">{service.description}</p>
                <div className="flex justify-between items-center">
                  <span className="font-semibold">${service.price.toLocaleString('es-CL')}</span>
                  <span className="text-sm text-gray-500">{service.durationMinutes} min</span>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Abono: ${service.depositAmount.toLocaleString('es-CL')}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="text-center mt-6">
          <Link href="/book">
            <Button size="lg" className="bg-pink-500 hover:bg-pink-600">
              Agendar hora
            </Button>
          </Link>
        </div>
      </div>
      
      {/* Reviews */}
      {business.reviews.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold mb-4">Reseñas</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {business.reviews.map((review) => (
              <Card key={review.id}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-yellow-500">{'★'.repeat(review.rating)}</span>
                  </div>
                  <p className="text-gray-700">{review.comment}</p>
                  <p className="text-sm text-gray-500 mt-2">{review.customer.name}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default async function HomePage() {
  const headersList = headers()
  const subdomain = headersList.get('x-business-subdomain')
  
  if (subdomain) {
    return <PublicProfilePage subdomain={subdomain} />
  }
  
  return <LandingPage />
}
