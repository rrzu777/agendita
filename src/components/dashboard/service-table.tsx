'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ServiceForm } from './service-form'
import { deleteService } from '@/server/actions/services'

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
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Servicios</h2>
        <ServiceForm onSuccess={refresh} />
      </div>
      <div className="bg-white rounded-lg shadow-sm border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Precio</TableHead>
              <TableHead>Duración</TableHead>
              <TableHead>Abono</TableHead>
              <TableHead>Color</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.map((service) => (
              <TableRow key={service.id}>
                <TableCell className="font-medium">
                  <div>{service.name}</div>
                  <div className="text-sm text-gray-500">{service.description}</div>
                </TableCell>
                <TableCell>${service.price.toLocaleString('es-CL')}</TableCell>
                <TableCell>{service.durationMinutes} min</TableCell>
                <TableCell>${service.depositAmount.toLocaleString('es-CL')}</TableCell>
                <TableCell>
                  <div className="w-6 h-6 rounded-full" style={{ backgroundColor: service.pastelColor }} />
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <ServiceForm service={service} onSuccess={refresh} />
                  <Button variant="destructive" size="sm" onClick={() => handleDelete(service.id)}>
                    Eliminar
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
