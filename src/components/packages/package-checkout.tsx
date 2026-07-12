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

  async function startMp() {
    setError('')
    setLoading(true)
    try {
      const { purchaseId } = await createPackagePurchase({
        packageProductId: product.id,
        name: name.trim(),
        phone: phone.trim(),
        acceptedTerms: true,
        method: 'mp',
      })
      const res = await initiatePackagePayment({ purchaseId })
      if ('redirectUrl' in res) {
        window.location.href = res.redirectUrl
        return
      }
      window.location.href = `/paquetes/confirmation?purchaseId=${purchaseId}`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar la compra')
      setLoading(false)
    }
  }

  async function startTransfer() {
    setError('')
    setLoading(true)
    try {
      const { purchaseId } = await createPackagePurchase({
        packageProductId: product.id,
        name: name.trim(),
        phone: phone.trim(),
        acceptedTerms: true,
        method: 'transfer',
      })
      setPurchaseId(purchaseId)
      setStep('transfer')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar la compra')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeclare() {
    if (!purchaseId) return
    setError('')
    setLoading(true)
    try {
      await declarePackageTransfer({ purchaseId })
      router.push(`/paquetes/confirmation?purchaseId=${purchaseId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al declarar la transferencia')
      setLoading(false)
    }
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

// Vista de instrucciones de transferencia para paquetes. NO reutiliza
// @/components/booking/transfer-details (TransferDetails): esa está acoplada
// a reservas (su upload de comprobante llama createProofUploadUrl(bookingId,
// ...)), y declarePackageTransfer es deliberadamente sin comprobante. Una
// vista separada y más simple es la decisión correcta acá.
export function PackageTransferInstructions({
  transferInfo, amount, currency, declaring, onDeclare,
}: {
  transferInfo: BankTransferPublicInfo
  amount: number
  currency: string
  declaring: boolean
  onDeclare: () => void
}) {
  const rows: Array<[string, string]> = [
    ['Titular', transferInfo.accountHolder],
    ['RUT', transferInfo.rut],
    ['Banco', transferInfo.bankName],
    ['Tipo de cuenta', transferInfo.accountType],
    ['Número de cuenta', transferInfo.accountNumber],
  ]
  if (transferInfo.email) rows.push(['Email', transferInfo.email])
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-muted/55 p-5">
        <p className="mb-3 text-sm text-muted-foreground">
          Transferí <span className="font-semibold text-primary">{formatMoney(amount, currency)}</span> a esta cuenta:
        </p>
        <div className="space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-semibold text-primary">{value}</span>
            </div>
          ))}
        </div>
        {transferInfo.instructions && (
          <p className="mt-3 rounded-lg bg-background/70 p-3 text-sm text-muted-foreground">{transferInfo.instructions}</p>
        )}
      </div>
      <Button className="h-12 w-full rounded-full text-base font-semibold" onClick={onDeclare} disabled={declaring}>
        {declaring ? 'Avisando…' : 'Ya transferí'}
      </Button>
    </div>
  )
}
