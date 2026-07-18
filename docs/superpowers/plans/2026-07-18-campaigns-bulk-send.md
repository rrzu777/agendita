# Campañas — Envío masivo (bulk send) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la dueña envíe una campaña a toda la lista sin recorrer fila por fila — email masivo por tandas desde el navegador (con claim atómico anti doble-envío) + WhatsApp guiado un-toque-por-clienta.

**Architecture:** Se apoya en el core existente `prepareCampaignSend` (mint idempotente + puertas opt-out). El envío de email se extrae a un helper reusable `sendOneCampaignEmail` que **reclama la fila (`updateMany where sentAt:null`) antes de llamar a Resend** y la libera si falla — mata el doble-envío. Una nueva action `sendCampaignEmailBatch(campaignId, recipientIds[])` itera **secuencial** (nunca `Promise.all` → evita P2028 bajo `connection_limit=1`) sobre los ids que el cliente le pasa por tandas. El WhatsApp guiado es solo-UI sobre la action existente `sendCampaignMessage`. Sin migración, sin cron.

**Tech Stack:** Next.js (fork propio — `params` es Promise; server actions importadas y `await`-eadas desde client components), Prisma + Postgres (pgbouncer `connection_limit=1`), Resend, Vitest (unit + integración Docker PG :5433), rate-limit Upstash/memory.

**Spec:** `docs/superpowers/specs/2026-07-18-campaigns-bulk-send-design.md`

---

## Contexto de código (leer antes de empezar)

- **`src/lib/campaigns/send.ts`** — `prepareCampaignSend(db, businessId, recipientId, createdByUserId)`: lee la destinataria, aplica puerta 2 de opt-out (throw si `marketingOptOutAt`), mintea el grant idempotente y renderiza el mensaje. Devuelve `{ recipient, grant, message }`. **No marca `sentAt`.** El `select` de `campaign.promotion` hoy es `{ id, grantExpiryDays }`.
- **`src/server/actions/campaigns.ts`** — `'use server'`. Contiene `sendCampaignMessage` (WhatsApp: mintea + devuelve `waUrl`, marca `sentAt` no-atómico) y `sendCampaignEmail` (email: mintea + envía Resend + marca `sentAt` solo si éxito). Ambas resuelven auth con `requireBusinessRole(['owner','admin'])` y rate-limit por acción.
- **`src/lib/rate-limit.ts`** — `RATE_LIMITS` registry (línea ~39) + `checkRateLimit(action, max, windowMs, {userId, businessId})` que devuelve `{ success }`.
- **`src/lib/cron/send-reminders.ts:58-104`** — patrón CAS de referencia: `updateMany({ where:{ id, reminderSentAt:null }, data:{ reminderSentAt: now } })` → `if (claim.count === 0) skip`; en fallo, release con `updateMany({ where:{ id, reminderSentAt: now }, data:{ reminderSentAt: null } })`.
- **`src/app/dashboard/campanas/[id]/recipient-list.tsx`** — client component; `RecipientItem { id, name, phone, email, sentAt, grantStatus, optedOut, channel }`. Botones por fila (se conservan).
- **`src/app/dashboard/campanas/[id]/page.tsx`** — `force-dynamic`; serializa `recipients` y pasa `<RecipientList recipients metrics />`.
- **`src/lib/customers/channel.ts`** — `campaignChannel(customer): 'whatsapp'|'email'|'none'`.
- **Landmines:** correr `npx tsc --noEmit 2>&1 | grep '^src/'` (vitest/eslint no tipan); tests de integración con `npm run test:integration -- <file>` (el config default excluye `tests/integration/**`); DB de test Docker `agendita-test-pg` :5433 `postgresql://postgres:postgres@localhost:5433/agendita_test`; componentes que usan `useRouter` necesitan `vi.mock('next/navigation', ...)` o `renderToStaticMarkup` explota; `git -C <worktree>` + `git add` explícito.
- Todo el trabajo ocurre en el worktree `/Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk` (rama `claude/campaign-bulk`). Los comandos `git`/`npm`/`tsc` corren con `cd` a ese worktree.

## Mapa de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `src/lib/rate-limit.ts` | Registrar bucket `send-campaign-bulk-email` | Modificar (`RATE_LIMITS`) |
| `src/lib/campaigns/send.ts` | Gate de promo activa en `prepareCampaignSend`; nuevo `sendOneCampaignEmail` (claim+send+release) + tipo `SendEmailOutcome` | Modificar |
| `src/server/actions/campaigns.ts` | Refactor `sendCampaignEmail` sobre el helper; nueva action `sendCampaignEmailBatch` | Modificar |
| `src/app/dashboard/campanas/[id]/bulk-send-controls.tsx` | Client component: barra de email por tandas + WhatsApp guiado | Crear |
| `src/app/dashboard/campanas/[id]/recipient-list.tsx` | Recibir `campaignId`, renderizar `<BulkSendControls>` | Modificar |
| `src/app/dashboard/campanas/[id]/page.tsx` | Pasar `campaignId={campaign.id}` | Modificar |
| `tests/integration/campaigns-email.test.ts` | Casos gate + claim | Modificar |
| `tests/integration/campaigns-bulk.test.ts` | Drenar tanda mixta | Crear |
| `tests/unit/bulk-send-controls.test.tsx` | Render de controles | Crear |

