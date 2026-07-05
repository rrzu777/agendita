# D1-a — Login de clienta (Google) + vinculación + `/mi` read-only — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuentas de clienta con Google OAuth, vinculación a los `Customer` existentes por 3 vías, y superficie `/mi` (home multi-negocio + detalle con tarjeta compartida, canje y reservas read-only).

**Architecture:** Mismo proyecto Supabase; se reusa `User` (una fila por auth id, sin enum de tipo de usuario) y se agrega `Customer.userId String?` (SetNull). La tarjeta de `/tarjeta/[token]` se extrae a componentes/loader compartidos que `/mi/[slug]` reusa; el canje reusa el core `runRedemption` existente. Spec: `docs/superpowers/specs/2026-07-05-customer-login-D1-design.md`.

**Tech Stack:** Next 16 (App Router, server actions), Supabase Auth (PKCE ya cableado en `/auth/callback` + middleware), Prisma/Postgres, vitest (`renderToStaticMarkup` para componentes), Playwright e2e con header bypass.

---

## ⚠️ Prerequisito operativo (USUARIO, antes de probar en real)

**Google OAuth NO está configurado** (el login de dueñas es email+contraseña). Para que el flujo funcione contra Supabase real:
1. Google Cloud Console → crear OAuth Client ID (tipo Web). Authorized redirect URI: `https://<proyecto>.supabase.co/auth/v1/callback`.
2. Supabase Dashboard → Authentication → Providers → Google → habilitar con ese client id/secret.
3. Supabase Dashboard → Authentication → URL Configuration → **Redirect URLs** debe permitir `https://<dominio-app>/auth/callback` (con el `?next=` que agregamos). Si el target no está permitido, Supabase cae al Site URL (`/`) y el `next` puede perderse — el middleware rescata el `code` desde `/`, pero una clienta NUEVA sin `next` termina en `/dashboard` → `/recover-business` (no tiene Customer vinculados todavía). Este es el mismo problema que ya está comentado en `src/middleware.ts:9`.

Los tests unit/component/integration NO dependen de esto (mockean Supabase). El e2e usa el header bypass (tampoco depende). Solo la prueba manual del login real lo necesita.

## Convenciones obligatorias (landmines del repo)

- Módulos `'use server'` exportan SOLO funciones `async`. Helpers → module-local sin export.
- Todo `revalidate*` con `await`.
- Tests de componentes que rendericen `useRouter()` → mock de `next/navigation`.
- `git`: el cwd puede driftar — usar rutas absolutas o `git -C <worktree>` y `git add <archivos>` explícitos.
- Integración NO corre local (solo CI). Local: unit + `npx tsc --noEmit` (hay ~17 errores PRE-existentes en tests de metrics/time-blocks/create-booking-no-deposit/mercado-pago-oauth — confirmar CERO nuevos, no arreglarlos) + lint.
- La migración NO se aplica a prod durante el plan; se genera y committea. Se aplica al cierre con OK explícito (`db execute` + `migrate resolve --applied`).

## Setup del worktree

- [ ] `cd /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 && npm install` (el worktree no tiene `node_modules`)
- [ ] Baseline: `npm test` → 1152+ verdes; `npx tsc --noEmit 2>&1 | grep -c "error TS"` → anotar el número (esperado ~17)

---

### Task 1: Schema + migración (Customer.userId, Business.selfServiceCutoffHours)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260705120000_add_customer_account/migration.sql`

- [ ] **Step 1: Editar el schema.** En `model User` agregar al final de las relaciones:

```prisma
  customers  Customer[]
```

En `model Customer` (después de `referralToken String? @unique`):

```prisma
  userId String?
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)
```

y junto a los otros `@@index` de Customer:

```prisma
  @@index([userId])
```

En `model Business`, junto a `bookingWindowDays Int @default(90)`:

```prisma
  selfServiceCutoffHours Int @default(24) // ventana para cancelar/reprogramar self-service; 0 = sin límite (se usa en D1-b)
```

- [ ] **Step 2: Regenerar el client:** `npx prisma generate` → sin errores.

- [ ] **Step 3: Generar el SQL de la migración** (sin shadow DB; usar DIRECT_URL — el pooler cuelga):

```bash
mkdir -p prisma/migrations/20260705120000_add_customer_account
./node_modules/.bin/dotenvx run -f .env.local -- sh -c 'npx prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel prisma/schema.prisma --script' > prisma/migrations/20260705120000_add_customer_account/migration.sql
```

- [ ] **Step 4: Inspeccionar el .sql.** Si la línea 1 es `zsh: command not found: _nvm_load`, borrarla. Verificar que contiene SOLO: `ALTER TABLE "Business" ADD COLUMN "selfServiceCutoffHours"`, `ALTER TABLE "Customer" ADD COLUMN "userId"`, `CREATE INDEX "Customer_userId_idx"`, y el `ADD CONSTRAINT "Customer_userId_fkey" ... ON DELETE SET NULL`. Nada de DROP.

- [ ] **Step 5: Verificar tipos:** `npx tsc --noEmit` → mismos errores pre-existentes, cero nuevos.

- [ ] **Step 6: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add prisma/schema.prisma prisma/migrations/20260705120000_add_customer_account/migration.sql
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(d1a): add Customer.userId link and selfServiceCutoffHours"
```

---

### Task 2: `ensureUserRow` (upsert de la fila User de Prisma)

Contexto: la fila `User` de Prisma solo se crea al registrar un negocio (`createBusinessForUser`). Una clienta con sesión Google no la tiene, y el FK `Customer.userId → User.id` la necesita.

**Files:**
- Create: `src/lib/auth/ensure-user-row.ts`
- Test: `tests/unit/ensure-user-row.test.ts`

- [ ] **Step 1: Test que falla**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUpsert = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { user: { upsert: mockUpsert } } }))

import { Prisma } from '@prisma/client'
import { ensureUserRow, AccountConflictError } from '@/lib/auth/ensure-user-row'

describe('ensureUserRow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('upserts by supabase id with email and name from metadata', async () => {
    mockUpsert.mockResolvedValue({})
    await ensureUserRow({ id: 'auth-1', email: 'ana@example.com', user_metadata: { full_name: 'Ana Pérez' } })
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { id: 'auth-1' },
      update: {},
      create: { id: 'auth-1', email: 'ana@example.com', name: 'Ana Pérez' },
    })
  })

  it('is idempotent (upsert update is a no-op, never overwrites)', async () => {
    mockUpsert.mockResolvedValue({})
    await ensureUserRow({ id: 'auth-1', email: 'ana@example.com', user_metadata: null })
    expect(mockUpsert.mock.calls[0][0].update).toEqual({})
  })

  it('throws AccountConflictError on unique-email collision (P2002)', async () => {
    mockUpsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2002', clientVersion: 'x' }),
    )
    await expect(ensureUserRow({ id: 'auth-2', email: 'dueña@example.com', user_metadata: null }))
      .rejects.toBeInstanceOf(AccountConflictError)
  })

  it('throws AccountConflictError when the session user has no email', async () => {
    await expect(ensureUserRow({ id: 'auth-3', email: null, user_metadata: null }))
      .rejects.toBeInstanceOf(AccountConflictError)
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2:** `npx vitest --run tests/unit/ensure-user-row.test.ts` → FAIL (módulo no existe).

- [ ] **Step 3: Implementación**

```ts
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

/** La cuenta no puede usarse: email ausente o ya asociado a otra fila User
 *  (p.ej. cuenta de Supabase recreada con el mismo email). NO adoptamos la fila
 *  existente — podría tener membresías BusinessUser de otra persona. */
export class AccountConflictError extends Error {
  constructor(message = 'Tu email ya está asociado a otra cuenta. Escríbenos a soporte para recuperarla.') {
    super(message)
    this.name = 'AccountConflictError'
  }
}

interface SessionUserLike {
  id: string
  email?: string | null
  user_metadata?: { name?: string | null; full_name?: string | null } | null
}

