# C1 — Campañas (blast WhatsApp + promo real) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La dueña elige un segmento de clientas y les envía una promo real (un `PromotionGrant` propio) por WhatsApp de un toque, con persistencia de campaña + destinatarios y captura opcional de cumpleaños.

**Architecture:** Segmento → materializa `CampaignRecipient` (snapshot) → por fila la dueña toca "Enviar", que mintea un grant gratis perezosamente (tx chica, idempotente por `requestId`), compone el mensaje con placeholders y abre `wa.me`. Grants independientes del programa de puntos. Réplica del patrón `review-link-button` (open-window sync anti-bloqueador).

**Tech Stack:** Next.js (fork), Prisma+Postgres, Zod, vitest (`--run`), `renderToStaticMarkup` component tests.

**Spec:** `docs/superpowers/specs/2026-07-12-campaigns-C1-design.md`

---

## Convenciones de este repo (leer antes de empezar)

- **Landmine use-server:** los módulos `'use server'` exportan SOLO funciones async. Consts/schemas/tipos van en `src/lib/campaigns/*` (plano) e importados por el action file.
- **tsc no lo corre vitest/lint:** antes de push correr `npx tsc --noEmit 2>&1 | grep '^src/'` (debe salir vacío).
- **DB de test:** Postgres local en Docker, puerto 5433. Integración:
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration`
- **Migración a DB compartida:** escribir el `.sql` a mano (NO `migrate dev`/`migrate diff` — arrastra ramas hermanas, landmine `migrate-diff-picks-up-sibling-branches`), aplicar con `db execute` + `migrate resolve --applied` (landmine `migrate-via-db-execute-needs-resolve`); cargar env con `set -a; source /Users/robertozamorautrera/Projects/agendita/.env.local; set +a`. **Antes de `migrate resolve --applied`, verificar que las columnas/tablas nuevas se crearon de verdad** (landmine reciente: no marcar a ciegas).
- **git en el worktree:** usar `git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/keen-wright-cd2fef` + `git add` de rutas explícitas (nunca `-A`).
- **Component tests:** `renderToStaticMarkup` + `vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn(), notFound: vi.fn() }))`.

## File Structure

**Nuevos:**
- `prisma/migrations/20260712140000_add_campaigns/migration.sql` — tablas `Campaign`, `CampaignRecipient`, enum `CampaignSegment`.
- `src/lib/campaigns/schema.ts` — Zod + consts + tipos (plano).
- `src/lib/campaigns/message.ts` — `renderCampaignMessage` + defaults por segmento (puro).
- `src/lib/campaigns/segments.ts` — 4 queries de segmento (tx/db-aware).
- `src/lib/campaigns/mint.ts` — `mintCampaignGrant` (mint gratis idempotente).
- `src/server/actions/campaigns.ts` — actions `'use server'`.
- `src/components/dashboard/reward-fields.tsx` — bloque de recompensa controlado, reusable.
- `src/app/dashboard/campanas/page.tsx` + `campaign-list.tsx` + `new-campaign-dialog.tsx` — lista + creación.
- `src/app/dashboard/campanas/[id]/page.tsx` + `recipient-list.tsx` — detalle + envío.

**Modificados:** `prisma/schema.prisma` (2 modelos + enum + relaciones inversas), `src/lib/rate-limit.ts` (2 buckets), `src/components/dashboard/sidebar.tsx` (nav), `src/lib/customers/find-or-create.ts` (+birthDate), `src/components/booking/step-customer.tsx` + `wizard.tsx` (+campo cumpleaños), `src/app/dashboard/bookings/new/new-booking-form.tsx` (+campo), `src/server/actions/bookings.ts` (thread birthDate en 2 call-sites).

> Nota de ruta: uso `dashboard/campanas` (sin ñ) para evitar problemas de encoding en rutas; el label visible es "Campañas".

> **Deviation anotada (RewardFields):** el spec propone reusar `<RewardFields>` en los 3 editores. Los dos existentes usan paradigmas incompatibles (`promotion-form.tsx` controlado vs `redemption-catalog.tsx` uncontrolled `FormData`). Para no meter churn riesgoso fuera de alcance, C1 crea `<RewardFields>` (controlado) y lo usa SOLO en el form inline de campaña. Adoptarlo en los dos existentes queda como cleanup diferido.

---

## Task 1: Migración + schema (Campaign, CampaignRecipient)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260712140000_add_campaigns/migration.sql`

- [ ] **Step 1: Agregar modelos + enum + relaciones inversas al schema**

En `prisma/schema.prisma` agregar el enum (junto a los otros enums ~línea 598-615):
```prisma
enum CampaignSegment {
  birthday_month
  inactive
  frequent
  pending_balance
}
```
Agregar los modelos (al final de los modelos de dominio):
```prisma
model Campaign {
  id              String              @id @default(cuid())
  businessId      String
  business        Business            @relation(fields: [businessId], references: [id], onDelete: Cascade)
  name            String
  segmentType     CampaignSegment
  segmentParams   Json?
  promotionId     String
  promotion       Promotion           @relation(fields: [promotionId], references: [id], onDelete: Restrict)
  messageTemplate String
  createdByUserId String?
  createdAt       DateTime            @default(now())
  recipients      CampaignRecipient[]

  @@index([businessId, createdAt])
}

model CampaignRecipient {
  id         String          @id @default(cuid())
  campaignId String
  campaign   Campaign        @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  customerId String
  customer   Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
  grantId    String?
  grant      PromotionGrant? @relation(fields: [grantId], references: [id], onDelete: SetNull)
  sentAt     DateTime?

  @@unique([campaignId, customerId])
  @@index([campaignId])
}
```
Agregar las relaciones inversas:
- En `model Business` (junto a las otras relaciones): `campaigns Campaign[]`
- En `model Customer`: `campaignRecipients CampaignRecipient[]`
- En `model Promotion`: `campaigns Campaign[]`
- En `model PromotionGrant`: `campaignRecipients CampaignRecipient[]`

- [ ] **Step 2: Escribir la migración a mano**

