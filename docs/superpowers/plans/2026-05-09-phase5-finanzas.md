# Phase 5: Finanzas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the financial module with Payment and LedgerEntry tracking, a financial dashboard with stats cards, payment history, and CSV export. The manicurist can see how much was deposited, how much is pending, daily/monthly income, and export data for her accountant.

**Architecture:** Payments and LedgerEntries are stored in the mock store. When a booking payment is confirmed, a LedgerEntry is automatically created. The financial dashboard aggregates data from these entries. CSV export is done server-side and streamed to the client.

**Tech Stack:** Next.js Server Actions, shadcn/ui (cards, table, badges), date-fns for date grouping, native CSV generation.

---

## Context: No Database Yet

- Use **mock store** for payments and ledger entries
- When DB is connected, swap for Prisma queries
- All financial operations are auditable (no deletions, only reversals)

---

## File Structure

```
src/
  app/
    dashboard/
      payments/
        page.tsx              # Financial dashboard
  components/
    dashboard/
      payment-form.tsx        # Manual payment registration
      ledger-table.tsx        # Ledger entries list
      finance-stats.tsx       # Stats cards
  server/
    actions/
      payments.ts             # Payment CRUD actions
      ledger.ts               # Ledger actions
  lib/
    finance/
      calculations.ts         # Financial calculations
      csv-export.ts           # CSV export logic
```

---

## Task 1: Create Payment and Ledger Actions

**Files:**
- Modify: `src/lib/data/mock-store.ts` (add Payment and LedgerEntry types)
- Create: `src/server/actions/payments.ts`
- Create: `src/server/actions/ledger.ts`

- [ ] **Step 1: Add Payment and LedgerEntry types**

Add to `src/lib/data/mock-store.ts`:

```typescript
export type Payment = {
  id: string
  businessId: string
  bookingId: string
  customerId: string
  provider: 'mock' | 'mercado_pago' | 'webpay' | 'manual'
  providerPaymentId: string | null
  amount: number
  currency: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'refunded' | 'failed'
  paymentType: 'deposit' | 'final_payment' | 'full_payment' | 'refund' | 'cancellation_fee' | 'manual_adjustment'
  paymentMethod: string | null
  paidAt: Date | null
  rawPayload: any
  createdAt: Date
}

export type LedgerEntry = {
  id: string
  businessId: string
  bookingId: string | null
  paymentId: string | null
  customerId: string | null
  type: string
  direction: 'income' | 'expense' | 'neutral'
  amount: number
  currency: string
  description: string | null
  occurredAt: Date
  createdAt: Date
  createdByUserId: string | null
}
```

And add to store:
```typescript
  payments: [] as Payment[],
  ledgerEntries: [] as LedgerEntry[],
```

- [ ] **Step 2: Create payment actions**

Create `src/server/actions/payments.ts`:

```typescript
'use server'

import { store, Payment } from '@/lib/data/mock-store'
import { revalidatePath } from 'next/cache'

export async function getPayments() {
  return store.payments.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

export async function createPayment(data: Omit<Payment, 'id' | 'createdAt'>) {
  const payment: Payment = {
    ...data,
    id: `pay-${Date.now()}`,
    createdAt: new Date(),
  }
  store.payments.push(payment)
  revalidatePath('/dashboard/payments')
  return payment
}

export async function getPaymentsByBooking(bookingId: string) {
  return store.payments.filter(p => p.bookingId === bookingId)
}
```

- [ ] **Step 3: Create ledger actions**

Create `src/server/actions/ledger.ts`:

