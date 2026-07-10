# Transferencia bancaria PR B — Flujo público — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La clienta puede elegir transferencia como método de abono en el wizard, ver los datos bancarios, declarar "ya transferí" (también desde `/book/confirmation` si cerró la pestaña), y ver "en verificación" en todas sus superficies; la dueña recibe los emails correspondientes.

**Architecture:** Segundo PR de tres (spec: `docs/superpowers/specs/2026-07-10-abono-transferencia-bancaria-design.md`, §5 + §8 parcial). Estado "declarada" = Payment(`manual`, `'Transferencia'`, `pending`, `providerPaymentId: "bt-declared:<bookingId>"`). El hold largo nace en `createBooking` (param nuevo); `declareBankTransfer` mueve el hold a la ventana de verificación y crea el Payment idempotente. Cero cambios al cron y al dashboard (PR C).

**Tech Stack:** Next.js App Router (fork con breaking changes — leer `node_modules/next/dist/docs/` ante dudas), Prisma, Zod, date-fns (`addHours`), vitest.

**Rama:** `claude/bank-transfer-prB` (ya creada desde `origin/main` post-#60).

**⚠️ Nota operativa (va también en el PR):** entre el merge de PR B y el de PR C, una transferencia declarada NO tiene UI de verificación (la dueña puede usar "Registrar pago" como fallback, pero deja el Payment declarado huérfano). La dueña no debe habilitar el toggle de transferencia en producción hasta PR C.

**Landmines:** (1) módulos `'use server'` solo exportan async — schemas/consts en `src/lib/bank-transfer/`; (2) tests de integración: `npx vitest run --config vitest.integration.config.ts ...` con `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test` (y `DIRECT_URL` igual; contenedor Docker `agendita-test-pg`, `docker start agendita-test-pg` si no corre); (3) component tests: `renderToStaticMarkup` + mock `next/navigation`; (4) git: `git -C <worktree>` + add explícito; (5) `revalidateBusinessPublicPaths` siempre con `await`.

**Hechos del código que este plan da por verificados** (no re-descubrir):
- `createBooking` ya es idempotente por `businessId+idempotencyKey` (`bookings.ts:232-240`): si la key existe, devuelve la booking existente. Por eso persistir la key en el wizard resuelve el caso "eligió transferir → volvió atrás → paga MP".
- `recomputeBookingAmountsAfterDiscount` (`src/lib/booking/recompute.ts:25`) PISA `holdExpiresAt` a +15min — hay que parametrizarlo.
- El unique de Payment es `[bookingId, provider, providerPaymentId]` y con `providerPaymentId` NULL no muerde; con el valor determinístico `bt-declared:<id>` sí (P2002 en duplicado).
- `deriveConfirmationState` (`src/lib/payments/confirmation-state.ts`) filtra `mercado_pago` y NO mira `expired`/`cancelled`; la página filtra `provider: 'mercado_pago'` en la query (`src/app/book/confirmation/page.tsx:33`).
- `sendBookingReceivedToCustomer` skipea sin email; `sendNewBookingNotificationToBusiness` usa `getBusinessOwnerEmails` (owners+admins). `BookingEmailData` vive en `src/lib/notifications/types.ts:8`.
- `ManualPaymentDialog` guarda `Payment.paymentMethod` con labels display capitalizados ('Efectivo'/'Transferencia'/...): usar `'Transferencia'` para consistencia visual en la tabla Pagos.

---

### Task 1: Lectura pública de disponibilidad de transferencia

**Files:**
- Create: `src/lib/bank-transfer/public-info.ts`
- Create: `src/server/actions/bank-transfer-public.ts` (solo `getBankTransferInfo` por ahora; `declareBankTransfer` se agrega en Task 3)
- Test: `tests/integration/bank-transfer-public.test.ts` (se inicia acá, crece en Tasks 2-3)

- [ ] **Step 1: Tipo + selector compartido**

Crear `src/lib/bank-transfer/public-info.ts`:

```ts
import type { Prisma } from '@prisma/client'

// Campos de BankTransferAccount que SÍ se exponen al flujo público (decisión 7
// del spec: visibles para cualquiera que elija transferir). isEnabled/verifyHours
// se quedan server-side.
export const BANK_TRANSFER_PUBLIC_SELECT = {
  accountHolder: true,
  rut: true,
  bankName: true,
  accountType: true,
  accountNumber: true,
  email: true,
  instructions: true,
  holdHours: true,
} satisfies Prisma.BankTransferAccountSelect

export type BankTransferPublicInfo = Prisma.BankTransferAccountGetPayload<{
  select: typeof BANK_TRANSFER_PUBLIC_SELECT
}>
```

- [ ] **Step 2: Test de integración que falla**

Crear `tests/integration/bank-transfer-public.test.ts` con el boilerplate de seed de `tests/integration/customer-account-link.test.ts` (User owner + Business `BIZ='btp-biz-1'` subdomain `btpbiz` + BusinessUser + Service `price: 20000, depositAmount: 5000` + AvailabilityRule 0-6 de 00:00 a 23:59) y los mocks de infraestructura de ese mismo archivo (`@/lib/rate-limit`, `next/cache`, `@/server/actions/revalidate-business`, `@/lib/notifications` — mockear TODAS las funciones que bookings.ts importa de ahí, copiar la lista del test citado y agregar `sendBankTransferDeclaredToBusiness: async () => ({ success: true })`, `@/lib/auth/user` con `getCurrentUser: async () => null`). Primer describe:

```ts
describe('getBankTransferInfo', () => {
  it('devuelve null sin cuenta, null deshabilitada, e info pública habilitada', async () => {
    const { getBankTransferInfo } = await import('@/server/actions/bank-transfer-public')

    expect(await getBankTransferInfo(BIZ)).toBeNull()

    await prisma.bankTransferAccount.create({
      data: {
        businessId: BIZ, accountHolder: 'María', rut: '1-9', bankName: 'BancoEstado',
        accountType: 'vista', accountNumber: '123', isEnabled: false,
      },
    })
    expect(await getBankTransferInfo(BIZ)).toBeNull()

    await prisma.bankTransferAccount.update({ where: { businessId: BIZ }, data: { isEnabled: true } })
    const info = await getBankTransferInfo(BIZ)
    expect(info).not.toBeNull()
    expect(info!.bankName).toBe('BancoEstado')
    expect(info!.holdHours).toBe(24)
    // No filtra campos server-side:
    expect(info).not.toHaveProperty('isEnabled')
    expect(info).not.toHaveProperty('verifyHours')
  })
})
```

(En `afterAll`/`beforeEach` del archivo, borrar también `bankTransferAccount`, `payment`, `booking`, `customer` del BIZ.)

- [ ] **Step 3: Correr y ver fallar**

Run: `export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/agendita_test" DIRECT_URL="$DATABASE_URL"; npx vitest run --config vitest.integration.config.ts tests/integration/bank-transfer-public.test.ts`
Expected: FAIL — `Cannot find module '@/server/actions/bank-transfer-public'`

- [ ] **Step 4: Implementar la action**

Crear `src/server/actions/bank-transfer-public.ts`:

```ts
'use server'

import { prisma } from '@/lib/db'
import { BANK_TRANSFER_PUBLIC_SELECT, type BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'

// NOTE: módulo 'use server' — SOLO funciones async exportadas (schemas/consts
// en src/lib/bank-transfer/). Flujo PÚBLICO: sin sesión, como payments.ts.

export async function getBankTransferInfo(businessId: string): Promise<BankTransferPublicInfo | null> {
  const account = await prisma.bankTransferAccount.findUnique({
    where: { businessId },
    select: { ...BANK_TRANSFER_PUBLIC_SELECT, isEnabled: true },
  })
  if (!account || !account.isEnabled) return null
  const { isEnabled: _isEnabled, ...publicInfo } = account
  return publicInfo
}
```

- [ ] **Step 5: Correr y ver pasar** (mismo comando del Step 3). Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bank-transfer/public-info.ts src/server/actions/bank-transfer-public.ts tests/integration/bank-transfer-public.test.ts
git commit -m "feat(bank-transfer): getBankTransferInfo para el flujo público"
```

---

### Task 2: `createBooking` con `paymentMethod: 'bank_transfer'` + fix de recompute

**Files:**
- Modify: `src/server/actions/bookings.ts` (schema línea ~39; lógica de hold ~297-322)
- Modify: `src/lib/booking/recompute.ts`
- Test: `tests/integration/bank-transfer-public.test.ts` (describe nuevo) y `tests/unit/` donde viva el test actual de recompute (buscar `recomputeBookingAmountsAfterDiscount` en tests/unit y extenderlo)

- [ ] **Step 1: Tests de integración que fallan**

Agregar al archivo de Task 2 un describe `createBooking con transferencia` (usar `futureDate(n, hourUTC)` como en customer-account-link.test.ts, un teléfono distinto por test):

```ts
it('setea hold largo, persiste paymentMethod y respeta promo', async () => {
  const { createBooking } = await import('@/server/actions/bookings')
  await prisma.bankTransferAccount.create({
    data: { businessId: BIZ, accountHolder: 'M', rut: '1-9', bankName: 'BE', accountType: 'vista', accountNumber: '1', isEnabled: true },
  })

  const before = Date.now()
  const booking = await createBooking({
    serviceId: svc.id, customerName: 'Ana', customerPhone: '+56911200001',
    startDateTime: futureDate(2, 15), acceptedTerms: true, paymentMethod: 'bank_transfer',
  }, BIZ)

  const row = await prisma.booking.findUnique({ where: { id: booking.id } })
  expect(row!.paymentMethod).toBe('bank_transfer')
  expect(row!.status).toBe('pending_payment')
  const hours = (row!.holdExpiresAt!.getTime() - before) / 3_600_000
  expect(hours).toBeGreaterThan(23)
  expect(hours).toBeLessThan(25)
})

it('rechaza bank_transfer si el negocio no lo tiene habilitado', async () => {
  const { createBooking } = await import('@/server/actions/bookings')
  await prisma.bankTransferAccount.update({ where: { businessId: BIZ }, data: { isEnabled: false } })
  await expect(createBooking({
    serviceId: svc.id, customerName: 'Bea', customerPhone: '+56911200002',
    startDateTime: futureDate(3, 15), acceptedTerms: true, paymentMethod: 'bank_transfer',
  }, BIZ)).rejects.toThrow('transferencia')
})

it('sin paymentMethod el hold sigue siendo ~15min', async () => {
  const { createBooking } = await import('@/server/actions/bookings')
  const before = Date.now()
  const booking = await createBooking({
    serviceId: svc.id, customerName: 'Cata', customerPhone: '+56911200003',
    startDateTime: futureDate(4, 15), acceptedTerms: true,
  }, BIZ)
  const row = await prisma.booking.findUnique({ where: { id: booking.id } })
  expect(row!.paymentMethod).toBeNull()
  const mins = (row!.holdExpiresAt!.getTime() - before) / 60_000
  expect(mins).toBeGreaterThan(13)
  expect(mins).toBeLessThan(17)
})
```

(El caso "con promo el hold sigue siendo 24h" requiere seedear una Promotion; si el seed resulta pesado, cubrir la promo en el test unit de recompute del Step 4 y dejarlo anotado en el describe.)

- [ ] **Step 2: Ver fallar** (mismo comando integración). Expected: FAIL (Zod rechaza `paymentMethod` desconocido o el assert de hold).

- [ ] **Step 3: Implementar en bookings.ts**

1. Schema (línea ~48, después de `skipPackage`):

```ts
  paymentMethod: z.enum(['bank_transfer']).optional(),
```

2. En `createBooking`, ANTES de la tx (junto a las validaciones de servicio), resolver la cuenta:

```ts
  // Transferencia bancaria: validar server-side que esté habilitada y que el
  // servicio requiera abono. El hold largo da la ventana para transferir (spec §5.2).
  let bankTransferAccount: { holdHours: number } | null = null
  if (data.paymentMethod === 'bank_transfer') {
    bankTransferAccount = await prisma.bankTransferAccount.findFirst({
      where: { businessId, isEnabled: true },
      select: { holdHours: true },
    })
    if (!bankTransferAccount) {
      throw new Error('Este negocio no tiene transferencia bancaria habilitada')
    }
  }
```

3. Hold (línea ~301) — reemplazar:

```ts
      const holdExpiresAt = status === BookingStatus.pending_payment ? addMinutes(new Date(), 15) : null
```

por:

```ts
      const holdMinutes = bankTransferAccount && depositRequired > 0 ? bankTransferAccount.holdHours * 60 : 15
      const holdExpiresAt = status === BookingStatus.pending_payment ? addMinutes(new Date(), holdMinutes) : null
```

4. En el `tx.booking.create` data (línea ~320), después de `holdExpiresAt,`:

```ts
          paymentMethod: bankTransferAccount && depositRequired > 0 ? 'bank_transfer' : null,
```

5. Donde se llama `recomputeBookingAmountsAfterDiscount` (buscar el call site en bookings.ts, ~línea 356), pasarle `holdMinutes` (firma nueva del Step 4).

- [ ] **Step 4: Parametrizar recompute + test unit**

En `src/lib/booking/recompute.ts`: agregar `holdMinutes?: number` al objeto args y usar `addMinutes(now, args.holdMinutes ?? 15)` en la línea 25. Extender el test unit existente de recompute (buscarlo con grep en tests/unit) con un caso `holdMinutes: 1440` → hold a +24h.

- [ ] **Step 5: Ver pasar** integración + `npx vitest run tests/unit` del archivo de recompute. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/bookings.ts src/lib/booking/recompute.ts tests/integration/bank-transfer-public.test.ts tests/unit/<archivo-recompute>
git commit -m "feat(bank-transfer): createBooking con hold largo y paymentMethod persistido"
```

---

### Task 3: `declareBankTransfer` (idempotente, guards de carrera)

**Files:**
- Modify: `src/server/actions/bank-transfer-public.ts`
- Create: `src/lib/bank-transfer/declared.ts` (const del discriminador — no puede vivir en el archivo 'use server')
- Test: `tests/integration/bank-transfer-public.test.ts` (describe nuevo)

- [ ] **Step 1: Const del discriminador**

Crear `src/lib/bank-transfer/declared.ts`:

```ts
// providerPaymentId determinístico del Payment "declarado por la clienta".
// Doble propósito (spec §3.4): hace morder el unique [bookingId, provider,
// providerPaymentId] (idempotencia real vía P2002) y discrimina la declaración
// de la clienta de un pago manual que registró la dueña.
export const BT_DECLARED_PREFIX = 'bt-declared:'
export function btDeclaredId(bookingId: string): string {
  return `${BT_DECLARED_PREFIX}${bookingId}`
}
```

- [ ] **Step 2: Tests de integración que fallan**

Describe `declareBankTransfer` (helper local `mkTransferBooking(phone)` que llama `createBooking` con `paymentMethod: 'bank_transfer'` como en Task 2; la cuenta se re-habilita en un `beforeEach` del describe):

```ts
it('crea el Payment pendiente con monto server-side y mueve el hold a la ventana de verificación', async () => {
  const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
  const booking = await mkTransferBooking('+56911300001')

  const before = Date.now()
  const res = await declareBankTransfer(booking.id)
  expect(res.ok).toBe(true)

  const payment = await prisma.payment.findFirst({ where: { bookingId: booking.id } })
  expect(payment!.provider).toBe('manual')
  expect(payment!.status).toBe('pending')
  expect(payment!.paymentType).toBe('deposit')
  expect(payment!.amount).toBe(5000) // min(depositRequired, remainingBalance), NUNCA del cliente
  expect(payment!.providerPaymentId).toBe(`bt-declared:${booking.id}`)

  const row = await prisma.booking.findUnique({ where: { id: booking.id } })
  expect(row!.status).toBe('pending_payment')
  expect(row!.paymentStatus).toBe('unpaid') // el cron sigue pudiendo expirarla
  const hours = (row!.holdExpiresAt!.getTime() - before) / 3_600_000
  expect(hours).toBeGreaterThan(47)
  expect(hours).toBeLessThan(49)
})

it('es idempotente: doble declare = un solo Payment y ok en ambos', async () => {
  const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
  const booking = await mkTransferBooking('+56911300002')
  await declareBankTransfer(booking.id)
  const res2 = await declareBankTransfer(booking.id)
  expect(res2.ok).toBe(true)
  expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(1)
})

it('verifyHours null → hold queda NULL (retención indefinida, opt-in)', async () => {
  const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
  await prisma.bankTransferAccount.update({ where: { businessId: BIZ }, data: { verifyHours: null } })
  const booking = await mkTransferBooking('+56911300003')
  await declareBankTransfer(booking.id)
  const row = await prisma.booking.findUnique({ where: { id: booking.id } })
  expect(row!.holdExpiresAt).toBeNull()
  await prisma.bankTransferAccount.update({ where: { businessId: BIZ }, data: { verifyHours: 48 } })
})

it('con hold vencido: error legible y CERO payments (carrera vs cron)', async () => {
  const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
  const booking = await mkTransferBooking('+56911300004')
  await prisma.booking.update({ where: { id: booking.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } })
  await expect(declareBankTransfer(booking.id)).rejects.toThrow('expiró')
  expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(0)
})

it('con booking ya expirada por el cron: error y cero payments', async () => {
  const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
  const booking = await mkTransferBooking('+56911300005')
  await prisma.booking.update({ where: { id: booking.id }, data: { status: 'expired' } })
  await expect(declareBankTransfer(booking.id)).rejects.toThrow('expiró')
  expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(0)
})

it('rechaza bookings que no eligieron transferencia', async () => {
  const { createBooking } = await import('@/server/actions/bookings')
  const { declareBankTransfer } = await import('@/server/actions/bank-transfer-public')
  const booking = await createBooking({
    serviceId: svc.id, customerName: 'MP', customerPhone: '+56911300006',
    startDateTime: futureDate(9, 15), acceptedTerms: true,
  }, BIZ)
  await expect(declareBankTransfer(booking.id)).rejects.toThrow()
})
```

- [ ] **Step 3: Ver fallar.** Expected: FAIL — `declareBankTransfer is not a function`.

- [ ] **Step 4: Implementar**

Agregar a `src/server/actions/bank-transfer-public.ts`:

```ts
import { addHours } from 'date-fns'
import { Prisma, PaymentProvider, PaymentStatus, PaymentType } from '@prisma/client'
import { checkRateLimit } from '@/lib/rate-limit'
import { btDeclaredId } from '@/lib/bank-transfer/declared'
import { sendNotificationSafely, sendBankTransferDeclaredToBusiness } from '@/lib/notifications'

export async function declareBankTransfer(bookingId: string): Promise<{ ok: true }> {
  const limit = await checkRateLimit('declare-bank-transfer', 10, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const declared = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { business: { include: { bankTransferAccount: true } }, service: true, customer: true },
    })
    if (!booking) throw new Error('Reserva no encontrada')
    if (booking.paymentMethod !== 'bank_transfer') {
      throw new Error('Esta reserva no eligió pago por transferencia')
    }
    const account = booking.business.bankTransferAccount
    if (!account || !account.isEnabled) {
      throw new Error('Este negocio no tiene transferencia bancaria habilitada')
    }

    // Idempotencia: si ya declaró, éxito sin tocar el hold (re-declarar no
    // debe re-extender la ventana de verificación).
    const existing = await tx.payment.findFirst({
      where: { bookingId, provider: 'manual', providerPaymentId: btDeclaredId(bookingId) },
    })
    if (existing) return null

    // Guard de carrera vs cron (spec §4): solo transiciona una pending_payment
    // con hold vigente. Si el cron ganó (expired) o el hold venció, count=0.
    const now = new Date()
    const newHold = account.verifyHours == null ? null : addHours(now, account.verifyHours)
    const { count } = await tx.booking.updateMany({
      where: { id: bookingId, status: 'pending_payment', holdExpiresAt: { gt: now } },
      data: { holdExpiresAt: newHold },
    })
    if (count === 0) {
      throw new Error('Tu reserva expiró. Volvé a reservar para elegir un nuevo horario.')
    }

    // Monto server-authoritative, mismo criterio que initiatePayment (payments.ts:113).
    const amount = Math.min(booking.depositRequired, booking.remainingBalance)
    if (amount <= 0) throw new Error('Esta reserva no requiere abono')

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
    return { booking, account, amount }
  })

  if (declared) {
    // Post-tx, best-effort: avisar a la dueña (la función se crea en Task 4).
    await sendNotificationSafely(
      () => sendBankTransferDeclaredToBusiness(declared.booking.businessId, {
        businessName: declared.booking.business.name,
        businessTimezone: declared.booking.business.timezone,
        customerName: declared.booking.customer.name,
        serviceName: declared.booking.service?.name ?? 'servicio',
        startDateTime: declared.booking.startDateTime,
        amount: declared.amount,
        currency: declared.booking.business.currency || 'CLP',
        bookingNumber: declared.booking.bookingNumber,
      }),
      'bank transfer declared notification',
    )
  }

  return { ok: true }
}
```

Nota TDD: hasta que Task 4 cree `sendBankTransferDeclaredToBusiness`, importar de `'@/lib/notifications'` va a romper — para este task, el mock de `@/lib/notifications` del test ya la incluye (Step 2 de Task 1), y para que el módulo compile en runtime real, Task 4 debe mergearse antes de correr la app. Orden de commits dentro del PR: aceptable. Verificar la firma exacta de `sendNotificationSafely` (grep en `src/lib/notifications/`) y ajustar la llamada si recibe la promesa directa en vez de un thunk.

- [ ] **Step 5: Ver pasar** (integración completa del archivo). Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/bank-transfer-public.ts src/lib/bank-transfer/declared.ts tests/integration/bank-transfer-public.test.ts
git commit -m "feat(bank-transfer): declareBankTransfer idempotente con guards de carrera"
```

---

### Task 4: Emails (variante transferencia + declaró-transferencia)

**Files:**
- Modify: `src/lib/notifications/types.ts` (BookingEmailData línea 8; NewBookingBusinessEmailData — buscarla en el mismo archivo)
- Modify: `src/lib/notifications/templates.ts` (`bookingReceivedCustomerHtml` línea ~125, `bookingReceivedCustomerText` ~162, `newBookingBusinessHtml/Text`)
- Modify: `src/lib/notifications/email-provider.ts` (función nueva) y `src/lib/notifications/index.ts` (export)
- Modify: `src/server/actions/bookings.ts` (call sites ~104 y ~131)
- Test: `tests/unit/bank-transfer-emails.test.ts`

- [ ] **Step 1: Test unit que falla**

```ts
import { describe, it, expect } from 'vitest'
import { bookingReceivedCustomerHtml, bookingReceivedCustomerText, bankTransferDeclaredBusinessText } from '@/lib/notifications/templates'

const base = {
  businessName: 'Studio X', businessTimezone: 'America/Santiago', businessCurrency: 'CLP',
  customerName: 'Ana', customerPhone: '56911100001', serviceName: 'Corte',
  startDateTime: new Date('2026-08-01T15:00:00Z'), totalPrice: 20000,
  depositRequired: 5000, depositPaid: 0, remainingBalance: 20000,
}

describe('emails de transferencia', () => {
  it('reserva recibida SIN bankTransfer: no menciona datos bancarios', () => {
    const html = bookingReceivedCustomerHtml(base)
    expect(html).not.toContain('Datos para transferir')
  })

  it('reserva recibida CON bankTransfer: datos completos + plazo + link', () => {
    const data = {
      ...base,
      bankTransfer: {
        accountHolder: 'María P', rut: '1-9', bankName: 'BancoEstado', accountType: 'vista',
        accountNumber: '12345678', email: 'm@e.cl', instructions: 'poné tu nombre',
        deadline: new Date('2026-07-11T15:00:00Z'),
        confirmationUrl: 'https://x.agendita.cl/book/confirmation?bookingId=abc',
      },
    }
    const html = bookingReceivedCustomerHtml(data)
    const text = bookingReceivedCustomerText(data)
    for (const out of [html, text]) {
      expect(out).toContain('Datos para transferir')
      expect(out).toContain('BancoEstado')
      expect(out).toContain('12345678')
      expect(out).toContain('Ya transfer')
      expect(out).toContain('bookingId=abc')
    }
  })

  it('declaró transferencia (dueña): monto, clienta y servicio', () => {
    const text = bankTransferDeclaredBusinessText({
      businessName: 'Studio X', businessTimezone: 'America/Santiago',
      customerName: 'Ana', serviceName: 'Corte', startDateTime: new Date('2026-08-01T15:00:00Z'),
      amount: 5000, currency: 'CLP', bookingNumber: 4738,
    })
    expect(text).toContain('Ana')
    expect(text).toContain('#4738')
    expect(text).toContain('5.000')
  })
})
```

Run y ver FAIL (funciones/campos inexistentes).

- [ ] **Step 2: Types**

En `types.ts`, agregar al final de `BookingEmailData`:

```ts
  bankTransfer?: {
    accountHolder: string
    rut: string
    bankName: string
    accountType: string
    accountNumber: string
    email?: string | null
    instructions?: string | null
    deadline: Date | null
    confirmationUrl: string
  }
```

Y a `NewBookingBusinessEmailData` (buscarla en el archivo): `paymentNote?: string`.

Interface nueva en el mismo archivo:

```ts
export interface BankTransferDeclaredEmailData {
  businessName: string
  businessTimezone: string
  customerName: string
  serviceName: string
  startDateTime: Date
  amount: number
  currency: string
  bookingNumber?: number | null
}
```

- [ ] **Step 3: Templates**

En `templates.ts`:

1. En `bookingReceivedCustomerHtml`, junto a las otras secciones condicionales (discount/policy/whatsapp, líneas ~130-142), agregar:

```ts
  const bankSection = data.bankTransfer
    ? `<div style="margin-top:16px;border:1px solid #e5e0da;border-radius:8px;padding:16px">
        <p style="font-weight:600;margin:0 0 8px">Datos para transferir el abono (${fmtCurrency(data.depositRequired, data.businessCurrency)})</p>
        <table style="font-size:14px;border-collapse:collapse">
          <tr><td style="padding:2px 12px 2px 0;color:#666">Titular</td><td>${escapeHtml(data.bankTransfer.accountHolder)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#666">RUT</td><td>${escapeHtml(data.bankTransfer.rut)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#666">Banco</td><td>${escapeHtml(data.bankTransfer.bankName)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#666">Tipo</td><td>${escapeHtml(data.bankTransfer.accountType)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#666">Cuenta</td><td>${escapeHtml(data.bankTransfer.accountNumber)}</td></tr>
          ${data.bankTransfer.email ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Email</td><td>${escapeHtml(data.bankTransfer.email)}</td></tr>` : ''}
        </table>
        ${data.bankTransfer.instructions ? `<p style="font-size:13px;color:#666;margin:8px 0 0">${escapeHtml(data.bankTransfer.instructions)}</p>` : ''}
        ${data.bankTransfer.deadline ? `<p style="font-size:13px;margin:8px 0 0"><strong>Plazo:</strong> tenés hasta el ${fmtDate(data.bankTransfer.deadline, data.businessTimezone)} para transferir y avisarnos.</p>` : ''}
        <p style="margin:12px 0 0"><a href="${data.bankTransfer.confirmationUrl}" style="font-weight:600">Cuando transfieras, avisá con el botón "Ya transferí" acá →</a></p>
      </div>`
    : ''
```

