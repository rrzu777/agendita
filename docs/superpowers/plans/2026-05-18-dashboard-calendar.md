# Dashboard Calendar Real Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/dashboard/calendar` into an operational tool that loads real bookings and time blocks for the authenticated business, shows a monthly grid with status dots, and displays a daily agenda with quick actions.

**Architecture:** Server Component page fetches bookings and time blocks for the visible month (grouped by day in the business timezone) and renders a server-side `CalendarGrid` with month navigation via query params. A client `DayPanel` receives the serialized arrays, filters by selected date (`?date`), and renders `BookingCard`s and `TimeBlockCard`s. A `BookingDrawer` (Sheet) handles detail view and manual payment registration.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, shadcn/ui (Sheet, Button, Badge, Input, Label, Select), date-fns/date-fns-tz, Prisma, Vitest.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/calendar/group-by-day.ts` | Pure helper: groups an array of items by local date key using a timezone. |
| `tests/unit/group-by-day.test.ts` | Tests for the grouping helper. |
| `src/server/actions/bookings.ts` | Add `getBookingsByRange` and `registerManualPayment`. Modify `updateBookingStatus` revalidation. |
| `tests/unit/get-bookings-by-range.test.ts` | Tests for `getBookingsByRange`. |
| `src/server/actions/time-blocks.ts` | Add `getTimeBlocksByRange`. |
| `tests/unit/get-time-blocks-by-range.test.ts` | Tests for `getTimeBlocksByRange`. |
| `src/components/dashboard/calendar-grid.tsx` | Server Component: monthly grid with status dots, counts, and month navigation links. |
| `src/components/dashboard/booking-card.tsx` | Client Component: compact card with booking info and quick-action buttons. |
| `src/components/dashboard/time-block-card.tsx` | Client Component: compact card showing a blocked time slot. |
| `src/components/dashboard/booking-drawer.tsx` | Client Component: Sheet drawer with full detail + inline manual payment form. |
| `src/components/dashboard/day-panel.tsx` | Client Component: filters bookings + time blocks for the selected day and renders sorted cards. |
| `src/app/dashboard/calendar/page.tsx` | Async Server Component: auth guard, fetches data, computes month range in business timezone, renders grid + panel. |
| `src/components/dashboard/calendar-view.tsx` | **Delete** — replaced by the new architecture. |

---

## Task 1: Add `groupBookingsByDay` helper

**Files:**
- Create: `src/lib/calendar/group-by-day.ts`
- Test: `tests/unit/group-by-day.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/group-by-day.test.ts
import { describe, it, expect } from 'vitest'
import { groupBookingsByDay } from '@/lib/calendar/group-by-day'