---

## Task 1: Rate-limit bucket para bulk email

**Files:**
- Modify: `src/lib/rate-limit.ts:39-54`
- Test: `tests/unit/rate-limit-buckets.test.ts` (crear)

- [ ] **Step 1: Write the failing test**

Crear `tests/unit/rate-limit-buckets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RATE_LIMITS } from '@/lib/rate-limit'

describe('RATE_LIMITS', () => {
  it('registra el bucket de bulk email con presupuesto holgado', () => {
    const bucket = RATE_LIMITS['send-campaign-bulk-email']
    expect(bucket).toBeDefined()
    expect(bucket.maxRequests).toBeGreaterThanOrEqual(60)
    expect(bucket.windowMs).toBe(60_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npx vitest run tests/unit/rate-limit-buckets.test.ts`
Expected: FAIL — `bucket` es `undefined`.

- [ ] **Step 3: Add the bucket**

En `src/lib/rate-limit.ts`, dentro de `RATE_LIMITS`, después de la línea `'send-campaign-email': { maxRequests: 30, windowMs: 60_000 },`:

```ts
  // Envío masivo de email: el cliente drena en tandas; presupuesto holgado porque
  // el throttle real es la latencia de Resend (~2/s), no este bucket.
  'send-campaign-bulk-email': { maxRequests: 60, windowMs: 60_000 },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npx vitest run tests/unit/rate-limit-buckets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk
git add src/lib/rate-limit.ts tests/unit/rate-limit-buckets.test.ts
git commit -m "feat(campaigns): bucket de rate para bulk email"
```

---

## Task 2: Gate de promo activa en `prepareCampaignSend`

Una promo archivada (`isActive=false`) entre crear la campaña y enviar debe cortar el envío (fail-fast). El gate vive en el core compartido, así que aplica también al single-send existente (intencional y consistente).

**Files:**
- Modify: `src/lib/campaigns/send.ts:48-63`
- Test: `tests/integration/campaigns-email.test.ts` (agregar caso + seed con promo pausada)

- [ ] **Step 1: Write the failing test**

En `tests/integration/campaigns-email.test.ts`, extender el helper `seed` para aceptar `promoActive` y agregar un caso. Cambiar la firma de `seed`:

```ts
async function seed(opts: { optedOut?: boolean; email?: string | null; promoActive?: boolean }) {
```

y en el `prisma.promotion.create` de `seed`, agregar `isActive` al `data`:

```ts
      businessId: business.id, triggerType: 'granted', pointsCost: null, name: 'Promo',
      rewardType: 'percentage', rewardValue: 20, appliesToAll: true, grantExpiryDays: 30,
      isActive: opts.promoActive === false ? false : true,
```

Agregar dentro de `describe('sendCampaignEmail', ...)`:

```ts
  it('promo pausada: lanza y no envía', async () => {
    const { business, recipientId } = await seed({ promoActive: false })
    created.push(business.id)
    await expect(sendCampaignEmail(recipientId)).rejects.toThrow('pausada')
    expect(promoEmail).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npm run test:integration -- tests/integration/campaigns-email.test.ts`
Expected: FAIL — hoy no hay gate; el email se envía (o mintea) y no lanza "pausada".

- [ ] **Step 3: Add the gate**

En `src/lib/campaigns/send.ts`, en el `select` de `campaign.promotion` (dentro del `findFirst`), agregar `isActive: true`:

```ts
            promotion: { select: { id: true, grantExpiryDays: true, isActive: true } },
```

y justo después del bloque de puerta 2 de opt-out (después de la línea `if (recipient.customer.marketingOptOutAt) { throw ... }`), agregar:

```ts
  // Gate de promo activa: si la promo se archivó entre crear la campaña y enviar,
  // cortar (fail-fast) en vez de emitir beneficios contra una promo apagada.
  // Vive en el core → aplica también al single-send.
  if (!recipient.campaign.promotion.isActive) {
    throw new Error('La promoción de esta campaña está pausada')
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npm run test:integration -- tests/integration/campaigns-email.test.ts`
Expected: PASS — los 5 casos (los 4 previos + el nuevo) verdes.

- [ ] **Step 5: Commit**

```bash
cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk
git add src/lib/campaigns/send.ts tests/integration/campaigns-email.test.ts
git commit -m "feat(campaigns): fail-fast al enviar contra una promo pausada"
```

