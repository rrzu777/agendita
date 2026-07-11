# Recordatorios intermedios de transferencia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dos emails best-effort disparados por el cron horario: (1) empujar a la clienta que eligió transferencia y no declaró antes de que venza el hold; (2) empujar a la dueña a verificar una transferencia declarada que envejece (incluye el caso `verifyHours=null`).

**Architecture:** Nuevo endpoint de cron `transfer-reminders` con una función `sendTransferReminders` que corre dos queries guardadas + compare-and-swap con `where` completo (patrón `send-reminders` + `expire-holds`). Reusa `declaredTransferPaymentWhere`, extrae a helpers compartidos el bloque de datos bancarios del email y la construcción de la URL de confirmación (hoy duplicados), y agrega 2 templates + 2 senders.

**Tech Stack:** Next.js App Router (fork custom — leer `node_modules/next/dist/docs/` antes de tocar APIs del framework), Prisma/Postgres, Vitest (unit + integration en Postgres Docker puerto 5433), Resend (emails). Spec: `docs/superpowers/specs/2026-07-11-recordatorios-transferencia-design.md`.

---

## Landmines (verificados esta iniciativa)

1. **tsc NO lo corren vitest/eslint** — antes de pushear: `npx tsc --noEmit 2>&1 | grep -E '^src/'` debe salir vacío (errores en `tests/**` son drift pre-existente del cliente Prisma, no rompen el build). Es el gate del job `build` de CI.
2. **Migración shared-DB** — aplicar con `prisma db execute` + `prisma migrate resolve --applied <migration>`, NUNCA `migrate dev`. Revisar el `.sql` por DROPs de ramas hermanas y podarlo a los statements de esta rama.
3. **Reusar `declaredTransferPaymentWhere` / `BANK_TRANSFER_METHOD`** de `@/lib/bank-transfer/declared` — nunca reescribir el trío provider+status+prefijo.
4. **`revalidate*` siempre await** (no aplica acá, no hay revalidate).
5. **git en worktree** — `git -C <worktree>` + `git add <archivos explícitos>`, nunca `-A`.
6. **CAS con `where` completo** (§6 del spec) — el `updateMany` de claim re-afirma status + payments + ventana, NO solo `flag:null` (si no, manda recordatorios a quien recién declaró/verificó).

## Infra de test (local)

- Docker Postgres `agendita-test-pg` (postgres:15) puerto **5433**. Arrancar si está caído: `docker start agendita-test-pg`.
- Integration: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- -t "<filtro>"` (NO doble-pasar `--config`; el script del npm ya lo setea).
- Unit: `npm test -- <archivo>`
- Prisma contra la DB compartida necesita env: `set -a; source /Users/robertozamorautrera/Projects/agendita/.env.local; set +a`.

## Anchors exactos (verificados)

- `src/lib/bank-transfer/declared.ts` — `BANK_TRANSFER_METHOD`, `declaredTransferPaymentWhere`.
- `src/lib/cron/send-reminders.ts:58-104` — patrón CAS claim/release a copiar.
- `src/lib/cron/expire-holds.ts:105-128` — dedupe de reply-to por negocio + `Promise.all`.
- `src/app/api/cron/expire-holds/route.ts` — patrón del route handler (Bearer `CRON_SECRET`, GET+POST).
- `.github/workflows/cron.yml:26-40` — steps `curl` (uno por endpoint).
- `src/lib/notifications/templates.ts:146-161` (HTML) y `:205-222` (text) — bloque bancario inline a extraer; `bookingReceivedCustomerHtml/Text` lo contiene, usando la var local `deposit` (= `fmtCurrency(depositRequired,...)`) + `data.businessTimezone`.
- `src/lib/notifications/types.ts:32-42` — `BookingEmailData.bankTransfer` (accountHolder, rut, bankName, accountType, accountNumber, email?, instructions?, `deadline: Date|null`, `confirmationUrl: string`).
- `src/lib/business/urls.ts:27` — `getBusinessPublicUrl(business, pathname='')`.
- `src/server/actions/bookings.ts:110`, `src/server/actions/payments.ts:162,192` — construcción `${getBusinessPublicUrl(...)}/book/confirmation?bookingId=` duplicada (3 sitios) a centralizar.
- `src/lib/notifications/email-provider.ts` — `getBusinessOwnerEmails` (privado, :123), `buildDashboardLink()` (privado, → `/dashboard/bookings`), `sendNotificationSafely` (:394), `sendEmail`, `getBusinessReplyToEmail`; `sendBankTransferDeclaredToBusiness` (:182) es el molde del sender a la dueña.
- `src/lib/bank-transfer/schema.ts` — `holdHours`/`verifyHours` (`min(1)`, default 24/48).

---

## Task 1: Migración + columnas de flags

**Files:**
- Modify: `prisma/schema.prisma` (model Booking)
- Create: `prisma/migrations/<timestamp>_add_transfer_reminder_flags/migration.sql`

- [ ] **Step 1: Agregar las columnas al schema**

En `model Booking`, junto a `reminderSentAt`:

```prisma
  transferReminderCustomerSentAt DateTime? // CAS del recordatorio a la clienta (pre-declaración)
  transferReminderBusinessSentAt DateTime? // CAS del recordatorio a la dueña (declarada sin verificar)