/** Garantiza la fila User de Prisma para el auth user de Supabase (id compartido).
 *  Las dueñas ya la tienen (creada al registrar el negocio); las clientas no. */
export async function ensureUserRow(user: SessionUserLike): Promise<void> {
  if (!user.email) {
    throw new AccountConflictError('Tu cuenta no tiene un email utilizable. Escríbenos a soporte.')
  }
  try {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {},
      create: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name ?? user.user_metadata?.full_name ?? null,
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AccountConflictError()
    }
    throw e
  }
}
```

- [ ] **Step 4:** `npx vitest --run tests/unit/ensure-user-row.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/lib/auth/ensure-user-row.ts tests/unit/ensure-user-row.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(d1a): ensureUserRow creates the Prisma User row for customer sessions"
```

---

### Task 3: Módulo de vinculación `src/lib/customers/link.ts`

**Files:**
- Create: `src/lib/customers/link.ts`
- Test: `tests/unit/customer-link.test.ts`

- [ ] **Step 1: Test que falla**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isVerifiedEmail,
  linkCustomersByVerifiedEmail,
  linkCustomerByLoyaltyToken,
  CardLinkError,
} from '@/lib/customers/link'

function makeDb() {
  return {
    customer: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  }
}

describe('isVerifiedEmail', () => {
  it('true con user_metadata.email_verified', () => {
    expect(isVerifiedEmail({ email: 'a@b.c', user_metadata: { email_verified: true }, email_confirmed_at: null })).toBe(true)
  })
  it('true con email_confirmed_at', () => {
    expect(isVerifiedEmail({ email: 'a@b.c', user_metadata: {}, email_confirmed_at: '2026-01-01T00:00:00Z' })).toBe(true)
  })
  it('false sin verificación o sin email', () => {
    expect(isVerifiedEmail({ email: 'a@b.c', user_metadata: {}, email_confirmed_at: null })).toBe(false)
    expect(isVerifiedEmail({ email: null, user_metadata: { email_verified: true }, email_confirmed_at: '2026-01-01T00:00:00Z' })).toBe(false)
  })
})

describe('linkCustomersByVerifiedEmail', () => {
  let db: ReturnType<typeof makeDb>
  beforeEach(() => { db = makeDb() })

  it('matches trimmed + case-insensitive y solo Customer sin userId', async () => {
    db.customer.updateMany.mockResolvedValue({ count: 2 })
    const count = await linkCustomersByVerifiedEmail(db as never, 'user-1', '  Ana@Example.com ')
    expect(count).toBe(2)
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { email: { equals: 'Ana@Example.com', mode: 'insensitive' }, userId: null },
      data: { userId: 'user-1' },
    })
  })

  it('no hace nada con email vacío', async () => {
    const count = await linkCustomersByVerifiedEmail(db as never, 'user-1', '   ')
    expect(count).toBe(0)
    expect(db.customer.updateMany).not.toHaveBeenCalled()
  })
})

describe('linkCustomerByLoyaltyToken', () => {
  let db: ReturnType<typeof makeDb>
  beforeEach(() => { db = makeDb() })

  it('vincula un Customer sin dueño (update atómico where userId null)', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 'c1', userId: null })
    db.customer.updateMany.mockResolvedValue({ count: 1 })
    await linkCustomerByLoyaltyToken(db as never, 'user-1', 'tok')
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', userId: null },
      data: { userId: 'user-1' },
    })
  })

  it('es no-op si ya está vinculado a la misma cuenta', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 'c1', userId: 'user-1' })
    await linkCustomerByLoyaltyToken(db as never, 'user-1', 'tok')
    expect(db.customer.updateMany).not.toHaveBeenCalled()
  })

  it('CardLinkError si está vinculado a otra cuenta', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 'c1', userId: 'user-2' })
    await expect(linkCustomerByLoyaltyToken(db as never, 'user-1', 'tok')).rejects.toBeInstanceOf(CardLinkError)
  })

  it('CardLinkError si el token no existe', async () => {
    db.customer.findUnique.mockResolvedValue(null)
    await expect(linkCustomerByLoyaltyToken(db as never, 'user-1', 'nope')).rejects.toBeInstanceOf(CardLinkError)
  })

  it('CardLinkError si otro ganó la carrera (updateMany count 0)', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 'c1', userId: null })
    db.customer.updateMany.mockResolvedValue({ count: 0 })
    await expect(linkCustomerByLoyaltyToken(db as never, 'user-1', 'tok')).rejects.toBeInstanceOf(CardLinkError)
  })
})
```

- [ ] **Step 2:** `npx vitest --run tests/unit/customer-link.test.ts` → FAIL.

- [ ] **Step 3: Implementación**

```ts
import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/** Solo emails verificados habilitan el auto-link (Google los garantiza; el guard
 *  queda listo para email OTP en D2). */
export function isVerifiedEmail(user: {
  email?: string | null
  email_confirmed_at?: string | null
  user_metadata?: Record<string, unknown> | null
}): boolean {
  if (!user.email) return false
  return user.user_metadata?.email_verified === true || Boolean(user.email_confirmed_at)
}

/** Vía 1: auto-link por email verificado. Idempotente y barato (corre en cada
 *  entrada a /mi). Nunca pisa un userId existente. */
export async function linkCustomersByVerifiedEmail(db: Db, userId: string, email: string): Promise<number> {
  const normalized = email.trim()
  if (!normalized) return 0
  const res = await db.customer.updateMany({
    where: { email: { equals: normalized, mode: 'insensitive' }, userId: null },
    data: { userId },
  })
  return res.count
}

export class CardLinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CardLinkError'
  }
}

/** Vía 2: link explícito por posesión del token de "Mi tarjeta". El update es
 *  atómico sobre userId null para que dos cuentas no puedan pisarse en carrera. */
export async function linkCustomerByLoyaltyToken(db: Db, userId: string, token: string): Promise<void> {
  const customer = await db.customer.findUnique({
    where: { loyaltyToken: token },
    select: { id: true, userId: true },
  })
  if (!customer) throw new CardLinkError('El enlace de la tarjeta no es válido.')
  if (customer.userId === userId) return
  if (customer.userId) throw new CardLinkError('Esta tarjeta ya está vinculada a otra cuenta.')
  const res = await db.customer.updateMany({
    where: { id: customer.id, userId: null },
    data: { userId },
  })
  if (res.count === 0) throw new CardLinkError('Esta tarjeta ya está vinculada a otra cuenta.')
}
```

- [ ] **Step 4:** `npx vitest --run tests/unit/customer-link.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/lib/customers/link.ts tests/unit/customer-link.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(d1a): customer-account linking module (email, card token)"
```

---

### Task 4: `sanitizeNext` con fallback parametrizado + `signInWithGoogle`

**Files:**
- Modify: `src/lib/auth/sanitize-next.ts`
- Modify: `src/lib/auth/actions.ts` (agregar función al final)
- Test: `tests/unit/sign-in-with-google.test.ts`

- [ ] **Step 1: Test que falla**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateClient = vi.fn()
vi.mock('@/lib/auth/middleware', () => ({ createClient: mockCreateClient }))
vi.mock('@/lib/db', () => ({ prisma: {} }))
const mockRedirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

import { sanitizeNext } from '@/lib/auth/sanitize-next'

describe('sanitizeNext fallback', () => {
  it('mantiene el default /dashboard sin segundo argumento', () => {
    expect(sanitizeNext(null)).toBe('/dashboard')
    expect(sanitizeNext('//evil.com')).toBe('/dashboard')
  })
  it('usa el fallback provisto', () => {
    expect(sanitizeNext(null, '/mi')).toBe('/mi')
    expect(sanitizeNext('https://evil.com', '/mi')).toBe('/mi')
    expect(sanitizeNext('/mi/negocio', '/mi')).toBe('/mi/negocio')
  })
})

