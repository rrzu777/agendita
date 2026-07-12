# Comprobante de transferencia (upload R2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que la clienta adjunte un comprobante (imagen/PDF) al declarar una transferencia (abono o saldo) y que la dueña lo vea desde el dashboard, con almacenamiento en Cloudflare R2 vía URLs prefirmadas.

**Architecture:** Subida directa navegador → R2 con presigned PUT; validación autoritativa server-side por `HEAD`; visualización owner-only por presigned GET de vida corta. La feature se auto-deshabilita si R2 no está configurado (gate `isProofUploadAvailable`). El comprobante es 1:1 con el `Payment` declarado (columnas `proofKey`/`proofContentType`). Setting por negocio `Business.requireTransferProof`.

**Tech Stack:** Next.js (fork), Prisma+Postgres, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, vitest, `renderToStaticMarkup` component tests.

**Spec:** `docs/superpowers/specs/2026-07-12-comprobante-transferencia-design.md`

---

## Convenciones de este repo (leer antes de empezar)

- **Landmine use-server:** los módulos `'use server'` exportan SOLO funciones async. Consts/schemas/tipos van en módulos lib planos (`src/lib/...`).
- **tsc no lo corre vitest/lint:** antes de push correr `npx tsc --noEmit 2>&1 | grep '^src/'` (debe salir vacío).
- **Component tests:** `renderToStaticMarkup` + `vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))`.
- **DB de integración:** Postgres local en Docker, puerto 5433. Correr con:
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration`
- **Migración a DB compartida:** aplicar con `db execute` + `migrate resolve --applied` (landmine [[migrate-via-db-execute-needs-resolve]]); el worktree no tiene `.env` — cargar `set -a; source /Users/robertozamorautrera/Projects/agendita/.env.local; set +a`.
- **Comandos base:** `npm run test:unit`, `npm run lint`, `npm run build`.

## File Structure

**Nuevos:**
- `src/lib/storage/proof.ts` — consts + helpers puros (allowlist, tamaño máx, derivación de clave). Sin deps de red.
- `src/lib/storage/r2.ts` — cliente S3 + interface `ProofStorage` + `getProofStorage()` + `isProofUploadAvailable()`.
- `src/app/dashboard/transfers/proof/[paymentId]/route.ts` — route handler GET owner-only (presigned GET + redirect).

**Modificados:** `prisma/schema.prisma` (+migración), `package.json`, `src/lib/env.ts`, `src/lib/rate-limit.ts`, `src/lib/bank-transfer/public-info.ts`, `src/server/actions/bank-transfer-public.ts`, `src/server/actions/bank-transfer-settings.ts`, `src/app/dashboard/settings/payments/{page.tsx,bank-transfer-form.tsx}`, `src/components/booking/transfer-details.tsx`, `src/components/booking/step-payment.tsx`, `src/app/book/confirmation/{page.tsx,transfer-panel.tsx}`, `src/lib/payments/{confirmation-state.ts,balance-confirmation-state.ts}`, `src/server/actions/bookings.ts`, `src/app/dashboard/bookings/page.tsx`, `src/components/dashboard/{pending-transfers-section.tsx,verify-transfer-dialog.tsx}`, `src/lib/notifications/{types.ts,templates.ts,email-provider.ts}`.

---

## Task 1: Migración + schema

**Files:**
- Modify: `prisma/schema.prisma` (model `Business` ~línea 46; model `Payment` ~línea 436-463)
- Create: `prisma/migrations/20260712130000_add_transfer_proof/migration.sql`

- [ ] **Step 1: Agregar campos al schema**

En `model Business` agregar:
```prisma
  requireTransferProof Boolean @default(false)
```
En `model Payment` (junto a `paymentMethod`) agregar:
```prisma
  proofKey         String?
  proofContentType String?
```

- [ ] **Step 2: Escribir la migración a mano**

Crear `prisma/migrations/20260712130000_add_transfer_proof/migration.sql`:
```sql
ALTER TABLE "Business" ADD COLUMN "requireTransferProof" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN "proofKey" TEXT;
ALTER TABLE "Payment" ADD COLUMN "proofContentType" TEXT;
```
(Escribir a mano, NO `migrate diff` — la DB compartida arrastra migraciones de ramas hermanas; ver [[migrate-diff-picks-up-sibling-branches]].)

- [ ] **Step 3: Regenerar el client + aplicar a la DB de test**

```bash
npx prisma generate
set -a; source /Users/robertozamorautrera/Projects/agendita/.env.local; set +a
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npx prisma migrate deploy
```
Expected: `Applying migration 20260712130000_add_transfer_proof` sin errores.

- [ ] **Step 4: Aplicar a la DB compartida (Supabase) + resolver**

```bash
npx prisma db execute --file prisma/migrations/20260712130000_add_transfer_proof/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20260712130000_add_transfer_proof
```
Expected: sin errores. (Salta `migrate resolve` rompe el vercel-build; ver landmine.)

- [ ] **Step 5: Verificar tsc**

Run: `npx tsc --noEmit 2>&1 | grep '^src/'`
Expected: vacío (el client regenerado ya conoce los campos).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260712130000_add_transfer_proof/
git commit -m "feat(proof): schema + migración proofKey/proofContentType + requireTransferProof"
```

---

## Task 2: Helpers puros de comprobante (`proof.ts`)

**Files:**
- Create: `src/lib/storage/proof.ts`
- Test: `tests/unit/proof-helpers.test.ts`

- [ ] **Step 1: Escribir el test que falla**