---

## Task 3: Helper `sendOneCampaignEmail` (claim + send + release) y refactor del single-send

Extraer el cuerpo de envío de email a `send.ts` con el claim atómico anti doble-envío. `sendCampaignEmail` (single) pasa a usarlo — arreglando también el doble-envío en el camino por-fila.

**Files:**
- Modify: `src/lib/campaigns/send.ts` (agregar tipo + función al final)
- Modify: `src/server/actions/campaigns.ts:149-182` (refactor)
- Test: `tests/integration/campaigns-email.test.ts` (agregar caso de claim/idempotencia)

- [ ] **Step 1: Write the failing test**

Agregar dentro de `describe('sendCampaignEmail', ...)` en `tests/integration/campaigns-email.test.ts`:

```ts
  it('claim: dos envíos sobre la misma destinataria → un solo email', async () => {
    const { business, recipientId } = await seed({})
    created.push(business.id)
    const r1 = await sendCampaignEmail(recipientId)
    const r2 = await sendCampaignEmail(recipientId)
    expect(r1.sent).toBe(true)
    expect(r2.sent).toBe(false) // segundo: ya enviado, no reenvía
    expect(promoEmail).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npm run test:integration -- tests/integration/campaigns-email.test.ts`
Expected: FAIL — hoy `sentAt: recipient.sentAt ?? new Date()` es sticky pero el segundo `sendCampaignEmail` **igual llama a Resend** (envía antes de chequear `sentAt`), así que `promoEmail` se llama 2 veces.

- [ ] **Step 3: Add the helper in `send.ts`**

Al principio de `src/lib/campaigns/send.ts`, agregar imports:

```ts
import { isEmailable } from '@/lib/customers/email'
import { ensureLoyaltyToken } from '@/lib/loyalty/token'
import { sendNotificationSafely, sendCampaignPromoEmail } from '@/lib/notifications'
```

Al final de `src/lib/campaigns/send.ts`, agregar:

```ts
export type SendEmailOutcome =
  | { status: 'sent' }
  | { status: 'skipped'; reason: 'already_sent' | 'no_email' }
  | { status: 'failed'; error: string }

/** Envía UNA campaña por email de forma idempotente y a prueba de doble-envío.
 *  Orden: prepare (mint + render + puertas) → CLAIM atómico de la fila
 *  (`updateMany where sentAt:null` fija sentAt+grantId) → Resend → release si falla.
 *  El claim garantiza que dos tandas solapadas no envíen dos veces (patrón
 *  send-reminders.ts). `prepareCampaignSend` puede lanzar (not-found / opt-out /
 *  promo pausada): el caller decide si lo captura. `replyTo` se iza afuera (una
 *  query por tanda, no por destinataria). */
export async function sendOneCampaignEmail(
  db: Db,
  businessId: string,
  recipientId: string,
  createdByUserId: string,
  replyTo: string | null,
): Promise<SendEmailOutcome> {
  const { recipient, grant, message } = await prepareCampaignSend(db, businessId, recipientId, createdByUserId)

  const email = recipient.customer.email
  if (!isEmailable(email)) return { status: 'skipped', reason: 'no_email' }

  // Claim: reserva sentAt + grantId de forma atómica ANTES de tocar Resend.
  const now = new Date()
  const claim = await db.campaignRecipient.updateMany({
    where: { id: recipient.id, sentAt: null },
    data: { sentAt: now, grantId: grant.id },
  })
  if (claim.count === 0) return { status: 'skipped', reason: 'already_sent' }

  const token = await ensureLoyaltyToken(db, recipient.customer)
  const result = await sendNotificationSafely('campaign_email', () =>
    sendCampaignPromoEmail({
      to: email!,
      businessName: recipient.campaign.business.name,
      businessReplyToEmail: replyTo,
      message,
      unsubscribeToken: token,
    }),
  )

  if (!result.success) {
    // Release: libera la fila para permitir reintento (el grant persiste, idempotente).
    await db.campaignRecipient.updateMany({
      where: { id: recipient.id, sentAt: now },
      data: { sentAt: null, grantId: null },
    })
    return { status: 'failed', error: result.error ?? result.skipped ?? 'No se pudo enviar el email' }
  }

  return { status: 'sent' }
}
```

- [ ] **Step 4: Refactor `sendCampaignEmail` to use the helper**

En `src/server/actions/campaigns.ts`, reemplazar el cuerpo completo de `sendCampaignEmail` (líneas 149-182) por:

```ts
export async function sendCampaignEmail(recipientId: string): Promise<{ sent: boolean; error?: string }> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('send-campaign-email', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const replyTo = await getBusinessReplyToEmail(businessId)
  const outcome = await sendOneCampaignEmail(prisma, businessId, recipientId, user.id, replyTo)

  if (outcome.status === 'sent') return { sent: true }
  if (outcome.status === 'skipped') {
    return { sent: false, error: outcome.reason === 'no_email' ? 'La clienta no tiene un email válido.' : 'Ya se había enviado.' }
  }
  return { sent: false, error: outcome.error }
}
```

