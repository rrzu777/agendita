'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { UserCheck } from 'lucide-react'
import { getReassignTargets, reassignBooking } from '@/server/actions/bookings'

/**
 * Cambiarle la persona a una cita SIN mover la hora — la operación de un martes
 * cualquiera: alguien avisa que está enfermo y sus citas del día pasan a otra.
 * Bloquear a la persona no alcanza, porque el bloqueo no mueve las citas que ya
 * tiene (spec multi-profesional §Panel).
 *
 * Los candidatos se cargan al abrir, no viajan con el calendario: la lista sólo
 * se mira cuando la dueña aprieta el botón, y quién es elegible para ESTA cita
 * (servicio + modalidad, sin quien ya la atiende) lo decide el servidor con la
 * regla del funnel.
 */
export function ReassignControl({
  bookingId,
  currentName,
  onReassigned,
}: {
  bookingId: string
  /** Quién la atiende hoy; null = sin persona (el botón dice "Asignar"). */
  currentName: string | null
  /** Se llama con la reasignación ya hecha; el caller cierra y refresca. */
  onReassigned?: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // null = todavía cargando: todas las salidas de handleOpen setean la lista,
  // así que "cargando" se deriva en vez de llevarse en un estado aparte.
  const [targets, setTargets] = useState<{ id: string; name: string }[] | null>(null)
  const [targetId, setTargetId] = useState('')

  const loading = open && targets === null
  const hasTargets = !!targets?.length

  async function handleOpen() {
    setOpen(true)
    setError('')
    setTargets(null)
    try {
      const res = await getReassignTargets(bookingId)
      if (!res.ok) {
        setError(res.error)
        setTargets([])
        return
      }
      setTargets(res.data)
      setTargetId(res.data[0]?.id ?? '')
    } catch {
      setError('No se pudieron cargar las opciones')
      setTargets([])
    }
  }

  async function handleConfirm() {
    if (!targetId) return
    setSaving(true)
    setError('')
    try {
      const res = await reassignBooking(bookingId, targetId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      onReassigned?.()
      router.refresh()
    } catch {
      setError('Error al reasignar')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="xs" className="gap-1" onClick={handleOpen}>
        <UserCheck className="size-3.5" />
        {currentName ? 'Reasignar' : 'Asignar'}
      </Button>
    )
  }

  return (
    <div className="w-full space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
      {loading && <p className="text-sm text-muted-foreground">Cargando opciones...</p>}
      {/* Sin elegibles no hay operación posible: decirlo es mejor que un
          selector vacío. Pasa cuando nadie más hace este servicio. */}
      {!loading && !hasTargets && !error && (
        <p className="text-sm text-muted-foreground">
          No hay nadie más que pueda tomar esta cita.
        </p>
      )}
      {hasTargets && (
        <>
          <Label htmlFor="reassign-target">{currentName ? '¿A quién se la pasás?' : '¿Quién la atiende?'}</Label>
          <select
            id="reassign-target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="studio-input w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
            disabled={saving}
          >
            {targets!.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            La hora no se mueve. Se valida que tenga el horario libre.
          </p>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        {hasTargets && (
          <Button type="button" size="xs" onClick={handleConfirm} disabled={saving || !targetId}>
            {saving ? 'Reasignando...' : 'Confirmar'}
          </Button>
        )}
        <Button type="button" variant="ghost" size="xs" onClick={() => setOpen(false)} disabled={saving}>
          Cerrar
        </Button>
      </div>
    </div>
  )
}
