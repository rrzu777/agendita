'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { upsertPackageProduct, archivePackageProduct } from '@/server/actions/packages'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/money'
import { useVocabulary } from '@/components/vocabulary-provider'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/ui/form-field'
import { useClientFormValidation } from '@/lib/forms/client-validation'

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
  const vocabulary = useVocabulary()
  const router = useRouter()
  const [isPending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<PackageProduct | null>(null)
  const [archiveCandidate, setArchiveCandidate] = useState<PackageProduct | null>(null)
  const { errors: fieldErrors, validate, revalidateField } = useClientFormValidation()
  const archiveTriggerRef = useRef<HTMLButtonElement | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = e.currentTarget
    if (!validate(form)) return
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
        const res = await upsertPackageProduct(data, editing?.id)
        if (!res.ok) {
          setError(res.error)
          return
        }
        form.reset()
        setEditing(null)
        router.refresh()
      } catch {
        setError('Error')
      }
    })
  }

  function onArchive(id: string) {
    start(async () => {
      try {
        const res = await archivePackageProduct(id)
        if (!res.ok) {
          setError(res.error)
          return
        }
        router.refresh()
        setArchiveCandidate(null)
      } catch {
        setError('Error')
      }
    })
  }

  return (
    <section className="studio-card mt-6 p-4">
      <h3 className="text-lg font-semibold text-primary">Catálogo de paquetes</h3>
      <p className="text-sm text-muted-foreground">
        Define los paquetes de sesiones prepagadas que puedes vender a tus {vocabulary.clients}.
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
                className="min-h-11"
                onClick={() => setEditing(p)}
                disabled={isPending}
              >
                Editar
              </Button>
              {p.isActive && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11"
                  onClick={(event) => {
                    archiveTriggerRef.current = event.currentTarget
                    setArchiveCandidate(p)
                  }}
                  disabled={isPending}
                >
                  Desactivar
                </Button>
              )}
            </span>
          </li>
        ))}
        {products.length === 0 && (
          <li className="py-4 text-sm text-muted-foreground">Aún no hay paquetes configurados. Completa el formulario para crear el primero.</li>
        )}
      </ul>

      <form noValidate onSubmit={onSubmit} onInput={revalidateField} className="mt-6 grid gap-4" key={editing?.id ?? 'new'}>
        <FormField id="package-name" label="Nombre del paquete" required error={fieldErrors['package-name']}>
          {(a11y) => <Input {...a11y} id="package-name" name="name" density="form" defaultValue={editing?.name} required />}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="package-quantity" label="Sesiones incluidas" required error={fieldErrors['package-quantity']}>
            {(a11y) => <Input {...a11y} id="package-quantity" name="quantity" density="form" type="number" min={1} defaultValue={editing?.quantity ?? undefined} required />}
          </FormField>
          <FormField id="package-bonus" label="Sesiones adicionales" optional error={fieldErrors['package-bonus']}>
            {(a11y) => <Input {...a11y} id="package-bonus" name="bonusQuantity" density="form" type="number" min={0} defaultValue={editing?.bonusQuantity ?? undefined} />}
          </FormField>
          <FormField id="package-price" label={`Precio (${currency})`} required error={fieldErrors['package-price']}>
            {(a11y) => <Input {...a11y} id="package-price" name="price" density="form" type="number" min={0} defaultValue={editing?.price ?? undefined} required />}
          </FormField>
          <FormField id="package-expiry" label="Vigencia en días" optional help="Si queda vacío, el paquete no vence." error={fieldErrors['package-expiry']}>
            {(a11y) => <Input {...a11y} id="package-expiry" name="expiryDays" density="form" type="number" min={1} defaultValue={editing?.expiryDays ?? undefined} />}
          </FormField>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm">
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
                <label key={s.id} className="flex min-h-11 items-center gap-3">
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
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={editing?.isActive ?? true}
            className="size-4"
          />
          Activo
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" className="min-h-11" disabled={isPending}>
            {editing ? 'Guardar' : 'Crear paquete'}
          </Button>
          {editing && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-11"
              onClick={() => setEditing(null)}
            >
              Cancelar
            </Button>
          )}
        </div>
      </form>

      <Dialog open={archiveCandidate !== null} onOpenChange={(open) => { if (!open && !isPending) setArchiveCandidate(null) }}>
        <DialogContent
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            archiveTriggerRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Desactivar {archiveCandidate?.name}</DialogTitle>
            <DialogDescription>El paquete dejará de ofrecerse para nuevas compras. Las compras existentes no se modifican.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button size="form" variant="outline" className="min-h-11" disabled={isPending} onClick={() => window.setTimeout(() => archiveTriggerRef.current?.focus(), 0)}>Conservar paquete</Button></DialogClose>
            <Button size="form" variant="destructive" className="min-h-11" disabled={isPending || !archiveCandidate} onClick={() => archiveCandidate && onArchive(archiveCandidate.id)}>
              {isPending ? 'Desactivando…' : 'Desactivar paquete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
