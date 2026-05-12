import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { getBookings } from '@/server/actions/bookings'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { updateBookingStatus } from '@/server/actions/bookings'
import { CalendarDays, Plus } from 'lucide-react'

const statusLabels: Record<string, string> = {
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
}

const statusColors: Record<string, string> = {
  pending_payment: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-secondary text-secondary-foreground',
  cancelled: 'bg-muted text-muted-foreground',
  no_show: 'bg-destructive/10 text-destructive',
}

export default async function BookingsPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.business) {
    redirect('/login')
  }

  const bookings = await getBookings(userData.business.id)

  return (
    <div>
      <DashboardHeader title="Gestión de reservas" subtitle="Administra tus citas y el estado de tus servicios." />
      <div className="p-5 md:p-10">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="studio-card p-4">
              <p className="studio-eyebrow">Total</p>
              <p className="mt-1 text-3xl font-semibold text-primary">{bookings.length}</p>
            </div>
            <div className="studio-card p-4">
              <p className="studio-eyebrow">Confirmadas</p>
              <p className="mt-1 text-3xl font-semibold text-primary">{bookings.filter(b => b.status === 'confirmed').length}</p>
            </div>
            <div className="studio-card p-4">
              <p className="studio-eyebrow">Pendientes</p>
              <p className="mt-1 text-3xl font-semibold text-primary">{bookings.filter(b => b.status === 'pending_payment').length}</p>
            </div>
          </div>
          <Button className="h-11 rounded-lg font-semibold">
            <Plus className="mr-2 size-4" />
            Nueva cita
          </Button>
        </div>
        <div className="studio-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Servicio</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    <CalendarDays className="mx-auto mb-3 size-8 text-primary" />
                    No hay reservas todavía
                  </TableCell>
                </TableRow>
              ) : (
                bookings.map((booking) => (
                    <TableRow key={booking.id}>
                      <TableCell className="font-semibold text-primary">
                        <div>{booking.service?.name || 'Servicio desconocido'}</div>
                        <div className="text-xs font-normal text-muted-foreground">#{booking.id.slice(0, 8)}</div>
                      </TableCell>
                      <TableCell>
                        {new Date(booking.startDateTime).toLocaleDateString('es-CL')}
                        <div className="text-sm text-muted-foreground">
                          {new Date(booking.startDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </TableCell>
                      <TableCell>
                        {booking.customer?.name || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[booking.status]}>
                          {statusLabels[booking.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className={booking.paymentStatus === 'fully_paid' ? 'font-semibold text-green-700' : 'font-semibold text-primary'}>
                          ${booking.depositPaid.toLocaleString('es-CL')} / ${booking.finalAmount.toLocaleString('es-CL')}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          {booking.status === 'confirmed' && (
                            <>
                              <form action={async () => {
                                'use server'
                                await updateBookingStatus(booking.id, 'completed')
                              }}>
                                <Button type="submit" size="sm" variant="outline">Completar</Button>
                              </form>
                              <form action={async () => {
                                'use server'
                                await updateBookingStatus(booking.id, 'cancelled')
                              }}>
                                <Button type="submit" size="sm" variant="destructive">Cancelar</Button>
                              </form>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