```

- [ ] **Step 2: Generar el SQL de la migración a mano (shared-DB, no migrate dev)**

Crear `prisma/migrations/20260711120000_add_transfer_reminder_flags/migration.sql`:

```sql
ALTER TABLE "Booking" ADD COLUMN "transferReminderCustomerSentAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "transferReminderBusinessSentAt" TIMESTAMP(3);
```

- [ ] **Step 3: Aplicar a la DB compartida + marcar aplicada + regenerar cliente**

```bash
set -a; source /Users/robertozamorautrera/Projects/agendita/.env.local; set +a
npx prisma db execute --file prisma/migrations/20260711120000_add_transfer_reminder_flags/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20260711120000_add_transfer_reminder_flags
npx prisma generate
```

Expected: `db execute` sin error; `migrate resolve` confirma aplicada; `generate` OK.

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit 2>&1 | grep -E '^src/'`
Expected: vacío (el cliente Prisma ahora conoce las columnas).

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add prisma/schema.prisma prisma/migrations/20260711120000_add_transfer_reminder_flags/
git -C <worktree> commit -m "feat(transfer-reminders): columnas de flags CAS en Booking"
```

---

## Task 2: Extraer `getBookingConfirmationUrl` (centraliza 3 duplicados)

**Files:**
- Modify: `src/lib/business/urls.ts`
- Modify: `src/server/actions/bookings.ts:110`, `src/server/actions/payments.ts:162,192`
- Test: `tests/unit/business-urls.test.ts` (crear o extender si existe)

- [ ] **Step 1: Test que fija el output**

```ts
import { describe, it, expect } from 'vitest'
import { getBookingConfirmationUrl } from '@/lib/business/urls'

describe('getBookingConfirmationUrl', () => {
  it('subdomain business → apex subdomain path', () => {
    const url = getBookingConfirmationUrl({ slug: 'bella', subdomain: 'bella' }, 'bk_1')
    expect(url).toContain('/book/confirmation?bookingId=bk_1')
    expect(url).toContain('bella.')
  })
  it('non-subdomain business → /b/<slug> path (quirk pre-existente, se preserva)', () => {
    const url = getBookingConfirmationUrl({ slug: 'bella', subdomain: null }, 'bk_1')
    expect(url).toContain('/b/bella/book/confirmation?bookingId=bk_1')
  })
})
```

- [ ] **Step 2: Run → fail** — `npm test -- tests/unit/business-urls.test.ts` → FAIL (no export).

- [ ] **Step 3: Implementar el helper**

En `src/lib/business/urls.ts`, después de `getBusinessPublicUrl`:

```ts
export function getBookingConfirmationUrl(business: BusinessUrlInput, bookingId: string): string {
  return `${getBusinessPublicUrl(business)}/book/confirmation?bookingId=${bookingId}`
}
```

Reemplazar los 3 sitios:
- `bookings.ts:110` → `confirmationUrl: getBookingConfirmationUrl({ slug: business.slug, subdomain: business.subdomain }, booking.id),`
- `payments.ts:162` y `:192` → `returnUrl: getBookingConfirmationUrl(booking.business, data.bookingId),` (importar `getBookingConfirmationUrl` junto a `getBusinessPublicUrl`; `booking.business` ya trae slug+subdomain — verificar el select y ajustar si falta).

- [ ] **Step 4: Run → pass** + regresión — `npm test -- tests/unit/business-urls.test.ts` y `npm test -- tests/unit` (confirmar que los tests de payments/bookings que dependían del string siguen verdes). `npx tsc --noEmit | grep '^src/'` vacío.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/lib/business/urls.ts src/server/actions/bookings.ts src/server/actions/payments.ts tests/unit/business-urls.test.ts
git -C <worktree> commit -m "refactor(transfer-reminders): getBookingConfirmationUrl compartido (centraliza 3 duplicados)"
```

