'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
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
  prefill: { email: string | null; name: string; phone: string; hasCustomer: boolean } | null
  /** Producto a preseleccionar (retorno de /ingresar?next=...&comprar=ID tras loguearse). */
  preselectedProductId?: string
}

export function PackageCatalog({ slug, currency, products, onlineAvailable, onlineReason, isLoggedIn, prefill, preselectedProductId }: PackageCatalogProps) {
  const [selected, setSelected] = useState<CatalogProduct | null>(() =>
    preselectedProductId ? products.find((p) => p.id === preselectedProductId) ?? null : null
  )

  if (products.length === 0) {
    return <p className="text-center text-muted-foreground">Este negocio todavía no publicó paquetes.</p>
  }

  if (selected && isLoggedIn && prefill) {
    return (
      <PackageCheckout
        product={selected}
        currency={currency}
        prefill={prefill}
        onCancel={() => setSelected(null)}
      />
    )
  }

  const loginHref = (productId: string) =>
    `/ingresar?next=${encodeURIComponent(`/paquetes/${slug}?comprar=${productId}`)}`

  return (
    <div className="grid gap-4">
      {!onlineAvailable && (
        <p className="rounded-lg border border-border/60 bg-muted/40 p-3 text-sm text-muted-foreground">
          {onlineReason || 'Este negocio coordina el pago directamente.'}
        </p>
      )}
      {products.map((p) => {
        const total = p.quantity + p.bonusQuantity
        return (
          <div key={p.id} className="studio-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-primary">{p.name}</h3>
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
              {!onlineAvailable ? (
                <Button disabled className="w-full rounded-full">No disponible online</Button>
              ) : isLoggedIn ? (
                <Button className="w-full rounded-full" onClick={() => setSelected(p)}>Comprar</Button>
              ) : (
                <Button asChild className="w-full rounded-full">
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
