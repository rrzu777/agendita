# Opt-out de campañas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una clienta puede quedar excluida de toda comunicación de marketing (`Customer.marketingOptOutAt`), marcado por la dueña o autogestionado, con enforcement en las 3 puertas de salida (segmentos, envío de campaña, email del cron de fidelización).

**Architecture:** Un solo campo timestamp en `Customer`. Enforcement puntual en `queryCampaignSegment` (listas nuevas), `sendCampaignMessage` (campañas en curso, antes de mintear) y el guard de email de `runAutomaticLoyalty` (el grant se emite igual). Core reusable `setMarketingOptOut` en `src/lib/campaigns/optout.ts`; tres server actions lo envuelven (dueña por rol, clienta por `loyaltyToken`, clienta por sesión). UI: toggle en ficha, badge en lista, "No contactar" en detalle de campaña, sección de baja en `/tarjeta` y `/mi`.

**Tech Stack:** Next.js App Router (fork custom: `params` es Promise), Prisma 5.22 + Postgres, Zod, Vitest (unit jsdom + integration contra Postgres local 5433), Radix Switch.

**Spec:** `docs/superpowers/specs/2026-07-16-campaign-optout-design.md`

---

## Contexto operativo para TODOS los tasks

- **Worktree:** `/Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout`, rama `claude/campaign-optout`. Usá `git -C <worktree>` SIEMPRE (el cwd del shell puede driftear al checkout principal) y `git add` con archivos explícitos, nunca `-A`.
- **Unit tests:** `npm test -- tests/unit/<archivo>` (OJO: `npm test` ya incluye `--run`; NO agregues `--run`).
- **Integration tests:** requieren el Postgres local de test (docker `agendita-test-pg`, puerto 5433):
  ```bash
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- tests/integration/<archivo>
  ```
  NO corras dos tasks de integración en paralelo.
- **Type-check:** `npx tsc --noEmit 2>&1 | grep '^src/'` (vitest/eslint NO chequean tipos; esto es lo que rompe el build de CI).
- **Módulos `'use server'`:** SOLO exports de funciones async. Schemas/consts/tipos van en `src/lib/`.
- **`revalidatePath` siempre con `await`** cuando la función lo permita (landmine histórica: sin await crasheó el proceso).
- Los tests de componentes que usan `useRouter` deben mockear `next/navigation`.

---

### Task 1: Migración `marketingOptOutAt` + schema Prisma

**Files:**
- Create: `prisma/migrations/20260716120000_add_marketing_optout/migration.sql`
- Modify: `prisma/schema.prisma` (model Customer, ~línea 354)

- [ ] **Step 1: Escribir la migración SQL**

```sql
ALTER TABLE "Customer" ADD COLUMN "marketingOptOutAt" TIMESTAMP(3);
```

Guardala en `prisma/migrations/20260716120000_add_marketing_optout/migration.sql`.

- [ ] **Step 2: Agregar el campo al schema**

En `prisma/schema.prisma`, model `Customer`, después de la línea `referralToken    String?   @unique`:

```prisma
  // null = acepta campañas de marketing; timestamp = cuándo se dio de baja.
  marketingOptOutAt DateTime?
```

- [ ] **Step 3: Regenerar el cliente Prisma**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 4: Aplicar la migración a la DB de test local**

```bash
npx prisma db execute --file prisma/migrations/20260716120000_add_marketing_optout/migration.sql --url "postgresql://postgres:postgres@localhost:5433/agendita_test"
```

Verificar que la columna existe:

```bash
docker exec agendita-test-pg psql -U postgres -d agendita_test -c "\d \"Customer\"" | grep marketingOptOutAt
```

Expected: `marketingOptOutAt | timestamp(3) without time zone`

**NO apliques la migración a Supabase (prod) en este task** — eso pasa en el Task 9 (verificación final), con `migrate resolve --applied` después de `db execute`. NUNCA uses `migrate dev` ni `migrate diff` (DB compartida entre ramas).

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout add prisma/schema.prisma prisma/migrations/20260716120000_add_marketing_optout/migration.sql
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout commit -m "feat(optout): columna Customer.marketingOptOutAt

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Puerta 1 — segmentos excluyen opt-out

**Files:**
- Modify: `src/lib/campaigns/segments.ts`
- Test: `tests/integration/campaigns-segments.test.ts`

- [ ] **Step 1: Agregar el test de exclusión (failing)**

En `tests/integration/campaigns-segments.test.ts`:

1. Agregar la const junto a las demás (después de `CANCELLED_BAL_CUST`):

```ts
const OPTOUT_CUST = 'cseg-cust-optout'
```

2. En `beforeAll`, después del create de `CANCELLED_BAL_CUST`, crear la clienta opt-out que matchea TODOS los segmentos (cumple este mes, inactiva hace 100 días, con marketingOptOutAt seteado):

```ts
    await prisma.customer.create({
      data: {
        id: OPTOUT_CUST, businessId: BIZ, name: 'Opt Out', phone: '+56911220007',
        birthDate: birthDateThisMonth,
        lastCompletedAt: new Date(NOW.getTime() - 100 * DAY_MS),
        marketingOptOutAt: new Date(),
      },
    })
```

3. Después del for de bookings de `FREQUENT_CUST` (que usa `slot(0..2)`) y del booking de `BALANCE_CUST`, agregar bookings para `OPTOUT_CUST` con slots que NO colisionen con los existentes (revisar los índices ya usados en el archivo y usar índices posteriores, p.ej. `slot(10)`, `slot(11)`, `slot(12)` para 3 completadas y `slot(13)` para la confirmada con saldo):

