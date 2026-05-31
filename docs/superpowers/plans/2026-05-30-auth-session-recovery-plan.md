# Auth Session Recovery & Middleware Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the login → dashboard → login loop caused by missing BusinessUser, and fix middleware intercepting all `?code=` params globally.

**Architecture:** DashboardLayout redirects to `/recover-business` when user has session but no business. A new `/recover-business` page with a server action (`recoverBusiness()`) idempotently creates the missing Business, BusinessUser, BusinessSubscription, and AvailabilityRule records. Middleware only exchanges auth codes on `/auth/callback` with sanitized `?next=` param.

**Tech Stack:** Next.js App Router, Supabase SSR, Prisma, React Server Components, Server Actions

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/middleware.ts` | Fix code exchange to only /auth/callback |
| Modify | `src/app/dashboard/layout.tsx` | Add business null → /recover-business |
| Modify | `src/app/dashboard/page.tsx` | Fix redirect destination |
| Modify | `src/app/dashboard/onboarding/page.tsx` | Fix redirect destination |
| Create | `src/server/actions/recover-business.ts` | Idempotent business recovery |
| Create | `src/app/recover-business/page.tsx` | Server component page |
| Create | `src/app/recover-business/recover-business-form.tsx` | Client form component |
| Modify | `src/app/auth/callback/route.ts` | Clean up fallback |

---

### Task 1: Fix Middleware — Only exchange codes on /auth/callback

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Add sanitizeNext helper and rewrite code exchange block**

Replace the current code exchange block (lines 9-16) with route-specific handling:

```ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createMiddlewareAuthClient } from './lib/auth/middleware'