describe('signInWithGoogle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'agendita.test'
    process.env.APP_DOMAIN = 'agendita.test'
  })

  it('inicia OAuth con redirectTo al callback con next sanitizado y redirige a la URL de Google', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: { url: 'https://accounts.google.com/x' }, error: null })
    mockCreateClient.mockResolvedValue({ auth: { signInWithOAuth } })
    const { signInWithGoogle } = await import('@/lib/auth/actions')

    await expect(signInWithGoogle('/mi')).rejects.toThrow('REDIRECT:https://accounts.google.com/x')
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://agendita.test/auth/callback?next=%2Fmi' },
    })
  })

  it('sanitiza next malicioso al fallback /mi', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: { url: 'https://accounts.google.com/x' }, error: null })
    mockCreateClient.mockResolvedValue({ auth: { signInWithOAuth } })
    const { signInWithGoogle } = await import('@/lib/auth/actions')

    await expect(signInWithGoogle('//evil.com')).rejects.toThrow('REDIRECT:')
    expect(signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe('https://agendita.test/auth/callback?next=%2Fmi')
  })

  it('devuelve error amigable si Supabase falla', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: { url: null }, error: new Error('boom') })
    mockCreateClient.mockResolvedValue({ auth: { signInWithOAuth } })
    const { signInWithGoogle } = await import('@/lib/auth/actions')

    await expect(signInWithGoogle(null)).resolves.toEqual({ error: 'No se pudo iniciar sesión con Google. Intenta de nuevo.' })
  })
})
```

Nota: `signIn`/`requestPasswordReset` ya se testean mockeando `@/lib/auth/middleware` en `tests/unit/auth-login-recovery.test.tsx` — mismo patrón.

- [ ] **Step 2:** `npx vitest --run tests/unit/sign-in-with-google.test.ts` → FAIL.

- [ ] **Step 3: `sanitizeNext` parametrizado** (reemplaza el cuerpo actual; los 3 `return '/dashboard'` pasan a `return fallback`):

```ts
export function sanitizeNext(next: string | null, fallback = '/dashboard'): string {
  if (!next) return fallback
  if (!next.startsWith('/')) return fallback
  if (next.startsWith('//')) return fallback
  return next
}
```

- [ ] **Step 4: `signInWithGoogle` al final de `src/lib/auth/actions.ts`** (módulo `'use server'` — solo exports async; `sanitizeNext` y `getAppUrl` ya están importados o importarlos arriba):

```ts
/** Login de clienta (y de cualquier persona) con Google. Reusa el flujo PKCE:
 *  Supabase redirige a /auth/callback, el middleware intercambia el code y
 *  redirige a `next`. Requiere el provider Google habilitado en Supabase. */
export async function signInWithGoogle(next: string | null) {
  const supabase = await createClient()
  const safeNext = sanitizeNext(next, '/mi')
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: getAppUrl(`/auth/callback?next=${encodeURIComponent(safeNext)}`) },
  })
  if (error || !data?.url) {
    return { error: 'No se pudo iniciar sesión con Google. Intenta de nuevo.' }
  }
  redirect(data.url)
}
```

Import a agregar arriba si falta: `import { sanitizeNext } from './sanitize-next'`.

- [ ] **Step 5:** `npx vitest --run tests/unit/sign-in-with-google.test.ts tests/unit/auth-login-recovery.test.tsx` → PASS (el segundo confirma que no rompimos el default de dueña).

- [ ] **Step 6: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/lib/auth/sanitize-next.ts src/lib/auth/actions.ts tests/unit/sign-in-with-google.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(d1a): signInWithGoogle server action + parameterized sanitizeNext fallback"
```

---

### Task 5: Página `/ingresar`

**Files:**
- Create: `src/app/ingresar/page.tsx`
- Test: `tests/unit/ingresar-page.test.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/auth/actions', () => ({ signInWithGoogle: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import IngresarPage from '@/app/ingresar/page'

describe('/ingresar', () => {
  it('renderiza el botón de Google y el link para dueñas', async () => {
    const html = renderToStaticMarkup(await IngresarPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Google')
    expect(html).toContain('href="/login"')
  })
})
```

(Si `renderToStaticMarkup` se queja del `action` funcional del form, envolver el form en un wrapper y pasar el action como prop — pero con el mock de actions no debería.)

- [ ] **Step 2:** `npx vitest --run tests/unit/ingresar-page.test.tsx` → FAIL.

- [ ] **Step 3: Implementación** (server component, form → server action; estilo de la Card de `/login`):

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { signInWithGoogle } from '@/lib/auth/actions'

export const metadata: Metadata = { title: 'Ingresar — Agendita' }

export default async function IngresarPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  const action = signInWithGoogle.bind(null, next ?? null)

  return (
    <main className="studio-shell flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[440px]">
        <div className="mb-10 text-center">
          <h1 className="font-heading text-6xl font-semibold tracking-tight text-primary">Agendita</h1>
          <p className="mt-3 text-xl text-muted-foreground">Tus reservas, puntos y beneficios</p>
        </div>
        <Card className="studio-card w-full border-border/40 px-4 py-6 sm:px-8">
          <CardHeader className="px-0 text-left">
            <CardTitle className="font-heading text-4xl font-semibold tracking-tight text-primary">Hola</CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              Ingresa con tu cuenta de Google para ver tus reservas y tu tarjeta de beneficios.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <form action={action}>
              <Button type="submit" className="h-14 w-full rounded-full text-lg font-semibold">
                Continuar con Google
              </Button>
            </form>
            <div className="my-8 h-px bg-border/50" />
            <p className="text-center text-base text-muted-foreground">
              ¿Administras un negocio?{' '}
              <Link href="/login" className="font-semibold text-primary hover:underline">
                Ingresa aquí
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
```

- [ ] **Step 4:** `npx vitest --run tests/unit/ingresar-page.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/app/ingresar/page.tsx tests/unit/ingresar-page.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(d1a): /ingresar customer login page (Google)"
```

---

### Task 6: Layout `/mi` (guard + ensureUserRow + auto-link + header)

**Files:**
- Create: `src/app/mi/layout.tsx`
- Test: `tests/unit/mi-layout.test.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockGetCurrentUser = vi.fn()
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mockGetCurrentUser }))
const mockEnsureUserRow = vi.fn()
vi.mock('@/lib/auth/ensure-user-row', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/ensure-user-row')>()
  return { ...mod, ensureUserRow: mockEnsureUserRow }
})
const mockLink = vi.fn()
vi.mock('@/lib/customers/link', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/customers/link')>()
  return { ...mod, linkCustomersByVerifiedEmail: mockLink }
})
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/auth/actions', () => ({ signOut: vi.fn() }))
const mockRedirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

import { AccountConflictError } from '@/lib/auth/ensure-user-row'
import MiLayout from '@/app/mi/layout'

const verifiedUser = {
  id: 'u1',
  email: 'ana@example.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  user_metadata: { email_verified: true },
}

