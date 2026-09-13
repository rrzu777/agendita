import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getPlatformAdminUser } from '@/lib/auth/user'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import { prisma } from '@/lib/db'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
import { DashboardPageHeader } from '@/components/dashboard/dashboard-page-header'
import { DashboardPanel } from '@/components/dashboard/dashboard-panel'
import { KpiStrip } from '@/components/dashboard/kpi-strip'
import { buttonVariants } from '@/components/ui/button'

export const metadata = { title: 'Administración — Agendita' }

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
  const attentionBusinesses = businesses.filter((business) =>
    business.subscriptionStatus === 'past_due' || business.subscriptionStatus === 'suspended'
  ).length

  return (
    <div className="-mx-6 -my-8">
      <DashboardPageHeader title="Administración" subtitle="Estado operativo de las cuentas de Agendita." />
      <div className="space-y-8 px-4 py-6 min-[1100px]:px-10">
        <KpiStrip label="Resumen de cuentas" items={[
          { label: 'Negocios registrados', value: businesses.length, description: 'Total en la plataforma' },
          { label: 'Cuentas habilitadas', value: activeBusinesses, description: 'No canceladas' },
          { label: 'Reservas registradas', value: totalBookings, description: 'Acumulado de las cuentas' },
        ]} />

        {attentionBusinesses > 0 && (
          <DashboardPanel title="Requiere atención" description="Prioriza cuentas cuyo acceso o continuidad de pago puede estar afectado." tone="attention">
            <p className="text-sm font-medium">{attentionBusinesses} {attentionBusinesses === 1 ? 'cuenta con pago pendiente o suspensión' : 'cuentas con pago pendiente o suspensión'}.</p>
          </DashboardPanel>
        )}

        {businesses.length === 0 ? (
          <DashboardPanel title="Aún no hay negocios registrados" description="La lista aparecerá cuando exista una cuenta en la plataforma.">
            <Link href="/dashboard" className={buttonVariants({ variant: 'outline', size: 'form', className: 'min-h-11' })}>Volver al dashboard</Link>
          </DashboardPanel>
        ) : <>

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
        </>}
      </div>
    </div>
  )
}
