'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
import { ProfessionalForm, type AssignableService } from './professional-form'
import { ProfessionalRowActions, type RowProfessional } from './professional-row-actions'
import { toggleProfessional, deleteProfessional, reorderProfessionals } from '@/server/actions/professionals'
import { useVocabulary } from '@/components/vocabulary-provider'
import { MODALITY_LABELS } from '@/lib/services/modality'
import { ChevronUp, ChevronDown, X, Users } from 'lucide-react'

export function ProfessionalTable({
  professionals: initial,
  services,
}: {
  professionals: RowProfessional[]
  services: AssignableService[]
}) {
  const v = useVocabulary()
  const [professionals, setProfessionals] = useState(initial)
  const [showPaused, setShowPaused] = useState(true)
  const [loadingRow, setLoadingRow] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sorted = [...professionals].sort((a, b) => a.sortOrder - b.sortOrder)
  const activeCount = professionals.filter(p => p.isActive).length
  const pausedCount = professionals.filter(p => !p.isActive).length

  const displayed = showPaused ? sorted : sorted.filter(p => p.isActive)
  const reorderDisabled = !showPaused && pausedCount > 0

  // Copy follows the active-team funnel and the scoped availability editor.
  function switchHint(): string {
    if (activeCount === 0) {
      return 'Sin nadie en agenda, tu negocio funciona con un solo horario para todo y al reservar no se elige con quién.'
    }
    if (activeCount === 1) {
      return 'Con una sola persona en agenda no hay que elegir al reservar: se asigna automáticamente.'
    }
    return `Con ${activeCount} personas en agenda, tus ${v.clients} pueden elegir con quién se atienden.`
  }

  function refresh() {
    window.location.reload()
  }

  async function handleToggle(id: string) {
    setLoadingRow(id)
    setError(null)
    try {
      const res = await toggleProfessional(id)
      if (!res.ok) { setError(res.error); return }
      setProfessionals(professionals.map(p => p.id === id ? { ...p, isActive: res.data.isActive } : p))
    } catch {
      setError('Error al cambiar el estado')
    } finally {
      setLoadingRow(null)
    }
  }

  async function handleDelete(id: string) {
    setLoadingRow(id)
    setError(null)
    try {
      const res = await deleteProfessional(id)
      // El servidor rechaza el borrado de quien tiene reservas y explica por qué; ese
      // mensaje se muestra tal cual, porque es la información útil.
      if (!res.ok) { setError(res.error); return }
      setProfessionals(professionals.filter(p => p.id !== id))
    } catch {
      setError('Error al borrar')
    } finally {
      setLoadingRow(null)
    }
  }

  function handleMoveUp(fullIndex: number) {
    if (fullIndex === 0) return
    doReorder(fullIndex, fullIndex - 1)
  }

  function handleMoveDown(fullIndex: number) {
    if (fullIndex === sorted.length - 1) return
    doReorder(fullIndex, fullIndex + 1)
  }

  async function doReorder(fromIndex: number, toIndex: number) {
    setError(null)
    const reordered = [...sorted]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    const items = reordered.map((p, i) => ({ id: p.id, sortOrder: i }))

    setProfessionals(
      professionals.map(p => {
        const updated = items.find(i => i.id === p.id)
        return updated ? { ...p, sortOrder: updated.sortOrder } : p
      })
    )

    try {
      const res = await reorderProfessionals(items)
      if (!res.ok) { setError(res.error); refresh(); return }
    } catch {
      setError('Error al reordenar')
      refresh()
    }
  }

  // Cuenta sólo los servicios ACTIVOS asignados, porque el denominador
  // (`services`) son los activos. Sin el filtro, alguien con 3 servicios de los
  // cuales 1 se dio de baja, en un negocio con 2 activos, mostraba "3 de 2" — y no
  // es un borde raro: dar de baja un servicio es un soft-delete, así que la
  // asignación vieja sobrevive. Las inactivas igual se conservan al guardar (el
  // formulario devuelve todos los ids, tildados o no).
  function serviceSummary(p: RowProfessional): string {
    const assignedActive = p.serviceIds.filter((id) => services.some((s) => s.id === id)).length
    if (assignedActive === 0) return 'Ninguno'
    if (assignedActive === services.length) return 'Todos'
    return `${assignedActive} de ${services.length}`
  }

  return (
    <div>
      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" aria-label="Cerrar error" onClick={() => setError(null)} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">Tu equipo</h2>
          <p className="max-w-xl text-sm text-muted-foreground">{switchHint()}</p>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">Configura los horarios de cada persona en Disponibilidad.</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {pausedCount > 0 && (
            <div className="flex items-center gap-2">
              <Switch id="show-paused" checked={showPaused} onCheckedChange={setShowPaused} />
              <Label htmlFor="show-paused" className="cursor-pointer text-sm text-muted-foreground">
                Ver en pausa
              </Label>
            </div>
          )}
          <ProfessionalForm services={services} onSuccess={refresh} />
        </div>
      </div>

      {reorderDisabled && (
        <p className="mb-3 text-xs text-muted-foreground">
          Activa &quot;Ver en pausa&quot; para reordenar.
        </p>
      )}

      {displayed.length === 0 ? (
        <div className="studio-card shadow-none overflow-hidden py-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-full bg-muted">
              <Users className="size-7 text-muted-foreground" />
            </div>
            <div>
              <p className="mb-1 text-base font-semibold text-foreground">
                {showPaused ? v.noProfessionals : 'Nadie en agenda'}
              </p>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                {showPaused
                  ? 'Tu agenda funciona con el horario del negocio. Agrega a tu equipo para asignar servicios y horarios por persona.'
                  : 'Todo el equipo está en pausa. Vuelve a poner a alguien en agenda cuando quieras que vuelva a contar.'}
              </p>
            </div>
            {showPaused && (
              <ProfessionalForm services={services} onSuccess={refresh} />
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="studio-card shadow-none hidden overflow-hidden lg:block">
            <Table fixed className={TABLE_MIN_WIDTH}>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className={TABLE_COL.count}>#</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Servicios</TableHead>
                  <TableHead>Dónde atiende</TableHead>
                  <TableHead className={TABLE_COL.status}>Estado</TableHead>
                  <TableHead className={`${TABLE_COL.actions} text-right`}>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map((p) => {
                  const fullIndex = sorted.findIndex(x => x.id === p.id)
                  return (
                    <TableRow key={p.id} className={!p.isActive ? 'opacity-60' : ''}>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex flex-col items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleMoveUp(fullIndex)}
                            disabled={reorderDisabled || fullIndex === 0}
                            className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="Mover arriba"
                          >
                            <ChevronUp className="size-3.5" />
                          </button>
                          <span>{fullIndex + 1}</span>
                          <button
                            type="button"
                            onClick={() => handleMoveDown(fullIndex)}
                            disabled={reorderDisabled || fullIndex === sorted.length - 1}
                            className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="Mover abajo"
                          >
                            <ChevronDown className="size-3.5" />
                          </button>
                        </div>
                      </TableCell>
                      <TruncatedCell
                        className="font-semibold text-foreground"
                        primary={p.name}
                        secondary={p.bio}
                      />
                      <TableCell>{serviceSummary(p)}</TableCell>
                      <TableCell className="whitespace-normal text-sm">
                        {p.modalities.map((m) => MODALITY_LABELS[m]).join(', ')}
                      </TableCell>
                      <TableCell className={TABLE_COL.status}>
                        <StatusBadge map="professional" status={p.isActive ? 'active' : 'inactive'} />
                      </TableCell>
                      <TableCell className={`${TABLE_COL.actions} text-right`}>
                        <ProfessionalRowActions
                          professional={p}
                          services={services}
                          loading={loadingRow === p.id}
                          onToggle={handleToggle}
                          onDelete={handleDelete}
                          onSuccess={refresh}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 lg:hidden">
            {displayed.map((p) => (
              <TableMobileCard
                key={p.id}
                title={p.name}
                subtitle={p.bio}
                badge={<StatusBadge map="professional" status={p.isActive ? 'active' : 'inactive'} />}
                rows={[
                  { label: 'Servicios', value: serviceSummary(p) },
                  { label: 'Dónde atiende', value: p.modalities.map((m) => MODALITY_LABELS[m]).join(', ') },
                ]}
                actions={
                  <>
                  <Button variant="ghost" size="icon" className="size-11" aria-label="Mover arriba" disabled={reorderDisabled || sorted.findIndex(item => item.id === p.id) === 0} onClick={() => handleMoveUp(sorted.findIndex(item => item.id === p.id))}><ChevronUp className="size-4" /></Button>
                  <Button variant="ghost" size="icon" className="size-11" aria-label="Mover abajo" disabled={reorderDisabled || sorted.findIndex(item => item.id === p.id) === sorted.length - 1} onClick={() => handleMoveDown(sorted.findIndex(item => item.id === p.id))}><ChevronDown className="size-4" /></Button>
                  <ProfessionalRowActions
                    professional={p}
                    services={services}
                    loading={loadingRow === p.id}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                    onSuccess={refresh}
                  />
                  </>
                }
                className={!p.isActive ? 'opacity-60' : ''}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