---

## Task 3: Extraer el bloque de datos bancarios del email (regresión sin cambio de output)

**Files:**
- Modify: `src/lib/notifications/templates.ts`
- Test: `tests/unit/bank-transfer-block-template.test.ts` (crear)

- [ ] **Step 1: Test de regresión (mismo output que hoy)**

```ts
import { describe, it, expect } from 'vitest'
import { bankTransferBlockHtml, bankTransferBlockText } from '@/lib/notifications/templates'

const bt = {
  accountHolder: 'Ana Díaz', rut: '11.111.111-1', bankName: 'Banco X', accountType: 'corriente',
  accountNumber: '123456', email: 'ana@x.cl', instructions: 'Poné tu nombre',
  deadline: new Date('2026-07-15T18:00:00Z'), confirmationUrl: 'https://bella.agendita.cl/book/confirmation?bookingId=b1',
}

describe('bankTransferBlock', () => {
  it('html incluye datos, plazo y link', () => {
    const html = bankTransferBlockHtml(bt, '$8.000 CLP', 'America/Santiago')
    expect(html).toContain('Ana Díaz'); expect(html).toContain('123456')
    expect(html).toContain('Plazo'); expect(html).toContain(bt.confirmationUrl)
  })
  it('text incluye datos y link', () => {
    const text = bankTransferBlockText(bt, '$8.000 CLP', 'America/Santiago')
    expect(text).toContain('Banco X'); expect(text).toContain(bt.confirmationUrl)
  })
})
```

- [ ] **Step 2: Run → fail** — `npm test -- tests/unit/bank-transfer-block-template.test.ts` → FAIL.

- [ ] **Step 3: Extraer las funciones y re-cablear `bookingReceivedCustomer*`**

Crear en `templates.ts` (tipo del arg = `NonNullable<BookingEmailData['bankTransfer']>`):

```ts
export function bankTransferBlockHtml(
  bt: NonNullable<BookingEmailData['bankTransfer']>, depositLabel: string, timezone: string,
): string {
  return `<div style="margin-top:16px;border:1px solid #e0e0e0;border-radius:8px;padding:16px">
    <p style="font-weight:600;margin:0 0 8px">Datos para transferir el abono (${depositLabel})</p>
    <table style="font-size:14px;border-collapse:collapse">
      <tr><td style="padding:2px 12px 2px 0;color:#666">Titular</td><td>${escapeHtml(bt.accountHolder)}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">RUT</td><td>${escapeHtml(bt.rut)}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Banco</td><td>${escapeHtml(bt.bankName)}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Tipo</td><td>${escapeHtml(bt.accountType)}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Cuenta</td><td>${escapeHtml(bt.accountNumber)}</td></tr>
      ${bt.email ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Email</td><td>${escapeHtml(bt.email)}</td></tr>` : ''}
    </table>
    ${bt.instructions ? `<p style="font-size:13px;color:#666;margin:8px 0 0">${escapeHtml(bt.instructions)}</p>` : ''}
    ${bt.deadline ? `<p style="font-size:13px;margin:8px 0 0"><strong>Plazo:</strong> tenés hasta el ${fmtDate(bt.deadline, timezone)} para transferir y avisarnos.</p>` : ''}
    <p style="margin:12px 0 0"><a href="${escapeHtml(bt.confirmationUrl)}" style="color:#e91e63;text-decoration:none;font-weight:600">Cuando transfieras, avisá con el botón "Ya transferí" acá →</a></p>
  </div>`
}

