'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/money'
import { AlertCircle, Loader2 } from 'lucide-react'
import { createPackagePurchase, initiatePackagePayment, declarePackageTransfer } from '@/server/actions/packages-checkout'
import type { PackageCheckoutPrefill } from '@/server/actions/packages-checkout'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'
import { PackageTransferInstructions } from '@/components/packages/package-transfer-instructions'
import type { CatalogProduct } from './package-catalog'

interface PackageCheckoutProps {
  product: CatalogProduct
  currency: string
  prefill: PackageCheckoutPrefill
  onCancel: () => void
  transferInfo: BankTransferPublicInfo | null
  onlineAvailable?: boolean
}

/** El encabezado que repiten las tres pantallas: volver, nombre y precio. */
function Encabezado({
  onBack,
  backLabel,
  title,
  subtitle,
}: {
  onBack: () => void
  backLabel: string
  title: string
  subtitle: string
}) {
  return (
    <>
      <button type="button" onClick={onBack} className="mb-4 min-h-11 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-secondary">
        {backLabel}
      </button>
      <h2 className="text-lg font-semibold text-primary">{title}</h2>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </>
  )
}

/**
 * En qué pantalla está la compra, CON los datos que esa pantalla necesita
 * adentro.
 *
 * Antes el paso era un string suelto y los datos vivían en props y estados
 * aparte, así que la pantalla de transferencia se elegía con
 * `step === 'transfer' && transferInfo && purchaseId`. OJO con el tiempo
 * verbal: eso NO se rompió acá — `purchaseId` se seteaba en la línea de arriba
 * del `setStep` y `transferInfo` es un prop que no cambia, así que el guard
 * nunca falló. Lo que importa es la FORMA, que sí se rompió en el #159 un
 * archivo más allá: cuando el guard de datos falla, el fallback no es una
 * pantalla vacía sino el formulario de una compra que ya existe, listo para
 * cobrarla de nuevo.
 *
 * Con los datos adentro del paso eso deja de ser escribible: no hay estado
 * 'transfer' sin la cuenta bancaria y sin el id de la compra. Es la misma forma
 * que tomó `step-payment.tsx` en el #163.
 */
type Paso =
  | { k: 'form' }
  | { k: 'method'; bank: BankTransferPublicInfo }
  | { k: 'transfer'; bank: BankTransferPublicInfo; purchaseId: string }

