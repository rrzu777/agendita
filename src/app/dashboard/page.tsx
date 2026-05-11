import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getBookings } from '@/server/actions/bookings'
import { getFinancialSummary } from '@/server/actions/ledger'

export default async function DashboardPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.business) {
    redirect('/login')
  }

  const business = userData.business
  const bookings = await getBookings(business.id)
  const summary = await getFinancialSummary(business.id)

  // Calcular estadísticas reales
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const bookingsToday = bookings.filter(b => {
    const bDate = new Date(b.startDateTime)
    bDate.setHours(0, 0, 0, 0)
    return bDate.getTime() === today.getTime()
  })
  const upcomingBookings = bookings.filter(b =>
    new Date(b.startDateTime) >= today &&
    b.status !== 'cancelled' &&
    b.status !== 'no_show'
  )

  // Link público
  const publicUrl = `${process.env.NEXT_PUBLIC_APP_DOMAIN || 'http://localhost:3000'}/b/${business.slug}`

  return (
    <div>
      <DashboardHeader title="Resumen" />
      <div className="p-8">
        {/* Profile Link Card */}
        <Card className="mb-6 border-pink-200 bg-pink-50/50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Tu perfil público</h3>
                <p className="text-sm text-gray-600">
                  Comparte este link con tus clientas para que reserven
                </p>
                <code className="mt-2 inline-block bg-white px-3 py-1.5 rounded-lg text-sm text-pink-600 font-mono border border-pink-200">
                  {publicUrl}
                </code>
              </div>
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button className="bg-pink-500 hover:bg-pink-600">
                  Ver perfil
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Reservas hoy</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{bookingsToday.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Ingresos mes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">${summary.incomeMonth.toLocaleString('es-CL')}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Próximas reservas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{upcomingBookings.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Total reservas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{bookings.length}</div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4">Próximas reservas</h2>
          {upcomingBookings.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center text-gray-500">
              <p className="mb-2">No tienes reservas próximas</p>
              <p className="text-sm">
                Comparte tu link <code className="text-pink-600">{publicUrl}</code> para empezar a recibir reservas
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Servicio</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Fecha</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Cliente</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingBookings.slice(0, 5).map((booking) => (
                    <tr key={booking.id} className="border-t">
                      <td className="px-4 py-3">{booking.service?.name || '—'}</td>
                      <td className="px-4 py-3">
                        {new Date(booking.startDateTime).toLocaleDateString('es-CL')}
                        {' '}
                        {new Date(booking.startDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">{booking.customer?.name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          booking.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                          booking.status === 'pending_payment' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {booking.status === 'confirmed' ? 'Confirmada' :
                           booking.status === 'pending_payment' ? 'Pendiente' :
                           booking.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
