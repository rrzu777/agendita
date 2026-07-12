# Saldo Restante por Transferencia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La clienta puede declarar la transferencia del saldo restante desde /book/confirmation (reservas confirmadas/completadas), y la dueña verificarla/rechazarla desde el dashboard, sin corromper ledger ni superficies de abono.

**Architecture:** Discriminador nuevo `bt-balance:<bookingId>` (Payment manual sin hold) junto al existente `bt-declared:` de abonos. Action pública `declareBalanceTransfer`; `confirmBankTransfer`/`rejectBankTransfer` ganan una rama saldo ANTES de la lógica de hold; `allowCompleted` se enhebra por `assertBookingPayable`/`applyApprovedPayment`; autolimpieza de pendings en `recalcBookingFromPayments`. Spec (fuente de verdad): `docs/superpowers/specs/2026-07-11-saldo-por-transferencia-design.md`.

**Tech Stack:** Next.js App Router (fork custom — ante dudas de framework leer `node_modules/next/dist/docs/`), Prisma/Postgres, vitest, react-dom/server para component tests.

---

## Reglas de la casa (landmines — leer antes de empezar)

1. **tsc no corre en vitest/lint**: antes de CADA commit final de task, `npx tsc --noEmit 2>&1 | grep -E '^src/'` → VACÍO (errores en `tests/**` son drift pre-existente, ignorarlos).
2. **Módulos `'use server'` exportan SOLO funciones async.** Consts/tipos van en `src/lib/`.
3. **`revalidateBusinessPublicPaths` siempre con `await`.**
4. **Tests de integración**: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- -t "<filtro>"` (Docker `agendita-test-pg`; NO pasar `--config`). **Máximo UN task de integración a la vez** (una sola DB).
5. **Component tests**: `renderToStaticMarkup` + `vi.mock('next/navigation')`; viven en `tests/unit/*.tsx`. Radix Dialog/Portal no renderiza en SSR — stubear el shell si hace falta (ver `tests/unit/revive-booking-dialog.test.tsx`).
6. **Git**: `git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef` + `git add <archivos explícitos>`, nunca `-A`. Rama: `claude/balance-transfer`.
7. **Sin migración de schema en este PR.**
8. **`sendNotificationSafely` recibe un callback NO-async** — hoistear todo `await` (p.ej. `getBusinessReplyToEmail`) fuera del callback.

### Orden y paralelismo (subagent-driven)

- **Wave 1**: Task 1 (helpers declared.ts) ∥ Task 2 (emails) — archivos disjuntos; NINGUNO corre suites completas ni integración.
- **Wave 2**: Task 3 (finance) → Task 4 (declare) → Task 5 (verify/reject) → Task 6 (sweeps) — SECUENCIALES (DB de test única; 4 y 5 comparten familia de archivos).
- **Wave 3**: Task 7 (UI dueña) ∥ Task 8 (UI clienta) — archivos disjuntos, sin integración.
- **Task 9** (verificación final) al final, solo.

---

### Task 1: Helpers `bt-balance:` en `declared.ts`

**Files:**
- Modify: `src/lib/bank-transfer/declared.ts`
- Test: `tests/unit/bank-transfer-declared.test.ts` (crear; si ya existe un test de este módulo, extenderlo)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  BT_BALANCE_PREFIX, btBalanceId, declaredBalancePaymentWhere,
  isDeclaredBalancePayment, hasPendingBalanceTransfer, anyDeclaredTransferWhere,
  isDeclaredTransferPayment, hasPendingDeclaredTransfer, BT_DECLARED_PREFIX,
} from '@/lib/bank-transfer/declared'

const balPending = { provider: 'manual', status: 'pending', providerPaymentId: 'bt-balance:b1' }
const depPending = { provider: 'manual', status: 'pending', providerPaymentId: 'bt-declared:b1' }

describe('bt-balance helpers', () => {
  it('btBalanceId es determinístico y NO colisiona con bt-declared', () => {
    expect(btBalanceId('b1')).toBe('bt-balance:b1')
    expect(btBalanceId('b1').startsWith(BT_DECLARED_PREFIX)).toBe(false)
    expect(BT_BALANCE_PREFIX.startsWith(BT_DECLARED_PREFIX)).toBe(false)
  })
  it('isDeclaredBalancePayment discrimina por prefijo/status/provider', () => {
    expect(isDeclaredBalancePayment(balPending)).toBe(true)
    expect(isDeclaredBalancePayment(depPending)).toBe(false)
    expect(isDeclaredBalancePayment({ ...balPending, status: 'approved' })).toBe(false)
    expect(isDeclaredBalancePayment({ ...balPending, provider: 'mercado_pago' })).toBe(false)
  })
  it('los predicados de booking discriminan por prefijo y status', () => {
    // confirmed + bt-balance pending → saldo por verificar, NO abono
    const confirmed = { status: 'confirmed', payments: [balPending] }
    expect(hasPendingBalanceTransfer(confirmed)).toBe(true)
    expect(hasPendingDeclaredTransfer(confirmed)).toBe(false)
    // completed también cuenta para saldo
    expect(hasPendingBalanceTransfer({ status: 'completed', payments: [balPending] })).toBe(true)
    // pending_payment + bt-declared → abono, NO saldo
    const pending = { status: 'pending_payment', payments: [depPending] }
    expect(hasPendingDeclaredTransfer(pending)).toBe(true)
    expect(hasPendingBalanceTransfer(pending)).toBe(false)
    // array mixto: cada predicado agarra solo lo suyo
    expect(hasPendingDeclaredTransfer({ status: 'pending_payment', payments: [balPending, depPending] })).toBe(true)
  })
  it('anyDeclaredTransferWhere cubre ambos prefijos', () => {
    expect(anyDeclaredTransferWhere.provider).toBe('manual')
    expect(anyDeclaredTransferWhere.status).toBe('pending')
    const ors = anyDeclaredTransferWhere.OR.map((o) => o.providerPaymentId.startsWith)
    expect(ors).toContain('bt-declared:')
    expect(ors).toContain('bt-balance:')
  })
  it('los helpers de abono existentes no cambian de semántica', () => {
    expect(isDeclaredTransferPayment(depPending)).toBe(true)
    expect(isDeclaredTransferPayment(balPending)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npm run test:unit -- tests/unit/bank-transfer-declared.test.ts`. Expected: FAIL (exports no existen).

- [ ] **Step 3: Implement**

En `src/lib/bank-transfer/declared.ts`, después del bloque de abono agregar:

```ts
// ── Saldo restante (feature #3, spec 2026-07-11-saldo-por-transferencia) ──
// Prefijo PROPIO y explícito (no un sufijo de bt-declared:): ninguna query de
// abono debe matchear un saldo por accidente. Verificado: 'bt-balance:' no
// satisface startsWith('bt-declared:').
export const BT_BALANCE_PREFIX = 'bt-balance:'

export function btBalanceId(bookingId: string): string {
  return `${BT_BALANCE_PREFIX}${bookingId}`
}

export const declaredBalancePaymentWhere = {
  provider: 'manual',
  status: 'pending',
  providerPaymentId: { startsWith: BT_BALANCE_PREFIX },
} satisfies Prisma.PaymentWhereInput

export function isDeclaredBalancePayment(
  p: { provider: string; status: string; providerPaymentId?: string | null },
): boolean {
  return (
    p.provider === 'manual' &&
    p.status === 'pending' &&
    !!p.providerPaymentId?.startsWith(BT_BALANCE_PREFIX)
  )
}

// Abono O saldo pendientes: para superficies de verificación de la dueña y
// sweeps de cancelación (cancelBooking / updateBookingStatus).
export const anyDeclaredTransferWhere = {
  provider: 'manual',
  status: 'pending',
  OR: [
    { providerPaymentId: { startsWith: BT_DECLARED_PREFIX } },
    { providerPaymentId: { startsWith: BT_BALANCE_PREFIX } },
  ],
} satisfies Prisma.PaymentWhereInput

// "Reserva firme con transferencia del SALDO pendiente de verificar."
// Badge ADICIONAL en el dashboard (no reemplaza Confirmada/Completada).
export function hasPendingBalanceTransfer(
  booking: { status: string; payments: Array<{ providerPaymentId?: string | null }> },
): boolean {
  return (
    (booking.status === 'confirmed' || booking.status === 'completed') &&
    booking.payments.some((p) => p.providerPaymentId?.startsWith(BT_BALANCE_PREFIX))
  )
}
```

Y ENDURECER `hasPendingDeclaredTransfer` para que discrimine por prefijo (su semántica externa no cambia, pero ahora los arrays de payments traen ambos tipos — ver Task 7):

```ts
export function hasPendingDeclaredTransfer(
  booking: { status: string; payments: Array<{ providerPaymentId?: string | null }> },
): boolean {
  return (
    booking.status === 'pending_payment' &&
    booking.payments.some((p) => p.providerPaymentId?.startsWith(BT_DECLARED_PREFIX))
  )
}
```

OJO: este cambio de firma (de `payments: unknown[]` a array con `providerPaymentId`) puede romper tsc en call sites que pasan payments sin ese campo. Correr `npx tsc --noEmit 2>&1 | grep -E '^src/'` y arreglar los call sites SOLO si es agregar el campo al select/tipo (los cambios de datos reales los hace Task 7; si un call site necesita datos que aún no fluyen, el campo es opcional así que compila — verificar).

- [ ] **Step 4: Run** — unit test PASS + tsc grep `^src/` vacío. NO correr suites completas (Task 2 corre en paralelo).

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/lib/bank-transfer/declared.ts tests/unit/bank-transfer-declared.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "feat(bank-transfer): helpers bt-balance — prefijo, wheres y predicados de saldo"
```

---

### Task 2: Emails hermanos (declarado-saldo dueña, verificado-saldo y rechazado-saldo clienta)

**Files:**
- Modify: `src/lib/notifications/types.ts`, `src/lib/notifications/templates.ts`, `src/lib/notifications/email-provider.ts`, `src/lib/notifications/index.ts`
- Test: `tests/unit/balance-transfer-emails.test.ts` (crear)

Los templates existentes hornean el copy en html+text sin discriminador — la estrategia es SIEMPRE template+send hermanos, nunca parámetro (auditoría). Leé primero `bankTransferDeclaredBusinessHtml/Text`, `bankTransferRejectedCustomerHtml/Text` y un send como `sendBankTransferRejectedToCustomer` (email-provider.ts:254) para copiar estructura/helpers exactos.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  balanceTransferDeclaredBusinessHtml, balanceTransferDeclaredBusinessText,
  balanceTransferVerifiedCustomerHtml, balanceTransferVerifiedCustomerText,
  balanceTransferRejectedCustomerHtml, balanceTransferRejectedCustomerText,
} from '@/lib/notifications/templates'

const declared = {
  businessName: 'Bella', businessTimezone: 'America/Santiago', customerName: 'Ana',
  serviceName: 'Corte', startDateTime: new Date('2026-07-15T18:00:00Z'),
  amount: 12000, currency: 'CLP', bookingNumber: 4738 as number | null,
}
const verified = { ...declared, customerEmail: 'ana@x.cl', businessReplyToEmail: null }

describe('balance transfer templates', () => {
  it('declarado-saldo dueña: menciona saldo y monto, no "abono"', () => {
    const html = balanceTransferDeclaredBusinessHtml(declared)
    expect(html.toLowerCase()).toContain('saldo')
    expect(html).toContain('12.000')
    expect(balanceTransferDeclaredBusinessText(declared).toLowerCase()).toContain('saldo')
  })
  it('verificado-saldo clienta: confirma recepción del pago con monto', () => {
    const html = balanceTransferVerifiedCustomerHtml(verified)
    expect(html.toLowerCase()).toContain('saldo')
    expect(html).toContain('12.000')
  })
  it('rechazado-saldo clienta: NO menciona cancelación de la reserva', () => {
    const html = balanceTransferRejectedCustomerHtml(verified)
    const text = balanceTransferRejectedCustomerText(verified)
    expect(html.toLowerCase()).toContain('saldo')
    expect(html.toLowerCase()).not.toContain('cancelad')
    expect(text.toLowerCase()).not.toContain('cancelad')
  })
})
```

(Ajustar los shapes a los tipos reales al implementar el Step 3 — el monto formateado puede ser `$12.000` según `fmtCurrency`; asertar substring robusto.)

- [ ] **Step 2: Run to verify it fails** — `npm run test:unit -- tests/unit/balance-transfer-emails.test.ts`. Expected: FAIL.

- [ ] **Step 3: Types**

En `src/lib/notifications/types.ts`, junto a `BankTransferVerifyCustomerEmailData`:

```ts
/** Verificado/rechazado del SALDO: el de abono no trae monto; el email del
 *  saldo lo necesita ("recibimos tu pago de $X"). */
