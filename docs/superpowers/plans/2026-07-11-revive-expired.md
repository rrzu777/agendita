# Revivir Reservas Expiradas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La dueña puede revivir cualquier reserva expirada — confirmándola directo o dándole un nuevo plazo de pago por transferencia — con re-chequeo de cupo y sin corromper pagos/promos.

**Architecture:** Action dedicada `reviveBooking(bookingId, mode)` (tx con CAS `status='expired'` + chequeo de solape puro nuevo `assertSlotFreeOfConflicts`); fix de reactivación en `declareBankTransfer` (Payment bt-declared `cancelled` → `pending`); diálogo `ReviveBookingDialog` en la tabla/card de reservas; email "reserva reactivada" reusando `bankTransferBlockHtml/Text`. Spec: `docs/superpowers/specs/2026-07-11-revivir-expiradas-design.md`.

**Tech Stack:** Next.js App Router (fork custom — leer `node_modules/next/dist/docs/` ante dudas de framework), Prisma/Postgres, vitest, react-dom/server para component tests.

---

## Reglas de la casa (landmines — leer antes de empezar)

1. **tsc no corre en vitest/lint**: antes de CADA commit final de task, correr `npx tsc --noEmit 2>&1 | grep -E '^src/'` → debe estar VACÍO (errores en `tests/**` son drift pre-existente de Prisma, ignorarlos).
2. **Módulos `'use server'` exportan SOLO funciones async.** Helpers no-async van sin `export` (privados del módulo) o en `src/lib/`.
3. **`revalidateBusinessPublicPaths` siempre con `await`.**
4. **Tests de integración**: correr con `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- -t "<filtro>"` (Docker `agendita-test-pg` puerto 5433; NO pasar `--config` de nuevo). **Máximo un task de integración corriendo a la vez** (una sola DB de test).
5. **Component tests**: `renderToStaticMarkup` + `vi.mock('next/navigation')` o `useRouter()` revienta.
6. **Git**: `git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef` + `git add <archivos explícitos>`, nunca `-A`. Rama: `claude/revive-expired`.
7. **El constraint `Booking_no_overlap`** (EXCLUDE parcial sobre pending_payment/confirmed/completed) hace IRREPRESENTABLE seedear dos reservas activas solapadas: para probar conflictos usar un `TimeBlock`; para provocar el 23P01 real usar una reserva `completed` solapada contra un revive de turno pasado (sin assert previo).
8. **Sin migración de schema en este PR.**

### Orden y paralelismo (subagent-driven)

- Wave 1: Task 1 (conflictos) y Task 2 (emails/copys) en paralelo — archivos disjuntos, pero **solo Task 1 corre integración**.
- Wave 2: Task 3 (confirm), luego Task 4 (reopen), luego Task 5 (declare fix) — **secuenciales** (mismo archivo de action/test + DB de test única).
- Wave 3: Task 6 (UI) y Task 7 (home+drawer) en paralelo — archivos disjuntos, sin integración.
- Task 8 (verificación final) al final, solo.

---

### Task 1: `assertSlotFreeOfConflicts` (chequeo de solape puro)

**Files:**
- Modify: `src/lib/availability/validation.ts`
- Test: `tests/integration/slot-conflicts.test.ts` (create)

`assertSlotIsAvailable` valida además servicio activo, duración vigente, regla del día y ventana — rechazaría revives legítimos de citas ya pactadas. Extraemos las DOS porciones que sí importan al revivir (bloqueos de tiempo + solape de reservas con advisory lock) en helpers internos compartidos y exponemos `assertSlotFreeOfConflicts`.

- [ ] **Step 1: Write the failing test**

Crear `tests/integration/slot-conflicts.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { addMinutes } from 'date-fns'
import { prisma } from '@/lib/db'
import { assertSlotFreeOfConflicts } from '@/lib/availability/validation'
import { requireTestDatabase } from './setup'
import {
  seedConfirmedBooking, cleanupBankTransferSeed, BT_VERIFY_BIZ, BT_VERIFY_SVC,
} from './helpers/bank-transfer-seed'

requireTestDatabase()

const TZ = 'America/Santiago'

afterAll(async () => {
  await cleanupBankTransferSeed()
  await prisma.$disconnect()
})

// Slots propios (año 2028) para no chocar con los de otros tests de la suite.
function slot(day: number, hourUtc: number) {
  const start = new Date(Date.UTC(2028, 2, day, hourUtc, 0, 0))
  return { startDateTime: start, endDateTime: addMinutes(start, 60) }
}

describe('assertSlotFreeOfConflicts', () => {
  it('resuelve cuando el slot está libre (sin exigir servicio activo ni reglas)', async () => {
    const s = slot(1, 15)
    await expect(
      assertSlotFreeOfConflicts({ tx: prisma, businessId: BT_VERIFY_BIZ, timezone: TZ, ...s }),
    ).resolves.toBeUndefined()
  })

  it('tira si un TimeBlock solapa el slot', async () => {
    const s = slot(2, 15)
    // ensureBusiness ya corrió vía seedConfirmedBooking en otro test o acá:
    await seedConfirmedBooking({ businessId: BT_VERIFY_BIZ, serviceId: BT_VERIFY_SVC, ...slot(2, 10) })
    const block = await prisma.timeBlock.create({
      data: {
        businessId: BT_VERIFY_BIZ,
        startDateTime: s.startDateTime,
        endDateTime: s.endDateTime,
        reason: 'test block',
      },
    })
    await expect(
      assertSlotFreeOfConflicts({ tx: prisma, businessId: BT_VERIFY_BIZ, timezone: TZ, ...s }),
    ).rejects.toThrow('Ese horario ya no está disponible')
    await prisma.timeBlock.delete({ where: { id: block.id } })
  })

  it('tira si una reserva activa solapa; excludeBookingId la exime', async () => {
    const s = slot(3, 15)
    const seeded = await seedConfirmedBooking({ businessId: BT_VERIFY_BIZ, serviceId: BT_VERIFY_SVC, ...s })
    await expect(
      assertSlotFreeOfConflicts({ tx: prisma, businessId: BT_VERIFY_BIZ, timezone: TZ, ...s }),
    ).rejects.toThrow('Ese horario ya no está disponible')
    await expect(
      assertSlotFreeOfConflicts({
        tx: prisma, businessId: BT_VERIFY_BIZ, timezone: TZ, ...s, excludeBookingId: seeded.bookingId,
      }),
    ).resolves.toBeUndefined()
  })
})
```

Nota: abrí `tests/integration/helpers/bank-transfer-seed.ts` y verificá la firma real de `seedConfirmedBooking` (qué recibe y qué retorna — si retorna `{ bookingId }` u otro shape, ajustá el test). Si no acepta `businessId`/`serviceId` como opts, adaptá la llamada a su firma real.

