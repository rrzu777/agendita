'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ServiceForm } from './service-form'
import { toggleService, reorderServices } from '@/server/actions/services'
import { Plus, EyeOff, Eye, ChevronUp, ChevronDown, AlertTriangle, X } from 'lucide-react'

export function ServiceTable({ services: initialServices }: { services: { id: string; name: string; description: string | null; durationMinutes: number; price: number; depositAmount: number; pastelColor: string; isActive: boolean; sortOrder: number }[] }) {
  const [services, setServices] = useState(initialServices)
  const [showInactive, setShowInactive] = useState(true)
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)
  const [loadingRow, setLoadingRow] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sorted = [...services].sort((a, b) => a.sortOrder - b.sortOrder)
  const activeCount = services.filter(s => s.isActive).length
  const inactiveCount = services.filter(s => !s.isActive).length

  const displayedServices = showInactive ? sorted : sorted.filter(s => s.isActive)
  const reorderDisabled = !showInactive && inactiveCount > 0

  function refresh() {
    window.location.reload()
  }

  async function handleToggle(serviceId: string) {
    setLoadingRow(serviceId)
    setError(null)
    try {
      const updated = await toggleService(serviceId)
      setServices(services.map(s => s.id === serviceId ? { ...s, isActive: updated.isActive } : s))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cambiar el estado del servicio')
    } finally {
      setLoadingRow(null)
    }
  }

  async function handleDeactivate(serviceId: string) {
    setLoadingRow(serviceId)
    setError(null)
    try {
      await toggleService(serviceId)
      setServices(services.map(s => s.id === serviceId ? { ...s, isActive: false } : s))
      setDeactivatingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al desactivar el servicio')
    } finally {
      setLoadingRow(null)
      setDeactivatingId(null)
    }
  }

  async function handleMoveUp(fullIndex: number) {
    if (fullIndex === 0) return
    doReorder(fullIndex, fullIndex - 1)
  }

  async function handleMoveDown(fullIndex: number) {
    if (fullIndex === sorted.length - 1) return
    doReorder(fullIndex, fullIndex + 1)
  }

  async function doReorder(fromIndex: number, toIndex: number) {
    setError(null)
    const reordered = [...sorted]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    const items = reordered.map((s, i) => ({ id: s.id, sortOrder: i }))

    setServices(
      services.map(s => {
        const updated = items.find(i => i.id === s.id)
        return updated ? { ...s, sortOrder: updated.sortOrder } : s
      })
    )

    try {
      await reorderServices(items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al reordenar servicios')
      refresh()
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0 text-destructive/70 hover:text-destructive">
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-normal text-primary">Catálogo de servicios</h2>
          <p className="text-sm text-muted-foreground">
            {activeCount} activo{activeCount !== 1 ? 's' : ''}
            {inactiveCount > 0 && `, ${inactiveCount} inactivo${inactiveCount !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {inactiveCount > 0 && (
            <div className="flex items-center gap-2">
              <Switch
                id="show-inactive"
                checked={showInactive}
                onCheckedChange={setShowInactive}
              />
              <Label htmlFor="show-inactive" className="text-sm text-muted-foreground cursor-pointer">
                Ver inactivos
              </Label>
            </div>
          )}
          <ServiceForm onSuccess={refresh} triggerLabel="Nuevo servicio" triggerIcon={<Plus className="mr-2 size-4" />} />
        </div>
      </div>

      {reorderDisabled && (
        <p className="mb-3 text-xs text-muted-foreground">
          Activa &quot;Ver inactivos&quot; para reordenar servicios.
        </p>
      )}

      <div className="studio-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>#</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Precio</TableHead>
              <TableHead>Duración</TableHead>
              <TableHead>Abono</TableHead>
              <TableHead>Color</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedServices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex size-14 items-center justify-center rounded-full bg-muted">
                      <svg className="size-7 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                      </svg>
                    </div>
                    <div>
                      <p className="mb-1 text-base font-semibold text-primary">
                        {showInactive ? 'No tienes servicios todavía' : 'No hay servicios activos'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Crea tu primer servicio para que las clientas puedan reservar.
                      </p>
                    </div>
                    <ServiceForm
                      onSuccess={refresh}
                      triggerLabel="Crear mi primer servicio"
                      triggerIcon={<Plus className="mr-2 size-4" />}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ) : displayedServices.map((service) => {
              const fullIndex = sorted.findIndex(s => s.id === service.id)
              return (
                <TableRow key={service.id} className={!service.isActive ? 'opacity-60' : ''}>
                  <TableCell className="text-muted-foreground text-sm w-12">
                    <div className="flex flex-col items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleMoveUp(fullIndex)}
                        disabled={reorderDisabled || fullIndex === 0}
                        className="text-muted-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Mover arriba"
                      >
                        <ChevronUp className="size-3.5" />
                      </button>
                      <span>{fullIndex + 1}</span>
                      <button
                        type="button"
                        onClick={() => handleMoveDown(fullIndex)}
                        disabled={reorderDisabled || fullIndex === sorted.length - 1}
                        className="text-muted-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Mover abajo"
                      >
                        <ChevronDown className="size-3.5" />
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="font-semibold text-primary">
                    <div>{service.name}</div>
                    <div className="max-w-md text-sm font-normal text-muted-foreground">{service.description}</div>
                  </TableCell>
                  <TableCell className="font-semibold">${service.price.toLocaleString('es-CL')}</TableCell>
                  <TableCell>{service.durationMinutes} min</TableCell>
                  <TableCell>${service.depositAmount.toLocaleString('es-CL')}</TableCell>
                  <TableCell>
                    <div className="size-7 rounded-full border border-border" style={{ backgroundColor: service.pastelColor }} />
                  </TableCell>
                  <TableCell>
                    {service.isActive
                      ? <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700 text-xs">Activo</Badge>
                      : <Badge variant="outline" className="border-muted-foreground/30 bg-muted/50 text-muted-foreground text-xs">Inactivo</Badge>
                    }
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <ServiceForm service={service} onSuccess={refresh} />
                    {service.isActive ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeactivatingId(service.id)}
                        disabled={loadingRow === service.id}
                        aria-label={`Desactivar ${service.name}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <EyeOff className="size-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggle(service.id)}
                        disabled={loadingRow === service.id}
                        aria-label={`Activar ${service.name}`}
                        className="text-muted-foreground hover:text-green-600"
                      >
                        <Eye className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!deactivatingId} onOpenChange={(v) => { if (!v) setDeactivatingId(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary">
              <AlertTriangle className="size-5 text-amber-500" />
              Desactivar servicio
            </DialogTitle>
            <DialogDescription className="text-base pt-2">
              Desactivar este servicio oculta el servicio para nuevas reservas, pero no borra reservas antiguas.
              Siempre puedes volver a activarlo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeactivatingId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deactivatingId && handleDeactivate(deactivatingId)}
              disabled={!deactivatingId || loadingRow === deactivatingId}
            >
              {loadingRow === deactivatingId ? 'Desactivando...' : 'Desactivar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