Crear `prisma/migrations/20260712140000_add_campaigns/migration.sql`:
```sql
CREATE TYPE "CampaignSegment" AS ENUM ('birthday_month', 'inactive', 'frequent', 'pending_balance');

CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "segmentType" "CampaignSegment" NOT NULL,
    "segmentParams" JSONB,
    "promotionId" TEXT NOT NULL,
    "messageTemplate" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "grantId" TEXT,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Campaign_businessId_createdAt_idx" ON "Campaign"("businessId", "createdAt");
CREATE INDEX "CampaignRecipient_campaignId_idx" ON "CampaignRecipient"("campaignId");
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_customerId_key" ON "CampaignRecipient"("campaignId", "customerId");

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "PromotionGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Regenerar client + aplicar a la DB de test**
```bash
npx prisma generate
set -a; source /Users/robertozamorautrera/Projects/agendita/.env.local; set +a
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npx prisma migrate deploy
```
Expected: `Applying migration 20260712140000_add_campaigns` sin errores.

- [ ] **Step 4: Aplicar a la DB compartida + verificar + resolver**
```bash
# env ya cargado apunta a Supabase (verificar: echo $DATABASE_URL debe ser supabase, no localhost)
npx prisma db execute --file prisma/migrations/20260712140000_add_campaigns/migration.sql --schema prisma/schema.prisma
# VERIFICAR que las tablas existen antes de resolver:
npx prisma db execute --schema prisma/schema.prisma --stdin <<'SQL'
SELECT to_regclass('public."Campaign"'), to_regclass('public."CampaignRecipient"');
SQL
npx prisma migrate resolve --applied 20260712140000_add_campaigns
```
Expected: las tablas existen; resolve sin error.

- [ ] **Step 5: Verificar tsc**

Run: `npx tsc --noEmit 2>&1 | grep '^src/'` → vacío.

- [ ] **Step 6: Commit**
```bash
git add prisma/schema.prisma prisma/migrations/20260712140000_add_campaigns/
git commit -m "feat(campaigns): schema + migración Campaign/CampaignRecipient + enum CampaignSegment"
```

---

## Task 2: Schema + consts (`src/lib/campaigns/schema.ts`)

**Files:**
- Create: `src/lib/campaigns/schema.ts`
- Test: `tests/unit/campaigns-schema.test.ts`

- [ ] **Step 1: Test que falla**

`tests/unit/campaigns-schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  createCampaignSchema, CAMPAIGN_SEGMENTS, DEFAULT_INACTIVE_DAYS, DEFAULT_FREQUENT_MIN,
} from '@/lib/campaigns/schema'

describe('campaigns schema', () => {
  it('acepta campaña con promo del catálogo', () => {
    const r = createCampaignSchema.safeParse({
      name: 'Cumple julio', segmentType: 'birthday_month',
      messageTemplate: 'Hola {nombre}', promotionId: 'promo1',
    })
    expect(r.success).toBe(true)
  })
  it('acepta campaña con promo inline (sin promotionId)', () => {
    const r = createCampaignSchema.safeParse({
      name: 'Winback', segmentType: 'inactive', segmentParams: { inactiveDays: 90 },
      messageTemplate: 'Te extrañamos {nombre} {codigo}',
      newPromotion: { name: '20% off', rewardType: 'percentage', rewardValue: 20, appliesToAll: true, serviceIds: [] },
    })
    expect(r.success).toBe(true)
  })
  it('rechaza si no hay ni promotionId ni newPromotion', () => {
    const r = createCampaignSchema.safeParse({
      name: 'X', segmentType: 'frequent', messageTemplate: 'hola',
    })
    expect(r.success).toBe(false)
  })
  it('defaults expuestos', () => {
    expect(DEFAULT_INACTIVE_DAYS).toBe(60)
    expect(DEFAULT_FREQUENT_MIN).toBe(3)
    expect(CAMPAIGN_SEGMENTS).toContain('birthday_month')
  })
})
```

- [ ] **Step 2: Correr y ver fallar** — `npm test -- campaigns-schema` → FAIL.

- [ ] **Step 3: Implementar**

`src/lib/campaigns/schema.ts`:
```ts
import { z } from 'zod'

export const CAMPAIGN_SEGMENTS = ['birthday_month', 'inactive', 'frequent', 'pending_balance'] as const
export type CampaignSegmentType = (typeof CAMPAIGN_SEGMENTS)[number]

export const DEFAULT_INACTIVE_DAYS = 60
export const DEFAULT_FREQUENT_MIN = 3

const optPositiveInt = z.coerce.number().int().optional().nullable().transform((v) => (v && v > 0 ? v : null))

/** Recompensa inline para crear una promo de campaña (granted, pointsCost null). */
export const campaignRewardSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es requerido').max(60),
    rewardType: z.enum(['percentage', 'fixed_amount', 'free_service']),
    rewardValue: z.coerce.number().int().nonnegative(),
    maxDiscount: optPositiveInt,
    appliesToAll: z.boolean(),
    serviceIds: z.array(z.string().min(1)).optional().default([]),
    grantExpiryDays: optPositiveInt,
  })
  .transform((d) => (d.rewardType === 'free_service' ? { ...d, rewardValue: 0 } : d))
  .refine((d) => d.rewardType !== 'percentage' || (d.rewardValue >= 1 && d.rewardValue <= 100), {
    message: 'El porcentaje debe estar entre 1 y 100', path: ['rewardValue'],
  })
  .refine((d) => d.appliesToAll || d.serviceIds.length > 0, {
    message: 'Elige al menos un servicio o aplica a todos', path: ['serviceIds'],
  })

export const campaignSegmentParamsSchema = z.object({
  inactiveDays: z.coerce.number().int().positive().optional(),
  frequentMin: z.coerce.number().int().positive().optional(),
})

export const createCampaignSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es requerido').max(80),
    segmentType: z.enum(CAMPAIGN_SEGMENTS),
    segmentParams: campaignSegmentParamsSchema.optional(),
    messageTemplate: z.string().trim().min(1, 'El mensaje es requerido').max(1000),
    promotionId: z.string().min(1).optional(),
    newPromotion: campaignRewardSchema.optional(),
  })
  .refine((d) => !!d.promotionId || !!d.newPromotion, {
    message: 'Elegí una promo del catálogo o creá una nueva', path: ['promotionId'],
  })

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>
export type CampaignRewardInput = z.infer<typeof campaignRewardSchema>
```

- [ ] **Step 4: Correr y ver pasar** → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/campaigns/schema.ts tests/unit/campaigns-schema.test.ts
git commit -m "feat(campaigns): schema Zod + consts de segmento"
```

---

## Task 3: Mensaje + merge fields (`src/lib/campaigns/message.ts`)

**Files:**
- Create: `src/lib/campaigns/message.ts`
- Test: `tests/unit/campaigns-message.test.ts`

- [ ] **Step 1: Test que falla**

