# Transferencia bancaria PR A — Migración + Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modelo `BankTransferAccount` + columna `Booking.paymentMethod`, y la sección de configuración en el dashboard de Pagos para que la dueña cargue sus datos bancarios y las dos ventanas de tiempo.

**Architecture:** Primer PR de tres (spec: `docs/superpowers/specs/2026-07-10-abono-transferencia-bancaria-design.md`, §3 y §9). Este PR es inerte para las clientas: nada consume `BankTransferAccount` todavía (el wizard recién lo hace en PR B), así que se puede mergear y desplegar sin riesgo. Modelo nuevo 1:1 con Business en texto plano + Zod schema en módulo aparte + server actions (`upsert` + toggle) + form client component en la página de Pagos existente.

**Tech Stack:** Next.js App Router (LEER `node_modules/next/dist/docs/` ante cualquier duda de API — este fork tiene breaking changes), Prisma + Postgres, Zod, vitest (`renderToStaticMarkup` para componentes), shadcn ui (`Input`, `Label`, `Textarea`, `Switch`, `Button`, `Card`).

**Contexto de rama:** trabajar sobre `claude/abono-transferencia` (ya tiene el spec commiteado). El PR final incluye spec + plan + implementación.

**Landmines del proyecto (violarlas rompió deploys/tests antes):**
1. Módulos `'use server'` solo exportan funciones async. El schema Zod y los tipos van en `src/lib/bank-transfer/schema.ts`, NUNCA re-exportados desde el archivo de actions (precedente con comentario: `src/server/actions/business-settings.ts:15-20`).
2. Migraciones en la DB compartida: NO usar `prisma migrate dev` (el diff levanta cambios de ramas hermanas). Escribir el SQL a mano, aplicar con `db execute` y **siempre** marcar con `migrate resolve --applied` (sin eso, el `migrate deploy` del build de Vercel revienta).
3. Tests de componentes: `renderToStaticMarkup` + `vi.mock('next/navigation', ...)` siempre.
4. Git en worktrees: siempre `git -C <worktree>` y `git add` con archivos explícitos, nunca `-A`.

---

### Task 1: Migración Prisma — `BankTransferAccount` + `Booking.paymentMethod`

**Files:**
- Modify: `prisma/schema.prisma` (model Business ~línea 46, model Booking ~línea 351, modelos nuevos al final de la sección de pagos, después de `model PaymentAccount` ~línea 133)
- Create: `prisma/migrations/20260710120000_add_bank_transfer_account/migration.sql`

- [ ] **Step 1: Agregar el modelo y la columna al schema**

En `prisma/schema.prisma`, después del cierre de `model PaymentAccount` (línea ~133), agregar:

```prisma
// Datos bancarios del negocio para abonos por transferencia (spec 2026-07-10).
// Texto plano a propósito: son datos que la dueña hoy manda por WhatsApp a
// desconocidos. NO confundir con PaymentAccount (credenciales OAuth de MP).
model BankTransferAccount {
  id            String   @id @default(cuid())
  businessId    String   @unique
  accountHolder String
  rut           String
  bankName      String
  accountType   String // "corriente" | "vista" | "ahorro" — texto libre, sin enum
  accountNumber String
  email         String?
  instructions  String?
  isEnabled     Boolean  @default(true)
  holdHours     Int      @default(24) // plazo para transferir y declarar
  verifyHours   Int?     @default(48) // plazo para que la dueña verifique; null = sin límite
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
}
```

En `model Business`, en el bloque de relaciones (después de `paymentAccounts      PaymentAccount[]`):

```prisma
  bankTransferAccount  BankTransferAccount?
```

En `model Booking`, después de `holdExpiresAt  DateTime?` (línea ~370):

```prisma
  paymentMethod  String? // 'bank_transfer' si la clienta eligió transferencia; null = flujo actual/MP
```

- [ ] **Step 2: Validar el schema**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Escribir la migración SQL a mano**

