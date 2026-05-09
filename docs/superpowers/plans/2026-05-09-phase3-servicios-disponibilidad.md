# Phase 3: Servicios y Disponibilidad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the services management CRUD, availability rules editor, time block manager, slot generator, and a calendar view for bookings. The manicurist can manage her services, set working hours, block time off, and see her schedule in a calendar.

**Architecture:** Dashboard pages use Server Actions for CRUD operations. For now (no DB), actions update mock data in memory. When DB is connected, swap mock for Prisma queries. Slot generation is a pure function that takes availability rules, time blocks, and existing bookings to produce available time slots.

**Tech Stack:** Next.js Server Actions, shadcn/ui (forms, tables, calendar, dialogs), date-fns for date manipulation.

---

## Context: No Database Yet

Since Supabase credentials are not available:
- Use **in-memory mock data module** that can be mutated by Server Actions
- All CRUD operations work on mock data
- When DB is connected, replace mock module with Prisma queries
- Slot generator is a pure function (no DB needed for logic)

---

## File Structure

```
src/
  app/
    dashboard/
      services/
        page.tsx              # Services CRUD page
      availability/
        page.tsx              # Availability rules editor
      calendar/
        page.tsx              # Calendar view
  components/
    dashboard/
      service-form.tsx        # Create/edit service form
      service-table.tsx       # Services list table
      availability-editor.tsx # Weekly schedule editor
      time-block-form.tsx     # Block time off form
      calendar-view.tsx       # Calendar component
  lib/
    data/
      mock-store.ts           # Mutable mock data store
    availability/
      slots.ts                # Slot generation logic
  server/
    actions/
      services.ts             # Service CRUD actions
      availability.ts         # Availability actions
      time-blocks.ts          # Time block actions
```

---

## Mock Data Store

Create a mutable store that Server Actions can modify. Since Server Actions run server-side, we can use a module-level variable.

```typescript
// src/lib/data/mock-store.ts
import { mockBusiness } from './mock-business'

export type Service = {
  id: string
  businessId: string
  name: string
  description: string | null
  durationMinutes: number
  price: number
  depositAmount: number
  pastelColor: string
  isActive: boolean
  sortOrder: number
}

export type AvailabilityRule = {
  id: string
  businessId: string
  dayOfWeek: number  // 0=Sunday, 1=Monday, ...
  startTime: string  // "HH:mm"
  endTime: string    // "HH:mm"
  isActive: boolean
}

export type TimeBlock = {
  id: string
  businessId: string
  startDateTime: Date
  endDateTime: Date
  reason: string | null
}

// Mutable store
export const store = {
  services: mockBusiness.services.map((s, i) => ({ ...s, sortOrder: i })) as Service[],
  availabilityRules: [
    { id: 'ar-1', businessId: 'mock-business-1', dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
    { id: 'ar-2', businessId: 'mock-business-1', dayOfWeek: 2, startTime: '09:00', endTime: '18:00', isActive: true },
    { id: 'ar-3', businessId: 'mock-business-1', dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true },
    { id: 'ar-4', businessId: 'mock-business-1', dayOfWeek: 4, startTime: '09:00', endTime: '18:00', isActive: true },
    { id: 'ar-5', businessId: 'mock-business-1', dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true },
    { id: 'ar-6', businessId: 'mock-business-1', dayOfWeek: 6, startTime: '10:00', endTime: '15:00', isActive: true },
  ] as AvailabilityRule[],
  timeBlocks: [] as TimeBlock[],
  bookings: [] as any[],
}
```

---

## Task 1: Create Mock Store and Service Actions

**Files:**
- Create: `src/lib/data/mock-store.ts`
- Create: `src/server/actions/services.ts`

- [ ] **Step 1: Create mock store**

Create `src/lib/data/mock-store.ts` with the content shown above.

- [ ] **Step 2: Create service actions**

Create `src/server/actions/services.ts`:

