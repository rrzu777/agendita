'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import type { PackageCheckoutPrefill } from '@/server/actions/packages-checkout'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'
import { PackageCheckout } from './package-checkout'

export interface CatalogProduct {
  id: string
  name: string
  quantity: number
  bonusQuantity: number
  price: number
  expiryDays: number | null
  appliesToAll: boolean
  serviceNames: string[]
}

interface PackageCatalogProps {
  slug: string
  currency: string
  products: CatalogProduct[]
  onlineAvailable: boolean
  onlineReason: string | null
  isLoggedIn: boolean
  prefill: PackageCheckoutPrefill | null
  /** Producto a preseleccionar (retorno de /ingresar?next=...&comprar=ID tras loguearse). */
  preselectedProductId?: string
  transferInfo: BankTransferPublicInfo | null
}

export function PackageCatalog({ slug, currency, products, onlineAvailable, onlineReason, isLoggedIn, prefill, preselectedProductId, transferInfo }: PackageCatalogProps) {
  const [selected, setSelected] = useState<CatalogProduct | null>(() =>
    preselectedProductId ? products.find((p) => p.id === preselectedProductId) ?? null : null
  )
  const checkoutAvailable = onlineAvailable || transferInfo !== null

  if (products.length === 0) {
    return <p className="text-center text-muted-foreground">Este negocio todavía no publicó paquetes.</p>
  }

  // El checkout está disponible si existe al menos un método real. Mercado Pago
  // y transferencia tienen guards server-side independientes.
  if (selected && isLoggedIn && prefill && checkoutAvailable) {
    return (
      <PackageCheckout
        product={selected}
        currency={currency}
        prefill={prefill}
        onCancel={() => setSelected(null)}
        transferInfo={transferInfo}
        onlineAvailable={onlineAvailable}
      />
    )
  }

  const loginHref = (productId: string) =>
    `/ingresar?next=${encodeURIComponent(`/paquetes/${slug}?comprar=${productId}`)}`

  return (
    <div className="grid gap-4">
      {!checkoutAvailable && (
        <p className="rounded-lg border border-border/60 bg-muted/40 p-3 text-sm text-muted-foreground">
          {onlineReason || 'Este negocio coordina el pago directamente.'}
        </p>
      )}
      {products.map((p) => {
        const total = p.quantity + p.bonusQuantity
        return (
          <div key={p.id} className="rounded-[var(--radius)] border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-primary">{p.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {total} sesiones{p.bonusQuantity > 0 ? ` (${p.quantity} + ${p.bonusQuantity} bonus)` : ''}
                </p>
                {p.expiryDays && <p className="text-xs text-muted-foreground">Vence a los {p.expiryDays} días</p>}
                {(p.appliesToAll || p.serviceNames.length > 0) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.appliesToAll ? 'Aplica a todos los servicios' : `Aplica a: ${p.serviceNames.join(', ')}`}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold text-primary">{formatMoney(p.price, currency)}</p>
              </div>
            </div>
            <div className="mt-4">
              {!checkoutAvailable ? (
                <Button disabled size="touch" className="w-full rounded-xl">No disponible online</Button>
              ) : isLoggedIn ? (
                <Button size="touch" className="w-full rounded-xl" onClick={() => setSelected(p)}>Comprar</Button>
              ) : (
                <Button asChild size="touch" className="w-full rounded-xl">
                  <Link href={loginHref(p.id)}>Ingresar para comprar</Link>
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