`tests/unit/campaigns-message.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { renderCampaignMessage, defaultMessageForSegment } from '@/lib/campaigns/message'

describe('renderCampaignMessage', () => {
  it('sustituye todos los placeholders', () => {
    const out = renderCampaignMessage('Hola {nombre}, tu código {codigo} vence {vencimiento} — {negocio}', {
      nombre: 'Ana', codigo: 'ABC123', vencimiento: '31/07/2026', negocio: 'Studio',
    })
    expect(out).toBe('Hola Ana, tu código ABC123 vence 31/07/2026 — Studio')
  })
  it('placeholder repetido se reemplaza todas las veces', () => {
    expect(renderCampaignMessage('{nombre} {nombre}', { nombre: 'Ana', codigo: '', vencimiento: '', negocio: '' }))
      .toBe('Ana Ana')
  })
  it('placeholder desconocido queda literal', () => {
    expect(renderCampaignMessage('{otro}', { nombre: 'A', codigo: '', vencimiento: '', negocio: '' })).toBe('{otro}')
  })
  it('default por segmento contiene {nombre} y {codigo}', () => {
    const d = defaultMessageForSegment('birthday_month')
    expect(d).toContain('{nombre}')
    expect(d).toContain('{codigo}')
  })
})
```

- [ ] **Step 2: Correr y ver fallar** → FAIL.

- [ ] **Step 3: Implementar**

`src/lib/campaigns/message.ts`:
```ts
import type { CampaignSegmentType } from './schema'

export interface CampaignMessageVars {
  nombre: string
  codigo: string
  vencimiento: string
  negocio: string
}

/** Sustituye {nombre} {codigo} {vencimiento} {negocio}. Placeholders desconocidos
 *  quedan literales (no rompen). */
export function renderCampaignMessage(template: string, vars: CampaignMessageVars): string {
  return template.replace(/\{(nombre|codigo|vencimiento|negocio)\}/g, (_, key: keyof CampaignMessageVars) => vars[key])
}

const DEFAULTS: Record<CampaignSegmentType, string> = {
  birthday_month:
    '¡Feliz cumple, {nombre}! 🎉 En {negocio} te regalamos un beneficio: usá el código {codigo} (vence {vencimiento}) en tu próxima reserva.',
  inactive:
    'Hola {nombre}, ¡te extrañamos en {negocio}! 💛 Volvé con este beneficio: código {codigo}, válido hasta {vencimiento}.',
  frequent:
    '¡Gracias por elegirnos siempre, {nombre}! 🌟 En {negocio} te dejamos un beneficio: código {codigo} (vence {vencimiento}).',
  pending_balance:
    'Hola {nombre}, te recordamos tu saldo pendiente en {negocio}. Además te dejamos un beneficio: código {codigo}, válido hasta {vencimiento}.',
}

export function defaultMessageForSegment(segment: CampaignSegmentType): string {
  return DEFAULTS[segment]
}
```

- [ ] **Step 4: Correr y ver pasar** → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/campaigns/message.ts tests/unit/campaigns-message.test.ts
git commit -m "feat(campaigns): renderCampaignMessage + defaults por segmento"
```

---

## Task 4: Queries de segmento (`src/lib/campaigns/segments.ts`)

**Files:**
- Create: `src/lib/campaigns/segments.ts`
- Test: `tests/integration/campaigns-segments.test.ts`

- [ ] **Step 1: Test de integración que falla**

Crear `tests/integration/campaigns-segments.test.ts` siguiendo el patrón de `tests/integration/bank-transfer-public.test.ts` (mismo `requireTestDatabase()`, seed de business + customers + bookings con `new PrismaClient()` en `beforeAll`). Seedear: una clienta con `birthDate` en el mes actual (a 00:00Z), una con `lastCompletedAt` hace 100 días, una con 3 bookings `completed`, una con un booking `remainingBalance>0` (status confirmed), y una sin teléfono válido (`phone: '123'`). Asserts:
```ts
import { queryCampaignSegment } from '@/lib/campaigns/segments'
// ...seed...
it('birthday_month devuelve la cumpleañera del mes, excluye sin-teléfono', async () => {
  const r = await queryCampaignSegment(prisma, BIZ, 'birthday_month', {}, new Date(), 'America/Santiago')
  expect(r.map(c => c.id)).toContain(BDAY_CUST)
  expect(r.every(c => c.phone.replace(/\D/g, '').length >= 8)).toBe(true)
})
it('inactive respeta X días y excluye nunca-completadas', async () => {
  const r = await queryCampaignSegment(prisma, BIZ, 'inactive', { inactiveDays: 60 }, new Date(), 'America/Santiago')
  expect(r.map(c => c.id)).toContain(INACTIVE_CUST)
})
it('frequent cuenta completadas >= N', async () => {
  const r = await queryCampaignSegment(prisma, BIZ, 'frequent', { frequentMin: 3 }, new Date(), 'America/Santiago')
  expect(r.map(c => c.id)).toContain(FREQUENT_CUST)
})
it('pending_balance devuelve saldo > 0', async () => {
  const r = await queryCampaignSegment(prisma, BIZ, 'pending_balance', {}, new Date(), 'America/Santiago')
  expect(r.map(c => c.id)).toContain(BALANCE_CUST)
})
```

- [ ] **Step 2: Correr y ver fallar** (comando de integración) → FAIL.

- [ ] **Step 3: Implementar**

`src/lib/campaigns/segments.ts`:
```ts
import { Prisma, PrismaClient } from '@prisma/client'
import { formatInTimeZone } from 'date-fns-tz'
import type { CampaignSegmentType } from './schema'
import { DEFAULT_INACTIVE_DAYS, DEFAULT_FREQUENT_MIN } from './schema'

type Db = PrismaClient | Prisma.TransactionClient
export interface SegmentCustomer { id: string; name: string; phone: string; birthDate: Date | null }

const DAY_MS = 86_400_000
// Reservas "vivas" (no muertas) para saldo/actividad.
const DEAD = ['cancelled', 'no_show', 'expired'] as const

function hasValidPhone(phone: string): boolean {
  return phone.replace(/\D/g, '').length >= 8
}
function monthInTz(date: Date, tz: string): number {
  return Number(formatInTimeZone(date, tz, 'MM'))
}

export interface SegmentParams { inactiveDays?: number; frequentMin?: number }

