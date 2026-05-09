import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

export default async function BookPage() {
  const subdomain = headers().get('x-business-subdomain')
  
  if (!subdomain) {
    notFound()
  }
  
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Reservar hora</h1>
      <p className="text-gray-600">Flujo de reserva en construcción...</p>
    </div>
  )
}