e insertar `${bankSection}` en el HTML devuelto (después de la tabla de resumen, antes de `policySection`).

2. En `bookingReceivedCustomerText`, análogo con `lines.push(...)`:

```ts
  if (data.bankTransfer) {
    lines.push('', `Datos para transferir el abono (${deposit}):`,
      `Titular: ${data.bankTransfer.accountHolder}`, `RUT: ${data.bankTransfer.rut}`,
      `Banco: ${data.bankTransfer.bankName}`, `Tipo: ${data.bankTransfer.accountType}`,
      `Cuenta: ${data.bankTransfer.accountNumber}`)
    if (data.bankTransfer.email) lines.push(`Email: ${data.bankTransfer.email}`)
    if (data.bankTransfer.instructions) lines.push(data.bankTransfer.instructions)
    if (data.bankTransfer.deadline) lines.push(`Plazo: hasta ${fmtDate(data.bankTransfer.deadline, data.businessTimezone)}`)
    lines.push(`Cuando transfieras, avisá "Ya transferí" acá: ${data.bankTransfer.confirmationUrl}`)
  }
```

(ubicarlo antes del cierre de la función, imitando cómo se arma el resto; ajustar al estilo real del archivo).

3. `newBookingBusinessHtml/Text`: renderizar `data.paymentNote` como párrafo/línea si está presente.