export async function queryCampaignSegment(
  db: Db,
  businessId: string,
  segment: CampaignSegmentType,
  params: SegmentParams,
  now: Date,
  timeZone: string,
): Promise<SegmentCustomer[]> {
  const select = { id: true, name: true, phone: true, birthDate: true } as const

  if (segment === 'birthday_month') {
    // birthDate se guarda a 00:00Z (@db.Date) → su mes se lee en UTC; "ahora" en tz del negocio.
    const rows = await db.customer.findMany({ where: { businessId, birthDate: { not: null } }, select })
    const nowMonth = monthInTz(now, timeZone)
    return rows.filter((c) => c.birthDate && monthInTz(c.birthDate, 'UTC') === nowMonth && hasValidPhone(c.phone))
  }

  if (segment === 'inactive') {
    const days = params.inactiveDays ?? DEFAULT_INACTIVE_DAYS
    const cutoff = new Date(now.getTime() - days * DAY_MS)
    const rows = await db.customer.findMany({
      where: { businessId, lastCompletedAt: { not: null, lte: cutoff } },
      select,
    })
    return rows.filter((c) => hasValidPhone(c.phone))
  }

  if (segment === 'frequent') {
    const min = params.frequentMin ?? DEFAULT_FREQUENT_MIN
    const groups = await db.booking.groupBy({
      by: ['customerId'],
      where: { businessId, status: 'completed' },
      _count: { id: true },
    })
    const ids = groups.filter((g) => g._count.id >= min).map((g) => g.customerId)
    if (ids.length === 0) return []
    const rows = await db.customer.findMany({ where: { id: { in: ids }, businessId }, select })
    return rows.filter((c) => hasValidPhone(c.phone))
  }

  // pending_balance
  const groups = await db.booking.groupBy({
    by: ['customerId'],
    where: { businessId, remainingBalance: { gt: 0 }, status: { notIn: [...DEAD] } },
    _sum: { remainingBalance: true },
  })
  const ids = groups.filter((g) => (g._sum.remainingBalance ?? 0) > 0).map((g) => g.customerId)
  if (ids.length === 0) return []
  const rows = await db.customer.findMany({ where: { id: { in: ids }, businessId }, select })
  return rows.filter((c) => hasValidPhone(c.phone))
}
```
(Confirmá que `date-fns-tz` exporta `formatInTimeZone` — ya se usa en `src/lib/loyalty/automatic-match.ts`.)

- [ ] **Step 4: Correr y ver pasar** → PASS.

- [ ] **Step 5: tsc + commit**
```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/lib/campaigns/segments.ts tests/integration/campaigns-segments.test.ts
git commit -m "feat(campaigns): queries de segmento (cumple/inactivas/frecuentes/saldo)"
```

---

## Task 5: Mint gratis idempotente (`src/lib/campaigns/mint.ts`)

**Files:**
- Create: `src/lib/campaigns/mint.ts`
- Test: `tests/integration/campaigns-mint.test.ts`

- [ ] **Step 1: Test de integración que falla**

`tests/integration/campaigns-mint.test.ts` (seed business + customer + una `Promotion(triggerType:'granted', pointsCost:null, rewardType:'percentage', rewardValue:20, grantExpiryDays:30)`):
```ts
import { mintCampaignGrant } from '@/lib/campaigns/mint'
it('mintea un grant gratis con expiresAt y es idempotente', async () => {
  const requestId = `campaign:camp1#${CUST}`
  const g1 = await prisma.$transaction((tx) => mintCampaignGrant(tx, {
    businessId: BIZ, promotion: { id: PROMO, grantExpiryDays: 30 }, customerId: CUST,
    requestId, config: { grantExpiryDays: null }, createdByUserId: OWNER_USER, now: new Date(),
  }))
  expect(g1.pointsSpent).toBe(0)
  expect(g1.expiresAt).not.toBeNull()
  const g2 = await prisma.$transaction((tx) => mintCampaignGrant(tx, {
    businessId: BIZ, promotion: { id: PROMO, grantExpiryDays: 30 }, customerId: CUST,
    requestId, config: { grantExpiryDays: null }, createdByUserId: OWNER_USER, now: new Date(),
  }))
  expect(g2.id).toBe(g1.id) // idempotente
  const count = await prisma.promotionGrant.count({ where: { customerId: CUST, requestId } })
  expect(count).toBe(1)
})
```

- [ ] **Step 2: Correr y ver fallar** → FAIL.

- [ ] **Step 3: Implementar**

`src/lib/campaigns/mint.ts`:
```ts
import { Prisma, PromotionGrant } from '@prisma/client'
import { generateGrantCode } from '@/lib/loyalty/redeem'

type Tx = Prisma.TransactionClient

export interface MintCampaignGrantArgs {
  businessId: string
  promotion: { id: string; grantExpiryDays: number | null }
  customerId: string
  requestId: string
  config: { grantExpiryDays: number | null }
  createdByUserId?: string | null
  now?: Date
}

/** Mintea un grant GRATIS (pointsSpent 0) para una promo de campaña, idempotente
 *  por (customerId, requestId). Modelado en activatePackagePurchaseInTx: sin puntos,
 *  sin advisory lock, sin consumir stock. */
export async function mintCampaignGrant(tx: Tx, args: MintCampaignGrantArgs): Promise<PromotionGrant> {
  const existing = await tx.promotionGrant.findUnique({
    where: { customerId_requestId: { customerId: args.customerId, requestId: args.requestId } },
  })
  if (existing) return existing

  const now = args.now ?? new Date()
  const expiryDays = args.promotion.grantExpiryDays ?? args.config.grantExpiryDays
  const expiresAt = expiryDays != null ? new Date(now.getTime() + expiryDays * 86_400_000) : null
  const code = await generateGrantCode(tx, args.businessId)

  try {
    return await tx.promotionGrant.create({
      data: {
        businessId: args.businessId,
        promotionId: args.promotion.id,
        customerId: args.customerId,
        code,
        pointsSpent: 0,
        status: 'active',
        expiresAt,
        refundOnExpiry: false,
        forfeitOnNoShow: false,
        requestId: args.requestId,
        createdByUserId: args.createdByUserId ?? null,
      },
    })
  } catch (e) {
    // Carrera: otro request creó el mismo (customerId,requestId) → devolver el existente.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const g = await tx.promotionGrant.findUnique({
        where: { customerId_requestId: { customerId: args.customerId, requestId: args.requestId } },
      })
      if (g) return g
    }
    throw e
  }
}
```

- [ ] **Step 4: Correr y ver pasar** → PASS.

- [ ] **Step 5: tsc + commit**
```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/lib/campaigns/mint.ts tests/integration/campaigns-mint.test.ts
git commit -m "feat(campaigns): mintCampaignGrant (grant gratis idempotente)"
```

---

## Task 6: Actions (`src/server/actions/campaigns.ts`) + rate limits

**Files:**
- Modify: `src/lib/rate-limit.ts:39-50` (2 buckets)
- Create: `src/server/actions/campaigns.ts`
- Test: `tests/integration/campaigns-actions.test.ts`

- [ ] **Step 1: Buckets de rate limit**

En `src/lib/rate-limit.ts`, dentro de `RATE_LIMITS`, agregar:
```ts
  'create-campaign': { maxRequests: 20, windowMs: 60_000 },
  'send-campaign': { maxRequests: 120, windowMs: 60_000 },
