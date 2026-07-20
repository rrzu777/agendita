'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { deleteTimeBlock } from '@/server/actions/time-blocks'
import { Ban, Trash2 } from 'lucide-react'

export function TimeBlockList({ blocks: initialBlocks }: { blocks: { id: string; startDateTime: Date | string; endDateTime: Date | string; reason: string | null }[] }) {
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())
  const blocks = initialBlocks.filter((block) => !deletedIds.has(block.id))

  async function handleDelete(id: string) {
    const res = await deleteTimeBlock(id)
    if (!res.ok) return
    setDeletedIds((current) => new Set(current).add(id))
  }

  if (blocks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
          <svg className="size-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">No hay horarios bloqueados. Usa bloqueos para indicar días de vacaciones o cuando no puedas atender.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {blocks.map((block) => (
        <div key={block.id} className="flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-1 flex size-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <Ban className="size-4" />
            </div>
            <div>
            <div className="font-semibold text-primary">
              {new Date(block.startDateTime).toLocaleDateString('es-CL')} {new Date(block.startDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} - {new Date(block.endDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
            </div>
            {block.reason && <div className="text-sm text-muted-foreground">{block.reason}</div>}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(block.id)} aria-label="Eliminar bloqueo">
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  )
}