`tests/unit/proof-helpers.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { PROOF_ALLOWED_TYPES, PROOF_MAX_BYTES, proofKey, isAllowedProofType } from '@/lib/storage/proof'

describe('proof helpers', () => {
  it('allowlist cubre imágenes comunes + pdf, no otros', () => {
    expect(isAllowedProofType('image/jpeg')).toBe(true)
    expect(isAllowedProofType('image/png')).toBe(true)
    expect(isAllowedProofType('image/webp')).toBe(true)
    expect(isAllowedProofType('application/pdf')).toBe(true)
    expect(isAllowedProofType('image/gif')).toBe(false)
    expect(isAllowedProofType('text/html')).toBe(false)
    expect(isAllowedProofType('')).toBe(false)
  })
  it('PROOF_MAX_BYTES = 5 MiB', () => {
    expect(PROOF_MAX_BYTES).toBe(5 * 1024 * 1024)
  })
  it('proofKey es determinístico por negocio+reserva+tipo', () => {
    expect(proofKey('biz1', 'bk1', 'deposit')).toBe('proofs/biz1/bk1/deposit')
    expect(proofKey('biz1', 'bk1', 'balance')).toBe('proofs/biz1/bk1/balance')
  })
  it('PROOF_ALLOWED_TYPES es readonly y no vacío', () => {
    expect(PROOF_ALLOWED_TYPES.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm run test:unit -- proof-helpers`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

`src/lib/storage/proof.ts`:
```ts
// Consts + helpers puros del comprobante de transferencia. Sin deps de red:
// lo importan tanto el cliente R2 como los server actions y los tests.

export const PROOF_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

export type ProofContentType = (typeof PROOF_ALLOWED_TYPES)[number]

export const PROOF_MAX_BYTES = 5 * 1024 * 1024 // 5 MiB

export type ProofKind = 'deposit' | 'balance'

export function isAllowedProofType(t: string): t is ProofContentType {
  return (PROOF_ALLOWED_TYPES as readonly string[]).includes(t)
}

/** Clave determinística en R2. Re-subir sobrescribe el mismo objeto. */
export function proofKey(businessId: string, bookingId: string, kind: ProofKind): string {
  return `proofs/${businessId}/${bookingId}/${kind}`
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm run test:unit -- proof-helpers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/proof.ts tests/unit/proof-helpers.test.ts
git commit -m "feat(proof): helpers puros (allowlist, tamaño, clave)"
```

---

## Task 3: Cliente R2 (`r2.ts`) + deps + env

**Files:**
- Modify: `package.json` (deps)
- Create: `src/lib/storage/r2.ts`
- Modify: `src/lib/env.ts` (bloque de validación ~línea 218, estilo Resend)
- Test: `tests/unit/r2-storage.test.ts`

- [ ] **Step 1: Instalar el SDK**

```bash
npm install @aws-sdk/client-s3@^3 @aws-sdk/s3-request-presigner@^3
```

- [ ] **Step 2: Escribir el test que falla**

`tests/unit/r2-storage.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ORIGINAL = { ...process.env }
afterEach(() => { process.env = { ...ORIGINAL }; vi.resetModules() })
beforeEach(() => vi.resetModules())

describe('isProofUploadAvailable', () => {
  it('false si falta alguna env de R2', async () => {
    delete process.env.R2_ACCOUNT_ID
    const { isProofUploadAvailable } = await import('@/lib/storage/r2')
    expect(isProofUploadAvailable()).toBe(false)
  })
  it('true con las 4 envs presentes', async () => {
    process.env.R2_ACCOUNT_ID = 'acct'
    process.env.R2_ACCESS_KEY_ID = 'ak'
    process.env.R2_SECRET_ACCESS_KEY = 'sk'
    process.env.R2_BUCKET = 'bucket'
    const { isProofUploadAvailable } = await import('@/lib/storage/r2')
    expect(isProofUploadAvailable()).toBe(true)
  })
  it('getProofStorage devuelve null si R2 no está configurado', async () => {
    delete process.env.R2_BUCKET
    const { getProofStorage } = await import('@/lib/storage/r2')
    expect(getProofStorage()).toBeNull()
  })
})

describe('ProofStorage presign', () => {
  it('presignUpload delega en getSignedUrl con PutObjectCommand', async () => {
    process.env.R2_ACCOUNT_ID = 'acct'
    process.env.R2_ACCESS_KEY_ID = 'ak'
    process.env.R2_SECRET_ACCESS_KEY = 'sk'
    process.env.R2_BUCKET = 'bucket'
    const getSignedUrl = vi.fn().mockResolvedValue('https://signed.example/put')
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }))
    const { getProofStorage } = await import('@/lib/storage/r2')
    const url = await getProofStorage()!.presignUpload('proofs/b/k/deposit', 'image/png')
    expect(url).toBe('https://signed.example/put')
    expect(getSignedUrl).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 3: Correr y ver fallar**

Run: `npm run test:unit -- r2-storage`
Expected: FAIL (módulo no existe).

- [ ] **Step 4: Implementar `r2.ts`**

`src/lib/storage/r2.ts`:
```ts
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { logger } from '@/lib/logger'

export interface ProofStorage {
  presignUpload(key: string, contentType: string): Promise<string>
  presignDownload(key: string, contentType: string): Promise<string>
  head(key: string): Promise<{ contentLength: number; contentType: string | null } | null>
}

interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

function readConfig(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return { accountId, accessKeyId, secretAccessKey, bucket }
}

/** never-throws: para gatear la feature en UI y actions. */
export function isProofUploadAvailable(): boolean {
  return readConfig() !== null
}

