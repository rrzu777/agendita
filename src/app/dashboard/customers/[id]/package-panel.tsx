'use client'

import { useState, useTransition } from 'react'
import { sellPackage, refundPackagePurchase } from '@/server/actions/packages'
import { formatMoney } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

type PackagePurchaseItem = {
  id: string
  pricePaid: number
  quantity: number
  bonusQuantity: number
  status: string
  expiresAt: Date | null
  paymentMethod: string | null
  createdAt: Date
  product: { name: string }
  _count: { grants: number }
}

type PackageProductOption = {
  id: string
  name: string
  price: number
}

export function PackagePanel({
  customerId,
  packages,
  products,
  currency,
}: {
  customerId: string
  packages: PackagePurchaseItem[]
  products: PackageProductOption[]
  currency: string
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [productId, setProductId] = useState('')
  const [method, setMethod] = useState('')

  function onSell(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!productId) return
    const requestId = crypto.randomUUID()
    const metodo = method.trim()
    startTransition(async () => {
      try {
        await sellPackage({
          packageProductId: productId,
          customerId,
          paymentMethod: metodo || undefined,
          requestId,
        })
        setProductId('')
        setMethod('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  function onRefund(id: string) {
    setError(null)
    if (!confirm('¿Reembolsar este paquete? Se cancelarán las sesiones restantes.')) return
    startTransition(async () => {
      try {
        await refundPackagePurchase(id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <div className="studio-card p-4">
      <h3 className="text-lg font-semibold text-primary">Paquetes</h3>

      {packages.length > 0 && (
        <ul className="mt-3 space-y-2">
          {packages.map((p) => (
            <li key={p.id} className="rounded-lg border border-border/60 p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-primary">{p.product.name}</p>
                  <p className="text-muted-foreground">
                    {p._count.grants} sesiones restantes · {formatMoney(p.pricePaid, currency)}
                  </p>
                  {p.expiresAt && (
                    <p className="text-xs text-muted-foreground">
                      vence {new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' }).format(new Date(p.expiresAt))}
                    </p>
                  )}
                </div>
                <Badge className={p.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}>
                  {p.status === 'active' ? 'Activo' : p.status === 'refunded' ? 'Reembolsado' : p.status}
                </Badge>
              </div>
              {p.status === 'active' && p._count.grants > 0 && (
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => onRefund(p.id)}
                  >
                    Reembolsar
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {products.length > 0 && (
        <form onSubmit={onSell} className="mt-4 space-y-2 border-t border-border/60 pt-4">
          <h4 className="text-sm font-semibold text-primary">Vender paquete</h4>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="studio-input w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="">Selecciona un paquete</option>
            {products.map((prod) => (
              <option key={prod.id} value={prod.id}>
                {prod.name} — {formatMoney(prod.price, currency)}
              </option>
            ))}
          </select>
          <Input
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="Método de pago (opcional)"
            className="h-10"
          />
          <Button type="submit" size="sm" disabled={isPending || !productId}>
            Vender
          </Button>
        </form>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
