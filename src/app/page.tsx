import { headers } from 'next/headers'
import { BusinessProfile } from '@/components/public/business-profile'

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
            <a href="/register" className="bg-pink-500 text-white px-8 py-3 rounded-full font-semibold hover:bg-pink-600 transition inline-block">
              Crear cuenta
            </a>
            <a href="/login" className="bg-white text-pink-500 border-2 border-pink-500 px-8 py-3 rounded-full font-semibold hover:bg-pink-50 transition inline-block">
              Iniciar sesión
            </a>
          </div>
        </div>
      </main>
    </div>
  )
}

export default async function HomePage() {
  const subdomain = (await headers()).get('x-business-subdomain')
  
  if (subdomain) {
    return <BusinessProfile />
  }
  
  return <LandingPage />
}