/** null si R2 no está configurado (mirror de getResend()). */
export function getProofStorage(): ProofStorage | null {
  const cfg = readConfig()
  if (!cfg) return null
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
  return {
    async presignUpload(key, contentType) {
      return getSignedUrl(client, new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType }), { expiresIn: 120 })
    },
    async presignDownload(key, contentType) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          ResponseContentType: contentType,
          ResponseContentDisposition: 'inline; filename="comprobante"',
        }),
        { expiresIn: 60 },
      )
    },
    async head(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }))
        return { contentLength: r.ContentLength ?? 0, contentType: r.ContentType ?? null }
      } catch (e) {
        // NotFound / 404 → el objeto no existe. Cualquier otro error también
        // se trata como "no verificable" (el caller rechaza el declare).
        logger.warn('r2 head failed', { key, error: e instanceof Error ? e.message : String(e) })
        return null
      }
    },
  }
}
```

- [ ] **Step 5: Agregar la validación de env (estilo Resend, warning pareado)**

En `src/lib/env.ts`, dentro de `validateEnv()` (junto al bloque de Resend ~línea 218-236), agregar:
```ts
  // R2 (comprobantes de transferencia): opcional; la feature se auto-deshabilita
  // si falta. Warning pareado si hay parcial (probable error de config).
  const r2Keys = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
  const r2Present = r2Keys.filter((k) => !!process.env[k])
  if (r2Present.length > 0 && r2Present.length < r2Keys.length) {
    warnings.push(
      `Config de R2 incompleta (${r2Present.length}/${r2Keys.length}). La subida de comprobantes queda deshabilitada hasta setear: ${r2Keys.join(', ')}.`,
    )
  }
```
(Ajustar el nombre exacto del array de warnings a lo que use `validateEnv` — es `warnings`.)

- [ ] **Step 6: Correr y ver pasar**

Run: `npm run test:unit -- r2-storage`
Expected: PASS.

- [ ] **Step 7: Verificar tsc + commit**

```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add package.json package-lock.json src/lib/storage/r2.ts src/lib/env.ts tests/unit/r2-storage.test.ts
git commit -m "feat(proof): cliente R2 (presign PUT/GET, HEAD) + gate isProofUploadAvailable + env"
```

---

## Task 4: `createProofUploadUrl` + `getBankTransferInfo` ensanchado

**Files:**
- Modify: `src/lib/rate-limit.ts:39-49` (bucket)
- Modify: `src/lib/bank-transfer/public-info.ts` (tipo)
- Modify: `src/server/actions/bank-transfer-public.ts` (getBankTransferInfo + createProofUploadUrl)
- Test: `tests/integration/proof-upload-url.test.ts`

- [ ] **Step 1: Agregar el bucket de rate-limit**

En `src/lib/rate-limit.ts`, dentro de `RATE_LIMITS` (línea 39-49) agregar:
```ts
  'proof-upload-url': { maxRequests: 20, windowMs: 60_000 },
```

- [ ] **Step 2: Ensanchar `BankTransferPublicInfo`**

En `src/lib/bank-transfer/public-info.ts` cambiar el tipo exportado:
```ts
export type BankTransferPublicInfo = Prisma.BankTransferAccountGetPayload<{
  select: typeof BANK_TRANSFER_PUBLIC_SELECT
}> & { requireProof: boolean }
```

- [ ] **Step 3: Escribir el test de integración que falla**

`tests/integration/proof-upload-url.test.ts` (usa el patrón de `tests/integration/bank-transfer-public.test.ts`; inyecta un `ProofStorage` fake vía `deps`):
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { createProofUploadUrl } from '@/server/actions/bank-transfer-public'
// ...seed helpers del archivo bank-transfer-public.test.ts (negocio + bankTransferAccount isEnabled + booking pending_payment paymentMethod Transferencia)

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))

const fakeStorage = { presignUpload: vi.fn().mockResolvedValue('https://signed/put'), presignDownload: vi.fn(), head: vi.fn() }

describe('createProofUploadUrl', () => {
  it('devuelve uploadUrl + key para una reserva-transferencia elegible', async () => {
    const { bookingId, businessId } = await seedTransferBooking() // helper del test
    const res = await createProofUploadUrl(bookingId, 'deposit', 'image/png', { storage: fakeStorage })
    expect(res.key).toBe(`proofs/${businessId}/${bookingId}/deposit`)
    expect(res.uploadUrl).toBe('https://signed/put')
    expect(fakeStorage.presignUpload).toHaveBeenCalledWith(`proofs/${businessId}/${bookingId}/deposit`, 'image/png')
  })
  it('rechaza content-type no permitido', async () => {
    const { bookingId } = await seedTransferBooking()
    await expect(createProofUploadUrl(bookingId, 'deposit', 'image/gif', { storage: fakeStorage })).rejects.toThrow()
  })
  it('rechaza si R2 no está disponible (deps sin storage y env ausente)', async () => {
    const { bookingId } = await seedTransferBooking()
    await expect(createProofUploadUrl(bookingId, 'deposit', 'image/png', { storage: null })).rejects.toThrow()
  })
})
```

- [ ] **Step 4: Correr y ver fallar**

Run el comando de integración (ver Convenciones). Expected: FAIL (`createProofUploadUrl` no existe).

- [ ] **Step 5: Implementar en `bank-transfer-public.ts`**

Imports nuevos al tope:
```ts
import { getProofStorage, isProofUploadAvailable, type ProofStorage } from '@/lib/storage/r2'
import { proofKey, isAllowedProofType, type ProofKind } from '@/lib/storage/proof'
```
Ensanchar `getBankTransferInfo` (reemplaza el cuerpo actual, líneas 21-26):
```ts
export async function getBankTransferInfo(businessId: string): Promise<BankTransferPublicInfo | null> {
  const row = await prisma.bankTransferAccount.findFirst({
    where: { businessId, isEnabled: true },
    select: { ...BANK_TRANSFER_PUBLIC_SELECT, business: { select: { requireTransferProof: true } } },
  })
  if (!row) return null
  const { business, ...rest } = row
  return { ...rest, requireProof: business.requireTransferProof && isProofUploadAvailable() }
}
```
(Nota: `requireProof` se apaga si R2 no está disponible, aunque la dueña lo haya activado — cierra el gate de disponibilidad en el server.)