```

- [ ] **Step 2: Test de integración que falla**

`tests/integration/campaigns-actions.test.ts` (mockear `@/lib/auth/server` para que `requireBusinessRole`/`requireBusiness` devuelvan el business seedeado — patrón de `tests/integration/require-transfer-proof.test.ts`; mockear `next/cache`). Seed business + owner + 2 customers en el segmento `frequent` + 1 promo granted. Casos:
```ts
import { createCampaign, getCampaignDetail, sendCampaignMessage, listCampaignPromotions } from '@/server/actions/campaigns'
it('createCampaign materializa recipients del segmento', async () => {
  const { campaignId } = await createCampaign({
    name: 'Frecuentes', segmentType: 'frequent', segmentParams: { frequentMin: 1 },
    messageTemplate: 'Hola {nombre} {codigo}', promotionId: PROMO,
  })
  const d = await getCampaignDetail(campaignId)
  expect(d.recipients.length).toBeGreaterThanOrEqual(2)
})
it('createCampaign con newPromotion crea granted pointsCost null', async () => {
  const { campaignId } = await createCampaign({
    name: 'Inline', segmentType: 'frequent', segmentParams: { frequentMin: 1 },
    messageTemplate: 'Hola {nombre}',
    newPromotion: { name: '15%', rewardType: 'percentage', rewardValue: 15, appliesToAll: true, serviceIds: [] },
  })
  const d = await getCampaignDetail(campaignId)
  const promo = await prisma.promotion.findUnique({ where: { id: d.promotionId } })
  expect(promo?.triggerType).toBe('granted')
  expect(promo?.pointsCost).toBeNull()
})
it('sendCampaignMessage mintea grant idempotente + setea sentAt + devuelve waUrl', async () => {
  const { campaignId } = await createCampaign({ name: 'X', segmentType: 'frequent', segmentParams: { frequentMin: 1 }, messageTemplate: 'Hola {nombre} {codigo}', promotionId: PROMO })
  const d = await getCampaignDetail(campaignId)
  const rid = d.recipients[0].id
  const r1 = await sendCampaignMessage(rid)
  expect(r1.waUrl).toMatch(/wa\.me/)
  const r2 = await sendCampaignMessage(rid)
  const d2 = await getCampaignDetail(campaignId)
  const rec = d2.recipients.find((x) => x.id === rid)!
  expect(rec.sentAt).not.toBeNull()
  const grants = await prisma.promotionGrant.count({ where: { customerId: rec.customerId, requestId: `campaign:${campaignId}#${rec.customerId}` } })
  expect(grants).toBe(1) // idempotente
})
it('listCampaignPromotions lista granted del negocio', async () => {
  const promos = await listCampaignPromotions()
  expect(promos.some((p) => p.id === PROMO)).toBe(true)
})
```

- [ ] **Step 3: Correr y ver fallar** → FAIL.

- [ ] **Step 4: Implementar**

`src/server/actions/campaigns.ts`:
```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusinessRole } from '@/lib/auth/server'
import { createCampaignSchema, type CampaignRewardInput } from '@/lib/campaigns/schema'
import { queryCampaignSegment } from '@/lib/campaigns/segments'
import { renderCampaignMessage } from '@/lib/campaigns/message'
import { mintCampaignGrant } from '@/lib/campaigns/mint'
import { buildWhatsappUrl } from '@/lib/notifications/whatsapp'
import { formatInTimeZone } from 'date-fns-tz'

// NOTE: 'use server' — SOLO funciones async. Schemas/consts en src/lib/campaigns/.

/** Promos elegibles para campaña: todas las granted del negocio (catálogo + campaña). */
export async function listCampaignPromotions() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.promotion.findMany({
    where: { businessId, triggerType: 'granted', isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, rewardType: true, rewardValue: true, pointsCost: true, grantExpiryDays: true },
  })
}

async function createInlineGrantedPromotion(businessId: string, userId: string, r: CampaignRewardInput) {
  if (r.serviceIds.length) {
    const count = await prisma.service.count({ where: { id: { in: r.serviceIds }, businessId } })
    if (count !== r.serviceIds.length) throw new Error('Servicio inválido')
  }
  const promo = await prisma.promotion.create({
    data: {
      businessId, triggerType: 'granted', pointsCost: null,
      name: r.name, rewardType: r.rewardType, rewardValue: r.rewardValue, maxDiscount: r.maxDiscount,
      appliesToAll: r.appliesToAll, grantExpiryDays: r.grantExpiryDays, createdByUserId: userId,
      services: r.appliesToAll ? undefined : { connect: r.serviceIds.map((id) => ({ id })) },
    },
    select: { id: true },
  })
  return promo.id
}

export async function createCampaign(data: unknown): Promise<{ campaignId: string }> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-campaign', 20, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = createCampaignSchema.safeParse(data)
  if (!parsed.success) throw new Error('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  const d = parsed.data

  // Resolver la promo (catálogo o inline). Verificar ownership + que sea granted.
  let promotionId: string
  if (d.newPromotion) {
    promotionId = await createInlineGrantedPromotion(businessId, user.id, d.newPromotion)
  } else {
    const existing = await prisma.promotion.findFirst({
      where: { id: d.promotionId!, businessId, triggerType: 'granted' }, select: { id: true },
    })
    if (!existing) throw new Error('Promo no encontrada')
    promotionId = existing.id
  }

  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } })
  const tz = biz?.timezone || 'America/Santiago'
  const segment = await queryCampaignSegment(prisma, businessId, d.segmentType, d.segmentParams ?? {}, new Date(), tz)

  const campaign = await prisma.campaign.create({
    data: {
      businessId, name: d.name, segmentType: d.segmentType, segmentParams: d.segmentParams ?? undefined,
      promotionId, messageTemplate: d.messageTemplate, createdByUserId: user.id,
      recipients: { create: segment.map((c) => ({ customerId: c.id })) },
    },
    select: { id: true },
  })
  revalidatePath('/dashboard/campanas')
  return { campaignId: campaign.id }
}

export async function getCampaigns() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const campaigns = await prisma.campaign.findMany({
    where: { businessId }, orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, segmentType: true, createdAt: true,
      promotion: { select: { name: true } },
      _count: { select: { recipients: true } },
    },
  })
  return campaigns
}