- [ ] **Step 2: Run test to verify it fails**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- -t "assertSlotFreeOfConflicts"
```
Expected: FAIL — `assertSlotFreeOfConflicts` no existe (error de import).

- [ ] **Step 3: Implementar la extracción en `validation.ts`**

En `src/lib/availability/validation.ts`, después de `AssertSlotInput` agregar:

```ts
export interface AssertConflictInput {
  tx: PrismaClient | Prisma.TransactionClient
  businessId: string
  startDateTime: Date
  endDateTime: Date
  timezone: string
  excludeBookingId?: string
}
```

Extraer de `assertSlotIsAvailable` dos helpers privados con EXACTAMENTE el código actual (líneas 105-144 y 146-184), parametrizados:

```ts
async function assertNoTimeBlockConflict(input: AssertConflictInput): Promise<void> {
  const { tx, businessId, startDateTime, endDateTime, timezone } = input
  const [oneOffBlocks, blockSeries] = await Promise.all([
    tx.timeBlock.findMany({
      where: { businessId, startDateTime: { lt: endDateTime }, endDateTime: { gt: startDateTime } },
      select: { startDateTime: true, endDateTime: true, overlapToleranceMinutes: true },
    }),
    tx.timeBlockSeries.findMany({
      where: {
        businessId,
        isActive: true,
        anchorDate: { lte: endDateTime },
        OR: [{ until: null }, { until: { gte: startOfLocalDay(getLocalDateStr(startDateTime, timezone), timezone) } }],
      },
      include: { exceptions: true },
    }),
  ])
  const overlapsShrunk = (block: { startDateTime: Date; endDateTime: Date; overlapToleranceMinutes?: number }): boolean => {
    const core = shrinkBlock(block)
    return core !== null && core.start < endDateTime && startDateTime < core.end
  }
  const blockedByOneOff = oneOffBlocks.some(overlapsShrunk)
  const blockedBySeries = blockSeries.some((s) =>
    expandSeries(s, s.exceptions, startDateTime, endDateTime, timezone).some(overlapsShrunk),
  )
  if (blockedByOneOff || blockedBySeries) {
    logEvent('slot_validation_rejected', { businessId, reason: 'timeblock_overlap' })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }
}

async function assertNoBookingOverlap(input: AssertConflictInput): Promise<void> {
  const { tx, businessId, startDateTime, endDateTime, timezone } = input
  const now = new Date()
  const localStartStr = formatInTimeZone(startDateTime, timezone, 'yyyy-MM-dd')
  const lockKey = `${businessId}:${localStartStr}`
  const hash = hashStringToInt(lockKey)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${hash})`
  // (copiar el comentario + los dos $queryRaw actuales tal cual, con input.excludeBookingId)
  const overlappingBookings = input.excludeBookingId
    ? await tx.$queryRaw`
      SELECT "id" FROM "Booking"
      WHERE "businessId" = ${businessId}
        AND (
          "status" IN ('confirmed', 'completed')
          OR ("status" = 'pending_payment' AND ("holdExpiresAt" IS NULL OR "holdExpiresAt" > ${now}))
        )
        AND "startDateTime" < ${endDateTime}
        AND "endDateTime" > ${startDateTime}
        AND "id" != ${input.excludeBookingId}
      FOR UPDATE
    `
    : await tx.$queryRaw`
      SELECT "id" FROM "Booking"
      WHERE "businessId" = ${businessId}
        AND (
          "status" IN ('confirmed', 'completed')
          OR ("status" = 'pending_payment' AND ("holdExpiresAt" IS NULL OR "holdExpiresAt" > ${now}))
        )
        AND "startDateTime" < ${endDateTime}
        AND "endDateTime" > ${startDateTime}
      FOR UPDATE
    `
  if (Array.isArray(overlappingBookings) && overlappingBookings.length > 0) {
    logEvent('slot_validation_rejected', { businessId, reason: 'booking_overlap', overlappingCount: overlappingBookings.length })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }
}

/**
 * Chequeo de SOLAPE puro para revivir reservas: valida solo conflictos contra
 * reservas activas y bloqueos de tiempo (mismo advisory lock que
 * assertSlotIsAvailable). NO exige servicio activo, duración vigente, regla del
 * día ni ventana de reserva — una cita ya pactada no debe caerse porque la
 * dueña cambió el catálogo después (spec §3).
 */
export async function assertSlotFreeOfConflicts(input: AssertConflictInput): Promise<void> {
  if (input.endDateTime <= input.startDateTime) {
    logEvent('slot_validation_rejected', { businessId: input.businessId, reason: 'end_before_start' })
    throw new Error('Ese horario ya no está disponible. Por favor selecciona otro.')
  }
  await assertNoTimeBlockConflict(input)
  await assertNoBookingOverlap(input)
}
```

Y en `assertSlotIsAvailable`, REEMPLAZAR las líneas 105-184 (bloques + advisory lock + queryRaw) por:

```ts
  await assertNoTimeBlockConflict({ tx, businessId, startDateTime, endDateTime, timezone, excludeBookingId: input.excludeBookingId })
  await assertNoBookingOverlap({ tx, businessId, startDateTime, endDateTime, timezone, excludeBookingId: input.excludeBookingId })
```

El comportamiento de `assertSlotIsAvailable` debe quedar byte-idéntico (mismos logs, mismos errores, mismo orden).

- [ ] **Step 4: Run tests to verify they pass**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- -t "assertSlotFreeOfConflicts"
npm run test:unit
npx tsc --noEmit 2>&1 | grep -E '^src/' ; echo "exit=$?"
```
Expected: integración PASS, unit suite completa PASS (la extracción no cambia comportamiento), grep vacío (`exit=1`).

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/lib/availability/validation.ts tests/integration/slot-conflicts.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "feat(availability): assertSlotFreeOfConflicts, chequeo de solape puro para revivir"
```

---

### Task 2: Emails y copys (template reactivada + ajustes stale)

**Files:**
- Modify: `src/lib/notifications/templates.ts`, `src/lib/notifications/email-provider.ts`, `src/lib/notifications/index.ts`
- Test: `tests/unit/transfer-reactivated-email.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Crear `tests/unit/transfer-reactivated-email.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  transferReactivatedCustomerHtml, transferReactivatedCustomerText,
  bankTransferExpiredCustomerHtml,
} from '@/lib/notifications/templates'

const bt = { accountHolder: 'Ana', rut: '1-1', bankName: 'X', accountType: 'corriente', accountNumber: '123', email: null, instructions: null, deadline: new Date('2026-07-15T18:00:00Z'), confirmationUrl: 'https://x/book/confirmation?bookingId=b1' }
const data = { businessName: 'Bella', businessTimezone: 'America/Santiago', customerName: 'Ana', serviceName: 'Corte', depositAmount: 8000, businessCurrency: 'CLP', bankTransfer: bt, bookingNumber: 4738 as number | null }