describe('/mi layout', () => {
  beforeEach(() => vi.clearAllMocks())

  it('redirige a /ingresar sin sesión', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    await expect(MiLayout({ children: null })).rejects.toThrow('REDIRECT:/ingresar?next=/mi')
  })

  it('con sesión: ensureUserRow + auto-link por email verificado, y renderiza children', async () => {
    mockGetCurrentUser.mockResolvedValue(verifiedUser)
    mockEnsureUserRow.mockResolvedValue(undefined)
    mockLink.mockResolvedValue(1)
    const html = renderToStaticMarkup(await MiLayout({ children: <p>contenido</p> }))
    expect(mockEnsureUserRow).toHaveBeenCalled()
    expect(mockLink).toHaveBeenCalledWith(expect.anything(), 'u1', 'ana@example.com')
    expect(html).toContain('contenido')
  })

  it('NO auto-linkea si el email no está verificado', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'ana@example.com', email_confirmed_at: null, user_metadata: {} })
    mockEnsureUserRow.mockResolvedValue(undefined)
    await MiLayout({ children: null })
    expect(mockLink).not.toHaveBeenCalled()
  })

  it('muestra mensaje de soporte ante AccountConflictError', async () => {
    mockGetCurrentUser.mockResolvedValue(verifiedUser)
    mockEnsureUserRow.mockRejectedValue(new AccountConflictError())
    const html = renderToStaticMarkup(await MiLayout({ children: null }))
    expect(html).toContain('soporte')
    expect(mockLink).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2:** `npx vitest --run tests/unit/mi-layout.test.tsx` → FAIL.

- [ ] **Step 3: Implementación**

```tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/user'
import { ensureUserRow, AccountConflictError } from '@/lib/auth/ensure-user-row'
import { isVerifiedEmail, linkCustomersByVerifiedEmail } from '@/lib/customers/link'
import { prisma } from '@/lib/db'
import { signOut } from '@/lib/auth/actions'

// Superficie personal: fuera de los índices, como /tarjeta/[token].
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function MiLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/ingresar?next=/mi')

  try {
    await ensureUserRow(user)
  } catch (e) {
    if (e instanceof AccountConflictError) {
      return (
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <h1 className="text-xl font-semibold">No pudimos preparar tu cuenta</h1>
          <p className="mt-2 text-gray-500">{e.message}</p>
        </main>
      )
    }
    throw e
  }

  // Vía 1 de vinculación: solo email verificado; idempotente en cada entrada.
  if (user.email && isVerifiedEmail(user)) {
    await linkCustomersByVerifiedEmail(prisma, user.id, user.email)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-md items-center justify-between px-4 py-4">
        <span className="font-heading text-lg font-semibold text-primary">Mi cuenta</span>
        <form action={signOut}>
          <button type="submit" className="text-sm text-muted-foreground hover:underline">Salir</button>
        </form>
      </header>
      {children}
    </div>
  )
}
```

- [ ] **Step 4:** `npx vitest --run tests/unit/mi-layout.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/app/mi/layout.tsx tests/unit/mi-layout.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(d1a): /mi layout with session guard, ensureUserRow and email auto-link"
```

---

### Task 7: Home `/mi`

**Files:**
- Create: `src/app/mi/page.tsx`
- Test: `tests/unit/mi-home-page.test.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockGetCurrentUser = vi.fn()
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mockGetCurrentUser }))
const mockFindMany = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { customer: { findMany: mockFindMany } } }))
const mockBalance = vi.fn()
vi.mock('@/lib/loyalty/balance', () => ({ getLoyaltyBalance: mockBalance }))
const mockRedirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

import MiHomePage from '@/app/mi/page'

describe('/mi home', () => {
  beforeEach(() => vi.clearAllMocks())

  it('estado vacío sin Customer vinculados', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    mockFindMany.mockResolvedValue([])
    const html = renderToStaticMarkup(await MiHomePage())
    expect(html).toContain('tarjeta')      // texto explicativo del estado vacío
    expect(html).not.toContain('/mi/')
  })

  it('renderiza una card por negocio con el balance y link al detalle', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    mockFindMany.mockResolvedValue([
      {
        id: 'c1', name: 'Ana',
        business: { id: 'b1', name: 'Mimos Nails', slug: 'mimosnails', logoUrl: null, loyaltyConfig: { isActive: true, pointsLabel: 'mimos' } },
      },
    ])
    mockBalance.mockResolvedValue(120)
    const html = renderToStaticMarkup(await MiHomePage())
    expect(html).toContain('Mimos Nails')
    expect(html).toContain('120')
    expect(html).toContain('mimos')
    expect(html).toContain('href="/mi/mimosnails"')
  })
})
```

- [ ] **Step 2:** `npx vitest --run tests/unit/mi-home-page.test.tsx` → FAIL.

- [ ] **Step 3: Implementación**

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { getLoyaltyBalance } from '@/lib/loyalty/balance'
import { displayBalance } from '@/lib/loyalty/view'

export default async function MiHomePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/ingresar?next=/mi')

  const customers = await prisma.customer.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      business: {
        select: { id: true, name: true, slug: true, logoUrl: true, loyaltyConfig: { select: { isActive: true, pointsLabel: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (customers.length === 0) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">Todavía no hay nada por aquí</h1>
        <p className="mt-2 text-gray-500">
          Abre el enlace de tu tarjeta de beneficios, o haz una reserva con este email, y tus negocios van a aparecer acá.
        </p>
      </main>
    )
  }

  // Lecturas simples (agregados), sin tx interactiva → paralelo seguro.
  const balances = await Promise.all(
    customers.map((c) => getLoyaltyBalance(prisma, c.id, c.business.id)),
  )

  return (
    <main className="mx-auto max-w-md px-4 pb-10">
      <h1 className="text-lg font-semibold">Mis negocios</h1>
      <ul className="mt-4 space-y-3">
        {customers.map((c, i) => (
          <li key={c.id}>
            <Link href={`/mi/${c.business.slug}`} className="block rounded-2xl border border-gray-100 bg-pink-50/50 px-4 py-4 hover:bg-pink-50">
              <div className="font-medium">{c.business.name}</div>
              {c.business.loyaltyConfig?.isActive && (
                <div className="mt-1 text-sm text-pink-700">
                  {displayBalance(balances[i])} {c.business.loyaltyConfig.pointsLabel}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
```

- [ ] **Step 4:** `npx vitest --run tests/unit/mi-home-page.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/app/mi/page.tsx tests/unit/mi-home-page.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(d1a): /mi multi-business home"
```

---

### Task 8: Extraer la tarjeta compartida (loader + componente) y refactorizar `/tarjeta/[token]`

La página `src/app/tarjeta/[token]/page.tsx` (197 líneas) hoy contiene: resolución por token → `reconcileExpiredGrants` (tx interactiva, SIEMPRE sola antes de las demás lecturas — landmine P2028) → 6 lecturas en paralelo → render. Se separa en loader + componente para que `/mi/[slug]` los reuse.

**Files:**
- Create: `src/lib/loyalty/card-data.ts` (loader)
- Create: `src/components/loyalty/loyalty-card.tsx` (componente de presentación)
- Move: `src/app/tarjeta/[token]/referral-share.tsx` → `src/components/loyalty/referral-share.tsx`
- Modify: `src/app/tarjeta/[token]/page.tsx` (queda: resolver token + not-found + `<LoyaltyCard>`)
- Test: `tests/unit/loyalty-card-view.test.tsx`

- [ ] **Step 1: Loader `src/lib/loyalty/card-data.ts`** — mover el bloque de datos de la página TAL CUAL (misma semántica; los comentarios existentes viajan con el código):

```ts
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getLoyaltyBalance, getLoyaltyHistory } from '@/lib/loyalty/balance'
import { reconcileExpiredGrants } from '@/lib/loyalty/grant'
import { conditionKind } from '@/lib/loyalty/automatic-match'
import { ensureReferralToken } from '@/lib/loyalty/token'
import { getBookingFunnelUrl } from '@/lib/business/urls'

export interface CardCustomer {
  id: string
  name: string
  businessId: string
  referralToken: string | null
  business: {
    id: string
    name: string
    slug: string
    subdomain: string | null
    logoUrl: string | null
    loyaltyConfig: { isActive: boolean; programName: string; pointsLabel: string; cardMessage: string | null } | null
  }
}

export type LoyaltyCardData = Awaited<ReturnType<typeof loadLoyaltyCardData>>

/** Datos de la tarjeta de beneficios de UNA clienta en UN negocio. Corre la
 *  reconciliación (tx interactiva) SOLA antes de las lecturas en paralelo
 *  (pgbouncer connection_limit=1 → P2028 si se mezclan). */
export async function loadLoyaltyCardData(customer: CardCustomer) {
  await prisma.$transaction((tx) => reconcileExpiredGrants(tx, customer.id, customer.businessId))

  const config = customer.business.loyaltyConfig
  const [balance, history, catalog, grants, referralRules, packages] = await Promise.all([
    getLoyaltyBalance(prisma, customer.id, customer.businessId),
    getLoyaltyHistory(prisma, customer.id, customer.businessId, 50),
    config?.isActive
      ? prisma.promotion.findMany({
          where: { businessId: customer.businessId, triggerType: 'granted', pointsCost: { not: null }, isActive: true },
          orderBy: { pointsCost: 'asc' },
          select: { id: true, name: true, pointsCost: true },
        })
      : Promise.resolve([] as { id: string; name: string; pointsCost: number | null }[]),
    prisma.promotionGrant.findMany({
      where: { customerId: customer.id, businessId: customer.businessId, status: 'active', packagePurchaseId: null },
      orderBy: { createdAt: 'desc' },
      include: { promotion: { select: { name: true } } },
    }),
    config?.isActive
      ? prisma.promotion.findMany({
          where: { businessId: customer.businessId, triggerType: 'automatic', isActive: true },
          select: { id: true, conditions: true },
        })
      : Promise.resolve([] as { id: string; conditions: Prisma.JsonValue }[]),
    prisma.packagePurchase.findMany({
      where: { customerId: customer.id, status: 'active' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        expiresAt: true,
        product: { select: { name: true } },
        _count: {
          select: {
            grants: { where: { status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] } },
          },
        },
      },
    }),
  ])

  const hasReferralRule = referralRules.some((r) => conditionKind(r.conditions) === 'referral')
  const referralUrl = hasReferralRule
    ? getBookingFunnelUrl(customer.business, `ref=${await ensureReferralToken(prisma, customer)}`)
    : null

  return { config, balance, history, catalog, grants, packages, referralUrl }
}
```

Nota sobre `packages`: el filtro actual de la página NO restringe por businessId (los `PackagePurchase` del customer son del negocio del customer por modelo). Mantener tal cual — refactor sin cambios de semántica.

- [ ] **Step 2: Componente `src/components/loyalty/loyalty-card.tsx`** — mover el JSX de la página desde el logo hasta "Movimientos" inclusive (todo lo que hoy está dentro de `<main>`), con props:

```tsx
interface LoyaltyCardProps {
  customerName: string
  business: { name: string; logoUrl: string | null }
  data: LoyaltyCardData
  /** Server action ya bindeada con la credencial (token o customerId). */
  redeemAction: (formData: FormData) => Promise<void>
}
export function LoyaltyCard({ customerName, business, data, redeemAction }: LoyaltyCardProps) { ... }
```

El form de canje queda `<form action={redeemAction}>` con los mismos hidden inputs (`optionId`, `requestId`). `ReferralShare` se mueve a `src/components/loyalty/referral-share.tsx` (mismo contenido; actualizar import). El JSX interno NO cambia (mismas clases, mismos textos).

- [ ] **Step 3: Refactor de `src/app/tarjeta/[token]/page.tsx`** — queda: `resolveLoyaltyCustomer` (agregar `userId: true` al select en `src/lib/loyalty/token.ts` — se usa en Task 11 para el CTA), branch not-found, `loadLoyaltyCardData`, `redeemAction` (idéntica, bindeada con token) y `<main className="mx-auto max-w-md px-4 py-10"><LoyaltyCard .../></main>`. IMPORTANTE: `resolveLoyaltyCustomer` debe seleccionar también `name` del customer y `programName/pointsLabel/cardMessage` ya vienen en `loyaltyConfig` completo (hoy selecciona `loyaltyConfig: true` — mantener).

- [ ] **Step 4: Test del componente** `tests/unit/loyalty-card-view.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LoyaltyCard } from '@/components/loyalty/loyalty-card'

const baseData = {
  config: { isActive: true, programName: 'Club Mimos', pointsLabel: 'mimos', cardMessage: null },
  balance: 120,
  history: [],
  catalog: [{ id: 'p1', name: 'Descuento 10%', pointsCost: 100 }],
  grants: [],
  packages: [],
  referralUrl: null,
}

describe('LoyaltyCard', () => {
  it('muestra balance, catálogo canjeable y botón habilitado si alcanza', () => {
    const html = renderToStaticMarkup(
      <LoyaltyCard customerName="Ana Pérez" business={{ name: 'Mimos', logoUrl: null }} data={baseData as never} redeemAction={vi.fn() as never} />,
    )
    expect(html).toContain('120')
    expect(html).toContain('Descuento 10%')
    expect(html).toContain('Canjear')
    expect(html).toContain('Hola, Ana')
  })

  it('programa pausado: aviso y sin catálogo', () => {
    const data = { ...baseData, config: { ...baseData.config, isActive: false }, catalog: [] }
    const html = renderToStaticMarkup(
      <LoyaltyCard customerName="Ana" business={{ name: 'Mimos', logoUrl: null }} data={data as never} redeemAction={vi.fn() as never} />,
    )
    expect(html).toContain('pausado')
  })
})
```

- [ ] **Step 5:** `npx vitest --run tests/unit/loyalty-card-view.test.tsx` → PASS, y la suite completa `npm test` → verde (protege el refactor de la tarjeta).

- [ ] **Step 6: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/lib/loyalty/card-data.ts src/components/loyalty/loyalty-card.tsx src/components/loyalty/referral-share.tsx src/app/tarjeta/\[token\]/page.tsx src/lib/loyalty/token.ts tests/unit/loyalty-card-view.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 rm src/app/tarjeta/\[token\]/referral-share.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "refactor(d1a): extract shared loyalty card loader and view from tarjeta page"
```

---

### Task 9: `redeemPointsAsMe` (canje por sesión)

**Files:**
- Modify: `src/server/actions/loyalty.ts` (nueva action junto a `redeemPointsAsCustomer`)
- Test: `tests/unit/loyalty-redeem-as-me.test.ts`

- [ ] **Step 1: Test que falla** (mockear `@/lib/db`, `@/lib/auth/server`, `@/lib/rate-limit`, `next/cache`; patrón de otros tests de actions):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRequireUser = vi.fn()
vi.mock('@/lib/auth/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/server')>()
  return { ...mod, requireUser: mockRequireUser, requireBusinessRole: vi.fn(), requireBusiness: vi.fn() }
})
const mockFindFirstCustomer = vi.fn()
const mockFindFirstPromotion = vi.fn()
const mockFindUniqueConfig = vi.fn()
const mockTx = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    customer: { findFirst: mockFindFirstCustomer },
    promotion: { findFirst: mockFindFirstPromotion, findMany: vi.fn() },
    loyaltyConfig: { findUnique: mockFindUniqueConfig },
    $transaction: mockTx,
    promotionGrant: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const mockRedeem = vi.fn()
vi.mock('@/lib/loyalty/redeem', () => ({ redeemForGrant: mockRedeem }))

describe('redeemPointsAsMe', () => {
  beforeEach(() => vi.clearAllMocks())

  it('canjea para un Customer propio', async () => {
    mockRequireUser.mockResolvedValue({ id: 'u1' })
    mockFindFirstCustomer.mockResolvedValue({
      id: 'c1', businessId: 'b1',
      business: { slug: 'mimosnails', loyaltyConfig: { isActive: true, grantExpiryDays: null, refundPointsOnExpiry: true, forfeitGrantOnNoShow: false } },
    })
    mockFindFirstPromotion.mockResolvedValue({ id: 'p1', businessId: 'b1', triggerType: 'granted', isActive: true, pointsCost: 100, grantExpiryDays: null, maxRedemptions: null, maxPerCustomer: null })
    mockFindUniqueConfig.mockResolvedValue({ isActive: true, grantExpiryDays: null, refundPointsOnExpiry: true, forfeitGrantOnNoShow: false })
    mockTx.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({}))

    const { redeemPointsAsMe } = await import('@/server/actions/loyalty')
    await redeemPointsAsMe('c1', 'p1', 'req-1')
    expect(mockRedeem).toHaveBeenCalled()
  })

  it('rechaza un Customer ajeno (ForbiddenError), sin canjear', async () => {
    mockRequireUser.mockResolvedValue({ id: 'u1' })
    mockFindFirstCustomer.mockResolvedValue(null)
    const { redeemPointsAsMe } = await import('@/server/actions/loyalty')
    await expect(redeemPointsAsMe('c-ajeno', 'p1', 'req-1')).rejects.toThrow()
    expect(mockRedeem).not.toHaveBeenCalled()
    expect(mockFindFirstCustomer).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'c-ajeno', userId: 'u1' }),
    }))
  })
})
```

- [ ] **Step 2:** `npx vitest --run tests/unit/loyalty-redeem-as-me.test.ts` → FAIL.

- [ ] **Step 3: Implementación** en `src/server/actions/loyalty.ts` (importar `requireUser` desde `@/lib/auth/server`; va junto a las otras dos variantes y llama al mismo `runRedemption`):

```ts
export async function redeemPointsAsMe(customerId: string, optionId: unknown, requestId: unknown) {
  const user = await requireUser()
  const parsed = redeemSchema.safeParse({ optionId, requestId })
  if (!parsed.success) throw new Error('Datos inválidos')
  // Ownership por sesión: el Customer debe estar vinculado a esta cuenta.
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, userId: user.id },
    select: { id: true, businessId: true, loyaltyToken: true, business: { select: { slug: true, loyaltyConfig: true } } },
  })
  if (!customer) throw new ForbiddenError('Tarjeta no disponible')
  const config = customer.business.loyaltyConfig
  if (!config || !config.isActive) throw new Error('El programa no está disponible')
  const limit = await checkRateLimit('loyalty-redeem-public', 10, 60000, { businessId: customer.businessId, userId: user.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  await runRedemption({ businessId: customer.businessId, customerId: customer.id, optionId: parsed.data.optionId, requestId: parsed.data.requestId, createdByUserId: null })
  await revalidatePath(`/mi/${customer.business.slug}`)
  // La tarjeta pública del mismo Customer se cachea (redeemPointsAsCustomer ya
  // la revalida) — un canje desde /mi también debe refrescarla o queda stale.
  if (customer.loyaltyToken) {
    await revalidatePath(`/tarjeta/${customer.loyaltyToken}`)
  }
}
```

- [ ] **Step 4:** `npx vitest --run tests/unit/loyalty-redeem-as-me.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/server/actions/loyalty.ts tests/unit/loyalty-redeem-as-me.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(d1a): redeemPointsAsMe session-based redemption"
```

---

### Task 10: Detalle `/mi/[slug]` (tarjeta + reservas read-only)

**Files:**
- Create: `src/app/mi/[slug]/page.tsx`
- Test: `tests/unit/mi-business-detail-page.test.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockGetCurrentUser = vi.fn()
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mockGetCurrentUser }))
const mockBusinessFindUnique = vi.fn()
const mockCustomerFindMany = vi.fn()
const mockBookingFindMany = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    business: { findUnique: mockBusinessFindUnique },
    customer: { findMany: mockCustomerFindMany },
    booking: { findMany: mockBookingFindMany },
  },
}))
const mockLoadCard = vi.fn()
vi.mock('@/lib/loyalty/card-data', () => ({ loadLoyaltyCardData: mockLoadCard }))
vi.mock('@/server/actions/loyalty', () => ({ redeemPointsAsMe: vi.fn() }))
const mockNotFound = vi.fn(() => { throw new Error('NOT_FOUND') })
const mockRedirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({ notFound: mockNotFound, redirect: mockRedirect }))