4. Funciones nuevas (imitar el estilo de las existentes):

```ts
export function bankTransferDeclaredBusinessHtml(data: BankTransferDeclaredEmailData): string {
  return baseHtml(`
    ${header('Transferencia declarada')}
    <p style="font-size:15px">${escapeHtml(data.customerName)} avisó que transfirió <strong>${fmtCurrency(data.amount, data.currency)}</strong> por la reserva${data.bookingNumber != null ? ` <strong>#${data.bookingNumber}</strong>` : ''}.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${fmtDate(data.startDateTime, data.businessTimezone)}</td></tr>
    </table>
    <p style="margin-top:16px;font-size:14px">Verificá en tu cuenta bancaria y confirmá la reserva desde el dashboard.</p>
  `)
}
export function bankTransferDeclaredBusinessText(data: BankTransferDeclaredEmailData): string {
  const lines = [
    'Transferencia declarada', '',
    `${data.customerName} avisó que transfirió ${fmtCurrency(data.amount, data.currency)} por la reserva${data.bookingNumber != null ? ` #${data.bookingNumber}` : ''}.`,
    `Servicio: ${data.serviceName}`,
    `Fecha: ${fmtDate(data.startDateTime, data.businessTimezone)}`,
    '', 'Verificá en tu cuenta y confirmá la reserva desde el dashboard.',
  ]
  return lines.join('\n')
}
```