```typescript
'use server'

import { store, Service } from '@/lib/data/mock-store'
import { revalidatePath } from 'next/cache'

export async function getServices() {
  return store.services.filter(s => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function createService(data: Omit<Service, 'id'>) {
  const newService = {
    ...data,
    id: `svc-${Date.now()}`,
  }
  store.services.push(newService)
  revalidatePath('/dashboard/services')
  return newService
}

export async function updateService(id: string, data: Partial<Service>) {
  const index = store.services.findIndex(s => s.id === id)
  if (index === -1) throw new Error('Service not found')
  store.services[index] = { ...store.services[index], ...data }
  revalidatePath('/dashboard/services')
  return store.services[index]
}

export async function deleteService(id: string) {
  const index = store.services.findIndex(s => s.id === id)
  if (index === -1) throw new Error('Service not found')
  store.services[index].isActive = false
  revalidatePath('/dashboard/services')
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/data/mock-store.ts src/server/actions/services.ts
git commit -m "feat: add mock store and service CRUD actions"
```

---

## Task 2: Build Services Management Page

**Files:**
- Create: `src/components/dashboard/service-form.tsx`
- Create: `src/components/dashboard/service-table.tsx`
- Modify: `src/app/dashboard/services/page.tsx`

- [ ] **Step 1: Create service form component**