export async function getCampaignDetail(campaignId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, businessId },
    select: {
      id: true, name: true, segmentType: true, messageTemplate: true, promotionId: true, createdAt: true,
      promotion: { select: { name: true, rewardType: true, rewardValue: true } },
      recipients: {
        orderBy: { customer: { name: 'asc' } },
        select: {
          id: true, customerId: true, sentAt: true,
          customer: { select: { name: true, phone: true } },
          grant: { select: { status: true, expiresAt: true } },
        },
      },
    },
  })
  if (!campaign) throw new Error('Campaña no encontrada')
  return campaign
}

export async function sendCampaignMessage(recipientId: string): Promise<{ waUrl: string | null }> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('send-campaign', 120, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const recipient = await prisma.campaignRecipient.findFirst({
    where: { id: recipientId, campaign: { businessId } },
    select: {
      id: true, sentAt: true, grantId: true,
      customer: { select: { id: true, name: true, phone: true } },
      campaign: {
        select: {
          id: true, messageTemplate: true, promotionId: true,
          promotion: { select: { id: true, grantExpiryDays: true } },
          business: { select: { name: true, timezone: true } },
        },
      },
    },
  })
  if (!recipient) throw new Error('Destinataria no encontrada')

  const config = await prisma.loyaltyConfig.findUnique({ where: { businessId }, select: { grantExpiryDays: true } })
  const tz = recipient.campaign.business.timezone || 'America/Santiago'

  // Mint perezoso en tx chica (idempotente).
  const grant = await prisma.$transaction((tx) =>
    mintCampaignGrant(tx, {
      businessId,
      promotion: { id: recipient.campaign.promotion.id, grantExpiryDays: recipient.campaign.promotion.grantExpiryDays },
      customerId: recipient.customer.id,
      requestId: `campaign:${recipient.campaign.id}#${recipient.customer.id}`,
      config: { grantExpiryDays: config?.grantExpiryDays ?? null },
      createdByUserId: user.id,
    }),
  )

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: { grantId: grant.id, sentAt: recipient.sentAt ?? new Date() },
  })

  const firstName = recipient.customer.name?.split(' ')[0] || ''
  const vencimiento = grant.expiresAt ? formatInTimeZone(grant.expiresAt, tz, 'dd/MM/yyyy') : 'sin vencimiento'
  const message = renderCampaignMessage(recipient.campaign.messageTemplate, {
    nombre: firstName, codigo: grant.code, vencimiento, negocio: recipient.campaign.business.name,
  })

  const digits = recipient.customer.phone.replace(/\D/g, '')
  const waUrl = digits.length >= 8 ? buildWhatsappUrl(recipient.customer.phone, message) : null
  return { waUrl }
}
```

- [ ] **Step 5: Correr y ver pasar** → PASS.

- [ ] **Step 6: tsc + commit**
```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/lib/rate-limit.ts src/server/actions/campaigns.ts tests/integration/campaigns-actions.test.ts
git commit -m "feat(campaigns): actions createCampaign/getCampaigns/detail/send + buckets"
```

---

## Task 7: `<RewardFields>` compartido

**Files:**
- Create: `src/components/dashboard/reward-fields.tsx`
- Test: `tests/unit/reward-fields.test.tsx`

- [ ] **Step 1: Component test que falla**

`tests/unit/reward-fields.test.tsx` (`renderToStaticMarkup`):
```tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RewardFields } from '@/components/dashboard/reward-fields'

const base = { rewardType: 'percentage' as const, rewardValue: '20', maxDiscount: '', appliesToAll: true, serviceIds: [] as string[] }