Agregar el action de presign:
```ts
type ProofDeps = { storage?: ProofStorage | null }

/** Mina una URL PUT prefirmada para subir el comprobante ANTES de declarar.
 *  Público: identidad = bookingId (cuid) + rate limit, igual que declare*. */
export async function createProofUploadUrl(
  bookingId: string,
  kind: ProofKind,
  contentType: string,
  deps: ProofDeps = {},
): Promise<{ uploadUrl: string; key: string }> {
  const limit = await checkRateLimit('proof-upload-url', 20, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')

  if (!isAllowedProofType(contentType)) throw new Error('Tipo de archivo no permitido.')

  const storage = deps.storage !== undefined ? deps.storage : getProofStorage()
  if (!storage) throw new Error('La subida de comprobantes no está disponible.')

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, businessId: true, status: true, paymentMethod: true, remainingBalance: true },
  })
  if (!booking) throw new Error('Reserva no encontrada')

  // Elegibilidad mínima por kind (el declare re-valida en profundidad).
  if (kind === 'deposit' && booking.paymentMethod !== BANK_TRANSFER_METHOD) {
    throw new Error('Esta reserva no eligió pago por transferencia')
  }
  if (kind === 'balance' && booking.remainingBalance <= 0) {
    throw new Error('Esta reserva no tiene saldo pendiente.')
  }

  const key = proofKey(booking.businessId, booking.id, kind)
  const uploadUrl = await storage.presignUpload(key, contentType)
  return { uploadUrl, key }
}
```

- [ ] **Step 6: Correr y ver pasar**

Run integración. Expected: PASS.

- [ ] **Step 7: tsc + commit**

```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/lib/rate-limit.ts src/lib/bank-transfer/public-info.ts src/server/actions/bank-transfer-public.ts tests/integration/proof-upload-url.test.ts
git commit -m "feat(proof): createProofUploadUrl + requireProof en getBankTransferInfo"
```

---

## Task 5: `proofKey` en declare + `attachProof` + HEAD de validación

**Files:**
- Modify: `src/server/actions/bank-transfer-public.ts` (declareBankTransfer, declareBalanceTransfer, nuevo attachProof)
- Test: `tests/integration/proof-declare.test.ts`

- [ ] **Step 1: Escribir el test que falla**

`tests/integration/proof-declare.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { declareBankTransfer, attachProof } from '@/server/actions/bank-transfer-public'

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/notifications', async (orig) => ({ ...(await orig()), sendMultiNotificationSafely: vi.fn() }))

const okHead = { presignUpload: vi.fn(), presignDownload: vi.fn(), head: vi.fn().mockResolvedValue({ contentLength: 1000, contentType: 'image/png' }) }
const bigHead = { ...okHead, head: vi.fn().mockResolvedValue({ contentLength: 99_000_000, contentType: 'image/png' }) }

describe('declare con proofKey', () => {
  it('guarda proofKey/proofContentType tras HEAD ok', async () => {
    const { bookingId, businessId } = await seedTransferBooking()
    const key = `proofs/${businessId}/${bookingId}/deposit`
    await declareBankTransfer(bookingId, { proofKey: key, proofContentType: 'image/png', storage: okHead })
    const p = await prisma.payment.findFirst({ where: { bookingId, providerPaymentId: `bt-declared:${bookingId}` } })
    expect(p?.proofKey).toBe(key)
    expect(p?.proofContentType).toBe('image/png')
  })
  it('rechaza si el HEAD reporta tamaño > 5MB', async () => {
    const { bookingId, businessId } = await seedTransferBooking()
    const key = `proofs/${businessId}/${bookingId}/deposit`
    await expect(declareBankTransfer(bookingId, { proofKey: key, proofContentType: 'image/png', storage: bigHead })).rejects.toThrow()
  })
  it('gate requireTransferProof: rechaza declare sin proofKey', async () => {
    const { bookingId } = await seedTransferBooking({ requireTransferProof: true })
    await expect(declareBankTransfer(bookingId, {})).rejects.toThrow()
  })
})

describe('attachProof', () => {
  it('adjunta a un Payment ya declarado (pending)', async () => {
    const { bookingId, businessId } = await seedTransferBooking()
    await declareBankTransfer(bookingId, {}) // requireProof off → declara sin comprobante
    const key = `proofs/${businessId}/${bookingId}/deposit`
    await attachProof(bookingId, 'deposit', { proofKey: key, proofContentType: 'image/png', storage: okHead })
    const p = await prisma.payment.findFirst({ where: { bookingId, providerPaymentId: `bt-declared:${bookingId}` } })
    expect(p?.proofKey).toBe(key)
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

Run integración. Expected: FAIL (firma vieja / `attachProof` no existe).

- [ ] **Step 3: Implementar el HEAD de validación compartido + gate**

En `bank-transfer-public.ts`, helper interno (no exportado como no-función… es función async, ok exportarla no; dejarla module-scope):
```ts
import { PROOF_MAX_BYTES, isAllowedProofType } from '@/lib/storage/proof'

type DeclareProofOpts = { proofKey?: string; proofContentType?: string; storage?: ProofStorage | null }

/** Valida por HEAD que el objeto existe, pesa ≤ límite y es de tipo permitido.
 *  Devuelve { proofKey, proofContentType } para persistir, o null si no hubo proof. */