import MiBusinessPage from '@/app/mi/[slug]/page'

const business = {
  id: 'b1', name: 'Mimos Nails', slug: 'mimosnails', subdomain: 'mimosnails', logoUrl: null,
  loyaltyConfig: { isActive: true, programName: 'Club', pointsLabel: 'mimos', cardMessage: null },
}
const cardData = {
  config: business.loyaltyConfig, balance: 50, history: [], catalog: [], grants: [], packages: [], referralUrl: null,
}

describe('/mi/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'agendita.test'
    process.env.APP_DOMAIN = 'agendita.test'
  })

  it('notFound si el negocio no existe o no hay Customer vinculado (sin leak)', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    mockBusinessFindUnique.mockResolvedValue(business)
    mockCustomerFindMany.mockResolvedValue([])
    await expect(MiBusinessPage({ params: Promise.resolve({ slug: 'mimosnails' }) })).rejects.toThrow('NOT_FOUND')
  })

  it('renderiza tarjeta + próximas reservas + historial', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    mockBusinessFindUnique.mockResolvedValue(business)
    mockCustomerFindMany.mockResolvedValue([{ id: 'c1', name: 'Ana', businessId: 'b1', referralToken: null, business }])
    mockLoadCard.mockResolvedValue(cardData)
    const future = new Date(Date.now() + 86400000)
    mockBookingFindMany.mockResolvedValue([
      { id: 'bk1', bookingNumber: 4738, startDateTime: future, status: 'confirmed', service: { name: 'Manicura' } },
    ])
    const html = renderToStaticMarkup(await MiBusinessPage({ params: Promise.resolve({ slug: 'mimosnails' }) }))
    expect(html).toContain('Mimos Nails')
    expect(html).toContain('Manicura')
    expect(html).toContain('#4738')
  })
})
```

- [ ] **Step 2:** `npx vitest --run tests/unit/mi-business-detail-page.test.tsx` → FAIL.

- [ ] **Step 3: Implementación**

```tsx
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { loadLoyaltyCardData } from '@/lib/loyalty/card-data'
import { LoyaltyCard } from '@/components/loyalty/loyalty-card'
import { redeemPointsAsMe } from '@/server/actions/loyalty'
import { getBookingFunnelUrl } from '@/lib/business/urls'
import { formatBookingNumber } from '@/lib/bookings/number'
import { formatShortDate } from '@/lib/format-date'

