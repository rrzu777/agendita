'use client'

import { KpiStrip } from '@/components/dashboard/kpi-strip'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
import type { CustomerListItem } from '@/server/actions/customers'
import type { CustomerListStats } from '@/server/actions/customers'
import { DashboardPagination } from '@/components/dashboard/dashboard-pagination'
import {
  Search,
  Phone,
  Mail,
  Eye,
  CalendarDays,
  Users,
  AlertCircle,
  Filter,
  X,
} from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { useVocabulary } from '@/components/vocabulary-provider'

const RECENT_DAYS = 30

interface CustomerListProps {
  customers: CustomerListItem[]
  nextCursor: string | null
  stats: CustomerListStats
  error: string | null
  currency: string
  searchQuery?: string
}

export function CustomerList({ customers, nextCursor, stats, error, currency, searchQuery = '' }: CustomerListProps) {
  const v = useVocabulary()
  const [showPendingOnly, setShowPendingOnly] = useState(false)
  const [showFrequentOnly, setShowFrequentOnly] = useState(false)
  const [showRecentOnly, setShowRecentOnly] = useState(false)
  const [recentThreshold, setRecentThreshold] = useState<Date | null>(null)

  const filtered = useMemo(() => {
    let result = customers

    if (showPendingOnly) {
      result = result.filter((c) => c.pendingBalance > 0)
    }

    if (showFrequentOnly) {
      result = result.filter((c) => c.bookingCount >= 2)
    }

    if (showRecentOnly) {
      result = result.filter(
        (c) => recentThreshold && c.lastBookingAt && new Date(c.lastBookingAt) >= recentThreshold
      )
    }

    return result
  }, [customers, recentThreshold, showPendingOnly, showFrequentOnly, showRecentOnly])

  const activeFilters = [showPendingOnly, showFrequentOnly, showRecentOnly].filter(Boolean).length

  if (error) {
    return (
      <div role="alert" className="studio-card shadow-none flex min-h-[320px] flex-col items-center justify-center p-8 text-center">
        <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertCircle className="size-8" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Error al cargar</h2>
        <p className="mt-2 max-w-md text-muted-foreground">{error}</p>
        <Button className="mt-6" variant="outline" onClick={() => window.location.reload()}>
          Reintentar
        </Button>
      </div>
    )
  }

  if (stats.total === 0) {
    return (
      <div className="studio-card shadow-none flex min-h-[320px] flex-col items-center justify-center p-8 text-center">
        <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-secondary text-foreground">
          <Users className="size-8" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Sin {v.clients}</h2>
        <p className="mt-2 max-w-md text-muted-foreground">
          {v.TheClients} aparecerán aquí cuando realicen su primera reserva.
        </p>
      </div>
    )
  }

  const totalCustomers = stats.total
  const withPending = stats.withPendingBalance
  const withBookings = stats.withBookings

  return (
    <div>
      <KpiStrip label="Resumen de clientes" className="mb-6" items={[
        { label: 'Total', value: totalCustomers, description: 'Todo el historial' },
        { label: 'Con reservas', value: withBookings, description: 'Clientes con al menos una reserva' },
        { label: 'Saldo pendiente', value: withPending, description: 'Clientes con saldo por pagar' },
      ]} />

      {/* Search + Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form className="flex flex-1 gap-2 sm:max-w-md" action="/dashboard/customers">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              type="search"
              placeholder="Nombre, teléfono o email"
              aria-label="Buscar clientes en todo el historial"
              defaultValue={searchQuery}
              density="form"
              className="pl-10"
            />
          </div>
          <Button type="submit" variant="outline" size="form">Buscar</Button>
          {searchQuery && (
            <Button type="button" variant="ghost" asChild aria-label="Limpiar búsqueda">
              <Link href="/dashboard/customers"><X className="size-4" /></Link>
            </Button>
          )}
        </form>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            aria-pressed={showPendingOnly}
            variant={showPendingOnly ? 'default' : 'outline'}
            onClick={() => setShowPendingOnly(!showPendingOnly)}
            className="min-h-11 text-xs"
          >
            <Filter className="mr-1 size-3" />
            Saldo pendiente
          </Button>
          <Button
            size="sm"
            aria-pressed={showFrequentOnly}
            variant={showFrequentOnly ? 'default' : 'outline'}
            onClick={() => setShowFrequentOnly(!showFrequentOnly)}
            className="min-h-11 text-xs"
          >
            <Filter className="mr-1 size-3" />
            Frecuentes
          </Button>
          <Button
            size="sm"
            aria-pressed={showRecentOnly}
            variant={showRecentOnly ? 'default' : 'outline'}
            onClick={() => {
              if (showRecentOnly) {
                setShowRecentOnly(false)
                setRecentThreshold(null)
              } else {
                setRecentThreshold(new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000))
                setShowRecentOnly(true)
              }
            }}
            className="min-h-11 text-xs"
          >
            <Filter className="mr-1 size-3" />
            Recientes
          </Button>
          {activeFilters > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowPendingOnly(false)
                setShowFrequentOnly(false)
                setShowRecentOnly(false)
                setRecentThreshold(null)
              }}
              className="min-h-11 text-xs"
            >
              <X className="mr-1 size-3" />
              Limpiar
            </Button>
          )}
        </div>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        La búsqueda se hace en todo el historial. Los filtros se aplican a esta página de 50 {v.clients}.
      </p>

      {filtered.length === 0 ? (
        <div className="studio-card shadow-none flex min-h-[200px] flex-col items-center justify-center p-8 text-center">
          <p className="text-muted-foreground">
            {activeFilters > 0
              ? `No hay ${v.clients} con estos filtros en esta página.`
              : searchQuery
              ? `No se encontraron ${v.clients} con esa búsqueda.`
              : `No hay ${v.clients} todavía.`}
          </p>
          <DashboardPagination nextCursor={nextCursor} label={`Ver 50 ${v.clients} más`} preserve={{ q: searchQuery }} />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="grid gap-3 lg:hidden">
            {filtered.map((customer) => (
              <TableMobileCard
                key={customer.id}
                title={customer.name}
                subtitle={
                  (customer.phone || customer.email) && (
                    <span className="flex flex-col gap-0.5">
                      {customer.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="size-3" />
                          {customer.phone}
                        </span>
                      )}
                      {customer.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="size-3" />
                          {customer.email}
                        </span>
                      )}
                    </span>
                  )
                }
                rows={[
                  {
                    label: 'Reservas',
                    value: customer.bookingCount > 0 ? (
                      <Badge variant="secondary" className="text-xs">
                        {customer.bookingCount}{' '}
                        {customer.bookingCount === 1 ? 'reserva' : 'reservas'}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">Sin reservas</span>
                    ),
                  },
                  ...(customer.totalPaidApproved > 0
                    ? [{ label: 'Pagado', value: <span className="font-semibold text-green-700">{formatMoney(customer.totalPaidApproved, currency)}</span> }]
                    : []),
                  ...(customer.pendingBalance > 0
                    ? [{ label: 'Pendiente', value: <span className="font-semibold text-destructive">{formatMoney(customer.pendingBalance, currency)}</span> }]
                    : []),
                  ...(customer.notes
                    ? [{ label: 'Notas', value: <span className="italic text-muted-foreground/70">{customer.notes}</span> }]
                    : []),
                  ...(customer.marketingOptOut
                    ? [{ label: 'Campañas', value: <span className="text-muted-foreground">No contactar</span> }]
                    : []),
                ]}
                actions={
                  <Link href={`/dashboard/customers/${customer.id}`}>
                    <Button size="sm" variant="outline">
                      <Eye className="mr-1 size-3.5" />
                      Ver
                    </Button>
                  </Link>
                }
              />
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden lg:block studio-card shadow-none overflow-hidden">
            <Table fixed className={TABLE_MIN_WIDTH}>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Nombre</TableHead>
                  <TableHead className="w-[180px]">Contacto</TableHead>
                  <TableHead className={TABLE_COL.count}>Reservas</TableHead>
                  <TableHead className={TABLE_COL.date}>Última reserva</TableHead>
                  <TableHead className={TABLE_COL.money}>Pagado</TableHead>
                  <TableHead className={TABLE_COL.money}>Pendiente</TableHead>
                  <TableHead className={TABLE_COL.name}>Notas</TableHead>
                  <TableHead className={`${TABLE_COL.actions} text-right`}>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((customer) => (
                  <TableRow key={customer.id}>
                    <TruncatedCell
                      className="font-semibold text-foreground"
                      primary={customer.name}
                      secondary={
                        customer.marketingOptOut ? (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            No campañas
                          </Badge>
                        ) : undefined
                      }
                    />
                    <TruncatedCell
                      className="w-[180px] text-xs text-muted-foreground"
                      primary={
                        customer.phone ? (
                          <span className="flex items-center gap-1">
                            <Phone className="size-3" />
                            {customer.phone}
                          </span>
                        ) : customer.email ? (
                          <span className="flex items-center gap-1">
                            <Mail className="size-3" />
                            {customer.email}
                          </span>
                        ) : '—'
                      }
                      secondary={
                        customer.phone && customer.email ? (
                          <span className="flex items-center gap-1">
                            <Mail className="size-3" />
                            {customer.email}
                          </span>
                        ) : undefined
                      }
                    />
                    <TableCell className={TABLE_COL.count}>
                      <Badge variant="secondary" className="text-xs">
                        {customer.bookingCount}
                      </Badge>
                    </TableCell>
                    <TableCell className={`${TABLE_COL.date} text-sm`}>
                      {customer.lastBookingAt ? (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <CalendarDays className="size-3" />
                          {new Date(customer.lastBookingAt).toLocaleDateString('es-CL')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className={`${TABLE_COL.money} whitespace-normal`}>
                      {customer.totalPaidApproved > 0 ? (
                        <span className="font-semibold text-green-700">
                          {formatMoney(customer.totalPaidApproved, currency)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{formatMoney(0, currency)}</span>
                      )}
                    </TableCell>
                    <TableCell className={`${TABLE_COL.money} whitespace-normal`}>
                      {customer.pendingBalance > 0 ? (
                        <span className="font-semibold text-destructive">
                          {formatMoney(customer.pendingBalance, currency)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{formatMoney(0, currency)}</span>
                      )}
                    </TableCell>
                    <TruncatedCell
                      className={`${TABLE_COL.name} text-xs text-muted-foreground`}
                      primary={customer.notes || '—'}
                    />
                    <TableCell className={`${TABLE_COL.actions} text-right`}>
                      <Link href={`/dashboard/customers/${customer.id}`}>
                        <Button size="sm" variant="outline">
                          Ver
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            {filtered.length} mostrados de {totalCustomers} {v.clients}
            {activeFilters > 0 && ' (con filtros)'}
          </p>
          <DashboardPagination nextCursor={nextCursor} label={`Ver 50 ${v.clients} más`} preserve={{ q: searchQuery }} />
        </>
      )}
    </div>
  )
}
