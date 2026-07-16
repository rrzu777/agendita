import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fromZonedTime } from 'date-fns-tz'
import { prisma } from '@/lib/db'
import { requireBusinessRole, AuthError, ForbiddenError } from '@/lib/auth/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { buildLedgerCSV } from '@/lib/finance/csv-export'
import type { LedgerCSVEntry } from '@/lib/finance/csv-export'
import { isValidCalendarDate } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const exportQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD requerido'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD requerido'),
  })
  .refine((data) => isValidCalendarDate(data.from), {
    message: 'La fecha "desde" no es válida',
    path: ['from'],
  })
  .refine((data) => isValidCalendarDate(data.to), {
    message: 'La fecha "hasta" no es válida',
    path: ['to'],
  })
  .refine((data) => data.from <= data.to, {
    message: 'La fecha "desde" debe ser menor o igual a "hasta"',
    path: ['from'],
  })
  .refine(
    (data) => {
      const fromMs = new Date(data.from).getTime()
      const toMs = new Date(data.to).getTime()
      const diffDays = (toMs - fromMs) / (1000 * 60 * 60 * 24)
      return diffDays <= 366
    },
    {
      message: 'El rango máximo permitido es de 366 días',
      path: ['to'],
    }
  )

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    const parsed = exportQuerySchema.safeParse({ from, to })
    if (!parsed.success) {
      const messages = parsed.error.issues.map((i) => i.message).join(', ')
      return NextResponse.json({ error: messages }, { status: 400 })
    }

    const { business, businessId } = await requireBusinessRole(['owner', 'admin'])

    const limit = await checkRateLimit('export-ledger-csv', 10, 60000)
    if (!limit.success) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' },
        { status: 429 }
      )
    }

    const timezone = business.timezone || 'America/Santiago'

    const fromStart = fromZonedTime(`${parsed.data.from}T00:00:00.000`, timezone)
    const toEnd = fromZonedTime(`${parsed.data.to}T23:59:59.999`, timezone)

    const entries = await prisma.ledgerEntry.findMany({
      where: {
        businessId,
        occurredAt: {
          gte: fromStart,
          lte: toEnd,
        },
      },
      orderBy: { occurredAt: 'asc' },
      include: {
        booking: {
          include: {
            service: true,
            customer: true,
          },
        },
        payment: {
          include: {
            customer: true,
          },
        },
      },
    })

    const unresolvedCustomerIds = new Set<string>()
    for (const entry of entries) {
      if (!entry.booking?.customer && !entry.payment?.customer && entry.customerId) {
        unresolvedCustomerIds.add(entry.customerId)
      }
    }

    const customerMap: Map<string, { name: string; phone: string }> = new Map()
    if (unresolvedCustomerIds.size > 0) {
      const customers = await prisma.customer.findMany({
        where: {
          id: { in: Array.from(unresolvedCustomerIds) },
          businessId,
        },
        select: { id: true, name: true, phone: true },
      })
      for (const c of customers) {
        customerMap.set(c.id, { name: c.name, phone: c.phone })
      }
    }

    const csvEntries: LedgerCSVEntry[] = entries.map((entry) => {
      let customerName: string | null = null
      let customerPhone: string | null = null

      if (entry.booking?.customer) {
        customerName = entry.booking.customer.name
        customerPhone = entry.booking.customer.phone
      } else if (entry.payment?.customer) {
        customerName = entry.payment.customer.name
        customerPhone = entry.payment.customer.phone
      } else if (entry.customerId && customerMap.has(entry.customerId)) {
        const c = customerMap.get(entry.customerId)!
        customerName = c.name
        customerPhone = c.phone
      }

      return {
        occurredAt: entry.occurredAt,
        type: entry.type,
        direction: entry.direction,
        customerName,
        customerPhone,
        serviceName: entry.booking?.service?.name ?? null,
        bookingId: entry.bookingId,
        paymentId: entry.paymentId,
        amount: entry.amount,
        currency: entry.currency,
        paymentMethod: entry.payment?.paymentMethod ?? null,
        provider: entry.payment?.provider ?? null,
        paymentStatus: entry.payment?.status ?? null,
        description: entry.description,
      }
    })

    const csv = buildLedgerCSV(csvEntries, timezone)

    const safeSlug = business.slug.replace(/[^a-zA-Z0-9_-]/g, '_')
    const filename = `agendita-finanzas-${safeSlug}-${parsed.data.from}_${parsed.data.to}.csv`

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('Ledger export error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