Create `src/components/dashboard/service-form.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createService, updateService } from '@/server/actions/services'

const PASTEL_COLORS = [
  '#FFB3BA', '#E2B3FF', '#A3D8FF', '#B3F0C8', '#FFF4B3', '#FFD4B3', '#D4B3FF', '#B3FFF4'
]

export function ServiceForm({ service, onSuccess }: { service?: any, onSuccess?: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedColor, setSelectedColor] = useState(service?.pastelColor || PASTEL_COLORS[0])

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    const data = {
      businessId: 'mock-business-1',
      name: formData.get('name') as string,
      description: formData.get('description') as string || null,
      durationMinutes: parseInt(formData.get('durationMinutes') as string),
      price: parseInt(formData.get('price') as string),
      depositAmount: parseInt(formData.get('depositAmount') as string),
      pastelColor: selectedColor,
      isActive: true,
      sortOrder: 0,
    }

    try {
      if (service) {
        await updateService(service.id, data)
      } else {
        await createService(data)
      }
      setOpen(false)
      onSuccess?.()
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-pink-500 hover:bg-pink-600">
          {service ? 'Editar' : 'Nuevo servicio'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{service ? 'Editar servicio' : 'Nuevo servicio'}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div>
            <Label>Nombre</Label>
            <Input name="name" defaultValue={service?.name} required />
          </div>
          <div>
            <Label>Descripción</Label>
            <Textarea name="description" defaultValue={service?.description || ''} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Precio (CLP)</Label>
              <Input name="price" type="number" defaultValue={service?.price} required />
            </div>
            <div>
              <Label>Duración (min)</Label>
              <Input name="durationMinutes" type="number" defaultValue={service?.durationMinutes} required />
            </div>
            <div>
              <Label>Abono (CLP)</Label>
              <Input name="depositAmount" type="number" defaultValue={service?.depositAmount} required />
            </div>
          </div>
          <div>
            <Label>Color</Label>
            <div className="flex gap-2 mt-2">
              {PASTEL_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={`w-8 h-8 rounded-full border-2 transition ${selectedColor === color ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <Button type="submit" className="w-full bg-pink-500 hover:bg-pink-600" disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Create service table component**

Create `src/components/dashboard/service-table.tsx`:

```tsx
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
```

- [ ] **Step 3: Update services page**

Modify `src/app/dashboard/services/page.tsx`:

```tsx
import { DashboardHeader } from '@/components/dashboard/header'
import { ServiceTable } from '@/components/dashboard/service-table'
import { getServices } from '@/server/actions/services'

export default async function ServicesPage() {
  const services = await getServices()

  return (
    <div>
      <DashboardHeader title="Servicios" />
      <div className="p-8">
        <ServiceTable services={services} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/service-form.tsx src/components/dashboard/service-table.tsx src/app/dashboard/services/page.tsx
git commit -m "feat: add services CRUD with form and table"
```

---

## Task 3: Build Availability Rules Editor

**Files:**
- Create: `src/server/actions/availability.ts`
- Create: `src/components/dashboard/availability-editor.tsx`
- Modify: `src/app/dashboard/availability/page.tsx`

- [ ] **Step 1: Create availability actions**

Create `src/server/actions/availability.ts`:

```typescript
'use server'

import { store } from '@/lib/data/mock-store'
import { revalidatePath } from 'next/cache'

export async function getAvailabilityRules() {
  return store.availabilityRules
}

export async function updateAvailabilityRule(id: string, data: { startTime: string; endTime: string; isActive: boolean }) {
  const index = store.availabilityRules.findIndex(r => r.id === id)
  if (index === -1) throw new Error('Rule not found')
  store.availabilityRules[index] = { ...store.availabilityRules[index], ...data }
  revalidatePath('/dashboard/availability')
  return store.availabilityRules[index]
}
```

- [ ] **Step 2: Create availability editor component**

Create `src/components/dashboard/availability-editor.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { updateAvailabilityRule } from '@/server/actions/availability'

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export function AvailabilityEditor({ rules: initialRules }: { rules: any[] }) {
  const [rules, setRules] = useState(initialRules)

  async function handleToggle(id: string, isActive: boolean) {
    const rule = rules.find(r => r.id === id)
    if (!rule) return
    await updateAvailabilityRule(id, { ...rule, isActive })
    setRules(rules.map(r => r.id === id ? { ...r, isActive } : r))
  }

  async function handleTimeChange(id: string, field: 'startTime' | 'endTime', value: string) {
    const rule = rules.find(r => r.id === id)
    if (!rule) return
    await updateAvailabilityRule(id, { ...rule, [field]: value })
    setRules(rules.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  return (
    <div className="space-y-4">
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center gap-4 bg-white p-4 rounded-lg border">
          <div className="w-28 font-medium">{DAYS[rule.dayOfWeek]}</div>
          <Switch
            checked={rule.isActive}
            onCheckedChange={(checked) => handleToggle(rule.id, checked)}
          />
          {rule.isActive ? (
            <>
              <Input
                type="time"
                value={rule.startTime}
                onChange={(e) => handleTimeChange(rule.id, 'startTime', e.target.value)}
                className="w-32"
              />
              <span className="text-gray-500">a</span>
              <Input
                type="time"
                value={rule.endTime}
                onChange={(e) => handleTimeChange(rule.id, 'endTime', e.target.value)}
                className="w-32"
              />
            </>
          ) : (
            <span className="text-gray-400">Cerrado</span>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Create availability page**

Modify `src/app/dashboard/availability/page.tsx`:

```tsx
import { DashboardHeader } from '@/components/dashboard/header'
import { AvailabilityEditor } from '@/components/dashboard/availability-editor'
import { getAvailabilityRules } from '@/server/actions/availability'

export default async function AvailabilityPage() {
  const rules = await getAvailabilityRules()

  return (
    <div>
      <DashboardHeader title="Horarios de atención" />
      <div className="p-8 max-w-2xl">
        <p className="text-gray-600 mb-6">
          Configura tus horarios de atención por día de la semana. Los clientes solo podrán agendar en estos horarios.
        </p>
        <AvailabilityEditor rules={rules} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add availability to sidebar**

Modify `src/components/dashboard/sidebar.tsx` to add the availability route:

Add `{ href: '/dashboard/availability', label: 'Horarios', icon: '🕐' },` after services.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/availability.ts src/components/dashboard/availability-editor.tsx src/app/dashboard/availability/page.tsx src/components/dashboard/sidebar.tsx
git commit -m "feat: add availability rules editor"
```

---

## Task 4: Build Time Block Manager

**Files:**
- Create: `src/server/actions/time-blocks.ts`
- Create: `src/components/dashboard/time-block-form.tsx`
- Modify: `src/app/dashboard/availability/page.tsx` (add time blocks section)

- [ ] **Step 1: Create time block actions**

Create `src/server/actions/time-blocks.ts`:

```typescript
'use server'

import { store, TimeBlock } from '@/lib/data/mock-store'
import { revalidatePath } from 'next/cache'

export async function getTimeBlocks() {
  return store.timeBlocks
}

export async function createTimeBlock(data: Omit<TimeBlock, 'id'>) {
  const newBlock = {
    ...data,
    id: `tb-${Date.now()}`,
  }
  store.timeBlocks.push(newBlock)
  revalidatePath('/dashboard/availability')
  return newBlock
}

export async function deleteTimeBlock(id: string) {
  store.timeBlocks = store.timeBlocks.filter(b => b.id !== id)
  revalidatePath('/dashboard/availability')
}
```

- [ ] **Step 2: Create time block form component**

Create `src/components/dashboard/time-block-form.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createTimeBlock, deleteTimeBlock } from '@/server/actions/time-blocks'

export function TimeBlockForm({ onSuccess }: { onSuccess?: () => void }) {
  const [open, setOpen] = useState(false)

  async function handleSubmit(formData: FormData) {
    const startDate = formData.get('startDate') as string
    const startTime = formData.get('startTime') as string
    const endDate = formData.get('endDate') as string
    const endTime = formData.get('endTime') as string
    const reason = formData.get('reason') as string

    await createTimeBlock({
      businessId: 'mock-business-1',
      startDateTime: new Date(`${startDate}T${startTime}`),
      endDateTime: new Date(`${endDate}T${endTime}`),
      reason: reason || null,
    })

    setOpen(false)
    onSuccess?.()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Bloquear horario</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bloquear horario</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Fecha inicio</Label>
              <Input name="startDate" type="date" required />
            </div>
            <div>
              <Label>Hora inicio</Label>
              <Input name="startTime" type="time" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Fecha fin</Label>
              <Input name="endDate" type="date" required />
            </div>
            <div>
              <Label>Hora fin</Label>
              <Input name="endTime" type="time" required />
            </div>
          </div>
          <div>
            <Label>Motivo (opcional)</Label>
            <Input name="reason" placeholder="Vacaciones, emergencia, etc." />
          </div>
          <Button type="submit" className="w-full bg-pink-500 hover:bg-pink-600">
            Bloquear
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TimeBlockList({ blocks: initialBlocks }: { blocks: any[] }) {
  const [blocks, setBlocks] = useState(initialBlocks)

  async function handleDelete(id: string) {
    await deleteTimeBlock(id)
    setBlocks(blocks.filter(b => b.id !== id))
  }

  if (blocks.length === 0) {
    return <p className="text-gray-500">No hay horarios bloqueados</p>
  }

  return (
    <div className="space-y-2">
      {blocks.map((block) => (
        <div key={block.id} className="flex justify-between items-center bg-red-50 p-3 rounded-lg border border-red-100">
          <div>
            <div className="font-medium">
              {block.startDateTime.toLocaleDateString('es-CL')} {block.startDateTime.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} - {block.endDateTime.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
            </div>
            {block.reason && <div className="text-sm text-gray-600">{block.reason}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={() => handleDelete(block.id)}>
            Eliminar
          </Button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Update availability page with time blocks**

Modify `src/app/dashboard/availability/page.tsx`:

```tsx
import { DashboardHeader } from '@/components/dashboard/header'
import { AvailabilityEditor } from '@/components/dashboard/availability-editor'
import { TimeBlockForm, TimeBlockList } from '@/components/dashboard/time-block-form'
import { getAvailabilityRules } from '@/server/actions/availability'
import { getTimeBlocks } from '@/server/actions/time-blocks'

export default async function AvailabilityPage() {
  const rules = await getAvailabilityRules()
  const blocks = await getTimeBlocks()

  return (
    <div>
      <DashboardHeader title="Horarios de atención" />
      <div className="p-8 max-w-2xl space-y-10">
        <section>
          <h2 className="text-lg font-semibold mb-4">Horario semanal</h2>
          <p className="text-gray-600 mb-6">
            Configura tus horarios de atención por día de la semana.
          </p>
          <AvailabilityEditor rules={rules} />
        </section>

        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Bloqueos</h2>
            <TimeBlockForm />
          </div>
          <p className="text-gray-600 mb-4">
            Bloquea días o horarios específicos cuando no puedas atender.
          </p>
          <TimeBlockList blocks={blocks} />
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/server/actions/time-blocks.ts src/components/dashboard/time-block-form.tsx src/app/dashboard/availability/page.tsx
git commit -m "feat: add time block manager"
```

---

## Task 5: Build Slot Generator

**Files:**
- Create: `src/lib/availability/slots.ts`
- Create: `tests/unit/slots.test.ts`

- [ ] **Step 1: Create slot generation logic**

Create `src/lib/availability/slots.ts`:

```typescript
import { addMinutes, startOfDay, endOfDay, isWithinInterval, format } from 'date-fns'

export interface TimeSlot {
  start: Date
  end: Date
}

export interface BookingLike {
  startDateTime: Date
  endDateTime: Date
  status: string
}

export interface TimeBlockLike {
  startDateTime: Date
  endDateTime: Date
}

export interface AvailabilityRuleLike {
  dayOfWeek: number
  startTime: string
  endTime: string
  isActive: boolean
}

export function generateSlots(
  date: Date,
  durationMinutes: number,
  rules: AvailabilityRuleLike[],
  blocks: TimeBlockLike[],
  bookings: BookingLike[]
): TimeSlot[] {
  const dayOfWeek = date.getDay()
  const rule = rules.find(r => r.dayOfWeek === dayOfWeek && r.isActive)
  
  if (!rule) return []
  
  const dayStart = startOfDay(date)
  const [startHour, startMin] = rule.startTime.split(':').map(Number)
  const [endHour, endMin] = rule.endTime.split(':').map(Number)
  
  const availabilityStart = new Date(dayStart)
  availabilityStart.setHours(startHour, startMin, 0, 0)
  
  const availabilityEnd = new Date(dayStart)
  availabilityEnd.setHours(endHour, endMin, 0, 0)
  
  const slots: TimeSlot[] = []
  let current = availabilityStart
  
  while (addMinutes(current, durationMinutes) <= availabilityEnd) {
    const slotEnd = addMinutes(current, durationMinutes)
    
    // Check if slot overlaps with any block
    const blockedByTimeBlock = blocks.some(block =>
      isWithinInterval(current, { start: block.startDateTime, end: block.endDateTime }) ||
      isWithinInterval(slotEnd, { start: block.startDateTime, end: block.endDateTime }) ||
      (current <= block.startDateTime && slotEnd >= block.endDateTime)
    )
    
    // Check if slot overlaps with any booking
    const blockedByBooking = bookings.some(booking => {
      if (booking.status === 'cancelled' || booking.status === 'no_show') return false
      return (
        isWithinInterval(current, { start: booking.startDateTime, end: booking.endDateTime }) ||
        isWithinInterval(slotEnd, { start: booking.startDateTime, end: booking.endDateTime }) ||
        (current <= booking.startDateTime && slotEnd >= booking.endDateTime)
      )
    })
    
    if (!blockedByTimeBlock && !blockedByBooking) {
      slots.push({ start: new Date(current), end: slotEnd })
    }
    
    current = addMinutes(current, 30) // 30-minute increments
  }
  
  return slots
}
```

- [ ] **Step 2: Create unit tests for slot generator**

Create `tests/unit/slots.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { generateSlots } from '@/lib/availability/slots'
import { addMinutes } from 'date-fns'

describe('generateSlots', () => {
  const baseDate = new Date('2026-05-12') // Monday
  
  const rules = [
    { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
  ]
  
  it('generates slots for a normal day', () => {
    const slots = generateSlots(baseDate, 60, rules, [], [])
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0].start.getHours()).toBe(9)
  })
  
  it('respects availability rules', () => {
    const slots = generateSlots(baseDate, 60, rules, [], [])
    const lastSlot = slots[slots.length - 1]
    expect(lastSlot.end.getHours()).toBeLessThanOrEqual(18)
  })
  
  it('excludes blocked time', () => {
    const blocks = [
      {
        startDateTime: new Date('2026-05-12T12:00:00'),
        endDateTime: new Date('2026-05-12T13:00:00'),
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, blocks, [])
    const hasSlotAt12 = slots.some(s => s.start.getHours() === 12)
    expect(hasSlotAt12).toBe(false)
  })
  
  it('excludes existing bookings', () => {
    const bookings = [
      {
        startDateTime: new Date('2026-05-12T10:00:00'),
        endDateTime: new Date('2026-05-12T11:00:00'),
        status: 'confirmed',
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, [], bookings)
    const hasSlotAt10 = slots.some(s => s.start.getHours() === 10)
    expect(hasSlotAt10).toBe(false)
  })
  
  it('allows cancelled bookings to be rebooked', () => {
    const bookings = [
      {
        startDateTime: new Date('2026-05-12T10:00:00'),
        endDateTime: new Date('2026-05-12T11:00:00'),
        status: 'cancelled',
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, [], bookings)
    const hasSlotAt10 = slots.some(s => s.start.getHours() === 10)
    expect(hasSlotAt10).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
source ~/.nvm/nvm.sh
npm test -- --run tests/unit/slots.test.ts
```

Expected: 5 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/availability/slots.ts tests/unit/slots.test.ts
git commit -m "feat: add slot generation logic with unit tests"
```

---

## Task 6: Build Calendar View

**Files:**
- Create: `src/components/dashboard/calendar-view.tsx`
- Modify: `src/app/dashboard/calendar/page.tsx`

- [ ] **Step 1: Create calendar view component**

Create `src/components/dashboard/calendar-view.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'

export function CalendarView() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(monthStart)
  const calendarStart = startOfWeek(monthStart, { locale: es })
  const calendarEnd = endOfWeek(monthEnd, { locale: es })
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  const weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <Button variant="outline" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
          ← Anterior
        </Button>
        <h2 className="text-xl font-bold capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: es })}
        </h2>
        <Button variant="outline" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
          Siguiente →
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day) => (
          <div key={day} className="text-center text-sm font-medium text-gray-500 py-2">
            {day}
          </div>
        ))}
        {days.map((day) => (
          <button
            key={day.toISOString()}
            onClick={() => setSelectedDate(day)}
            className={`
              aspect-square flex items-center justify-center rounded-lg text-sm
              ${!isSameMonth(day, currentMonth) ? 'text-gray-300' : 'text-gray-900'}
              ${selectedDate && isSameDay(day, selectedDate) ? 'bg-pink-500 text-white' : 'hover:bg-gray-100'}
            `}
          >
            {format(day, 'd')}
          </button>
        ))}
      </div>

      {selectedDate && (
        <div className="mt-6 p-4 bg-white rounded-lg border">
          <h3 className="font-semibold mb-2">
            {format(selectedDate, 'EEEE d \'de\' MMMM', { locale: es })}
          </h3>
          <p className="text-gray-500 text-sm">No hay reservas para este día</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create calendar page**

Modify `src/app/dashboard/calendar/page.tsx`:

```tsx
import { DashboardHeader } from '@/components/dashboard/header'
import { CalendarView } from '@/components/dashboard/calendar-view'

export default function CalendarPage() {
  return (
    <div>
      <DashboardHeader title="Calendario" />
      <div className="p-8 max-w-3xl">
        <CalendarView />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add calendar to sidebar**

Modify `src/components/dashboard/sidebar.tsx` to add:
`{ href: '/dashboard/calendar', label: 'Calendario', icon: '📆' },`

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/calendar-view.tsx src/app/dashboard/calendar/page.tsx src/components/dashboard/sidebar.tsx
git commit -m "feat: add calendar view with month navigation"
```

---

## Task 7: Verify Everything Works

- [ ] **Step 1: Run dev server**

```bash
source ~/.nvm/nvm.sh
npm run dev
```

- [ ] **Step 2: Verify dashboard services**

Navigate to `http://localhost:3000/dashboard/services`
- Should show service table with 3 services
- Should be able to add/edit/delete (with page reload)

- [ ] **Step 3: Verify availability editor**

Navigate to `http://localhost:3000/dashboard/availability`
- Should show weekly schedule
- Should be able to toggle days and change times
- Should show time block form

- [ ] **Step 4: Verify calendar**

Navigate to `http://localhost:3000/dashboard/calendar`
- Should show month view
- Should navigate between months
- Should select days

- [ ] **Step 5: Run unit tests**

```bash
npm test -- --run
```

Expected: slot generator tests passing.

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat: complete phase 3 - services and availability"
```

---

## Self-Review

### Spec Coverage

| Spec Section | Plan Task |
|-------------|-----------|
| CRUD servicios | Task 2 |
| Configuración horarios | Task 3 |
| Bloqueo de horarios | Task 4 |
| Generador de slots | Task 5 |
| Calendario | Task 6 |

### Placeholder Scan

- ✅ No TBDs or TODOs
- ✅ All code blocks are complete
- ✅ All file paths are exact

### Type Consistency

- ✅ Mock store types match Prisma schema
- ✅ Slot generator types are consistent
- ✅ Server Actions use correct types