export interface BalanceTransferCustomerEmailData extends BankTransferVerifyCustomerEmailData {
  amount: number
  currency: string
}
```

El declarado-saldo dueña REUSA `BankTransferDeclaredEmailData` (ya trae amount/currency) — no crear tipo.

- [ ] **Step 4: Templates**

En `templates.ts`, como hermanos de los de abono (mismos helpers `baseHtml`/`header`/`footer`/`fmtCurrency`/`escapeHtml` — copiar la estructura EXACTA del hermano de abono correspondiente y cambiar solo el copy):

- `balanceTransferDeclaredBusinessHtml/Text(data: BankTransferDeclaredEmailData)` — header "Transferencia del saldo por verificar"; cuerpo: la clienta X avisó que transfirió el saldo de $MONTO por SERVICIO (#N, FECHA); verificala en el panel.
- `balanceTransferVerifiedCustomerHtml/Text(data: BalanceTransferCustomerEmailData)` — header "Recibimos tu pago"; cuerpo: NEGOCIO verificó tu transferencia del saldo de $MONTO por SERVICIO. ¡Gracias!
- `balanceTransferRejectedCustomerHtml/Text(data: BalanceTransferCustomerEmailData)` — header "No pudimos verificar tu transferencia"; cuerpo: NEGOCIO no pudo verificar tu transferencia del saldo de $MONTO. Tu reserva sigue igual. Escribile al negocio o volvé a avisar desde tu página de reserva. SIN mención de cancelación.

Todo en voseo, consistente con los hermanos.

- [ ] **Step 5: Provider + exports**

En `email-provider.ts` (espejo exacto de sus hermanos — mismo guard de email vacío, mismo shape de `sendEmail`, mismo replyTo):
- `sendBalanceTransferDeclaredToBusiness(businessId, data)` espejo de `sendBankTransferDeclaredToBusiness` (multi a dueñas), subject `Transferencia del saldo por verificar - ${businessName}`.
- `sendBalanceTransferVerifiedToCustomer(data: BalanceTransferCustomerEmailData)`, subject `Recibimos tu pago - ${businessName}`.
- `sendBalanceTransferRejectedToCustomer(data: BalanceTransferCustomerEmailData)`, subject `Tu transferencia no pudo verificarse - ${businessName}`.

Exportar los 3 sends + 6 templates + el tipo desde `index.ts`, junto a sus hermanos.

- [ ] **Step 6: Run** — test nuevo PASS; `npm run test:unit -- tests/unit/transfer-reactivated-email.test.ts tests/unit/transfer-reminder-emails.test.ts` PASS (hermanos intactos); tsc grep `^src/` vacío. NO correr suites completas.

- [ ] **Step 7: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/lib/notifications/types.ts src/lib/notifications/templates.ts src/lib/notifications/email-provider.ts src/lib/notifications/index.ts tests/unit/balance-transfer-emails.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "feat(notifications): emails de saldo — declarado dueña, verificado y rechazado clienta"
```

