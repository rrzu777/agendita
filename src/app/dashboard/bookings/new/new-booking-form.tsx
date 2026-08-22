'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { TimeInput } from '@/components/ui/time-input'
import { createBookingFromDashboard } from '@/server/actions/bookings'
import { previewPromotion } from '@/server/actions/promotions'
import { usePackageAvailability } from '@/lib/packages/use-package-availability'
import { searchCustomersForBooking } from '@/server/actions/customers'
import type { CustomerSearchResult } from '@/server/actions/customers'
import { formatDuration } from '@/lib/format-duration'
import { MODALITY_LABELS, sortModalities, requiresServiceAddress } from '@/lib/services/modality'
import { ServiceModality } from '@prisma/client'
import { getLocalDateStr, localDateTimeToUtc } from '@/lib/availability/timezone'
import {
  effectiveDashboardPick,
  professionalChoice,
  professionalFields,
  type FunnelProfessional,
  type ProfessionalPick,
} from '@/lib/professionals/eligible'
import { ProfessionalField } from '@/components/dashboard/professional-field'
import { formatMoney } from '@/lib/money'
import { CalendarCheck2, User, Search, X } from 'lucide-react'
import type { Service } from '@prisma/client'
import { bookingStatusLabels } from '@/lib/bookings/status-labels'
import { useVocabulary } from '@/components/vocabulary-provider'

interface NewBookingFormProps {
  services: Service[]
  professionals: FunnelProfessional[]
  businessId: string
  timezone: string
  currency: string
  initialCustomer?: CustomerSearchResult | null
}


type PaymentMode = 'none' | 'deposit_paid' | 'full_paid'
type PaymentMethod = 'cash' | 'transfer' | 'external_card' | 'other'

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  external_card: 'Tarjeta externa',
  other: 'Otro',
}

export function NewBookingForm(props: NewBookingFormProps) {
  return <NewBookingFormState key={props.initialCustomer?.id ?? 'unselected'} {...props} />
}