```ts
    // OPTOUT_CUST también es "frecuente" (3 completadas) y tiene saldo pendiente,
    // para probar la exclusión en los 4 segmentos con una sola clienta.
    for (let i = 10; i < 13; i++) {
      await prisma.booking.create({
        data: {
          businessId: BIZ, serviceId: SVC, customerId: OPTOUT_CUST,
          ...slot(i),
          status: 'completed',
          totalPrice: 20000, depositRequired: 5000, depositPaid: 5000,
          remainingBalance: 0, discountAmount: 0, finalAmount: 20000,
          paymentStatus: 'fully_paid',
        },
      })
    }
    await prisma.booking.create({
      data: {
        businessId: BIZ, serviceId: SVC, customerId: OPTOUT_CUST,
        ...slot(13),
        status: 'confirmed',
        totalPrice: 20000, depositRequired: 5000, depositPaid: 5000,
        remainingBalance: 15000, discountAmount: 0, finalAmount: 20000,
        paymentStatus: 'deposit_paid',
      },
    })
```

**IMPORTANTE:** copiá los campos exactos de booking (`totalPrice`, `depositRequired`, etc.) de los bookings existentes en ese archivo — si el archivo difiere de lo de arriba, el archivo manda.

4. Agregar el test (al final del describe):

```ts
  it('excluye a las clientas con marketingOptOutAt en los 4 segmentos', async () => {
    for (const segment of ['birthday_month', 'inactive', 'frequent', 'pending_balance'] as const) {
      const result = await queryCampaignSegment(
        prisma, BIZ, segment, { inactiveDays: 60, frequentMin: 3 }, NOW, TZ,
      )
      expect(result.map((c) => c.id)).not.toContain(OPTOUT_CUST)
    }
  })
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- tests/integration/campaigns-segments.test.ts
```

Expected: FAIL — el nuevo test encuentra a `cseg-cust-optout` en los segmentos. Los tests preexistentes deben seguir verdes (si alguno assertea conteos exactos que ahora suben por la clienta nueva, ajustá el assert preexistente y anotalo en el commit).

- [ ] **Step 3: Implementar el filtro en segments.ts**

En `src/lib/campaigns/segments.ts`:

1. `birthday_month` — agregar `marketingOptOutAt: null` al where:

```ts
    const rows = await db.customer.findMany({ where: { businessId, birthDate: { not: null }, marketingOptOutAt: null }, select })
```

2. `inactive` — agregar `marketingOptOutAt: null` al where:

```ts
    return db.customer.findMany({
      where: { businessId, lastCompletedAt: { not: null, lte: cutoff }, marketingOptOutAt: null },
      select,
    })
```

3. `customersByIds` (cubre `frequent` y `pending_balance`) — agregar el filtro:

```ts
function customersByIds(db: Db, businessId: string, ids: string[]): Promise<SegmentCustomer[]> {
  if (ids.length === 0) return Promise.resolve([])
  return db.customer.findMany({ where: { id: { in: ids }, businessId, marketingOptOutAt: null }, select })
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Mismo comando del Step 2. Expected: PASS, todos los tests del archivo verdes.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout add src/lib/campaigns/segments.ts tests/integration/campaigns-segments.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout commit -m "feat(optout): puerta 1 — los segmentos de campaña excluyen clientas opt-out

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Puerta 2 — `sendCampaignMessage` bloquea opt-out

**Files:**
- Modify: `src/server/actions/campaigns.ts` (función `sendCampaignMessage`, ~líneas 127-192)
- Test: `tests/integration/campaigns-actions.test.ts`

- [ ] **Step 1: Agregar el test (failing)**

En `tests/integration/campaigns-actions.test.ts`, al final del describe (los tests corren secuencialmente en el archivo; usá una campaña y clienta propias para no interferir con los asserts existentes):

```ts
  it('sendCampaignMessage rechaza clientas opt-out sin mintear grant ni marcar sentAt', async () => {
    const { createCampaign, getCampaignDetail, sendCampaignMessage } = await importActions()
    // Campaña con las 2 clientas (aún sin opt-out, así CUST_B entra al segmento).
    const { campaignId } = await createCampaign({
      name: 'Optout Guard', segmentType: 'frequent', segmentParams: { frequentMin: 1 },
      messageTemplate: 'Hola {nombre} {codigo}', promotionId: PROMO,
    })
    // Opt-out DESPUÉS de materializar (caso retroactivo).
    await prisma.customer.update({ where: { id: CUST_B }, data: { marketingOptOutAt: new Date() } })

    const detail = await getCampaignDetail(campaignId)
    const recipientB = detail.recipients.find((r) => r.customerId === CUST_B)!

    await expect(sendCampaignMessage(recipientB.id)).rejects.toThrow(/no recibir campañas/)

    // No minteó grant ni marcó sentAt.
    const after = await prisma.campaignRecipient.findUnique({ where: { id: recipientB.id } })
    expect(after?.grantId).toBeNull()
    expect(after?.sentAt).toBeNull()
    const grants = await prisma.promotionGrant.count({
      where: { customerId: CUST_B, requestId: `campaign:${campaignId}#${CUST_B}` },
    })
    expect(grants).toBe(0)

    // Cleanup del flag para no contaminar otros tests del archivo.
    await prisma.customer.update({ where: { id: CUST_B }, data: { marketingOptOutAt: null } })
  })
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- tests/integration/campaigns-actions.test.ts
```

Expected: FAIL — `sendCampaignMessage` no lanza (hoy envía igual).

- [ ] **Step 3: Implementar el guard**

En `src/server/actions/campaigns.ts`, función `sendCampaignMessage`:

1. Agregar `marketingOptOutAt: true` al select del customer dentro del `findFirst` del recipient:

```ts
        customer: { select: { id: true, name: true, phone: true, marketingOptOutAt: true } },