- [ ] **Step 4: Sender + export**

En `email-provider.ts` (imitar `sendNewBookingNotificationToBusiness`, línea ~179):

```ts
export async function sendBankTransferDeclaredToBusiness(
  businessId: string,
  data: BankTransferDeclaredEmailData,
): Promise<EmailResult[]> {
  const ownerEmails = await getBusinessOwnerEmails(businessId)
  if (ownerEmails.length === 0) {
    return [{ success: false, skipped: 'No hay owners/admins con email para el negocio' }]
  }
  const html = bankTransferDeclaredBusinessHtml(data)
  const text = bankTransferDeclaredBusinessText(data)
  return Promise.all(
    ownerEmails.map((owner) =>
      sendEmail(owner.email, `Transferencia declarada - ${data.customerName}`, html, text, {}),
    ),
  )
}
```

Exportarla en `index.ts` junto a las demás.

- [ ] **Step 5: Wiring en bookings.ts**

En el call site de `sendBookingReceivedToCustomer` (~104) y `sendNewBookingNotificationToBusiness` (~131): cuando `booking.paymentMethod === 'bank_transfer'`, cargar la cuenta pública (reusar `BANK_TRANSFER_PUBLIC_SELECT`) y agregar:

```ts
  bankTransfer: {
    ...cuentaPublica,
    deadline: booking.holdExpiresAt,
    confirmationUrl: `${getBusinessPublicUrl(business)}/book/confirmation?bookingId=${booking.id}`,
  },
```