export function PackageCheckout({ product, currency, prefill, onCancel, transferInfo, onlineAvailable = true }: PackageCheckoutProps) {
  const router = useRouter()
  const [paso, setPaso] = useState<Paso>({ k: 'form' })
  const [name, setName] = useState(prefill.name)
  const [phone, setPhone] = useState(prefill.phone)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState<'name' | 'phone' | 'terms' | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const termsRef = useRef<HTMLInputElement>(null)

  const total = product.quantity + product.bonusQuantity

  function validateForm(): boolean {
    setError('')
    setErrorField(null)
    if (!name.trim()) {
      setError('Ingresa tu nombre')
      setErrorField('name')
      nameRef.current?.focus()
      return false
    }
    if (!phone.trim()) {
      setError('Ingresa tu teléfono')
      setErrorField('phone')
      phoneRef.current?.focus()
      return false
    }
    if (!acceptedTerms) {
      setError('Debes aceptar los términos')
      setErrorField('terms')
      termsRef.current?.focus()
      return false
    }
    return true
  }

  function createPurchase(method: 'mp' | 'transfer') {
    return createPackagePurchase({
      packageProductId: product.id,
      name: name.trim(),
      phone: phone.trim(),
      acceptedTerms: true,
      method,
    })
  }

  async function startMp() {
    setError('')
    setLoading(true)
    try {
      const createRes = await createPurchase('mp')
      if (!createRes.ok) {
        setError(createRes.error)
        setLoading(false)
        return
      }
      const { purchaseId } = createRes.data
      const res = await initiatePackagePayment({ purchaseId })
      if (!res.ok) {
        setError(res.error)
        setLoading(false)
        return
      }
      // loading queda en true a propósito: la página está navegando.
      if ('redirectUrl' in res.data) {
        window.location.href = res.data.redirectUrl
        return
      }
      router.push(`/paquetes/confirmation?purchaseId=${purchaseId}`)
    } catch {
      setError('No pudimos iniciar la compra. Intenta nuevamente.')
      setLoading(false)
    }
  }

  async function startTransfer(bank: BankTransferPublicInfo) {
    setError('')
    setLoading(true)
    try {
      const res = await createPurchase('transfer')
      if (!res.ok) {
        setError(res.error)
        setLoading(false)
        return
      }
      setPaso({ k: 'transfer', bank, purchaseId: res.data.purchaseId })
      setLoading(false)
    } catch {
      setError('No pudimos iniciar la compra. Intenta nuevamente.')
      setLoading(false)
    }
  }

  async function handleDeclare(purchaseId: string) {
    setError('')
    setLoading(true)
    try {
      const res = await declarePackageTransfer({ purchaseId })
      if (!res.ok) {
        setError(res.error)
        setLoading(false)
        return
      }
      // loading queda en true: la navegación desmonta este componente.
      router.push(`/paquetes/confirmation?purchaseId=${purchaseId}`)
    } catch {
      setError('No pudimos avisar al negocio. Intenta nuevamente.')
      setLoading(false)
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validateForm()) return
    if (transferInfo) {
      setPaso({ k: 'method', bank: transferInfo })
      return
    }
    void startMp()
  }

  const subtitulo = `${total} sesiones · ${formatMoney(product.price, currency)}`

  /** El error de la action, con el mismo formato en las tres pantallas. */
  const errorLine = error && (
    <p id="package-checkout-error" role="alert" className="mt-3 flex items-center gap-2 text-sm text-destructive">
      <AlertCircle className="size-4" />
      {error}
    </p>
  )

  switch (paso.k) {
    case 'transfer':
      return (
        <div className="rounded-[var(--radius)] border border-border bg-card p-5 shadow-sm">
          <Encabezado onBack={onCancel} backLabel="← Volver al catálogo" title={product.name} subtitle={subtitulo} />
          <div className="mt-4">
            <PackageTransferInstructions
              transferInfo={paso.bank}
              amount={product.price}
              currency={currency}
              declaring={loading}
              onDeclare={() => void handleDeclare(paso.purchaseId)}
            />
          </div>
          {errorLine}
        </div>
      )

    case 'method':
      return (
        <div className="rounded-[var(--radius)] border border-border bg-card p-5 shadow-sm">
          <Encabezado onBack={() => setPaso({ k: 'form' })} backLabel="← Volver" title={product.name} subtitle={subtitulo} />

          <div className="mt-4 space-y-3">
            {onlineAvailable && (
              <Button size="touch" className="w-full rounded-xl" onClick={() => void startMp()} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Procesando…
                  </>
                ) : (
                  'Pagar con Mercado Pago'
                )}
              </Button>
            )}
            <Button
              variant="outline"
              size="touch"
              className="w-full rounded-xl"
              onClick={() => void startTransfer(paso.bank)}
              disabled={loading}
            >
              Transferencia bancaria
            </Button>
          </div>

          {errorLine}
        </div>
      )

    // El único sin pantalla propia acá: es el formulario de abajo.
    case 'form':
      break

    // Un paso nuevo sin rama acá NO COMPILA. En runtime es inalcanzable —`paso`
    // sólo lo escribe `setPaso` con literales—, así que cae al formulario en vez
    // de tirar abajo la página: no hay error boundary bajo /paquetes.
    default:
      paso satisfies never
      break
  }

  return (
    <form onSubmit={handleFormSubmit} noValidate className="rounded-[var(--radius)] border border-border bg-card p-5 shadow-sm">
      <Encabezado onBack={onCancel} backLabel="← Volver al catálogo" title={product.name} subtitle={subtitulo} />

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="package-customer-name" className="text-sm font-semibold text-primary">Nombre <span className="text-muted-foreground">(requerido)</span></label>
          <Input ref={nameRef} id="package-customer-name" value={name} onChange={(e) => { setName(e.target.value); setError(''); setErrorField(null) }} placeholder="Tu nombre" density="touch" aria-required="true" aria-invalid={errorField === 'name'} aria-describedby={errorField === 'name' ? 'package-checkout-error' : undefined} />
        </div>
        <div>
          <label htmlFor="package-customer-phone" className="text-sm font-semibold text-primary">Teléfono <span className="text-muted-foreground">(requerido)</span></label>
          <Input ref={phoneRef} id="package-customer-phone" value={phone} onChange={(e) => { setPhone(e.target.value); setError(''); setErrorField(null) }} placeholder="+56 9 1111 2222" inputMode="tel" density="touch" aria-required="true" aria-invalid={errorField === 'phone'} aria-describedby={errorField === 'phone' ? 'package-checkout-error' : undefined} />
        </div>
        <div>
          <label htmlFor="package-customer-email" className="text-sm font-semibold text-primary">Email <span className="text-muted-foreground">(solo lectura)</span></label>
          <Input id="package-customer-email" value={prefill.email ?? ''} readOnly disabled density="touch" />
        </div>
        <label className="flex min-h-11 items-start gap-3 py-2 text-sm text-muted-foreground">
          <input
            ref={termsRef}
            id="package-accepted-terms"
            type="checkbox"
            required
            checked={acceptedTerms}
            onChange={(e) => { setAcceptedTerms(e.target.checked); setError(''); setErrorField(null) }}
            aria-required="true"
            aria-invalid={errorField === 'terms'}
            aria-describedby={errorField === 'terms' ? 'package-checkout-error' : undefined}
            className="mt-0.5 size-5 accent-primary"
          />
          Acepto los términos y condiciones de la compra.
        </label>
      </div>

      {errorLine}

      <Button type="submit" size="touch" className="mt-4 w-full rounded-xl" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Procesando…
          </>
        ) : transferInfo ? (
          'Continuar'
        ) : (
          `Pagar ${formatMoney(product.price, currency)}`
        )}
      </Button>
    </form>
  )
}