function NewBookingFormState({
  services,
  professionals,
  businessId,
  timezone,
  currency,
  initialCustomer = null,
}: NewBookingFormProps) {
  const vocabulary = useVocabulary()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const [promoCode, setPromoCode] = useState('')
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discount: number; finalAmount: number; serviceId: string } | null>(null)
  const [promoError, setPromoError] = useState<string | null>(null)
  const [promoPending, setPromoPending] = useState(false)

  const [serviceId, setServiceId] = useState('')
  // null = todavía no eligió (o el servicio tiene una sola y no se pregunta).
  const [modality, setModality] = useState<ServiceModality | null>(null)
  const [serviceAddress, setServiceAddress] = useState('')
  const [customerName, setCustomerName] = useState(initialCustomer?.name ?? '')
  const [customerPhone, setCustomerPhone] = useState(initialCustomer?.phone ?? '')
  const [customerEmail, setCustomerEmail] = useState(initialCustomer?.email ?? '')
  const [customerBirthDate, setCustomerBirthDate] = useState('')
  // "Cualquiera" y no "sin persona" como arranque: si hay equipo elegible el
  // servidor reparte, y sin equipo `professionalFields` lo colapsa solo a nada.
  const [pick, setPick] = useState<ProfessionalPick>({ kind: 'anyone' })
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('none')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(initialCustomer?.id ?? null)

  const { remaining: packageRemaining, usePackage, setUsePackage } =
    usePackageAvailability(businessId, customerPhone, serviceId)

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
        const res = await searchCustomersForBooking(value)
        if (!res.ok) {
          // ignore search errors — mismo comportamiento previo (silencioso)
          return
        }
        setSuggestions(res.data)
        setShowSuggestions(res.data.length > 0)
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

  async function handleApplyPromo() {
    const code = promoCode.trim()
    if (!code || !serviceId) return
    setPromoPending(true)
    setPromoError(null)
    try {
      const res = await previewPromotion({
        businessId,
        code,
        serviceId,
        phone: customerPhone || undefined,
      })
      if (!res.ok) {
        setPromoError(res.error)
        setAppliedPromo(null)
        return
      }
      if (res.data.ok) {
        setAppliedPromo({ code, discount: res.data.discount, finalAmount: res.data.finalAmount, serviceId })
        setPromoError(null)
      } else {
        setPromoError(res.data.message)
        setAppliedPromo(null)
      }
    } catch {
      setPromoError('No se pudo validar el código')
      setAppliedPromo(null)
    } finally {
      setPromoPending(false)
    }
  }

  function handleRemovePromo() {
    setAppliedPromo(null)
    setPromoCode('')
    setPromoError(null)
  }

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  )

  // Un código se validó contra un servicio específico; si cambia el servicio el
  // descuento ya no aplica. Limpiar en render (patrón soportado por React, no
  // un effect): la condición se borra al limpiar, así que no puede ciclar.
  const serviceModalities = useMemo(
    () => (selectedService ? sortModalities(selectedService.modalities) : []),
    [selectedService],
  )
  // Con una sola modalidad no se pregunta y vale esa; con varias, la elegida (y
  // si todavía no eligió, la primera, que es lo que muestra el select).
  const effectiveModality: ServiceModality | null =
    serviceModalities.length === 0 ? null
    : serviceModalities.length === 1 ? serviceModalities[0]
    : (modality && serviceModalities.includes(modality) ? modality : serviceModalities[0])

  if (appliedPromo && appliedPromo.serviceId !== serviceId) {
    setAppliedPromo(null)
    setPromoError(null)
  }

  const choice = professionalChoice(professionals, serviceId || null, effectiveModality)
  const effectivePick = effectiveDashboardPick(choice, pick)
  const { professional, professionalName } = professionalFields(choice, effectivePick)

  const summary = useMemo(() => {
    if (!selectedService) return null
    const deposit = selectedService.depositAmount
    const total = selectedService.price
    const noDeposit = deposit <= 0
    const isFree = total <= 0

    let resultStatus: string
    let resultPayment: string
    if (isFree) {
      resultStatus = bookingStatusLabels.confirmed
      resultPayment = 'Pagado'
    } else if (paymentMode === 'full_paid') {
      resultStatus = bookingStatusLabels.confirmed
      resultPayment = 'Pagado'
    } else if (paymentMode === 'deposit_paid' && deposit > 0) {
      resultStatus = bookingStatusLabels.confirmed
      resultPayment = `Abono de ${formatMoney(deposit, currency)} pagado`
    } else if (noDeposit) {
      resultStatus = bookingStatusLabels.confirmed
      resultPayment = 'Sin abono'
    } else {
      resultStatus = bookingStatusLabels.pending_payment
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
  }, [selectedService, paymentMode, currency])

  // Adjust during render (React-supported pattern, not an effect): a service
  // with no deposit can't be in 'deposit_paid' mode. The setState is conditional
  // and clears the condition, so it can't loop.
  if (selectedService && selectedService.depositAmount <= 0 && paymentMode === 'deposit_paid') {
    setPaymentMode('none')
  }

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

    // Instante real en el timezone del negocio (no el del dispositivo de la dueña)
    const startDateTime = localDateTimeToUtc(date, time, timezone)

    try {
      const res = await createBookingFromDashboard({
        serviceId,
        customerName,
        customerPhone,
        customerEmail: customerEmail || undefined,
        customerBirthDate: customerBirthDate || undefined,
        startDateTime,
        internalNotes: internalNotes || undefined,
        paymentMode: paymentMode === 'none' ? undefined : paymentMode,
        paymentMethod: paymentMode !== 'none' ? paymentMethod : undefined,
        customerId: selectedCustomerId || undefined,
        promotionCode: appliedPromo?.code,
        skipPackage: !usePackage,
        modality: effectiveModality ?? undefined,
        serviceAddress: serviceAddress || undefined,
        professional,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setSuccess(true)
      setTimeout(() => {
        router.push('/dashboard/bookings')
        router.refresh()
      }, 1500)
    } catch {
      setError('Error al crear la reserva')
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

  const today = getLocalDateStr(new Date(), timezone)

  return (
    <Card>
      <CardContent className="p-6 md:p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-primary">Servicio</h3>
              <FormField id="serviceId" label="Servicio" required>
                {(a11y) => (
                  <NativeSelect
                    {...a11y}
                    id="serviceId"
                    density="form"
                    value={serviceId}
                    onChange={(e) => setServiceId(e.target.value)}
                    required
                  >
                    <option value="">Selecciona un servicio</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — {formatMoney(s.price, currency)} ({formatDuration(s.durationMinutes)})
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              {serviceModalities.length > 1 && (
                <FormField id="modality" label="¿Dónde se atiende?" required>
                  {(a11y) => (
                    <NativeSelect
                      {...a11y}
                      id="modality"
                      density="form"
                      value={effectiveModality ?? ''}
                      onChange={(e) => setModality(e.target.value as ServiceModality)}
                      required
                    >
                      {serviceModalities.map((m) => (
                        <option key={m} value={m}>{MODALITY_LABELS[m]}</option>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              )}
              <ProfessionalField choice={choice} pick={effectivePick} onChange={setPick} />
              {effectiveModality != null && requiresServiceAddress(effectiveModality) && (
                <FormField id="serviceAddress" label="Dirección" required>
                  {(a11y) => (
                    <Input
                      {...a11y}
                      id="serviceAddress"
                      density="form"
                      value={serviceAddress}
                      onChange={(e) => setServiceAddress(e.target.value)}
                      required
                      placeholder="Calle, número, depto, comuna"
                    />
                  )}
                </FormField>
              )}
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-primary">{vocabulary.Client}</h3>

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
                    aria-label="Quitar cliente seleccionado"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <div ref={searchRef} className="relative">
                  <FormField id="booking-customer-search" label="Buscar cliente">
                    {(a11y) => (
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          {...a11y}
                          id="booking-customer-search"
                          density="form"
                          value={customerSearch}
                          onChange={(e) => handleCustomerSearch(e.target.value)}
                          placeholder="Buscar por nombre o teléfono..."
                          className="pl-10"
                        />
                        {searching && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">...</span>
                        )}
                      </div>
                    )}
                  </FormField>

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

              <FormField id="customerName" label="Nombre" required>
                {(a11y) => <Input {...a11y} id="customerName" density="form" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required placeholder="Nombre del cliente" />}
              </FormField>
              <FormField id="customerPhone" label="Teléfono" required>
                {(a11y) => <Input {...a11y} id="customerPhone" density="form" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} required placeholder="+56912345678" />}
              </FormField>
              <FormField id="customerEmail" label="Email (opcional)">
                {(a11y) => <Input {...a11y} id="customerEmail" density="form" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} type="email" placeholder="cliente@email.com" />}
              </FormField>
              <FormField id="customerBirthDate" label="Cumpleaños (opcional)">
              {(a11y) => <Input
                {...a11y}
                id="customerBirthDate"
                density="form"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={customerBirthDate}
                onChange={(e) => setCustomerBirthDate(e.target.value)}
              />}
              </FormField>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <FormField id="date" label="Fecha" required>
              {(a11y) => <Input {...a11y} id="date" density="form" type="date" required min={today} value={date} onChange={(e) => setDate(e.target.value)} />}
            </FormField>
            <FormField id="time" label="Hora" required>
              {(a11y) => (
                <TimeInput
                  id="time"
                  density="form"
                  value={time}
                  onChange={setTime}
                  ariaLabel="Hora"
                  className="w-full"
                  ariaDescribedBy={a11y['aria-describedby']}
                  ariaInvalid={a11y['aria-invalid']}
                />
              )}
            </FormField>
          </div>

          <FormField id="internalNotes" label="Notas internas (opcional)">
            {(a11y) => (
              <Textarea
                {...a11y}
                id="internalNotes"
                density="form"
                rows={2}
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Ej: Llegó por WhatsApp, prefiere color rojo..."
              />
            )}
          </FormField>

          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <fieldset>
              <legend className="text-sm font-semibold text-primary">Pago inicial</legend>

            <div className="mt-3 flex flex-wrap gap-3">
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
            </fieldset>

            {paymentMode !== 'none' && (
              <div className="border-t border-border/60 pt-3">
                <FormField id="paymentMethod" label="Método de pago">
                  {(a11y) => (
                    <NativeSelect
                      {...a11y}
                      id="paymentMethod"
                      density="form"
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    >
                      {(Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod, string][]).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              </div>
            )}
          </div>

          {packageRemaining > 0 && (
            <div className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-4">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={usePackage}
                  onChange={(e) => setUsePackage(e.target.checked)}
                  className="mt-0.5 size-4 rounded border-border accent-primary"
                />
                <span className="text-green-800">
                  <span className="font-semibold">Usar paquete (quedan {packageRemaining})</span>
                  <span className="mt-0.5 block">
                    El cliente tiene un paquete que cubre este servicio.
                    {usePackage && ' Se consumirá una sesión y no se cobrará pago.'}
                  </span>
                </span>
              </label>
            </div>
          )}

          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            {appliedPromo && (
              <p className="text-sm font-semibold text-primary">Código de descuento (opcional)</p>
            )}
            {appliedPromo ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Código</span>
                  <span className="font-medium">{appliedPromo.code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Descuento</span>
                  <span className="font-medium text-green-700">−{formatMoney(appliedPromo.discount, currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Precio final</span>
                  <span className="font-medium">{formatMoney(appliedPromo.finalAmount, currency)}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-primary"
                  onClick={handleRemovePromo}
                  disabled={loading}
                >
                  Quitar
                </Button>
              </div>
            ) : (
              <FormField id="promoCode" label="Código de descuento (opcional)" error={promoError ?? undefined}>
                {(a11y) => (
                  <div className="flex gap-2">
                    <Input
                      {...a11y}
                      id="promoCode"
                      density="form"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                      placeholder="Ingresa un código"
                      disabled={promoPending}
                    />
                    <Button
                      type="button"
                      size="form"
                      variant="outline"
                      onClick={handleApplyPromo}
                      disabled={promoPending || !promoCode.trim() || !serviceId}
                    >
                      {promoPending ? 'Validando…' : 'Aplicar'}
                    </Button>
                  </div>
                )}
              </FormField>
            )}
            {appliedPromo && promoError && <p role="alert" className="text-sm text-destructive">{promoError}</p>}
          </div>

          {summary && (
            <div className="rounded-xl border border-border/60 bg-muted/40 p-4">
              <h4 className="mb-3 text-sm font-semibold text-primary">Resumen</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Servicio</span>
                  <span className="font-medium">{summary.serviceName} ({formatDuration(summary.duration)})</span>
                </div>
                {professionalName && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Atiende</span>
                    <span className="font-medium">{professionalName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Precio</span>
                  <span className="font-medium">{formatMoney(summary.price, currency)}</span>
                </div>
                {appliedPromo && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Descuento</span>
                      <span className="font-medium text-green-700">−{formatMoney(appliedPromo.discount, currency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Precio final</span>
                      <span className="font-medium">{formatMoney(appliedPromo.finalAmount, currency)}</span>
                    </div>
                  </>
                )}
                {!summary.noDeposit && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Abono requerido</span>
                    <span className="font-medium">{formatMoney(summary.deposit, currency)}</span>
                  </div>
                )}
                {summary.remainingBalance > 0 && (
                  <div className="flex justify-between border-t border-border/60 pt-2">
                    <span className="text-muted-foreground">Saldo pendiente</span>
                    <span className="font-medium">{formatMoney(summary.remainingBalance, currency)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border/60 pt-2">
                  <span className="text-muted-foreground">Estado</span>
                  <span className={`font-semibold ${summary.resultStatus === bookingStatusLabels.confirmed ? 'text-green-700' : 'text-orange-700'}`}>
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
              size="form"
              variant="outline"
              onClick={() => router.back()}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" size="form" disabled={loading} className="flex-1">
              {loading ? 'Creando reserva…' : 'Crear reserva'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
