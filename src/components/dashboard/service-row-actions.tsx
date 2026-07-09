'use client'

import { useState } from 'react'
import { Eye, EyeOff, AlertTriangle } from 'lucide-react'
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
import { ServiceForm } from './service-form'

type RowService = {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  price: number
  depositAmount: number
  pastelColor: string
  isActive: boolean
  sortOrder: number
}

function DeactivateServiceDialog({
  service,
  loading,
  open,
  onOpenChange,
  onConfirm,
}: {
  service: RowService
  loading: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-primary">
            <AlertTriangle className="size-5 text-amber-500" />
            Desactivar servicio
          </DialogTitle>
          <DialogDescription className="text-base pt-2">
            Desactivar &quot;{service.name}&quot; oculta el servicio para nuevas reservas, pero no borra reservas antiguas.
            Siempre puedes volver a activarlo.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? 'Desactivando...' : 'Desactivar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ServiceRowActions({
  service,
  loading,
  onToggle,
  onDeactivate,
  onSuccess,
}: {
  service: RowService
  loading: boolean
  onToggle: (serviceId: string) => void
  onDeactivate: (serviceId: string) => void
  onSuccess: () => void
}) {
  const [deactivateOpen, setDeactivateOpen] = useState(false)

  return (
    <>
      <TableActions primary={<ServiceForm service={service} onSuccess={onSuccess} />}>
        {service.isActive ? (
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); setDeactivateOpen(true) }}
          >
            <EyeOff className="size-4" /> Desactivar
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); onToggle(service.id) }}
          >
            <Eye className="size-4" /> Activar
          </DropdownMenuItem>
        )}
      </TableActions>

      <DeactivateServiceDialog
        service={service}
        loading={loading}
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        onConfirm={() => {
          onDeactivate(service.id)
          setDeactivateOpen(false)
        }}
      />
    </>
  )
}