Crear `prisma/migrations/20260710120000_add_bank_transfer_account/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "BankTransferAccount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "rut" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "email" TEXT,
    "instructions" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "holdHours" INTEGER NOT NULL DEFAULT 24,
    "verifyHours" INTEGER DEFAULT 48,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransferAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankTransferAccount_businessId_key" ON "BankTransferAccount"("businessId");

-- AddForeignKey
ALTER TABLE "BankTransferAccount" ADD CONSTRAINT "BankTransferAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "paymentMethod" TEXT;
```

- [ ] **Step 4: Aplicar la migración y marcarla como aplicada (landmine 2 — ambos comandos, en este orden)**

```bash
npx prisma db execute --file prisma/migrations/20260710120000_add_bank_transfer_account/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20260710120000_add_bank_transfer_account
npx prisma generate
```

Expected: los tres comandos salen sin error; `migrate resolve` imprime `Migration 20260710120000_add_bank_transfer_account marked as applied.`

- [ ] **Step 5: Verificar que el cliente generado expone el modelo**

Run: `node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); p.bankTransferAccount.count().then(c=>{console.log('bankTransferAccount count:',c); return p.\$disconnect()})"`
Expected: `bankTransferAccount count: 0`

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260710120000_add_bank_transfer_account/migration.sql
git commit -m "feat(bank-transfer): modelo BankTransferAccount + Booking.paymentMethod"
```

---

### Task 2: Zod schema en módulo aparte (landmine 1)

**Files:**
- Create: `src/lib/bank-transfer/schema.ts`
- Test: `tests/unit/bank-transfer-schema.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/bank-transfer-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { bankTransferAccountSchema } from '@/lib/bank-transfer/schema'

const valid = {
  accountHolder: 'María Pérez',
  rut: '12.345.678-9',
  bankName: 'BancoEstado',
  accountType: 'vista',
  accountNumber: '12345678',
  email: 'maria@ejemplo.cl',
  instructions: 'Poner nombre y fecha en el asunto',
  holdHours: 24,
  verifyHours: 48,
}