Actualizar los imports de `src/server/actions/campaigns.ts`:
- Agregar `sendOneCampaignEmail` a la import de `@/lib/campaigns/send`:
  ```ts
  import { prepareCampaignSend, sendOneCampaignEmail } from '@/lib/campaigns/send'
  ```
- Quitar los imports que ya no usa el archivo (los usa ahora `send.ts`): `isEmailable` (de `@/lib/customers/email`), `ensureLoyaltyToken` (de `@/lib/loyalty/token`), y de `@/lib/notifications` dejar solo `getBusinessReplyToEmail` (quitar `sendNotificationSafely, sendCampaignPromoEmail`). Verificar con tsc en Step 6 que no quede ningún import sin usar ni ninguna referencia colgada.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npm run test:integration -- tests/integration/campaigns-email.test.ts`
Expected: PASS — los 6 casos verdes (éxito, fallo-no-marca, opt-out, sin-email, promo-pausada, claim). En "fallo de envío" el claim se libera → `sentAt` final `null` ✓.

- [ ] **Step 6: Typecheck + commit**

```bash
cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk
npx tsc --noEmit 2>&1 | grep '^src/' || echo "tsc OK (0 errores en src)"
git add src/lib/campaigns/send.ts src/server/actions/campaigns.ts tests/integration/campaigns-email.test.ts
git commit -m "refactor(campaigns): sendOneCampaignEmail con claim atómico anti doble-envío"
```

---

## Task 4: Action `sendCampaignEmailBatch`

Procesa los ids que el cliente le pasa por tandas (secuencial, tolerante a fallos por-ítem). El cliente maneja la cola desde los props; el server revalida ownership + claim + puertas por cada id.

**Files:**
- Modify: `src/server/actions/campaigns.ts` (agregar action + const)
- Test: `tests/integration/campaigns-bulk.test.ts` (crear)

- [ ] **Step 1: Write the failing test**

Crear `tests/integration/campaigns-bulk.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

const authState = vi.hoisted(() => ({ businessId: '', userId: '' }))
vi.mock('@/lib/auth/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/server')>()
  return {
    ...actual,
    requireBusinessRole: vi.fn(async () => ({
      businessId: authState.businessId,
      user: { id: authState.userId },
      business: { timezone: 'America/Santiago' },
    })),
  }
})

const promoEmail = vi.hoisted(() => vi.fn(async () => ({ success: true, messageId: 'm1' })))
vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>()
  return {
    ...actual,
    sendCampaignPromoEmail: promoEmail,
    getBusinessReplyToEmail: vi.fn(async () => null),
    sendNotificationSafely: async (_l: string, fn: () => Promise<unknown>) => fn(),
  }
})

import { prisma } from '@/lib/db'
import { sendCampaignEmailBatch } from '@/server/actions/campaigns'

let seq = 0
/** Crea negocio + promo granted + campaña con N clientas de email + 1 opt-out + 1 sin email. */
async function seedCampaign() {
  seq += 1
  const uniq = `${Date.now()}-${seq}`
  const user = await prisma.user.create({ data: { email: `u-${uniq}@x.com`, name: 'Owner' } })
  const business = await prisma.business.create({
    data: {
      name: 'Biz Bulk', slug: `biz-bulk-${uniq}`, subdomain: `bizbulk${seq}${Date.now()}`,
      ownerUserId: user.id, city: 'Santiago', timezone: 'America/Santiago',
    },
  })
  await prisma.businessUser.create({ data: { businessId: business.id, userId: user.id, role: 'owner' } })
  const promotion = await prisma.promotion.create({
    data: {
      businessId: business.id, triggerType: 'granted', pointsCost: null, name: 'Promo',
      rewardType: 'percentage', rewardValue: 20, appliesToAll: true, grantExpiryDays: 30, isActive: true,
    },
  })
  // 3 con email (teléfono NO whatsappeable = '1'), 1 opt-out, 1 sin email.
  const specs = [
    { name: 'Emi Uno', email: 'e1@x.com', optedOut: false },
    { name: 'Emi Dos', email: 'e2@x.com', optedOut: false },
    { name: 'Emi Tres', email: 'e3@x.com', optedOut: false },
    { name: 'Opta Fuera', email: 'o@x.com', optedOut: true },
    { name: 'Sin Mail', email: null, optedOut: false },
  ]
  const recipientIds: string[] = []
  const campaign = await prisma.campaign.create({
    data: {
      businessId: business.id, name: 'C', segmentType: 'inactive', promotionId: promotion.id,
      messageTemplate: 'Hola {nombre}, código {codigo}',
    },
    select: { id: true },
  })
  for (const s of specs) {
    const customer = await prisma.customer.create({
      data: {
        businessId: business.id, name: s.name, phone: '1', email: s.email,
        marketingOptOutAt: s.optedOut ? new Date() : null,
      },
    })
    const rec = await prisma.campaignRecipient.create({
      data: { campaignId: campaign.id, customerId: customer.id }, select: { id: true },
    })
    recipientIds.push(rec.id)
  }
  authState.businessId = business.id
  authState.userId = user.id
  return { business, campaignId: campaign.id, recipientIds }
}

