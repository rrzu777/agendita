'use client'

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

const RECENT_DAYS = 30

interface CustomerListProps {
  customers: CustomerListItem[]
  error: string | null
}

export function CustomerList({ customers, error }: CustomerListProps) {
  const [search, setSearch] = useState('')
  const [showPendingOnly, setShowPendingOnly] = useState(false)
  const [showFrequentOnly, setShowFrequentOnly] = useState(false)
  const [showRecentOnly, setShowRecentOnly] = useState(false)

  const today = new Date()

  const filtered = useMemo(() => {
    const thirtyDaysAgo = new Date(today.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000)
    let result = customers

    if (search.trim()) {
      const q = search.toLowerCase().trim()
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          (c.email && c.email.toLowerCase().includes(q))
      )
    }

    if (showPendingOnly) {
      result = result.filter((c) => c.pendingBalance > 0)
    }

    if (showFrequentOnly) {
      result = result.filter((c) => c.bookingCount >= 2)
    }

    if (showRecentOnly) {
      result = result.filter(
        (c) => c.lastBookingAt && new Date(c.lastBookingAt) >= thirtyDaysAgo
      )
    }

    return result
  }, [customers, search, showPendingOnly, showFrequentOnly, showRecentOnly])

  const activeFilters = [showPendingOnly, showFrequentOnly, showRecentOnly].filter(Boolean).length

  if (error) {
    return (
      <div className="studio-card flex min-h-[320px] flex-col items-center justify-center p-8 text-center">
        <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertCircle className="size-8" />
        </div>
        <h2 className="text-xl font-semibold text-primary">Error al cargar</h2>
        <p className="mt-2 max-w-md text-muted-foreground">{error}</p>
        <Button className="mt-6" variant="outline" onClick={() => window.location.reload()}>
          Reintentar
        </Button>
      </div>
    )
  }

  if (customers.length === 0) {
    return (
      <div className="studio-card flex min-h-[320px] flex-col items-center justify-center p-8 text-center">
        <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-secondary text-primary">
          <Users className="size-8" />
        </div>
        <h2 className="text-xl font-semibold text-primary">Sin clientes</h2>
        <p className="mt-2 max-w-md text-muted-foreground">
          Los clientes aparecerán aquí cuando realicen su primera reserva.
        </p>
      </div>
    )
  }

  const totalCustomers = customers.length
  const withPending = customers.filter((c) => c.pendingBalance > 0).length
  const withBookings = customers.filter((c) => c.bookingCount > 0).length

  return (
    <div>
      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="studio-card p-4">
          <p className="studio-eyebrow">Total</p>
          <p className="mt-1 text-2xl font-semibold text-primary sm:text-3xl">
            {totalCustomers}
          </p>
        </div>
        <div className="studio-card p-4">
          <p className="studio-eyebrow">Con reservas</p>
          <p className="mt-1 text-2xl font-semibold text-primary sm:text-3xl">
            {withBookings}
          </p>
        </div>
        <div className="studio-card p-4">
          <p className="studio-eyebrow">Saldo pendiente</p>
          <p className="mt-1 text-2xl font-semibold text-primary sm:text-3xl">
            {withPending}
          </p>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, telefono o email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="studio-input pl-10"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
              aria-label="Limpiar busqueda"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={showPendingOnly ? 'default' : 'outline'}
            onClick={() => setShowPendingOnly(!showPendingOnly)}
            className="text-xs"
          >
            <Filter className="mr-1 size-3" />
            Saldo pendiente
          </Button>
          <Button
            size="sm"
            variant={showFrequentOnly ? 'default' : 'outline'}
            onClick={() => setShowFrequentOnly(!showFrequentOnly)}
            className="text-xs"
          >
            <Filter className="mr-1 size-3" />
            Frecuentes
          </Button>
          <Button
            size="sm"
            variant={showRecentOnly ? 'default' : 'outline'}
            onClick={() => setShowRecentOnly(!showRecentOnly)}
            className="text-xs"
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
              }}
              className="text-xs"
            >
              <X className="mr-1 size-3" />
              Limpiar
            </Button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="studio-card flex min-h-[200px] flex-col items-center justify-center p-8 text-center">
          <p className="text-muted-foreground">
            {activeFilters > 0
              ? 'No hay clientes con estos filtros.'
              : search
              ? 'No se encontraron clientes con esa búsqueda.'
              : 'No hay clientes todavía.'}
          </p>
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
                    ? [{ label: 'Pagado', value: <span className="font-semibold text-green-700">{formatMoney(customer.totalPaidApproved)}</span> }]
                    : []),
                  ...(customer.pendingBalance > 0
                    ? [{ label: 'Pendiente', value: <span className="font-semibold text-destructive">{formatMoney(customer.pendingBalance)}</span> }]
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
          <div className="hidden lg:block studio-card overflow-hidden">
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
                      className="font-semibold text-primary"
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
                          {formatMoney(customer.totalPaidApproved)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{formatMoney(0)}</span>
                      )}
                    </TableCell>
                    <TableCell className={`${TABLE_COL.money} whitespace-normal`}>
                      {customer.pendingBalance > 0 ? (
                        <span className="font-semibold text-destructive">
                          {formatMoney(customer.pendingBalance)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{formatMoney(0)}</span>
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
            {filtered.length} de {customers.length} clientes
            {activeFilters > 0 && ' (filtradas)'}
          </p>
        </>
      )}
    </div>
  )
}