describe('RewardFields', () => {
  it('percentage muestra input de % y descuento máximo', () => {
    const html = renderToStaticMarkup(<RewardFields value={base} onChange={() => {}} services={[]} currency="CLP" />)
    expect(html).toContain('Porcentaje')
    expect(html).toContain('Descuento máximo')
  })
  it('free_service oculta el input de valor', () => {
    const html = renderToStaticMarkup(<RewardFields value={{ ...base, rewardType: 'free_service' }} onChange={() => {}} services={[]} currency="CLP" />)
    expect(html).not.toContain('Porcentaje (1–100)')
  })
})
```

- [ ] **Step 2: Correr y ver fallar** → FAIL.

- [ ] **Step 3: Implementar**

Crear `src/components/dashboard/reward-fields.tsx` como client component controlado. Basado EXACTO en el bloque de recompensa de `src/app/dashboard/promociones/promotion-form.tsx:250-345` (segmented control de tipo + value/maxDiscount condicional + switch appliesToAll + chips de servicios). Props:
```ts
export interface RewardFieldsValue {
  rewardType: 'percentage' | 'fixed_amount' | 'free_service'
  rewardValue: string
  maxDiscount: string
  appliesToAll: boolean
  serviceIds: string[]
}
export function RewardFields({ value, onChange, services, currency }: {
  value: RewardFieldsValue
  onChange: (next: RewardFieldsValue) => void
  services: { id: string; name: string }[]
  currency: string
}) { /* ...JSX del bloque de promotion-form, con update(k,v) => onChange({ ...value, [k]: v }) y toggleService... */ }
```
Copiar el markup/estilos de `promotion-form.tsx:250-345`; el label del value debe decir `'Porcentaje (1–100)'` para percentage y `Monto (${currency})` si fixed_amount. NO tocar `promotion-form.tsx` ni `redemption-catalog.tsx` (deviation anotada arriba).

- [ ] **Step 4: Correr y ver pasar** → PASS.

- [ ] **Step 5: tsc + commit**
```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/components/dashboard/reward-fields.tsx tests/unit/reward-fields.test.tsx
git commit -m "feat(campaigns): componente RewardFields controlado reusable"
```

---

## Task 8: Página lista de campañas + diálogo de creación

**Files:**
- Create: `src/app/dashboard/campanas/page.tsx`
- Create: `src/app/dashboard/campanas/campaign-list.tsx`
- Create: `src/app/dashboard/campanas/new-campaign-dialog.tsx`
- Test: `tests/unit/campaigns-page.test.tsx`

- [ ] **Step 1: Component test que falla**

`tests/unit/campaigns-page.test.tsx` — mockear `@/lib/auth/user` (`getCurrentUserWithBusiness`) + `@/server/actions/campaigns` (`getCampaigns` → `[]`, `listCampaignPromotions` → `[]`) + `@/server/actions/services` (`getServices` → `[]`) + `next/navigation`. Assert que la página renderiza el título "Campañas" y el CTA de nueva campaña. (Patrón: `tests/unit/customer-detail-page.test.tsx`.)

- [ ] **Step 2: Correr y ver fallar** → FAIL.

- [ ] **Step 3: Implementar `page.tsx`**

Server component mirror de `src/app/dashboard/promociones/page.tsx:73-96`: `getCurrentUserWithBusiness()` → `redirect('/login')`/`redirect('/recover-business')`; try/catch cargar `getCampaigns()`, `listCampaignPromotions()`, `getServices()`; `<DashboardHeader title="Campañas" subtitle="..." />` + botón que abre `<NewCampaignDialog promotions={...} services={...} />` + `<CampaignList campaigns={...} />`.

- [ ] **Step 4: Implementar `campaign-list.tsx`** (client): tabla/lista de campañas (nombre, segmento legible, promo, N destinatarias, fecha) con link a `/dashboard/campanas/${c.id}`. Helper `segmentLabel(segmentType)`.

- [ ] **Step 5: Implementar `new-campaign-dialog.tsx`** (client): form controlado con:
  - Nombre.
  - Selector de **segmento** (4 opciones) + inputs condicionales: `inactiveDays` (si inactive, default 60), `frequentMin` (si frequent, default 3).
  - **Promo**: radio "del catálogo" (select de `promotions`) o "crear nueva" (`<RewardFields>` + nombre + `grantExpiryDays`).
  - **Mensaje**: textarea sembrado con `defaultMessageForSegment(segment)` (importar de `@/lib/campaigns/message`); hint de placeholders disponibles.
  - Submit → `createCampaign(payload)` → `router.push('/dashboard/campanas/' + campaignId)`. Manejo de error con estado.

- [ ] **Step 6: Correr y ver pasar** → PASS.

- [ ] **Step 7: tsc + commit**
```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/app/dashboard/campanas/page.tsx src/app/dashboard/campanas/campaign-list.tsx src/app/dashboard/campanas/new-campaign-dialog.tsx tests/unit/campaigns-page.test.tsx
git commit -m "feat(campaigns): página de lista + diálogo de creación"
```

---

## Task 9: Página detalle + lista de destinatarias (envío)

**Files:**
- Create: `src/app/dashboard/campanas/[id]/page.tsx`
- Create: `src/app/dashboard/campanas/[id]/recipient-list.tsx`
- Test: `tests/unit/recipient-list.test.tsx`

- [ ] **Step 1: Component test que falla**

`tests/unit/recipient-list.test.tsx` (`renderToStaticMarkup` + `vi.mock('next/navigation', ...)` + mock `@/server/actions/campaigns`): render `<RecipientList>` con 2 destinatarias (una con `sentAt`, otra sin) → assert que muestra "Enviar por WhatsApp" y el estado "Enviado ✓" para la enviada, y las métricas (enviadas/canjearon/vigentes).

- [ ] **Step 2: Correr y ver fallar** → FAIL.

- [ ] **Step 3: Implementar `[id]/page.tsx`** (server): auth guard; `getCampaignDetail(params.id)` (recordar: `params` es Promise en este fork → `const { id } = await params`); derivar métricas (enviadas = `sentAt!=null`; canjearon = `grant?.status==='redeemed'`; vigentes = `grant?.status==='active' && (!grant.expiresAt || grant.expiresAt>=now)`); pasar campaign + métricas a `<RecipientList>`.

- [ ] **Step 4: Implementar `[id]/recipient-list.tsx`** (client): header con métricas; tabla de destinatarias (nombre, teléfono, estado enviado ✓ / canjeado, botón "Enviar por WhatsApp" por fila). El handler de envío replica EXACTO `src/app/dashboard/reviews/review-link-button.tsx:48-79`:
```ts
async function handleSend(recipientId: string) {
  setSending(recipientId)
  const win = window.open('', '_blank')       // sync, gesto del usuario
  try {
    const { waUrl } = await sendCampaignMessage(recipientId)
    if (waUrl) { if (win) win.location.href = waUrl; else window.open(waUrl, '_blank') }
    else { win?.close(); setError('La clienta no tiene teléfono válido.') }
    router.refresh()
  } catch (e) { win?.close(); setError(e instanceof Error ? e.message : 'Error') }
  finally { setSending(null) }
}
```
Botón verde `#25D366` (igual al de reseña). NO hay "enviar a todas".

- [ ] **Step 5: Correr y ver pasar** → PASS.

- [ ] **Step 6: tsc + commit**
```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/app/dashboard/campanas/\[id\]/ tests/unit/recipient-list.test.tsx
git commit -m "feat(campaigns): detalle + lista de destinatarias con envío un-toque"
```

---

## Task 10: Entrada en el sidebar

**Files:**
- Modify: `src/components/dashboard/sidebar.tsx`

- [ ] **Step 1: Agregar el ítem de nav**

En `src/components/dashboard/sidebar.tsx`: importar un icono de `lucide-react` (agregar `Megaphone` a la lista de imports ~L10-27). En el array `navItems` (L29-43), después de Fidelización agregar:
```ts
  { href: '/dashboard/campanas', label: 'Campañas', icon: Megaphone },
```
(Nota: `mobileItems = navItems.slice(0,4)` → no aparece en el nav móvil inferior; ok por spec.)

- [ ] **Step 2: Verificar tsc + commit**
```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/components/dashboard/sidebar.tsx
git commit -m "feat(campaigns): entrada 'Campañas' en el sidebar"
```

---

## Task 11: Captura opcional de cumpleaños en el flujo de reserva

**Files:**
- Modify: `src/lib/customers/find-or-create.ts`
- Modify: `src/server/actions/bookings.ts` (2 call-sites + tipos de `data`)
- Modify: `src/components/booking/wizard.tsx` (`BookingData`)
- Modify: `src/components/booking/step-customer.tsx` (campo)
- Modify: `src/app/dashboard/bookings/new/new-booking-form.tsx` (campo)
- Test: `tests/integration/customer-birthdate-capture.test.ts`

- [ ] **Step 1: Test de integración que falla**