export function bankTransferBlockText(
  bt: NonNullable<BookingEmailData['bankTransfer']>, depositLabel: string, timezone: string,
): string[] {
  const lines = [
    ``, `Datos para transferir el abono (${depositLabel}):`,
    `Titular: ${bt.accountHolder}`, `RUT: ${bt.rut}`, `Banco: ${bt.bankName}`,
    `Tipo: ${bt.accountType}`, `Cuenta: ${bt.accountNumber}`,
  ]
  if (bt.email) lines.push(`Email: ${bt.email}`)
  if (bt.instructions) lines.push(bt.instructions)
  if (bt.deadline) lines.push(`Plazo: hasta ${fmtDate(bt.deadline, timezone)}`)
  lines.push(`Cuando transfieras, avisá con "Ya transferí" acá: ${bt.confirmationUrl}`)
  return lines
}
```

Re-cablear `bookingReceivedCustomerHtml` (reemplazar el `bankSection = data.bankTransfer ? \`...\` : ''` por `const bankSection = data.bankTransfer ? bankTransferBlockHtml(data.bankTransfer, deposit, data.businessTimezone) : ''`) y `bookingReceivedCustomerText` (reemplazar el bloque `if (data.bankTransfer) { lines.push(...) }` por `if (data.bankTransfer) { lines.push(...bankTransferBlockText(data.bankTransfer, deposit, data.businessTimezone), '', 'Tu reserva quedará confirmada cuando el negocio verifique la transferencia.') } else { ... }`). **El output debe quedar idéntico** — si algún test existente de `bookingReceivedCustomer*` cambia, ajustar la extracción hasta que vuelva a coincidir (no cambiar el test).

- [ ] **Step 4: Run → pass** — `npm test -- tests/unit/bank-transfer-block-template.test.ts` y toda la suite de templates/notifications verde. `tsc | grep '^src/'` vacío.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/lib/notifications/templates.ts tests/unit/bank-transfer-block-template.test.ts
git -C <worktree> commit -m "refactor(transfer-reminders): extraer bankTransferBlock del email de reserva recibida"
```

---

## Task 4: Tipos + templates + senders de los recordatorios

**Files:**
- Modify: `src/lib/notifications/types.ts` (2 interfaces)
- Modify: `src/lib/notifications/templates.ts` (2× html/text)
- Modify: `src/lib/notifications/email-provider.ts` (2 senders)
- Modify: `src/lib/notifications/index.ts` (exports)
- Test: `tests/unit/transfer-reminder-emails.test.ts` (crear)

- [ ] **Step 1: Test de los templates**

```ts
import { describe, it, expect } from 'vitest'
import {
  transferReminderCustomerHtml, transferReminderCustomerText,
  transferReminderBusinessHtml, transferReminderBusinessText,
} from '@/lib/notifications/templates'

const bt = { accountHolder: 'Ana', rut: '1-1', bankName: 'X', accountType: 'corriente', accountNumber: '123', email: null, instructions: null, deadline: new Date('2026-07-15T18:00:00Z'), confirmationUrl: 'https://x/book/confirmation?bookingId=b1' }
const cust = { businessName: 'Bella', businessTimezone: 'America/Santiago', customerName: 'Ana', serviceName: 'Corte', depositLabel: '$8.000 CLP', bankTransfer: bt, bookingNumber: 4738 as number|null }
const biz = { businessName: 'Bella', customerName: 'Ana', serviceName: 'Corte', dashboardUrl: 'https://x/dashboard/bookings', bookingNumber: 4738 as number|null }

describe('transfer reminder templates', () => {
  it('clienta: pocas horas + datos + link', () => {
    const html = transferReminderCustomerHtml(cust)
    expect(html).toContain('pocas horas'); expect(html).toContain('123'); expect(html).toContain(bt.confirmationUrl)
    expect(transferReminderCustomerText(cust)).toContain(bt.confirmationUrl)
  })
  it('dueña: por verificar + link dashboard', () => {
    const html = transferReminderBusinessHtml(biz)
    expect(html).toContain('por verificar'); expect(html).toContain(biz.dashboardUrl)
    expect(transferReminderBusinessText(biz)).toContain('Bella')
  })
})
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implementar**

`types.ts`:

```ts
export interface TransferReminderCustomerEmailData {
  businessName: string
  businessTimezone: string
  customerName: string
  serviceName: string
  depositLabel: string                        // ya formateado ($X CLP)
  bankTransfer: NonNullable<BookingEmailData['bankTransfer']>
  bookingNumber?: number | null
  customerEmail?: string
  businessReplyToEmail?: string | null
}
export interface TransferReminderBusinessEmailData {
  businessName: string
  customerName: string
  serviceName: string
  dashboardUrl: string
  bookingNumber?: number | null
}
```

