# Tablas del dashboard — PR1: primitivas + Reservas piloto

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir las 5 primitivas de tabla compartidas y migrar la tabla de Reservas como piloto, validando el caso más difícil (diálogos dentro del kebab) antes de tocar las otras 13 tablas.

**Architecture:** Convención + primitivas chicas sobre el shadcn table existente (no un DataTable genérico), porque las páginas son Server Components con server actions inline. Las acciones de fila colapsan en "1 primaria visible + kebab"; los diálogos del kebab se izan fuera del menú (estado controlado) para esquivar el bug de Radix Dialog-en-DropdownMenu.

**Tech Stack:** Next.js App Router, React 19, Tailwind, radix-ui (DropdownMenu/Dialog), lucide-react, vitest + `renderToStaticMarkup`.

Referencia de diseño: [`docs/superpowers/specs/2026-07-09-unified-dashboard-tables-design.md`](../specs/2026-07-09-unified-dashboard-tables-design.md).

---

## File Structure (PR1)

- Create `src/components/ui/table-widths.ts` — constantes de ancho de columna compartidas.
- Modify `src/components/ui/table.tsx` — prop `fixed` (table-layout: fixed).
- Create `src/components/ui/status-badge.tsx` — `<StatusBadge>` + mapa de estados de reserva.
- Create `src/components/ui/truncated-cell.tsx` — `<TruncatedCell>`.
- Create `src/components/ui/table-actions.tsx` — `<TableActions>` (primaria + kebab).
- Modify `src/components/dashboard/cancel-booking-button.tsx` — modo controlado + `hideTrigger`.
- Modify `src/components/dashboard/manual-payment-dialog.tsx` — modo controlado + `hideTrigger`.
- Create `src/components/dashboard/booking-row-actions.tsx` — acciones de fila de Reservas (primaria por estado + kebab con diálogos izados).
- Modify `src/app/dashboard/bookings/page.tsx` — migrar la tabla desktop; breakpoint `md`→`lg`.
- Modify `src/components/dashboard/booking-card.tsx` — usar `<StatusBadge>`.
- Tests: `tests/unit/table-primitives.test.tsx`, `tests/unit/booking-row-actions.test.tsx`.

Nota de convenciones (de la memoria del proyecto): los tests se corren **desde el worktree**; `renderToStaticMarkup` + mock de `next/navigation` es el patrón para componentes que usan `useRouter`; `tsc --noEmit` tiene un baseline de errores preexistentes en tests ajenos — no lo tomes como regresión salvo que tus archivos aparezcan.

---

### Task 1: Constantes de ancho de columna

**Files:**
- Create: `src/components/ui/table-widths.ts`

Sin test (constantes puras).

- [ ] **Step 1: Crear el archivo**

```ts
// Anchos px fijos para columnas atómicas, compartidos por todas las tablas
// del dashboard para que la misma columna mida igual en todas partes.
// Las columnas de TEXTO no llevan ancho (una sola flex por tabla); ver spec.
export const TABLE_COL = {
  count: 'w-[64px]',
  date: 'w-[104px]',
  time: 'w-[80px]',
  status: 'w-[132px]',
  money: 'w-[148px]',
  contact: 'w-[112px]',
  actions: 'w-[120px]',
} as const

// Piso de ancho de la tabla: bajo esto, el wrapper overflow-x-auto scrollea
// en vez de aplastar la columna flexible. Ajustar por tabla si hace falta.
export const TABLE_MIN_WIDTH = 'min-w-[860px]'
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/table-widths.ts
git commit -m "Add shared table column width constants"
```

---

### Task 2: Prop `fixed` en el componente Table