y al email de la dueña `paymentNote: 'La clienta eligió pagar el abono por transferencia. Te va a llegar otro aviso cuando declare que transfirió.'`. Verificar qué objeto `business` está disponible en ese scope (el include de la tx) y que `getBusinessPublicUrl` esté importado (payments.ts lo usa; en bookings.ts verificar import).

- [ ] **Step 6: Ver pasar** el unit nuevo + `npx vitest run tests/unit` (sin regresiones en tests de templates existentes) + integración completa. Commit:

```bash
git add src/lib/notifications/ src/server/actions/bookings.ts tests/unit/bank-transfer-emails.test.ts
git commit -m "feat(bank-transfer): emails con datos bancarios y aviso de declaración"
```

---

### Task 5: Wizard — selector de método, pantalla de datos, persistencia de idempotencyKey

**Files:**
- Create: `src/components/booking/transfer-details.tsx` (presentacional puro — testeable estático)
- Modify: `src/components/booking/wizard.tsx` (pasar `updateData` a StepPayment)
- Modify: `src/components/booking/step-payment.tsx`
- Modify: `src/lib/payments/factory.ts` (reasons líneas ~330 y ~339)
- Test: `tests/unit/transfer-details.test.tsx`

- [ ] **Step 1: TransferDetails + test (TDD)**