describe('transfer reactivated templates', () => {
  it('reactivada: aviso + datos bancarios + link', () => {
    const html = transferReactivatedCustomerHtml(data)
    expect(html).toContain('reactiv')
    expect(html).toContain('123')
    expect(html).toContain(bt.confirmationUrl)
    expect(transferReactivatedCustomerText(data)).toContain(bt.confirmationUrl)
  })
  it('email de expirada menciona que el negocio puede reactivarla', () => {
    const html = bankTransferExpiredCustomerHtml({
      businessName: 'Bella', businessTimezone: 'America/Santiago', customerName: 'Ana',
      serviceName: 'Corte', startDateTime: new Date('2026-07-15T18:00:00Z'), bookingNumber: 1,
    })
    expect(html).toContain('reactivar')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:unit -- tests/unit/transfer-reactivated-email.test.ts
```
Expected: FAIL — `transferReactivatedCustomerHtml` no existe.

- [ ] **Step 3: Implementar templates**

En `src/lib/notifications/templates.ts`, DESPUÉS de `transferReminderBusinessText` agregar (reusa `TransferReminderCustomerEmailData` — mismos campos exactos que el recordatorio; no crear otro tipo):

```ts
// Reserva expirada que la dueña reabrió (reviveBooking mode 'reopen'): mismos
// datos que el recordatorio de transferencia — reusa su tipo a propósito.
export function transferReactivatedCustomerHtml(data: TransferReminderCustomerEmailData): string {
  const deposit = fmtCurrency(data.depositAmount, data.businessCurrency)
  return baseHtml(`
    ${header('Tu reserva fue reactivada')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, ¡buenas noticias! ${escapeHtml(data.businessName)} reactivó tu reserva de <strong>${escapeHtml(data.serviceName)}</strong>${data.bookingNumber != null ? ` (reserva #${data.bookingNumber})` : ''}. Transferí el abono y avisanos antes del plazo para confirmarla.</p>
    ${bankTransferBlockHtml(data.bankTransfer, deposit, data.businessTimezone)}
    ${footer(data.businessName)}
  `)
}

export function transferReactivatedCustomerText(data: TransferReminderCustomerEmailData): string {
  const deposit = fmtCurrency(data.depositAmount, data.businessCurrency)
  return [
    `Hola ${data.customerName}, ${data.businessName} reactivó tu reserva de ${data.serviceName}.`,
    `Transferí el abono y avisanos antes del plazo para confirmarla.`,
    ...bankTransferBlockText(data.bankTransfer, deposit, data.businessTimezone),
  ].join('\n')
}
```

En `bankTransferExpiredCustomerHtml` (línea ~357), reemplazar:

```
    <p style="margin-top:16px;font-size:14px">Si transferiste, contactá al negocio directamente. Si no, podés reservar de nuevo cuando quieras.</p>
```
por:
```
    <p style="margin-top:16px;font-size:14px">Si transferiste, escribile al negocio: también puede reactivar tu reserva. Si no, podés reservar de nuevo cuando quieras.</p>
```

Y en `bankTransferExpiredCustomerText`, reemplazar `Si transferiste, contactá al negocio.` por `Si transferiste, escribile al negocio: también puede reactivar tu reserva.`.

- [ ] **Step 4: Provider + exports**

En `src/lib/notifications/email-provider.ts`, después de `sendTransferReminderToCustomer` (línea ~), agregar (mismo shape exacto):

```ts
export async function sendTransferReactivatedToCustomer(data: TransferReminderCustomerEmailData): Promise<EmailResult> {
  if (!data.customerEmail) return { success: false, skipped: 'Cliente sin email' }
  return sendEmail(
    data.customerEmail,
    `Tu reserva fue reactivada - ${data.businessName}`,
    transferReactivatedCustomerHtml(data),
    transferReactivatedCustomerText(data),
    { replyTo: data.businessReplyToEmail },
  )
}
```

Agregar `transferReactivatedCustomerHtml, transferReactivatedCustomerText` al import de templates en `email-provider.ts`, y en `src/lib/notifications/index.ts` exportar `sendTransferReactivatedToCustomer` (junto a `sendTransferReminderToCustomer`) y los dos templates (junto a `transferReminderCustomerHtml`).

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:unit -- tests/unit/transfer-reactivated-email.test.ts
npx tsc --noEmit 2>&1 | grep -E '^src/' ; echo "exit=$?"
```
Expected: PASS y grep vacío.

- [ ] **Step 6: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/lib/notifications/templates.ts src/lib/notifications/email-provider.ts src/lib/notifications/index.ts tests/unit/transfer-reactivated-email.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "feat(notifications): email reserva reactivada + copy de expirada menciona revivir"
```

---

### Task 3: `reviveBooking` — modo `confirm`

**Files:**
- Create: `src/server/actions/revive-booking.ts`
- Modify: `src/server/actions/bookings.ts:62-69` (comentario en el mapa), `src/server/actions/bank-transfer-verify.ts:51-55` (copy stale)
- Test: `tests/integration/revive-booking.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Crear `tests/integration/revive-booking.test.ts`. Copiar el bloque completo de `vi.mock(...)` del tope de `tests/integration/bank-transfer-verify.test.ts` (auth por slug `btv-biz`, rate-limit, next/cache, revalidate-business, auth/user, notifications) y AGREGAR al mock de `@/lib/notifications` la key `sendTransferReactivatedToCustomer: async () => ({ success: true })`.

```ts
import { describe, it, expect, afterAll, vi } from 'vitest'
import { addMinutes } from 'date-fns'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from './setup'
import { seedDeclaredTransfer, cleanupBankTransferSeed, BT_VERIFY_BIZ } from './helpers/bank-transfer-seed'

requireTestDatabase()

// <<< acá el bloque vi.mock(...) copiado de bank-transfer-verify.test.ts >>>

import { reviveBooking } from '@/server/actions/revive-booking'

afterAll(async () => {
  await cleanupBankTransferSeed()
  await prisma.$disconnect()
})

// Helper local: sembrar una declarada y expirarla como lo haría el cron.
async function seedExpired(opts: Parameters<typeof seedDeclaredTransfer>[0] = {}) {
  const seeded = await seedDeclaredTransfer(opts)
  await prisma.booking.update({ where: { id: seeded.bookingId }, data: { status: 'expired' } })
  if (seeded.paymentId) {
    await prisma.payment.update({ where: { id: seeded.paymentId }, data: { status: 'cancelled' } })
  }
  return seeded
}

describe('reviveBooking confirm', () => {
  it('expired futura → confirmed, holdExpiresAt null', async () => {
    const seeded = await seedExpired()
    await reviveBooking(seeded.bookingId, 'confirm')
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(b.status).toBe('confirmed')
    expect(b.holdExpiresAt).toBeNull()
  })

  it('turno pasado también se puede confirmar (sin chequeo de cupo)', async () => {
    const start = new Date(Date.now() - 48 * 3_600_000)
    const seeded = await seedExpired({ startDateTime: start, endDateTime: addMinutes(start, 60), holdExpiresAt: new Date(Date.now() - 72 * 3_600_000) })
    await reviveBooking(seeded.bookingId, 'confirm')
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(b.status).toBe('confirmed')
  })

  it('no-expired → error; doble revive → error CAS', async () => {
    const seeded = await seedDeclaredTransfer() // pending_payment, no expirada
    await expect(reviveBooking(seeded.bookingId, 'confirm')).rejects.toThrow('Solo se puede revivir')
    const expired = await seedExpired()
    await reviveBooking(expired.bookingId, 'confirm')
    await expect(reviveBooking(expired.bookingId, 'confirm')).rejects.toThrow('Solo se puede revivir')
  })

  it('conflicto de cupo (TimeBlock) en turno futuro → error traducido', async () => {
    const seeded = await seedExpired()
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    const block = await prisma.timeBlock.create({
      data: { businessId: BT_VERIFY_BIZ, startDateTime: b.startDateTime, endDateTime: b.endDateTime, reason: 'ocupa el slot' },
    })
    await expect(reviveBooking(seeded.bookingId, 'confirm')).rejects.toThrow('ya no está disponible')
    const still = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(still.status).toBe('expired')
    await prisma.timeBlock.delete({ where: { id: block.id } })
  })

  it('constraint Booking_no_overlap (turno pasado + completed solapada) → error legible, sigue expired', async () => {
    const start = new Date(Date.now() - 24 * 3_600_000)
    const slotOpts = { startDateTime: start, endDateTime: addMinutes(start, 60), holdExpiresAt: new Date(Date.now() - 30 * 3_600_000) }
    const seeded = await seedExpired(slotOpts)
    // Reserva completed en el MISMO horario: el EXCLUDE la cuenta, el confirm de turno pasado no chequea.
    const { seedConfirmedBooking } = await import('./helpers/bank-transfer-seed')
    const other = await seedConfirmedBooking({ businessId: BT_VERIFY_BIZ, serviceId: 'btv-svc-1', ...slotOpts })
    await prisma.booking.update({ where: { id: other.bookingId }, data: { status: 'completed' } })
    await expect(reviveBooking(seeded.bookingId, 'confirm')).rejects.toThrow('Ese horario ya está ocupado')
    const still = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(still.status).toBe('expired')
  })
})
```

Ajustar shapes a las firmas reales del seed helper (`seedDeclaredTransfer` retorna `bookingId`/`paymentId`? — verificarlo leyendo el helper; si `paymentId` se llama distinto, adaptar).

- [ ] **Step 2: Run to verify it fails**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- -t "reviveBooking confirm"
```
Expected: FAIL — módulo `revive-booking` no existe.

- [ ] **Step 3: Implementar la action**

Crear `src/server/actions/revive-booking.ts`:

```ts
'use server'

// NOTE: 'use server' — SOLO funciones async exportadas (helpers privados sin
// export). Flujo DUEÑA: revive una reserva `expired` (spec
// 2026-07-11-revivir-expiradas-design.md). Es el ÚNICO camino de salida de
// `expired`: el mapa VALID_STATUS_TRANSITIONS del path genérico queda en []
// a propósito (updateBookingStatus no sabe re-validar cupo).

import { addHours } from 'date-fns'
import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'
import { revalidateBusinessPublicPaths } from '@/server/actions/revalidate-business'
import { assertSlotFreeOfConflicts } from '@/lib/availability/validation'
import { BANK_TRANSFER_METHOD } from '@/lib/bank-transfer/declared'
import { getBookingConfirmationUrl } from '@/lib/business/urls'
import {
  sendNotificationSafely,
  sendBookingConfirmedNotification,
  sendTransferReactivatedToCustomer,
  getBusinessReplyToEmail,
} from '@/lib/notifications'

// El EXCLUDE parcial Booking_no_overlap puede rechazar el update aun cuando el
// chequeo de solape pasó (p.ej. pending_payment con hold recién vencido que el
// assert considera libre, o confirm de turno pasado sin assert). Postgres tira
// 23P01; Prisma no lo mapea a un código conocido — detectamos por el nombre
// del constraint en message/meta.
function isNoOverlapViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  const meta = (e as { meta?: unknown } | null)?.meta
  return `${msg} ${JSON.stringify(meta ?? {})}`.includes('Booking_no_overlap')
}

export async function reviveBooking(
  bookingId: string,
  mode: 'confirm' | 'reopen',
): Promise<{ ok: true }> {
  const { business, businessId } = await requireBusinessRole(['owner', 'admin'])

  let result
  try {
    result = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, businessId }, // guard cross-tenant
        include: {
          business: { include: { bankTransferAccount: true } },
          customer: true,
          service: true,
        },
      })
      if (!booking) throw new Error('Reserva no encontrada')
      if (booking.status !== 'expired') {
        throw new Error('Solo se puede revivir una reserva expirada')
      }

      const now = new Date()
      const isFuture = booking.startDateTime > now
      const timezone = business.timezone || 'America/Santiago'

      if (mode === 'confirm') {
        if (isFuture) {
          await assertSlotFreeOfConflicts({
            tx, businessId,
            startDateTime: booking.startDateTime,
            endDateTime: booking.endDateTime,
            timezone,
            excludeBookingId: booking.id,
          })
        }
        const { count } = await tx.booking.updateMany({
          where: { id: bookingId, businessId, status: 'expired' },
          data: { status: 'confirmed', holdExpiresAt: null },
        })
        if (count === 0) throw new Error('Solo se puede revivir una reserva expirada')
        return { mode: 'confirm' as const, isFuture, booking, holdExpiresAt: null as Date | null }
      }

      // mode === 'reopen' — Task 4 lo implementa; por ahora, guard de alcance.
      throw new Error('Modo de revive no soportado')
    })
  } catch (e) {
    if (isNoOverlapViolation(e)) {
      throw new Error('Ese horario ya está ocupado por otra reserva.')
    }
    throw e
  }

  if (result.mode === 'confirm' && result.isFuture) {
    await sendNotificationSafely('booking confirmed', () =>
      sendBookingConfirmedNotification(bookingId, businessId),
    )
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/payments')
  revalidatePath('/dashboard')
  await revalidateBusinessPublicPaths(businessId)
  return { ok: true }
}
```

(Los imports `addHours`, `BANK_TRANSFER_METHOD`, `getBookingConfirmationUrl`, `sendTransferReactivatedToCustomer`, `getBusinessReplyToEmail`, `customer`/`service` del include son para Task 4 — dejarlos ya puestos; si eslint se queja de unused, agregarlos recién en Task 4.)

En `src/server/actions/bookings.ts`, sobre la línea `expired: [],` del mapa `VALID_STATUS_TRANSITIONS`, agregar el comentario:

```ts
  // expired es terminal PARA ESTE PATH: la única salida es reviveBooking
  // (revive-booking.ts), que re-valida cupo antes de transicionar.
  expired: [],
```

En `src/server/actions/bank-transfer-verify.ts` líneas 51-55, reemplazar:

```ts
    if (booking.status === 'expired' || booking.status === 'cancelled') {
      throw new Error(
        'Esta reserva expiró o fue cancelada. Registrá el pago creando la reserva de nuevo desde el calendario.',
      )
    }
```
por:
```ts
    if (booking.status === 'expired') {
      throw new Error('Esta reserva expiró. Revivila desde Reservas y después verificá el pago.')
    }
    if (booking.status === 'cancelled') {
      throw new Error('Esta reserva fue cancelada. Registrá el pago creando la reserva de nuevo desde el calendario.')
    }
```

OJO: buscá en `tests/` si algún test asserta el mensaje viejo (`grep -rn "creando la reserva de nuevo" tests/`) y actualizalo al mensaje nuevo que corresponda.

- [ ] **Step 4: Run tests to verify they pass**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- -t "reviveBooking confirm"
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- -t "confirmBankTransfer"
npx tsc --noEmit 2>&1 | grep -E '^src/' ; echo "exit=$?"
```
Expected: PASS (si el test del constraint falla porque la detección no matchea el error real de Prisma, imprimir el error crudo en el test — `console.log(JSON.stringify(e, Object.getOwnPropertyNames(e)))` — y ajustar `isNoOverlapViolation` a lo observado; NO al revés).

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/server/actions/revive-booking.ts src/server/actions/bookings.ts src/server/actions/bank-transfer-verify.ts tests/integration/revive-booking.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "feat(bookings): reviveBooking modo confirm + copy de verificación apunta a Revivir"
```

---

### Task 4: `reviveBooking` — modo `reopen`

**Files:**
- Modify: `src/server/actions/revive-booking.ts`
- Test: `tests/integration/revive-booking.test.ts` (extender)

- [ ] **Step 1: Write the failing tests**

Agregar a `tests/integration/revive-booking.test.ts`:

```ts
describe('reviveBooking reopen', () => {
  it('expired transferencia futura → pending_payment, hold=holdHours, flags reset, MP pendings cancelados', async () => {
    const seeded = await seedExpired()
    // flags "ya mandados" + un MP pending viejo que debe morir en la tx
    await prisma.booking.update({
      where: { id: seeded.bookingId },
      data: { transferReminderCustomerSentAt: new Date(), transferReminderBusinessSentAt: new Date() },
    })
    const mp = await prisma.payment.create({
      data: {
        businessId: BT_VERIFY_BIZ, bookingId: seeded.bookingId, customerId: seeded.customerId,
        provider: 'mercado_pago', providerPaymentId: `mp-stale-${seeded.bookingId}`,
        amount: 10000, currency: 'CLP', status: 'pending', paymentType: 'deposit',
      },
    })
    const before = Date.now()
    await reviveBooking(seeded.bookingId, 'reopen')
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(b.status).toBe('pending_payment')
    expect(b.transferReminderCustomerSentAt).toBeNull()
    expect(b.transferReminderBusinessSentAt).toBeNull()
    // holdHours de la cuenta seed (leer el helper: upsert de bankTransferAccount) — asserta contra ese valor.
    const account = await prisma.bankTransferAccount.findUniqueOrThrow({ where: { businessId: BT_VERIFY_BIZ } })
    const expectedMs = account.holdHours * 3_600_000
    expect(b.holdExpiresAt!.getTime()).toBeGreaterThanOrEqual(before + expectedMs - 5_000)
    expect(b.holdExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + expectedMs + 5_000)
    const mpAfter = await prisma.payment.findUniqueOrThrow({ where: { id: mp.id } })
    expect(mpAfter.status).toBe('cancelled')
  })

  it('turno pasado → error', async () => {
    const start = new Date(Date.now() - 24 * 3_600_000)
    const seeded = await seedExpired({ startDateTime: start, endDateTime: addMinutes(start, 60), holdExpiresAt: new Date(Date.now() - 30 * 3_600_000) })
    await expect(reviveBooking(seeded.bookingId, 'reopen')).rejects.toThrow('turno ya pasó')
  })

  it('reserva sin transferencia (paymentMethod null) → error', async () => {
    const seeded = await seedExpired()
    await prisma.booking.update({ where: { id: seeded.bookingId }, data: { paymentMethod: null } })
    await expect(reviveBooking(seeded.bookingId, 'reopen')).rejects.toThrow('transferencia')
  })

  it('cuenta deshabilitada → error (y se re-habilita para los demás tests)', async () => {
    const seeded = await seedExpired()
    await prisma.bankTransferAccount.update({ where: { businessId: BT_VERIFY_BIZ }, data: { isEnabled: false } })
    try {
      await expect(reviveBooking(seeded.bookingId, 'reopen')).rejects.toThrow('transferencia')
    } finally {
      await prisma.bankTransferAccount.update({ where: { businessId: BT_VERIFY_BIZ }, data: { isEnabled: true } })
    }
  })

  it('conflicto de cupo (TimeBlock) → error y sigue expired', async () => {
    const seeded = await seedExpired()
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    const block = await prisma.timeBlock.create({
      data: { businessId: BT_VERIFY_BIZ, startDateTime: b.startDateTime, endDateTime: b.endDateTime, reason: 'ocupado' },
    })
    await expect(reviveBooking(seeded.bookingId, 'reopen')).rejects.toThrow('ya no está disponible')
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })).status).toBe('expired')
    await prisma.timeBlock.delete({ where: { id: block.id } })
  })
})
```

(`seeded.customerId`: verificar que el seed lo retorne; si no, obtenerlo con un `findUnique` de la booking.)

- [ ] **Step 2: Run to verify it fails**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- -t "reviveBooking reopen"
```
Expected: FAIL — "Modo de revive no soportado".

- [ ] **Step 3: Implementar reopen**

En `src/server/actions/revive-booking.ts`, reemplazar el `throw new Error('Modo de revive no soportado')` por:

```ts
      // mode === 'reopen': solo turno futuro + transferencia habilitada (v1 no
      // reabre MP: /book/confirmation no tiene CTA de pago MP — spec §5).
      if (!isFuture) throw new Error('El turno ya pasó: solo se puede confirmar.')
      const account = booking.business.bankTransferAccount
      if (booking.paymentMethod !== BANK_TRANSFER_METHOD || !account || !account.isEnabled) {
        throw new Error('Solo se puede dar nuevo plazo a reservas con transferencia bancaria habilitada.')
      }

      await assertSlotFreeOfConflicts({
        tx, businessId,
        startDateTime: booking.startDateTime,
        endDateTime: booking.endDateTime,
        timezone,
        excludeBookingId: booking.id,
      })

      const holdExpiresAt = addHours(now, account.holdHours)
      const { count } = await tx.booking.updateMany({
        where: { id: bookingId, businessId, status: 'expired' },
        data: {
          status: 'pending_payment',
          holdExpiresAt,
          // Rehabilitar el ciclo de recordatorios del cron (exigen flag null).
          transferReminderCustomerSentAt: null,
          transferReminderBusinessSentAt: null,
        },
      })
      if (count === 0) throw new Error('Solo se puede revivir una reserva expirada')

      // Matar los Payments MP viejos: sin esto deriveConfirmationState mostraría
      // "verifying" sin salida y el recordatorio-clienta quedaría bloqueado
      // (spec §2.3). El webhook MP es idempotente frente al cancelled local.
      await tx.payment.updateMany({
        where: { bookingId, provider: 'mercado_pago', status: { in: ['pending', 'in_process'] } },
        data: { status: 'cancelled' },
      })

      return { mode: 'reopen' as const, isFuture, booking, holdExpiresAt, account }
```

OJO: verificar en `prisma/schema.prisma` los valores reales del enum `PaymentStatus` — si `in_process` no existe, dejar solo `['pending']`.

Y después del bloque `if (result.mode === 'confirm' ...)` post-tx, agregar el email de reopen (best-effort, solo si hay email):

```ts
  if (result.mode === 'reopen' && result.booking.customer?.email) {
    const replyTo = await getBusinessReplyToEmail(businessId)
    const acct = result.account
    await sendNotificationSafely('transfer reactivated', () =>
      sendTransferReactivatedToCustomer({
        businessName: business.name,
        businessTimezone: business.timezone || 'America/Santiago',
        businessReplyToEmail: replyTo,
        customerName: result.booking.customer!.name,
        customerEmail: result.booking.customer!.email!,
        serviceName: result.booking.service?.name ?? 'servicio',
        bookingNumber: result.booking.bookingNumber,
        depositAmount: Math.min(result.booking.depositRequired, result.booking.remainingBalance),
        businessCurrency: business.currency || 'CLP',
        bankTransfer: {
          accountHolder: acct.accountHolder,
          rut: acct.rut,
          bankName: acct.bankName,
          accountType: acct.accountType,
          accountNumber: acct.accountNumber,
          email: acct.email,
          instructions: acct.instructions,
          deadline: result.holdExpiresAt, // el escrito en la tx — NO recalcular
          confirmationUrl: getBookingConfirmationUrl(business, bookingId),
        },
      }),
    )
  }
```

(TypeScript: para que el narrowing funcione, tipar el retorno de la tx como union discriminada por `mode`; si `result.account` da problemas de narrowing, extraer `const r = result` tras un `if (result.mode === 'reopen')`.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- -t "reviveBooking"
npx tsc --noEmit 2>&1 | grep -E '^src/' ; echo "exit=$?"
```
Expected: todo PASS, grep vacío.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/server/actions/revive-booking.ts tests/integration/revive-booking.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "feat(bookings): reviveBooking modo reopen — hold nuevo, flags reset, MP stale cancelados, email reactivada"
```

---

### Task 5: `declareBankTransfer` — reactivar el Payment cancelado

**Files:**
- Modify: `src/server/actions/bank-transfer-public.ts:51-95`
- Test: `tests/integration/bank-transfer-public.test.ts` (extender; el test de idempotencia existente NO debe cambiar de semántica)

- [ ] **Step 1: Write the failing tests**

En `tests/integration/bank-transfer-public.test.ts`, agregar un describe (reusar seeds/mocks del archivo — leerlo primero):

```ts
describe('declareBankTransfer reactivación post-reopen', () => {
  it('bt-declared cancelled → vuelve a pending con monto y createdAt nuevos', async () => {
    const seeded = await seedDeclaredTransfer()
    // Simular ciclo: cron canceló la declaración, dueña reabrió (booking sigue
    // pending_payment con hold vigente en el seed).
    await prisma.payment.update({
      where: { id: seeded.paymentId },
      data: { status: 'cancelled', createdAt: new Date(Date.now() - 72 * 3_600_000), amount: 1 },
    })
    const before = Date.now()
    await declareBankTransfer(seeded.bookingId)
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: seeded.paymentId } })
    expect(p.status).toBe('pending')
    expect(p.amount).toBe(10000) // min(depositRequired, remainingBalance) del seed
    expect(p.createdAt.getTime()).toBeGreaterThanOrEqual(before - 5_000)
    // Sigue habiendo UN solo payment bt-declared (unique intacto, sin create nuevo)
    const all = await prisma.payment.findMany({ where: { bookingId: seeded.bookingId, provider: 'manual' } })
    expect(all).toHaveLength(1)
  })

  it('bt-declared approved → éxito idempotente sin tocar el payment', async () => {
    const seeded = await seedDeclaredTransfer()
    await prisma.payment.update({ where: { id: seeded.paymentId }, data: { status: 'approved' } })
    await declareBankTransfer(seeded.bookingId)
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: seeded.paymentId } })
    expect(p.status).toBe('approved')
  })

  it('reactivación con booking expirada → error con mensaje de expirada', async () => {
    const seeded = await seedDeclaredTransfer()
    await prisma.payment.update({ where: { id: seeded.paymentId }, data: { status: 'cancelled' } })
    await prisma.booking.update({ where: { id: seeded.bookingId }, data: { status: 'expired' } })
    await expect(declareBankTransfer(seeded.bookingId)).rejects.toThrow('expiró')
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: seeded.paymentId } })).status).toBe('cancelled')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- -t "reactivación post-reopen"
```
Expected: FAIL — hoy el branch `existing` retorna éxito silencioso sin reactivar (`p.status` sigue `cancelled`).

- [ ] **Step 3: Implementar**

En `src/server/actions/bank-transfer-public.ts`, dentro de la tx, reemplazar el bloque de idempotencia + guard + create (líneas 51-94) por:

```ts
    // Idempotencia por status del bt-declared existente:
    // - pending  → ya declaró; éxito sin tocar el hold (re-declarar no re-extiende).
    // - approved → ya verificado (alcanzable vía confirmación parcial); jamás tocarlo,
    //              el ledger ya lo contabilizó.
    // - cancelled/rejected → la declaración murió (cron/expiración) y la dueña
    //   reabrió la reserva: REACTIVAR el mismo Payment (el unique impide crear otro).
    const existing = await tx.payment.findFirst({
      where: { bookingId, provider: 'manual', providerPaymentId: btDeclaredId(bookingId) },
    })
    if (existing && (existing.status === 'pending' || existing.status === 'approved')) return null

    // Guard de carrera vs cron (spec §4): solo una pending_payment con hold
    // vigente puede declarar (creación Y reactivación pasan por acá).
    const now = new Date()
    const newHold = account.verifyHours == null ? null : addHours(now, account.verifyHours)
    const { count } = await tx.booking.updateMany({
      where: { id: bookingId, status: 'pending_payment', holdExpiresAt: { gt: now } },
      data: { holdExpiresAt: newHold },
    })
    if (count === 0) {
      // Mensaje según el estado real (una revivida-cancelada/confirmada no "expiró").
      if (booking.status === 'cancelled') throw new Error('Tu reserva fue cancelada.')
      if (booking.status === 'confirmed') throw new Error('Tu reserva ya está confirmada.')
      throw new Error('Tu reserva expiró. Volvé a reservar para elegir un nuevo horario.')
    }

    // Monto server-authoritative, mismo criterio que initiatePayment (payments.ts).
    const amount = Math.min(booking.depositRequired, booking.remainingBalance)
    if (amount <= 0) throw new Error('Esta reserva no requiere abono')

    if (existing) {
      // Reactivación: mismo Payment, declaración "nueva" — createdAt = now para
      // que el recordatorio-dueña (rama verifyHours=null, 24h desde createdAt)
      // no dispare al instante.
      await tx.payment.update({
        where: { id: existing.id },
        data: { status: PaymentStatus.pending, amount, createdAt: now },
      })
      return { booking, amount }
    }

    try {
      await tx.payment.create({
        data: {
          businessId: booking.businessId,
          bookingId,
          customerId: booking.customerId,
          provider: PaymentProvider.manual,
          providerPaymentId: btDeclaredId(bookingId),
          amount,
          currency: booking.business.currency || 'CLP',
          status: PaymentStatus.pending,
          paymentType: PaymentType.deposit,
          paymentMethod: 'Transferencia',
        },
      })
    } catch (e) {
      // P2002 = otro request ganó la carrera del create: tratarlo como éxito.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null
      throw e
    }
    return { booking, amount }