const UPCOMING_STATUSES = ['pending_payment', 'confirmed'] as const

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
  expired: 'Expirada',
}

async function redeemAction(customerId: string, formData: FormData) {
  'use server'
  await redeemPointsAsMe(customerId, String(formData.get('optionId')), String(formData.get('requestId')))
}

export default async function MiBusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const user = await getCurrentUser()
  if (!user) redirect(`/ingresar?next=/mi`)

  const business = await prisma.business.findUnique({
    where: { slug },
    select: {
      id: true, name: true, slug: true, subdomain: true, logoUrl: true,
      loyaltyConfig: true,
    },
  })
  if (!business) notFound()

  // Sin Customer vinculado en este negocio → 404 (no revela negocios ajenos).
  const customers = await prisma.customer.findMany({
    where: { userId: user.id, businessId: business.id },
    select: { id: true, name: true, businessId: true, referralToken: true },
    orderBy: { createdAt: 'asc' },
  })
  if (customers.length === 0) notFound()

  // Tx interactiva dentro del loader → secuencial por customer (P2028).
  const cards = []
  for (const c of customers) {
    cards.push(await loadLoyaltyCardData({ ...c, business }))
  }

  const now = new Date()
  const customerIds = customers.map((c) => c.id)
  const [upcoming, past] = await Promise.all([
    prisma.booking.findMany({
      where: { customerId: { in: customerIds }, startDateTime: { gte: now }, status: { in: [...UPCOMING_STATUSES] } },
      orderBy: { startDateTime: 'asc' },
      select: { id: true, bookingNumber: true, startDateTime: true, status: true, service: { select: { name: true } } },
    }),
    prisma.booking.findMany({
      where: { customerId: { in: customerIds }, OR: [{ startDateTime: { lt: now } }, { status: { notIn: [...UPCOMING_STATUSES] } }] },
      orderBy: { startDateTime: 'desc' },
      take: 20,
      select: { id: true, bookingNumber: true, startDateTime: true, status: true, service: { select: { name: true } } },
    }),
  ])

  return (
    <main className="mx-auto max-w-md px-4 pb-10">
      {customers.map((c, i) => (
        <LoyaltyCard
          key={c.id}
          customerName={c.name}
          business={{ name: business.name, logoUrl: business.logoUrl }}
          data={cards[i]}
          redeemAction={redeemAction.bind(null, c.id)}
        />
      ))}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Próximas reservas</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-400">No tienes reservas próximas.</p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((b) => (
              <li key={b.id} className="rounded-lg border border-gray-100 px-3 py-2 text-sm">
                <div className="font-medium">{b.service?.name}</div>
                <div className="text-gray-500">{formatShortDate(b.startDateTime)} · {STATUS_LABEL[b.status] ?? b.status} · {formatBookingNumber(b.bookingNumber, b.id)}</div>
              </li>
            ))}
          </ul>
        )}
        <a
          href={getBookingFunnelUrl({ slug: business.slug, subdomain: business.subdomain })}
          className="mt-3 inline-block rounded-full bg-pink-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Reservar
        </a>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Historial</h2>
        {past.length === 0 ? (
          <p className="text-sm text-gray-400">Todavía no tienes visitas.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {past.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                <span>{b.service?.name}</span>
                <span className="text-gray-400">{formatShortDate(b.startDateTime)} · {STATUS_LABEL[b.status] ?? b.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
```

Verificar la firma real de `getBookingFunnelUrl` en `src/lib/business/urls.ts` (recibe `{ slug, subdomain }` o el business completo) y ajustar la llamada.

- [ ] **Step 4:** `npx vitest --run tests/unit/mi-business-detail-page.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/app/mi/\[slug\]/page.tsx tests/unit/mi-business-detail-page.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(d1a): /mi/[slug] business detail with shared card and bookings"
```

---

### Task 11: CTA en la tarjeta + página `/tarjeta/[token]/vincular` (vía 2)

**Files:**
- Modify: `src/app/tarjeta/[token]/page.tsx` (CTA condicional)
- Create: `src/app/tarjeta/[token]/vincular/page.tsx`
- Test: `tests/unit/tarjeta-vincular.test.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockGetCurrentUser = vi.fn()
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mockGetCurrentUser }))
const mockEnsure = vi.fn()
vi.mock('@/lib/auth/ensure-user-row', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/ensure-user-row')>()
  return { ...mod, ensureUserRow: mockEnsure }
})
const mockLinkByToken = vi.fn()
vi.mock('@/lib/customers/link', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/customers/link')>()
  return { ...mod, linkCustomerByLoyaltyToken: mockLinkByToken }
})
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
const mockRedirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