describe('bankTransferAccountSchema', () => {
  it('acepta un input completo válido', () => {
    const r = bankTransferAccountSchema.safeParse(valid)
    expect(r.success).toBe(true)
  })

  it('acepta email vacío e instructions ausente (opcionales)', () => {
    const r = bankTransferAccountSchema.safeParse({ ...valid, email: '', instructions: undefined })
    expect(r.success).toBe(true)
  })

  it('acepta verifyHours null (sin límite, opt-in explícito)', () => {
    const r = bankTransferAccountSchema.safeParse({ ...valid, verifyHours: null })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.verifyHours).toBeNull()
  })

  it('rechaza holdHours fuera de rango (0 y 169)', () => {
    expect(bankTransferAccountSchema.safeParse({ ...valid, holdHours: 0 }).success).toBe(false)
    expect(bankTransferAccountSchema.safeParse({ ...valid, holdHours: 169 }).success).toBe(false)
  })

  it('rechaza campos obligatorios en blanco', () => {
    expect(bankTransferAccountSchema.safeParse({ ...valid, accountHolder: '  ' }).success).toBe(false)
    expect(bankTransferAccountSchema.safeParse({ ...valid, accountNumber: '' }).success).toBe(false)
  })

  it('coerciona holdHours/verifyHours que llegan como string del form', () => {
    const r = bankTransferAccountSchema.safeParse({ ...valid, holdHours: '24', verifyHours: '48' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.holdHours).toBe(24)
      expect(r.data.verifyHours).toBe(48)
    }
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/unit/bank-transfer-schema.test.ts`
Expected: FAIL — `Cannot find module '@/lib/bank-transfer/schema'`

- [ ] **Step 3: Implementar el schema**

Crear `src/lib/bank-transfer/schema.ts`:

```ts
import { z } from 'zod'

// Módulo aparte a propósito: el archivo de server actions ('use server') solo
// puede exportar funciones async — ver business-settings.ts:15-20.
export const bankTransferAccountSchema = z.object({
  accountHolder: z.string().trim().min(1, 'El titular es obligatorio').max(120),
  rut: z.string().trim().min(1, 'El RUT es obligatorio').max(20),
  bankName: z.string().trim().min(1, 'El banco es obligatorio').max(80),
  accountType: z.string().trim().min(1, 'El tipo de cuenta es obligatorio').max(40),
  accountNumber: z.string().trim().min(1, 'El número de cuenta es obligatorio').max(40),
  email: z.string().trim().email('Email inválido').max(120).or(z.literal('')).optional(),
  instructions: z.string().trim().max(500).optional(),
  holdHours: z.coerce.number().int().min(1, 'Mínimo 1 hora').max(168, 'Máximo 168 horas (7 días)'),
  verifyHours: z.coerce.number().int().min(1, 'Mínimo 1 hora').max(720, 'Máximo 720 horas (30 días)').nullable(),
})

export type BankTransferAccountInput = z.infer<typeof bankTransferAccountSchema>
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run tests/unit/bank-transfer-schema.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/bank-transfer/schema.ts tests/unit/bank-transfer-schema.test.ts
git commit -m "feat(bank-transfer): schema Zod de la cuenta bancaria"
```

---

### Task 3: Server actions — `saveBankTransferAccount` + `setBankTransferEnabled`

**Files:**
- Create: `src/server/actions/bank-transfer-settings.ts`
- Test: `tests/integration/bank-transfer-settings.test.ts`

- [ ] **Step 1: Escribir el test de integración que falla**

Crear `tests/integration/bank-transfer-settings.test.ts` (patrón exacto de `tests/integration/packages-actions.test.ts`: mocks de auth/rate-limit/revalidate, Prisma real):

```ts
import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

// Mockeamos las capas de infraestructura (auth, rate limit, revalidate) para
// ejercitar la LÓGICA REAL de las actions contra un Postgres real — mismo
// approach que packages-actions.test.ts.
const BIZ = 'bta-biz-1'
const USER = 'bta-user-1'
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: async () => ({ businessId: BIZ, user: { id: USER } }),
  requireBusinessRole: async () => ({ businessId: BIZ, user: { id: USER } }),
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, remaining: 30, resetAt: 0 }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const validInput = {
  accountHolder: 'María Pérez',
  rut: '12.345.678-9',
  bankName: 'BancoEstado',
  accountType: 'vista',
  accountNumber: '12345678',
  email: 'maria@ejemplo.cl',
  instructions: 'Nombre y fecha en el asunto',
  holdHours: 24,
  verifyHours: 48,
}

describe('bank-transfer settings actions', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.user.create({ data: { id: USER, email: 'bta@t.test', name: 'BTA Owner' } })
    await prisma.business.create({
      data: {
        id: BIZ, name: 'BTA Biz', slug: 'bta-biz', subdomain: 'btabiz', ownerUserId: USER,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
      },
    })
    await prisma.businessUser.create({ data: { id: 'bta-bu-1', businessId: BIZ, userId: USER, role: 'owner' } })
  })

  afterAll(async () => {
    await prisma.bankTransferAccount.deleteMany({ where: { businessId: BIZ } })
    await prisma.businessUser.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.bankTransferAccount.deleteMany({ where: { businessId: BIZ } })
  })

  it('crea la cuenta con los datos normalizados', async () => {
    const { saveBankTransferAccount } = await import('@/server/actions/bank-transfer-settings')
    await saveBankTransferAccount(validInput)

    const row = await prisma.bankTransferAccount.findUnique({ where: { businessId: BIZ } })
    expect(row).not.toBeNull()
    expect(row!.accountHolder).toBe('María Pérez')
    expect(row!.holdHours).toBe(24)
    expect(row!.verifyHours).toBe(48)
    expect(row!.isEnabled).toBe(true)
  })

  it('actualiza (upsert) sin duplicar y persiste verifyHours null', async () => {
    const { saveBankTransferAccount } = await import('@/server/actions/bank-transfer-settings')
    await saveBankTransferAccount(validInput)
    await saveBankTransferAccount({ ...validInput, bankName: 'Banco de Chile', verifyHours: null })

    const rows = await prisma.bankTransferAccount.findMany({ where: { businessId: BIZ } })
    expect(rows).toHaveLength(1)
    expect(rows[0].bankName).toBe('Banco de Chile')
    expect(rows[0].verifyHours).toBeNull()
  })

  it('guarda email vacío como null', async () => {
    const { saveBankTransferAccount } = await import('@/server/actions/bank-transfer-settings')
    await saveBankTransferAccount({ ...validInput, email: '' })
    const row = await prisma.bankTransferAccount.findUnique({ where: { businessId: BIZ } })
    expect(row!.email).toBeNull()
  })

  it('rechaza input inválido sin escribir nada', async () => {
    const { saveBankTransferAccount } = await import('@/server/actions/bank-transfer-settings')
    await expect(saveBankTransferAccount({ ...validInput, holdHours: 0 })).rejects.toThrow('Datos inválidos')
    expect(await prisma.bankTransferAccount.count({ where: { businessId: BIZ } })).toBe(0)
  })

  it('setBankTransferEnabled togglea sin tocar el resto', async () => {
    const { saveBankTransferAccount, setBankTransferEnabled } = await import('@/server/actions/bank-transfer-settings')
    await saveBankTransferAccount(validInput)
    await setBankTransferEnabled(false)

    const row = await prisma.bankTransferAccount.findUnique({ where: { businessId: BIZ } })
    expect(row!.isEnabled).toBe(false)
    expect(row!.bankName).toBe('BancoEstado')
  })

  it('setBankTransferEnabled sin cuenta creada tira error legible', async () => {
    const { setBankTransferEnabled } = await import('@/server/actions/bank-transfer-settings')
    await expect(setBankTransferEnabled(true)).rejects.toThrow('Primero guardá los datos de la cuenta')
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/bank-transfer-settings.test.ts`
(OJO: los tests de integración usan config propia — `npm run test:integration` la usa; sin `--config` no corren.)
Expected: FAIL — `Cannot find module '@/server/actions/bank-transfer-settings'`. (Si en cambio falla con un error de `requireTestDatabase` sobre la base de test, correr con el mismo env que usan los otros tests de `tests/integration/` — mirar cómo lo hace CI en `.github/workflows/`.)

- [ ] **Step 3: Implementar las actions**

Crear `src/server/actions/bank-transfer-settings.ts`:

```ts
'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusinessRole } from '@/lib/auth/server'
import { bankTransferAccountSchema, type BankTransferAccountInput } from '@/lib/bank-transfer/schema'

// NOTE: módulo 'use server' — SOLO funciones async exportadas. El schema Zod y
// los tipos viven en '@/lib/bank-transfer/schema'; re-exportarlos acá revienta
// en runtime (ver business-settings.ts:15-20).

function trimToNull(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null
  return value.trim()
}

export async function saveBankTransferAccount(data: BankTransferAccountInput) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('save-bank-transfer-account', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = bankTransferAccountSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }
  const v = parsed.data

  const fields = {
    accountHolder: v.accountHolder,
    rut: v.rut,
    bankName: v.bankName,
    accountType: v.accountType,
    accountNumber: v.accountNumber,
    email: trimToNull(v.email),
    instructions: trimToNull(v.instructions),
    holdHours: v.holdHours,
    verifyHours: v.verifyHours,
  }

  await prisma.bankTransferAccount.upsert({
    where: { businessId },
    create: { businessId, ...fields },
    update: fields,
  })

  revalidatePath('/dashboard/settings/payments')
}

export async function setBankTransferEnabled(isEnabled: boolean) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('set-bank-transfer-enabled', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const existing = await prisma.bankTransferAccount.findUnique({ where: { businessId } })
  if (!existing) {
    throw new Error('Primero guardá los datos de la cuenta bancaria.')
  }

  await prisma.bankTransferAccount.update({ where: { businessId }, data: { isEnabled } })
  revalidatePath('/dashboard/settings/payments')
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/bank-transfer-settings.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/bank-transfer-settings.ts tests/integration/bank-transfer-settings.test.ts
git commit -m "feat(bank-transfer): actions de settings (upsert + toggle)"
```

---

### Task 4: Form client component

**Files:**
- Create: `src/app/dashboard/settings/payments/bank-transfer-form.tsx`
- Test: `tests/unit/bank-transfer-form.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/bank-transfer-form.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BankTransferForm } from '@/app/dashboard/settings/payments/bank-transfer-form'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/server/actions/bank-transfer-settings', () => ({
  saveBankTransferAccount: vi.fn(),
  setBankTransferEnabled: vi.fn(),
}))