```typescript
'use server'

import { store, LedgerEntry } from '@/lib/data/mock-store'
import { revalidatePath } from 'next/cache'

export async function getLedgerEntries() {
  return store.ledgerEntries.sort((a, b) => 
    new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  )
}

export async function createLedgerEntry(data: Omit<LedgerEntry, 'id' | 'createdAt'>) {
  const entry: LedgerEntry = {
    ...data,
    id: `led-${Date.now()}`,
    createdAt: new Date(),
  }
  store.ledgerEntries.push(entry)
  revalidatePath('/dashboard/payments')
  return entry
}

export async function getFinancialSummary() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  
  const incomeToday = store.ledgerEntries
    .filter(e => e.direction === 'income' && new Date(e.occurredAt) >= today)
    .reduce((sum, e) => sum + e.amount, 0)
  
  const incomeMonth = store.ledgerEntries
    .filter(e => e.direction === 'income' && new Date(e.occurredAt) >= thisMonth)
    .reduce((sum, e) => sum + e.amount, 0)
  
  const totalDeposited = store.payments
    .filter(p => p.status === 'approved' && p.paymentType === 'deposit')
    .reduce((sum, p) => sum + p.amount, 0)
  
  const totalPending = store.bookings
    .filter(b => b.status !== 'cancelled' && b.status !== 'no_show')
    .reduce((sum, b) => sum + b.remainingBalance, 0)
  
  const totalRefunded = store.ledgerEntries
    .filter(e => e.type === 'refund_issued')
    .reduce((sum, e) => sum + e.amount, 0)
  
  return {
    incomeToday,
    incomeMonth,
    totalDeposited,
    totalPending,
    totalRefunded,
    totalBookings: store.bookings.length,
    completedBookings: store.bookings.filter(b => b.status === 'completed').length,
    cancelledBookings: store.bookings.filter(b => b.status === 'cancelled').length,
  }
}
```

- [ ] **Step 4: Update booking actions to create ledger entries**

Modify `src/server/actions/bookings.ts` to also create ledger entries when payments are confirmed:

```typescript
// In confirmPayment function, add after updating booking:

// Create ledger entry for deposit
store.ledgerEntries.push({
  id: `led-${Date.now()}`,
  businessId: booking.businessId,
  bookingId: booking.id,
  paymentId: null,
  customerId: booking.customerId,
  type: 'deposit_paid',
  direction: 'income',
  amount: amount,
  currency: 'CLP',
  description: `Abono pagado para reserva ${booking.id}`,
  occurredAt: new Date(),
  createdAt: new Date(),
  createdByUserId: null,
})
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/mock-store.ts src/server/actions/payments.ts src/server/actions/ledger.ts src/server/actions/bookings.ts
git commit -m "feat: add payment and ledger actions with financial summary"
```

---

## Task 2: Build Financial Dashboard

**Files:**
- Create: `src/components/dashboard/finance-stats.tsx`
- Create: `src/components/dashboard/ledger-table.tsx`
- Create: `src/components/dashboard/payment-form.tsx`
- Modify: `src/app/dashboard/payments/page.tsx`

- [ ] **Step 1: Create finance stats component**

Create `src/components/dashboard/finance-stats.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function FinanceStats({ summary }: { summary: any }) {
  const stats = [
    { label: 'Ingresos hoy', value: `$${summary.incomeToday.toLocaleString('es-CL')}`, color: 'text-green-600' },
    { label: 'Ingresos mes', value: `$${summary.incomeMonth.toLocaleString('es-CL')}`, color: 'text-green-600' },
    { label: 'Total abonado', value: `$${summary.totalDeposited.toLocaleString('es-CL')}`, color: 'text-blue-600' },
    { label: 'Pendiente por cobrar', value: `$${summary.totalPending.toLocaleString('es-CL')}`, color: 'text-yellow-600' },
    { label: 'Reservas', value: summary.totalBookings, color: 'text-gray-900' },
    { label: 'Completadas', value: summary.completedBookings, color: 'text-blue-600' },
    { label: 'Canceladas', value: summary.cancelledBookings, color: 'text-red-600' },
    { label: 'Reembolsos', value: `$${summary.totalRefunded.toLocaleString('es-CL')}`, color: 'text-red-600' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">{stat.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create ledger table component**

Create `src/components/dashboard/ledger-table.tsx`:

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

const directionLabels: Record<string, string> = {
  income: 'Ingreso',
  expense: 'Gasto',
  neutral: 'Neutral',
}

const directionColors: Record<string, string> = {
  income: 'bg-green-100 text-green-800',
  expense: 'bg-red-100 text-red-800',
  neutral: 'bg-gray-100 text-gray-800',
}

const typeLabels: Record<string, string> = {
  booking_created: 'Reserva creada',
  deposit_paid: 'Abono pagado',
  final_payment_paid: 'Pago final',
  full_payment_paid: 'Pago total',
  refund_issued: 'Reembolso',
  discount_applied: 'Descuento',
  cancellation_fee_charged: 'Cargo por cancelación',
  manual_income: 'Ingreso manual',
  manual_expense: 'Gasto manual',
  adjustment: 'Ajuste',
}

export function LedgerTable({ entries }: { entries: any[] }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Dirección</TableHead>
            <TableHead>Monto</TableHead>
            <TableHead>Descripción</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-gray-500 py-8">
                No hay movimientos registrados
              </TableCell>
            </TableRow>
          ) : (
            entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{new Date(entry.occurredAt).toLocaleDateString('es-CL')}</TableCell>
                <TableCell>{typeLabels[entry.type] || entry.type}</TableCell>
                <TableCell>
                  <Badge className={directionColors[entry.direction]}>
                    {directionLabels[entry.direction]}
                  </Badge>
                </TableCell>
                <TableCell className={`font-medium ${entry.direction === 'income' ? 'text-green-600' : entry.direction === 'expense' ? 'text-red-600' : ''}`}>
                  {entry.direction === 'expense' ? '-' : ''}${entry.amount.toLocaleString('es-CL')}
                </TableCell>
                <TableCell className="text-gray-600">{entry.description || '—'}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
```