import { CardLinkError } from '@/lib/customers/link'
import VincularPage from '@/app/tarjeta/[token]/vincular/page'

describe('/tarjeta/[token]/vincular', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sin sesión → /ingresar con next de vuelta a vincular', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    await expect(VincularPage({ params: Promise.resolve({ token: 'tok1' }) }))
      .rejects.toThrow('REDIRECT:/ingresar?next=/tarjeta/tok1/vincular')
  })

  it('con sesión: vincula y redirige a /mi', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'a@b.c' })
    mockEnsure.mockResolvedValue(undefined)
    mockLinkByToken.mockResolvedValue(undefined)
    await expect(VincularPage({ params: Promise.resolve({ token: 'tok1' }) })).rejects.toThrow('REDIRECT:/mi')
    expect(mockLinkByToken).toHaveBeenCalledWith(expect.anything(), 'u1', 'tok1')
  })

  it('tarjeta ajena: muestra el error, no redirige', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'a@b.c' })
    mockEnsure.mockResolvedValue(undefined)
    mockLinkByToken.mockRejectedValue(new CardLinkError('Esta tarjeta ya está vinculada a otra cuenta.'))
    const html = renderToStaticMarkup(await VincularPage({ params: Promise.resolve({ token: 'tok1' }) }))
    expect(html).toContain('vinculada a otra cuenta')
  })
})
```

- [ ] **Step 2:** `npx vitest --run tests/unit/tarjeta-vincular.test.tsx` → FAIL.

- [ ] **Step 3: Página vincular**

```tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { ensureUserRow, AccountConflictError } from '@/lib/auth/ensure-user-row'
import { linkCustomerByLoyaltyToken, CardLinkError } from '@/lib/customers/link'
import { checkRateLimit } from '@/lib/rate-limit'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function VincularPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await getCurrentUser()
  if (!user) redirect(`/ingresar?next=/tarjeta/${token}/vincular`)

  const limit = await checkRateLimit('card-link', 10, 60000, { userId: user.id })
  if (!limit.success) {
    return <ErrorCard message="Demasiados intentos. Espera un momento y vuelve a intentar." />
  }

  try {
    await ensureUserRow(user)
    await linkCustomerByLoyaltyToken(prisma, user.id, token)
  } catch (e) {
    if (e instanceof AccountConflictError || e instanceof CardLinkError) {
      return <ErrorCard message={e.message} />
    }
    throw e
  }

  redirect('/mi')
}

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">No pudimos vincular tu tarjeta</h1>
      <p className="mt-2 text-gray-500">{message}</p>
    </main>
  )
}
```

Verificar la firma real de `checkRateLimit` (`src/lib/rate-limit.ts:340`) y ajustar los argumentos si difiere.

- [ ] **Step 4: CTA en la tarjeta.** En `src/app/tarjeta/[token]/page.tsx`, después del `<LoyaltyCard>` (o al final del `<main>`), solo si el customer NO está vinculado (`customer.userId == null` — el select de `resolveLoyaltyCustomer` ya incluye `userId` desde Task 8):

```tsx
{!customer.userId && (
  <p className="mt-8 text-center text-sm">
    <a href={`/ingresar?next=/tarjeta/${token}/vincular`} className="font-semibold text-pink-700 hover:underline">
      Guardar mi tarjeta en mi cuenta
    </a>
  </p>
)}
```

- [ ] **Step 5:** `npx vitest --run tests/unit/tarjeta-vincular.test.tsx` → PASS; `npm test` → verde.

- [ ] **Step 6: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/app/tarjeta/\[token\]/vincular/page.tsx src/app/tarjeta/\[token\]/page.tsx tests/unit/tarjeta-vincular.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(d1a): link card to account via loyalty token (vía 2)"
```

---

### Task 12: Vincular al reservar logueada (vía 3)

**Files:**
- Modify: `src/server/actions/bookings.ts` (createBooking público, dentro de la tx, tras resolver el customer ~línea 284)
- Test: integración `tests/integration/customer-account-link.test.ts` (corre solo en CI)

- [ ] **Step 1: Cambio en `createBooking`.** Antes de la tx (junto a las otras lecturas previas): `const sessionUser = await getCurrentUser()` (import `@/lib/auth/user`). Dentro de la tx, inmediatamente después del bloque buscar-o-crear customer (tras la línea `if (!customer) { ... }`):

```ts
      // Vía 3 de vinculación: reserva hecha con sesión activa. Guards:
      // - nunca pisar un userId existente
      // - NO vincular a miembros del negocio (owner/staff reservando para
      //   clientas — y el bypass e2e usa la sesión de la dueña)
      // - solo si la fila User de Prisma existe (clientas que ya pasaron por
      //   /mi; si no, quedará vinculada en su próxima visita a /mi)
      if (sessionUser && !customer.userId) {
        const [isMember, userRow] = await Promise.all([
          tx.businessUser.findFirst({ where: { userId: sessionUser.id, businessId }, select: { id: true } }),
          tx.user.findUnique({ where: { id: sessionUser.id }, select: { id: true } }),
        ])
        if (!isMember && userRow) {
          customer = await tx.customer.update({ where: { id: customer.id }, data: { userId: sessionUser.id } })
        }
      }
```

NO tocar `createBookingFromDashboard` (siempre corre con sesión de dueña/staff).