const account = {
  accountHolder: 'María Pérez',
  rut: '12.345.678-9',
  bankName: 'BancoEstado',
  accountType: 'vista',
  accountNumber: '12345678',
  email: 'maria@ejemplo.cl',
  instructions: null,
  isEnabled: true,
  holdHours: 24,
  verifyHours: 48,
}

describe('BankTransferForm', () => {
  it('sin cuenta: muestra el form vacío con defaults y sin toggle', () => {
    const html = renderToStaticMarkup(<BankTransferForm account={null} />)
    expect(html).toContain('Titular')
    expect(html).toContain('value="24"')
    expect(html).toContain('value="48"')
    expect(html).not.toContain('Aceptar transferencias')
  })

  it('con cuenta: pre-carga los valores y muestra el toggle', () => {
    const html = renderToStaticMarkup(<BankTransferForm account={account} />)
    expect(html).toContain('María Pérez')
    expect(html).toContain('BancoEstado')
    expect(html).toContain('Aceptar transferencias')
  })

  it('con verifyHours null: el campo queda vacío y aparece la advertencia de sin límite', () => {
    const html = renderToStaticMarkup(<BankTransferForm account={{ ...account, verifyHours: null }} />)
    expect(html).toContain('sin límite')
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/unit/bank-transfer-form.test.tsx`
Expected: FAIL — `Cannot find module '@/app/dashboard/settings/payments/bank-transfer-form'`

- [ ] **Step 3: Implementar el form**

Crear `src/app/dashboard/settings/payments/bank-transfer-form.tsx` (patrón de estado de `src/components/dashboard/settings-form.tsx:46-48` — `isSubmitting`/`serverError`/`successMessage` con `useState`, sin toast):

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { saveBankTransferAccount, setBankTransferEnabled } from '@/server/actions/bank-transfer-settings'

export interface BankTransferAccountView {
  accountHolder: string
  rut: string
  bankName: string
  accountType: string
  accountNumber: string
  email: string | null
  instructions: string | null
  isEnabled: boolean
  holdHours: number
  verifyHours: number | null
}

export function BankTransferForm({ account }: { account: BankTransferAccountView | null }) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const [form, setForm] = useState({
    accountHolder: account?.accountHolder ?? '',
    rut: account?.rut ?? '',
    bankName: account?.bankName ?? '',
    accountType: account?.accountType ?? '',
    accountNumber: account?.accountNumber ?? '',
    email: account?.email ?? '',
    instructions: account?.instructions ?? '',
    holdHours: String(account?.holdHours ?? 24),
    // '' representa null = sin límite
    verifyHours: account?.verifyHours == null && account ? '' : String(account?.verifyHours ?? 48),
  })

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)
    setServerError(null)
    setSuccessMessage(null)
    try {
      await saveBankTransferAccount({
        accountHolder: form.accountHolder,
        rut: form.rut,
        bankName: form.bankName,
        accountType: form.accountType,
        accountNumber: form.accountNumber,
        email: form.email,
        instructions: form.instructions,
        holdHours: Number(form.holdHours),
        verifyHours: form.verifyHours.trim() === '' ? null : Number(form.verifyHours),
      })
      setSuccessMessage('Datos guardados.')
      router.refresh()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleToggle(next: boolean) {
    setServerError(null)
    try {
      await setBankTransferEnabled(next)
      router.refresh()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Error al actualizar')
    }
  }

  const noVerifyLimit = form.verifyHours.trim() === ''

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {account && (
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="font-semibold text-primary">Aceptar transferencias</p>
            <p className="text-sm text-muted-foreground">
              Tus clientas verán estos datos al reservar y podrán avisarte cuando transfieran.
            </p>
          </div>
          <Switch checked={account.isEnabled} onCheckedChange={handleToggle} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bt-holder">Titular</Label>
          <Input id="bt-holder" value={form.accountHolder} onChange={e => set('accountHolder', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-rut">RUT</Label>
          <Input id="bt-rut" value={form.rut} onChange={e => set('rut', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-bank">Banco</Label>
          <Input id="bt-bank" value={form.bankName} onChange={e => set('bankName', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-type">Tipo de cuenta</Label>
          <Input id="bt-type" value={form.accountType} onChange={e => set('accountType', e.target.value)} placeholder="corriente, vista, ahorro…" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-number">Número de cuenta</Label>
          <Input id="bt-number" value={form.accountNumber} onChange={e => set('accountNumber', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-email">Email para avisos (opcional)</Label>
          <Input id="bt-email" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bt-instructions">Instrucciones para la clienta (opcional)</Label>
        <Textarea id="bt-instructions" value={form.instructions} onChange={e => set('instructions', e.target.value)} rows={2} placeholder="Ej: poné tu nombre y la fecha de la reserva en el asunto" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bt-hold">Plazo para transferir (horas)</Label>
          <Input id="bt-hold" type="number" min={1} max={168} value={form.holdHours} onChange={e => set('holdHours', e.target.value)} required />
          <p className="text-xs text-muted-foreground">Cuánto tiempo se le reserva el horario a la clienta para que transfiera y te avise.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-verify">Plazo para verificar (horas)</Label>
          <Input id="bt-verify" type="number" min={1} max={720} value={form.verifyHours} onChange={e => set('verifyHours', e.target.value)} placeholder="vacío = sin límite" />
          {noVerifyLimit ? (
            <p className="text-xs text-orange-600">Vacío = sin límite: el horario queda retenido hasta que verifiques o rechaces la transferencia.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Cuánto tiempo tenés para verificar una transferencia declarada antes de que la reserva expire sola.</p>
          )}
        </div>
      </div>

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      {successMessage && <p className="text-sm text-green-600">{successMessage}</p>}

      <Button type="submit" disabled={isSubmitting} className="h-11">
        {isSubmitting ? 'Guardando…' : 'Guardar datos bancarios'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run tests/unit/bank-transfer-form.test.tsx`
Expected: PASS (3 tests). Si `Switch` de Radix no renderiza en static markup, el toggle igual aparece porque el texto "Aceptar transferencias" está fuera del portal — los asserts del test no dependen de internals de Radix.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/settings/payments/bank-transfer-form.tsx tests/unit/bank-transfer-form.test.tsx
git commit -m "feat(bank-transfer): form de settings de transferencia"
```

---

### Task 5: Integrar la sección en la página de Pagos

**Files:**
- Modify: `src/app/dashboard/settings/payments/page.tsx` (imports arriba; nueva Card después del cierre de la Card de Mercado Pago, línea ~155)

- [ ] **Step 1: Agregar la query y la Card**

En `src/app/dashboard/settings/payments/page.tsx`:

1. Imports nuevos:

```tsx
import { prisma } from '@/lib/db'
import { Landmark } from 'lucide-react'
import { BankTransferForm } from './bank-transfer-form'
```

2. Sumar la cuenta bancaria al `Promise.all` existente (línea ~32):

```tsx
  const [account, availability, bankAccount] = await Promise.all([
    getPaymentAccountStatus(),
    resolveOnlinePaymentAvailabilityForBusiness(businessId),
    prisma.bankTransferAccount.findUnique({ where: { businessId } }),
  ])
```

3. Después del `</Card>` de Mercado Pago (línea ~155), dentro del mismo `div.max-w-2xl`:

```tsx
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="size-5" />
              Transferencia bancaria
            </CardTitle>
            <CardDescription>
              Tus clientas ven estos datos al reservar, transfieren desde su banco y te avisan.
              Vos confirmás la reserva cuando veas la plata.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BankTransferForm
              account={
                bankAccount
                  ? {
                      accountHolder: bankAccount.accountHolder,
                      rut: bankAccount.rut,
                      bankName: bankAccount.bankName,
                      accountType: bankAccount.accountType,
                      accountNumber: bankAccount.accountNumber,
                      email: bankAccount.email,
                      instructions: bankAccount.instructions,
                      isEnabled: bankAccount.isEnabled,
                      holdHours: bankAccount.holdHours,
                      verifyHours: bankAccount.verifyHours,
                    }
                  : null
              }
            />
          </CardContent>
        </Card>
```

4. Actualizar el subtitle del header (línea ~43) para que no sea MP-only:

```tsx
      <DashboardHeader title="Pagos online" subtitle="Configura cómo tus clientas pagan el abono de sus reservas" />
```

- [ ] **Step 2: Verificar que la página compila y el suite completo queda verde**

Run: `npm test` (unit) y después `npm run test:integration`
Expected: todos los archivos de test PASS en ambos (si falla exactamente 1 test suelto no relacionado, re-correr: hay un flake conocido; si persiste, parar y revisar).

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/settings/payments/page.tsx
git commit -m "feat(bank-transfer): sección de transferencia en settings de Pagos"
```

---

### Task 6: Verificación final + PR

- [ ] **Step 1: Suite completo + lint**

```bash
npm test && npm run test:integration && npm run lint
```

Expected: tests verdes en ambos suites; lint sin errores nuevos.

- [ ] **Step 2: Push + PR**

```bash
git push -u origin claude/abono-transferencia
gh pr create --title "Transferencia bancaria PR A: modelo + settings" --body "$(cat <<'EOF'
## PR A de 3 — abono por transferencia bancaria

Spec: docs/superpowers/specs/2026-07-10-abono-transferencia-bancaria-design.md (§3, §9)

- Modelo `BankTransferAccount` (1:1 Business, texto plano) con ventanas `holdHours`/`verifyHours` configurables
- Columna `Booking.paymentMethod` (la consumen PR B/C)
- Sección "Transferencia bancaria" en Settings → Pagos: form + toggle habilitar
- **Inerte para clientas**: nada consume el modelo todavía (wizard = PR B, dashboard/cron = PR C)

Migración aplicada con `db execute` + `migrate resolve --applied` (patrón B4a).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR creado. **NO mergear** — lo decide el usuario.

---

## Notas para el implementador

- **Fuera de alcance de este PR**: el wizard, `declareBankTransfer`, el dashboard de verificación, el cron, las notificaciones. Nada de eso se toca acá (PRs B y C).
- Si `npx tsc --noEmit` muestra errores de `Property 'userId' does not exist on type Customer` u otros pre-existentes de drift del cliente Prisma, no son de este PR — comparar contra `git stash` si hay duda.
- La página de settings es un Server Component: la query de `bankTransferAccount` va directo con Prisma en la página (no hace falta una action de lectura).