---

### Task 3: `allowCompleted` + autolimpieza en finance

**Files:**
- Modify: `src/lib/booking-payments.ts`, `src/server/services/finance.ts`
- Test: `tests/integration/balance-transfer.test.ts` (crear — este archivo lo van extendiendo Tasks 4-6)

- [ ] **Step 1: Write the failing tests**

Crear `tests/integration/balance-transfer.test.ts`. Copiar el bloque de `vi.mock(...)` de `tests/integration/revive-booking.test.ts` (auth btv-biz, rate-limit, next/cache, revalidate-business, notifications con callback-que-ejecuta) y AGREGAR al mock de `@/lib/notifications` las keys:
`sendBalanceTransferDeclaredToBusiness: async () => [], sendBalanceTransferVerifiedToCustomer: async () => ({ success: true }), sendBalanceTransferRejectedToCustomer: async () => ({ success: true }), sendBankTransferDeclaredToBusiness: async () => [],`

```ts
import { describe, it, expect, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from './setup'
import { seedDeclaredTransfer, cleanupBankTransferSeed, BT_VERIFY_BIZ } from './helpers/bank-transfer-seed'
import { btBalanceId } from '@/lib/bank-transfer/declared'

requireTestDatabase()
// <<< bloque vi.mock copiado + keys nuevas >>>

afterAll(async () => {
  await cleanupBankTransferSeed()
  await prisma.$disconnect()
})

// Reserva CONFIRMADA con abono pagado (deposit approved) y saldo pendiente.
// El seed crea pending_payment + bt-declared pending: lo llevamos a confirmed
// como lo haría confirmBankTransfer (payment approved + booking confirmed +
// depositPaid/remainingBalance recalculados a mano para el fixture).
async function seedConfirmedWithBalance(opts: Parameters<typeof seedDeclaredTransfer>[0] = {}) {
  const seeded = await seedDeclaredTransfer(opts)
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
  await prisma.payment.update({ where: { id: seeded.paymentId }, data: { status: 'approved' } })
  await prisma.booking.update({
    where: { id: seeded.bookingId },
    data: {
      status: 'confirmed',
      depositPaid: booking.depositRequired,
      remainingBalance: booking.finalAmount - booking.depositRequired,
      paymentStatus: 'deposit_paid',
    },
  })
  return { ...seeded, remainingBalance: booking.finalAmount - booking.depositRequired }
}

// Un bt-balance pending sembrado directo (para tests de finance/sweeps).
async function seedPendingBalance(bookingId: string, customerId: string, amount: number) {
  return prisma.payment.create({
    data: {
      businessId: BT_VERIFY_BIZ, bookingId, customerId,
      provider: 'manual', providerPaymentId: btBalanceId(bookingId),
      amount, currency: 'CLP', status: 'pending', paymentType: 'final_payment',
      paymentMethod: 'Transferencia',
    },
  })
}

describe('finance: allowCompleted + autolimpieza bt-balance', () => {
  it('applyApprovedPayment sobre completed falla sin allowCompleted y pasa con él', async () => {
    const seeded = await seedConfirmedWithBalance()
    await prisma.booking.update({ where: { id: seeded.bookingId }, data: { status: 'completed' } })
    const { applyApprovedPayment } = await import('@/server/services/finance')
    const base = {
      bookingId: seeded.bookingId, businessId: BT_VERIFY_BIZ,
      amount: seeded.remainingBalance, currency: 'CLP',
      provider: 'manual' as const, providerPaymentId: `manual-test-${seeded.bookingId}`,
      paymentType: 'final_payment' as const, paymentMethod: 'Transferencia',
    }
    await expect(
      prisma.$transaction((tx) => applyApprovedPayment({ tx, ...base })),
    ).rejects.toThrow('No se puede procesar pago')
    await prisma.$transaction((tx) => applyApprovedPayment({ tx, ...base, allowCompleted: true }))
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(b.paymentStatus).toBe('fully_paid')
    expect(b.status).toBe('completed') // el status NO cambia
  })

  it('recalc con saldo 0 cancela los bt-balance pendientes (autolimpieza)', async () => {
    const seeded = await seedConfirmedWithBalance()
    await seedPendingBalance(seeded.bookingId, seeded.customerId, seeded.remainingBalance)
    // La dueña registra el saldo en efectivo → recalc deja remainingBalance=0.
    const { applyApprovedPayment } = await import('@/server/services/finance')
    await prisma.$transaction((tx) => applyApprovedPayment({
      tx, bookingId: seeded.bookingId, businessId: BT_VERIFY_BIZ,
      amount: seeded.remainingBalance, currency: 'CLP',
      provider: 'manual', providerPaymentId: null,
      paymentType: 'final_payment', paymentMethod: 'Efectivo',
    }))
    const bal = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    expect(bal.status).toBe('cancelled')
  })
})
```

NOTA: ajustar `ApplyApprovedPaymentInput` a su shape real (leer `finance.ts:74-94` — si `providerPaymentId: null` no es válido o `paymentId` es requerido en algún camino, adaptar; el objetivo del fixture es "pago manual de la dueña sin paymentId explícito", que es lo que hace `createManualPayment`). Si `applyApprovedPayment` crea su propio Payment cuando no hay `paymentId`, perfecto.