`tests/integration/customer-birthdate-capture.test.ts`: llamar `findOrCreateCustomerInTx(tx, { businessId, phone, name, birthDate: new Date('1990-05-10T00:00:00Z') })` sobre una clienta NUEVA → `birthDate` seteado. Luego sobre una EXISTENTE con birthDate ya cargado + un birthDate distinto → **no lo pisa**. Sobre una existente SIN birthDate + birthDate → lo setea (backfill).
```ts
import { findOrCreateCustomerInTx } from '@/lib/customers/find-or-create'
it('setea birthDate al crear y hace backfill sin pisar', async () => {
  const bd = new Date('1990-05-10T00:00:00Z')
  const { customer } = await prisma.$transaction((tx) => findOrCreateCustomerInTx(tx, { businessId: BIZ, phone: '+56911111111', name: 'Nueva', birthDate: bd }))
  expect(customer.birthDate?.toISOString().slice(0,10)).toBe('1990-05-10')
  // existente con birthDate no se pisa
  const { customer: c2 } = await prisma.$transaction((tx) => findOrCreateCustomerInTx(tx, { businessId: BIZ, phone: '+56911111111', name: 'Nueva', birthDate: new Date('2000-01-01T00:00:00Z') }))
  expect(c2.birthDate?.toISOString().slice(0,10)).toBe('1990-05-10')
})
```

- [ ] **Step 2: Correr y ver fallar** → FAIL.

- [ ] **Step 3: Implementar en `find-or-create.ts`**

En `FindOrCreateCustomerInput` (`find-or-create.ts:5-12`) agregar `birthDate?: Date | null`. En la rama existente, backfill como el email:
```ts
    if (input.birthDate && !customer.birthDate) {
      await tx.customer.update({ where: { id: customer.id }, data: { birthDate: input.birthDate } })
      customer = { ...customer, birthDate: input.birthDate }
    }
```
En el `create` (línea 38-40) agregar `birthDate: input.birthDate ?? null` al `data`.

- [ ] **Step 4: Thread en `bookings.ts`**

En el tipo del param `data` de `createBooking` y `createBookingFromDashboard`, agregar `customerBirthDate?: string` (formato `YYYY-MM-DD`, opcional). En ambos call-sites de `findOrCreateCustomerInTx` (`bookings.ts:313-319` y `:820-826`) pasar:
```ts
    birthDate: data.customerBirthDate ? new Date(`${data.customerBirthDate}T00:00:00Z`) : null,
```
(Misma convención UTC-medianoche que `customers.ts:293`.)

- [ ] **Step 5: Campo en el wizard público**

En `src/components/booking/wizard.tsx` (`BookingData`, L28-42) agregar `customerBirthDate?: string` (+ en `initialData` L45-57 default `''`). En `src/components/booking/step-customer.tsx`, entre el input de email (L82-84) y notas (L89-91), agregar un input opcional:
```tsx
<div>
  <Label htmlFor="customerBirthDate">Cumpleaños (opcional)</Label>
  <Input id="customerBirthDate" type="date" max={new Date().toISOString().slice(0, 10)}
    value={formData.customerBirthDate ?? ''} onChange={(e) => setField('customerBirthDate', e.target.value)} />
</div>
```
Asegurar que `customerBirthDate` viaja en el payload de `createBooking` (donde el wizard arma `customerName/Phone/Email`).

- [ ] **Step 6: Campo en el form de dashboard**

En `src/app/dashboard/bookings/new/new-booking-form.tsx`: estado `const [customerBirthDate, setCustomerBirthDate] = useState('')` (junto a L51-53); un input `type="date"` tras el de email (L383); y en el payload (L248-250) agregar `customerBirthDate: customerBirthDate || undefined`.

- [ ] **Step 7: Correr y ver pasar** → PASS. Correr también los tests de booking existentes (`npm run test:integration -- bookings`) → verdes (firma retro-compatible, campo opcional).

- [ ] **Step 8: tsc + commit**
```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/lib/customers/find-or-create.ts src/server/actions/bookings.ts src/components/booking/wizard.tsx src/components/booking/step-customer.tsx src/app/dashboard/bookings/new/new-booking-form.tsx tests/integration/customer-birthdate-capture.test.ts
git commit -m "feat(campaigns): captura opcional de cumpleaños en el flujo de reserva"
```

---

## Task 12: Verificación final

**Files:** ninguno.

- [ ] **Step 1: tsc** — `npx tsc --noEmit 2>&1 | grep '^src/'` → vacío.
- [ ] **Step 2: Unit (serializado)** — `npm run test:unit -- --no-file-parallelism` → 100% verde.
- [ ] **Step 3: Integración** — `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration` → verde (incluye campaigns-segments, campaigns-mint, campaigns-actions, customer-birthdate-capture).
- [ ] **Step 4: Lint + build** — `npm run lint && npm run build` → 0 errores; build ok (ruta nueva `/dashboard/campanas` + `[id]`).
- [ ] **Step 5: Commit final si quedó algo**
```bash
git add -A && git commit -m "test(campaigns): verificación final verde" || echo "nada que commitear"
```

---

## Waves de ejecución (subagent-driven-development)

- **Wave 1 (paralelo, sin archivos compartidos):** Task 1 (migración) ∥ Task 2 (schema.ts) ∥ Task 3 (message.ts).
- **Wave 2 (paralelo, dependen del client de T1):** Task 4 (segments) ∥ Task 5 (mint). Contención: un solo agente de integración a la vez (DB de test compartida) — correr secuencial si chocan.
- **Wave 3:** Task 6 (actions — usa T2/T4/T5).
- **Wave 4 (UI):** Task 7 (RewardFields) → Task 8 (lista+creación) → Task 9 (detalle+envío) → Task 10 (sidebar).
- **Wave 5:** Task 11 (captura cumpleaños).
- **Wave 6:** Task 12 (verificación) → /simplify (4 ángulos) → PR.

## Self-review checklist (post-plan)

- [x] **Cobertura de spec:** modelo de datos (T1), schema/consts (T2), mensaje+merge (T3), segmentos (T4), mint gratis idempotente (T5), actions create/list/detail/send + rate limits + inline promo pointsCost null + independiente de isActive (T6), RewardFields (T7), UI lista+creación (T8), detalle+envío un-toque + métricas con filtro de expiración (T9), nav (T10), captura birthDate público+dashboard sin pisar (T11), verificación (T12). Fuera de alcance (email/opt-out/bulk API) NO tiene tasks — correcto.
- [x] **Sin placeholders:** cada step tiene código o instrucción anclada a file:line real.
- [x] **Consistencia de tipos:** `CampaignSegmentType`/`CAMPAIGN_SEGMENTS` (schema) ↔ `queryCampaignSegment` ↔ actions; `MintCampaignGrantArgs` (mint) ↔ call en `sendCampaignMessage`; `renderCampaignMessage`/`CampaignMessageVars` ↔ action; `RewardFieldsValue` ↔ new-campaign-dialog; `requestId = campaign:<id>#<customerId>` idéntico en mint y en la métrica de idempotencia; `createCampaignSchema` (promotionId XOR newPromotion) ↔ createCampaign.