**Files:**
- Modify: `src/components/ui/table.tsx:7-20`
- Test: `tests/unit/table-primitives.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/table-primitives.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Table } from '@/components/ui/table'

describe('Table fixed', () => {
  it('applies table-fixed when fixed is set', () => {
    const html = renderToStaticMarkup(<Table fixed><tbody /></Table>)
    expect(html).toContain('table-fixed')
  })

  it('does not apply table-fixed by default', () => {
    const html = renderToStaticMarkup(<Table><tbody /></Table>)
    expect(html).not.toContain('table-fixed')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest --run tests/unit/table-primitives.test.tsx`
Expected: FAIL (`Table` no acepta `fixed`, no aparece `table-fixed`).

- [ ] **Step 3: Implementar**

Reemplazar la función `Table` en `src/components/ui/table.tsx`:

```tsx
function Table({ className, fixed, ...props }: React.ComponentProps<"table"> & { fixed?: boolean }) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", fixed && "table-fixed", className)}
        {...props}
      />
    </div>
  )
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest --run tests/unit/table-primitives.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/table.tsx tests/unit/table-primitives.test.tsx
git commit -m "Add fixed prop to Table for table-layout: fixed"
```

---

### Task 3: `<StatusBadge>`

**Files:**
- Create: `src/components/ui/status-badge.tsx`
- Test: `tests/unit/table-primitives.test.tsx` (agregar)

- [ ] **Step 1: Agregar el test que falla**

Agregar a `tests/unit/table-primitives.test.tsx`:

```tsx
import { StatusBadge } from '@/components/ui/status-badge'

describe('StatusBadge', () => {
  it('renders the mapped label and color class for a known status', () => {
    const html = renderToStaticMarkup(<StatusBadge status="confirmed" />)
    expect(html).toContain('Confirmada')
    expect(html).toContain('text-green-800')
  })

  it('lets the caller override the label', () => {
    const html = renderToStaticMarkup(<StatusBadge status="pending_payment" label="Pendiente" />)
    expect(html).toContain('Pendiente')
    expect(html).not.toContain('Pendiente de pago')
  })

  it('falls back to the raw status when unknown', () => {
    const html = renderToStaticMarkup(<StatusBadge status="weird_state" />)
    expect(html).toContain('weird_state')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest --run tests/unit/table-primitives.test.tsx`
Expected: FAIL (módulo `status-badge` no existe).

- [ ] **Step 3: Implementar**

Crear `src/components/ui/status-badge.tsx`:

```tsx
import { Badge } from './badge'
import { cn } from '@/lib/utils'

type StatusEntry = { label: string; className: string }

const BOOKING_STATUS: Record<string, StatusEntry> = {
  pending_payment: { label: 'Pendiente de pago', className: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  confirmed: { label: 'Confirmada', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  completed: { label: 'Completada', className: 'bg-secondary text-secondary-foreground' },
  cancelled: { label: 'Cancelada', className: 'bg-muted text-muted-foreground' },
  no_show: { label: 'No asistió', className: 'bg-destructive/10 text-destructive' },
  expired: { label: 'Expirada', className: 'bg-muted text-muted-foreground' },
}

export const STATUS_MAPS = { booking: BOOKING_STATUS } as const

export function StatusBadge({
  status,
  map = 'booking',
  label,
  className,
}: {
  status: string
  map?: keyof typeof STATUS_MAPS
  label?: string
  className?: string
}) {
  const entry = STATUS_MAPS[map][status]
  return (
    <Badge className={cn('border-transparent', entry?.className, className)}>
      {label ?? entry?.label ?? status}
    </Badge>
  )
}
```

Nota: `cn` usa `twMerge`, así que `bg-*`/`text-*` del `className` ganan al `bg-primary` por defecto del `Badge`.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest --run tests/unit/table-primitives.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/status-badge.tsx tests/unit/table-primitives.test.tsx
git commit -m "Add shared StatusBadge with booking status map"
```

---

### Task 4: `<TruncatedCell>`

**Files:**
- Create: `src/components/ui/truncated-cell.tsx`
- Test: `tests/unit/table-primitives.test.tsx` (agregar)

- [ ] **Step 1: Agregar el test que falla**

```tsx
import { TruncatedCell } from '@/components/ui/truncated-cell'

