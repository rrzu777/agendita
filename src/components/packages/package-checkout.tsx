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

export function PackageCheckout({ product, currency, prefill, onCancel, transferInfo }: PackageCheckoutProps) {
  const router = useRouter()
  const [step, setStep] = useState<'form' | 'method' | 'transfer'>('form')
  const [purchaseId, setPurchaseId] = useState<string | null>(null)
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
    if ('redirectUrl' in res.data) {
      window.location.href = res.data.redirectUrl
      return
    }
    window.location.href = `/paquetes/confirmation?purchaseId=${purchaseId}`
  }

  async function startTransfer() {
    setError('')
    setLoading(true)
    const res = await createPurchase('transfer')
    if (!res.ok) {
      setError(res.error)
      setLoading(false)
      return
    }
    setPurchaseId(res.data.purchaseId)
    setStep('transfer')
    setLoading(false)
  }

  async function handleDeclare() {
    if (!purchaseId) return
    setError('')
    setLoading(true)
    const res = await declarePackageTransfer({ purchaseId })
    if (!res.ok) {
      setError(res.error)
      setLoading(false)
      return
    }
    router.push(`/paquetes/confirmation?purchaseId=${purchaseId}`)
  }

  function handleFormSubmit() {
    if (!validateForm()) return
    if (transferInfo) {
      setStep('method')
      return
    }
    void startMp()
  }

  if (step === 'transfer' && transferInfo && purchaseId) {
    return (
      <div className="studio-card p-5">
        <button onClick={onCancel} className="mb-4 text-sm font-semibold text-primary underline">
          ← Volver al catálogo
        </button>
        <h3 className="text-lg font-semibold text-primary">{product.name}</h3>
        <p className="text-sm text-muted-foreground">{total} sesiones · {formatMoney(product.price, currency)}</p>
        <div className="mt-4">
          <PackageTransferInstructions
            transferInfo={transferInfo}
            amount={product.price}
            currency={currency}
            declaring={loading}
            onDeclare={handleDeclare}
          />
        </div>
        {error && (
          <p className="mt-3 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" />
            {error}
          </p>
        )}
      </div>
    )
  }

  if (step === 'method' && transferInfo) {
    return (
      <div className="studio-card p-5">
        <button onClick={() => setStep('form')} className="mb-4 text-sm font-semibold text-primary underline">
          ← Volver
        </button>
        <h3 className="text-lg font-semibold text-primary">{product.name}</h3>
        <p className="text-sm text-muted-foreground">{total} sesiones · {formatMoney(product.price, currency)}</p>

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
            onClick={() => void startTransfer()}
            disabled={loading}
          >
            Transferencia bancaria
          </Button>
        </div>

        {error && (
          <p className="mt-3 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" />
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="studio-card p-5">
      <button onClick={onCancel} className="mb-4 text-sm font-semibold text-primary underline">
        ← Volver al catálogo
      </button>
      <h3 className="text-lg font-semibold text-primary">{product.name}</h3>
      <p className="text-sm text-muted-foreground">{total} sesiones · {formatMoney(product.price, currency)}</p>

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

      {error && (
        <p className="mt-3 flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {error}
        </p>
      )}

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
