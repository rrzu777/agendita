'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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

const RECENT_DAYS = 30

function formatCLP(value: number): string {
  return value.toLocaleString('es-CL')
}

function truncate(text: string | null, max: number): string | null {
  if (!text) return null
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}

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
        <h2 className="text-xl font-semibold text-primary">Sin clientas</h2>
        <p className="mt-2 max-w-md text-muted-foreground">
          Las clientas apareceran aqui cuando realicen su primera reserva.
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
            {search || activeFilters > 0
              ? 'No se encontraron clientas con esos filtros.'
              : 'No hay clientas todavia.'}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="grid gap-3 md:hidden">
            {filtered.map((customer) => (
              <Link
                key={customer.id}
                href={`/dashboard/customers/${customer.id}`}
                className="studio-card block p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-primary">{customer.name}</p>
                    {customer.phone && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="size-3" />
                        {customer.phone}
                      </p>
                    )}
                    {customer.email && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Mail className="size-3" />
                        {truncate(customer.email, 32)}
                      </p>
                    )}
                    {customer.notes && (
                      <p className="mt-1 text-xs text-muted-foreground/70 italic">
                        {truncate(customer.notes, 60)}
                      </p>
                    )}
                  </div>
                  <Eye className="mt-1 size-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {customer.bookingCount > 0 ? (
                    <Badge variant="secondary" className="text-xs">
                      {customer.bookingCount}{' '}
                      {customer.bookingCount === 1 ? 'reserva' : 'reservas'}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">Sin reservas</span>
                  )}
                  {customer.pendingBalance > 0 && (
                    <span className="font-semibold text-destructive">
                      ${formatCLP(customer.pendingBalance)} pendiente
                    </span>
                  )}
                  {customer.totalPaidApproved > 0 && (
                    <span className="font-semibold text-green-700">
                      ${formatCLP(customer.totalPaidApproved)} pagado
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block">
            <div className="studio-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Nombre</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead className="text-center">Reservas</TableHead>
                    <TableHead>Ultima reserva</TableHead>
                    <TableHead className="text-right">Pagado</TableHead>
                    <TableHead className="text-right">Pendiente</TableHead>
                    <TableHead>Notas</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-semibold text-primary">
                        {customer.name}
                      </TableCell>
                      <TableCell>
                        {customer.phone && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="size-3" />
                            {customer.phone}
                          </div>
                        )}
                        {customer.email && (
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <Mail className="size-3" />
                            {truncate(customer.email, 28)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" className="text-xs">
                          {customer.bookingCount}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {customer.lastBookingAt ? (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <CalendarDays className="size-3" />
                            {new Date(customer.lastBookingAt).toLocaleDateString('es-CL')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {customer.totalPaidApproved > 0 ? (
                          <span className="font-semibold text-green-700">
                            ${formatCLP(customer.totalPaidApproved)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">$0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {customer.pendingBalance > 0 ? (
                          <span className="font-semibold text-destructive">
                            ${formatCLP(customer.pendingBalance)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">$0</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[160px] text-xs text-muted-foreground">
                        {truncate(customer.notes, 60) || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/dashboard/customers/${customer.id}`}>
                          <Button size="xs" variant="ghost">
                            <Eye className="size-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            {filtered.length} de {customers.length} clientas
            {activeFilters > 0 && ' (filtradas)'}
          </p>
        </>
      )}
    </div>
  )
}