- [ ] **Step 2: Run to verify it fails**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- -t "allowCompleted"
```
Expected: FAIL — `allowCompleted` no existe (tsc del test o throw en runtime) y la autolimpieza no ocurre.

- [ ] **Step 3: Implement**

`src/lib/booking-payments.ts` — opción nueva:

```ts
export function assertBookingPayable(
  booking: { status: BookingStatus; holdExpiresAt: Date | null },
  opts?: { allowExpiredHold?: boolean; allowCompleted?: boolean },
): void {
  const terminalStatuses: BookingStatus[] = [
    BookingStatus.cancelled,
    BookingStatus.expired,
    BookingStatus.no_show,
  ]
  // `completed` es terminal para pagos SALVO el saldo por transferencia
  // (spec #3 §4: la clienta puede pagar después de atendida). Solo la rama
  // bt-balance de confirmBankTransfer pasa allowCompleted — nunca el webhook
  // MP ni confirmPayment.
  if (!opts?.allowCompleted) terminalStatuses.push(BookingStatus.completed)
  if (terminalStatuses.includes(booking.status)) {
    throw new BookingNotPayableError('No se puede procesar pago para esta reserva')
  }
  // ... (el chequeo de hold queda IDÉNTICO)
}
```

`src/server/services/finance.ts`:
1. `ApplyApprovedPaymentInput` gana `allowCompleted?: boolean` (documentado igual que arriba).
2. El call site de `assertBookingPayable` (≈línea 127) pasa `{ allowExpiredHold: <lo actual>, allowCompleted: input.allowCompleted }`.
3. En `recalcBookingFromPayments`, después de calcular `newRemainingBalance` y ANTES de los updates de booking, agregar:

```ts
  // Autolimpieza (spec §5-bis): si el saldo quedó en 0 por CUALQUIER camino
  // (pago manual, MP, verificación del propio saldo), una declaración de saldo
  // pendiente ya no tiene sentido — cancelarla evita un chip "por verificar"
  // eterno cuyo único destino sería un rechazo con email confuso.
  if (newRemainingBalance === 0) {
    await tx.payment.updateMany({
      where: { bookingId, ...declaredBalancePaymentWhere },
      data: { status: 'cancelled' },
    })
  }
```

Import: `import { declaredBalancePaymentWhere } from '@/lib/bank-transfer/declared'`. (finance.ts es un service, no 'use server' — el import de const es válido; verificar.)

- [ ] **Step 4: Run** — filtro `"allowCompleted|autolimpieza"` PASS; regresión `-t "confirmBankTransfer"` y `-t "reviveBooking"` PASS; tsc grep `^src/` vacío.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/lib/booking-payments.ts src/server/services/finance.ts tests/integration/balance-transfer.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "feat(finance): allowCompleted para saldo por transferencia + autolimpieza de bt-balance al llegar a saldo 0"
```

---

### Task 4: `declareBalanceTransfer`

**Files:**
- Modify: `src/server/actions/bank-transfer-public.ts`
- Test: `tests/integration/balance-transfer.test.ts` (extender)

- [ ] **Step 1: Write the failing tests**

Agregar al archivo de Task 3 (reusa `seedConfirmedWithBalance`/`seedPendingBalance`; import dinámico de la action como hace el resto de la suite si aplica, o import estático — seguir el estilo del archivo):

```ts
describe('declareBalanceTransfer', () => {
  it('happy path: crea bt-balance pending con monto=saldo y paymentType derivado', async () => {
    const seeded = await seedConfirmedWithBalance()
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    await declareBalanceTransfer(seeded.bookingId)
    const p = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    expect(p.status).toBe('pending')
    expect(p.amount).toBe(seeded.remainingBalance)
    expect(p.paymentType).toBe('final_payment') // depositPaid > 0
    expect(p.paymentMethod).toBe('Transferencia')
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(b.status).toBe('confirmed') // no toca status ni hold
  })

  it('guards por estado: pending_payment, cancelled, no_show', async () => {
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    const pending = await seedDeclaredTransfer()
    await expect(declareBalanceTransfer(pending.bookingId)).rejects.toThrow('Primero confirmá')
    const cancelled = await seedConfirmedWithBalance()
    await prisma.booking.update({ where: { id: cancelled.bookingId }, data: { status: 'cancelled' } })
    await expect(declareBalanceTransfer(cancelled.bookingId)).rejects.toThrow('cancelada')
    const noShow = await seedConfirmedWithBalance()
    await prisma.booking.update({ where: { id: noShow.bookingId }, data: { status: 'no_show' } })
    await expect(declareBalanceTransfer(noShow.bookingId)).rejects.toThrow('no asistida')
  })

  it('sin saldo → error; cuenta deshabilitada → error', async () => {
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    const paid = await seedConfirmedWithBalance()
    await prisma.booking.update({ where: { id: paid.bookingId }, data: { remainingBalance: 0, paymentStatus: 'fully_paid' } })
    await expect(declareBalanceTransfer(paid.bookingId)).rejects.toThrow('no tiene saldo')
    const seeded = await seedConfirmedWithBalance()
    await prisma.bankTransferAccount.update({ where: { businessId: BT_VERIFY_BIZ }, data: { isEnabled: false } })
    try {
      await expect(declareBalanceTransfer(seeded.bookingId)).rejects.toThrow('transferencia bancaria habilitada')
    } finally {
      await prisma.bankTransferAccount.update({ where: { businessId: BT_VERIFY_BIZ }, data: { isEnabled: true } })
    }
  })

  it('idempotencia: pending → éxito silencioso; approved+saldo residual → ERROR (no silencio)', async () => {
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    const seeded = await seedConfirmedWithBalance()
    await declareBalanceTransfer(seeded.bookingId)
    await declareBalanceTransfer(seeded.bookingId) // pending → ok silencioso
    const all = await prisma.payment.findMany({ where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) } })
    expect(all).toHaveLength(1)
    // verificación parcial: approved pero quedó saldo
    await prisma.payment.update({ where: { id: all[0].id }, data: { status: 'approved' } })
    await prisma.booking.update({ where: { id: seeded.bookingId }, data: { remainingBalance: 5000 } })
    await expect(declareBalanceTransfer(seeded.bookingId)).rejects.toThrow('parcialmente')
  })

  it('reactivación: rejected → vuelve a pending con monto fresco', async () => {
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    const seeded = await seedConfirmedWithBalance()
    await declareBalanceTransfer(seeded.bookingId)
    const p = await prisma.payment.findFirstOrThrow({ where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) } })
    await prisma.payment.update({ where: { id: p.id }, data: { status: 'rejected', amount: 1 } })
    await declareBalanceTransfer(seeded.bookingId)
    const again = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })
    expect(again.status).toBe('pending')
    expect(again.amount).toBe(seeded.remainingBalance)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — filtro `"declareBalanceTransfer"`. Expected: FAIL (action no existe).

- [ ] **Step 3: Implement**

En `src/server/actions/bank-transfer-public.ts`, agregar (imports nuevos: `btBalanceId` de declared, `deriveManualPaymentType` de `@/lib/payments/derive-payment-type`, `sendBalanceTransferDeclaredToBusiness` de notifications):

```ts
/**
 * La clienta declara "ya transferí el SALDO" (feature #3). Reserva firme
 * (confirmed|completed), sin hold ni plazo. Idempotente por btBalanceId.
 */
