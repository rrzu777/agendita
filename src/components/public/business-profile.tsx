import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import { mockBusiness } from '@/lib/data/mock-business'

export function BusinessProfile() {
  const business = mockBusiness

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="w-28 h-28 bg-gradient-to-br from-pink-200 to-purple-200 rounded-full mx-auto mb-5 flex items-center justify-center text-4xl shadow-lg">
          💅
        </div>
        <h1 className="text-4xl font-bold text-gray-900 mb-3">{business.name}</h1>
        <p className="text-gray-600 text-lg max-w-xl mx-auto">{business.bio}</p>
        <div className="flex gap-6 justify-center mt-5 text-sm">
          {business.whatsapp && (
            <a 
              href={`https://wa.me/${business.whatsapp}`} 
              className="flex items-center gap-2 text-green-600 hover:text-green-700 transition"
            >
              <span>💬</span> WhatsApp
            </a>
          )}
          {business.instagram && (
            <a 
              href={`https://instagram.com/${business.instagram.replace('@', '')}`} 
              className="flex items-center gap-2 text-pink-600 hover:text-pink-700 transition"
            >
              <span>📷</span> Instagram
            </a>
          )}
          {business.addressText && (
            <span className="flex items-center gap-2 text-gray-500">
              <span>📍</span> {business.addressText}
            </span>
          )}
        </div>
      </div>
      
      {/* Services */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold mb-6 text-center">Servicios</h2>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {business.services.map((service) => (
            <Card 
              key={service.id} 
              className="overflow-hidden hover:shadow-lg transition-shadow border-0 shadow-md"
            >
              <div className="h-2" style={{ backgroundColor: service.pastelColor }} />
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">{service.name}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-gray-600 text-sm mb-4">{service.description}</p>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-lg">${service.price.toLocaleString('es-CL')}</span>
                  <span className="text-sm text-gray-500">{service.durationMinutes} min</span>
                </div>
                <p className="text-sm text-gray-500">
                  Abono requerido: <span className="font-medium">${service.depositAmount.toLocaleString('es-CL')}</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link href="/book">
            <Button size="lg" className="bg-pink-500 hover:bg-pink-600 text-white px-8 py-6 text-lg rounded-full shadow-lg hover:shadow-xl transition-all">
              ✨ Agendar hora
            </Button>
          </Link>
        </div>
      </div>
      
      {/* Reviews */}
      {business.reviews.length > 0 && (
        <div className="mb-12">
          <h2 className="text-2xl font-bold mb-6 text-center">Reseñas</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {business.reviews.map((review) => (
              <Card key={review.id} className="border-0 shadow-md">
                <CardContent className="pt-5">
                  <div className="flex items-center gap-1 mb-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span key={i} className={i < review.rating ? 'text-yellow-400' : 'text-gray-200'}>
                        ★
                      </span>
                    ))}
                  </div>
                  <p className="text-gray-700 italic mb-3">"{review.comment}"</p>
                  <p className="text-sm text-gray-500 font-medium">— {review.customerName}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