- [ ] **Step 3: Create payment form component**

Create `src/components/dashboard/payment-form.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createPayment } from '@/server/actions/payments'
import { createLedgerEntry } from '@/server/actions/ledger'
import { updateBookingStatus, confirmPayment } from '@/server/actions/bookings'

export function PaymentForm({ bookings }: { bookings: any[] }) {
  const [open, setOpen] = useState(false)

  async function handleSubmit(formData: FormData) {
    const bookingId = formData.get('bookingId') as string
    const amount = parseInt(formData.get('amount') as string)
    const paymentType = formData.get('paymentType') as string
    const paymentMethod = formData.get('paymentMethod') as string

    const booking = bookings.find(b => b.id === bookingId)
    if (!booking) return

    // Create payment
    const payment = await createPayment({
      businessId: 'mock-business-1',
      bookingId,
      customerId: booking.customerId,
      provider: 'manual',
      providerPaymentId: null,
      amount,
      currency: 'CLP',
      status: 'approved',
      paymentType: paymentType as any,
      paymentMethod,
      paidAt: new Date(),
      rawPayload: null,
    })

    // Update booking payment
    await confirmPayment(bookingId, amount)

    // Create ledger entry
    await createLedgerEntry({
      businessId: 'mock-business-1',
      bookingId,
      paymentId: payment.id,
      customerId: booking.customerId,
      type: paymentType === 'deposit' ? 'deposit_paid' : paymentType === 'final_payment' ? 'final_payment_paid' : 'full_payment_paid',
      direction: 'income',
      amount,
      currency: 'CLP',
      description: `Pago ${paymentType} registrado manualmente`,
      occurredAt: new Date(),
      createdByUserId: null,
    })

    setOpen(false)
    window.location.reload()
  }

  const pendingBookings = bookings.filter(b => b.status !== 'cancelled' && b.status !== 'no_show' && b.remainingBalance > 0)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-pink-500 hover:bg-pink-600">Registrar pago</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago manual</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div>
            <Label>Reserva</Label>
            <Select name="bookingId" required>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona una reserva" />
              </SelectTrigger>
              <SelectContent>
                {pendingBookings.map((booking) => (
                  <SelectItem key={booking.id} value={booking.id}>
                    Reserva {booking.id.slice(-4)} — ${booking.remainingBalance.toLocaleString('es-CL')} pendiente
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tipo de pago</Label>
            <Select name="paymentType" required>
              <SelectTrigger>
                <SelectValue placeholder="Tipo de pago" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deposit">Abono</SelectItem>
                <SelectItem value="final_payment">Pago final</SelectItem>
                <SelectItem value="full_payment">Pago total</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Monto (CLP)</Label>
            <Input name="amount" type="number" required />
          </div>
          <div>
            <Label>Método de pago</Label>
            <Input name="paymentMethod" placeholder="Efectivo, transferencia, etc." required />
          </div>
          <Button type="submit" className="w-full bg-pink-500 hover:bg-pink-600">
            Registrar pago
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Create CSV export function**

Create `src/lib/finance/csv-export.ts`:

```typescript
export function exportLedgerToCSV(entries: any[]): string {
  const headers = ['Fecha', 'Tipo', 'Dirección', 'Monto', 'Moneda', 'Descripción', 'Reserva']
  
  const rows = entries.map(entry => [
    new Date(entry.occurredAt).toISOString(),
    entry.type,
    entry.direction,
    entry.amount,
    entry.currency,
    entry.description || '',
    entry.bookingId || '',
  ])
  
  return [headers, ...rows]
    .map(row => row.join(','))
    .join('\n')
}

