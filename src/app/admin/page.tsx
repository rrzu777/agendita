import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/user'
import { isPlatformAdmin } from '@/lib/auth/platform-admin'
import { prisma } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Building2, CircleAlert, CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSubscriptionStatusLabel } from '@/lib/subscriptions/enforcement'

export default async function AdminPage() {
  const user = await getCurrentUser()

  if (!user?.email || !isPlatformAdmin(user.email)) {
    redirect('/login')
  }

  const businesses = await prisma.business.findMany({
    include: {
      plan: true,
      _count: {
        select: {
          bookings: true,
          payments: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const totalBookings = businesses.reduce((sum, b) => sum + b._count.bookings, 0)
  const activeBusinesses = businesses.filter(b => b.subscriptionStatus !== 'cancelled').length

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-primary">Panel de Administración</h1>
        <p className="mt-1 text-muted-foreground">Soporte interno de Agendita</p>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-semibold text-muted-foreground">Total negocios</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{businesses.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-semibold text-muted-foreground">Negocios activos</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{activeBusinesses}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-semibold text-muted-foreground">Total reservas</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{totalBookings}</p>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="py-3 pl-6 text-left font-semibold text-muted-foreground">Negocio</th>
                <th className="py-3 text-left font-semibold text-muted-foreground">Subdominio</th>
                <th className="py-3 text-left font-semibold text-muted-foreground">Plan</th>
                <th className="py-3 text-left font-semibold text-muted-foreground">Estado</th>
                <th className="py-3 text-left font-semibold text-muted-foreground">Reservas</th>
                <th className="py-3 text-right pr-6 font-semibold text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((business) => {
                const status = business.subscriptionStatus
                return (
                  <tr key={business.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="py-3 pl-6">
                      <div className="flex items-center gap-2">
                        <Building2 className="size-4 text-muted-foreground" />
                        <span className="font-semibold text-primary">{business.name}</span>
                      </div>
                    </td>
                    <td className="py-3 font-mono text-xs text-muted-foreground">
                      {business.subdomain}.agendita.com
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {business.plan?.name ?? '—'}
                    </td>
                    <td className="py-3">
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                        status === 'active' || status === 'trialing'
                          ? 'bg-green-100 text-green-800'
                          : status === 'suspended'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                      )}>
                        {status === 'active' || status === 'trialing' ? <CircleCheck className="size-3" /> : <CircleAlert className="size-3" />}
                        {getSubscriptionStatusLabel(status)}
                      </span>
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {business._count.bookings}
                    </td>
                    <td className="py-3 pr-6 text-right">
                      <Link
                        href={`/admin/businesses/${business.id}`}
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