`templates.ts` (reusa `baseHtml/header/footer/escapeHtml/bankTransferBlockHtml/bankTransferBlockText/bookingNumberRowHtml`):

```ts
export function transferReminderCustomerHtml(data: TransferReminderCustomerEmailData): string {
  return baseHtml(`
    ${header('Te quedan pocas horas para transferir')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, tu reserva de <strong>${escapeHtml(data.serviceName)}</strong> sigue pendiente. Transferí el abono y avisanos hoy para no perder tu cupo.</p>
    ${bankTransferBlockHtml(data.bankTransfer, data.depositLabel, data.businessTimezone)}
    ${footer(data.businessName)}
  `)
}
export function transferReminderCustomerText(data: TransferReminderCustomerEmailData): string {
  return [
    `Hola ${data.customerName}, tu reserva de ${data.serviceName} sigue pendiente.`,
    `Transferí el abono y avisanos hoy para no perder tu cupo.`,
    ...bankTransferBlockText(data.bankTransfer, data.depositLabel, data.businessTimezone),
  ].join('\n')
}
export function transferReminderBusinessHtml(data: TransferReminderBusinessEmailData): string {
  return baseHtml(`
    ${header('Tenés una transferencia por verificar')}
    <p style="font-size:15px">${escapeHtml(data.customerName)} declaró una transferencia por <strong>${escapeHtml(data.serviceName)}</strong>${data.bookingNumber != null ? ` (reserva #${data.bookingNumber})` : ''} que sigue sin verificar. Revisá tu cuenta y confirmá o rechazá la reserva antes de que expire.</p>
    <p style="margin-top:16px"><a href="${escapeHtml(data.dashboardUrl)}" style="color:#e91e63;text-decoration:none;font-weight:600">Ir a verificar en el dashboard →</a></p>
    ${footer(data.businessName)}
  `)
}
export function transferReminderBusinessText(data: TransferReminderBusinessEmailData): string {
  return `${data.customerName} declaró una transferencia por ${data.serviceName} que sigue sin verificar. Revisá tu cuenta y confirmá o rechazá la reserva antes de que expire. Ir al dashboard: ${data.dashboardUrl}`
}
```

`email-provider.ts` (mismo molde que `sendBankTransferDeclaredToBusiness`; el business sender usa `getBusinessOwnerEmails` + `buildDashboardLink()`, ambos privados del módulo):

```ts
export async function sendTransferReminderToCustomer(data: TransferReminderCustomerEmailData): Promise<EmailResult> {
  if (!data.customerEmail) return { success: false, skipped: 'Cliente sin email' }
  return sendEmail(
    data.customerEmail,
    `Te quedan pocas horas para transferir - ${data.businessName}`,
    transferReminderCustomerHtml(data), transferReminderCustomerText(data),
    { replyTo: data.businessReplyToEmail },
  )
}

export async function sendTransferReminderToBusiness(businessId: string, data: Omit<TransferReminderBusinessEmailData, 'dashboardUrl'>): Promise<EmailResult[]> {
  const owners = await getBusinessOwnerEmails(businessId)
  if (owners.length === 0) return [{ success: false, skipped: 'Negocio sin emails' }]
  const dashboardUrl = buildDashboardLink()
  const html = transferReminderBusinessHtml({ ...data, dashboardUrl })
  const text = transferReminderBusinessText({ ...data, dashboardUrl })
  return Promise.all(owners.map((o) =>
    sendEmail(o.email, `Transferencia por verificar - ${data.businessName}`, html, text),
  ))
}
```

`index.ts`: exportar los 2 senders + los 4 templates + los 2 tipos (match a la convención de re-export existente).

- [ ] **Step 4: Run → pass** + `tsc | grep '^src/'` vacío.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/lib/notifications/
git -C <worktree> commit -m "feat(transfer-reminders): templates + senders de los dos recordatorios"
```

---

## Task 5: Función de cron `sendTransferReminders`

**Files:**
- Create: `src/lib/cron/transfer-reminders.ts`
- Test: `tests/unit/transfer-reminders.test.ts`, `tests/integration/transfer-reminders.test.ts`

- [ ] **Step 1: Unit test (mock db + deps)** — mirror `expire-holds.test.ts`. Casos: selección clienta (hold ≤3h, no declarada, sin MP pending, holdHours>3) llama al sender clienta; declarada verifyHours-seteado ≤6h → sender dueña; declarada verifyHours=null con Payment.createdAt ≥24h → sender dueña; MP pending → NO clienta; holdHours≤3 → NO clienta; CAS `count===0` (estado cambió) → NO envía; email falla → libera el flag. (Escribir con un `db` mock que devuelva los lotes por rama y espías en `deps`.)

- [ ] **Step 2: Run → fail** (módulo no existe).

- [ ] **Step 3: Implementar** `src/lib/cron/transfer-reminders.ts`:

```ts
import { addHours, subHours } from 'date-fns'
import { prisma } from '@/lib/db'
import { BANK_TRANSFER_METHOD, declaredTransferPaymentWhere } from '@/lib/bank-transfer/declared'
import {
  getBusinessReplyToEmail, sendNotificationSafely, sendMultiNotificationSafely,
  sendTransferReminderToCustomer, sendTransferReminderToBusiness,
} from '@/lib/notifications'
import { getBookingConfirmationUrl } from '@/lib/business/urls'
import { fmtCurrency } from '@/lib/notifications/templates' // si fmtCurrency no está exportado, exportarlo o formatear inline con el patrón existente
import { logger } from '@/lib/logger'

export const CUSTOMER_REMINDER_HOURS_BEFORE_HOLD = 3
export const BUSINESS_REMINDER_HOURS_BEFORE_VERIFY = 6
export const BUSINESS_REMINDER_HOURS_AFTER_DECLARE = 24

export interface TransferRemindersResult { customerSent: number; businessSent: number; skipped: number; errors: number }
interface Deps {
  sendCustomer: typeof sendTransferReminderToCustomer
  sendBusiness: typeof sendTransferReminderToBusiness
}

export async function sendTransferReminders(
  now = new Date(),
  db = prisma,
  deps: Deps = { sendCustomer: sendTransferReminderToCustomer, sendBusiness: sendTransferReminderToBusiness },
): Promise<TransferRemindersResult> {
  const result: TransferRemindersResult = { customerSent: 0, businessSent: 0, skipped: 0, errors: 0 }

  // ---- Clienta (pre-declaración) ----
  const customerWhere = {
    status: 'pending_payment' as const,
    paymentStatus: 'unpaid' as const,
    paymentMethod: BANK_TRANSFER_METHOD,
    transferReminderCustomerSentAt: null,
    holdExpiresAt: { gt: now, lte: addHours(now, CUSTOMER_REMINDER_HOURS_BEFORE_HOLD) },
    payments: { none: { OR: [declaredTransferPaymentWhere, { provider: 'mercado_pago', status: 'pending' }] } },
    business: { bankTransferAccount: { isEnabled: true, holdHours: { gt: CUSTOMER_REMINDER_HOURS_BEFORE_HOLD } } },
  }
  const customerBookings = await db.booking.findMany({
    where: customerWhere,
    include: {
      service: { select: { name: true } },
      customer: { select: { name: true, email: true } },
      business: { select: { id: true, name: true, timezone: true, currency: true, slug: true, subdomain: true, bankTransferAccount: true } },
    },
  })
  for (const b of customerBookings) {
    if (!b.customer?.email || !b.business.bankTransferAccount) { result.skipped++; continue }
    // CAS con where completo (re-afirma que sigue sin declarar / sin MP pending / etc.)
    const claim = await db.booking.updateMany({
      where: { id: b.id, ...customerWhere },
      data: { transferReminderCustomerSentAt: now },
    })
    if (claim.count === 0) { result.skipped++; continue }
    const acct = b.business.bankTransferAccount
    const depositLabel = fmtCurrency(Math.min(b.depositRequired, b.remainingBalance), b.business.currency || 'CLP')
    try {
      const res = await sendNotificationSafely('transfer reminder customer', () => deps.sendCustomer({
        businessName: b.business.name, businessTimezone: b.business.timezone || 'America/Santiago',
        customerName: b.customer!.name, serviceName: b.service?.name ?? 'servicio', depositLabel,
        bankTransfer: {
          accountHolder: acct.accountHolder, rut: acct.rut, bankName: acct.bankName, accountType: acct.accountType,
          accountNumber: acct.accountNumber, email: acct.email, instructions: acct.instructions,
          deadline: b.holdExpiresAt, confirmationUrl: getBookingConfirmationUrl(b.business, b.id),
        },
        bookingNumber: b.bookingNumber,
        customerEmail: b.customer!.email!, businessReplyToEmail: await getBusinessReplyToEmail(b.business.id),
      }))
      if (res.success) result.customerSent++
      else { await releaseCustomer(db, b.id, now); result.skipped++ }
    } catch { await releaseCustomer(db, b.id, now); logger.error('transfer_reminder.customer.failed', b.id); result.errors++ }
  }

  // ---- Dueña (declarada sin verificar) ----
  const businessWhere = {
    status: 'pending_payment' as const,
    transferReminderBusinessSentAt: null,
    OR: [
      { holdExpiresAt: { gt: now, lte: addHours(now, BUSINESS_REMINDER_HOURS_BEFORE_VERIFY) }, payments: { some: declaredTransferPaymentWhere } },
      { holdExpiresAt: null, payments: { some: { ...declaredTransferPaymentWhere, createdAt: { lte: subHours(now, BUSINESS_REMINDER_HOURS_AFTER_DECLARE) } } } },
    ],
  }
  const businessBookings = await db.booking.findMany({
    where: businessWhere,
    include: { service: { select: { name: true } }, customer: { select: { name: true } }, business: { select: { id: true, name: true } } },
  })
  for (const b of businessBookings) {
    const claim = await db.booking.updateMany({ where: { id: b.id, ...businessWhere }, data: { transferReminderBusinessSentAt: now } })
    if (claim.count === 0) { result.skipped++; continue }
    try {
      const results = await sendMultiNotificationSafely('transfer reminder business', () => deps.sendBusiness(b.business.id, {
        businessName: b.business.name, customerName: b.customer?.name ?? 'la clienta', serviceName: b.service?.name ?? 'servicio', bookingNumber: b.bookingNumber,
      }))
      if (results.some((r) => r.success)) result.businessSent++
      else { await releaseBusiness(db, b.id, now); result.skipped++ }
    } catch { await releaseBusiness(db, b.id, now); logger.error('transfer_reminder.business.failed', b.id); result.errors++ }
  }
  return result
}

async function releaseCustomer(db: typeof prisma, id: string, now: Date) {
  await db.booking.updateMany({ where: { id, transferReminderCustomerSentAt: now }, data: { transferReminderCustomerSentAt: null } })
}
async function releaseBusiness(db: typeof prisma, id: string, now: Date) {
  await db.booking.updateMany({ where: { id, transferReminderBusinessSentAt: now }, data: { transferReminderBusinessSentAt: null } })
}
```

Notas para el implementador: verificar que `fmtCurrency` esté exportado desde `templates.ts` (si no, exportarlo o replicar el patrón `$X CLP` que ya usan otros templates); confirmar el tipo del `db` param (usar el mismo enfoque testeable que `expireStaleHolds` — un `Pick<PrismaClient, ...>` o `typeof prisma`); `sendMultiNotificationSafely` ya existe (label PRIMERO). El reply-to del business sender se resuelve dentro de `sendTransferReminderToBusiness` (por owner), consistente con el molde `sendBankTransferDeclaredToBusiness`.

- [ ] **Step 4: Run unit → pass.**

- [ ] **Step 5: Integration test** `tests/integration/transfer-reminders.test.ts` (seed helpers de `tests/integration/helpers/bank-transfer-seed.ts`): (a) transferencia sin declarar, hold a +2h, holdHours=24 → corre → `transferReminderCustomerSentAt` seteado + 1 envío; segunda corrida → 0 (no reenvía). (b) declarada con `verifyHours` seteado y hold a +5h → dispara dueña. (c) declarada con `verifyHours=null` (hold NULL) y Payment.createdAt hace 25h → dispara dueña (rama b). (d) hold a +2h pero con un Payment MP `pending` → NO dispara clienta. (e) hold a +2h con holdHours del account = 2 → NO dispara clienta. Usar `deps` con espías para no mandar emails reales. Comando integración del bloque de infra.

- [ ] **Step 6: Run integration → pass** + `tsc | grep '^src/'` vacío.

- [ ] **Step 7: Commit**

```bash
git -C <worktree> add src/lib/cron/transfer-reminders.ts tests/unit/transfer-reminders.test.ts tests/integration/transfer-reminders.test.ts
git -C <worktree> commit -m "feat(transfer-reminders): función de cron con CAS de where completo + dos ramas"
```

---

## Task 6: Endpoint + step del cron

**Files:**
- Create: `src/app/api/cron/transfer-reminders/route.ts`
- Modify: `.github/workflows/cron.yml`

- [ ] **Step 1: Route handler** (copiar el patrón de `expire-holds/route.ts`):

```ts
import { NextRequest, NextResponse } from 'next/server'
import { sendTransferReminders } from '@/lib/cron/transfer-reminders'

async function handler(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await sendTransferReminders()
  console.log(`[cron:transfer-reminders] ${JSON.stringify(result)} at ${new Date().toISOString()}`)
  return NextResponse.json(result)
}
export const GET = handler
export const POST = handler
```

- [ ] **Step 2: Agregar el step al workflow** — en `.github/workflows/cron.yml`, después del step "Send reminders":

```yaml
      - name: Transfer reminders
        run: |
          curl -fsS --max-time 60 -X POST "$BASE_URL/api/cron/transfer-reminders" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

- [ ] **Step 3: Verificar tipos + build-parity** — `npx tsc --noEmit | grep '^src/'` vacío.

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add src/app/api/cron/transfer-reminders/route.ts .github/workflows/cron.yml
git -C <worktree> commit -m "feat(transfer-reminders): endpoint de cron + step en el workflow"
```

---

## Task 7: Verificación final + PR

- [ ] **Step 1: tsc gate** — `npx tsc --noEmit 2>&1 | grep -E '^src/'` → vacío.
- [ ] **Step 2: Unit + component** — `npm test` → todo verde.
- [ ] **Step 3: Integration** — comando del bloque de infra (suite completa) → verde.
- [ ] **Step 4: Lint** — `npm run lint` → 0 errores.
- [ ] **Step 5: Push + PR**

```bash
git -C <worktree> push -u origin claude/transfer-reminders
gh pr create --title "Recordatorios intermedios de transferencia bancaria" --base main --body "<resumen §1-8 + testing + nota: requiere columnas nuevas ya aplicadas a la DB compartida vía db execute + resolve>"
```

Esperar CI (build, unit, integration, lint requeridos; e2e no-bloqueante). **Ojo Vercel**: si el deploy de preview falla con un error de infra (`sts_credentials_fetch_failed` u otro de `build-container-init`) y el job GH `build` pasó, es transitorio → retriggear el deploy vía API de Vercel (CLI autenticado). Mergear cuando los checks requeridos estén verdes **y con confirmación del usuario**.

---

## Self-review (hecho al escribir)

- **Cobertura del spec:** §3 constantes → Task 5; §4 modelo → Task 1; §5 queries (ambas ramas + exclusión MP + guard holdHours + verifyHours=null) → Task 5; §6 CAS where-completo + dedupe → Task 5; §7 endpoint/cron → Task 6; §8 extracción bloque + URL + templates/senders → Tasks 2/3/4; §9 sin cambios /mi ni confirmación → respetado (no hay tasks ahí); §10 testing → tests en cada task.
- **Consistencia de tipos:** `TransferReminderCustomerEmailData.bankTransfer` = `NonNullable<BookingEmailData['bankTransfer']>` (mismo sub-objeto, no diverge); `bankTransferBlockHtml(bt, depositLabel, timezone)` firma estable entre Task 3 (definición + uso en bookingReceived) y Task 4 (uso en reminder). `sendTransferReminders(now, db, deps)` firma estable Task 5 → Task 6.
- **Puntos a verificar por el implementer (grep, no adivinar):** que `fmtCurrency` esté exportado desde `templates.ts`; que `booking.business` en `payments.ts` traiga slug+subdomain para `getBookingConfirmationUrl`; el tipo exacto del `db` param testeable (mirror `expireStaleHolds`); que el seed helper `bank-transfer-seed.ts` acepte `holdExpiresAt`/`startDateTime`/`customerEmail` (ya lo hace de PR C) y agregar un helper para sembrar el `Payment.createdAt` viejo si hace falta.
