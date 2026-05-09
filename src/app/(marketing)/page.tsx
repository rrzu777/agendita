export default function MarketingPage() {
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
