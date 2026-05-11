# Conectar Base de Datos Real (Supabase + Prisma)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar de mock-store en memoria a PostgreSQL real en Supabase usando Prisma ORM

**Architecture:** Crear un singleton de PrismaClient, reemplazar gradualmente las importaciones de `mock-store` por consultas Prisma en los server actions, y ejecutar `prisma db push` + seed.

**Tech Stack:** Next.js 16, Prisma 5, Supabase PostgreSQL, TypeScript

---

## Prerrequisitos del Usuario

Antes de empezar, necesitas:
1. Una cuenta en [supabase.com](https://supabase.com)
2. Crear un nuevo proyecto en Supabase
3. Obtener las credenciales del proyecto (URL, anon key, service role key)
4. Obtener la connection string de PostgreSQL (Database Settings > Connection String > URI)

---

## Task 1: Configurar Variables de Entorno

**Files:**
- Create: `.env.local`

**Objetivo:** Configurar las credenciales de Supabase para conectar Prisma.

- [ ] **Step 1: Crear `.env.local` con las credenciales**

Copia `.env.example` a `.env.local` y rellena con tus credenciales reales de Supabase:

```bash
# Database (reemplaza [YOUR-PROJECT-REF] y [YOUR-PASSWORD] con valores reales)
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"

# Supabase
NEXT_PUBLIC_SUPABASE_URL="https://[YOUR-PROJECT-REF].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="[YOUR-ANON-KEY]"
SUPABASE_SERVICE_ROLE_KEY="[YOUR-SERVICE-ROLE-KEY]"

# App
NEXT_PUBLIC_APP_DOMAIN="localhost:3000"
APP_DOMAIN="localhost:3000"
```

**Nota importante:** Usa `DIRECT_URL` en el schema de Prisma para migraciones (puerto 5432) y `DATABASE_URL` para la app con PgBouncer (puerto 6543).

---

## Task 2: Crear PrismaClient Singleton

**Files:**
- Create: `src/lib/db.ts`

**Objetivo:** Crear una única instancia de PrismaClient que se reutilice en hot reloads.

- [ ] **Step 2: Crear singleton de PrismaClient**

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

---

## Task 3: Actualizar Schema de Prisma para Supabase

**Files:**
- Modify: `prisma/schema.prisma`

**Objetivo:** Asegurar que el schema usa `directUrl` correctamente para migraciones.

- [ ] **Step 3: Verificar/actualizar datasource**

El schema ya debería tener:
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

Si no lo tiene, agrégalo.

---

## Task 4: Crear Tablas en Supabase

**Objetivo:** Ejecutar `prisma db push` para crear todas las tablas y enums en la base de datos real.

- [ ] **Step 4: Push del schema a Supabase**

Comando:
```bash
npx prisma db push
```

Expected output:
```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "postgres" at "db.[ref].supabase.co:5432"

PostgreSQL database postgres created at db.[ref].supabase.co:5432

🚀  Your database is now in sync with your Prisma schema. Done in 1.23s
```

---

## Task 5: Poblar Datos Iniciales (Seed)

**Files:**
- Modify: `prisma/seed.ts` (si es necesario)

**Objetivo:** Ejecutar el seed para crear el negocio de ejemplo, servicios y reglas de disponibilidad.

- [ ] **Step 5: Ejecutar seed**

Comando:
```bash
npx prisma db seed
```

O alternativamente:
```bash
ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
```

Expected output:
```
Seed completed successfully
```

---

## Task 6: Migrar Server Actions a Prisma (Fase 1 - Servicios)

**Files:**
- Modify: `src/server/actions/services.ts`

**Objetivo:** Reemplazar `store` por `prisma` en las operaciones de servicios.

- [ ] **Step 6: Actualizar services.ts para usar Prisma**

Reemplazar:
```typescript
import { store, Service } from '@/lib/data/mock-store'
```
Por:
```typescript
import { prisma } from '@/lib/db'
import type { Service } from '@prisma/client'
```

Reemplazar `getServices()`:
```typescript
export async function getServices() {
  return prisma.service.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
}
```

Reemplazar `createService()`:
```typescript
export async function createService(data: Omit<Service, 'id' | 'createdAt' | 'updatedAt'>) {
  const limit = checkRateLimit('create-service', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createServiceSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const newService = await prisma.service.create({ data })
  revalidatePath('/dashboard/services')
  return newService
}
```

Reemplazar `updateService()`:
```typescript
export async function updateService(id: string, data: Partial<Service>) {
  const limit = checkRateLimit('update-service', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateServiceSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const updated = await prisma.service.update({
    where: { id },
    data,
  })
  revalidatePath('/dashboard/services')
  return updated
}
```

Reemplazar `deleteService()`:
```typescript
export async function deleteService(id: string) {
  const limit = checkRateLimit('delete-service', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  await prisma.service.update({
    where: { id },
    data: { isActive: false },
  })
  revalidatePath('/dashboard/services')
}
```

---

## Task 7: Migrar Server Actions a Prisma (Fase 2 - Disponibilidad)

**Files:**
- Modify: `src/server/actions/availability.ts`
- Modify: `src/server/actions/time-blocks.ts`

- [ ] **Step 7: Actualizar availability.ts**

```typescript
import { prisma } from '@/lib/db'

export async function getAvailabilityRules() {
  return prisma.availabilityRule.findMany()
}

export async function updateAvailabilityRule(
  id: string,
  data: { startTime: string; endTime: string; isActive: boolean }
) {
  const limit = checkRateLimit('update-availability', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateAvailabilityRuleSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const updated = await prisma.availabilityRule.update({
    where: { id },
    data,
  })
  revalidatePath('/dashboard/availability')
  return updated
}
```

- [ ] **Step 8: Actualizar time-blocks.ts**

```typescript
import { prisma } from '@/lib/db'
import type { TimeBlock } from '@prisma/client'

export async function getTimeBlocks() {
  return prisma.timeBlock.findMany({
    orderBy: { startDateTime: 'asc' },
  })
}

export async function createTimeBlock(data: Omit<TimeBlock, 'id' | 'createdAt'>) {
  const limit = checkRateLimit('create-timeblock', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createTimeBlockSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const newBlock = await prisma.timeBlock.create({ data })
  revalidatePath('/dashboard/availability')
  return newBlock
}

export async function deleteTimeBlock(id: string) {
  const limit = checkRateLimit('delete-timeblock', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  await prisma.timeBlock.delete({ where: { id } })
  revalidatePath('/dashboard/availability')
}
```

---

## Task 8: Migrar Server Actions a Prisma (Fase 3 - Reservas y Clientes)

**Files:**
- Modify: `src/server/actions/bookings.ts`

- [ ] **Step 9: Actualizar bookings.ts**

```typescript
import { prisma } from '@/lib/db'
import type { Booking, Customer } from '@prisma/client'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'

export async function getBookings() {
  return prisma.booking.findMany({
    orderBy: { startDateTime: 'desc' },
    include: {
      service: true,
      customer: true,
    },
  })
}

export async function createBooking(data: {
  serviceId: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  startDateTime: Date
  endDateTime: Date
  totalPrice: number
  depositRequired: number
  finalAmount: number
}) {
  const limit = checkRateLimit('create-booking', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createBookingSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos de reserva inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  // Buscar o crear cliente
  let customer = await prisma.customer.findFirst({
    where: {
      phone: data.customerPhone,
      name: data.customerName,
    },
  })

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        businessId: 'mock-business-1', // TODO: Obtener del tenant actual
        name: data.customerName,
        phone: data.customerPhone,
        email: data.customerEmail || null,
      },
    })
  }

  const booking = await prisma.booking.create({
    data: {
      businessId: 'mock-business-1', // TODO: Obtener del tenant actual
      serviceId: data.serviceId,
      customerId: customer.id,
      startDateTime: data.startDateTime,
      endDateTime: data.endDateTime,
      status: BookingStatus.pending_payment,
      totalPrice: data.totalPrice,
      depositRequired: data.depositRequired,
      remainingBalance: data.finalAmount,
      finalAmount: data.finalAmount,
      paymentStatus: BookingPaymentStatus.unpaid,
    },
  })

  revalidatePath('/dashboard/bookings')
  return booking
}

export async function updateBookingStatus(id: string, status: BookingStatus) {
  const updated = await prisma.booking.update({
    where: { id },
    data: { status },
  })
  revalidatePath('/dashboard/bookings')
  return updated
}

export async function confirmPayment(bookingId: string, amount: number) {
  const limit = checkRateLimit('confirm-payment', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = confirmPaymentSchema.safeParse({ bookingId, amount })
  if (!parsed.success) {
    throw new Error('Datos de pago inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
  if (!booking) throw new Error('Booking not found')
  if (booking.status === BookingStatus.cancelled) throw new Error('Cannot confirm payment for cancelled booking')
  if (amount <= 0) throw new Error('Amount must be positive')

  const isFullPayment = amount >= booking.finalAmount

  const updated = await prisma.$transaction(async (tx) => {
    const updatedBooking = await tx.booking.update({
      where: { id: bookingId },
      data: {
        depositPaid: amount,
        remainingBalance: Math.max(0, booking.finalAmount - amount),
        paymentStatus: isFullPayment ? BookingPaymentStatus.fully_paid : BookingPaymentStatus.deposit_paid,
        status: BookingStatus.confirmed,
      },
    })

    const payment = await tx.payment.create({
      data: {
        businessId: booking.businessId,
        bookingId,
        customerId: booking.customerId,
        provider: 'mock',
        amount,
        currency: 'CLP',
        status: 'approved',
        paymentType: isFullPayment ? 'full_payment' : 'deposit',
        paymentMethod: 'mock',
        paidAt: new Date(),
      },
    })

    await tx.ledgerEntry.create({
      data: {
        businessId: booking.businessId,
        bookingId,
        paymentId: payment.id,
        customerId: booking.customerId,
        type: isFullPayment ? 'full_payment_paid' : 'deposit_paid',
        direction: 'income',
        amount,
        currency: 'CLP',
        description: `${isFullPayment ? 'Pago total' : 'Abono'} para reserva ${booking.id.slice(-4)}`,
        occurredAt: new Date(),
      },
    })

    return updatedBooking
  })

  revalidatePath('/dashboard/bookings')
  return updated
}
```

---

## Task 9: Migrar Server Actions a Prisma (Fase 4 - Pagos y Ledger)

**Files:**
- Modify: `src/server/actions/payments.ts`
- Modify: `src/server/actions/ledger.ts`

- [ ] **Step 10: Actualizar payments.ts**

```typescript
import { prisma } from '@/lib/db'
import type { Payment } from '@prisma/client'
import { getDefaultProvider } from '@/lib/payments/factory'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

const initiatePaymentSchema = z.object({
  bookingId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(2).max(3),
  description: z.string().min(1).max(255),
})

const verifyPaymentSchema = z.object({
  paymentId: z.string().min(1),
  bookingId: z.string().min(1),
})

export async function initiatePayment(data: {
  bookingId: string
  amount: number
  currency: string
  description: string
}) {
  const limit = checkRateLimit('initiate-payment', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = initiatePaymentSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos de pago inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const provider = getDefaultProvider()
  const result = await provider.createPayment({
    amount: data.amount,
    currency: data.currency,
    bookingId: data.bookingId,
    description: data.description,
    returnUrl: `${process.env.NEXT_PUBLIC_APP_DOMAIN || 'http://localhost:3000'}/book/confirmation`,
    webhookUrl: `${process.env.NEXT_PUBLIC_APP_DOMAIN || 'http://localhost:3000'}/api/webhooks/${provider.name}`,
  })

  const payment = await prisma.payment.create({
    data: {
      id: result.paymentId,
      businessId: 'mock-business-1',
      bookingId: data.bookingId,
      customerId: '', // Se actualiza después desde la booking
      provider: provider.name,
      providerPaymentId: result.providerPaymentId,
      amount: data.amount,
      currency: data.currency,
      status: result.status as any,
      paymentType: 'deposit',
    },
  })

  revalidatePath('/dashboard/payments')
  return result
}

export async function verifyAndConfirmPayment(paymentId: string, bookingId: string) {
  const limit = checkRateLimit('verify-payment', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = verifyPaymentSchema.safeParse({ paymentId, bookingId })
  if (!parsed.success) {
    throw new Error('Datos de verificación inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) throw new Error('Payment not found')

  const provider = getDefaultProvider()

  if (payment.providerPaymentId) {
    const verification = await provider.verifyPayment({
      paymentId: payment.id,
      providerPaymentId: payment.providerPaymentId,
    })

    if (verification.status === 'approved') {
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'approved', paidAt: new Date() },
      })

      const { confirmPayment } = await import('./bookings')
      await confirmPayment(bookingId, payment.amount)

      return { success: true }
    }
  }

  if (payment.provider === 'mock') {
    await prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'approved', paidAt: new Date() },
    })

    const { confirmPayment } = await import('./bookings')
    await confirmPayment(bookingId, payment.amount)

    return { success: true }
  }

  return { success: false, message: 'Payment not approved' }
}

export async function getPayments() {
  return prisma.payment.findMany({
    orderBy: { createdAt: 'desc' },
  })
}

export async function getPaymentsByBooking(bookingId: string) {
  return prisma.payment.findMany({
    where: { bookingId },
  })
}
```

- [ ] **Step 11: Actualizar ledger.ts**

```typescript
import { prisma } from '@/lib/db'
import type { LedgerEntry } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

const createLedgerEntrySchema = z.object({
  businessId: z.string().min(1),
  bookingId: z.string().min(1).nullable(),
  paymentId: z.string().min(1).nullable(),
  customerId: z.string().min(1).nullable(),
  type: z.string().min(1).max(50),
  direction: z.enum(['income', 'expense', 'neutral']),
  amount: z.number().positive(),
  currency: z.string().min(2).max(3),
  description: z.string().max(500).optional().nullable(),
  occurredAt: z.date(),
  createdByUserId: z.string().min(1).nullable(),
})

export async function getLedgerEntries() {
  return prisma.ledgerEntry.findMany({
    orderBy: { occurredAt: 'desc' },
    include: {
      booking: true,
      payment: true,
    },
  })
}

export async function createLedgerEntry(data: Omit<LedgerEntry, 'id' | 'createdAt'>) {
  const limit = checkRateLimit('create-ledger-entry', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createLedgerEntrySchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const entry = await prisma.ledgerEntry.create({ data })
  revalidatePath('/dashboard/payments')
  return entry
}

export async function getFinancialSummary() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const [incomeToday, incomeMonth, totalDeposited, totalPending, totalRefunded, totalBookings, completedBookings, cancelledBookings] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: {
        direction: 'income',
        occurredAt: { gte: today },
      },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: {
        direction: 'income',
        occurredAt: { gte: thisMonth },
      },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: {
        status: 'approved',
        paymentType: 'deposit',
      },
      _sum: { amount: true },
    }),
    prisma.booking.aggregate({
      where: {
        status: { notIn: ['cancelled', 'no_show'] },
      },
      _sum: { remainingBalance: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { type: 'refund_issued' },
      _sum: { amount: true },
    }),
    prisma.booking.count(),
    prisma.booking.count({ where: { status: 'completed' } }),
    prisma.booking.count({ where: { status: 'cancelled' } }),
  ])

  return {
    incomeToday: incomeToday._sum.amount ?? 0,
    incomeMonth: incomeMonth._sum.amount ?? 0,
    totalDeposited: totalDeposited._sum.amount ?? 0,
    totalPending: totalPending._sum.remainingBalance ?? 0,
    totalRefunded: totalRefunded._sum.amount ?? 0,
    totalBookings,
    completedBookings,
    cancelledBookings,
  }
}
```

---

## Task 10: Verificación Final

- [ ] **Step 12: Verificar tipos y tests**

```bash
npx prisma generate
npx tsc --noEmit
npx vitest run tests/unit/slots.test.ts
```

Expected:
- `prisma generate` → generates Prisma Client
- `tsc --noEmit` → no errors in migrated files
- `vitest` → 5/5 tests passing

- [ ] **Step 13: Iniciar dev server y probar**

```bash
npm run dev
```

Probar:
1. Dashboard de servicios (lista, crea, edita, elimina un servicio)
2. Dashboard de disponibilidad (ver y editar horarios)
3. Dashboard de reservas (crear reserva)
4. Dashboard de pagos (ver ledger)

---

## Notas Importantes

### Tenant/Business ID Hardcodeado
Temporalmente usamos `'mock-business-1'` como `businessId`. Una vez que el auth funcione, esto debe venir del usuario autenticado o del subdominio. Marcar con `// TODO: Obtener del tenant actual`.

### Mock Store
El archivo `src/lib/data/mock-store.ts` puede mantenerse como fallback durante la transición, pero una vez que todo funcione con Prisma, se puede eliminar.

### Prisma en Edge Runtime
Si usas middleware de Next.js con Edge Runtime, Prisma NO funciona ahí. El middleware actual no usa Prisma, así que no hay problema. Los server actions usan Node.js runtime, donde Prisma funciona perfecto.