export async function declareBalanceTransfer(bookingId: string): Promise<{ ok: true }> {
  const limit = await checkRateLimit('declare-balance-transfer', 10, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const declared = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        business: { include: { bankTransferAccount: true } },
        service: true,
        customer: true,
      },
    })
    if (!booking) throw new Error('Reserva no encontrada')
    const account = booking.business.bankTransferAccount
    if (!account || !account.isEnabled) {
      throw new Error('Este negocio no tiene transferencia bancaria habilitada')
    }
    if (booking.status === 'pending_payment') {
      throw new Error('Primero confirmá tu reserva pagando el abono.')
    }
    if (booking.status === 'expired') {
      throw new Error('Tu reserva expiró. Volvé a reservar para elegir un nuevo horario.')
    }
    if (booking.status === 'cancelled') throw new Error('Tu reserva fue cancelada.')
    if (booking.status === 'no_show') {
      throw new Error('Esta reserva quedó como no asistida: escribile al negocio.')
    }

    // Idempotencia por status del bt-balance existente (spec §3.5):
    // - pending → ya avisó.
    // - approved con saldo 0 → ya verificado, jamás tocar.
    // - approved con saldo RESIDUAL (verificación parcial) → ERROR explícito:
    //   el unique impide un segundo bt-balance; un éxito silencioso sería un
    //   botón muerto para siempre.
    // - cancelled/rejected → reactivar el mismo Payment.
    // - refunded/failed → cortar fuerte.
    const existing = await tx.payment.findFirst({
      where: { bookingId, provider: 'manual', providerPaymentId: btBalanceId(bookingId) },
    })
    if (existing?.status === PaymentStatus.pending) return null
    if (existing?.status === PaymentStatus.approved) {
      if (booking.remainingBalance <= 0) return null
      throw new Error(
        'Tu transferencia anterior fue registrada parcialmente. Escribile al negocio para coordinar el resto.',
      )
    }
    if (existing && existing.status !== PaymentStatus.cancelled && existing.status !== PaymentStatus.rejected) {
      throw new Error('No se puede volver a declarar esta transferencia. Contactá al negocio.')
    }

    if (booking.remainingBalance <= 0) throw new Error('Esta reserva no tiene saldo pendiente.')

    // Guard de carrera REAL vs cancel/no_show concurrente (spec §3.6): el
    // updateMany toma el row lock de la booking y serializa contra
    // cancelBookingInTx/updateBookingStatus. Releer el status no alcanza bajo
    // ReadCommitted. El write es benigno (touch de updatedAt).
    const { count } = await tx.booking.updateMany({
      where: { id: bookingId, status: { in: ['confirmed', 'completed'] } },
      data: { updatedAt: new Date() },
    })
    if (count === 0) throw new Error('Tu reserva ya no admite este pago. Escribile al negocio.')

    const amount = booking.remainingBalance
    const paymentType = deriveManualPaymentType(booking, amount)

    if (existing) {
      await tx.payment.update({
        where: { id: existing.id },
        data: { status: PaymentStatus.pending, amount, paymentType, createdAt: new Date() },
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
          providerPaymentId: btBalanceId(bookingId),
          amount,
          currency: booking.business.currency || 'CLP',
          status: PaymentStatus.pending,
          paymentType,
          paymentMethod: 'Transferencia',
        },
      })
    } catch (e) {
      // P2002 = otro request ganó la carrera del create: éxito.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null
      throw e
    }
    return { booking, amount }
  })

  if (declared) {
    await sendMultiNotificationSafely('balance transfer declared notification', () =>
      sendBalanceTransferDeclaredToBusiness(declared.booking.businessId, {
        businessName: declared.booking.business.name,
        businessTimezone: declared.booking.business.timezone,
        customerName: declared.booking.customer.name,
        serviceName: declared.booking.service?.name ?? 'servicio',
        startDateTime: declared.booking.startDateTime,
        amount: declared.amount,
        currency: declared.booking.business.currency || 'CLP',
        bookingNumber: declared.booking.bookingNumber,
      }),
    )
  }
  return { ok: true }
}
```

Verificar la firma real de `deriveManualPaymentType(booking, amount)` (`src/lib/payments/derive-payment-type.ts`) y qué campos de booking usa (depositPaid/remainingBalance) — el include ya los trae (escalares).

- [ ] **Step 4: Run** — filtro `"declareBalanceTransfer"` PASS + regresión `-t "declareBankTransfer"` PASS (el archivo `bank-transfer-public.test.ts` completo); tsc grep vacío.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/server/actions/bank-transfer-public.ts tests/integration/balance-transfer.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "feat(bank-transfer): declareBalanceTransfer — la clienta avisa la transferencia del saldo"
```

---

### Task 5: rama saldo en `confirmBankTransfer` / `rejectBankTransfer`

**Files:**
- Modify: `src/server/actions/bank-transfer-verify.ts`
- Test: `tests/integration/balance-transfer.test.ts` (extender)

- [ ] **Step 1: Write the failing tests**

```ts
describe('confirmBankTransfer saldo', () => {
  async function declaredBalance() {
    const seeded = await seedConfirmedWithBalance()
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    await declareBalanceTransfer(seeded.bookingId)
    const p = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    return { ...seeded, balancePaymentId: p.id }
  }

  it('sobre confirmed → fully_paid, ledger final_payment, status intacto', async () => {
    const s = await declaredBalance()
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await confirmBankTransfer(s.balancePaymentId, s.remainingBalance)
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: s.bookingId } })
    expect(b.paymentStatus).toBe('fully_paid')
    expect(b.remainingBalance).toBe(0)
    expect(b.status).toBe('confirmed')
    const ledger = await prisma.ledgerEntry.findFirst({ where: { payment: { id: s.balancePaymentId } } })
    expect(ledger).toBeTruthy()
  })

  it('sobre completed → también verifica (allowCompleted)', async () => {
    const s = await declaredBalance()
    await prisma.booking.update({ where: { id: s.bookingId }, data: { status: 'completed' } })
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await confirmBankTransfer(s.balancePaymentId, s.remainingBalance)
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: s.bookingId } })
    expect(b.paymentStatus).toBe('fully_paid')
    expect(b.status).toBe('completed')
  })

  it('con TimeBlock solapando el turno futuro → confirma igual (no re-valida cupo)', async () => {
    const s = await declaredBalance()
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: s.bookingId } })
    // hold vencido viejo (los confirmed lo retienen): sin la rama saldo, el
    // path de hold-vencido dispararía assertSlotIsAvailable y este bloque lo haría fallar.
    await prisma.booking.update({ where: { id: s.bookingId }, data: { holdExpiresAt: new Date(Date.now() - 3_600_000) } })
    const block = await prisma.timeBlock.create({
      data: { businessId: BT_VERIFY_BIZ, startDateTime: b.startDateTime, endDateTime: b.endDateTime, reason: 'ocupado' },
    })
    try {
      const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
      await confirmBankTransfer(s.balancePaymentId, s.remainingBalance)
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: s.bookingId } })).paymentStatus).toBe('fully_paid')
    } finally {
      await prisma.timeBlock.delete({ where: { id: block.id } })
    }
  })

  it('amount > saldo → error; el guard de abono aprobado NO bloquea saldos', async () => {
    const s = await declaredBalance() // esta booking YA tiene el deposit approved
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await expect(confirmBankTransfer(s.balancePaymentId, s.remainingBalance + 1)).rejects.toThrow('excede')
  })
})

describe('rejectBankTransfer saldo', () => {
  it('rechaza el payment, NO cancela la reserva, y se puede re-declarar', async () => {
    const seeded = await seedConfirmedWithBalance()
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    await declareBalanceTransfer(seeded.bookingId)
    const p = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    const { rejectBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await rejectBankTransfer(p.id)
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(b.status).toBe('confirmed') // NO cancelada
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('rejected')
    await declareBalanceTransfer(seeded.bookingId) // reactiva
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('pending')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — filtro `"confirmBankTransfer saldo"`. Expected: FAIL — `loadDeclaredPayment` rechaza el bt-balance ("Este pago no es una transferencia por verificar").

- [ ] **Step 3: Implement**

En `bank-transfer-verify.ts`:

1. `loadDeclaredPayment`: la condición pasa a `if (!isDeclaredTransferPayment(payment) && !isDeclaredBalancePayment(payment))` (import de declared.ts).

2. En `confirmBankTransfer`, después de cargar payment y booking, **branch por tipo ANTES de todo lo demás** (el orden importa: el guard de abono-aprobado y la lógica de hold NO deben ejecutarse para saldos — los confirmed retienen `holdExpiresAt` vencido y dispararían una re-validación de cupo espuria):

```ts
    if (isDeclaredBalancePayment(payment)) {
      // ── Rama SALDO (spec §4): reserva firme, sin hold ni cupo en juego. ──
      if (booking.status !== 'confirmed' && booking.status !== 'completed') {
        if (booking.status === 'cancelled') throw new Error('Esta reserva fue cancelada.')
        if (booking.status === 'no_show') throw new Error('Esta reserva quedó como no asistida.')
        throw new Error('Esta reserva no admite verificar un saldo todavía.')
      }
      if (amount > booking.remainingBalance) throw new Error('El monto excede el saldo pendiente')

      const derivedType = deriveManualPaymentType(booking, amount)
      await tx.payment.update({ where: { id: paymentId }, data: { amount, paymentType: derivedType } })

      const { applyApprovedPayment } = await import('@/server/services/finance')
      await applyApprovedPayment({
        tx,
        bookingId: booking.id,
        businessId,
        amount,
        currency: payment.currency,
        provider: 'manual',
        providerPaymentId: payment.providerPaymentId,
        paymentType: derivedType,
        paymentMethod: payment.paymentMethod ?? 'Transferencia',
        paymentId,
        // Saldo post-cita es el caso de uso (spec §1.2): completed deja de ser
        // terminal SOLO acá. El hold-check no aplica (solo pending_payment).
        allowCompleted: true,
      })
      return {
        wasConfirmed: false,
        bookingId: booking.id,
        balanceVerified: {
          amount,
          currency: payment.currency,
          customerName: booking.customer?.name ?? null,   // ← ver nota include
          customerEmail: booking.customer?.email ?? null,
          serviceName: booking.service?.name ?? 'servicio',
          startDateTime: booking.startDateTime,
          bookingNumber: booking.bookingNumber,
        },
      }
    }
    // ── Rama ABONO: TODO lo existente queda byte-idéntico desde acá. ──