- [ ] **Step 2: Test de integración** `tests/integration/customer-account-link.test.ts` — seguir el patrón de setup de `tests/integration/booking.test.ts` (mismo seeding de business/service; leer ese archivo antes de escribir). Casos:
  1. `createBooking` con sesión de clienta (mock de `getCurrentUser` → user con fila User creada en el seed) sobre un customer nuevo → `customer.userId` queda seteado.
  2. Mismo flujo con un customer que ya tiene `userId` de otra cuenta → NO se pisa.
  3. Sesión de un `BusinessUser` del negocio → NO vincula.
  4. `linkCustomersByVerifiedEmail` (directo contra la DB): dos Customer con el mismo email en distinta capitalización y uno ya vinculado → vincula solo el libre.

- [ ] **Step 3: Verificación local:** `npx tsc --noEmit` (cero errores nuevos) + `npx vitest --run tests/unit` verde. La integración corre en CI — no intentar localmente.

- [ ] **Step 4: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/server/actions/bookings.ts tests/integration/customer-account-link.test.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(d1a): link customer to account on logged-in public booking (vía 3)"
```

---

### Task 13: Routing post-login para clientas (dashboard sin negocio → /mi)

**Files:**
- Modify: `src/app/dashboard/layout.tsx`
- Test: `tests/unit/dashboard-layout-redirect.test.tsx`

- [ ] **Step 1: Test que falla**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUserWithBusiness = vi.fn()
vi.mock('@/lib/auth/user', () => ({ getCurrentUserWithBusiness: mockGetUserWithBusiness }))
const mockCount = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { customer: { count: mockCount } } }))
vi.mock('@/components/dashboard/sidebar', () => ({ DashboardSidebar: () => null }))
const mockRedirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

import DashboardLayout from '@/app/dashboard/layout'

describe('dashboard layout redirect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sin sesión → /login (sin cambios)', async () => {
    mockGetUserWithBusiness.mockResolvedValue(null)
    await expect(DashboardLayout({ children: null })).rejects.toThrow('REDIRECT:/login')
  })

  it('con sesión sin negocio pero con Customer vinculados → /mi', async () => {
    mockGetUserWithBusiness.mockResolvedValue({ user: { id: 'u1' }, business: null, role: null })
    mockCount.mockResolvedValue(2)
    await expect(DashboardLayout({ children: null })).rejects.toThrow('REDIRECT:/mi')
  })

  it('con sesión sin negocio y sin Customer → /recover-business (sin cambios)', async () => {
    mockGetUserWithBusiness.mockResolvedValue({ user: { id: 'u1' }, business: null, role: null })
    mockCount.mockResolvedValue(0)
    await expect(DashboardLayout({ children: null })).rejects.toThrow('REDIRECT:/recover-business')
  })
})
```

- [ ] **Step 2:** `npx vitest --run tests/unit/dashboard-layout-redirect.test.tsx` → FAIL.

- [ ] **Step 3: Implementación.** En `src/app/dashboard/layout.tsx`, reemplazar el bloque `if (!userData.business) { redirect('/recover-business') }` por:

```tsx
  if (!userData.business) {
    // Una clienta logueada que cae en /dashboard no debe terminar en el flujo
    // de recuperación de negocio: si tiene Customer vinculados, su casa es /mi.
    const linkedCustomers = await prisma.customer.count({ where: { userId: userData.user.id } })
    redirect(linkedCustomers > 0 ? '/mi' : '/recover-business')
  }
```

con `import { prisma } from '@/lib/db'` arriba.

- [ ] **Step 4:** `npx vitest --run tests/unit/dashboard-layout-redirect.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/app/dashboard/layout.tsx tests/unit/dashboard-layout-redirect.test.tsx
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "feat(d1a): route business-less sessions with linked customers to /mi"
```

---

### Task 14: e2e bypass con email verificado + e2e de la superficie

**Files:**
- Modify: `src/lib/auth/user.ts` (`makeSyntheticUser`)
- Create: `tests/e2e/customer-account.spec.ts`

- [ ] **Step 1: `makeSyntheticUser`** — agregar `email_confirmed_at` (el bypass es confiable por definición; sin esto el auto-link por email verificado no corre en e2e):

```ts
    created_at: dbUser.createdAt.toISOString(),
    email_confirmed_at: dbUser.createdAt.toISOString(),
```

- [ ] **Step 2: e2e** `tests/e2e/customer-account.spec.ts`. Estrategia (sin seed nuevo): `owner@mimosnails.com` actúa de "clienta" — el bypass exige una fila User existente y la dueña ya la tiene. De paso cubre el caso dual dueña+clienta.

```ts
import { test, expect } from '@playwright/test'
import { setOwnerAuth } from './helpers/auth'

test.describe('cuenta de clienta (/mi)', () => {
  test('auto-link por email y tarjeta visible en /mi', async ({ page }) => {
    test.setTimeout(90_000)
    setOwnerAuth(page)

    // 1. Crear (o reutilizar) una clienta con el email de la dueña vía dashboard.
    //    Nombre único para poder targetear su fila (aprendizaje e2e B3).
    const name = `E2E Cuenta ${Date.now()}`
    await page.goto('/dashboard/customers')
    // ... abrir el form de nueva clienta, completar name/phone único/email owner@mimosnails.com
    //     (verificar los selectores reales de la página al escribir el test)

    // 2. Visitar /mi → el layout corre ensureUserRow + auto-link.
    await page.goto('/mi')
    await expect(page.getByText('Mimos', { exact: false })).toBeVisible()

    // 3. Abrir el detalle y verificar la tarjeta compartida.
    await page.getByRole('link', { name: /mimos/i }).first().click()
    await expect(page).toHaveURL(/\/mi\//)
    await expect(page.getByText(/Historial/)).toBeVisible()
  })

  test('/dashboard sigue funcionando para la dueña (dual rol)', async ({ page }) => {
    setOwnerAuth(page)
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard/)
  })
})
```

Adaptar los selectores del paso 1 a la UI real de `/dashboard/customers` (leer `customer-list.tsx` / la página antes). Si no existe form de alta de clienta en el dashboard, crear la clienta vía funnel público (como los e2e de B3/B4a).

- [ ] **Step 3: Correr contra el stack real** (`npm run test:e2e -- customer-account`) — recordar que el e2e no es check requerido, es lento y deja artefactos en prod (aceptado).

- [ ] **Step 4: Commit**

```bash
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 add src/lib/auth/user.ts tests/e2e/customer-account.spec.ts
git -C /Users/robertozamorautrera/Projects/agendita/.claude/worktrees/loving-northcutt-dc5a52 commit -m "test(d1a): customer account e2e + verified email in e2e bypass"
```

---

### Task 15: Gate final

- [ ] `npm test` → toda la suite unit verde (1152+ previos + los nuevos).
- [ ] `npx tsc --noEmit` → cero errores NUEVOS (comparar contra el baseline ~17 del setup).
- [ ] `npm run lint` → limpio.
- [ ] `/simplify` sobre el diff de la rama (4 agentes de cleanup) → aplicar lo razonable.
- [ ] `/code-review` high (5+ ángulos, verificación adversarial) → resolver findings reales.

---

## Cierre (con OK explícito del usuario en cada paso)

1. **Aplicar la migración a Supabase** (pedir OK primero):

```bash
./node_modules/.bin/dotenvx run -f .env.local -- npx prisma db execute --url "$DIRECT_URL" --file prisma/migrations/20260705120000_add_customer_account/migration.sql
npx prisma migrate resolve --applied 20260705120000_add_customer_account   # SIN esto, vercel-build rompe con P3009
```

2. **PR** contra `main` (título sugerido: "Customer accounts: Google login, linking and /mi surface (D1-a)"). CI corre la integración; e2e no es requerido.
3. **Merge** con OK explícito. Vercel debe quedar verde (si falla con P3009 → faltó el `migrate resolve`).
4. Recordar al usuario el **prerequisito operativo** (Google provider en Supabase) antes de probar el login real en prod.