async function validateProof(kind: ProofKind, businessId: string, bookingId: string, opts: DeclareProofOpts) {
  if (!opts.proofKey) return null
  const expected = proofKey(businessId, bookingId, kind)
  if (opts.proofKey !== expected) throw new Error('Comprobante inválido.')
  if (!opts.proofContentType || !isAllowedProofType(opts.proofContentType)) throw new Error('Tipo de comprobante no permitido.')
  const storage = opts.storage !== undefined ? opts.storage : getProofStorage()
  if (!storage) throw new Error('La subida de comprobantes no está disponible.')
  const meta = await storage.head(opts.proofKey)
  if (!meta) throw new Error('No encontramos el comprobante subido. Reintentá.')
  if (meta.contentLength > PROOF_MAX_BYTES) throw new Error('El comprobante supera el tamaño máximo (5 MB).')
  if (meta.contentType && !isAllowedProofType(meta.contentType)) throw new Error('Tipo de comprobante no permitido.')
  return { proofKey: opts.proofKey, proofContentType: opts.proofContentType }
}
```

- [ ] **Step 4: Enchufar en `declareBankTransfer`**

Cambiar la firma a `declareBankTransfer(bookingId: string, opts: DeclareProofOpts = {})`. Dentro de la tx, después de cargar `booking` y validar `account`:
```ts
    // Gate configurable: si el negocio exige comprobante, no se declara sin uno.
    const proof = await validateProof('deposit', booking.businessId, bookingId, opts)
    if (booking.business.requireTransferProof && !proof) {
      throw new Error('Este negocio exige adjuntar el comprobante para declarar la transferencia.')
    }
```
(El `validateProof` hace el HEAD — es I/O de red; llamarlo ANTES de abrir la `$transaction`, guardando el resultado, para no tener red dentro de la tx. Reestructurar: computar `proof` antes de `prisma.$transaction`, pasando `booking.businessId`… pero businessId sale del booking. Alternativa: hacer un `findUnique` liviano de `{businessId, requireTransferProof}` antes de la tx, validar el proof, y recién abrir la tx. Ver Step 5.)

- [ ] **Step 5: Reestructura anti-red-en-tx (patrón para ambos declares)**

Antes del `prisma.$transaction`, agregar:
```ts
  const pre = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { businessId: true, business: { select: { requireTransferProof: true } } },
  })
  if (!pre) throw new Error('Reserva no encontrada')
  const proof = await validateProof('deposit', pre.businessId, bookingId, opts)
  if (pre.business.requireTransferProof && !proof) {
    throw new Error('Este negocio exige adjuntar el comprobante para declarar la transferencia.')
  }
```
Y en los `payment.create` / `payment.update` (create nuevo y reactivación) agregar los campos:
```ts
        proofKey: proof?.proofKey ?? null,
        proofContentType: proof?.proofContentType ?? null,
```
En la reactivación (update, líneas ~99-102) incluir esos dos campos también — así una re-declaración limpia el proof viejo o setea el nuevo.

- [ ] **Step 6: Repetir en `declareBalanceTransfer`** (mismo patrón, `kind='balance'`, usando `booking.remainingBalance`), agregando `proofKey`/`proofContentType` al create y al update de reactivación.

- [ ] **Step 7: Implementar `attachProof`**

```ts
/** Adjunta/reemplaza el comprobante de un Payment declarado (pending), sin re-declarar. */
export async function attachProof(bookingId: string, kind: ProofKind, opts: DeclareProofOpts): Promise<{ ok: true }> {
  const limit = await checkRateLimit('proof-upload-url', 20, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { businessId: true } })
  if (!booking) throw new Error('Reserva no encontrada')
  const proof = await validateProof(kind, booking.businessId, bookingId, opts)
  if (!proof) throw new Error('Falta el comprobante.')
  const providerPaymentId = kind === 'balance' ? btBalanceId(bookingId) : btDeclaredId(bookingId)
  const { count } = await prisma.payment.updateMany({
    where: { bookingId, provider: 'manual', providerPaymentId, status: 'pending' },
    data: { proofKey: proof.proofKey, proofContentType: proof.proofContentType },
  })
  if (count === 0) throw new Error('No hay una transferencia declarada pendiente para adjuntar el comprobante.')
  return { ok: true }
}
```

- [ ] **Step 8: Correr y ver pasar**

Run integración. Expected: PASS. Correr también `tests/integration/bank-transfer-public.test.ts` y `balance-transfer.test.ts` (las firmas cambiaron con default `= {}` → deben seguir verdes).

- [ ] **Step 9: tsc + commit**

```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/server/actions/bank-transfer-public.ts tests/integration/proof-declare.test.ts
git commit -m "feat(proof): proofKey en declares (HEAD validado + gate) + attachProof"
```

---

## Task 6: `setRequireTransferProof` + checkbox en Ajustes (gated)

**Files:**
- Modify: `src/server/actions/bank-transfer-settings.ts` (nuevo action)
- Modify: `src/app/dashboard/settings/payments/page.tsx` (seed + gate)
- Modify: `src/app/dashboard/settings/payments/bank-transfer-form.tsx` (checkbox)
- Test: `tests/integration/require-transfer-proof.test.ts`, `tests/unit/bank-transfer-form-proof.test.tsx`

- [ ] **Step 1: Test de integración del action**

`tests/integration/require-transfer-proof.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { setRequireTransferProof } from '@/server/actions/bank-transfer-settings'

