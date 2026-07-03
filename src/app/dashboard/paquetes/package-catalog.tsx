'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { upsertPackageProduct, archivePackageProduct } from '@/server/actions/packages'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/money'

type Service = { id: string; name: string; price: number }
type PackageProduct = {
  id: string
  name: string
  quantity: number
  bonusQuantity: number
  price: number
  expiryDays: number | null
  appliesToAll: boolean
  isActive: boolean
  services: { id: string; name: string }[]
}

/** Lee un campo numérico opcional del form: vacío/ausente => null. */
const optNum = (v: FormDataEntryValue | null): number | null => (v ? Number(v) : null)

function coverageSummary(p: PackageProduct): string {
  if (p.appliesToAll) return 'Todos los servicios'
  if (p.services.length === 0) return 'Sin servicios'
  return p.services.map((s) => s.name).join(', ')
}

export function PackageCatalog({
  products,
  services,
  currency,
}: {
  products: PackageProduct[]
  services: Service[]
  currency: string
}) {
  const router = useRouter()
  const [isPending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<PackageProduct | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = e.currentTarget
    const fd = new FormData(form)
    const appliesToAll = fd.get('appliesToAll') === 'on'
    const data = {
      name: String(fd.get('name') ?? ''),
      quantity: Number(fd.get('quantity') ?? 0),
      bonusQuantity: Number(fd.get('bonusQuantity') ?? 0),
      price: Number(fd.get('price') ?? 0),
      expiryDays: optNum(fd.get('expiryDays')),
      appliesToAll,
      serviceIds: appliesToAll
        ? []
        : services.filter((s) => fd.get(`svc_${s.id}`) === 'on').map((s) => s.id),
      isActive: fd.get('isActive') === 'on',
    }
    start(async () => {
      try {
        await upsertPackageProduct(data, editing?.id)
        form.reset()
        setEditing(null)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  function onArchive(id: string) {
    if (!window.confirm('¿Desactivar este paquete?')) return
    start(async () => {
      try {
        await archivePackageProduct(id)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <section className="studio-card mt-6 p-4">
      <h3 className="text-lg font-semibold text-primary">Catálogo de paquetes</h3>
      <p className="text-sm text-muted-foreground">
        Definí los paquetes de sesiones prepagadas que podés vender a tus clientas.
      </p>

      <ul className="mt-4 divide-y divide-border">
        {products.map((p) => (
          <li key={p.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              <span className="font-medium">{p.name}</span>{' '}
              <span className="text-muted-foreground">
                · {p.quantity}
                {p.bonusQuantity > 0 ? ` + ${p.bonusQuantity} bonus` : ''} sesiones ·{' '}
                {formatMoney(p.price, currency)}
                {p.expiryDays ? ` · vence en ${p.expiryDays} días` : ''} · {coverageSummary(p)}
              </span>
              {!p.isActive && (
                <span className="ml-2 text-xs text-muted-foreground">(inactivo)</span>
              )}
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(p)}
                disabled={isPending}
              >
                Editar
              </Button>
              {p.isActive && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onArchive(p.id)}
                  disabled={isPending}
                >
                  Desactivar
                </Button>
              )}
            </span>
          </li>
        ))}
        {products.length === 0 && (
          <li className="py-2 text-sm text-muted-foreground">Todavía no hay paquetes.</li>
        )}
      </ul>

      <form onSubmit={onSubmit} className="mt-4 grid gap-2" key={editing?.id ?? 'new'}>
        <Input
          name="name"
          placeholder="Nombre del paquete"
          defaultValue={editing?.name}
          required
        />
        <div className="flex flex-wrap gap-2">
          <Input
            name="quantity"
            type="number"
            min={1}
            placeholder="Cantidad"
            defaultValue={editing?.quantity ?? undefined}
            required
            className="w-32"
          />
          <Input
            name="bonusQuantity"
            type="number"
            min={0}
            placeholder="Bonus (opc.)"
            defaultValue={editing?.bonusQuantity ?? undefined}
            className="w-32"
          />
          <Input
            name="price"
            type="number"
            min={0}
            placeholder="Precio"
            defaultValue={editing?.price ?? undefined}
            required
            className="w-32"
          />
          <Input
            name="expiryDays"
            type="number"
            min={1}
            placeholder="Días vencimiento (opc.)"
            defaultValue={editing?.expiryDays ?? undefined}
            className="w-44"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="appliesToAll"
            defaultChecked={editing?.appliesToAll ?? true}
            className="size-4"
          />
          Aplica a todos los servicios
        </label>
        {services.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Servicios específicos
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {services.map((s) => (
                <label key={s.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name={`svc_${s.id}`}
                    defaultChecked={editing?.services.some((es) => es.id === s.id)}
                    className="size-4"
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </details>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={editing?.isActive ?? true}
            className="size-4"
          />
          Activo
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {editing ? 'Guardar' : 'Crear paquete'}
          </Button>
          {editing && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(null)}
            >
              Cancelar
            </Button>
          )}
        </div>
      </form>
    </section>
  )
}
