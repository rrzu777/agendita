import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getPlatformAdminUser } from '@/lib/auth/user'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import { prisma } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'

export default async function AdminPage() {
  const user = await getPlatformAdminUser()

  if (!user) {
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

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {businesses.map((business) => (
          <TableMobileCard
            key={business.id}
            title={business.name}
            subtitle={getBusinessPublicUrl({ slug: business.slug, subdomain: business.subdomain })}
            badge={<StatusBadge map="subscription" status={business.subscriptionStatus} />}
            rows={[
              { label: 'Plan', value: business.plan?.name ?? '—' },
              { label: 'Reservas', value: business._count.bookings },
            ]}
            actions={
              <Link
                href={`/admin/businesses/${business.id}`}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Ver detalle
              </Link>
            }
          />
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden lg:block studio-card overflow-hidden">
        <Table fixed className={TABLE_MIN_WIDTH}>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Negocio</TableHead>
              <TableHead className={TABLE_COL.contact}>Subdominio</TableHead>
              <TableHead className={TABLE_COL.label}>Plan</TableHead>
              <TableHead className={TABLE_COL.status}>Estado</TableHead>
              <TableHead className={TABLE_COL.count}>Reservas</TableHead>
              <TableHead className={TABLE_COL.actions}>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {businesses.map((business) => (
              <TableRow key={business.id}>
                <TruncatedCell className="font-semibold text-primary" primary={business.name} />
                <TruncatedCell
                  className={`${TABLE_COL.contact} text-muted-foreground`}
                  primary={getBusinessPublicUrl({ slug: business.slug, subdomain: business.subdomain })}
                />
                <TableCell className={`${TABLE_COL.label} text-muted-foreground`}>
                  {business.plan?.name ?? '—'}
                </TableCell>
                <TableCell className={TABLE_COL.status}>
                  <StatusBadge map="subscription" status={business.subscriptionStatus} />
                </TableCell>
                <TableCell className={`${TABLE_COL.count} text-muted-foreground`}>
                  {business._count.bookings}
                </TableCell>
                <TableCell className={TABLE_COL.actions}>
                  <Link
                    href={`/admin/businesses/${business.id}`}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Ver detalle
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