const created: string[] = []
afterAll(async () => {
  for (const id of created) {
    await prisma.campaignRecipient.deleteMany({ where: { campaign: { businessId: id } } })
    await prisma.campaign.deleteMany({ where: { businessId: id } })
    await prisma.promotionGrant.deleteMany({ where: { businessId: id } })
    await prisma.promotion.deleteMany({ where: { businessId: id } })
    await prisma.customer.deleteMany({ where: { businessId: id } })
    await prisma.businessUser.deleteMany({ where: { businessId: id } })
    const biz = await prisma.business.findUnique({ where: { id }, select: { ownerUserId: true } })
    await prisma.business.deleteMany({ where: { id } })
    if (biz) await prisma.user.deleteMany({ where: { id: biz.ownerUserId } })
  }
  await prisma.$disconnect()
})

describe('sendCampaignEmailBatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('drena una tanda mixta: envía 3, saltea opt-out y sin-email; re-run no reenvía', async () => {
    const { business, campaignId, recipientIds } = await seedCampaign()
    created.push(business.id)

    const { results } = await sendCampaignEmailBatch(campaignId, recipientIds)
    const sent = results.filter((r) => r.status === 'sent').length
    const skipped = results.filter((r) => r.status === 'skipped').length
    expect(sent).toBe(3)
    expect(skipped).toBe(2) // opt-out + sin-email
    expect(promoEmail).toHaveBeenCalledTimes(3)

    // Idempotencia: segunda pasada no reenvía nada.
    vi.clearAllMocks()
    const again = await sendCampaignEmailBatch(campaignId, recipientIds)
    expect(again.results.filter((r) => r.status === 'sent').length).toBe(0)
    expect(promoEmail).not.toHaveBeenCalled()
  })

  it('rechaza tandas más grandes que el máximo por llamada', async () => {
    const { business, campaignId } = await seedCampaign()
    created.push(business.id)
    const tooMany = Array.from({ length: 26 }, (_, i) => `x${i}`)
    await expect(sendCampaignEmailBatch(campaignId, tooMany)).rejects.toThrow('tanda')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npm run test:integration -- tests/integration/campaigns-bulk.test.ts`
Expected: FAIL — `sendCampaignEmailBatch` no existe (import error).

- [ ] **Step 3: Implement the action**

En `src/server/actions/campaigns.ts`, agregar cerca del tope (después de la nota `// NOTE: 'use server'...`) la constante:

```ts
/** Máximo de destinatarias por llamada de bulk: acota el trabajo por request para
 *  no pasar el timeout serverless por defecto (~10-15s) — la latencia de Resend
 *  (~2/s) hace que ~15 envíos secuenciales ronden los 5-7s. El cliente pagina. */
const BULK_EMAIL_MAX_PER_CALL = 15
```

y al final del archivo, agregar la action:

```ts
/** Envío masivo de email por tandas. El cliente maneja la cola (desde los props del
 *  detalle) y pasa hasta BULK_EMAIL_MAX_PER_CALL ids por llamada. El server revalida
 *  ownership de la campaña y, por cada id, delega en sendOneCampaignEmail (claim +
 *  puertas). Itera SECUENCIAL (no Promise.all): cada envío abre una tx interactiva
 *  para mintear, y en paralelo bajo connection_limit=1 (pgbouncer) explota con P2028.
 *  Un ítem que falla (opt-out, promo pausada, borrada, Resend) NO aborta la tanda. */
export async function sendCampaignEmailBatch(
  campaignId: string,
  recipientIds: string[],
): Promise<{ results: { recipientId: string; status: 'sent' | 'skipped' | 'failed'; error?: string }[] }> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  if (recipientIds.length === 0) return { results: [] }
  if (recipientIds.length > BULK_EMAIL_MAX_PER_CALL) {
    throw new Error(`Máximo ${BULK_EMAIL_MAX_PER_CALL} destinatarias por tanda`)
  }
  const limit = await checkRateLimit('send-campaign-bulk-email', 60, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, businessId }, select: { id: true } })
  if (!campaign) throw new ForbiddenError('Campaña no encontrada')

  const replyTo = await getBusinessReplyToEmail(businessId)

  const results: { recipientId: string; status: 'sent' | 'skipped' | 'failed'; error?: string }[] = []
  for (const recipientId of recipientIds) {
    try {
      const outcome = await sendOneCampaignEmail(prisma, businessId, recipientId, user.id, replyTo)
      if (outcome.status === 'sent') results.push({ recipientId, status: 'sent' })
      else if (outcome.status === 'skipped') results.push({ recipientId, status: 'skipped', error: outcome.reason })
      else results.push({ recipientId, status: 'failed', error: outcome.error })
    } catch (e) {
      // Puerta 2 (opt-out), promo pausada, destinataria borrada → saltar, no abortar.
      results.push({ recipientId, status: 'skipped', error: e instanceof Error ? e.message : 'error' })
    }
  }
  return { results }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npm run test:integration -- tests/integration/campaigns-bulk.test.ts`
Expected: PASS — ambos casos verdes.

- [ ] **Step 5: Typecheck + commit**

```bash
cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk
npx tsc --noEmit 2>&1 | grep '^src/' || echo "tsc OK (0 errores en src)"
git add src/server/actions/campaigns.ts tests/integration/campaigns-bulk.test.ts
git commit -m "feat(campaigns): action sendCampaignEmailBatch (tandas secuenciales, tolerante a fallos)"
```

---

## Task 5: Componente `BulkSendControls` + cablearlo

Barra de progreso de email por tandas (chunks de 10) + modo WhatsApp guiado (un toque por clienta). Los botones por fila del `RecipientList` se conservan.

**Files:**
- Create: `src/app/dashboard/campanas/[id]/bulk-send-controls.tsx`
- Modify: `src/app/dashboard/campanas/[id]/recipient-list.tsx` (recibir `campaignId`, renderizar el control)
- Modify: `src/app/dashboard/campanas/[id]/page.tsx` (pasar `campaignId`)
- Test: `tests/unit/bulk-send-controls.test.tsx` (crear)

- [ ] **Step 1: Write the failing test**

Crear `tests/unit/bulk-send-controls.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/server/actions/campaigns', () => ({
  sendCampaignEmailBatch: vi.fn(),
  sendCampaignMessage: vi.fn(),
}))

// LANDMINE: sin este mock renderToStaticMarkup explota con useRouter.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const base = { grantStatus: null, optedOut: false } as const

describe('BulkSendControls', () => {
  it('muestra el botón de email masivo con el conteo de pendientes de email', async () => {
    const { BulkSendControls } = await import('@/app/dashboard/campanas/[id]/bulk-send-controls')
    const html = renderToStaticMarkup(
      <BulkSendControls
        campaignId="c1"
        recipients={[
          { ...base, id: 'r1', name: 'A', phone: '1', email: 'a@x.com', sentAt: null, channel: 'email' },
          { ...base, id: 'r2', name: 'B', phone: '1', email: 'b@x.com', sentAt: null, channel: 'email' },
          { ...base, id: 'r3', name: 'C', phone: '+56911111111', email: null, sentAt: null, channel: 'whatsapp' },
        ]}
      />,
    )
    expect(html).toContain('Enviar todos los emails')
    expect(html).toContain('2') // 2 pendientes de email
    expect(html).toContain('WhatsApp guiado')
  })

  it('no muestra controles cuando no hay pendientes', async () => {
    const { BulkSendControls } = await import('@/app/dashboard/campanas/[id]/bulk-send-controls')
    const html = renderToStaticMarkup(
      <BulkSendControls
        campaignId="c1"
        recipients={[
          { ...base, id: 'r1', name: 'A', phone: '1', email: 'a@x.com', sentAt: new Date(), channel: 'email' },
        ]}
      />,
    )
    expect(html).not.toContain('Enviar todos los emails')
    expect(html).not.toContain('WhatsApp guiado')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npx vitest run tests/unit/bulk-send-controls.test.tsx`
Expected: FAIL — el módulo `bulk-send-controls` no existe.

- [ ] **Step 3: Create the component**

Crear `src/app/dashboard/campanas/[id]/bulk-send-controls.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Mail, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { sendCampaignEmailBatch, sendCampaignMessage } from '@/server/actions/campaigns'
import type { RecipientItem } from './recipient-list'

const EMAIL_CHUNK = 10

/** Solo pendientes contactables por cada canal (no opt-out, no enviadas). */
function pendingByChannel(recipients: RecipientItem[]) {
  const email = recipients.filter((r) => !r.optedOut && r.channel === 'email' && !r.sentAt)
  const whatsapp = recipients.filter((r) => !r.optedOut && r.channel === 'whatsapp' && !r.sentAt)
  return { email, whatsapp }
}

export function BulkSendControls({
  campaignId,
  recipients,
}: {
  campaignId: string
  recipients: RecipientItem[]
}) {
  const router = useRouter()
  const { email, whatsapp } = useMemo(() => pendingByChannel(recipients), [recipients])

  // ── Email masivo por tandas ──────────────────────────────────────────────
  const [emailRunning, setEmailRunning] = useState(false)
  const [emailDone, setEmailDone] = useState(0)
  const [emailFailed, setEmailFailed] = useState<string[]>([])

  async function runEmailBulk() {
    setEmailRunning(true)
    setEmailDone(0)
    setEmailFailed([])
    const ids = email.map((r) => r.id)
    const failed: string[] = []
    let done = 0
    try {
      for (let i = 0; i < ids.length; i += EMAIL_CHUNK) {
        const chunk = ids.slice(i, i + EMAIL_CHUNK)
        const { results } = await sendCampaignEmailBatch(campaignId, chunk)
        for (const r of results) {
          done += 1
          if (r.status === 'failed') failed.push(r.recipientId)
        }
        setEmailDone(done)
      }
      setEmailFailed(failed)
    } finally {
      setEmailRunning(false)
      router.refresh() // un solo refresh al final (la página es force-dynamic).
    }
  }

  // ── WhatsApp guiado (un toque por clienta) ───────────────────────────────
  const [guiding, setGuiding] = useState(false)
  const [waIndex, setWaIndex] = useState(0)
  const [waSending, setWaSending] = useState(false)
  const [waError, setWaError] = useState<string | null>(null)
  const current = whatsapp[waIndex]

  function openNext() {
    if (!current) return
    // Abrimos la ventana YA (gesto del usuario) para no toparnos con el bloqueador
    // de pop-ups tras el await (patrón review-link-button).
    const win = window.open('', '_blank')
    setWaSending(true)
    setWaError(null)
    ;(async () => {
      try {
        const { waUrl } = await sendCampaignMessage(current.id)
        if (waUrl) {
          if (win) win.location.href = waUrl
          else window.open(waUrl, '_blank')
        } else {
          win?.close()
          setWaError('La clienta no tiene un teléfono válido.')
        }
      } catch (e) {
        win?.close()
        setWaError(e instanceof Error ? e.message : 'No se pudo enviar')
      } finally {
        setWaSending(false)
        setWaIndex((i) => i + 1) // avanza aunque falle (optimista, un toque por clienta)
      }
    })()
  }

  function finishGuiding() {
    setGuiding(false)
    setWaIndex(0)
    router.refresh()
  }

  if (email.length === 0 && whatsapp.length === 0) return null

  return (
    <div className="studio-card space-y-4 p-4">
      {email.length > 0 && (
        <div className="flex flex-col gap-2">
          <Button onClick={runEmailBulk} disabled={emailRunning} variant="outline" className="w-fit">
            {emailRunning ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Mail className="mr-2 size-4" />}
            Enviar todos los emails ({email.length})
          </Button>
          {(emailRunning || emailDone > 0) && (
            <p className="text-sm text-muted-foreground">
              Enviando emails… {emailDone} / {email.length}
              {emailFailed.length > 0 && ` · ${emailFailed.length} con error`}
            </p>
          )}
        </div>
      )}

      {whatsapp.length > 0 && !guiding && (
        <Button onClick={() => { setGuiding(true); setWaIndex(0) }} className="w-fit bg-[#25D366] text-white hover:bg-[#1ebe5b]">
          <MessageCircle className="mr-2 size-4" />
          WhatsApp guiado ({whatsapp.length})
        </Button>
      )}

      {guiding && (
        <div className="rounded-md border p-4">
          {current ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                {waIndex + 1} / {whatsapp.length}
              </p>
              <p className="font-semibold text-primary">{current.name}</p>
              <div className="flex gap-2">
                <Button onClick={openNext} disabled={waSending} className="bg-[#25D366] text-white hover:bg-[#1ebe5b]">
                  {waSending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <MessageCircle className="mr-2 size-4" />}
                  Abrir WhatsApp y siguiente
                </Button>
                <Button variant="ghost" onClick={finishGuiding}>Terminar</Button>
              </div>
              {waError && <span className="text-xs text-destructive">{waError}</span>}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-primary">Listas las {whatsapp.length} de WhatsApp ✓</p>
              <Button variant="outline" onClick={finishGuiding} className="w-fit">Cerrar</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire into `RecipientList`**

En `src/app/dashboard/campanas/[id]/recipient-list.tsx`:
- Agregar el import (después de la línea del import de `StatusBadge`):
  ```ts
  import { BulkSendControls } from './bulk-send-controls'
  ```
- Cambiar la firma del componente para aceptar `campaignId`:
  ```ts
  export function RecipientList({
    campaignId,
    recipients,
    metrics,
  }: {
    campaignId: string
    recipients: RecipientItem[]
    metrics: RecipientMetrics
  }) {
  ```
- Renderizar el control justo después del bloque de métricas (el `</div>` que cierra el `grid` de stat-cards, antes del `{recipients.length === 0 ? ...}`):
  ```tsx
        </div>

        {recipients.length > 0 && <BulkSendControls campaignId={campaignId} recipients={recipients} />}

        {recipients.length === 0 ? (
  ```

- [ ] **Step 5: Pass `campaignId` from the page**

En `src/app/dashboard/campanas/[id]/page.tsx`, en el render de `<RecipientList>`, agregar la prop `campaignId`:

```tsx
        <RecipientList
          campaignId={campaign.id}
          recipients={recipients}
          metrics={{ enviadas, canjearon, vigentes }}
        />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npx vitest run tests/unit/bulk-send-controls.test.tsx tests/unit/recipient-list.test.tsx`
Expected: PASS — el nuevo test + el existente de `recipient-list` (que no pasa `campaignId`) deben seguir verdes. **Nota:** `recipient-list.test.tsx` no pasa `campaignId`; al hacerlo requerido, TS se quejaría en tsc pero el render runtime funciona (queda `undefined`). Para no romper tsc, actualizar `recipient-list.test.tsx` agregando `campaignId="c1"` en sus 5 renders de `<RecipientList ...>`.

- [ ] **Step 7: Typecheck + commit**

```bash
cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk
npx tsc --noEmit 2>&1 | grep '^src/' || echo "tsc OK (0 errores en src)"
git add src/app/dashboard/campanas/[id]/bulk-send-controls.tsx src/app/dashboard/campanas/[id]/recipient-list.tsx src/app/dashboard/campanas/[id]/page.tsx tests/unit/bulk-send-controls.test.tsx tests/unit/recipient-list.test.tsx
git commit -m "feat(campaigns): BulkSendControls — email por tandas + WhatsApp guiado"
```

---

## Task 6: Verificación final + /simplify

**Files:** ninguno nuevo — verificación.

- [ ] **Step 1: Typecheck completo**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npx tsc --noEmit 2>&1 | grep '^src/' || echo "tsc OK"`
Expected: `tsc OK` (0 errores en `src/`).

- [ ] **Step 2: Suite unit completa**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npx vitest run`
Expected: PASS — toda la suite unit verde (incluye `rate-limit-buckets`, `bulk-send-controls`, `recipient-list`).

- [ ] **Step 3: Integración de campañas**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npm run test:integration -- tests/integration/campaigns-email.test.ts tests/integration/campaigns-bulk.test.ts tests/integration/campaigns-mint.test.ts`
Expected: PASS — email (6 casos), bulk (2 casos), mint intacto.

- [ ] **Step 4: Lint**

Run: `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk && npm run lint 2>&1 | tail -5`
Expected: 0 errores nuevos.

- [ ] **Step 5: /simplify**

Ejecutar la skill `/simplify` sobre el diff de la rama (`origin/main...HEAD`). Aplicar los fixes legítimos (reuse/simplification/efficiency/altitude); anotar los skips. NO buscar bugs de correctness (eso es code review).

- [ ] **Step 6: Commit de cierre (si /simplify aplicó algo)**

```bash
cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-bulk
git add -A && git commit -m "refactor(campaigns): /simplify sobre bulk send" || echo "nada que commitear"
```

- [ ] **Step 7: Handoff**

Reportar al usuario: suite verde, tsc 0 src, integración verde. Ofrecer crear el PR (NO mergear sin OK explícito del usuario, por el workflow del proyecto). Recordar el riesgo aceptado documentado en la spec (dominio FROM compartido) y que no hubo migración.

---

## Notas de diseño (para quien ejecute)

- **Secuencial, no `Promise.all`:** el punto más importante. Cada `sendOneCampaignEmail` abre una tx interactiva (mint); en paralelo bajo `connection_limit=1` da P2028. El `for … of await` del batch es intencional.
- **El claim guarda solo el envío de Resend**, no el mint (el mint ya es idempotente por `requestId`). Por eso el orden es prepare(mint) → claim → send → release.
- **Release resetea `sentAt` Y `grantId`** al par que fijó el claim; el grant en sí persiste (idempotente), solo se des-vincula la fila para reintento limpio.
- **El cliente maneja la cola** desde los props (`sentAt==null` + canal). Avanza sobre los ids que ya intentó aunque fallen → no hay loop infinito por un fallo permanente. El server igual revalida cada id.
- **WhatsApp guiado es optimista:** marca `sentAt` al abrir (vía `sendCampaignMessage`), un toque por clienta. Reabrir el modo saltea las ya `sentAt` (heredando el falso-positivo si la dueña abrió pero no envió — decisión aceptada en la spec).
- **`maxRedemptions` NO se enforca** (YAGNI, decisión de la spec). **Dominio FROM compartido** = riesgo aceptado documentado.