```

NOTA include: el `findUnique` de booking actual no incluye customer/service — agregar `include: { customer: true, service: true }` (o selects mínimos). La rama abono no los usa: verificar que no cambie nada ahí.

3. Post-tx: tipar el retorno de la tx como union/objeto opcional y agregar después del bloque `wasConfirmed`:

```ts
  if (result.balanceVerified?.customerEmail) {
    const bv = result.balanceVerified
    const replyTo = await getBusinessReplyToEmail(businessId)  // hoist: callback no-async
    await sendNotificationSafely('balance transfer verified', () =>
      sendBalanceTransferVerifiedToCustomer({
        businessName: business.name,
        businessTimezone: business.timezone || 'America/Santiago',
        businessReplyToEmail: replyTo,
        customerName: bv.customerName ?? 'Cliente',
        customerEmail: bv.customerEmail!,
        serviceName: bv.serviceName,
        startDateTime: bv.startDateTime,
        bookingNumber: bv.bookingNumber,
        amount: bv.amount,
        currency: bv.currency,
      }),
    )
  }
```

(Import `sendBalanceTransferVerifiedToCustomer`; ajustar los campos EXACTOS a `BalanceTransferCustomerEmailData` de Task 2.)

4. En `rejectBankTransfer`: el tx ya es seguro (el cancel de booking está scoped a pending_payment). Cambios: capturar `const isBalance = isDeclaredBalancePayment(payment)` dentro de la tx y retornarlo; post-tx, elegir el email:

```ts
  if (rejected?.customer?.email) {
    const replyTo = await getBusinessReplyToEmail(businessId)
    if (isBalance) {
      await sendNotificationSafely('balance transfer rejected', () =>
        sendBalanceTransferRejectedToCustomer({
          businessName: business.name,
          businessTimezone: business.timezone || 'America/Santiago',
          businessReplyToEmail: replyTo,
          customerName: rejected.customer!.name,
          customerEmail: rejected.customer!.email!,
          serviceName: rejected.service?.name ?? 'servicio',
          startDateTime: rejected.startDateTime,
          bookingNumber: rejected.bookingNumber,
          amount: rejectedPaymentAmount,   // capturar payment.amount en la tx
          currency: rejectedPaymentCurrency,
        }),
      )
    } else {
      // ... el send existente de abono, sin cambios
    }
  }
```

- [ ] **Step 4: Run** — filtros `"confirmBankTransfer saldo"` y `"rejectBankTransfer saldo"` PASS; regresión: `-t "confirmBankTransfer"` (abono) y el archivo `bank-transfer-verify.test.ts` completo PASS; tsc grep vacío.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/server/actions/bank-transfer-verify.ts tests/integration/balance-transfer.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "feat(bank-transfer): confirmar/rechazar transferencias del saldo (rama bt-balance)"
```

---

### Task 6: sweeps de estado — cancelBooking y updateBookingStatus

**Files:**
- Modify: `src/lib/bookings/mutate.ts` (cancelBookingInTx, ~línea 38), `src/server/actions/bookings.ts` (updateBookingStatus, tx ~509-546)
- Test: `tests/integration/balance-transfer.test.ts` (extender)

- [ ] **Step 1: Write the failing tests**

```ts
describe('sweeps de bt-balance en cambios de estado', () => {
  it('updateBookingStatus → no_show cancela el bt-balance pendiente', async () => {
    const seeded = await seedConfirmedWithBalance()
    await seedPendingBalance(seeded.bookingId, seeded.customerId, seeded.remainingBalance)
    const { updateBookingStatus } = await import('@/server/actions/bookings')
    await updateBookingStatus(seeded.bookingId, 'no_show')
    const p = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    expect(p.status).toBe('cancelled')
  })

  it('updateBookingStatus → completed NO cancela el bt-balance (pagar post-cita es el punto)', async () => {
    const seeded = await seedConfirmedWithBalance()
    await seedPendingBalance(seeded.bookingId, seeded.customerId, seeded.remainingBalance)
    const { updateBookingStatus } = await import('@/server/actions/bookings')
    await updateBookingStatus(seeded.bookingId, 'completed')
    const p = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    expect(p.status).toBe('pending')
  })

  it('cancelBooking cancela el bt-balance pendiente', async () => {
    const seeded = await seedConfirmedWithBalance()
    await seedPendingBalance(seeded.bookingId, seeded.customerId, seeded.remainingBalance)
    const { cancelBooking } = await import('@/server/actions/bookings')
    await cancelBooking(seeded.bookingId)   // ← verificar firma/nombre real y ajustar
    const p = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    expect(p.status).toBe('cancelled')
  })
})
```

NOTA: verificar los nombres/firmas reales de `updateBookingStatus` y `cancelBooking` en `src/server/actions/bookings.ts` (y qué transiciones permite `VALID_STATUS_TRANSITIONS`: `confirmed → no_show/completed/cancelled` deben existir; si `no_show` requiere turno pasado, sembrar la booking con startDateTime pasado — usar offsets bien lejanos tipo -200h para no chocar con el EXCLUDE de otros tests). El mock de auth del archivo ya cubre requireBusinessRole.

- [ ] **Step 2: Run to verify it fails** — filtro `"sweeps de bt-balance"`. Expected: FAIL (payment sigue pending tras no_show/cancel).

