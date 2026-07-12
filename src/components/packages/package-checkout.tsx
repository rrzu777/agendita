'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/money'
import { AlertCircle, Loader2 } from 'lucide-react'
import { createPackagePurchase, initiatePackagePayment } from '@/server/actions/packages-checkout'
import type { CatalogProduct } from './package-catalog'

interface PackageCheckoutProps {
  product: CatalogProduct
  currency: string
  prefill: { email: string | null; name: string; phone: string; hasCustomer: boolean }
  onCancel: () => void
}

export function PackageCheckout({ product, currency, prefill, onCancel }: PackageCheckoutProps) {
  const [name, setName] = useState(prefill.name)
  const [phone, setPhone] = useState(prefill.phone)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const total = product.quantity + product.bonusQuantity

  async function handleBuy() {
    setError('')
    if (!name.trim()) {
      setError('Ingresá tu nombre')
      return
    }
    if (!phone.trim()) {
      setError('Ingresá tu teléfono')
      return
    }
    if (!acceptedTerms) {
      setError('Debes aceptar los términos')
      return
    }

    setLoading(true)
    try {
      const { purchaseId } = await createPackagePurchase({
        packageProductId: product.id,
        name: name.trim(),
        phone: phone.trim(),
        acceptedTerms: true,
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

      <Button className="mt-4 h-12 w-full rounded-full" onClick={handleBuy} disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Procesando…
          </>
        ) : (
          `Pagar ${formatMoney(product.price, currency)}`
        )}
      </Button>
    </div>
  )
}
