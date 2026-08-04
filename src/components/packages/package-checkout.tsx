'use client'

import { useState } from 'react'
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
      <button onClick={onBack} className="mb-4 text-sm font-semibold text-primary underline">
        {backLabel}
      </button>
      <h3 className="text-lg font-semibold text-primary">{title}</h3>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </>
  )
}

/**
 * En qué pantalla está la compra, CON los datos que esa pantalla necesita
 * adentro. Antes el paso era un string suelto y los datos vivían en props y
 * estados aparte, así que la pantalla de transferencia se elegía con
 * `step === 'transfer' && transferInfo && purchaseId`: si alguno de esos dos
 * faltaba, la clienta caía en el formulario de una compra que YA existía y la
 * volvía a crear. Con los datos adentro del paso eso no se puede escribir mal
 * — no hay estado 'transfer' sin la cuenta bancaria y sin el id de la compra.
 *
 * Es la misma forma que tomó `step-payment.tsx` en el #163.
 */
type Paso =
  | { k: 'form' }
  | { k: 'method'; bank: BankTransferPublicInfo }
  | { k: 'transfer'; bank: BankTransferPublicInfo; purchaseId: string }

export function PackageCheckout({ product, currency, prefill, onCancel, transferInfo }: PackageCheckoutProps) {
  const router = useRouter()
  const [paso, setPaso] = useState<Paso>({ k: 'form' })
  const [name, setName] = useState(prefill.name)
  const [phone, setPhone] = useState(prefill.phone)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const total = product.quantity + product.bonusQuantity

  function validateForm(): boolean {
    setError('')
    if (!name.trim()) {
      setError('Ingresá tu nombre')
      return false
    }
    if (!phone.trim()) {
      setError('Ingresá tu teléfono')
      return false
    }
    if (!acceptedTerms) {
      setError('Debes aceptar los términos')
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
    // loading queda en true a propósito: la página está navegando (comportamiento
    // original), no hace falta (ni corresponde) resetearlo acá.
    if ('redirectUrl' in res.data) {
      window.location.href = res.data.redirectUrl
      return
    }
    window.location.href = `/paquetes/confirmation?purchaseId=${purchaseId}`
  }

  async function startTransfer(bank: BankTransferPublicInfo) {
    setError('')
    setLoading(true)
    const res = await createPurchase('transfer')
    if (!res.ok) {
      setError(res.error)
      setLoading(false)
      return
    }
    setPaso({ k: 'transfer', bank, purchaseId: res.data.purchaseId })
    setLoading(false)
  }

  async function handleDeclare(purchaseId: string) {
    setError('')
    setLoading(true)
    const res = await declarePackageTransfer({ purchaseId })
    if (!res.ok) {
      setError(res.error)
      setLoading(false)
      return
    }
    // loading queda en true a propósito (comportamiento original): la navegación
    // desmonta este componente, así que no hay un setLoading(false) que hacer.
    router.push(`/paquetes/confirmation?purchaseId=${purchaseId}`)
  }

  function handleFormSubmit() {
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
    <p className="mt-3 flex items-center gap-2 text-sm text-destructive">
      <AlertCircle className="size-4" />
      {error}
    </p>
  )

  switch (paso.k) {
    case 'transfer':
      return (
        <div className="studio-card p-5">
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
        <div className="studio-card p-5">
          <Encabezado onBack={() => setPaso({ k: 'form' })} backLabel="← Volver" title={product.name} subtitle={subtitulo} />

          <div className="mt-4 space-y-3">
            <Button className="h-12 w-full rounded-full" onClick={() => void startMp()} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Procesando…
                </>
              ) : (
                'Pagar con Mercado Pago'
              )}
            </Button>
            <Button
              variant="outline"
              className="h-12 w-full rounded-full"
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
    <div className="studio-card p-5">
      <Encabezado onBack={onCancel} backLabel="← Volver al catálogo" title={product.name} subtitle={subtitulo} />

      <div className="mt-4 space-y-3">
        <div>
          <label className="text-sm font-semibold text-primary">Nombre</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" />
        </div>
        <div>
          <label className="text-sm font-semibold text-primary">Teléfono</label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+56 9 1111 2222" inputMode="tel" />
        </div>
        <div>
          <label className="text-sm font-semibold text-primary">Email</label>
          <Input value={prefill.email ?? ''} readOnly disabled />
        </div>
        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-1"
          />
          Acepto los términos y condiciones de la compra.
        </label>
      </div>

      {errorLine}

      <Button className="mt-4 h-12 w-full rounded-full" onClick={handleFormSubmit} disabled={loading}>
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
    </div>
  )
}