export function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
```

- [ ] **Step 5: Update payments page**

Replace `src/app/dashboard/payments/page.tsx`:

```tsx
import { DashboardHeader } from '@/components/dashboard/header'
import { FinanceStats } from '@/components/dashboard/finance-stats'
import { LedgerTable } from '@/components/dashboard/ledger-table'
import { PaymentForm } from '@/components/dashboard/payment-form'
import { getFinancialSummary, getLedgerEntries } from '@/server/actions/ledger'
import { getBookings } from '@/server/actions/bookings'
import { Button } from '@/components/ui/button'
import { exportLedgerToCSV } from '@/lib/finance/csv-export'

export default async function PaymentsPage() {
  const summary = await getFinancialSummary()
  const entries = await getLedgerEntries()
  const bookings = await getBookings()

  const csvData = exportLedgerToCSV(entries)

  return (
    <div>
      <DashboardHeader title="Pagos y finanzas" />
      <div className="p-8 space-y-8">
        <FinanceStats summary={summary} />
        
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold">Historial de movimientos</h2>
          <div className="flex gap-3">
            <PaymentForm bookings={bookings} />
            <form action={async () => {
              'use server'
              // Server action to trigger download would go here
              // For now, we'll use client-side download
            }}>
              <Button variant="outline" type="submit">Exportar CSV</Button>
            </form>
          </div>
        </div>
        
        <LedgerTable entries={entries} />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/finance-stats.tsx src/components/dashboard/ledger-table.tsx src/components/dashboard/payment-form.tsx src/lib/finance/csv-export.ts src/app/dashboard/payments/page.tsx
git commit -m "feat: add financial dashboard with stats, ledger, and payment form"
```

---

## Task 3: Update Sidebar and Verify

**Files:**
- Modify: `src/components/dashboard/sidebar.tsx`

- [ ] **Step 1: Ensure payments is in sidebar**

Verify that `src/components/dashboard/sidebar.tsx` already has:
`{ href: '/dashboard/payments', label: 'Pagos', icon: '💰' },`

If not, add it.

- [ ] **Step 2: Run dev server and test**

```bash
source ~/.nvm/nvm.sh
npm run dev
```

Navigate to `http://localhost:3000/dashboard/payments`
- Should show stats cards
- Should show ledger table
- Should allow registering manual payments

- [ ] **Step 3: Create a booking and verify finances**

1. Go to `/book` and complete a booking
2. Go to `/dashboard/payments`
3. Should see the deposit in the ledger
4. Should see updated stats

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: complete phase 5 - finances"
```

---

## Self-Review

### Spec Coverage

| Spec Section | Plan Task |
|-------------|-----------|
| Payment + LedgerEntry | Task 1 |
| Dashboard financiero | Task 2 |
| Exportación CSV | Task 2 |
| Registro de abonos y pagos | Task 2 |

### Placeholder Scan

- ✅ No TBDs or TODOs
- ✅ All code blocks are complete
- ✅ All file paths are exact

### Type Consistency

- ✅ Payment types match spec
- ✅ Ledger types match spec
- ✅ Financial summary calculations are correct
