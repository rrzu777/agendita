'use client'

import { useState } from 'react'
import { Eye, EyeOff, AlertTriangle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TableActions } from '@/components/ui/table-actions'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { ProfessionalForm, type AssignableService, type FormProfessional } from './professional-form'
import { useVocabulary } from '@/components/vocabulary-provider'

export type RowProfessional = FormProfessional & {
  isActive: boolean
  sortOrder: number
}

export function ProfessionalRowActions({
  professional,
  services,
  loading,
  onToggle,
  onDelete,
  onSuccess,
}: {
  professional: RowProfessional
  services: AssignableService[]
  loading: boolean
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onSuccess: () => void
}) {
  const v = useVocabulary()
  const [pauseOpen, setPauseOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <>
      <TableActions
        primary={
          <ProfessionalForm professional={professional} services={services} onSuccess={onSuccess} />
        }
      >
        {professional.isActive ? (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setPauseOpen(true) }}>
            <EyeOff className="size-4" /> Poner en pausa
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onToggle(professional.id) }}>
            <Eye className="size-4" /> Volver a la agenda
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setDeleteOpen(true) }}>
          <Trash2 className="size-4" /> Borrar
        </DropdownMenuItem>
      </TableActions>

      <Dialog open={pauseOpen} onOpenChange={setPauseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary">
              <AlertTriangle className="size-5 text-amber-500" />
              Poner en pausa
            </DialogTitle>
            <DialogDescription className="pt-2 text-base">
              {professional.name} sale de la agenda: nadie va a poder reservar con esta
              persona. Sus citas ya tomadas quedan intactas — la pausa no las mueve, y
              para pasarlas a otra persona hay que reasignarlas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPauseOpen(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={loading}
              onClick={() => { onToggle(professional.id); setPauseOpen(false) }}
            >
              {loading ? 'Guardando...' : 'Poner en pausa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary">
              <AlertTriangle className="size-5 text-destructive" />
              Borrar del equipo
            </DialogTitle>
            {/* El borrado sólo pasa si nunca atendió. Con reservas a su nombre el
                servidor lo rechaza y explica que se pone en pausa: la tabla no carga
                el conteo de reservas en cada lectura, así que la aclaración va acá y
                el mensaje del servidor es el que educa si igual se intenta. */}
            <DialogDescription className="pt-2 text-base">
              Se borra a {professional.name} junto con su horario y sus bloqueos. Sólo
              funciona si nunca atendió: con reservas a su nombre no se puede borrar, y
              lo que corresponde es la pausa, que conserva esas citas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={loading}
              onClick={() => { onDelete(professional.id); setDeleteOpen(false) }}
            >
              {loading ? 'Borrando...' : `Borrar ${v.professional}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