describe('groupBookingsByDay', () => {
  it('groups items by local day key using timezone', () => {
    const items = [
      { startDateTime: new Date('2026-05-18T04:00:00Z') }, // 00:00 CLT
      { startDateTime: new Date('2026-05-18T12:00:00Z') }, // 08:00 CLT
      { startDateTime: new Date('2026-05-19T04:00:00Z') }, // 00:00 CLT next day
    ]
    const result = groupBookingsByDay(items, 'America/Santiago')
    expect(Object.keys(result)).toEqual(['2026-05-18', '2026-05-19'])
    expect(result['2026-05-18'].length).toBe(2)
    expect(result['2026-05-19'].length).toBe(1)
  })

  it('returns empty object for empty input', () => {
    expect(groupBookingsByDay([], 'America/Santiago')).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/group-by-day.test.ts`
Expected: FAIL — `groupBookingsByDay` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/calendar/group-by-day.ts
import { formatInTimeZone } from 'date-fns-tz'

export function groupBookingsByDay<T extends { startDateTime: Date }>(
  items: T[],
  timeZone: string
): Record<string, T[]> {
  const result: Record<string, T[]> = {}
  for (const item of items) {
    const dayKey = formatInTimeZone(item.startDateTime, timeZone, 'yyyy-MM-dd')
    if (!result[dayKey]) result[dayKey] = []
    result[dayKey].push(item)
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/group-by-day.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/group-by-day.ts tests/unit/group-by-day.test.ts
git commit -m "feat(calendar): add groupBookingsByDay helper with tests"
```

---

## Task 2: Add `getBookingsByRange` server action

**Files:**
- Modify: `src/server/actions/bookings.ts`
- Test: `tests/unit/get-bookings-by-range.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/get-bookings-by-range.test.ts
import { describe, it, expect, vi } from 'vitest'
import { getBookingsByRange } from '@/server/actions/bookings'

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    booking: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'b1', status: 'confirmed', startDateTime: new Date('2026-05-18T10:00:00Z') },
      ]),
    },
  },
}))

describe('getBookingsByRange', () => {
  it('returns bookings filtered by business and date range', async () => {
    const result = await getBookingsByRange(
      new Date('2026-05-01'),
      new Date('2026-05-31')
    )
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('b1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/get-bookings-by-range.test.ts`
Expected: FAIL — `getBookingsByRange` not defined.

- [ ] **Step 3: Write minimal implementation**

Append to `src/server/actions/bookings.ts`:

```ts
export async function getBookingsByRange(start: Date, end: Date) {
  const { businessId } = await requireBusiness()
  return prisma.booking.findMany({
    where: {
      businessId,
      startDateTime: { gte: start, lte: end },
    },
    orderBy: { startDateTime: 'asc' },
    include: {
      service: true,
      customer: true,
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/get-bookings-by-range.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/bookings.ts tests/unit/get-bookings-by-range.test.ts
git commit -m "feat(bookings): add getBookingsByRange server action with test"
```

---

## Task 3: Add `getTimeBlocksByRange` server action

**Files:**
- Modify: `src/server/actions/time-blocks.ts`
- Test: `tests/unit/get-time-blocks-by-range.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/get-time-blocks-by-range.test.ts
import { describe, it, expect, vi } from 'vitest'
import { getTimeBlocksByRange } from '@/server/actions/time-blocks'

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    timeBlock: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'tb1', startDateTime: new Date('2026-05-18T10:00:00Z') },
      ]),
    },
  },
}))

describe('getTimeBlocksByRange', () => {
  it('returns time blocks filtered by business and date range overlap', async () => {
    const result = await getTimeBlocksByRange(
      new Date('2026-05-01'),
      new Date('2026-05-31')
    )
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('tb1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/get-time-blocks-by-range.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Append to `src/server/actions/time-blocks.ts`:

```ts
export async function getTimeBlocksByRange(start: Date, end: Date) {
  const { businessId } = await requireBusiness()
  return prisma.timeBlock.findMany({
    where: {
      businessId,
      OR: [
        { startDateTime: { gte: start, lte: end } },
        { endDateTime: { gte: start, lte: end } },
        { startDateTime: { lte: start }, endDateTime: { gte: end } },
      ],
    },
    orderBy: { startDateTime: 'asc' },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/get-time-blocks-by-range.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/time-blocks.ts tests/unit/get-time-blocks-by-range.test.ts
git commit -m "feat(time-blocks): add getTimeBlocksByRange server action with test"
```

---

## Task 4: Add `registerManualPayment` server action

**Files:**
- Modify: `src/server/actions/bookings.ts`

- [ ] **Step 1: Add imports and schema**

At the top of `src/server/actions/bookings.ts`, add to existing imports:

```ts
import { PaymentProvider, PaymentType } from '@prisma/client'
```

Add below existing schemas:

```ts
const registerManualPaymentSchema = z.object({
  bookingId: z.string().min(1),
  amount: z.number().positive(),
  paymentMethod: z.string().min(1).max(50),
})
```

- [ ] **Step 2: Implement the action**

Append to `src/server/actions/bookings.ts`:

```ts
export async function registerManualPayment(
  bookingId: string,
  amount: number,
  paymentMethod: string
) {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('register-manual-payment', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = registerManualPaymentSchema.safeParse({
    bookingId,
    amount,
    paymentMethod,
  })
  if (!parsed.success) {
    throw new Error(
      'Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', ')
    )
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    include: { service: true, customer: true },
  })
  if (!booking) throw new ForbiddenError('Reserva no encontrada')

  assertBookingPayable(booking)

  const paymentType =
    booking.depositPaid > 0 ? PaymentType.final_payment : PaymentType.full_payment

  const updated = await prisma.$transaction(async (tx) => {
    const { applyApprovedPayment } = await import('@/server/services/finance')
    return applyApprovedPayment({
      tx,
      bookingId,
      businessId,
      amount,
      currency: business.currency || 'CLP',
      provider: PaymentProvider.manual,
      providerPaymentId: null,
      paymentType,
      paymentMethod,
    })
  })

  revalidatePath('/dashboard/calendar')
  revalidatePath('/dashboard/bookings')
  await revalidateBusinessPublicPaths(businessId)
  return updated
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/actions/bookings.ts
git commit -m "feat(bookings): add registerManualPayment server action"
```

---

## Task 5: Update `updateBookingStatus` to revalidate calendar

**Files:**
- Modify: `src/server/actions/bookings.ts`

- [ ] **Step 1: Add revalidation path**

In `updateBookingStatus`, locate:

```ts
revalidatePath('/dashboard/bookings')
```

Replace with:

```ts
revalidatePath('/dashboard/bookings')
revalidatePath('/dashboard/calendar')
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/actions/bookings.ts
git commit -m "fix(bookings): revalidate calendar on status change"
```

---

## Task 6: Create `CalendarGrid` component

**Files:**
- Create: `src/components/dashboard/calendar-grid.tsx`

- [ ] **Step 1: Write component**

```tsx
// src/components/dashboard/calendar-grid.tsx
import Link from 'next/link'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  addMonths,
  subMonths,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const statusDotColors: Record<string, string> = {
  pending_payment: 'bg-orange-400',
  confirmed: 'bg-green-400',
  completed: 'bg-gray-400',
  cancelled: 'bg-gray-300',
  no_show: 'bg-red-400',
}

interface CalendarGridProps {
  bookingsByDay: Record<string, Array<{ status: string }>>
  currentMonth: Date
  selectedDate: string | null
}

export function CalendarGrid({ bookingsByDay, currentMonth, selectedDate }: CalendarGridProps) {
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(monthStart)
  const calendarStart = startOfWeek(monthStart, { locale: es })
  const calendarEnd = endOfWeek(monthEnd, { locale: es })
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  const prevMonth = format(subMonths(currentMonth, 1), 'yyyy-MM')
  const nextMonth = format(addMonths(currentMonth, 1), 'yyyy-MM')
  const currentMonthStr = format(currentMonth, 'yyyy-MM')

  const weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

  return (
    <div className="studio-card p-5 md:p-7">
      <div className="mb-6 flex items-center justify-between">
        <Button variant="outline" size="icon" asChild>
          <Link href={`/dashboard/calendar?month=${prevMonth}`} aria-label="Mes anterior">
            <ChevronLeft className="size-4" />
          </Link>
        </Button>
        <h2 className="text-2xl font-semibold capitalize tracking-normal text-primary">
          {format(currentMonth, 'MMMM yyyy', { locale: es })}
        </h2>
        <Button variant="outline" size="icon" asChild>
          <Link href={`/dashboard/calendar?month=${nextMonth}`} aria-label="Mes siguiente">
            <ChevronRight className="size-4" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
          >
            {day}
          </div>
        ))}
        {days.map((day) => {
          const dayKey = format(day, 'yyyy-MM-dd')
          const dayBookings = bookingsByDay[dayKey] || []
          const statusSet = new Set(dayBookings.map((b) => b.status))
          const isSelected = selectedDate === dayKey
          const isCurrentMonth = isSameMonth(day, currentMonth)

          return (
            <Link
              key={day.toISOString()}
              href={`/dashboard/calendar?date=${dayKey}&month=${currentMonthStr}`}
              className={`
                flex aspect-square flex-col items-center justify-center rounded-xl text-sm font-semibold transition-colors
                ${!isCurrentMonth ? 'text-muted-foreground/35' : 'text-primary'}
                ${isSelected ? 'bg-primary text-primary-foreground hover:bg-primary' : 'hover:bg-accent'}
              `}
            >
              <span>{format(day, 'd')}</span>
              {dayBookings.length > 0 && (
                <div className="mt-1 flex items-center gap-0.5">
                  {Array.from(statusSet)
                    .slice(0, 3)
                    .map((status) => (
                      <span
                        key={status}
                        className={`block size-1.5 rounded-full ${statusDotColors[status] || 'bg-gray-400'}`}
                      />
                    ))}
                  {dayBookings.length > 3 && (
                    <span className="text-[9px] leading-none text-muted-foreground">
                      +{dayBookings.length - 3}
                    </span>
                  )}
                </div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/calendar-grid.tsx
git commit -m "feat(calendar): add CalendarGrid server component"
```

---

## Task 7: Create `BookingCard` component

**Files:**
- Create: `src/components/dashboard/booking-card.tsx`

- [ ] **Step 1: Write component**

```tsx
// src/components/dashboard/booking-card.tsx
'use client'

import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { BookingDrawer } from './booking-drawer'
import { updateBookingStatus } from '@/server/actions/bookings'
import { CheckCircle, XCircle, UserX, CreditCard, Eye } from 'lucide-react'

const statusLabels: Record<string, string> = {
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
}

const statusBadgeClasses: Record<string, string> = {
  pending_payment: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-secondary text-secondary-foreground',
  cancelled: 'bg-muted text-muted-foreground',
  no_show: 'bg-destructive/10 text-destructive',
}

export type CalendarBooking = {
  id: string
  status: string
  startDateTime: string
  endDateTime: string
  service: { name: string } | null
  customer: { name: string } | null
  depositPaid: number
  finalAmount: number
  remainingBalance: number
  paymentStatus: string
  customerNotes?: string | null
  internalNotes?: string | null
}

interface BookingCardProps {
  booking: CalendarBooking
  businessCurrency: string
}

export function BookingCard({ booking, businessCurrency }: BookingCardProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const start = new Date(booking.startDateTime)
  const end = new Date(booking.endDateTime)

  function handleStatusChange(status: string) {
    startTransition(async () => {
      await updateBookingStatus(booking.id, status as any)
    })
  }

  const canComplete = booking.status === 'confirmed'
  const canCancel = booking.status === 'pending_payment' || booking.status === 'confirmed'
  const canNoShow = booking.status === 'confirmed'
  const canRegisterPayment = booking.status === 'confirmed' && booking.remainingBalance > 0

  return (
    <>
      <div className="rounded-xl border border-border/60 bg-background p-3 md:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-primary">
                {format(start, 'HH:mm', { locale: es })} - {format(end, 'HH:mm', { locale: es })}
              </span>
              <Badge className={statusBadgeClasses[booking.status] || ''}>
                {statusLabels[booking.status] || booking.status}
              </Badge>
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {booking.service?.name || 'Servicio desconocido'}
            </div>
            <div className="text-xs text-muted-foreground">
              {booking.customer?.name || '—'}
            </div>
            <div className="mt-1 text-xs">
              <span
                className={
                  booking.paymentStatus === 'fully_paid'
                    ? 'font-semibold text-green-700'
                    : 'font-semibold text-primary'
                }
              >
                ${booking.depositPaid.toLocaleString('es-CL')} / ${booking.finalAmount.toLocaleString('es-CL')}
              </span>
              {booking.remainingBalance > 0 && (
                <span className="ml-2 text-muted-foreground">
                  Saldo: ${booking.remainingBalance.toLocaleString('es-CL')} {businessCurrency}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {canComplete && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => handleStatusChange('completed')}
              disabled={isPending}
            >
              <CheckCircle className="mr-1 size-3" />
              Completar
            </Button>
          )}
          {canCancel && (
            <Button
              size="xs"
              variant="destructive"
              onClick={() => handleStatusChange('cancelled')}
              disabled={isPending}
            >
              <XCircle className="mr-1 size-3" />
              Cancelar
            </Button>
          )}
          {canNoShow && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => handleStatusChange('no_show')}
              disabled={isPending}
            >
              <UserX className="mr-1 size-3" />
              No asistió
            </Button>
          )}
          {canRegisterPayment && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => setDrawerOpen(true)}
              disabled={isPending}
            >
              <CreditCard className="mr-1 size-3" />
              Registrar pago
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={() => setDrawerOpen(true)}>
            <Eye className="mr-1 size-3" />
            Ver
          </Button>
        </div>
      </div>

      <BookingDrawer
        booking={booking}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        businessCurrency={businessCurrency}
      />
    </>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/booking-card.tsx
git commit -m "feat(calendar): add BookingCard component"
```

---

## Task 8: Create `TimeBlockCard` component

**Files:**
- Create: `src/components/dashboard/time-block-card.tsx`

- [ ] **Step 1: Write component**

```tsx
// src/components/dashboard/time-block-card.tsx
'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Lock } from 'lucide-react'

export type CalendarTimeBlock = {
  id: string
  startDateTime: string
  endDateTime: string
  reason?: string | null
}

interface TimeBlockCardProps {
  timeBlock: CalendarTimeBlock
}

export function TimeBlockCard({ timeBlock }: TimeBlockCardProps) {
  const start = new Date(timeBlock.startDateTime)
  const end = new Date(timeBlock.endDateTime)

  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-muted-foreground/30 bg-muted/30 p-3 md:p-4">
      <Lock className="size-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-muted-foreground">
          {format(start, 'HH:mm', { locale: es })} - {format(end, 'HH:mm', { locale: es })}
        </div>
        {timeBlock.reason && (
          <div className="text-xs text-muted-foreground">{timeBlock.reason}</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/time-block-card.tsx
git commit -m "feat(calendar): add TimeBlockCard component"
```

---

## Task 9: Create `BookingDrawer` component

**Files:**
- Create: `src/components/dashboard/booking-drawer.tsx`

- [ ] **Step 1: Write hook and component**

```tsx
// src/components/dashboard/booking-drawer.tsx
'use client'

import { useState, useTransition, useEffect } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { registerManualPayment } from '@/server/actions/bookings'
import type { CalendarBooking } from './booking-card'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 640px)')
    setIsMobile(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return isMobile
}

const statusLabels: Record<string, string> = {
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
}

const statusBadgeClasses: Record<string, string> = {
  pending_payment: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-secondary text-secondary-foreground',
  cancelled: 'bg-muted text-muted-foreground',
  no_show: 'bg-destructive/10 text-destructive',
}

interface BookingDrawerProps {
  booking: CalendarBooking
  open: boolean
  onOpenChange: (open: boolean) => void
  businessCurrency: string
}

export function BookingDrawer({ booking, open, onOpenChange, businessCurrency }: BookingDrawerProps) {
  const isMobile = useIsMobile()
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const start = new Date(booking.startDateTime)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const numAmount = Number(amount)
    if (!numAmount || numAmount <= 0) {
      setError('Monto inválido')
      return
    }
    if (!paymentMethod) {
      setError('Selecciona un método de pago')
      return
    }

    startTransition(async () => {
      try {
        await registerManualPayment(booking.id, numAmount, paymentMethod)
        setAmount('')
        setPaymentMethod('')
        onOpenChange(false)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error al registrar pago'
        setError(message)
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className="h-auto max-h-[85vh] sm:max-h-full">
        <SheetHeader>
          <SheetTitle>Detalle de reserva</SheetTitle>
          <SheetDescription>
            {booking.service?.name} — {format(start, "EEEE d 'de' MMMM, HH:mm", { locale: es })}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 overflow-y-auto p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Estado</span>
            <Badge className={statusBadgeClasses[booking.status] || ''}>
              {statusLabels[booking.status] || booking.status}
            </Badge>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Cliente</span>
            <span className="text-sm font-medium">{booking.customer?.name || '—'}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Pagado</span>
            <span className="text-sm font-medium">
              ${booking.depositPaid.toLocaleString('es-CL')} {businessCurrency}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-sm font-medium">
              ${booking.finalAmount.toLocaleString('es-CL')} {businessCurrency}
            </span>
          </div>

          {booking.remainingBalance > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Saldo pendiente</span>
              <span className="text-sm font-semibold text-destructive">
                ${booking.remainingBalance.toLocaleString('es-CL')} {businessCurrency}
              </span>
            </div>
          )}

          {booking.customerNotes && (
            <div>
              <span className="text-sm text-muted-foreground">Notas del cliente</span>
              <p className="mt-1 text-sm">{booking.customerNotes}</p>
            </div>
          )}

          {booking.remainingBalance > 0 && booking.status === 'confirmed' && (
            <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-border/60 p-3">
              <h4 className="text-sm font-semibold">Registrar pago</h4>
              <div>
                <Label htmlFor="amount">Monto</Label>
                <Input
                  id="amount"
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={`Máx ${booking.remainingBalance}`}
                />
              </div>
              <div>
                <Label htmlFor="method">Método</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="method">
                    <SelectValue placeholder="Selecciona método" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="efectivo">Efectivo</SelectItem>
                    <SelectItem value="transferencia">Transferencia</SelectItem>
                    <SelectItem value="tarjeta">Tarjeta</SelectItem>
                    <SelectItem value="otro">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? 'Registrando...' : 'Registrar pago'}
              </Button>
            </form>
          )}
        </div>

        <SheetFooter className="p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
            Cerrar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/booking-drawer.tsx
git commit -m "feat(calendar): add BookingDrawer with manual payment form"
```

---

## Task 10: Create `DayPanel` component

**Files:**
- Create: `src/components/dashboard/day-panel.tsx`

- [ ] **Step 1: Write component**

```tsx
// src/components/dashboard/day-panel.tsx
'use client'

import { useMemo } from 'react'
import { format, compareAsc } from 'date-fns'
import { es } from 'date-fns/locale'
import { BookingCard, type CalendarBooking } from './booking-card'
import { TimeBlockCard, type CalendarTimeBlock } from './time-block-card'

interface DayPanelProps {
  bookings: CalendarBooking[]
  timeBlocks: CalendarTimeBlock[]
  selectedDate: string | null
  businessCurrency: string
}

export function DayPanel({ bookings, timeBlocks, selectedDate, businessCurrency }: DayPanelProps) {
  const items = useMemo(() => {
    if (!selectedDate) return []
    const dayBookings = bookings
      .filter((b) => {
        const d = new Date(b.startDateTime)
        return format(d, 'yyyy-MM-dd') === selectedDate
      })
      .map((b) => ({ ...b, type: 'booking' as const }))

    const dayBlocks = timeBlocks
      .filter((tb) => {
        const d = new Date(tb.startDateTime)
        return format(d, 'yyyy-MM-dd') === selectedDate
      })
      .map((tb) => ({ ...tb, type: 'timeBlock' as const }))

    return [...dayBookings, ...dayBlocks].sort((a, b) =>
      compareAsc(new Date(a.startDateTime), new Date(b.startDateTime))
    )
  }, [bookings, timeBlocks, selectedDate])

  if (!selectedDate) {
    return (
      <div className="mt-6 rounded-xl border border-border/60 bg-muted/40 p-5">
        <p className="text-sm text-muted-foreground">Selecciona un día para ver la agenda</p>
      </div>
    )
  }

  const headerDate = new Date(`${selectedDate}T00:00:00`)

  if (items.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-border/60 bg-muted/40 p-5">
        <h3 className="mb-2 font-semibold text-primary">
          {format(headerDate, "EEEE d 'de' MMMM", { locale: es })}
        </h3>
        <p className="text-sm text-muted-foreground">No hay reservas para este día</p>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-3">
      <h3 className="font-semibold text-primary">
        {format(headerDate, "EEEE d 'de' MMMM", { locale: es })}
      </h3>
      {items.map((item) =>
        item.type === 'booking' ? (
          <BookingCard key={item.id} booking={item} businessCurrency={businessCurrency} />
        ) : (
          <TimeBlockCard key={item.id} timeBlock={item} />
        )
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/day-panel.tsx
git commit -m "feat(calendar): add DayPanel client component"
```

---

## Task 11: Rewrite `CalendarPage`

**Files:**
- Modify: `src/app/dashboard/calendar/page.tsx`
- Delete: `src/components/dashboard/calendar-view.tsx`

- [ ] **Step 1: Rewrite page**

Replace the entire contents of `src/app/dashboard/calendar/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { CalendarGrid } from '@/components/dashboard/calendar-grid'
import { DayPanel } from '@/components/dashboard/day-panel'
import { getBookingsByRange } from '@/server/actions/bookings'
import { getTimeBlocksByRange } from '@/server/actions/time-blocks'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { startOfMonth, endOfMonth, parseISO } from 'date-fns'
import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz'
import { groupBookingsByDay } from '@/lib/calendar/group-by-day'

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; date?: string }>
}) {
  const userData = await getCurrentUserWithBusiness()
  if (!userData?.business) {
    redirect('/login')
  }

  const business = userData.business
  const timezone = business.timezone || 'America/Santiago'

  const params = await searchParams
  const monthParam = params.month
  const baseDate = monthParam ? parseISO(`${monthParam}-01`) : new Date()
  const currentMonth = startOfMonth(baseDate)

  const zonedNow = utcToZonedTime(currentMonth, timezone)
  const monthStart = zonedTimeToUtc(startOfMonth(zonedNow), timezone)
  const monthEnd = zonedTimeToUtc(endOfMonth(zonedNow), timezone)

  const [bookings, timeBlocks] = await Promise.all([
    getBookingsByRange(monthStart, monthEnd),
    getTimeBlocksByRange(monthStart, monthEnd),
  ])

  const bookingsByDay = groupBookingsByDay(bookings, timezone)
  const timeBlocksByDay = groupBookingsByDay(timeBlocks, timezone)

  const selectedDate = params.date || null

  return (
    <div>
      <DashboardHeader
        title="Calendario"
        subtitle="Vista mensual para revisar disponibilidad y citas."
      />
      <div className="max-w-4xl p-5 md:p-10">
        <CalendarGrid
          bookingsByDay={bookingsByDay}
          currentMonth={currentMonth}
          selectedDate={selectedDate}
        />
        <DayPanel
          bookings={bookings}
          timeBlocks={timeBlocks}
          selectedDate={selectedDate}
          businessCurrency={business.currency}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Delete old component**

```bash
rm src/components/dashboard/calendar-view.tsx
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/calendar/page.tsx src/components/dashboard/calendar-view.tsx
git commit -m "feat(calendar): integrate real data into CalendarPage"
```

---

## Task 12: Build verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing + new).

- [ ] **Step 2: Run Next.js build**

Run: `npm run build`
Expected: Build succeeds with zero errors.

- [ ] **Step 3: Final commit**

```bash
git commit --allow-empty -m "chore(calendar): complete dashboard calendar implementation"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] Calendar loads real bookings — `getBookingsByRange` + `CalendarPage`.
- [x] Indicators by day (count + status dots) — `CalendarGrid`.
- [x] Day selection shows time, service, client, status, payment, balance — `DayPanel` + `BookingCard`.
- [x] Quick actions (complete, cancel, no-show, register payment, view detail) — `BookingCard` + `BookingDrawer`.
- [x] Daily agenda with time blocks — `DayPanel` includes `TimeBlockCard`.
- [x] Auth security (only authenticated business, no client-provided businessId) — all actions use `requireBusiness()`.
- [x] Mobile UX (compact grid, day list below, readable cards) — responsive classes in all components.

**2. Placeholder scan:**
- [x] No TBD/TODO/fill-in-details.
- [x] Every step includes exact code or exact command.

**3. Type consistency:**
- [x] `CalendarBooking` type is exported from `booking-card.tsx` and imported by `booking-drawer.tsx` and `day-panel.tsx`.
- [x] `CalendarTimeBlock` type is exported from `time-block-card.tsx` and imported by `day-panel.tsx`.
- [x] Server actions return Prisma-included types that serialize correctly through Server → Client boundary.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-18-dashboard-calendar.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach do you prefer?