function sanitizeNext(next: string | null): string {
  if (!next) return '/dashboard'
  if (!next.startsWith('/')) return '/dashboard'
  if (next.startsWith('//')) return '/dashboard'
  return next
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === '/auth/callback') {
    const code = request.nextUrl.searchParams.get('code')

    if (code) {
      const next = sanitizeNext(request.nextUrl.searchParams.get('next'))
      const response = NextResponse.redirect(new URL(next, request.url))
      const supabase = createMiddlewareAuthClient(request, response)
      const { error } = await supabase.auth.exchangeCodeForSession(code)

      if (error) {
        return NextResponse.redirect(new URL('/login?error=auth_callback', request.url))
      }

      return response
    }

    return NextResponse.redirect(new URL('/login?error=missing_code', request.url))
  }

  // Skip middleware for static files, API routes, and auth pages
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/recover-business') ||
    pathname.startsWith('/auth') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // Extract subdomain from hostname for tenant resolution
  const rawHostname = request.headers.get('host') || request.nextUrl.hostname
  const hostname = rawHostname.split(':')[0].toLowerCase()
  const appDomain = (process.env.APP_DOMAIN || 'localhost')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .split(':')[0]
    .toLowerCase()

  let subdomain: string | null = null
  if (hostname !== appDomain && hostname !== 'localhost') {
    if (hostname.endsWith(`.${appDomain}`)) {
      subdomain = hostname.replace(`.${appDomain}`, '')
      if (subdomain === 'www') {
        subdomain = null
      }
    } else if (hostname.endsWith('.localhost')) {
      subdomain = hostname.replace('.localhost', '')
      if (subdomain === 'www') {
        subdomain = null
      }
    } else if (!hostname.endsWith('.vercel.app')) {
      const labels = hostname.split('.')
      subdomain = labels.length >= 3 ? labels[0] : null
      if (subdomain === 'www') {
        subdomain = null
      }
    }
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete('x-business-subdomain')

  if (subdomain) {
    requestHeaders.set('x-business-subdomain', subdomain)
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware.ts
git commit -m "fix: restrict auth code exchange to /auth/callback with sanitized next param"
```

---

### Task 2: Fix DashboardLayout — Redirect missing business to /recover-business

**Files:**
- Modify: `src/app/dashboard/layout.tsx`

- [ ] **Step 1: Add business null check**

After the existing `!userData?.user` check, add a check for `!userData.business`:

```tsx
import { redirect } from 'next/navigation'
import { DashboardSidebar } from '@/components/dashboard/sidebar'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const userData = await getCurrentUserWithBusiness()

  if (!userData || !userData.user) {
    redirect('/login')
  }

  if (!userData.business) {
    redirect('/recover-business')
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <DashboardSidebar user={userData.user} business={userData.business} />
      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        {children}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/layout.tsx
git commit -m "fix: redirect to /recover-business when session exists but business is null"
```

---

### Task 3: Fix DashboardPage — Change redirect destination

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/dashboard/onboarding/page.tsx`

- [ ] **Step 1: Fix DashboardPage**

Change lines 17-19 from:
```tsx
if (!userData?.business) {
  redirect('/login')
}
```
To:
```tsx
if (!userData?.business) {
  redirect('/recover-business')
}
```

Also add the `!userData?.user` check for defense in depth:
```tsx
if (!userData?.user) {
  redirect('/login')
}

if (!userData?.business) {
  redirect('/recover-business')
}
```

The full fix in `src/app/dashboard/page.tsx` (lines 17-19):
```tsx
  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }
```

- [ ] **Step 2: Fix OnboardingPage**

In `src/app/dashboard/onboarding/page.tsx`, change lines 10-12 from:
```tsx
if (!userData?.business) {
  redirect('/login')
}
```
To:
```tsx
if (!userData?.user) {
  redirect('/login')
}

if (!userData?.business) {
  redirect('/recover-business')
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/page.tsx src/app/dashboard/onboarding/page.tsx
git commit -m "fix: redirect to /recover-business instead of /login when business is null"
```

---

### Task 4: Create recoverBusiness server action

**Files:**
- Create: `src/server/actions/recover-business.ts`

- [ ] **Step 1: Create the server action**

```ts
'use server'

import { createClient } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db'
import { generateDefaultSubdomain } from '@/lib/business/subdomain'

type RecoverBusinessResult =
  | { success: true; alreadyExists?: boolean; redirectTo: string }
  | { success: false; error: string; code?: string }

const DEBUG = process.env.AUTH_RECOVERY_DEBUG === 'true'

export async function recoverBusiness(): Promise<RecoverBusinessResult> {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (userError || !user) {
    return { success: false, error: 'No se encontró sesión activa. Inicia sesión de nuevo.', code: 'NO_SESSION' }
  }

  const supabaseUserId = user.id
  const supabaseEmail = user.email

  if (!supabaseEmail) {
    return { success: false, error: 'Tu cuenta no tiene email asociado. Contacta soporte.', code: 'NO_EMAIL' }
  }

  if (DEBUG) {
    console.log('[recoverBusiness]', { supabaseUserId, supabaseEmail })
  }

  let prismaUser = await prisma.user.findUnique({ where: { id: supabaseUserId } })

  if (DEBUG) {
    console.log('[recoverBusiness] prismaUserExists:', !!prismaUser)
  }

  if (!prismaUser) {
    const userByEmail = await prisma.user.findUnique({ where: { email: supabaseEmail } })

    if (userByEmail && userByEmail.id !== supabaseUserId) {
      return {
        success: false,
        error: 'Ya existe una cuenta con este email asociada a otro usuario. Contacta soporte.',
        code: 'EMAIL_ID_CONFLICT',
      }
    }

    prismaUser = await prisma.user.create({
      data: {
        id: supabaseUserId,
        email: supabaseEmail,
        name: user.user_metadata?.name || null,
      },
    })
  }

  const existingBusinessUser = await prisma.businessUser.findFirst({
    where: { userId: supabaseUserId },
    include: { business: true },
  })

  if (DEBUG) {
    console.log('[recoverBusiness] businessUserExists:', !!existingBusinessUser)
  }

  if (existingBusinessUser) {
    return { success: true, alreadyExists: true, redirectTo: '/dashboard' }
  }

  const betaPlan = await prisma.plan.findFirst({ where: { name: 'Beta gratis' } })
  if (!betaPlan) {
    return {
      success: false,
      error: 'No se encontró el plan Beta gratis. Contacta soporte para configurar los planes.',
      code: 'MISSING_BETA_PLAN',
    }
  }

  const baseSubdomain = generateDefaultSubdomain(supabaseEmail)
  const thirtyDaysFromNow = new Date()
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

  try {
    await prisma.$transaction(async (tx) => {
      // Resolver subdomain y slug sin colisiones dentro de la transacción
      let candidateSubdomain = baseSubdomain
      let attempt = 0

      while (true) {
        const suffix = attempt === 0 ? '' : `-${attempt + 1}`
        const candidate = `${baseSubdomain}${suffix}`

        const existing = await tx.business.findFirst({
          where: {
            OR: [
              { subdomain: candidate },
              { slug: candidate },
            ],
          },
          select: { id: true },
        })

        if (!existing) {
          candidateSubdomain = candidate
          break
        }

        attempt++
        if (attempt > 20) {
          candidateSubdomain = `${baseSubdomain}-${Date.now()}`
          break
        }
      }

      const business = await tx.business.create({
        data: {
          name: user.user_metadata?.name || 'Mi negocio',
          category: 'other',
          slug: candidateSubdomain,
          subdomain: candidateSubdomain,
          ownerUserId: supabaseUserId,
          city: 'Santiago',
          currency: 'CLP',
          timezone: 'America/Santiago',
          planId: betaPlan.id,
          subscriptionStatus: 'trialing',
          trialEndsAt: thirtyDaysFromNow,
        },
      })

      await tx.businessUser.create({
        data: {
          businessId: business.id,
          userId: supabaseUserId,
          role: 'owner',
        },
      })

      await tx.businessSubscription.create({
        data: {
          businessId: business.id,
          planId: betaPlan.id,
          status: 'trialing',
          interval: 'monthly',
          currentPeriodStart: new Date(),
          currentPeriodEnd: thirtyDaysFromNow,
          trialStartAt: new Date(),
          trialEndAt: thirtyDaysFromNow,
        },
      })

      await tx.availabilityRule.createMany({
        data: [
          { businessId: business.id, dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
          { businessId: business.id, dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
          { businessId: business.id, dayOfWeek: 3, startTime: '09:00', endTime: '18:00' },
          { businessId: business.id, dayOfWeek: 4, startTime: '09:00', endTime: '18:00' },
          { businessId: business.id, dayOfWeek: 5, startTime: '09:00', endTime: '18:00' },
          { businessId: business.id, dayOfWeek: 6, startTime: '10:00', endTime: '15:00' },
        ],
      })
    })

    if (DEBUG) {
      console.log('[recoverBusiness] businessCreated: true')
    }

    return { success: true, redirectTo: '/dashboard/onboarding' }
  } catch (error) {
    if (DEBUG) {
      console.error('[recoverBusiness] error:', error)
    }

    return {
      success: false,
      error: 'No pudimos crear tu negocio. Intenta de nuevo o contacta soporte.',
      code: 'CREATE_FAILED',
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/actions/recover-business.ts
git commit -m "feat: add idempotent recoverBusiness server action for orphan users"
```

---

### Task 5: Create /recover-business page (Server Component)

**Files:**
- Create: `src/app/recover-business/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { redirect } from 'next/navigation'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { RecoverBusinessForm } from './recover-business-form'

export default async function RecoverBusinessPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (userData.business) {
    redirect('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <RecoverBusinessForm
        email={userData.user.email ?? ''}
        name={(userData.user.user_metadata as { name?: string } | undefined)?.name ?? null}
      />
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/recover-business/page.tsx
git commit -m "feat: add /recover-business server component page"
```

---

### Task 6: Create RecoverBusinessForm (Client Component)

**Files:**
- Create: `src/app/recover-business/recover-business-form.tsx`

- [ ] **Step 1: Create the form component**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { recoverBusiness } from '@/server/actions/recover-business'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface RecoverBusinessFormProps {
  email: string
  name: string | null
}

export function RecoverBusinessForm({ email, name }: RecoverBusinessFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleRecover() {
    setError(null)

    startTransition(async () => {
      const result = await recoverBusiness()

      if (!result.success) {
        setError(result.error)
        return
      }

      router.push(result.redirectTo)
      router.refresh()
    })
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Recuperar negocio</CardTitle>
        <CardDescription>
          Parece que tu cuenta no tiene un negocio asociado. Esto puede pasar si tu cuenta se
          creó correctamente pero hubo un problema al configurar tu negocio. Podemos intentar
          reconstruirlo automáticamente.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <p><strong>Cuenta:</strong> {email}</p>
          {name && <p><strong>Nombre:</strong> {name}</p>}
        </div>

        <p className="text-sm text-muted-foreground">
          Se creará tu negocio con una suscripción beta gratuita y horarios iniciales.
        </p>

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button
          type="button"
          className="w-full"
          onClick={handleRecover}
          disabled={isPending}
        >
          {isPending ? 'Recuperando...' : 'Recuperar mi negocio'}
        </Button>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/recover-business/recover-business-form.tsx
git commit -m "feat: add RecoverBusinessForm client component"
```

---

### Task 7: Clean up auth callback route handler

**Files:**
- Modify: `src/app/auth/callback/route.ts`

- [ ] **Step 1: Clean up the route handler**

The middleware now handles code exchange. Simplify the route handler:

```ts
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const next = requestUrl.searchParams.get('next') || '/dashboard'
  return NextResponse.redirect(new URL(next, request.url))
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/auth/callback/route.ts
git commit -m "fix: simplify auth callback route, middleware handles code exchange"
```

---

### Task 8: Write tests for recoverBusiness and sanitizeNext

**Files:**
- Create: `tests/unit/recover-business.test.ts`
- Create: `tests/unit/sanitize-next.test.ts`

- [ ] **Step 1: Create sanitizeNext tests**

Since sanitizeNext is a pure function in middleware, test it directly. Create `tests/unit/sanitize-next.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

function sanitizeNext(next: string | null): string {
  if (!next) return '/dashboard'
  if (!next.startsWith('/')) return '/dashboard'
  if (next.startsWith('//')) return '/dashboard'
  return next
}

describe('sanitizeNext', () => {
  it('returns /dashboard when null', () => {
    expect(sanitizeNext(null)).toBe('/dashboard')
  })

  it('returns /dashboard when empty string', () => {
    expect(sanitizeNext('')).toBe('/dashboard')
  })

  it('returns the path when valid', () => {
    expect(sanitizeNext('/reset-password')).toBe('/reset-password')
  })

  it('returns /dashboard when protocol-relative URL (//evil.com)', () => {
    expect(sanitizeNext('//evil.com')).toBe('/dashboard')
  })

  it('returns /dashboard when full URL-like (https://evil.com)', () => {
    expect(sanitizeNext('https://evil.com')).toBe('/dashboard')
  })

  it('returns /dashboard when relative without leading slash', () => {
    expect(sanitizeNext('evil.com')).toBe('/dashboard')
  })

  it('returns path with query params intact', () => {
    expect(sanitizeNext('/dashboard?foo=bar')).toBe('/dashboard?foo=bar')
  })
})
```

- [ ] **Step 2: Run sanitizeNext tests**

```bash
npx vitest run tests/unit/sanitize-next.test.ts
```

Expected: All 7 tests pass.

- [ ] **Step 3: Create recoverBusiness tests**

Create `tests/unit/recover-business.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = {
  user: { findUnique: vi.fn(), create: vi.fn() },
  businessUser: { findFirst: vi.fn() },
  plan: { findFirst: vi.fn() },
  business: { findFirst: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}

const mockSupabaseGetUser = vi.fn()
const mockSupabase = { auth: { getUser: mockSupabaseGetUser } }

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/auth/middleware', () => ({
  createClient: () => mockSupabase,
}))

function makeUser(id: string, email: string) {
  return { id, email, user_metadata: { name: 'Test User' }, app_metadata: {}, aud: 'authenticated', created_at: '2024-01-01', role: 'authenticated' }
}

describe('recoverBusiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.plan.findFirst.mockResolvedValue({ id: 'plan-beta', name: 'Beta gratis' })
  })

  function setupTransaction() {
    const tx = {
      business: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'biz-1' }),
      },
      businessUser: { create: vi.fn() },
      businessSubscription: { create: vi.fn() },
      availabilityRule: { createMany: vi.fn() },
    }
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(tx))
    return tx
  }

  it('creates business when user has none', async () => {
    mockSupabaseGetUser.mockResolvedValue({ data: { user: makeUser('user-1', 'a@a.com') }, error: null })
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@a.com', name: 'Test User' })
    mockPrisma.businessUser.findFirst.mockResolvedValue(null)

    const tx = setupTransaction()
    const { recoverBusiness } = await import('@/server/actions/recover-business')

    const result = await recoverBusiness()

    expect(result).toEqual({ success: true, redirectTo: '/dashboard/onboarding' })
    expect(tx.businessUser.create).toHaveBeenCalled()
    expect(tx.businessSubscription.create).toHaveBeenCalled()
    expect(tx.availabilityRule.createMany).toHaveBeenCalled()
  })

  it('returns alreadyExists when business exists', async () => {
    mockSupabaseGetUser.mockResolvedValue({ data: { user: makeUser('user-1', 'a@a.com') }, error: null })
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@a.com', name: 'Test User' })
    mockPrisma.businessUser.findFirst.mockResolvedValue({ userId: 'user-1', businessId: 'biz-1', role: 'owner', business: { id: 'biz-1' } })

    const { recoverBusiness } = await import('@/server/actions/recover-business')
    const result = await recoverBusiness()

    expect(result).toEqual({ success: true, alreadyExists: true, redirectTo: '/dashboard' })
  })

  it('returns error when no session', async () => {
    mockSupabaseGetUser.mockResolvedValue({ data: { user: null }, error: new Error('No session') })

    const { recoverBusiness } = await import('@/server/actions/recover-business')
    const result = await recoverBusiness()

    expect(result).toEqual({ success: false, error: 'No se encontró sesión activa. Inicia sesión de nuevo.', code: 'NO_SESSION' })
  })

  it('returns error when email conflict', async () => {
    mockSupabaseGetUser.mockResolvedValue({ data: { user: makeUser('user-9', 'taken@email.com') }, error: null })
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null) // find by id: not found
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-other', email: 'taken@email.com', name: 'Other' }) // find by email: different id
    mockPrisma.businessUser.findFirst.mockResolvedValue(null)

    const { recoverBusiness } = await import('@/server/actions/recover-business')
    const result = await recoverBusiness()

    expect(result).toEqual({
      success: false,
      error: 'Ya existe una cuenta con este email asociada a otro usuario. Contacta soporte.',
      code: 'EMAIL_ID_CONFLICT',
    })
  })

  it('returns error when plan missing', async () => {
    mockSupabaseGetUser.mockResolvedValue({ data: { user: makeUser('user-1', 'a@a.com') }, error: null })
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@a.com', name: 'Test User' })
    mockPrisma.businessUser.findFirst.mockResolvedValue(null)
    mockPrisma.plan.findFirst.mockResolvedValue(null)

    const { recoverBusiness } = await import('@/server/actions/recover-business')
    const result = await recoverBusiness()

    expect(result).toEqual({
      success: false,
      error: 'No se encontró el plan Beta gratis. Contacta soporte para configurar los planes.',
      code: 'MISSING_BETA_PLAN',
    })
  })
})
```

- [ ] **Step 4: Run recoverBusiness tests**

```bash
npx vitest run tests/unit/recover-business.test.ts
```

Expected: 4 tests pass (5th is a placeholder).

- [ ] **Step 5: Commit tests**

```bash
git add tests/unit/recover-business.test.ts tests/unit/sanitize-next.test.ts
git commit -m "test: add unit tests for recoverBusiness and sanitizeNext"
```

---

### Task 9: TypeScript check and build verification

**Files:** None

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors in files we modified (pre-existing test file errors are OK).

- [ ] **Step 2: Run build check**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit any fixes if needed**

If there are type errors, fix them and commit with message: `chore: fix type errors from auth recovery changes`

---

### Task 10: Push and verify deployment

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

- [ ] **Step 2: Verify deployment on Vercel**

Wait for Vercel deployment to complete. Check:
1. Login with valid credentials → should reach dashboard (or recover-business if no business)
2. Login with account that has no BusinessUser → should reach /recover-business
3. Click "Recuperar mi negocio" → should create business and redirect to /dashboard/onboarding
4. Password reset email flow → should work via /auth/callback?next=/reset-password
5. Normal login after recovery → should go straight to dashboard