- [ ] **Step 3: Implement**

1. `src/lib/bookings/mutate.ts` (cancelBookingInTx): el `updateMany` de payments pasa de `declaredTransferPaymentWhere` a `anyDeclaredTransferWhere` (cambio de import + una línea). Comentario: `// abono Y saldo: cancelar una reserva mata cualquier declaración pendiente.`
2. `src/server/actions/bookings.ts` (updateBookingStatus): dentro de su tx, cuando `newStatus === 'cancelled' || newStatus === 'no_show'`, agregar:

```ts
      // Una reserva que muere (cancelled/no_show) no puede quedar con una
      // transferencia declarada "por verificar" eterna (spec §5-ter).
      // completed NO barre: pagar el saldo después de atendida es el caso de uso.
      await tx.payment.updateMany({
        where: { bookingId, ...anyDeclaredTransferWhere },
        data: { status: 'cancelled' },
      })
```

(Leer la tx real de updateBookingStatus para ubicar el punto correcto — después del updateMany de status guardado, junto al release de redemptions.)

- [ ] **Step 4: Run** — filtro `"sweeps de bt-balance"` PASS; regresión `-t "cancelBooking"` si existe suite + `npm run test:integration` del archivo balance-transfer completo; tsc grep vacío.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/lib/bookings/mutate.ts src/server/actions/bookings.ts tests/integration/balance-transfer.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "feat(bookings): cancelled/no_show barren declaraciones de transferencia pendientes (abono y saldo)"
```

---

### Task 7: superficies dueña — sección, badges, dialog, aviso en pago manual

**Files:**
- Modify: `src/server/actions/bookings.ts` (getBookings include, ~191-193), `src/app/dashboard/bookings/page.tsx` (builder pendingTransfers ~212-226, badge tabla ~294, BookingCard ~64), `src/app/dashboard/page.tsx` (banner/contador ~64, label fila ~182), `src/components/dashboard/pending-transfers-section.tsx`, `src/components/dashboard/verify-transfer-dialog.tsx`, `src/components/dashboard/manual-payment-dialog.tsx` (o donde viva el aviso)
- Test: `tests/unit/pending-transfers-section.test.tsx` (crear o extender el que exista; patrón renderToStaticMarkup)

Leer PRIMERO los archivos: las líneas citadas vienen de la auditoría y pueden haber corrido.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/server/actions/bank-transfer-verify', () => ({ confirmBankTransfer: vi.fn(), rejectBankTransfer: vi.fn() }))
import { PendingTransfersSection } from '@/components/dashboard/pending-transfers-section'

const base = { id: 'p1', bookingId: 'b1', customerName: 'Ana', customerPhone: null, serviceName: 'Corte', startDateTime: new Date(), amount: 10000, declaredAt: new Date(), bookingNumber: 1, businessCurrency: 'CLP' }

describe('PendingTransfersSection con kinds', () => {
  it('item de abono muestra badge Abono; item de saldo muestra badge Saldo', () => {
    const html = renderToStaticMarkup(
      <PendingTransfersSection items={[{ ...base, kind: 'deposit' }, { ...base, id: 'p2', kind: 'balance' }]} />,
    )
    expect(html).toContain('Abono')
    expect(html).toContain('Saldo')
  })
})
```