```

2. Inmediatamente después de `if (!recipient) throw new ForbiddenError('Destinataria no encontrada')`:

```ts
  // Puerta 2 (retroactiva): la clienta pudo hacer opt-out DESPUÉS de que la
  // campaña materializó su lista. Bloquear antes de mintear: sin grant, sin sentAt.
  if (recipient.customer.marketingOptOutAt) {
    throw new Error('La clienta pidió no recibir campañas')
  }
```

- [ ] **Step 4: Correr y verificar que pasa**

Mismo comando del Step 2. Expected: PASS completo.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout add src/server/actions/campaigns.ts tests/integration/campaigns-actions.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout commit -m "feat(optout): puerta 2 — sendCampaignMessage bloquea opt-out antes de mintear

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Puerta 3 — cron loyalty omite email a opt-out (el grant se emite igual)

**Files:**
- Modify: `src/lib/cron/loyalty-automatic.ts`
- Test: `tests/unit/loyalty-automatic-cron.test.ts`

- [ ] **Step 1: Escribir el test del predicado (failing)**

En `tests/unit/loyalty-automatic-cron.test.ts`, agregar el import y un describe nuevo:

```ts
import { selectTimedRuleForCustomer, wantsRewardEmail } from '@/lib/cron/loyalty-automatic'
```

```ts
describe('wantsRewardEmail', () => {
  it('birthday y winback mandan email si NO hay opt-out', () => {
    expect(wantsRewardEmail('birthday', { marketingOptOutAt: null })).toBe(true)
    expect(wantsRewardEmail('winback', { marketingOptOutAt: null })).toBe(true)
  })
  it('anniversary queda mudo siempre', () => {
    expect(wantsRewardEmail('anniversary', { marketingOptOutAt: null })).toBe(false)
  })
  it('opt-out silencia birthday y winback (el grant se emite igual, esto sólo decide el email)', () => {
    const optedOut = { marketingOptOutAt: new Date() }
    expect(wantsRewardEmail('birthday', optedOut)).toBe(false)
    expect(wantsRewardEmail('winback', optedOut)).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- tests/unit/loyalty-automatic-cron.test.ts`
Expected: FAIL — `wantsRewardEmail` no existe.

- [ ] **Step 3: Implementar**

En `src/lib/cron/loyalty-automatic.ts`:

1. Agregar `marketingOptOutAt` al type `Candidate`:

```ts
type Candidate = {
  id: string; birthDate: Date | null; firstCompletedAt: Date | null; lastCompletedAt: Date | null
  name: string; email: string | null; loyaltyToken: string | null; marketingOptOutAt: Date | null
}
```

2. Exportar el predicado (después de `selectTimedRuleForCustomer`):

```ts
/** ¿Corresponde email promocional de recompensa? Sólo birthday/winback (anniversary
 *  queda mudo) y sólo si la clienta no hizo opt-out de marketing. El GRANT se emite
 *  igual en ambos casos — el opt-out silencia la comunicación, no el beneficio. */
export function wantsRewardEmail(kind: string | null, customer: { marketingOptOutAt: Date | null }): boolean {
  return (kind === 'birthday' || kind === 'winback') && !customer.marketingOptOutAt
}
```

3. Agregar `marketingOptOutAt: true` al select de candidatas (el `prisma.customer.findMany` dentro de `runAutomaticLoyalty`):

```ts
      select: { id: true, birthDate: true, firstCompletedAt: true, lastCompletedAt: true,
        name: true, email: true, loyaltyToken: true, marketingOptOutAt: true },
```

4. Reemplazar el guard inline del email. Donde hoy dice:

```ts
          const kind = conditionKind(rule.conditions)
          if (kind === 'birthday' || kind === 'winback') {
```

pasa a:

```ts
          const kind = conditionKind(rule.conditions)
          if (wantsRewardEmail(kind, c)) {
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- tests/unit/loyalty-automatic-cron.test.ts`
Expected: PASS (los 2 tests preexistentes + 3 nuevos).

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout add src/lib/cron/loyalty-automatic.ts tests/unit/loyalty-automatic-cron.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout commit -m "feat(optout): puerta 3 — el cron emite el grant pero omite el email a opt-out

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Core `setMarketingOptOut` + las 3 server actions + rate bucket

**Files:**
- Create: `src/lib/campaigns/optout.ts`
- Create: `src/server/actions/marketing-optout.ts`
- Modify: `src/server/actions/customers.ts` (agregar action de dueña al final, después de `updateCustomerNotes`)
- Modify: `src/lib/rate-limit.ts` (RATE_LIMITS, ~línea 50)
- Test: `tests/integration/marketing-optout.test.ts` (nuevo)

- [ ] **Step 1: Escribir los tests de integración (failing)**

Crear `tests/integration/marketing-optout.test.ts`. Mismo approach de mocks que `campaigns-actions.test.ts` (auth + revalidate mockeados, lógica real contra Postgres). La action por sesión necesita mockear también `requireUser`:

```ts
import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

const BIZ = 'mopt-biz-1'
const USER = 'mopt-owner-1'
const CLIENTA_USER = 'mopt-user-clienta'
const authCtx = () => ({
  businessId: BIZ,
  user: { id: USER },
  business: { id: BIZ, name: 'MOpt Biz', timezone: 'America/Santiago' },
  role: 'owner',
})
vi.mock('@/lib/auth/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/server')>()
  return {
    ...actual,
    requireBusiness: async () => authCtx(),
    requireBusinessRole: async () => authCtx(),
    requireUser: async () => ({ id: CLIENTA_USER }),
  }
})
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const CUST = 'mopt-cust-1'
const CUST_LINKED = 'mopt-cust-linked'
const CUST_AJENA = 'mopt-cust-ajena'
const BIZ2 = 'mopt-biz-2'
const USER2 = 'mopt-owner-2'
const TOKEN = 'mopt-token-0000-0000'

describe('marketing opt-out actions', () => {
  let prisma: PrismaClient

  async function cleanup(db: PrismaClient) {
    await db.customer.deleteMany({ where: { businessId: { in: [BIZ, BIZ2] } } })
    await db.businessUser.deleteMany({ where: { businessId: { in: [BIZ, BIZ2] } } })
    await db.business.deleteMany({ where: { id: { in: [BIZ, BIZ2] } } })
    await db.user.deleteMany({ where: { id: { in: [USER, USER2, CLIENTA_USER] } } })
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await cleanup(prisma)
    await prisma.user.create({ data: { id: USER, email: 'owner@mopt.test', name: 'MOpt Owner' } })
    await prisma.user.create({ data: { id: USER2, email: 'owner2@mopt.test', name: 'MOpt Owner 2' } })
    await prisma.user.create({ data: { id: CLIENTA_USER, email: 'clienta@mopt.test', name: 'MOpt Clienta' } })
    await prisma.business.create({
      data: { id: BIZ, name: 'MOpt Biz', slug: 'mopt-biz', subdomain: 'moptbiz', ownerUserId: USER,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90 },
    })
    await prisma.business.create({
      data: { id: BIZ2, name: 'MOpt Biz 2', slug: 'mopt-biz-2', subdomain: 'moptbiz2', ownerUserId: USER2,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90 },
    })
    await prisma.businessUser.create({ data: { id: 'mopt-bu-1', businessId: BIZ, userId: USER, role: 'owner' } })
    await prisma.businessUser.create({ data: { id: 'mopt-bu-2', businessId: BIZ2, userId: USER2, role: 'owner' } })
    await prisma.customer.create({
      data: { id: CUST, businessId: BIZ, name: 'Con Token', phone: '+56911550001', loyaltyToken: TOKEN },
    })
    await prisma.customer.create({
      data: { id: CUST_LINKED, businessId: BIZ, name: 'Vinculada', phone: '+56911550002', userId: CLIENTA_USER },
    })
    await prisma.customer.create({
      data: { id: CUST_AJENA, businessId: BIZ2, name: 'De Otro Negocio', phone: '+56911550003' },
    })
  })

  afterAll(async () => {
    await cleanup(prisma)
    await prisma.$disconnect()
  })

  it('setCustomerMarketingOptOut marca y desmarca (dueña)', async () => {
    const { setCustomerMarketingOptOut } = await import('@/server/actions/customers')
    await setCustomerMarketingOptOut(CUST, true)
    let c = await prisma.customer.findUnique({ where: { id: CUST } })
    expect(c?.marketingOptOutAt).toBeInstanceOf(Date)
    await setCustomerMarketingOptOut(CUST, false)
    c = await prisma.customer.findUnique({ where: { id: CUST } })
    expect(c?.marketingOptOutAt).toBeNull()
  })

  it('setCustomerMarketingOptOut rechaza clientas de otro negocio', async () => {
    const { setCustomerMarketingOptOut } = await import('@/server/actions/customers')
    await expect(setCustomerMarketingOptOut(CUST_AJENA, true)).rejects.toThrow()
    const c = await prisma.customer.findUnique({ where: { id: CUST_AJENA } })
    expect(c?.marketingOptOutAt).toBeNull()
  })

  it('setMarketingOptOutByToken marca y desmarca; token inválido falla', async () => {
    const { setMarketingOptOutByToken } = await import('@/server/actions/marketing-optout')
    await setMarketingOptOutByToken(TOKEN, true)
    let c = await prisma.customer.findUnique({ where: { id: CUST } })
    expect(c?.marketingOptOutAt).toBeInstanceOf(Date)
    await setMarketingOptOutByToken(TOKEN, false)
    c = await prisma.customer.findUnique({ where: { id: CUST } })
    expect(c?.marketingOptOutAt).toBeNull()
    await expect(setMarketingOptOutByToken('token-que-no-existe', true)).rejects.toThrow()
  })

  it('setMarketingOptOutAsMe exige que el Customer pertenezca a la sesión', async () => {
    const { setMarketingOptOutAsMe } = await import('@/server/actions/marketing-optout')
    await setMarketingOptOutAsMe(CUST_LINKED, true)
    const c = await prisma.customer.findUnique({ where: { id: CUST_LINKED } })
    expect(c?.marketingOptOutAt).toBeInstanceOf(Date)
    // CUST no está vinculado a CLIENTA_USER → Forbidden.
    await expect(setMarketingOptOutAsMe(CUST, true)).rejects.toThrow()
  })
})
```

**Nota:** el mock de `@/lib/auth/server` usa `importOriginal` para conservar `ForbiddenError`/`AuthError` reales (las actions hacen `instanceof`). Si `requireUser` vive en otro módulo, ajustá el mock al módulo real (verificá con `grep -n "export async function requireUser" src/lib/auth/server.ts` — hoy está en la línea 18 de ese archivo).

- [ ] **Step 2: Correr y verificar que falla**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration -- tests/integration/marketing-optout.test.ts
```

Expected: FAIL — los módulos/actions no existen.

- [ ] **Step 3: Implementar core + actions**

1. Crear `src/lib/campaigns/optout.ts`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/** Core del opt-out de marketing: null = acepta campañas. Los callers (dueña por
 *  rol, clienta por token o sesión) resuelven autorización ANTES de llamar acá. */
export function setMarketingOptOut(db: Db, customerId: string, optedOut: boolean) {
  return db.customer.update({
    where: { id: customerId },
    data: { marketingOptOutAt: optedOut ? new Date() : null },
  })
}
```

2. En `src/lib/rate-limit.ts`, agregar a `RATE_LIMITS` (después de `'send-campaign'`):

```ts
  'optout-public': { maxRequests: 10, windowMs: 60_000 },
```

3. En `src/server/actions/customers.ts`, agregar al final (después de `updateCustomerNotes`; importar `setMarketingOptOut` desde `@/lib/campaigns/optout`):

```ts
export async function setCustomerMarketingOptOut(customerId: string, optedOut: boolean) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('update-customer', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }
  if (typeof optedOut !== 'boolean') throw new Error('Datos invalidos')

  const existing = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    select: { id: true },
  })
  if (!existing) {
    throw new ForbiddenError('Cliente no encontrado')
  }

  await setMarketingOptOut(prisma, customerId, optedOut)

  revalidatePath('/dashboard/customers')
  revalidatePath(`/dashboard/customers/${customerId}`)
}
```

4. Crear `src/server/actions/marketing-optout.ts` (módulo `'use server'` nuevo — SOLO funciones async exportadas):

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireUser, ForbiddenError } from '@/lib/auth/server'
import { resolveLoyaltyCustomer } from '@/lib/loyalty/token'
import { setMarketingOptOut } from '@/lib/campaigns/optout'

/** Baja/re-alta autogestionada desde la tarjeta pública. El token es la credencial
 *  (misma confianza que ver puntos / canjear). Esta MISMA action es la que reusará
 *  el link de unsubscribe de C-email — no crear una segunda mecánica de baja. */
export async function setMarketingOptOutByToken(token: string, optedOut: boolean) {
  if (typeof optedOut !== 'boolean') throw new Error('Datos inválidos')
  const customer = await resolveLoyaltyCustomer(prisma, token)
  if (!customer) throw new ForbiddenError('Tarjeta no disponible')
  const limit = await checkRateLimit('optout-public', 10, 60000, { businessId: customer.businessId, userId: customer.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  await setMarketingOptOut(prisma, customer.id, optedOut)
  await revalidatePath(`/tarjeta/${token}`)
}

/** Baja/re-alta autogestionada desde /mi (sesión). Ownership: el Customer debe
 *  estar vinculado a esta cuenta (patrón redeemPointsAsMe). */
export async function setMarketingOptOutAsMe(customerId: string, optedOut: boolean) {
  if (typeof optedOut !== 'boolean') throw new Error('Datos inválidos')
  const user = await requireUser()
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, userId: user.id },
    select: { id: true, businessId: true, loyaltyToken: true, business: { select: { slug: true } } },
  })
  if (!customer) throw new ForbiddenError('No encontrada')
  // Mismo bucket que la vía por token (keyed por customer.id): alternar superficies
  // no debe duplicar el cupo.
  const limit = await checkRateLimit('optout-public', 10, 60000, { businessId: customer.businessId, userId: customer.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  await setMarketingOptOut(prisma, customer.id, optedOut)
  await revalidatePath(`/mi/${customer.business.slug}`)
  if (customer.loyaltyToken) {
    await revalidatePath(`/tarjeta/${customer.loyaltyToken}`)
  }
}
```

