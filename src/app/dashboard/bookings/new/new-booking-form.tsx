'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { createBookingFromDashboard } from '@/server/actions/bookings'
import { searchCustomersForBooking } from '@/server/actions/customers'
import type { CustomerSearchResult } from '@/server/actions/customers'
import { CalendarCheck2, User, Search, X } from 'lucide-react'
import type { Service } from '@prisma/client'

interface NewBookingFormProps {
  services: Service[]
}

type PaymentMode = 'none' | 'deposit_paid' | 'full_paid'
type PaymentMethod = 'cash' | 'transfer' | 'external_card' | 'other'

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  external_card: 'Tarjeta externa',
  other: 'Otro',
}

export function NewBookingForm({ services }: NewBookingFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const [serviceId, setServiceId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('none')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)

  // Customer search state
  const [customerSearch, setCustomerSearch] = useState('')
  const [suggestions, setSuggestions] = useState<CustomerSearchResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close suggestions on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleCustomerSearch = useCallback((value: string) => {
    setCustomerSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (value.trim().length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchCustomersForBooking(value)
        setSuggestions(results)
        setShowSuggestions(results.length > 0)
      } catch {
        // ignore search errors
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [])

  function selectCustomer(customer: CustomerSearchResult) {
    setSelectedCustomerId(customer.id)
    setCustomerName(customer.name)
    setCustomerPhone(customer.phone)
    setCustomerEmail(customer.email || '')
    setCustomerSearch('')
    setSuggestions([])
    setShowSuggestions(false)
  }

  function clearCustomerSelection() {
    setSelectedCustomerId(null)
    setCustomerName('')
    setCustomerPhone('')
    setCustomerEmail('')
  }

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  )

  const summary = useMemo(() => {
    if (!selectedService) return null
    const deposit = selectedService.depositAmount
    const total = selectedService.price
    const noDeposit = deposit <= 0
    const isFree = total <= 0

    let resultStatus: string
    let resultPayment: string
    if (isFree) {
      resultStatus = 'Confirmada'
      resultPayment = 'Pagado'
    } else if (paymentMode === 'full_paid') {
      resultStatus = 'Confirmada'
      resultPayment = 'Pagado'
    } else if (paymentMode === 'deposit_paid' && deposit > 0) {
      resultStatus = 'Confirmada'
      resultPayment = `Abono de $${deposit.toLocaleString('es-CL')} pagado`
    } else if (noDeposit) {
      resultStatus = 'Confirmada'
      resultPayment = 'Sin abono'
    } else {
      resultStatus = 'Pendiente de pago'
      resultPayment = 'Sin pago registrado'
    }

    let remainingBalance = total
    if (paymentMode === 'full_paid') remainingBalance = 0
    else if (paymentMode === 'deposit_paid' && deposit > 0) remainingBalance = total - deposit

    return {
      serviceName: selectedService.name,
      duration: selectedService.durationMinutes,
      price: total,
      deposit,
      resultStatus,
      resultPayment,
      remainingBalance,
      noDeposit,
      isFree,
    }
  }, [selectedService, paymentMode])

  useEffect(() => {
    if (selectedService && selectedService.depositAmount <= 0 && paymentMode === 'deposit_paid') {
      setPaymentMode('none')
    }
  }, [selectedService, paymentMode])

  const paymentModeOptions = useMemo(() => {
    const options: Array<[PaymentMode, string]> = [
      ['none', 'Sin pago'],
      ['full_paid', 'Pago total'],
    ]
    if (!selectedService || selectedService.depositAmount > 0) {
      options.splice(1, 0, ['deposit_paid', 'Abono pagado'])
    }
    return options
  }, [selectedService])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!serviceId || !customerName || !customerPhone || !date || !time) {
      setError('Completa todos los campos requeridos')
      setLoading(false)
      return
    }

    const startDateTime = new Date(`${date}T${time}:00`)

    try {
      await createBookingFromDashboard({
        serviceId,
        customerName,
        customerPhone,
        customerEmail: customerEmail || undefined,
        startDateTime,
        internalNotes: internalNotes || undefined,
        paymentMode: paymentMode === 'none' ? undefined : paymentMode,
        paymentMethod: paymentMode !== 'none' ? paymentMethod : undefined,
        customerId: selectedCustomerId || undefined,
      })
      setSuccess(true)
      setTimeout(() => {
        router.push('/dashboard/bookings')
        router.refresh()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear la reserva')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <CalendarCheck2 className="mx-auto mb-3 size-10 text-green-600" />
          <h3 className="text-xl font-semibold text-primary">Reserva creada</h3>
          <p className="mt-1 text-muted-foreground">Redirigiendo a la lista de reservas...</p>
        </CardContent>
      </Card>
    )
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <Card>
      <CardContent className="p-6 md:p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-primary">Servicio</h3>
              <div className="space-y-2">
                <Label htmlFor="serviceId">Servicio *</Label>
                <select
                  id="serviceId"
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                  required
                  className="studio-input w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                >
                  <option value="">Selecciona un servicio</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — ${s.price.toLocaleString('es-CL')} ({s.durationMinutes} min)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-primary">Cliente</h3>

              {selectedCustomerId ? (
                <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3">
                  <div className="text-sm text-green-800">
                    <p className="font-semibold">{customerName}</p>
                    <p className="text-xs">{customerPhone}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-green-700"
                    onClick={clearCustomerSelection}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <div ref={searchRef} className="relative space-y-2">
                  <Label>Buscar cliente</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      value={customerSearch}
                      onChange={(e) => handleCustomerSearch(e.target.value)}
                      placeholder="Buscar por nombre o teléfono..."
                      className="h-10 pl-10"
                    />
                    {searching && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">...</span>
                    )}
                  </div>

                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute z-10 w-full rounded-lg border border-border bg-background shadow-lg">
                      {suggestions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
                          onClick={() => selectCustomer(c)}
                        >
                          <User className="size-4 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{c.name}</p>
                            <p className="text-xs text-muted-foreground">{c.phone}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="customerName">Nombre *</Label>
                <Input id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required placeholder="Nombre del cliente" className="h-10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerPhone">Teléfono *</Label>
                <Input id="customerPhone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} required placeholder="+56912345678" className="h-10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerEmail">Email (opcional)</Label>
                <Input id="customerEmail" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} type="email" placeholder="cliente@email.com" className="h-10" />
              </div>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="date">Fecha *</Label>
              <Input id="date" type="date" required min={today} value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">Hora *</Label>
              <Input id="time" type="time" required value={time} onChange={(e) => setTime(e.target.value)} className="h-10" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="internalNotes">Notas internas (opcional)</Label>
            <textarea
              id="internalNotes"
              rows={2}
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              className="studio-input w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Ej: Llegó por WhatsApp, prefiere color rojo..."
            />
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <h4 className="text-sm font-semibold text-primary">Pago inicial</h4>

            <div className="flex flex-wrap gap-3">
              {paymentModeOptions.map(([value, label]) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                    paymentMode === value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:border-primary/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMode"
                    value={value}
                    checked={paymentMode === value}
                    onChange={() => setPaymentMode(value as PaymentMode)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>

            {paymentMode !== 'none' && (
              <div className="space-y-2 border-t border-border/60 pt-3">
                <Label htmlFor="paymentMethod">Método de pago</Label>
                <select
                  id="paymentMethod"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="studio-input w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                >
                  {(Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod, string][]).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {summary && (
            <div className="rounded-xl border border-border/60 bg-muted/40 p-4">
              <h4 className="mb-3 text-sm font-semibold text-primary">Resumen</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Servicio</span>
                  <span className="font-medium">{summary.serviceName} ({summary.duration} min)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Precio</span>
                  <span className="font-medium">${summary.price.toLocaleString('es-CL')}</span>
                </div>
                {!summary.noDeposit && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Abono requerido</span>
                    <span className="font-medium">${summary.deposit.toLocaleString('es-CL')}</span>
                  </div>
                )}
                {summary.remainingBalance > 0 && (
                  <div className="flex justify-between border-t border-border/60 pt-2">
                    <span className="text-muted-foreground">Saldo pendiente</span>
                    <span className="font-medium">${summary.remainingBalance.toLocaleString('es-CL')}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border/60 pt-2">
                  <span className="text-muted-foreground">Estado</span>
                  <span className={`font-semibold ${summary.resultStatus === 'Confirmada' ? 'text-green-700' : 'text-orange-700'}`}>
                    {summary.resultStatus}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pago</span>
                  <span className="text-sm">{summary.resultPayment}</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Creando reserva...' : 'Crear reserva'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