Test `tests/unit/transfer-details.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TransferDetails } from '@/components/booking/transfer-details'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const bank = {
  accountHolder: 'María P', rut: '1-9', bankName: 'BancoEstado', accountType: 'vista',
  accountNumber: '12345678', email: null, instructions: 'nombre en el asunto', holdHours: 24,
}

describe('TransferDetails', () => {
  it('muestra datos, monto y botón declarar', () => {
    const html = renderToStaticMarkup(
      <TransferDetails bank={bank} amount={5000} deadline={new Date('2026-08-01T15:00:00Z')} timezone="America/Santiago" declaring={false} onDeclare={() => {}} />,
    )
    expect(html).toContain('BancoEstado')
    expect(html).toContain('12345678')
    expect(html).toContain('nombre en el asunto')
    expect(html).toContain('Ya transferí')
  })
  it('sin deadline no muestra plazo', () => {
    const html = renderToStaticMarkup(
      <TransferDetails bank={bank} amount={5000} deadline={null} timezone="America/Santiago" declaring={false} onDeclare={() => {}} />,
    )
    expect(html).not.toContain('Tenés hasta')
  })
})
```

Implementación `transfer-details.tsx` (presentacional, sin fetch): card con los datos (mismo estilo `rounded-2xl bg-muted/55 p-5` del wizard), monto destacado con `formatMoney(amount)`, plazo con `formatBookingDateTime(deadline, timezone)` prefijado "Tenés hasta", instrucciones, y `<Button onClick={onDeclare} disabled={declaring}>{declaring ? 'Avisando…' : 'Ya transferí'}</Button>`. Props exactas las del test.

- [ ] **Step 2: wizard.tsx** — pasar `updateData` donde renderiza `<StepPayment ... />` (buscar el render en el switch de steps): agregar prop `updateData={updateData}`.

- [ ] **Step 3: step-payment.tsx** — cambios:

1. Props: agregar `updateData: (partial: Partial<BookingData>) => void` a la firma (línea 53).
2. Persistir la key (debajo del `useMemo` de línea 244):

```ts
  // Persistir la key en el estado del wizard: si la clienta vuelve atrás y
  // re-entra (p.ej. eligió transferencia y se arrepintió a MP), el remount
  // reusa la MISMA key → createBooking devuelve la booking existente en vez
  // de chocar contra su propio hold largo (spec §5.4).
  useEffect(() => {
    if (!data.idempotencyKey) updateData({ idempotencyKey })
  }, [data.idempotencyKey, idempotencyKey, updateData])
```

3. Estado nuevo: `bankInfo` + método + pantalla transferencia:

```ts
  const [bankInfo, setBankInfo] = useState<BankTransferPublicInfo | null>(null)
  const [method, setMethod] = useState<'online' | 'transfer' | null>(null)
  const [transferBooking, setTransferBooking] = useState<{ id: string; bookingNumber: number | null; deadline: Date | null } | null>(null)
  const [declaring, setDeclaring] = useState(false)
```

(importar `getBankTransferInfo, declareBankTransfer` de `@/server/actions/bank-transfer-public` y `type BankTransferPublicInfo` de `@/lib/bank-transfer/public-info`). El union de `step` (línea 55) pasa a `'review' | 'processing' | 'success' | 'error' | 'transfer-details' | 'transfer-declared'`.

4. En el useEffect de disponibilidad (línea 226), fetchear ambos:

```ts
    Promise.all([getOnlinePaymentAvailability(businessId), getBankTransferInfo(businessId)])
      .then(([avail, bank]) => { setAvailability(avail); setBankInfo(bank) })
```

(manteniendo el catch actual, que además setea `setBankInfo(null)`).

5. Handler nuevo:

```ts
  async function handleTransferBooking() {
    setLoading(true); setStep('processing'); setErrorMessage('')
    try {
      const booking = await createBooking({
        serviceId: data.serviceId!, customerName: data.customerName, customerPhone: data.customerPhone,
        customerEmail: data.customerEmail, startDateTime: data.timeSlot!.start, idempotencyKey,
        acceptedTerms, promotionCode: appliedPromo?.code, referralToken, skipPackage: !usePackage,
        paymentMethod: 'bank_transfer',
      }, businessId)
      setTransferBooking({ id: booking.id, bookingNumber: booking.bookingNumber ?? null, deadline: booking.holdExpiresAt ?? null })
      setStep('transfer-details')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error al crear la reserva')
      setStep('error')
    } finally { setLoading(false) }
  }

  async function handleDeclare() {
    if (!transferBooking) return
    setDeclaring(true); setErrorMessage('')
    try {
      await declareBankTransfer(transferBooking.id)
      setStep('transfer-declared')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No pudimos registrar tu aviso')
    } finally { setDeclaring(false) }
  }
```

(verificar que el objeto retornado por `createBooking` incluya `holdExpiresAt`; si el select del return no lo trae, agregarlo o setear deadline null y mostrar el plazo genérico "tenés ${bankInfo.holdHours} horas").

6. Pantallas nuevas (antes del render principal, junto a los early-returns existentes):

```tsx
  if (step === 'transfer-details' && bankInfo && transferBooking) {
    return (
      <div>
        <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Transferí el abono</h2>
        <p className="mb-6 text-lg text-muted-foreground">Tu horario queda reservado mientras transferís</p>
        {errorMessage && <p className="mb-4 text-sm text-destructive">{errorMessage}</p>}
        <TransferDetails bank={bankInfo} amount={effectiveDeposit} deadline={transferBooking.deadline} timezone={timezone} declaring={declaring} onDeclare={handleDeclare} />
        <p className="mt-4 text-sm text-muted-foreground">
          También podés avisar más tarde desde{' '}
          <a className="font-semibold text-primary underline" href={`/book/confirmation?bookingId=${transferBooking.id}`}>tu página de reserva</a>.
        </p>
      </div>
    )
  }

  if (step === 'transfer-declared' && transferBooking) {
    return (
      <div className="py-10 text-center">
        <Loader2 className="mx-auto mb-4 hidden" />
        <h2 className="mb-2 font-heading text-2xl font-semibold tracking-tight text-primary">Transferencia en verificación</h2>
        <p className="mb-2 text-muted-foreground">Avisamos al negocio. Te confirmaremos cuando verifique el pago.</p>
        {transferBooking.bookingNumber != null && (
          <p className="mb-5 text-sm text-muted-foreground">Tu código de reserva: <span className="font-mono font-semibold text-primary">#{transferBooking.bookingNumber}</span></p>
        )}
        <Button asChild className="h-12 rounded-full px-6">
          <a href={`/book/confirmation?bookingId=${transferBooking.id}`}>Ver el estado de mi reserva</a>
        </Button>
      </div>
    )
  }
```

(usar el icono que corresponda en vez del Loader2 oculto — p.ej. `Clock` de lucide; ajustar imports).