**Verificá el shape real de `resolveLoyaltyCustomer`** (`src/lib/loyalty/token.ts:43`): devuelve `{ id, businessId, ... }` — suficiente. Y verificá cómo exporta `requireUser` el módulo `@/lib/auth/server` antes de importarlo.

- [ ] **Step 4: Correr y verificar que pasa**

Mismo comando del Step 2. Expected: PASS (4 tests).

- [ ] **Step 5: Type-check y commit**

```bash
npx tsc --noEmit 2>&1 | grep '^src/'
```
Expected: sin output (0 errores en src/).

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout add src/lib/campaigns/optout.ts src/server/actions/marketing-optout.ts src/server/actions/customers.ts src/lib/rate-limit.ts tests/integration/marketing-optout.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout commit -m "feat(optout): core setMarketingOptOut + actions dueña/token/sesión + rate bucket

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Dashboard — toggle en ficha + badge en lista

**Files:**
- Create: `src/app/dashboard/customers/[id]/marketing-optout-toggle.tsx`
- Modify: `src/server/actions/customers.ts` (`CustomerListItem` + `getCustomers` + `CustomerDetail`)
- Modify: `src/app/dashboard/customers/[id]/page.tsx` (~línea 196, debajo de `CustomerEditForm`)
- Modify: `src/app/dashboard/customers/customer-list.tsx` (fila desktop ~línea 288 y card mobile)
- Test: `tests/unit/marketing-optout-toggle.test.tsx` (nuevo)