```

(El resto de la función — rate limit, load de booking, validación de método/cuenta, notificación post-tx — queda igual. Nota: `booking.status` para los mensajes ya está cargado por el findUnique del principio.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- tests/integration/bank-transfer-public.test.ts
npx tsc --noEmit 2>&1 | grep -E '^src/' ; echo "exit=$?"
```
Expected: TODO el archivo PASS — incluido el test de idempotencia pre-existente ("doble declare"), que debe seguir verde sin modificarlo.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/server/actions/bank-transfer-public.ts tests/integration/bank-transfer-public.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "fix(bank-transfer): declareBankTransfer reactiva el bt-declared cancelado tras un reopen"
```

---

### Task 6: UI — `ReviveBookingDialog` + integración en tabla y card

**Files:**
- Create: `src/components/dashboard/revive-booking-dialog.tsx`
- Modify: `src/components/dashboard/booking-row-actions.tsx`, `src/app/dashboard/bookings/page.tsx`
- Test: `tests/component/revive-booking-dialog.test.tsx` (create — mirar un test existente en `tests/component/` para el patrón exacto de render y mocks)

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { ReviveBookingDialog } from '@/components/dashboard/revive-booking-dialog'

const base = {
  bookingId: 'b1',
  serviceName: 'Corte',
  customerName: 'Ana',
  customerHasEmail: true,
  open: true,
  onOpenChange: () => {},
}

describe('ReviveBookingDialog', () => {
  it('con reopen habilitado muestra las dos salidas', () => {
    const html = renderToStaticMarkup(
      <ReviveBookingDialog {...base} canReopen={true} reopenDisabledReason={null} />,
    )
    expect(html).toContain('Confirmar reserva')
    expect(html).toContain('Dar nuevo plazo')
  })
  it('con reopen deshabilitado muestra la razón', () => {
    const html = renderToStaticMarkup(
      <ReviveBookingDialog {...base} canReopen={false} reopenDisabledReason="El turno ya pasó" />,
    )
    expect(html).toContain('El turno ya pasó')
  })
  it('sin email de clienta muestra el aviso de WhatsApp', () => {
    const html = renderToStaticMarkup(
      <ReviveBookingDialog {...base} customerHasEmail={false} canReopen={true} reopenDisabledReason={null} />,
    )
    expect(html).toContain('WhatsApp')
  })
})
```