7. Selector de método: en la pantalla principal de pago (la rama final del render, donde está el botón que llama `handlePayment` — leer el render completo antes de tocar), cuando `availability?.available && bankInfo` mostrar dos opciones tipo radio-cards arriba del botón:

```tsx
  {availability?.available && bankInfo && (
    <div className="mb-6 grid gap-3 sm:grid-cols-2">
      {([['online', 'Pagar online', 'Tarjeta, débito o crédito vía Mercado Pago'], ['transfer', 'Transferencia bancaria', 'Te mostramos los datos y nos avisás cuando transfieras']] as const).map(([key, title, desc]) => (
        <button key={key} type="button" onClick={() => setMethod(key)}
          className={`rounded-xl border p-4 text-left text-sm transition-colors ${(method ?? 'online') === key ? 'border-primary bg-primary/5' : 'border-border'}`}>
          <span className="block font-semibold text-primary">{title}</span>
          <span className="mt-0.5 block text-muted-foreground">{desc}</span>
        </button>
      ))}
    </div>
  )}
```

y el botón principal despacha según `(method ?? 'online')`: `'transfer'` → `handleTransferBooking`, si no → `handlePayment` (label del botón: "Continuar con transferencia" vs el actual).

8. Rama "solo transferencia" (MP no disponible pero `bankInfo` presente): en el early-return de `availability && !availability.available` (línea 417), si `bankInfo` existe, en vez del aviso ámbar + "Confirmar reserva", renderizar el mismo resumen con el botón "Continuar con transferencia" → `handleTransferBooking`. Si NO hay `bankInfo`, queda el fallback actual pero con la copy corregida:

```
'Este negocio coordina el abono directamente contigo'
```

(reemplaza el string de la línea 443 que menciona "transferencia" — ahora sería confuso).

- [ ] **Step 4: factory.ts copys** — en las líneas ~330 y ~339, reemplazar los reasons "…coordina el abono directamente por WhatsApp o transferencia" por "Este negocio coordina el abono directamente contigo" (mantener el resto del string/estructura).

- [ ] **Step 5: Verificar** — `npx vitest run tests/unit/transfer-details.test.tsx` PASS + `npm test` completo sin regresiones (especial atención a tests existentes de step-payment/wizard si los hay). Commit:

```bash
git add src/components/booking/transfer-details.tsx src/components/booking/wizard.tsx src/components/booking/step-payment.tsx src/lib/payments/factory.ts tests/unit/transfer-details.test.tsx
git commit -m "feat(bank-transfer): selector de método y flujo de transferencia en el wizard"
```

---

### Task 6: `/book/confirmation` — derive extendido + superficie activa

**Files:**
- Modify: `src/lib/payments/confirmation-state.ts`
- Modify: `src/app/book/confirmation/page.tsx`
- Create: `src/app/book/confirmation/transfer-panel.tsx` (client, reusa `TransferDetails`)
- Test: `tests/unit/confirmation-state.test.ts` (extender el existente si hay; si no, crearlo)

- [ ] **Step 1: Tests de derive que fallan**

```ts
import { describe, it, expect } from 'vitest'
import { deriveConfirmationState } from '@/lib/payments/confirmation-state'

const bt = (status: string) => ({ status, provider: 'manual', providerPaymentId: 'bt-declared:abc' })

describe('deriveConfirmationState — transferencia y estados terminales', () => {
  it('expired corta primero aunque haya payment pendiente', () => {
    expect(deriveConfirmationState({ status: 'expired', payments: [bt('pending')] })).toBe('expired')
  })
  it('cancelled corta primero aunque haya payment rejected', () => {
    expect(deriveConfirmationState({ status: 'cancelled', payments: [bt('rejected')] })).toBe('cancelled')
  })
  it('bt pending → verifying_transfer', () => {
    expect(deriveConfirmationState({ status: 'pending_payment', payments: [bt('pending')] })).toBe('verifying_transfer')
  })
  it('manual de la dueña (sin bt-declared) NO dispara verifying_transfer', () => {
    expect(deriveConfirmationState({ status: 'pending_payment', payments: [{ status: 'pending', provider: 'manual', providerPaymentId: null }] })).toBe('pending')
  })
  it('MP pending sigue siendo verifying (sin regresión)', () => {
    expect(deriveConfirmationState({ status: 'pending_payment', payments: [{ status: 'pending', provider: 'mercado_pago', providerPaymentId: null }] })).toBe('verifying')
  })
})
```

- [ ] **Step 2: Implementar derive**

`confirmation-state.ts` nuevo contenido (mantiene TODA la lógica MP intacta):

```ts
import { BT_DECLARED_PREFIX } from '@/lib/bank-transfer/declared'

export type ConfirmationState =
  | 'confirmed' | 'verifying' | 'verifying_transfer' | 'rejected' | 'pending' | 'expired' | 'cancelled'

interface DeriveInput {
  status: string
  payments: { status: string; provider: string; providerPaymentId?: string | null }[]
}

export function deriveConfirmationState(input: DeriveInput): ConfirmationState {
  if (input.status === 'confirmed' || input.status === 'completed') return 'confirmed'
  // Estados terminales primero: una reserva muerta nunca debe mostrar
  // "verificando" por un Payment pendiente huérfano (spec §5.5).
  if (input.status === 'expired') return 'expired'
  if (input.status === 'cancelled') return 'cancelled'

  const btDeclared = input.payments.some(
    p => p.provider === 'manual' && p.status === 'pending' && p.providerPaymentId?.startsWith(BT_DECLARED_PREFIX),
  )
  if (btDeclared) return 'verifying_transfer'

  const mpPayments = input.payments.filter(p => p.provider === 'mercado_pago')
  if (mpPayments.length === 0) return 'pending'
  if (mpPayments.some(p => p.status === 'approved')) return 'confirmed'
  if (mpPayments.some(p => p.status === 'pending' || p.status === 'in_process')) return 'verifying'
  if (mpPayments.some(p => p.status === 'rejected' || p.status === 'cancelled' || p.status === 'failed')) return 'rejected'
  return 'pending'
}
```

Ver pasar el unit. OJO: grep por otros consumidores de `deriveConfirmationState`/`ConfirmationState` antes de asumir que la página es el único (si aparece otro, cubrir sus casos).

- [ ] **Step 3: Página**

En `page.tsx`:

1. Query (línea 32): `payments: { where: { provider: { in: ['mercado_pago', 'manual'] } }, select: { status: true, provider: true, providerPaymentId: true } }`.
2. `stateConfig`: agregar tres entradas (mismo shape que las existentes):
   - `verifying_transfer`: icon `Clock`, ámbar, título "Verificando tu transferencia", mensaje `"${booking.business.name} va a confirmar tu reserva cuando verifique el pago."`
   - `expired`: icon `XCircle`, muted, "Tu reserva expiró", "No se completó el pago a tiempo y el horario se liberó. Podés reservar de nuevo." (+ botón "Reservar de nuevo" → `bookHref`, reusar el bloque de botones de `rejected` extendiendo su condición a `state === 'rejected' || state === 'expired'`).
   - `cancelled`: icon `XCircle`, muted, "Reserva cancelada", "Esta reserva fue cancelada. Si transferiste y no fue reconocido, contactá al negocio."
3. Superficie activa (spec §5.5.3): después del resumen, cuando corresponda:

```tsx
  const canDeclare =
    booking.paymentMethod === 'bank_transfer' &&
    state === 'pending' &&
    booking.holdExpiresAt != null &&
    booking.holdExpiresAt > new Date()

  // ...y en el JSX, tras el studio-card del resumen:
  {canDeclare && bankInfo && (
    <TransferPanel bank={bankInfo} amount={Math.min(booking.depositRequired, booking.remainingBalance)} deadline={booking.holdExpiresAt} timezone={businessTimezone} bookingId={booking.id} />
  )}
```

con `bankInfo` cargado en el server component solo si hace falta: `const bankInfo = canDeclare ? await getBankTransferInfo(booking.businessId) : null` (import de la action; llamarla como función es válido en un server component) y `businessTimezone` agregado al select del business en la query (`timezone: true`).

4. `transfer-panel.tsx` (client):

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TransferDetails } from '@/components/booking/transfer-details'
import { declareBankTransfer } from '@/server/actions/bank-transfer-public'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'

export function TransferPanel({ bank, amount, deadline, timezone, bookingId }: {
  bank: BankTransferPublicInfo; amount: number; deadline: Date | null; timezone: string; bookingId: string
}) {
  const router = useRouter()
  const [declaring, setDeclaring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDeclare() {
    setDeclaring(true); setError(null)
    try {
      await declareBankTransfer(bookingId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos registrar tu aviso')
    } finally { setDeclaring(false) }
  }

  return (
    <div className="mb-8">
      <TransferDetails bank={bank} amount={amount} deadline={deadline} timezone={timezone} declaring={declaring} onDeclare={handleDeclare} />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
```

5. La copy de `pending` (línea 85) cuando `booking.paymentMethod === 'bank_transfer'`: cambiar el mensaje a "Transferí el abono y avisanos con el botón de abajo para confirmar tu reserva." (condicional inline en el config).

- [ ] **Step 4: Verificar** — unit de derive PASS; `npm test` completo; smoke manual mental: MP-abandonado sigue mostrando `verifying` (payment MP pending existe). Commit:

```bash
git add src/lib/payments/confirmation-state.ts src/app/book/confirmation/ tests/unit/confirmation-state.test.ts
git commit -m "feat(bank-transfer): confirmation activa + estados expired/cancelled/verifying_transfer"
```

---

### Task 7: `/mi` — label "Transferencia en verificación"

**Files:**
- Modify: `src/app/mi/[slug]/page.tsx` (render en líneas ~86 y ~108; la query de bookings más arriba en el archivo)

- [ ] **Step 1:** En la query de bookings de la página (buscar el `findMany`/include), agregar:

```ts
  payments: {
    where: { provider: 'manual', status: 'pending', providerPaymentId: { startsWith: 'bt-declared:' } },
    select: { id: true },
  },
```

- [ ] **Step 2:** Helper local en la página + uso en ambos render sites (86 y 108):

```ts
  const statusLabel = (b: { status: BookingStatus; payments: { id: string }[] }) =>
    b.status === 'pending_payment' && b.payments.length > 0
      ? 'Transferencia en verificación'
      : bookingStatusLabels[b.status]
```

y reemplazar `bookingStatusLabels[b.status]` por `statusLabel(b)` en los dos lugares. Ajustar imports/types según lo que la página ya tenga.

- [ ] **Step 3:** `npm test` (la página no tiene test propio; verificar que compile con `npm run lint`). Commit:

```bash
git add src/app/mi/\[slug\]/page.tsx
git commit -m "feat(bank-transfer): /mi muestra transferencia en verificación"
```

---

### Task 8: Verificación final + PR

- [ ] **Step 1:** Suite completa:

```bash
npm test && export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/agendita_test" DIRECT_URL="$DATABASE_URL" && npm run test:integration && npm run lint
```

Expected: todo verde, 0 errores de lint nuevos. (1 flake unit suelto → re-correr.)

- [ ] **Step 2:** Push + PR:

```bash
git push -u origin claude/bank-transfer-prB
gh pr create --title "Transferencia bancaria PR B: flujo público completo" --body "$(cat <<'EOF'
## PR B de 3 — abono por transferencia bancaria

Spec: docs/superpowers/specs/2026-07-10-abono-transferencia-bancaria-design.md (§5, §8 parcial)

- Wizard: selector MP/transferencia, pantalla de datos bancarios, "Ya transferí"
- `createBooking` con `paymentMethod: 'bank_transfer'` → hold = holdHours del negocio (fix: recompute ya no pisa el hold con promos)
- `declareBankTransfer`: idempotente (`bt-declared:<id>`), guards de carrera vs cron, monto server-side
- idempotencyKey persistida en el wizard (fix del auto-bloqueo al volver atrás y pagar MP)
- `/book/confirmation` como superficie activa (declara desde ahí si cerró la pestaña) + estados expired/cancelled/verifying_transfer
- `/mi` muestra "Transferencia en verificación"
- Emails: reserva recibida con datos bancarios + plazo + link; aviso a la dueña al declarar; nota de método en el email de nueva reserva

⚠️ **No habilitar el toggle de transferencia en producción hasta que PR C (verificación en dashboard + cron) esté mergeado** — una declaración quedaría sin UI de verificación.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**NO mergear** — lo decide el usuario.

---

## Notas para el implementador

- Fuera de alcance de este PR: dashboard de verificación (`confirmBankTransfer`/`rejectBankTransfer`), cambios al cron, aviso del dashboard home, fix de `cancelBooking` — todo eso es PR C.
- Antes de editar `step-payment.tsx`, LEER el archivo entero (~470+ líneas): el plan cita líneas de la rama actual y el render principal (post línea 470) no está citado completo — integrar el selector respetando la estructura real.
- Errores pre-existentes de `tsc --noEmit` (drift del cliente Prisma en tests) no son de este PR.
- Si un mock de `@/lib/notifications` en tests de integración falla por función faltante, copiar la lista completa de exports usados por bookings.ts (ver `customer-account-link.test.ts:25-34`) y sumar `sendBankTransferDeclaredToBusiness`.