- [ ] **Step 1: Escribir el test del toggle (failing)**

Crear `tests/unit/marketing-optout-toggle.test.tsx` (patrón render de `recipient-list.test.tsx`; mock de `next/navigation` — landmine conocida — y de la action):

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/server/actions/customers', () => ({ setCustomerMarketingOptOut: vi.fn() }))

import { MarketingOptOutToggle } from '@/app/dashboard/customers/[id]/marketing-optout-toggle'

describe('MarketingOptOutToggle', () => {
  it('cuando acepta campañas: switch prendido, sin fecha de baja', () => {
    const html = renderToStaticMarkup(
      <MarketingOptOutToggle customerId="c1" marketingOptOutAt={null} />,
    )
    expect(html).toContain('Acepta campañas')
    expect(html).toContain('data-state="checked"')
    expect(html).not.toContain('Se dio de baja')
  })

  it('cuando está opt-out: switch apagado + fecha de baja', () => {
    const html = renderToStaticMarkup(
      <MarketingOptOutToggle customerId="c1" marketingOptOutAt={new Date('2026-07-16T12:00:00Z')} />,
    )
    expect(html).toContain('data-state="unchecked"')
    expect(html).toContain('Se dio de baja')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- tests/unit/marketing-optout-toggle.test.tsx`
Expected: FAIL — el componente no existe.

- [ ] **Step 3: Implementar el toggle**

Crear `src/app/dashboard/customers/[id]/marketing-optout-toggle.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Switch } from '@/components/ui/switch'
import { setCustomerMarketingOptOut } from '@/server/actions/customers'

/** Toggle "Acepta campañas" de la ficha. checked = acepta (flag null);
 *  apagarlo = opt-out. La fecha de baja se muestra como mini-auditoría. */
export function MarketingOptOutToggle({
  customerId,
  marketingOptOutAt,
}: {
  customerId: string
  marketingOptOutAt: Date | null
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(accepts: boolean) {
    setPending(true)
    setError(null)
    try {
      await setCustomerMarketingOptOut(customerId, !accepts)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-4 border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-primary">Acepta campañas</p>
          <p className="text-xs text-muted-foreground">
            Promociones por WhatsApp y email. No afecta confirmaciones ni recordatorios.
          </p>
        </div>
        <Switch
          checked={marketingOptOutAt === null}
          onCheckedChange={handleChange}
          disabled={pending}
          aria-label="Acepta campañas"
        />
      </div>
      {marketingOptOutAt && (
        <p className="mt-2 text-xs text-muted-foreground">
          Se dio de baja el {new Date(marketingOptOutAt).toLocaleDateString('es-CL')}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- tests/unit/marketing-optout-toggle.test.tsx`
Expected: PASS.

- [ ] **Step 5: Exponer el dato y cablear la UI**

1. En `src/server/actions/customers.ts`:
   - `CustomerListItem`: agregar `marketingOptOut: boolean` (después de `birthDate`).
   - `getCustomers`: agregar `marketingOptOutAt: true` al select y `marketingOptOut: c.marketingOptOutAt != null` al objeto que arma `merged`.
   - `CustomerDetail`: agregar `marketingOptOutAt: Date | null` (después de `birthDate`). `getCustomerDetail` usa `findFirst` sin select (trae el row entero), así que solo hay que sumar el campo al objeto de retorno si el return es explícito — revisá el final de la función: si construye el objeto a mano, agregá `marketingOptOutAt: customer.marketingOptOutAt`.

2. En `src/app/dashboard/customers/[id]/page.tsx`, debajo de `<CustomerEditForm customer={customer} />` (dentro de la card "Datos de contacto"):

```tsx
              <MarketingOptOutToggle
                customerId={customer.id}
                marketingOptOutAt={customer.marketingOptOutAt}
              />
```

con su import:

```tsx
import { MarketingOptOutToggle } from './marketing-optout-toggle'
```

3. En `src/app/dashboard/customers/customer-list.tsx`, fila desktop — reemplazar la celda del nombre:

```tsx
                    <TruncatedCell
                      className="font-semibold text-primary"
                      primary={customer.name}
                      secondary={
                        customer.marketingOptOut ? (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            No campañas
                          </Badge>
                        ) : undefined
                      }
                    />
```

   (Si `TruncatedCell` no acepta ReactNode en `secondary`, poné el badge dentro de `primary` como `<span className="flex items-center gap-2">{customer.name}<Badge …>No campañas</Badge></span>` — mirá cómo lo hace la celda de Contacto en el mismo archivo, que ya pasa JSX en `primary`/`secondary`.)

   En la card mobile del mismo archivo (buscá `TableMobileCard`), agregar a `rows` (solo si opt-out):

```tsx
                ...(customer.marketingOptOut ? [{ label: 'Campañas', value: 'No contactar' }] : []),
```

- [ ] **Step 6: Verificar suite + tsc**

```bash
npm test -- tests/unit/marketing-optout-toggle.test.tsx
npx tsc --noEmit 2>&1 | grep '^src/'
```
Expected: PASS y sin errores de tipos.

- [ ] **Step 7: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout add src/app/dashboard/customers/[id]/marketing-optout-toggle.tsx src/app/dashboard/customers/[id]/page.tsx src/app/dashboard/customers/customer-list.tsx src/server/actions/customers.ts tests/unit/marketing-optout-toggle.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout commit -m "feat(optout): toggle en ficha de clienta + badge 'No campañas' en la lista

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Detalle de campaña — filas "No contactar" + métrica

**Files:**
- Modify: `src/server/actions/campaigns.ts` (`getCampaignDetail`, ~línea 117)
- Modify: `src/app/dashboard/campanas/[id]/page.tsx` (métricas + serialización, ~líneas 64-101)
- Modify: `src/app/dashboard/campanas/[id]/recipient-list.tsx`
- Test: `tests/unit/recipient-list.test.tsx`

- [ ] **Step 1: Agregar tests (failing)**

En `tests/unit/recipient-list.test.tsx`, agregar tests al describe existente (adaptá helpers de render del archivo — usa el patrón del propio archivo; los recipients de los tests existentes necesitan `optedOut: false` agregado a sus fixtures):

```tsx
  it('muestra "No contactar" sin botón de envío para clientas opt-out', () => {
    const html = render([
      { id: 'r1', name: 'Ana', phone: '+56911110001', sentAt: null, grantStatus: null, optedOut: true },
    ])
    expect(html).toContain('No contactar')
    expect(html).not.toContain('Enviar por WhatsApp')
  })

  it('métrica "No contactar" visible cuando llega en metrics', () => {
    const html = render(
      [{ id: 'r1', name: 'Ana', phone: '+56911110001', sentAt: null, grantStatus: null, optedOut: true }],
      { enviadas: 0, canjearon: 0, vigentes: 0, noContactar: 1 },
    )
    expect(html).toContain('No contactar')
  })
```

**Nota:** `render` de arriba es ilustrativo — el archivo existente tiene su propia forma de renderizar (`renderToStaticMarkup` + props). Reusala; lo importante son los asserts.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- tests/unit/recipient-list.test.tsx`
Expected: FAIL — `optedOut`/`noContactar` no existen en los tipos.

- [ ] **Step 3: Implementar**

1. `src/server/actions/campaigns.ts`, `getCampaignDetail` — agregar `marketingOptOutAt` al select del customer del recipient:

```ts
          customer: { select: { name: true, phone: true, marketingOptOutAt: true } },
```

2. `src/app/dashboard/campanas/[id]/page.tsx`:

```ts
  const noContactar = campaign.recipients.filter((r) => r.customer.marketingOptOutAt != null).length
```

y en la serialización:

```ts
  const recipients = campaign.recipients.map((r) => ({
    id: r.id,
    name: r.customer.name,
    phone: r.customer.phone,
    sentAt: r.sentAt,
    grantStatus: r.grant?.status ?? null,
    optedOut: r.customer.marketingOptOutAt != null,
  }))
```

y pasar la métrica:

```tsx
        <RecipientList
          recipients={recipients}
          metrics={{ enviadas, canjearon, vigentes, noContactar }}
        />
```

3. `src/app/dashboard/campanas/[id]/recipient-list.tsx`:

   - `RecipientItem`: agregar `optedOut: boolean`.
   - `RecipientMetrics`: agregar `noContactar: number`.
   - En `sendButton(r)` — cortocircuito arriba de todo:

```tsx
  function sendButton(r: RecipientItem) {
    if (r.optedOut) {
      return <span className="text-sm text-muted-foreground">No contactar</span>
    }
    // ... resto igual
```

   - En la grilla de métricas, cambiar `lg:grid-cols-4` por `lg:grid-cols-5` y agregar la card (después de "Vigentes"):

```tsx
        <div className="studio-card p-4">
          <p className="studio-eyebrow">No contactar</p>
          <p className="mt-1 text-2xl font-semibold text-muted-foreground">{metrics.noContactar}</p>
        </div>
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- tests/unit/recipient-list.test.tsx`
Expected: PASS (tests preexistentes con `optedOut: false` en fixtures + los 2 nuevos).

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout add src/server/actions/campaigns.ts "src/app/dashboard/campanas/[id]/page.tsx" "src/app/dashboard/campanas/[id]/recipient-list.tsx" tests/unit/recipient-list.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout commit -m "feat(optout): detalle de campaña — filas y métrica 'No contactar'

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Autogestión — sección en `/tarjeta/[token]` y `/mi/[slug]`

**Files:**
- Create: `src/components/loyalty/marketing-optout-section.tsx`
- Modify: `src/lib/loyalty/token.ts` (`resolveLoyaltyCustomer` select, ~línea 47)
- Modify: `src/app/tarjeta/[token]/page.tsx`
- Modify: `src/app/mi/[slug]/page.tsx`
- Test: `tests/unit/marketing-optout-section.test.tsx` (nuevo)

- [ ] **Step 1: Test del componente (failing)**

Crear `tests/unit/marketing-optout-section.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { MarketingOptOutSection } from '@/components/loyalty/marketing-optout-section'

const noop = vi.fn(async () => {})

describe('MarketingOptOutSection', () => {
  it('cuando acepta: link discreto de baja con el nombre del negocio', () => {
    const html = renderToStaticMarkup(
      <MarketingOptOutSection businessName="Studio Andrea" optedOut={false} action={noop} />,
    )
    expect(html).toContain('No quiero recibir promociones de Studio Andrea')
    expect(html).not.toContain('Volver a recibirlas')
  })

  it('cuando está opt-out: estado + botón de re-alta', () => {
    const html = renderToStaticMarkup(
      <MarketingOptOutSection businessName="Studio Andrea" optedOut={true} action={noop} />,
    )
    expect(html).toContain('No recibirás promociones de Studio Andrea')
    expect(html).toContain('Volver a recibirlas')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- tests/unit/marketing-optout-section.test.tsx`
Expected: FAIL — el componente no existe.

- [ ] **Step 3: Implementar el componente compartido**

Crear `src/components/loyalty/marketing-optout-section.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'

/** Baja/re-alta de promociones al pie de la tarjeta y de /mi. `action` viene
 *  bindeada del server component (token o customerId van server-side, nunca
 *  en el body del form — mismo criterio que redeemAction en /tarjeta). */
export function MarketingOptOutSection({
  businessName,
  optedOut,
  action,
}: {
  businessName: string
  optedOut: boolean
  action: (optedOut: boolean) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit(next: boolean) {
    setError(null)
    startTransition(async () => {
      try {
        await action(next)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo guardar')
      }
    })
  }

  return (
    <div className="mt-8 text-center text-sm text-muted-foreground">
      {optedOut ? (
        <>
          <p>No recibirás promociones de {businessName}.</p>
          <button
            type="button"
            className="mt-1 font-semibold text-pink-700 hover:underline disabled:opacity-50"
            onClick={() => submit(false)}
            disabled={isPending}
          >
            Volver a recibirlas
          </button>
        </>
      ) : (
        <button
          type="button"
          className="hover:underline disabled:opacity-50"
          onClick={() => submit(true)}
          disabled={isPending}
        >
          No quiero recibir promociones de {businessName}
        </button>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- tests/unit/marketing-optout-section.test.tsx`
Expected: PASS.

- [ ] **Step 5: Cablear `/tarjeta/[token]`**

1. En `src/lib/loyalty/token.ts`, `resolveLoyaltyCustomer` — agregar `marketingOptOutAt: true` al select (junto a `userId: true`).

2. En `src/app/tarjeta/[token]/page.tsx`:

```tsx
import { setMarketingOptOutByToken } from '@/server/actions/marketing-optout'
import { MarketingOptOutSection } from '@/components/loyalty/marketing-optout-section'
```

Debajo de `redeemAction` (mismo patrón de bind server-side):

```tsx
async function optOutAction(token: string, optedOut: boolean) {
  'use server'
  await setMarketingOptOutByToken(token, optedOut)
}
```

En el JSX, después del bloque `{!customer.userId && (...)}`:

```tsx
      <MarketingOptOutSection
        businessName={customer.business.name}
        optedOut={customer.marketingOptOutAt != null}
        action={optOutAction.bind(null, token)}
      />
```

- [ ] **Step 6: Cablear `/mi/[slug]`**

En `src/app/mi/[slug]/page.tsx`:

1. Agregar `marketingOptOutAt: true` al select del `prisma.customer.findMany` (el que arma `customers`).

2. Imports:

```tsx
import { setMarketingOptOutAsMe } from '@/server/actions/marketing-optout'
import { MarketingOptOutSection } from '@/components/loyalty/marketing-optout-section'
```

3. Action bindeada (fuera del componente, junto a `redeemAction`):

```tsx
async function optOutAsMeAction(customerId: string, optedOut: boolean) {
  'use server'
  await setMarketingOptOutAsMe(customerId, optedOut)
}
```

4. En el JSX, al final del `<main>` (antes del cierre), una sección por Customer vinculada (normalmente es una):

```tsx
      {customers.map((c) => (
        <MarketingOptOutSection
          key={c.id}
          businessName={business.name}
          optedOut={c.marketingOptOutAt != null}
          action={optOutAsMeAction.bind(null, c.id)}
        />
      ))}
```

- [ ] **Step 7: Verificación del task**

```bash
npm test -- tests/unit/marketing-optout-section.test.tsx
npx tsc --noEmit 2>&1 | grep '^src/'
```
Expected: PASS y sin errores en src/.

- [ ] **Step 8: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout add src/components/loyalty/marketing-optout-section.tsx src/lib/loyalty/token.ts "src/app/tarjeta/[token]/page.tsx" "src/app/mi/[slug]/page.tsx" tests/unit/marketing-optout-section.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout commit -m "feat(optout): autogestión de baja/re-alta en /tarjeta y /mi

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Verificación final + migración a prod + PR

**Files:** ninguno nuevo (verificación + operaciones).

- [ ] **Step 1: Suite completa**

```bash
npm test
```
Expected: todo verde (≥1606 tests + los nuevos).

- [ ] **Step 2: Integración completa**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration
```
Expected: todo verde (≥153 + los nuevos).

- [ ] **Step 3: tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep '^src/'
npm run lint
```
Expected: sin errores en src/; lint 0 errors (warnings preexistentes OK).

- [ ] **Step 4: Build**

```bash
set -a; source /Users/robertozamorautrera/Projects/agendita/.env.local; set +a
npm run build
```
Expected: build OK (sin el source de .env.local falla por env vars).

- [ ] **Step 5: Migración a Supabase (prod) — ritual completo**

**ANTES de aplicar:** verificar que la columna NO existe ya en prod (landmine: verificar columnas reales antes de `migrate resolve --applied`):

```bash
set -a; source /Users/robertozamorautrera/Projects/agendita/.env.local; set +a
npx prisma db execute --url "$DIRECT_URL" --stdin <<'SQL'
SELECT column_name FROM information_schema.columns WHERE table_name = 'Customer' AND column_name = 'marketingOptOutAt';
SQL
```

Aplicar y resolver:

```bash
npx prisma db execute --file prisma/migrations/20260716120000_add_marketing_optout/migration.sql --url "$DIRECT_URL"
npx prisma migrate resolve --applied 20260716120000_add_marketing_optout
```

Expected: `Migration 20260716120000_add_marketing_optout marked as applied.` (sin esto, el `migrate deploy` del deploy de Vercel rompe).

- [ ] **Step 6: Push + PR**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/campaign-optout push -u origin claude/campaign-optout
gh pr create --title "feat: opt-out de campañas (flag único + 3 puertas + autogestión)" --body "..."
```

El body del PR debe cubrir: spec/plan, las 3 puertas, la decisión grant-sí/email-no del cron, superficies UI, y la nota de que la migración ya está aplicada+resuelta en Supabase.

**NO mergear:** el squash-merge requiere OK explícito del usuario.

---

## Notas para el orquestador

- Orden: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Los tasks 2-5 tocan integración (DB de test): **de a uno**. Los tasks 6-8 son paralelizables entre sí en teoría, pero tocan `customers.ts`/`campaigns.ts` que también tocan 5 y 7 — mantener secuencial es más barato que resolver conflictos.
- Después del Task 9 corre `/simplify` (4 ángulos) antes del PR, como en C1.
- Reviews por task: spec-compliance primero, calidad después (subagent-driven-development).