describe('TruncatedCell', () => {
  function render(node: React.ReactNode) {
    return renderToStaticMarkup(<table><tbody><tr>{node}</tr></tbody></table>)
  }

  it('renders primary text with a truncate wrapper and a title for the full text', () => {
    const html = render(<TruncatedCell primary="Manicura semipermanente + diseño" />)
    expect(html).toContain('truncate')
    expect(html).toContain('title="Manicura semipermanente + diseño"')
    expect(html).toContain('Manicura semipermanente + diseño')
  })

  it('renders the secondary line when provided', () => {
    const html = render(<TruncatedCell primary="Servicio" secondary="#4738" />)
    expect(html).toContain('#4738')
  })

  it('omits the secondary line when not provided', () => {
    const html = render(<TruncatedCell primary="Servicio" />)
    expect(html).not.toContain('text-muted-foreground')
  })
})
```

Recordá el `import type React from 'react'` si el archivo de test lo necesita para `React.ReactNode` (o usar `import * as React from 'react'` al inicio del test file).

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest --run tests/unit/table-primitives.test.tsx`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

Crear `src/components/ui/truncated-cell.tsx`:

```tsx
import * as React from 'react'
import { TableCell } from './table'
import { cn } from '@/lib/utils'

export function TruncatedCell({
  primary,
  secondary,
  title,
  className,
  ...props
}: {
  primary: React.ReactNode
  secondary?: React.ReactNode
  title?: string
} & Omit<React.ComponentProps<'td'>, 'title'>) {
  const resolvedTitle = title ?? (typeof primary === 'string' ? primary : undefined)
  return (
    <TableCell className={cn('overflow-hidden whitespace-normal', className)} {...props}>
      <div className="truncate" title={resolvedTitle}>{primary}</div>
      {secondary != null && (
        <div className="truncate text-xs text-muted-foreground">{secondary}</div>
      )}
    </TableCell>
  )
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest --run tests/unit/table-primitives.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/truncated-cell.tsx tests/unit/table-primitives.test.tsx
git commit -m "Add TruncatedCell for CSS ellipsis with full-text title"
```

---

### Task 5: `<TableActions>`

**Files:**
- Create: `src/components/ui/table-actions.tsx`
- Test: `tests/unit/table-primitives.test.tsx` (agregar)

- [ ] **Step 1: Agregar el test que falla**

```tsx
import { TableActions } from '@/components/ui/table-actions'

describe('TableActions', () => {
  it('renders the primary action', () => {
    const html = renderToStaticMarkup(<TableActions primary={<button>Completar</button>} />)
    expect(html).toContain('Completar')
  })

  it('renders the kebab trigger when there are menu children', () => {
    const html = renderToStaticMarkup(
      <TableActions primary={<button>Completar</button>}>
        <span>item</span>
      </TableActions>,
    )
    expect(html).toContain('Más acciones')
  })

  it('does not render the kebab when there are no children', () => {
    const html = renderToStaticMarkup(<TableActions primary={<button>Completar</button>} />)
    expect(html).not.toContain('Más acciones')
  })
})
```

Nota: `renderToStaticMarkup` renderiza el trigger del kebab pero **no** el contenido del menú (Radix lo monta en un portal sólo al abrir). El test se acota al trigger a propósito.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest --run tests/unit/table-primitives.test.tsx`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

Crear `src/components/ui/table-actions.tsx`:

```tsx
"use client"

import * as React from 'react'
import { MoreVertical } from 'lucide-react'
import { Button } from './button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from './dropdown-menu'