Ubicar el archivo donde viven los component tests existentes (`ls tests/component/ tests/unit/*.tsx 2>/dev/null`) y seguir ese path/config.

- [ ] **Step 2: Run to verify it fails** — comando según la config real (`npm run test:unit -- <path>`); Expected: FAIL, módulo no existe.

- [ ] **Step 3: Implementar el diálogo**

Crear `src/components/dashboard/revive-booking-dialog.tsx` (patrón `verify-transfer-dialog.tsx`: controlled open, `useTransition`, error inline, `router.refresh()`):

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { reviveBooking } from '@/server/actions/revive-booking'

export function ReviveBookingDialog({
  bookingId,
  serviceName,
  customerName,
  customerHasEmail,
  canReopen,
  reopenDisabledReason,
  open,
  onOpenChange,
}: {
  bookingId: string
  serviceName: string
  customerName: string
  customerHasEmail: boolean
  /** true solo si turno futuro + paymentMethod bank_transfer + cuenta habilitada (el server re-valida igual). */
  canReopen: boolean
  reopenDisabledReason: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function run(mode: 'confirm' | 'reopen') {
    setError(null)
    startTransition(async () => {
      try {
        await reviveBooking(bookingId, mode)
        onOpenChange(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al revivir la reserva')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-heading font-semibold tracking-tight text-primary">
            Revivir reserva
          </DialogTitle>
          <DialogDescription>
            {serviceName} — {customerName}. Elegí cómo reactivarla; el horario se vuelve a chequear.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Button type="button" className="h-11 w-full font-semibold" disabled={isPending} onClick={() => run('confirm')}>
            <CheckCircle2 className="mr-2 size-4" />
            {isPending ? 'Procesando...' : 'Confirmar reserva'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Queda confirmada con el saldo pendiente que tenga; el pago lo registrás después.
          </p>

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full font-semibold"
            disabled={isPending || !canReopen}
            onClick={() => run('reopen')}
          >
            <Clock className="mr-2 size-4" />
            Dar nuevo plazo para pagar
          </Button>
          {canReopen ? (
            <p className="text-xs text-muted-foreground">
              Vuelve a pendiente de pago con un plazo nuevo para transferir y avisar.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{reopenDisabledReason}</p>
          )}

          {!customerHasEmail && (
            <p className="text-xs font-medium text-amber-700">
              Esta clienta no tiene email: avisale por WhatsApp que su reserva revivió.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Integrar en la tabla (desktop)**

`src/components/dashboard/booking-row-actions.tsx` — hoy las expiradas caen en el early-return `!isActionable`. Extender `RowBooking` y el early-return:

```tsx
type RowBooking = ManualPaymentBooking & {
  startDateTime?: Date | string
  paymentMethod?: string | null
  customerEmail?: string | null
}
```

Agregar props `transferEnabled?: boolean` al componente, y ANTES del early-return actual:

```tsx
  const isExpired = booking.status === 'expired'
  const [reviveOpen, setReviveOpen] = useState(false)

  if (isExpired) {
    const isFuture = booking.startDateTime != null && new Date(booking.startDateTime) > new Date()
    const isTransfer = booking.paymentMethod === 'bank_transfer'
    const canReopen = isFuture && isTransfer && !!transferEnabled
    const reopenDisabledReason = !isFuture
      ? 'El turno ya pasó: solo se puede confirmar.'
      : !isTransfer
        ? 'Esta reserva no eligió transferencia: confirmala y registrá el pago aparte.'
        : 'La transferencia bancaria está deshabilitada en Pagos.'
    return (
      <div className="flex items-center justify-end gap-2">
        {contact}
        <Button type="button" size="sm" variant="outline" onClick={() => setReviveOpen(true)}>
          Revivir
        </Button>
        <ReviveBookingDialog
          bookingId={booking.id}
          serviceName={booking.service?.name || 'Servicio'}
          customerName={booking.customer?.name || 'Cliente'}
          customerHasEmail={!!booking.customerEmail}
          canReopen={canReopen}
          reopenDisabledReason={canReopen ? null : reopenDisabledReason}
          open={reviveOpen}
          onOpenChange={setReviveOpen}
        />
      </div>
    )
  }
```

OJO hooks: `useState(reviveOpen)` debe declararse arriba junto a los otros `useState`, NUNCA dentro del `if`. Importar `ReviveBookingDialog`.

- [ ] **Step 5: Integrar en la page (datos + card móvil)**

En `src/app/dashboard/bookings/page.tsx`:
1. Calcular una vez: `const transferEnabled = !!(await getBankTransferInfo(<businessId>))` — import de `@/server/actions/bank-transfer-public`; obtener el businessId del mismo lugar del que la page ya saca `userData.business` (leer la page; si expone `userData.business.id` usar eso).
2. Pasar a `BookingRowActions` (fila desktop): `transferEnabled={transferEnabled}` y en el objeto booking los campos nuevos `startDateTime: booking.startDateTime`, `paymentMethod: booking.paymentMethod`, `customerEmail: booking.customer?.email ?? null` (revisar cómo la page arma hoy el objeto que le pasa — extenderlo, no reemplazarlo).
3. Card móvil: después del bloque `{booking.status === 'pending_payment' && (...)}` agregar un bloque para expired. La card es server component → el diálogo necesita su propio client wrapper con trigger. Crear DENTRO de `revive-booking-dialog.tsx` un export adicional:

```tsx
export function ReviveBookingButton(props: Omit<Parameters<typeof ReviveBookingDialog>[0], 'open' | 'onOpenChange'> & { triggerClassName?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant="outline" className={props.triggerClassName} onClick={() => setOpen(true)}>
        Revivir
      </Button>
      <ReviveBookingDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  )
}
```

y en la card:

```tsx
      {booking.status === 'expired' && (
        <div className="mt-4 flex gap-2 border-t border-border/50 pt-4">
          <ReviveBookingButton
            bookingId={booking.id}
            serviceName={booking.service?.name || 'Servicio'}
            customerName={booking.customer?.name || 'Cliente'}
            customerHasEmail={!!booking.customer?.email}
            canReopen={canReopenExpired}
            reopenDisabledReason={canReopenExpired ? null : reopenReason}
            triggerClassName="flex-1 h-10 text-sm font-semibold"
          />
        </div>
      )}
```

donde `canReopenExpired`/`reopenReason` se calculan igual que en row-actions (extraer un helper compartido NO-hook `getReviveReopenState(booking, transferEnabled): { canReopen: boolean; reason: string | null }` en `src/components/dashboard/manual-payment-utils.ts` o archivo hermano y usarlo en ambos lados para no duplicar los copys).

- [ ] **Step 6: Run tests + tsc**

```bash
npm run test:unit
npx tsc --noEmit 2>&1 | grep -E '^src/' ; echo "exit=$?"
```
Expected: component test PASS, suite verde, grep vacío.

- [ ] **Step 7: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/components/dashboard/revive-booking-dialog.tsx src/components/dashboard/booking-row-actions.tsx src/app/dashboard/bookings/page.tsx tests/component/revive-booking-dialog.test.tsx src/components/dashboard/manual-payment-utils.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "feat(dashboard): ReviveBookingDialog en tabla y card de reservas"
```

(Ajustar la lista de `git add` a los archivos realmente tocados.)

---

### Task 7: Fixes de superficie — home y drawer del calendario

**Files:**
- Modify: `src/app/dashboard/page.tsx` (~línea 48), `src/components/dashboard/booking-drawer.tsx` (~líneas 36-49)

- [ ] **Step 1: Home — excluir expiradas de "Próximas citas"**

En `src/app/dashboard/page.tsx`, el filtro:

```ts
  const upcomingBookings = bookings.filter(b =>
    new Date(b.startDateTime) >= today &&
    b.status !== 'cancelled' &&
    b.status !== 'no_show'
  )
```
pasa a:
```ts
  const upcomingBookings = bookings.filter(b =>
    new Date(b.startDateTime) >= today &&
    b.status !== 'cancelled' &&
    b.status !== 'no_show' &&
    // Una expirada futura no es una "próxima cita": revivila desde Reservas.
    b.status !== 'expired'
  )
```

- [ ] **Step 2: Drawer — label y estilo de expired**

En `src/components/dashboard/booking-drawer.tsx`, agregar a los dos mapas:

```ts
const statusLabels: Record<string, string> = {
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
  expired: 'Expirada',
}

const statusBadgeClasses: Record<string, string> = {
  pending_payment: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-secondary text-secondary-foreground',
  cancelled: 'bg-muted text-muted-foreground',
  no_show: 'bg-destructive/10 text-destructive',
  expired: 'bg-muted text-muted-foreground',
}
```

- [ ] **Step 3: Verificar y commit**

```bash
npm run test:unit
npx tsc --noEmit 2>&1 | grep -E '^src/' ; echo "exit=$?"
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/app/dashboard/page.tsx src/components/dashboard/booking-drawer.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "fix(dashboard): expiradas fuera de próximas citas del home; label Expirada en drawer"
```

---

### Task 8: Verificación final full-suite

**Files:** ninguno nuevo.

- [ ] **Step 1: Suites completas**

```bash
npx tsc --noEmit 2>&1 | grep -E '^src/' ; echo "exit=$?"   # DEBE dar vacío / exit=1
npm run test:unit                                            # suite completa
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration
npm run lint
```
Expected: todo verde. Si un unit pre-existente rompió por contratos ampliados (p.ej. mocks de `@/lib/notifications` sin la key nueva), arreglar el mock del test, no el código.

- [ ] **Step 2: Revisar el diff completo contra la spec**

`git -C <worktree> diff origin/main --stat` y verificar contra `docs/superpowers/specs/2026-07-11-revivir-expiradas-design.md` §2-§7 que no falte nada (checklist: action 2 modos + constraint catch + MP cancel + flags; declare reactivación + mensajes por status; dialog + card + row-actions; email reactivada + 2 copys stale; home + drawer).

- [ ] **Step 3: Commit final si quedó algo suelto y push**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef push -u origin claude/revive-expired
```