vi.mock('@/lib/auth/server', () => ({ requireBusinessRole: vi.fn().mockResolvedValue({ businessId: globalThis.__bizId }) }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

describe('setRequireTransferProof', () => {
  it('persiste el flag en Business', async () => {
    const biz = await prisma.business.create({ data: { /* mínimos del helper existente */ } as never })
    globalThis.__bizId = biz.id
    await setRequireTransferProof(true)
    const after = await prisma.business.findUnique({ where: { id: biz.id } })
    expect(after?.requireTransferProof).toBe(true)
  })
})
```
(Usar el helper de seed de negocio que ya usan otros tests de integración en lugar del literal.)

- [ ] **Step 2: Correr y ver fallar** → FAIL (action no existe).

- [ ] **Step 3: Implementar el action**

En `bank-transfer-settings.ts` agregar:
```ts
export async function setRequireTransferProof(value: boolean) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('set-bank-transfer-enabled', 20, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  await prisma.business.update({ where: { id: businessId }, data: { requireTransferProof: value } })
  revalidatePath('/dashboard/settings/payments')
}
```

- [ ] **Step 4: Correr y ver pasar** → PASS.

- [ ] **Step 5: Component test del checkbox (gated)**

`tests/unit/bank-transfer-form-proof.test.tsx`: renderiza `BankTransferForm` con `proofUploadAvailable={true}` y verifica que aparece el texto "Exigir comprobante"; con `proofUploadAvailable={false}` verifica que NO aparece. (Mock de `next/navigation` + del action `@/server/actions/bank-transfer-settings`.)

- [ ] **Step 6: Implementar en el form + page**

En `page.tsx` (server): leer `userData.business.requireTransferProof` y `isProofUploadAvailable()`, pasar props `requireProof` y `proofUploadAvailable` al `<BankTransferForm>`.
En `bank-transfer-form.tsx`: si `proofUploadAvailable`, renderizar un `Switch`/checkbox "Exigir comprobante al declarar transferencia" ligado a `setRequireTransferProof`; sembrado con `requireProof`. Si `!proofUploadAvailable`, no renderizar el control (gate de disponibilidad).

- [ ] **Step 7: tsc + correr ambos tests + commit**

```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/server/actions/bank-transfer-settings.ts src/app/dashboard/settings/payments/ tests/integration/require-transfer-proof.test.ts tests/unit/bank-transfer-form-proof.test.tsx
git commit -m "feat(proof): setting requireTransferProof en Ajustes (gated por disponibilidad de R2)"
```

---

## Task 7: Control de adjunto en `TransferDetails`

**Files:**
- Modify: `src/components/booking/transfer-details.tsx`
- Test: `tests/unit/transfer-details-proof.test.tsx`

- [ ] **Step 1: Component test que falla**

`tests/unit/transfer-details-proof.test.tsx` (mock `next/navigation`):
```ts
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
import { TransferDetails } from '@/components/booking/transfer-details'

const bank = { accountHolder: 'Ana', rut: '1-9', bankName: 'X', accountType: 'CC', accountNumber: '123', email: null, instructions: null, holdHours: 24, requireProof: true } as never

describe('TransferDetails con comprobante', () => {
  it('requireProof=true deshabilita "Ya transferí" hasta subir', () => {
    const html = renderToStaticMarkup(
      <TransferDetails bank={bank} amount={1000} deadline={null} timezone="America/Santiago" declaring={false} onDeclare={() => {}} bookingId="b1" kind="deposit" />,
    )
    expect(html).toContain('Comprobante')
    // botón deshabilitado (sin proof subido)
    expect(html).toMatch(/disabled/)
  })
})
```

- [ ] **Step 2: Correr y ver fallar** → FAIL (props nuevas no existen).

- [ ] **Step 3: Implementar el control**

Agregar props a `TransferDetails`: `bookingId: string` (para presign/declare) y usar `bank.requireProof`. Estado interno con `useState` (convertir el componente para manejar la subida): archivo seleccionado, subiendo, key subida, error. Flujo:
- `<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf">`.
- onChange: validar tipo (`isAllowedProofType`) + tamaño (`PROOF_MAX_BYTES`) client-side; si ok, llamar `createProofUploadUrl(bookingId, kind, file.type)` → `fetch(uploadUrl, { method:'PUT', body:file, headers:{'Content-Type': file.type} })` → al 200, guardar `key` + `file.type` en estado y mostrar "Comprobante cargado ✓".
- El botón "Ya transferí" pasa la key al handler: cambiar `onDeclare` a `onDeclare(proof?: { proofKey; proofContentType })` **o** exponer la key vía callback. Simplest: `TransferDetails` recibe `onDeclare: (proof: { proofKey: string; proofContentType: string } | null) => void` y arma el objeto con su estado interno.
- `disabled` del botón: `declaring || (bank.requireProof && !uploadedKey)`.
- Si `!bank.requireProof`, el input es opcional (texto "Adjuntar comprobante (opcional)").

(Este componente pasa de presentacional puro a stateful. Mantener los datos bancarios/rows como están; sumar la sección de adjunto arriba del botón.)

- [ ] **Step 4: Correr y ver pasar** → PASS. Correr también `tests/unit/transfer-details-balance.test.tsx` (existente) y ajustar si la firma de `onDeclare` cambió.

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/components/booking/transfer-details.tsx tests/unit/transfer-details-proof.test.tsx
git commit -m "feat(proof): control de adjunto en TransferDetails (presign+PUT+gate)"
```

---

## Task 8: Enhebrar en wizard + confirmation panel

**Files:**
- Modify: `src/components/booking/step-payment.tsx` (:311 handleDeclare, :549 render)
- Modify: `src/app/book/confirmation/transfer-panel.tsx`
- Test: manual (los component tests de Task 7 cubren TransferDetails; acá es plumbing de tipos)

- [ ] **Step 1: `transfer-panel.tsx`** — pasar `bookingId` (ya lo tiene) y adaptar `onDeclare` a la nueva firma que recibe `proof`:
```ts
async function handleDeclare(proof: { proofKey: string; proofContentType: string } | null) {
  await (kind === 'balance'
    ? declareBalanceTransfer(bookingId, proof ?? {})
    : declareBankTransfer(bookingId, proof ?? {}))
  router.refresh()
}
```
Pasar `bookingId` a `TransferDetails` (ya se pasa `bank/amount/...`).

- [ ] **Step 2: `step-payment.tsx`** — `handleDeclare` (línea 306-318) pasa a recibir `proof` y reenviarlo:
```ts
async function handleDeclare(proof: { proofKey: string; proofContentType: string } | null) {
  if (!transferBooking) return
  // ...
  await declareBankTransfer(transferBooking.id, proof ?? {})
  // ...
}
```
Y en el `<TransferDetails ... />` (línea 549) pasar `bookingId={transferBooking.id}`.

- [ ] **Step 3: Verificar build/tsc**

Run: `npx tsc --noEmit 2>&1 | grep '^src/'`  → vacío.
Run: `npm run test:unit -- transfer-details step-payment` (los que existan) → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/booking/step-payment.tsx src/app/book/confirmation/transfer-panel.tsx
git commit -m "feat(proof): enhebrar bookingId+proof en wizard y confirmation panel"
```

---

## Task 9: "Comprobante adjuntado ✓" para la clienta

**Files:**
- Modify: `src/lib/payments/confirmation-state.ts` + `src/lib/payments/balance-confirmation-state.ts`
- Modify: `src/app/book/confirmation/page.tsx` (:40-44 select + render)
- Test: `tests/unit/confirmation-proof-state.test.ts`

- [ ] **Step 1: Test que falla** — `deriveBalanceState` expone si el pago pending tiene proof:
```ts
import { describe, it, expect } from 'vitest'
import { deriveBalanceState } from '@/lib/payments/balance-confirmation-state'

it('verifying con proofKey marca hasProof', () => {
  const s = deriveBalanceState({
    status: 'confirmed', remainingBalance: 5000,
    payments: [{ status: 'pending', providerPaymentId: 'bt-balance:b1', amount: 5000, proofKey: 'proofs/x/b1/balance' }],
  } as never)
  expect(s.verifying).toBe(true)
  expect(s.payment?.hasProof).toBe(true)
})
```

- [ ] **Step 2: Correr y ver fallar** → FAIL.

- [ ] **Step 3: Implementar** — en `balance-confirmation-state.ts` ensanchar el input `payments` con `proofKey?: string | null` y el `payment` de retorno con `hasProof: boolean` (`payment.proofKey != null`). En `confirmation-state.ts` no hace falta cambiar el enum; si se quiere el indicador para el abono, ensanchar `DeriveInput.payments` con `proofKey?` y exponer un helper `hasDeclaredProof(input)` — pero **mínimo**: basta con el balance + leer el proof del pago bt-declared en la page. Para el abono, la page ya deriva `verifying_transfer`; agregar el "✓" leyendo el Payment bt-declared con `proofKey` del select.

- [ ] **Step 4: page.tsx** — en el `select` de `booking.payments` (línea 43) agregar `proofKey: true`. En los bloques de render de "en verificación" (abono y saldo) mostrar "Comprobante adjuntado ✓" cuando el Payment pending tenga `proofKey`.

- [ ] **Step 5: Correr y ver pasar** → PASS. Correr `confirmation-balance-state.test.ts` existente → verde.

- [ ] **Step 6: tsc + commit**

```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/lib/payments/ src/app/book/confirmation/page.tsx tests/unit/confirmation-proof-state.test.ts
git commit -m "feat(proof): indicador 'comprobante adjuntado' para la clienta"
```

---

## Task 10: Ruta de visualización owner-only + lectura en dashboard

**Files:**
- Create: `src/app/dashboard/transfers/proof/[paymentId]/route.ts`
- Modify: `src/server/actions/bookings.ts:196` (select)
- Modify: `src/app/dashboard/bookings/page.tsx:226-242` (map)
- Modify: `src/components/dashboard/pending-transfers-section.tsx:14-24` (interface + botón)
- Modify: `src/components/dashboard/verify-transfer-dialog.tsx` (embed/enlace)
- Test: `tests/integration/proof-view-route.test.ts`, `tests/unit/pending-transfers-proof.test.tsx`

- [ ] **Step 1: Select en `getBookings`** — en `bookings.ts:196` agregar al select de `payments`:
```ts
        select: { id: true, amount: true, createdAt: true, providerPaymentId: true, proofKey: true, proofContentType: true },
```

- [ ] **Step 2: Map en `dashboard/bookings/page.tsx`** — en el `flatMap` que arma `PendingTransferItem` (líneas 226-242) agregar `proofKey: p.proofKey, proofContentType: p.proofContentType`.

- [ ] **Step 3: Interface** — en `pending-transfers-section.tsx:14-24` agregar al `PendingTransferItem`:
```ts
  proofKey: string | null
  proofContentType: string | null
```

- [ ] **Step 4: Route handler (test que falla primero)**

`tests/integration/proof-view-route.test.ts`: verifica 404 si el Payment no es del negocio de la sesión, y redirect (302) con presigned URL si sí. (Mock de auth + de `getProofStorage` con `presignDownload` fake.)

Implementar `src/app/dashboard/transfers/proof/[paymentId]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { getProofStorage } from '@/lib/storage/r2'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { businessId: true, proofKey: true, proofContentType: true },
  })
  if (!payment || payment.businessId !== businessId || !payment.proofKey) {
    return new NextResponse('No encontrado', { status: 404 })
  }
  const storage = getProofStorage()
  if (!storage) return new NextResponse('No disponible', { status: 404 })
  const url = await storage.presignDownload(payment.proofKey, payment.proofContentType ?? 'application/octet-stream')
  return NextResponse.redirect(url)
}
```
(Confirmar la firma real de `requireBusinessRole` y el patrón de route handlers en el repo; ajustar si difiere.)

- [ ] **Step 5: Botón "Ver comprobante"** — en `pending-transfers-section.tsx` (cluster de acciones ~118-148) renderizar, cuando `item.proofKey`, un enlace/botón a `/dashboard/transfers/proof/${item.paymentId}` (`target="_blank"`), label "Ver comprobante". Pasar `proofKey`/`proofContentType` a `VerifyTransferDialog`.

- [ ] **Step 6: Embed en el diálogo** — en `verify-transfer-dialog.tsx` sumar props `proofKey?/proofContentType?`; si es imagen, `<img src={`/dashboard/transfers/proof/${paymentId}`} />`; si es PDF, enlace "Ver comprobante (PDF)".

- [ ] **Step 7: Component test** — `tests/unit/pending-transfers-proof.test.tsx`: item con `proofKey` muestra "Ver comprobante"; sin `proofKey` no lo muestra.

- [ ] **Step 8: Correr todo + tsc + commit**

```bash
npm run test:unit -- pending-transfers
# + integración proof-view-route
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/app/dashboard/transfers/ src/server/actions/bookings.ts src/app/dashboard/bookings/page.tsx src/components/dashboard/ tests/
git commit -m "feat(proof): ruta owner-only + 'Ver comprobante' en dashboard"
```

---

## Task 11: Email "declaró" con línea de comprobante

**Files:**
- Modify: `src/lib/notifications/types.ts:128-137` (`BankTransferDeclaredEmailData`)
- Modify: `src/lib/notifications/templates.ts` (4 templates: 392-418 abono, 437-463 saldo)
- Modify: `src/server/actions/bank-transfer-public.ts` (2 call sites, poblar `hasProof`)
- Test: `tests/unit/proof-email.test.ts`

- [ ] **Step 1: Test que falla** — el template incluye "Adjuntó comprobante" cuando `hasProof`:
```ts
import { describe, it, expect } from 'vitest'
import { bankTransferDeclaredBusinessHtml } from '@/lib/notifications/templates'

it('muestra la línea de comprobante cuando hasProof', () => {
  const html = bankTransferDeclaredBusinessHtml({ /* data mínima */, hasProof: true } as never)
  expect(html).toContain('comprobante')
})
```

- [ ] **Step 2: Correr y ver fallar** → FAIL.

- [ ] **Step 3: Implementar** — agregar `hasProof?: boolean` a `BankTransferDeclaredEmailData`; en los 4 templates (`bankTransferDeclaredBusinessHtml/Text`, `balanceTransferDeclaredBusinessHtml/Text`) renderizar una línea "Adjuntó comprobante" cuando `data.hasProof`. En los 2 call sites de `bank-transfer-public.ts` (:132-141 abono, :252-261 saldo) pasar `hasProof: !!proof` (la variable `proof` computada en Task 5).

- [ ] **Step 4: Correr y ver pasar** → PASS. Correr `tests/unit/balance-transfer-emails.test.ts` existente → verde.

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit 2>&1 | grep '^src/'   # vacío
git add src/lib/notifications/ src/server/actions/bank-transfer-public.ts tests/unit/proof-email.test.ts
git commit -m "feat(proof): línea 'adjuntó comprobante' en emails de declaración"
```

---

## Task 12: Verificación final

**Files:** ninguno (solo verificación).

- [ ] **Step 1: tsc completo**

Run: `npx tsc --noEmit 2>&1 | grep '^src/'`
Expected: vacío.

- [ ] **Step 2: Unit + component (serializado para evitar flakiness pre-existente)**

Run: `npm run test:unit -- --no-file-parallelism`
Expected: 100% verde.

- [ ] **Step 3: Integración**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agendita_test DIRECT_URL=postgresql://postgres:postgres@localhost:5433/agendita_test npm run test:integration`
Expected: verde (incluye los nuevos: proof-upload-url, proof-declare, require-transfer-proof, proof-view-route).

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: 0 errores; build ok.

- [ ] **Step 5: Commit final si quedó algo**

```bash
git add -A && git commit -m "test(proof): verificación final verde" || echo "nada que commitear"
```

---

## Waves de ejecución (subagent-driven-development)

- **Wave 1 (paralelo, sin archivos compartidos):** Task 1 (migración) ∥ Task 2 (proof.ts) ∥ Task 3 (r2.ts+deps+env).
- **Wave 2 (secuencial, comparten `bank-transfer-public.ts`):** Task 4 → Task 5 → Task 11 (email call-sites). Contención: un solo agente de integración a la vez (DB de test compartida).
- **Wave 3 (paralelo):** Task 6 (settings) ∥ Task 7 (TransferDetails).
- **Wave 4 (secuencial sobre lo anterior):** Task 8 (enhebrado) → Task 9 (adjuntado clienta) → Task 10 (dashboard owner).
- **Wave 5:** Task 12 (verificación final) → /simplify (4 ángulos) → PR.

Regla de contención tsc/git para waves paralelas: cada agente hace `git add` de sus archivos explícitos (no `-A`), ver landmine [[git-cwd-drift-in-worktrees]].

## Self-review checklist (post-plan)

- [x] Cobertura de spec: schema+migración (T1), proof.ts (T2), r2.ts+env+gate (T3), presign+getBankTransferInfo (T4), proofKey en declares+HEAD+attachProof (T5), setting+Ajustes gated (T6), control de adjunto (T7), enhebrado (T8), adjuntado clienta (T9), ruta owner+dashboard (T10), emails (T11), verificación (T12). Lifecycle R2 = infra del usuario (spec). Sweeps confirmados sin cambio (spec).
- [x] Sin placeholders: cada step tiene código o comando concreto.
- [x] Consistencia de tipos: `ProofStorage` (r2.ts) ↔ `deps.storage` (actions) ↔ fakes de test; `DeclareProofOpts` reusado; `proofKey`/`ProofKind`/`isAllowedProofType`/`PROOF_MAX_BYTES` de proof.ts en toda la cadena; `BankTransferPublicInfo & { requireProof }` consumido por TransferDetails.