(AJUSTAR al shape real de props de `PendingTransfersSection` — leer el componente; el objetivo es: item gana `kind: 'deposit' | 'balance'`, se renderiza un badge distintivo, y los copys de rechazo/WhatsApp varían por kind. Si ya existe un test del componente, extenderlo en su estilo.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement — datos**

1. `getBookings` (bookings.ts ~191): el include de payments pasa a `where: anyDeclaredTransferWhere` y el select agrega `providerPaymentId` (mantener los campos ya seleccionados — leer el select actual: usa id/amount/createdAt para el builder).
2. Builder `pendingTransfers` (`bookings/page.tsx` ~212-226): en vez de `payments[0]` ciego, derivar por prefijo:

```ts
  const pendingTransfers: PendingTransferItem[] = bookings
    .filter((b) => !['cancelled', 'expired'].includes(b.status))  // huérfanos de carrera fuera (spec §5)
    .flatMap((b) =>
      b.payments
        .filter((p) => p.providerPaymentId != null)
        .map((p) => ({
          // ...campos actuales del item...
          kind: p.providerPaymentId!.startsWith('bt-balance:') ? ('balance' as const) : ('deposit' as const),
        })),
    )
```

Usar `BT_BALANCE_PREFIX` importado, no el literal. Mantener el orden actual del listado. El item type (`PendingTransferItem`, donde esté definido) gana `kind`.

- [ ] **Step 4: Implement — badges (dos predicados)**

En los 3 call sites que hoy usan `hasPendingDeclaredTransfer` para REEMPLAZAR el badge de estado (tabla `bookings/page.tsx` ~294, `BookingCard` ~64-80, fila del home `dashboard/page.tsx` ~182): dejarlos INTACTOS (siguen siendo de abono). AGREGAR al lado, cuando `hasPendingBalanceTransfer(booking)`, un badge secundario "Saldo por verificar" (estilo `bg-amber-100 text-amber-800` o el que use el badge de abono) que NO reemplaza "Confirmada"/"Completada". El contador/banner del home (`dashboard/page.tsx` ~64) pasa a contar `pendingTransfers.length` con ambos kinds (si hoy cuenta bookings con hasPendingDeclaredTransfer, sumar los de saldo).

- [ ] **Step 5: Implement — dialog y aviso**

1. `verify-transfer-dialog.tsx`: prop nueva `kind: 'deposit' | 'balance'` (default `'deposit'`). El `window.confirm` del rechazo: deposit → texto actual ("Se cancelará la reserva."); balance → `'¿Rechazar esta transferencia del saldo? La reserva NO se cancela; la clienta podrá volver a avisar.'`. Si el título/label del diálogo dice "abono", variar a "saldo" con el mismo mecanismo. `pending-transfers-section.tsx`: pasar `kind` al dialog, mismo branching en su propio `window.confirm` (~línea 66) y en el copy de WhatsApp (~línea 61: "…del saldo" cuando kind==='balance').
2. `ManualPaymentDialog` / su trigger: donde el dashboard abre el diálogo de pago manual con la booking a mano, si `hasPendingBalanceTransfer(booking)` mostrar dentro del diálogo (o junto al trigger) el aviso: `'Hay una transferencia del saldo por verificar — verificala o rechazala antes de registrar otro pago.'` (texto informativo, NO bloquea). Ubicarlo donde el diálogo ya muestra la sugerencia de monto.

- [ ] **Step 6: Run** — component tests del task PASS + `npm run test:unit -- tests/unit/booking-row-actions.test.tsx tests/unit/booking-number-display.test.tsx` (regresión de tipos de BookingCard) PASS; tsc grep `^src/` vacío. NO correr la unit suite completa (Task 8 en paralelo).

- [ ] **Step 7: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/server/actions/bookings.ts src/app/dashboard/bookings/page.tsx src/app/dashboard/page.tsx src/components/dashboard/pending-transfers-section.tsx src/components/dashboard/verify-transfer-dialog.tsx src/components/dashboard/manual-payment-dialog.tsx tests/unit/pending-transfers-section.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "feat(dashboard): transferencias del saldo en la sección por verificar — kinds, badges y copys"
```

(Ajustar la lista a los archivos realmente tocados.)

---

### Task 8: superficie clienta — /book/confirmation

**Files:**
- Modify: `src/app/book/confirmation/page.tsx`, `src/app/book/confirmation/transfer-panel.tsx`, `src/components/booking/transfer-details.tsx`
- Test: `tests/unit/transfer-details-balance.test.tsx` (crear)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TransferDetails } from '@/components/booking/transfer-details'

const bank = { accountHolder: 'Ana', rut: '1-1', bankName: 'X', accountType: 'corriente', accountNumber: '123', email: null, instructions: null }

describe('TransferDetails variante saldo', () => {
  it('default sigue diciendo abono', () => {
    const html = renderToStaticMarkup(
      <TransferDetails bank={bank} amount={8000} deadline={null} timezone="America/Santiago" declaring={false} onDeclare={() => {}} />,
    )
    expect(html).toContain('abono')
  })
  it('variante saldo dice saldo y no muestra plazo', () => {
    const html = renderToStaticMarkup(
      <TransferDetails bank={bank} amount={8000} deadline={null} timezone="America/Santiago" declaring={false} onDeclare={() => {}} kind="balance" />,
    )
    expect(html).toContain('saldo')
    expect(html).not.toContain('abono')
  })
})
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: `TransferDetails` — prop `kind`**

```tsx
export function TransferDetails({ bank, amount, deadline, timezone, declaring, onDeclare, kind = 'deposit' }: {
  // ...props actuales...
  /** 'balance' = saldo restante: cambia el label del monto (sin plazo — deadline ya es null en ese caso). */
  kind?: 'deposit' | 'balance'
}) {
  // el <p> del monto:
  // Transferí el {kind === 'balance' ? 'saldo' : 'abono'} de {formatMoney(amount)} a esta cuenta:
```

El resto (rows, instructions, deadline condicional, botón "Ya transferí") queda igual — el caso saldo pasa `deadline={null}` y el bloque de plazo no renderiza (condición existente).

- [ ] **Step 4: `TransferPanel` — prop `kind` que elige la action**

```tsx
import { declareBankTransfer, declareBalanceTransfer } from '@/server/actions/bank-transfer-public'

export function TransferPanel({ bank, amount, deadline, timezone, bookingId, kind = 'deposit' }: {
  // ...props actuales...
  kind?: 'deposit' | 'balance'
}) {
  // en handleDeclare:
  //   await (kind === 'balance' ? declareBalanceTransfer(bookingId) : declareBankTransfer(bookingId))
  // y pasar kind a <TransferDetails ... kind={kind} />
```

- [ ] **Step 5: la page**

En `src/app/book/confirmation/page.tsx`:

1. El select de payments agrega `amount: true` (para mostrar lo declarado).
2. Derivación local del sub-estado del saldo (después de `state`):

```ts
  const balancePayment = booking.payments.find((p) => p.providerPaymentId?.startsWith(BT_BALANCE_PREFIX)) ?? null
  const isFirm = booking.status === 'confirmed' || booking.status === 'completed'
  const canDeclareBalance =
    isFirm &&
    booking.remainingBalance > 0 &&
    balancePayment?.status !== 'pending' &&
    balancePayment?.status !== 'approved'   // approved con saldo residual NO reabre el CTA (spec §6)
  const balancePartial = isFirm && balancePayment?.status === 'approved' && booking.remainingBalance > 0
  const balanceVerifying = isFirm && balancePayment?.status === 'pending'
  const balanceRejected = isFirm && balancePayment?.status === 'rejected'
```

(Import `BT_BALANCE_PREFIX` de declared.ts. Usar `booking.remainingBalance` del modelo, no el `remainingBalance` recomputado de la página — verificar cuál usa el resumen y ser consistente.)
3. El fetch de bankInfo: `const bankInfo = (canDeclare || canDeclareBalance) ? await getBankTransferInfo(booking.businessId) : null`.
4. Título para `completed` (spec §6): donde se elige `config`, si `booking.status === 'completed'` sobreescribir título/mensaje del caso confirmed: título `'Gracias por tu visita'`, mensaje: con saldo → `'Quedó un saldo pendiente de $X. Podés pagarlo por transferencia acá abajo.'`; sin saldo → `'¡Te esperamos la próxima!'`. (Branch local, `deriveConfirmationState` intacto.)
5. Render, después del `TransferPanel` de abono existente:

```tsx
        {canDeclareBalance && bankInfo && (
          <TransferPanel
            bank={bankInfo}
            amount={booking.remainingBalance}
            deadline={null}
            timezone={booking.business.timezone}
            bookingId={booking.id}
            kind="balance"
          />
        )}
        {balanceRejected && canDeclareBalance && (
          <p className="mb-4 text-center text-sm text-muted-foreground">
            Tu último aviso no pudo verificarse. Podés volver a avisar cuando quieras.
          </p>
        )}
        {balanceVerifying && (
          <div className="studio-card mb-8 p-5 text-center">
            <p className="text-sm font-medium text-primary">Saldo en verificación</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Avisaste una transferencia de ${balancePayment!.amount.toLocaleString('es-CL')}. El negocio la va a revisar; si pasan varios días, escribile.
            </p>
          </div>
        )}
        {balancePartial && (
          <p className="mb-8 text-center text-sm text-muted-foreground">
            Tu transferencia fue registrada parcialmente. Escribile al negocio para coordinar el resto.
          </p>
        )}
```

(Ubicar el bloque rejected ANTES del panel para que se lea como nota; ordenar visualmente: nota rejected → panel declarar → card verificando. El JSX exacto puede adaptarse al estilo de la página; el CONTENIDO y las condiciones son estos.)

- [ ] **Step 6: Run** — test nuevo PASS + `npm run test:unit -- tests/unit/*transfer*` PASS; tsc grep vacío. NO correr suite completa (Task 7 en paralelo).

- [ ] **Step 7: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef add src/app/book/confirmation/page.tsx src/app/book/confirmation/transfer-panel.tsx src/components/booking/transfer-details.tsx tests/unit/transfer-details-balance.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef commit -m "feat(book): pagar el saldo por transferencia desde la confirmación — declarar, verificando, parcial y copy de completed"
```

---

### Task 9: verificación final full-suite

**Files:** ninguno nuevo.

- [ ] **Step 1: Suites completas**

```bash
npx tsc --noEmit 2>&1 | grep -E '^src/' ; echo "exit=$?"   # vacío / exit=1
npm run test:unit
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration
npm run lint
```
Todo verde. Si un test pre-existente rompió por contratos ampliados (p.ej. mocks de `@/lib/notifications` sin las keys nuevas, o el tipo de payments con providerPaymentId), arreglar el TEST/mock, no el código.

- [ ] **Step 2: Diff vs spec**

`git -C <worktree> diff origin/main...HEAD --stat` contra la spec §2-§6: checklist — helpers+wheres; declare con idempotencia/carrera; confirm/reject con rama saldo ANTES del hold; allowCompleted solo desde la rama saldo; autolimpieza; sweeps cancelled/no_show; sección con kinds y exclusión cancelled/expired; dos predicados de badge; aviso en pago manual; page con 4 sub-estados + copy completed; 3 emails hermanos.

- [ ] **Step 3: Push**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef push -u origin claude/balance-transfer
```