export function TableActions({
  primary,
  children,
  align = 'end',
}: {
  primary?: React.ReactNode
  children?: React.ReactNode
  align?: 'start' | 'end'
}) {
  const hasMenu = React.Children.count(children) > 0
  return (
    <div className="flex items-center justify-end gap-1">
      {primary}
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Más acciones">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={align} className="w-auto min-w-44">
            {children}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
```

Verificá que `Button` acepte `size="icon"` (en `src/components/ui/button.tsx`). Si el nombre de la variante de tamaño es otro (p.ej. `sm`), usá el que exista y dale `className="size-8 p-0"`.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest --run tests/unit/table-primitives.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/table-actions.tsx tests/unit/table-primitives.test.tsx
git commit -m "Add TableActions (primary action + kebab menu)"
```

---

### Task 6: Modo controlado + `hideTrigger` en `CancelBookingButton`

Necesario para izar el diálogo fuera del kebab (bug Radix Dialog-en-DropdownMenu).

**Files:**
- Modify: `src/components/dashboard/cancel-booking-button.tsx`
- Test: `tests/unit/booking-row-actions.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/booking-row-actions.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { CancelBookingButton } from '@/components/dashboard/cancel-booking-button'

describe('CancelBookingButton controlled mode', () => {
  it('renders no trigger button when hideTrigger is set', () => {
    const html = renderToStaticMarkup(
      <CancelBookingButton bookingId="b1" hideTrigger open={false} onOpenChange={() => {}} />,
    )
    expect(html).not.toContain('Cancelar')
  })

  it('still renders the trigger by default', () => {
    const html = renderToStaticMarkup(<CancelBookingButton bookingId="b1" />)
    expect(html).toContain('Cancelar')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest --run tests/unit/booking-row-actions.test.tsx`
Expected: FAIL (`hideTrigger` no existe; el botón se renderiza igual).

- [ ] **Step 3: Implementar**

En `src/components/dashboard/cancel-booking-button.tsx`, extender props y estado:

```tsx
interface CancelBookingButtonProps {
  bookingId: string
  variant?: 'default' | 'destructive' | 'outline' | 'ghost'
  size?: 'default' | 'sm' | 'xs'
  label?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}

export function CancelBookingButton({
  bookingId,
  variant = 'destructive',
  size = 'sm',
  label = 'Cancelar',
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: CancelBookingButtonProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
```

Dejá `handleConfirm` igual (usa `setOpen`/`router.refresh`). Envolvé el trigger:

```tsx
  return (
    <>
      {!hideTrigger && (
        <Button
          type="button"
          variant={variant}
          size={size}
          onClick={() => setOpen(true)}
        >
          <XCircle className="mr-1 size-3" />
          {label}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        {/* ...contenido del diálogo sin cambios... */}
      </Dialog>
    </>
  )
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest --run tests/unit/booking-row-actions.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/cancel-booking-button.tsx tests/unit/booking-row-actions.test.tsx
git commit -m "Support controlled open + hideTrigger in CancelBookingButton"
```

---

### Task 7: Modo controlado + `hideTrigger` en `ManualPaymentDialog`

**Files:**
- Modify: `src/components/dashboard/manual-payment-dialog.tsx`
- Test: `tests/unit/booking-row-actions.test.tsx` (agregar)

- [ ] **Step 1: Agregar el test que falla**

```tsx
import { ManualPaymentDialog } from '@/components/dashboard/manual-payment-dialog'

const payableBooking = {
  id: 'b1',
  bookingNumber: 4738,
  status: 'confirmed',
  totalPrice: 45000,
  depositPaid: 15000,
  remainingBalance: 30000,
  paymentStatus: 'deposit_paid',
  customer: { name: 'Ana' },
}

describe('ManualPaymentDialog controlled mode', () => {
  it('renders no trigger button when hideTrigger is set', () => {
    const html = renderToStaticMarkup(
      <ManualPaymentDialog bookings={[payableBooking as never]} defaultBookingId="b1" hideTrigger open={false} onOpenChange={() => {}} />,
    )
    expect(html).not.toContain('Registrar pago')
    expect(html).not.toContain('Cobrar')
  })
})
```

Si el shape de `ManualPaymentBooking` exige más campos, completá `payableBooking` con lo que pida el tipo (mirá `src/components/dashboard/manual-payment-utils.ts`).

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest --run tests/unit/booking-row-actions.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

En `src/components/dashboard/manual-payment-dialog.tsx`:

1. Importar `useEffect`: `import { useEffect, useMemo, useState, useTransition } from 'react'`.
2. Extender props y estado (reemplazar la firma y el `const [open, setOpen] = useState(false)`):

```tsx
export function ManualPaymentDialog({
  bookings,
  businessCurrency = 'CLP',
  defaultBookingId,
  triggerClassName,
  triggerLabel = 'Registrar pago',
  triggerSize,
  triggerVariant,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  bookings: ManualPaymentBooking[]
  businessCurrency?: string
  defaultBookingId?: string
  triggerClassName?: string
  triggerLabel?: string
  triggerSize?: React.ComponentProps<typeof Button>['size']
  triggerVariant?: React.ComponentProps<typeof Button>['variant']
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const router = useRouter()
  const isControlled = controlledOpen !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? controlledOpen : internalOpen
```

3. Reemplazar `handleOpenChange` y agregar el efecto de init al abrir (para que la selección/prefill funcione también cuando abre el padre):

```tsx
  function handleOpenChange(nextOpen: boolean) {
    if (isControlled) onOpenChange?.(nextOpen)
    else setInternalOpen(nextOpen)
  }

  useEffect(() => {
    if (open) selectBooking(defaultBookingId || payableBookings[0]?.id || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
```

   Y donde `handleSubmit` hacía `setOpen(false)`, cambiar a `handleOpenChange(false)`.

4. Envolver el trigger con `!hideTrigger`:

```tsx
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button
            type="button"
            size={triggerSize}
            variant={triggerVariant}
            className={triggerClassName || 'h-11 font-semibold'}
          >
            <Plus className="mr-2 size-4" />
            {triggerLabel}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        {/* ...sin cambios... */}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest --run tests/unit/booking-row-actions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/manual-payment-dialog.tsx tests/unit/booking-row-actions.test.tsx
git commit -m "Support controlled open + hideTrigger in ManualPaymentDialog"
```

---

### Task 8: `<BookingRowActions>` (primaria por estado + kebab con diálogos izados)

**Files:**
- Create: `src/components/dashboard/booking-row-actions.tsx`
- Test: `tests/unit/booking-row-actions.test.tsx` (agregar)

- [ ] **Step 1: Agregar el test que falla**

```tsx
import { BookingRowActions } from '@/components/dashboard/booking-row-actions'

function rowBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1', bookingNumber: 4738, status: 'confirmed',
    totalPrice: 45000, depositPaid: 15000, remainingBalance: 30000,
    paymentStatus: 'deposit_paid', customer: { name: 'Ana' },
    ...overrides,
  }
}

describe('BookingRowActions', () => {
  it('shows Completar as primary + kebab for a confirmed booking', () => {
    const html = renderToStaticMarkup(<BookingRowActions booking={rowBooking() as never} businessCurrency="CLP" />)
    expect(html).toContain('Completar')
    expect(html).toContain('Más acciones')
  })

  it('shows Cobrar as primary for a pending_payment booking', () => {
    const html = renderToStaticMarkup(<BookingRowActions booking={rowBooking({ status: 'pending_payment' }) as never} businessCurrency="CLP" />)
    expect(html).toContain('Cobrar')
  })

  it('renders nothing actionable for a terminal booking', () => {
    const html = renderToStaticMarkup(<BookingRowActions booking={rowBooking({ status: 'completed', remainingBalance: 0 }) as never} businessCurrency="CLP" />)
    expect(html).not.toContain('Completar')
    expect(html).not.toContain('Cobrar')
    expect(html).not.toContain('Más acciones')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest --run tests/unit/booking-row-actions.test.tsx`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

Crear `src/components/dashboard/booking-row-actions.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TableActions } from '@/components/ui/table-actions'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { CancelBookingButton } from './cancel-booking-button'
import { ManualPaymentDialog } from './manual-payment-dialog'
import { isManualPaymentAllowed, type ManualPaymentBooking } from './manual-payment-utils'
import { updateBookingStatus } from '@/server/actions/bookings'

type RowBooking = ManualPaymentBooking & { status: string }

export function BookingRowActions({
  booking,
  businessCurrency,
  contact,
}: {
  booking: RowBooking
  businessCurrency: string
  contact?: React.ReactNode
}) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  const canPay = isManualPaymentAllowed(booking)
  const isConfirmed = booking.status === 'confirmed'
  const isPending = booking.status === 'pending_payment'
  const isActionable = isConfirmed || isPending

  if (!isActionable) {
    return contact ? <div className="flex justify-end">{contact}</div> : null
  }

  const primary = isConfirmed ? (
    <form action={updateBookingStatus.bind(null, booking.id, 'completed')}>
      <Button type="submit" size="sm" variant="outline">Completar</Button>
    </form>
  ) : (
    <Button type="button" size="sm" variant="outline" onClick={() => setPayOpen(true)}>
      Cobrar
    </Button>
  )

  return (
    <>
      <TableActions primary={<>{contact}{primary}</>}>
        {isConfirmed && (
          <DropdownMenuItem asChild>
            <a href={`/dashboard/bookings/${booking.id}/reschedule`}>
              <RefreshCw className="size-4" /> Reprogramar
            </a>
          </DropdownMenuItem>
        )}
        {isConfirmed && canPay && (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setPayOpen(true) }}>
            Registrar pago
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          onSelect={(e) => { e.preventDefault(); setCancelOpen(true) }}
        >
          Cancelar
        </DropdownMenuItem>
      </TableActions>

      <CancelBookingButton
        bookingId={booking.id}
        hideTrigger
        open={cancelOpen}
        onOpenChange={setCancelOpen}
      />
      {canPay && (
        <ManualPaymentDialog
          bookings={[booking]}
          businessCurrency={businessCurrency}
          defaultBookingId={booking.id}
          hideTrigger
          open={payOpen}
          onOpenChange={setPayOpen}
        />
      )}
    </>
  )
}
```

Verificá el shape de `ManualPaymentBooking` en `manual-payment-utils.ts` y ajustá `RowBooking` si `isManualPaymentAllowed` usa campos extra. Si `updateBookingStatus` no acepta `.bind` como server action en este setup, reemplazá el `primary` confirmado por el `<form action={async () => { 'use server' ... }}>` **desde la página** (Server Component) pasándolo como prop `primary` — pero primero intentá `.bind`, que es lo estándar en App Router.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest --run tests/unit/booking-row-actions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/booking-row-actions.tsx tests/unit/booking-row-actions.test.tsx
git commit -m "Add BookingRowActions with hoisted dialogs to avoid Radix menu bug"
```

---

### Task 9: Migrar la tabla desktop de Reservas

**Files:**
- Modify: `src/app/dashboard/bookings/page.tsx:226-323`

- [ ] **Step 1: Reemplazar el bloque de la tabla desktop**

En `src/app/dashboard/bookings/page.tsx`, cambiar el contenedor y encabezados (líneas ~226-238). Nuevo encabezado (se elimina la columna "Contacto" suelta; el contacto se pliega dentro de las acciones):

```tsx
            <div className="hidden lg:block studio-card overflow-hidden">
              <Table fixed className={TABLE_MIN_WIDTH}>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Servicio</TableHead>
                    <TableHead className={TABLE_COL.date}>Fecha</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className={TABLE_COL.status}>Estado</TableHead>
                    <TableHead className={TABLE_COL.money}>Pago</TableHead>
                    <TableHead className={`${TABLE_COL.actions} text-right`}>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
```

Reemplazar el cuerpo de cada fila (líneas ~241-319) por:

```tsx
                    <TableRow key={booking.id}>
                      <TruncatedCell
                        className="font-semibold text-primary"
                        primary={booking.service?.name || 'Servicio'}
                        secondary={formatBookingNumber(booking.bookingNumber, booking.id)}
                      />
                      <TableCell className={TABLE_COL.date}>
                        <div>{new Date(booking.startDateTime).toLocaleDateString('es-CL', { timeZone: businessTimezone })}</div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(booking.startDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: businessTimezone })}
                        </div>
                      </TableCell>
                      <TruncatedCell primary={booking.customer?.name || '—'} />
                      <TableCell className={TABLE_COL.status}>
                        <StatusBadge status={booking.status} />
                      </TableCell>
                      <TableCell className={TABLE_COL.money}>
                        <span className={booking.paymentStatus === 'fully_paid' ? 'font-semibold text-green-700' : 'font-semibold text-primary'}>
                          ${booking.depositPaid.toLocaleString('es-CL')} / ${booking.finalAmount.toLocaleString('es-CL')}
                        </span>
                        {booking.remainingBalance > 0 && (
                          <div className="text-xs text-muted-foreground">
                            Saldo: ${booking.remainingBalance.toLocaleString('es-CL')}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className={`${TABLE_COL.actions} text-right`}>
                        <BookingRowActions
                          booking={booking}
                          businessCurrency={businessCurrency}
                          contact={
                            <BookingContactButtons
                              variant="compact"
                              booking={{
                                bookingNumber: booking.bookingNumber,
                                customerName: booking.customer?.name || '',
                                customerPhone: booking.customer?.phone || null,
                                serviceName: booking.service?.name || '',
                                startDateTime: booking.startDateTime.toISOString(),
                                businessTimezone,
                                businessCurrency,
                                totalPrice: booking.totalPrice,
                                depositPaid: booking.depositPaid,
                                remainingBalance: booking.remainingBalance,
                                businessAddress,
                              }}
                            />
                          }
                        />
                      </TableCell>
                    </TableRow>
```

- [ ] **Step 2: Agregar imports**

Al inicio de `src/app/dashboard/bookings/page.tsx`:

```tsx
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { BookingRowActions } from '@/components/dashboard/booking-row-actions'
```

Quitar imports que queden sin uso tras el cambio (por ejemplo `CancelBookingButton`, `ManualPaymentDialog`, `RefreshCw`, `updateBookingStatus`, `isManualPaymentAllowed`, `Button`) **sólo si** ya no se usan en el resto del archivo — verificá con búsqueda antes de borrar.

- [ ] **Step 3: Verificar tipos y lint**

Run: `npx tsc --noEmit 2>&1 | grep bookings/page` (esperado: sin líneas nuevas de este archivo)
Run: `npx eslint src/app/dashboard/bookings/page.tsx src/components/dashboard/booking-row-actions.tsx`
Expected: sin errores (arreglá imports sin uso si lint los marca).

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/bookings/page.tsx
git commit -m "Migrate Reservas desktop table to unified pattern"
```

---

### Task 10: Cambiar el breakpoint móvil de Reservas y usar StatusBadge en la card

**Files:**
- Modify: `src/app/dashboard/bookings/page.tsx:325`
- Modify: `src/components/dashboard/booking-card.tsx:23-29,+usos`

- [ ] **Step 1: Cambiar el contenedor móvil a `lg`**

En `src/app/dashboard/bookings/page.tsx`, la lista de cards (línea ~325):

```tsx
            <div className="space-y-4 lg:hidden">
```

- [ ] **Step 2: Reemplazar el badge hardcodeado en `booking-card.tsx`**

En `src/components/dashboard/booking-card.tsx`, borrar los objetos locales `statusLabels` y `statusBadgeClasses` (líneas ~15-29) y donde se renderiza el badge de estado, usar:

```tsx
import { StatusBadge } from '@/components/ui/status-badge'
// ...
<StatusBadge status={booking.status} />
```

Buscá en el archivo el uso de `statusLabels[...]` / `statusBadgeClasses[...]` y reemplazalo por `<StatusBadge status={booking.status} />`. Si `expired` u otro estado no estaba en el mapa local, ahora lo cubre `STATUS_MAPS.booking`.

- [ ] **Step 3: Verificar el test existente y tipos**

Run: `npx vitest --run tests/unit/booking-number-display.test.tsx`
Expected: PASS (el test de número de reserva sigue verde).
Run: `npx tsc --noEmit 2>&1 | grep -E "booking-card|bookings/page"`
Expected: sin líneas nuevas.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/bookings/page.tsx src/components/dashboard/booking-card.tsx
git commit -m "Switch Reservas to lg breakpoint and use StatusBadge in card"
```

---

### Task 11: Verificación visual + suite completa

**Files:** ninguno (verificación).

- [ ] **Step 1: Correr toda la suite unit**

Run: `npm run test:unit`
Expected: verde (incluye los nuevos `table-primitives` y `booking-row-actions`). El baseline de `tsc` no debe crecer por archivos tuyos.

- [ ] **Step 2: Verificación visual manual**

jsdom no mide layout, así que esto es a ojo. Levantá la app o revisá en Vercel preview la página `/dashboard/bookings` con datos reales y confirmá, redimensionando la ventana:
- A ~1280px: la tabla entra sin scroll horizontal; la columna Servicio/Cliente trunca con `…`; el hover muestra el nombre completo (`title`).
- A 1024px (justo en `lg`): sigue siendo tabla y no desborda; bajo 1024px cambia a cards.
- El kebab abre; "Cancelar" y "Registrar pago" abren su diálogo **y el diálogo no se cierra solo** (validación del fix de Radix).
- "Completar" (reserva confirmada) marca la reserva como completada.

Dejá anotado en el PR qué anchos verificaste.

- [ ] **Step 3: Commit final / abrir PR**

No hay cambios de código nuevos; abrir el PR con el resumen de tareas 1–11 y la nota de verificación visual. El merge lo hace el usuario.

---

## Self-Review

**Cobertura del spec (PR1):** `<Table fixed>` (T2), `<StatusBadge>` + dedup (T3, T10), `<TruncatedCell>` truncado CSS con `title` (T4), `<TableActions>` primaria+kebab (T5), regla de acciones con casos borde (T8), landmine Radix con diálogos izados (T6–T8), constantes de ancho + piso (T1, T9), breakpoint `lg` (T10), truncado CSS-no-JS (T4). `<TableMobileCard>` y la migración de las otras 13 tablas quedan **fuera de PR1** a propósito (se planifican tras validar las APIs con el piloto) — el spec las cubre en PR2/PR3.

**Placeholders:** sin TBD; cada step de código trae el código real. Las dos notas de "verificá el shape/variante" son verificaciones dirigidas contra archivos concretos, no placeholders.

**Consistencia de tipos:** `TABLE_COL`/`TABLE_MIN_WIDTH` (T1) se usan igual en T9. `StatusBadge`/`status` props (T3) consistentes en T9/T10. `hideTrigger`/`open`/`onOpenChange` idénticos en T6, T7 y consumidos igual en T8. `BookingRowActions` props (`booking`, `businessCurrency`, `contact`) definidos en T8 y usados igual en T9.

**Riesgo abierto conocido:** `updateBookingStatus.bind(null, id, 'completed')` como `form action` — si el runtime lo rechaza, el fallback (pasar el `<form>` desde el Server Component como prop `primary`) está documentado en T8/Step 3.
