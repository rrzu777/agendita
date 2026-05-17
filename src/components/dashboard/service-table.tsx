'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ServiceForm } from './service-form'
import { deleteService } from '@/server/actions/services'
import { Plus, Trash2 } from 'lucide-react'

export function ServiceTable({ services: initialServices }: { services: any[] }) {
  const [services, setServices] = useState(initialServices)

  async function handleDelete(id: string) {
    if (!confirm('¿Estás segura de eliminar este servicio?')) return
    await deleteService(id)
    setServices(services.filter(s => s.id !== id))
  }

  function refresh() {
    window.location.reload()
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-normal text-primary">Catálogo de servicios</h2>
          <p className="text-sm text-muted-foreground">{services.length} servicios activos</p>
        </div>
        <ServiceForm onSuccess={refresh} triggerLabel="Nuevo servicio" triggerIcon={<Plus className="mr-2 size-4" />} />
      </div>
      <div className="studio-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Nombre</TableHead>
              <TableHead>Precio</TableHead>
              <TableHead>Duración</TableHead>
              <TableHead>Abono</TableHead>
              <TableHead>Color</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  No hay servicios activos todavía
                </TableCell>
              </TableRow>
            ) : services.map((service) => (
              <TableRow key={service.id}>
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
                <TableCell className="space-x-2 text-right">
                  <ServiceForm service={service} onSuccess={refresh} />
                  <Button variant="destructive" size="sm" onClick={() => handleDelete(service.id)} aria-label={`Eliminar ${service.name}`}>
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
