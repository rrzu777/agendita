# B4b-2 — Compra online pública de paquetes prepagos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que una clienta logueada compre un paquete prepago (`PackageProduct`) online con Mercado Pago desde una página pública `/paquetes`, y que al aprobarse el pago el paquete se active automáticamente (grants + ledger) y quede visible en su cuenta `/mi`.

**Architecture:** Enfoque C (híbrido). Se reusa el tronco de pago de reservas: se extrae un helper compartido `createMpPreferenceForPayment` a un módulo lib neutro, se agregan acciones públicas de checkout de paquete que arman su propio `Payment(pending)`, y se agrega un branch de dispatch en el webhook MP (`payment.bookingId ? applyApprovedPayment : applyApprovedPackagePayment`). El camino de reservas queda con contrato idéntico.

**Tech Stack:** Next.js 16 App Router, Prisma + PostgreSQL (Supabase), Mercado Pago (per-business OAuth, cliente `fetch` hand-rolled), Resend (email), Vitest 4, TypeScript strict.

**Spec fuente:** `docs/superpowers/specs/2026-07-12-packages-B4b-2-online-purchase-design.md`

---

## Landmines (leer antes de empezar)

- **AGENTS.md:** "This is NOT the Next.js you know" — leer `node_modules/next/dist/docs/` antes de escribir APIs de Next que no conozcas de memoria.
- **`revalidateBusinessPublicPaths` DEBE ir `await`-eado** — sin await el proceso sale con código 128. Aplica a Task 3.
- **NO usar `relationLoadStrategy: 'join'`** en los readers cacheados de `public.ts` (panic de Prisma 5.22 con includes anidados). Aplica a Task 1.
- **`tsc --noEmit | grep '^src/'`** no lo corre vitest ni eslint; correrlo en el gate o CI `build` rompe. Aplica a Task 16.
- **Sin migración nueva:** todos los campos (`PackagePurchase.status/source/holdExpiresAt`, `Payment.packagePurchaseId`, `PaymentType.package_purchase`) ya existen de B4b-1.
- **Costura load-bearing:** pasar `email: user.email` (verificado de sesión) **y** `sessionUser: user` a `findOrCreateCustomerInTx` es lo que hace que `/mi/[slug]` (que lee `Customer` por `userId`) muestre la compra. Aplica a Task 6.
- **`git -C <worktree>` + `git add <archivos explícitos>`** (no `-A`) por drift de cwd en worktrees.
- **NO tocar** `sanitizeNext` ni `signOut`.

## File Structure (mapa de decomposición)

**Crear:**
- `src/lib/payments/create-preference.ts` — helper compartido `createMpPreferenceForPayment` + `getPaymentAppUrl` (corazón del enfoque C; módulo neutro importable por dos archivos `'use server'`).
- `src/lib/payments/package-confirmation-state.ts` — `derivePackageConfirmationState` (función pura).
- `src/server/actions/packages-checkout.ts` — acciones públicas `createPackagePurchase` / `initiatePackagePayment` / `verifyAndConfirmPackagePayment` / `getPackageCheckoutPrefill`.
- `src/app/paquetes/[slug]/page.tsx`, `src/app/paquetes/page.tsx`, `src/app/paquetes/confirmation/page.tsx` — rutas públicas.
- `src/components/packages/packages-business-page.tsx`, `package-catalog.tsx`, `package-checkout.tsx` — shell + catálogo + wizard.

**Modificar:**
- `src/lib/business/public.ts` — readers cacheados `getPackagesBusinessBySlug/BySubdomain` + tipo `PackagesBusiness`.
- `src/server/actions/revalidate-business.ts` — tags + paths de paquetes.
- `src/server/actions/packages.ts` — revalidación pública en upsert/archive; `getCustomerPackages` excluye `pending`.
- `src/lib/business/urls.ts` — `getPackageConfirmationUrl`.
- `src/server/actions/payments.ts` — `initiatePayment` delega al helper compartido.
- `src/app/api/webhooks/mercado-pago/route.ts` — branch de dispatch + metadata por tipo + refund de paquete + revalidación.
- `src/lib/notifications/{templates,email-provider,index}.ts` — 2 envíos nuevos.
- `src/server/actions/customers.ts` — ocultar `package_purchase` pending del historial.
- `src/app/dashboard/customers/[id]/package-panel.tsx` — aviso source-aware en refund.
- `src/server/actions/ledger.ts` — línea de ingresos por paquete + include `packagePurchase`.
- `src/app/dashboard/page.tsx` (o `payments/page.tsx`) — mostrar ingresos por paquete.
- `src/components/public/business-profile.tsx` — CTA "Paquetes".

**Orden de ejecución:** Tasks 1→16 en secuencia (cada una compila y testea sola). Las Tasks 1–10 son server/lógica (TDD estricto). Las 11–13 son UI. La 14–15 son fixes de dashboard. La 16 es el gate.

---

### Task 1: Readers públicos cacheados de paquetes

**Files:**
- Modify: `src/lib/business/public.ts`
- Test: `src/lib/business/public.packages.test.ts` (crear)

- [ ] **Step 1: Escribir el test que fija el include y el filtro `isActive`**

Crear `src/lib/business/public.test.ts` si no existe un test para este módulo; si existe, agregar el caso. Como los readers están envueltos en `unstable_cache`, el test valida el shape del `include` a través de un mock de Prisma.

```ts
// src/lib/business/public.packages.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUnique = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { business: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))
// unstable_cache: passthrough que ejecuta la fn directamente
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

import { getPackagesBusinessBySlug } from './public'

describe('getPackagesBusinessBySlug', () => {
  beforeEach(() => findUnique.mockReset())

  it('incluye packageProducts activos con sus services y respeta isActive del negocio', async () => {
    findUnique.mockResolvedValue({ id: 'b1', isActive: true, packageProducts: [] })
    const res = await getPackagesBusinessBySlug('demo')
    expect(res).not.toBeNull()
    const arg = findUnique.mock.calls[0][0]
    expect(arg.where).toEqual({ slug: 'demo' })
    expect(arg.include.packageProducts.where).toEqual({ isActive: true })
    expect(arg.include.packageProducts.include.services).toBeTruthy()
  })

  it('devuelve null si el negocio está inactivo', async () => {
    findUnique.mockResolvedValue({ id: 'b1', isActive: false, packageProducts: [] })
    expect(await getPackagesBusinessBySlug('demo')).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test — debe fallar**

Run: `npx vitest run src/lib/business/public.packages.test.ts`
Expected: FAIL — `getPackagesBusinessBySlug is not a function` / import error.

- [ ] **Step 3: Implementar los readers**

En `src/lib/business/public.ts`, agregar al final del archivo (después de `getBookingBusinessBySubdomain`). **NO usar `relationLoadStrategy: 'join'`** (ver NOTE del archivo).

```ts
export const packagesBusinessInclude = {
  packageProducts: {
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    include: {
      services: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.BusinessInclude

export type PackagesBusiness = Prisma.BusinessGetPayload<{
  include: typeof packagesBusinessInclude
}>

export const getPackagesBusinessBySlug = unstable_cache(async (slug: string) => {
  const business = await prisma.business.findUnique({
    where: { slug },
    include: packagesBusinessInclude,
  })
  return business?.isActive ? business : null
}, ['packages-business-by-slug'], { revalidate: 60, tags: ['packages-business-by-slug'] })

export const getPackagesBusinessBySubdomain = unstable_cache(async (subdomain: string) => {
  const business = await prisma.business.findUnique({
    where: { subdomain },
    include: packagesBusinessInclude,
  })
  return business?.isActive ? business : null
}, ['packages-business-by-subdomain'], { revalidate: 60, tags: ['packages-business-by-subdomain'] })
```

- [ ] **Step 4: Correr el test — debe pasar**

Run: `npx vitest run src/lib/business/public.packages.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git -C . add src/lib/business/public.ts src/lib/business/public.packages.test.ts
git commit -m "feat(packages): readers públicos cacheados de paquetes (getPackagesBusinessBySlug/BySubdomain)"
```

---

### Task 2: Tags y paths de revalidación de paquetes

**Files:**
- Modify: `src/server/actions/revalidate-business.ts`
- Test: `src/server/actions/revalidate-business.test.ts` (crear o extender)

- [ ] **Step 1: Escribir el test**

```ts
// src/server/actions/revalidate-business.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const revalidateTag = vi.fn()
const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a), revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
const findUnique = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { business: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))

import { revalidateBusinessPublicPaths } from './revalidate-business'

describe('revalidateBusinessPublicPaths', () => {
  beforeEach(() => { revalidateTag.mockReset(); revalidatePath.mockReset(); findUnique.mockReset() })

  it('invalida también los tags y paths de paquetes', async () => {
    findUnique.mockResolvedValue({ slug: 'demo', subdomain: null })
    await revalidateBusinessPublicPaths('b1')
    expect(revalidateTag).toHaveBeenCalledWith('packages-business-by-slug', 'max')
    expect(revalidateTag).toHaveBeenCalledWith('packages-business-by-subdomain', 'max')
    expect(revalidatePath).toHaveBeenCalledWith('/paquetes')
    expect(revalidatePath).toHaveBeenCalledWith('/paquetes/demo')
  })
})
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npx vitest run src/server/actions/revalidate-business.test.ts`
Expected: FAIL — el path `/paquetes` no se invalida.

- [ ] **Step 3: Implementar**

En `src/server/actions/revalidate-business.ts`, extender `CACHE_TAGS` y el cuerpo:

```ts
const CACHE_TAGS = {
  publicBySlug: 'public-business-by-slug',
  publicBySubdomain: 'public-business-by-subdomain',
  bookingBySlug: 'booking-business-by-slug',
  bookingBySubdomain: 'booking-business-by-subdomain',
  packagesBySlug: 'packages-business-by-slug',
  packagesBySubdomain: 'packages-business-by-subdomain',
} as const
```

Y en `revalidateBusinessPublicPaths`, después de los 4 `revalidateTag` existentes y antes/junto a los `revalidatePath`:

```ts
  revalidateTag(CACHE_TAGS.packagesBySlug, 'max')
  revalidateTag(CACHE_TAGS.packagesBySubdomain, 'max')

  revalidatePath('/')
  revalidatePath('/book')
  revalidatePath(`/b/${business.slug}`)
  revalidatePath(`/book/${business.slug}`)
  revalidatePath('/paquetes')
  revalidatePath(`/paquetes/${business.slug}`)
```

- [ ] **Step 4: Correr — debe pasar**

Run: `npx vitest run src/server/actions/revalidate-business.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C . add src/server/actions/revalidate-business.ts src/server/actions/revalidate-business.test.ts
git commit -m "feat(packages): revalidación de tags/paths públicos de paquetes"
```

---

### Task 3: Revalidación pública en CRUD de paquetes + `getCustomerPackages` excluye pending

**Files:**
- Modify: `src/server/actions/packages.ts`
- Test: `src/server/actions/packages.test.ts` (extender si existe; si no, crear caso focalizado)

- [ ] **Step 1: Escribir el test de `getCustomerPackages`**

El caso clave verificable sin DB real es el `where`. Agregar test que mockee prisma y afirme el filtro de status. Añadir a un archivo nuevo `src/server/actions/packages.customer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'b1', user: { id: 'u1' } }),
  ForbiddenError: class extends Error {},
}))
const findMany = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { packagePurchase: { findMany: (...a: unknown[]) => findMany(...a) } } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))

import { getCustomerPackages } from './packages'

describe('getCustomerPackages', () => {
  beforeEach(() => findMany.mockReset())
  it('excluye compras pending del panel de la dueña', async () => {
    findMany.mockResolvedValue([])
    await getCustomerPackages('c1')
    const arg = findMany.mock.calls[0][0]
    expect(arg.where.status).toEqual({ in: ['active', 'refunded'] })
  })
})
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npx vitest run src/server/actions/packages.customer.test.ts`
Expected: FAIL — `where.status` es `undefined` (hoy no filtra).

- [ ] **Step 3: Implementar los 3 cambios**

En `src/server/actions/packages.ts`:

(a) Agregar el import (junto a los imports existentes):
```ts
import { revalidateBusinessPublicPaths } from './revalidate-business'
```

(b) En `upsertPackageProduct`, reemplazar la última línea `await revalidatePath('/dashboard/paquetes')` por:
```ts
  await revalidatePath('/dashboard/paquetes')
  await revalidateBusinessPublicPaths(businessId)
```

(c) En `archivePackageProduct`, reemplazar `await revalidatePath('/dashboard/paquetes')` por:
```ts
  await revalidatePath('/dashboard/paquetes')
  await revalidateBusinessPublicPaths(businessId)
```

(d) En `getCustomerPackages`, agregar el filtro de status:
```ts
  return prisma.packagePurchase.findMany({
    where: { businessId, customerId, status: { in: ['active', 'refunded'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { name: true } },
      _count: { select: { grants: { where: { status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] } } } },
    },
  })
```

> **Landmine:** `revalidateBusinessPublicPaths` DEBE ir con `await` (sin await → exit 128).

- [ ] **Step 4: Correr — debe pasar**

Run: `npx vitest run src/server/actions/packages.customer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C . add src/server/actions/packages.ts src/server/actions/packages.customer.test.ts
git commit -m "feat(packages): revalidar catálogo público al editar/archivar + excluir pending del panel dueña"
```

---

### Task 4: `getPackageConfirmationUrl`

**Files:**
- Modify: `src/lib/business/urls.ts`
- Test: `src/lib/business/urls.test.ts` (extender o crear)

- [ ] **Step 1: Escribir el test**

```ts
// src/lib/business/urls.packages.test.ts
import { describe, it, expect } from 'vitest'
import { getPackageConfirmationUrl } from './urls'

describe('getPackageConfirmationUrl', () => {
  it('path style sin subdominio', () => {
    const url = getPackageConfirmationUrl({ slug: 'demo', subdomain: null }, 'p1')
    expect(url).toContain('/b/demo/paquetes/confirmation?purchaseId=p1')
  })
  it('subdominio', () => {
    const url = getPackageConfirmationUrl({ slug: 'demo', subdomain: 'demo' }, 'p1')
    expect(url).toContain('demo.')
    expect(url).toContain('/paquetes/confirmation?purchaseId=p1')
  })
})
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npx vitest run src/lib/business/urls.packages.test.ts`
Expected: FAIL — `getPackageConfirmationUrl is not a function`.

- [ ] **Step 3: Implementar**

En `src/lib/business/urls.ts`, agregar junto a `getBookingConfirmationUrl`:

```ts
/** URL de la página de confirmación de una compra de paquete
 *  (`/paquetes/confirmation?purchaseId=`), colgando de la URL pública del negocio. */
export function getPackageConfirmationUrl(business: BusinessUrlInput, purchaseId: string): string {
  return `${getBusinessPublicUrl(business)}/paquetes/confirmation?purchaseId=${purchaseId}`
}
```

- [ ] **Step 4: Correr — debe pasar**

Run: `npx vitest run src/lib/business/urls.packages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C . add src/lib/business/urls.ts src/lib/business/urls.packages.test.ts
git commit -m "feat(packages): getPackageConfirmationUrl"
```

---

### Task 5: Helper compartido `createMpPreferenceForPayment` + refactor de `initiatePayment`

**Files:**
- Create: `src/lib/payments/create-preference.ts`
- Modify: `src/server/actions/payments.ts`
- Test: `src/lib/payments/create-preference.test.ts` (crear)

> **Por qué un módulo lib y no dentro de `payments.ts`:** dos archivos `'use server'` (`payments.ts` y `packages-checkout.ts`) necesitan el helper. En un módulo `'use server'`, todo export debe ser una server action async expuesta como RPC; exponer un helper que recibe una instancia `PaymentProvider` (no serializable) como endpoint es incorrecto. Un módulo neutro es la altitud correcta.

- [ ] **Step 1: Escribir el test del helper**

```ts
// src/lib/payments/create-preference.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const update = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { payment: { update: (...a: unknown[]) => update(...a) } } }))

import { createMpPreferenceForPayment } from './create-preference'
import type { PaymentProvider } from './types'

function fakeProvider(): PaymentProvider {
  return {
    name: 'mercado_pago',
    createPayment: vi.fn().mockResolvedValue({
      paymentId: 'pay1', providerPaymentId: null, redirectUrl: 'https://mp/redirect',
      status: 'pending', rawResponse: { preferenceId: 'pref1', init_point: 'https://mp/redirect' },
    }),
    verifyPayment: vi.fn(), handleWebhook: vi.fn(),
  }
}

describe('createMpPreferenceForPayment', () => {
  beforeEach(() => update.mockReset())

  it('llama createPayment y persiste rawResponse en el Payment local', async () => {
    const provider = fakeProvider()
    const res = await createMpPreferenceForPayment(provider, {
      amount: 5000, currency: 'CLP', bookingId: '', description: 'Paquete X',
      returnUrl: 'https://x/return', webhookUrl: 'https://x/webhook',
      localPaymentId: 'pay1', customerEmail: 'c@x.cl',
      metadata: { packagePurchaseId: 'pp1', businessId: 'b1', paymentType: 'package_purchase', localPaymentId: 'pay1' },
    })
    expect(res.redirectUrl).toBe('https://mp/redirect')
    expect(update).toHaveBeenCalledWith({ where: { id: 'pay1' }, data: { rawPayload: { preferenceId: 'pref1', init_point: 'https://mp/redirect' } } })
  })

  it('no persiste rawPayload si no hay localPaymentId', async () => {
    const provider = fakeProvider()
    await createMpPreferenceForPayment(provider, {
      amount: 1, currency: 'CLP', bookingId: '', description: 'x',
      returnUrl: 'r', webhookUrl: 'w',
    })
    expect(update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npx vitest run src/lib/payments/create-preference.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Crear el módulo**

`src/lib/payments/create-preference.ts`:

```ts
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { PaymentProvider, CreatePaymentInput, CreatePaymentResult } from './types'

/**
 * Base URL de la app para armar el webhookUrl. Verbatim del helper privado que
 * vivía en payments.ts — precedencia APP_URL > NEXT_PUBLIC_APP_DOMAIN (distinta
 * a la de urls.ts), preservada para no cambiar el contrato del webhook de reserva.
 */
export function getPaymentAppUrl(): string {
  const raw = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_DOMAIN || ''
  const clean = raw.replace(/\/$/, '')
  if (clean.startsWith('localhost') || clean.startsWith('127.0.0.1')) {
    return `http://${clean}`
  }
  if (clean.startsWith('http')) {
    return clean
  }
  return `https://${clean}`
}

/**
 * Núcleo compartido (enfoque C): crea la preferencia MP vía el provider y
 * persiste el rawPayload (preferenceId, init_point) en el Payment local.
 * Lo usan initiatePayment (reserva) e initiatePackagePayment (paquete).
 * El contrato con el provider es idéntico al inline previo de initiatePayment.
 */
export async function createMpPreferenceForPayment(
  provider: PaymentProvider,
  input: CreatePaymentInput,
): Promise<CreatePaymentResult> {
  const result = await provider.createPayment(input)
  if (input.localPaymentId) {
    await prisma.payment.update({
      where: { id: input.localPaymentId },
      data: { rawPayload: result.rawResponse as Prisma.InputJsonValue },
    })
  }
  return result
}
```

- [ ] **Step 4: Correr el test del helper — debe pasar**

Run: `npx vitest run src/lib/payments/create-preference.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Refactorizar `initiatePayment` para delegar en el helper**

En `src/server/actions/payments.ts`:

(a) Eliminar la función privada `getAppUrl()` (líneas ~23-33) e importar desde el módulo nuevo:
```ts
import { createMpPreferenceForPayment, getPaymentAppUrl } from '@/lib/payments/create-preference'
```

(b) En el branch `if (provider.name === 'mercado_pago')` de `initiatePayment`, reemplazar el bloque `const result = await provider.createPayment({...})` + el `await prisma.payment.update({ ... rawPayload ... })` por:

```ts
    const result = await createMpPreferenceForPayment(provider, {
      amount,
      currency,
      bookingId: data.bookingId,
      description,
      returnUrl: getBookingConfirmationUrl(booking.business, data.bookingId),
      webhookUrl: `${getPaymentAppUrl()}/api/webhooks/mercado-pago`,
      localPaymentId,
      customerEmail: booking.customer?.email ?? null,
      metadata: {
        bookingId: data.bookingId,
        businessId: booking.businessId,
        paymentType: 'deposit',
        localPaymentId,
      },
    })

    logger.payment.initiated(localPaymentId, data.bookingId, booking.businessId)

    revalidatePath('/dashboard/payments')
    return result
```

(c) En el branch de mock/otros providers (más abajo), cambiar `webhookUrl: \`${getAppUrl()}/api/webhooks/${provider.name}\`` por `webhookUrl: \`${getPaymentAppUrl()}/api/webhooks/${provider.name}\``.

- [ ] **Step 6: Verificar que el contrato de reserva sigue idéntico**

Run: `npx vitest run src/server/actions/payments.test.ts src/lib/payments`
Expected: PASS — todos los tests existentes de `initiatePayment` siguen verdes (contrato de reserva intacto).

- [ ] **Step 7: Commit**

```bash
git -C . add src/lib/payments/create-preference.ts src/lib/payments/create-preference.test.ts src/server/actions/payments.ts
git commit -m "refactor(payments): extraer createMpPreferenceForPayment compartido (enfoque C)"
```

---

### Task 6: `createPackagePurchase` + `getPackageCheckoutPrefill`

**Files:**
- Create: `src/server/actions/packages-checkout.ts`
- Test: `src/server/actions/packages-checkout.create.test.ts` (crear)

- [ ] **Step 1: Escribir los tests**

```ts
// src/server/actions/packages-checkout.create.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCurrentUser = vi.fn()
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: () => getCurrentUser() }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))

const findOrCreateCustomerInTx = vi.fn()
vi.mock('@/lib/customers/find-or-create', () => ({ findOrCreateCustomerInTx: (...a: unknown[]) => findOrCreateCustomerInTx(...a) }))

const resolveOnlinePaymentAvailabilityForBusiness = vi.fn()
vi.mock('@/lib/payments/factory', () => ({
  resolveOnlinePaymentAvailabilityForBusiness: (...a: unknown[]) => resolveOnlinePaymentAvailabilityForBusiness(...a),
}))

const tx = {
  packageProduct: { findFirst: vi.fn() },
  packagePurchase: { findFirst: vi.fn(), create: vi.fn() },
}
vi.mock('@/lib/db', () => ({
  prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
}))

import { createPackagePurchase } from './packages-checkout'

const baseInput = { packageProductId: 'prod1', name: 'Ana', phone: '+56911112222', acceptedTerms: true }
const product = {
  id: 'prod1', businessId: 'b1', name: 'Pack 5', price: 50000, quantity: 5, bonusQuantity: 1,
  appliesToAll: true, expiryDays: 90, isActive: true, services: [],
}

describe('createPackagePurchase', () => {
  beforeEach(() => {
    Object.values(tx).forEach(m => Object.values(m).forEach(f => (f as ReturnType<typeof vi.fn>).mockReset()))
    getCurrentUser.mockReset(); findOrCreateCustomerInTx.mockReset(); resolveOnlinePaymentAvailabilityForBusiness.mockReset()
    getCurrentUser.mockResolvedValue({ id: 'u1', email: 'ana@x.cl' })
    resolveOnlinePaymentAvailabilityForBusiness.mockResolvedValue({ available: true, provider: 'mercado_pago' })
    tx.packageProduct.findFirst.mockResolvedValue(product)
    findOrCreateCustomerInTx.mockResolvedValue({ customer: { id: 'c1', email: 'ana@x.cl' }, created: false })
    tx.packagePurchase.findFirst.mockResolvedValue(null)
    tx.packagePurchase.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'pp1', ...data }))
  })

  it('rechaza si no hay sesión', async () => {
    getCurrentUser.mockResolvedValue(null)
    await expect(createPackagePurchase(baseInput)).rejects.toThrow(/iniciar sesión|login|sesión/i)
  })

  it('re-gatea disponibilidad online y rechaza si no disponible', async () => {
    resolveOnlinePaymentAvailabilityForBusiness.mockResolvedValue({ available: false, reason: 'no MP' })
    await expect(createPackagePurchase(baseInput)).rejects.toThrow('no MP')
  })

  it('pasa el email verificado de sesión y el sessionUser a findOrCreateCustomerInTx', async () => {
    await createPackagePurchase(baseInput)
    const arg = findOrCreateCustomerInTx.mock.calls[0][1]
    expect(arg.email).toBe('ana@x.cl')
    expect(arg.sessionUser).toEqual({ id: 'u1', email: 'ana@x.cl' })
    expect(arg.businessId).toBe('b1')
  })

  it('crea PackagePurchase pending/online con snapshots y holdExpiresAt futuro', async () => {
    const { purchaseId } = await createPackagePurchase(baseInput)
    expect(purchaseId).toBe('pp1')
    const data = tx.packagePurchase.create.mock.calls[0][0].data
    expect(data.status).toBe('pending')
    expect(data.source).toBe('online')
    expect(data.pricePaid).toBe(50000)
    expect(data.quantity).toBe(5)
    expect(data.bonusQuantity).toBe(1)
    expect(data.coversAll).toBe(true)
    expect(data.holdExpiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('reusa una compra pending viva en vez de crear otra', async () => {
    tx.packagePurchase.findFirst.mockResolvedValue({ id: 'ppExisting', holdExpiresAt: new Date(Date.now() + 60000) })
    const { purchaseId } = await createPackagePurchase(baseInput)
    expect(purchaseId).toBe('ppExisting')
    expect(tx.packagePurchase.create).not.toHaveBeenCalled()
  })

  it('NO reusa una pending vencida: crea una fresca', async () => {
    tx.packagePurchase.findFirst.mockResolvedValue(null) // el findFirst ya filtra holdExpiresAt >= now
    await createPackagePurchase(baseInput)
    expect(tx.packagePurchase.create).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npx vitest run src/server/actions/packages-checkout.create.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Crear `packages-checkout.ts` con `createPackagePurchase` (+ Zod + prefill)**

`src/server/actions/packages-checkout.ts`:

```ts
'use server'

import { z } from 'zod'
import { addMinutes, addDays } from 'date-fns'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { checkRateLimit } from '@/lib/rate-limit'
import { findOrCreateCustomerInTx } from '@/lib/customers/find-or-create'
import { resolveOnlinePaymentAvailabilityForBusiness } from '@/lib/payments/factory'

const HOLD_MINUTES = 30

const createPurchaseSchema = z.object({
  packageProductId: z.string().min(1),
  name: z.string().min(1).max(120),
  phone: z.string().min(6).max(30),
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar los términos' }) }),
})

export async function createPackagePurchase(input: {
  packageProductId: string
  name: string
  phone: string
  acceptedTerms: boolean
}): Promise<{ purchaseId: string }> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Debes iniciar sesión para comprar un paquete.')

  const limit = await checkRateLimit('create-package-purchase', 20, 60000, { userId: user.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')

  const parsed = createPurchaseSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const product = await prisma.packageProduct.findFirst({
    where: { id: input.packageProductId, isActive: true },
    include: { services: { select: { id: true } } },
  })
  if (!product) throw new Error('Paquete no disponible')

  // Re-gate online (nunca confiar en el estado del cliente).
  const availability = await resolveOnlinePaymentAvailabilityForBusiness(product.businessId)
  if (!availability.available) {
    throw new Error(availability.reason || 'Pago online no disponible para este negocio.')
  }

  const now = new Date()
  const expiresAt = product.expiryDays ? addDays(now, product.expiryDays) : null

  const purchaseId = await prisma.$transaction(async (tx) => {
    const { customer } = await findOrCreateCustomerInTx(tx, {
      businessId: product.businessId,
      phone: input.phone,
      name: input.name,
      email: user.email ?? null, // verificado de sesión — load-bearing para /mi
      sessionUser: user,
    })

    // Reuse anti doble-click: pending viva para (customer, producto).
    const existing = await tx.packagePurchase.findFirst({
      where: {
        businessId: product.businessId,
        customerId: customer.id,
        packageProductId: product.id,
        status: 'pending',
        holdExpiresAt: { gte: now },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) return existing.id

    const created = await tx.packagePurchase.create({
      data: {
        businessId: product.businessId,
        customerId: customer.id,
        packageProductId: product.id,
        pricePaid: product.price,
        quantity: product.quantity,
        bonusQuantity: product.bonusQuantity,
        coversAll: product.appliesToAll,
        coveredServiceIds: product.appliesToAll ? [] : product.services.map(s => s.id),
        source: 'online',
        status: 'pending',
        holdExpiresAt: addMinutes(now, HOLD_MINUTES),
        expiresAt,
        createdByUserId: null,
      },
    })
    return created.id
  })

  return { purchaseId }
}
```

> Nota: el mock del test hace que `findFirst` devuelva `null` para el caso "vencida"; el filtro `holdExpiresAt: { gte: now }` en la query real es lo que excluye las vencidas (no se reusan → se crea fresca).

- [ ] **Step 4: Correr — debe pasar**

Run: `npx vitest run src/server/actions/packages-checkout.create.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Agregar `getPackageCheckoutPrefill` (prefill login-required)**

En el mismo archivo, agregar:

```ts
/**
 * Prefill del checkout para una clienta logueada: si ya tiene Customer en el
 * negocio (linkeada por userId), devuelve nombre/teléfono; el email siempre sale
 * de la sesión. Sin Customer previo, phone queda vacío (requerido en el form).
 */
export async function getPackageCheckoutPrefill(businessId: string): Promise<{
  email: string | null
  name: string
  phone: string
  hasCustomer: boolean
} | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const customer = await prisma.customer.findFirst({
    where: { businessId, userId: user.id },
    select: { name: true, phone: true },
  })

  const metaName = typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : ''
  return {
    email: user.email ?? null,
    name: customer?.name || metaName || '',
    phone: customer?.phone || '',
    hasCustomer: !!customer,
  }
}
```

Test rápido (agregar al mismo archivo de test o uno nuevo `packages-checkout.prefill.test.ts`):

```ts
// dentro de packages-checkout.create.test.ts, ampliar el mock de prisma con customer.findFirst
// y agregar:
import { getPackageCheckoutPrefill } from './packages-checkout'
// tx no aplica (usa prisma directo); asegurar prisma.customer.findFirst en el mock global.
```

Para no reestructurar el mock, crear `src/server/actions/packages-checkout.prefill.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const getCurrentUser = vi.fn()
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: () => getCurrentUser() }))
const findFirst = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { customer: { findFirst: (...a: unknown[]) => findFirst(...a) } } }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/customers/find-or-create', () => ({ findOrCreateCustomerInTx: vi.fn() }))
vi.mock('@/lib/payments/factory', () => ({ resolveOnlinePaymentAvailabilityForBusiness: vi.fn() }))

import { getPackageCheckoutPrefill } from './packages-checkout'

describe('getPackageCheckoutPrefill', () => {
  beforeEach(() => { getCurrentUser.mockReset(); findFirst.mockReset() })
  it('null sin sesión', async () => {
    getCurrentUser.mockResolvedValue(null)
    expect(await getPackageCheckoutPrefill('b1')).toBeNull()
  })
  it('prefill desde Customer linkeado', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u1', email: 'ana@x.cl', user_metadata: { name: 'Ana Meta' } })
    findFirst.mockResolvedValue({ name: 'Ana Cliente', phone: '+56911112222' })
    const p = await getPackageCheckoutPrefill('b1')
    expect(p).toEqual({ email: 'ana@x.cl', name: 'Ana Cliente', phone: '+56911112222', hasCustomer: true })
  })
  it('sin Customer: usa nombre del metadata y phone vacío', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u1', email: 'ana@x.cl', user_metadata: { name: 'Ana Meta' } })
    findFirst.mockResolvedValue(null)
    const p = await getPackageCheckoutPrefill('b1')
    expect(p).toEqual({ email: 'ana@x.cl', name: 'Ana Meta', phone: '', hasCustomer: false })
  })
})
```

Run: `npx vitest run src/server/actions/packages-checkout.prefill.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git -C . add src/server/actions/packages-checkout.ts src/server/actions/packages-checkout.create.test.ts src/server/actions/packages-checkout.prefill.test.ts
git commit -m "feat(packages): createPackagePurchase + prefill de checkout (login requerido, costura email→Customer)"
```

---

### Task 7: `initiatePackagePayment` + `verifyAndConfirmPackagePayment`

**Files:**
- Modify: `src/server/actions/packages-checkout.ts`
- Test: `src/server/actions/packages-checkout.initiate.test.ts` (crear)

- [ ] **Step 1: Escribir los tests**

```ts
// src/server/actions/packages-checkout.initiate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCurrentUser = vi.fn()
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: () => getCurrentUser() }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))

const getOnlinePaymentProviderForBusiness = vi.fn()
vi.mock('@/lib/payments/factory', () => ({
  resolveOnlinePaymentAvailabilityForBusiness: vi.fn(),
  getOnlinePaymentProviderForBusiness: (...a: unknown[]) => getOnlinePaymentProviderForBusiness(...a),
}))

const createMpPreferenceForPayment = vi.fn()
vi.mock('@/lib/payments/create-preference', () => ({
  createMpPreferenceForPayment: (...a: unknown[]) => createMpPreferenceForPayment(...a),
  getPaymentAppUrl: () => 'https://app.test',
}))

const applyApprovedPackagePayment = vi.fn()
vi.mock('@/server/services/finance', () => ({ applyApprovedPackagePayment: (...a: unknown[]) => applyApprovedPackagePayment(...a) }))

const prismaMock = {
  packagePurchase: { findUnique: vi.fn() },
  payment: { findFirst: vi.fn(), create: vi.fn() },
  $transaction: (fn: (t: unknown) => unknown) => fn(prismaMock),
}
vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

import { initiatePackagePayment } from './packages-checkout'

const purchase = {
  id: 'pp1', businessId: 'b1', customerId: 'c1', pricePaid: 50000, status: 'pending',
  customer: { userId: 'u1', email: 'ana@x.cl' },
  product: { name: 'Pack 5' },
  business: { slug: 'demo', subdomain: null, currency: 'CLP' },
}

describe('initiatePackagePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentUser.mockResolvedValue({ id: 'u1', email: 'ana@x.cl' })
    prismaMock.packagePurchase.findUnique.mockResolvedValue(purchase)
    getOnlinePaymentProviderForBusiness.mockResolvedValue({ name: 'mercado_pago' })
    prismaMock.payment.findFirst.mockResolvedValue(null)
    prismaMock.payment.create.mockResolvedValue({ id: 'pay1' })
    createMpPreferenceForPayment.mockResolvedValue({ redirectUrl: 'https://mp/redirect', paymentId: 'pay1' })
  })

  it('rechaza si la compra no es del usuario logueado', async () => {
    prismaMock.packagePurchase.findUnique.mockResolvedValue({ ...purchase, customer: { userId: 'otro' } })
    await expect(initiatePackagePayment({ purchaseId: 'pp1' })).rejects.toThrow(/no.*(corresponde|pertenece|autoriz)/i)
  })

  it('pre-crea Payment package_purchase pending y devuelve redirectUrl', async () => {
    const res = await initiatePackagePayment({ purchaseId: 'pp1' })
    const data = prismaMock.payment.create.mock.calls[0][0].data
    expect(data.paymentType).toBe('package_purchase')
    expect(data.packagePurchaseId).toBe('pp1')
    expect(data.status).toBe('pending')
    expect(data.amount).toBe(50000)
    expect(res).toEqual({ redirectUrl: 'https://mp/redirect' })
    const prefArgs = createMpPreferenceForPayment.mock.calls[0][1]
    expect(prefArgs.metadata).toMatchObject({ packagePurchaseId: 'pp1', businessId: 'b1', paymentType: 'package_purchase', localPaymentId: 'pay1' })
  })

  it('reusa Payment pending existente (anti doble-click)', async () => {
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'payExisting' })
    await initiatePackagePayment({ purchaseId: 'pp1' })
    expect(prismaMock.payment.create).not.toHaveBeenCalled()
    expect(createMpPreferenceForPayment.mock.calls[0][1].localPaymentId).toBe('payExisting')
  })

  it('provider mock (sin redirect) confirma vía applyApprovedPackagePayment', async () => {
    getOnlinePaymentProviderForBusiness.mockResolvedValue({ name: 'mock' })
    createMpPreferenceForPayment.mockResolvedValue({ redirectUrl: null, paymentId: 'pay1' })
    const res = await initiatePackagePayment({ purchaseId: 'pp1' })
    expect(res).toEqual({ confirmed: true })
    expect(applyApprovedPackagePayment).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npx vitest run src/server/actions/packages-checkout.initiate.test.ts`
Expected: FAIL — `initiatePackagePayment is not a function`.

- [ ] **Step 3: Implementar `initiatePackagePayment` + `verifyAndConfirmPackagePayment`**

Agregar a `src/server/actions/packages-checkout.ts` los imports:

```ts
import { PaymentProvider, PaymentStatus, PaymentType } from '@prisma/client'
import { getOnlinePaymentProviderForBusiness } from '@/lib/payments/factory'
import { createMpPreferenceForPayment, getPaymentAppUrl } from '@/lib/payments/create-preference'
import { getPackageConfirmationUrl } from '@/lib/business/urls'
import { applyApprovedPackagePayment } from '@/server/services/finance'
```

(Consolidar el import de `@/lib/payments/factory` con el de Task 6.)

Y las funciones:

```ts
async function loadOwnedPurchase(purchaseId: string, userId: string) {
  const purchase = await prisma.packagePurchase.findUnique({
    where: { id: purchaseId },
    include: {
      customer: { select: { userId: true, email: true } },
      product: { select: { name: true } },
      business: { select: { slug: true, subdomain: true, currency: true } },
    },
  })
  if (!purchase) throw new Error('Compra no encontrada')
  if (purchase.customer.userId !== userId) throw new Error('Esta compra no corresponde a tu cuenta.')
  return purchase
}

export async function initiatePackagePayment(input: { purchaseId: string }): Promise<
  { redirectUrl: string } | { confirmed: true }
> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Debes iniciar sesión para pagar el paquete.')

  const limit = await checkRateLimit('initiate-package-payment', 20, 60000, { userId: user.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')

  const purchase = await loadOwnedPurchase(input.purchaseId, user.id)
  if (purchase.status !== 'pending') {
    throw new Error('Esta compra ya fue procesada.')
  }

  const provider = await getOnlinePaymentProviderForBusiness(purchase.businessId)
  const currency = purchase.business.currency || 'CLP'

  // Pre-crear (o reusar) Payment pending para el purchase.
  const existingPending = await prisma.payment.findFirst({
    where: {
      packagePurchaseId: purchase.id,
      paymentType: PaymentType.package_purchase,
      status: 'pending',
    },
  })
  let localPaymentId: string
  if (existingPending) {
    localPaymentId = existingPending.id
  } else {
    const payment = await prisma.payment.create({
      data: {
        businessId: purchase.businessId,
        packagePurchaseId: purchase.id,
        customerId: purchase.customerId,
        provider: provider.name === 'mercado_pago' ? PaymentProvider.mercado_pago : (provider.name as PaymentProvider),
        providerPaymentId: null,
        amount: purchase.pricePaid,
        currency,
        status: PaymentStatus.pending,
        paymentType: PaymentType.package_purchase,
      },
    })
    localPaymentId = payment.id
  }

  const result = await createMpPreferenceForPayment(provider, {
    amount: purchase.pricePaid,
    currency,
    bookingId: '', // MP ignora bookingId; external_reference = localPaymentId
    description: `Paquete ${purchase.product.name}`,
    returnUrl: getPackageConfirmationUrl(purchase.business, purchase.id),
    webhookUrl: `${getPaymentAppUrl()}/api/webhooks/mercado-pago`,
    localPaymentId,
    customerEmail: purchase.customer.email,
    metadata: {
      packagePurchaseId: purchase.id,
      businessId: purchase.businessId,
      paymentType: 'package_purchase',
      localPaymentId,
    },
  })

  if (result.redirectUrl) {
    return { redirectUrl: result.redirectUrl }
  }

  // Provider sin redirect (mock/test): confirmar server-side.
  await verifyAndConfirmPackagePayment({ purchaseId: purchase.id })
  return { confirmed: true }
}

export async function verifyAndConfirmPackagePayment(input: { purchaseId: string }): Promise<{ success: boolean }> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Debes iniciar sesión.')

  const purchase = await loadOwnedPurchase(input.purchaseId, user.id)
  const currency = purchase.business.currency || 'CLP'

  const payment = await prisma.payment.findFirst({
    where: { packagePurchaseId: purchase.id, paymentType: PaymentType.package_purchase },
    orderBy: { createdAt: 'desc' },
  })
  if (!payment) throw new Error('Pago no encontrado')

  // Solo el camino sin redirect (mock) confirma acá; MP confirma vía webhook.
  if (payment.provider === PaymentProvider.mercado_pago) {
    return { success: false }
  }

  await prisma.$transaction(async (tx) => {
    await applyApprovedPackagePayment({
      tx,
      packagePurchaseId: purchase.id,
      businessId: purchase.businessId,
      amount: purchase.pricePaid,
      currency,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      paymentType: PaymentType.package_purchase,
      paymentMethod: payment.paymentMethod,
      paymentId: payment.id,
    })
  })

  return { success: true }
}
```

- [ ] **Step 4: Correr — debe pasar**

Run: `npx vitest run src/server/actions/packages-checkout.initiate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git -C . add src/server/actions/packages-checkout.ts src/server/actions/packages-checkout.initiate.test.ts
git commit -m "feat(packages): initiatePackagePayment + verifyAndConfirmPackagePayment (pre-create Payment, reuse, mock path)"
```

---

### Task 8: `derivePackageConfirmationState`

**Files:**
- Create: `src/lib/payments/package-confirmation-state.ts`
- Test: `src/lib/payments/package-confirmation-state.test.ts` (crear)

- [ ] **Step 1: Escribir el test**

```ts
// src/lib/payments/package-confirmation-state.test.ts
import { describe, it, expect } from 'vitest'
import { derivePackageConfirmationState } from './package-confirmation-state'

describe('derivePackageConfirmationState', () => {
  it('active si la compra ya está activa', () => {
    expect(derivePackageConfirmationState({ status: 'active', payments: [] })).toBe('active')
  })
  it('active si hay un pago approved aunque la compra siga pending (carrera webhook/redirect)', () => {
    expect(derivePackageConfirmationState({ status: 'pending', payments: [{ status: 'approved' }] })).toBe('active')
  })
  it('pending mientras el pago está pending/in_process', () => {
    expect(derivePackageConfirmationState({ status: 'pending', payments: [{ status: 'pending' }] })).toBe('pending')
    expect(derivePackageConfirmationState({ status: 'pending', payments: [{ status: 'in_process' }] })).toBe('pending')
  })
  it('rejected si el único pago fue rechazado/cancelado', () => {
    expect(derivePackageConfirmationState({ status: 'pending', payments: [{ status: 'rejected' }] })).toBe('rejected')
  })
  it('pending si no hay pagos todavía', () => {
    expect(derivePackageConfirmationState({ status: 'pending', payments: [] })).toBe('pending')
  })
})
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npx vitest run src/lib/payments/package-confirmation-state.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar**

`src/lib/payments/package-confirmation-state.ts`:

```ts
export type PackageConfirmationState = 'active' | 'pending' | 'rejected'

interface DeriveInput {
  status: string
  payments: { status: string }[]
}

/** Mirror liviano de deriveConfirmationState para compras de paquete. */
export function derivePackageConfirmationState(input: DeriveInput): PackageConfirmationState {
  if (input.status === 'active') return 'active'
  if (input.payments.some(p => p.status === 'approved')) return 'active'
  if (input.payments.some(p => p.status === 'pending' || p.status === 'in_process')) return 'pending'
  if (input.payments.some(p => p.status === 'rejected' || p.status === 'cancelled' || p.status === 'refunded')) return 'rejected'
  return 'pending'
}
```

- [ ] **Step 4: Correr — debe pasar**

Run: `npx vitest run src/lib/payments/package-confirmation-state.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git -C . add src/lib/payments/package-confirmation-state.ts src/lib/payments/package-confirmation-state.test.ts
git commit -m "feat(packages): derivePackageConfirmationState"
```

---

### Task 9: Notificaciones de compra de paquete

**Files:**
- Modify: `src/lib/notifications/types.ts`, `templates.ts`, `email-provider.ts`, `index.ts`
- Test: `src/lib/notifications/packages.test.ts` (crear)

- [ ] **Step 1: Escribir el test (templates puros + envío con mock de sendEmail)**

```ts
// src/lib/notifications/packages.test.ts
import { describe, it, expect } from 'vitest'
import {
  packagePurchasedCustomerHtml, packagePurchasedCustomerText,
  packageSoldBusinessHtml, packageSoldBusinessText,
} from './templates'

const data = {
  businessName: 'Studio Ana', customerName: 'Ana', productName: 'Pack 5 sesiones',
  totalSessions: 6, pricePaid: 50000, businessCurrency: 'CLP', cardLink: 'https://app/mi/demo',
}

describe('templates de paquete', () => {
  it('customer html incluye producto, sesiones y link', () => {
    const html = packagePurchasedCustomerHtml(data)
    expect(html).toContain('Pack 5 sesiones')
    expect(html).toContain('6')
    expect(html).toContain('https://app/mi/demo')
  })
  it('customer text incluye producto', () => {
    expect(packagePurchasedCustomerText(data)).toContain('Pack 5 sesiones')
  })
  it('business html incluye clienta y producto', () => {
    const html = packageSoldBusinessHtml({ ...data })
    expect(html).toContain('Ana')
    expect(html).toContain('Pack 5 sesiones')
  })
  it('business text incluye clienta', () => {
    expect(packageSoldBusinessText({ ...data })).toContain('Ana')
  })
})
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npx vitest run src/lib/notifications/packages.test.ts`
Expected: FAIL — templates no existen.

- [ ] **Step 3: Agregar tipos**

En `src/lib/notifications/types.ts`, agregar y exportar:

```ts
export interface PackagePurchasedEmailData {
  businessName: string
  customerName: string
  productName: string
  totalSessions: number
  pricePaid: number
  businessCurrency: string
  cardLink?: string
  businessReplyToEmail?: string | null
}
```

- [ ] **Step 4: Agregar templates**

En `src/lib/notifications/templates.ts` (usa los helpers `baseHtml`, `header`, `footer`, `escapeHtml`, `fmtCurrency` ya presentes). Importar el tipo `PackagePurchasedEmailData` en el bloque de imports de tipos.

```ts
export function packagePurchasedCustomerHtml(data: PackagePurchasedEmailData): string {
  const price = fmtCurrency(data.pricePaid, data.businessCurrency)
  const cardSection = data.cardLink
    ? `<p style="margin-top:16px"><a href="${escapeHtml(data.cardLink)}" style="color:#e91e63;text-decoration:none;font-weight:600">Ver mis paquetes</a></p>`
    : ''
  return baseHtml(`
    ${header('¡Paquete comprado!')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, tu compra fue confirmada.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Paquete</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.productName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Sesiones disponibles</td><td style="padding:8px 0;font-weight:600">${data.totalSessions}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Total pagado</td><td style="padding:8px 0;font-weight:600">${price}</td></tr>
    </table>
    ${cardSection}
    ${footer(data.businessName)}
  `)
}

export function packagePurchasedCustomerText(data: PackagePurchasedEmailData): string {
  const price = fmtCurrency(data.pricePaid, data.businessCurrency)
  const lines = [
    '¡Paquete comprado!', '',
    `Hola ${data.customerName}, tu compra fue confirmada.`, '',
    `Paquete: ${data.productName}`,
    `Sesiones disponibles: ${data.totalSessions}`,
    `Total pagado: ${price}`,
  ]
  if (data.cardLink) lines.push('', `Ver mis paquetes: ${data.cardLink}`)
  lines.push('', `Enviado por ${data.businessName} a través de Agendita`)
  return lines.join('\n')
}

export function packageSoldBusinessHtml(data: PackagePurchasedEmailData): string {
  const price = fmtCurrency(data.pricePaid, data.businessCurrency)
  return baseHtml(`
    ${header('Vendiste un paquete')}
    <p style="font-size:15px">${escapeHtml(data.customerName)} compró un paquete online.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Clienta</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.customerName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Paquete</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.productName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Sesiones</td><td style="padding:8px 0;font-weight:600">${data.totalSessions}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Total</td><td style="padding:8px 0;font-weight:600">${price}</td></tr>
    </table>
    ${footer(data.businessName)}
  `)
}

export function packageSoldBusinessText(data: PackagePurchasedEmailData): string {
  const price = fmtCurrency(data.pricePaid, data.businessCurrency)
  return [
    'Vendiste un paquete', '',
    `${data.customerName} compró un paquete online.`, '',
    `Clienta: ${data.customerName}`,
    `Paquete: ${data.productName}`,
    `Sesiones: ${data.totalSessions}`,
    `Total: ${price}`, '',
    `Enviado por ${data.businessName} a través de Agendita`,
  ].join('\n')
}
```

- [ ] **Step 5: Agregar funciones de envío**

En `src/lib/notifications/email-provider.ts` (usa `sendEmail`, `getBusinessOwnerEmails`, `getBusinessReplyToEmail`, `prisma`, `getAppUrl` ya presentes). Importar los templates y el tipo.

```ts
export async function sendPackagePurchasedNotification(purchaseId: string, businessId: string): Promise<EmailResult> {
  const purchase = await prisma.packagePurchase.findFirst({
    where: { id: purchaseId, businessId },
    include: {
      product: { select: { name: true } },
      customer: { select: { name: true, email: true, loyaltyToken: true } },
      business: { select: { name: true, slug: true, subdomain: true, currency: true } },
    },
  })
  if (!purchase || !purchase.customer.email) {
    return { success: false, skipped: 'Compra no encontrada o clienta sin email' }
  }
  const cardLink = purchase.business.subdomain
    ? `${getAppUrl('')}/mi` // el /mi por subdominio lo resuelve el tenant; link genérico
    : `${getAppUrl('')}/mi/${purchase.business.slug}`
  return sendPackagePurchasedToCustomer({
    businessName: purchase.business.name,
    customerName: purchase.customer.name,
    productName: purchase.product.name,
    totalSessions: purchase.quantity + purchase.bonusQuantity,
    pricePaid: purchase.pricePaid,
    businessCurrency: purchase.business.currency || 'CLP',
    cardLink,
    businessReplyToEmail: await getBusinessReplyToEmail(businessId),
    customerEmail: purchase.customer.email,
  })
}

async function sendPackagePurchasedToCustomer(
  data: PackagePurchasedEmailData & { customerEmail: string },
): Promise<EmailResult> {
  const html = packagePurchasedCustomerHtml(data)
  const text = packagePurchasedCustomerText(data)
  return sendEmail(data.customerEmail, `Paquete comprado - ${data.businessName}`, html, text, { replyTo: data.businessReplyToEmail })
}

export async function sendPackageSoldNotificationToBusiness(
  businessId: string,
  data: PackagePurchasedEmailData,
): Promise<EmailResult[]> {
  const ownerEmails = await getBusinessOwnerEmails(businessId)
  if (ownerEmails.length === 0) {
    return [{ success: false, skipped: 'No hay owners/admins con email para el negocio' }]
  }
  const html = packageSoldBusinessHtml(data)
  const text = packageSoldBusinessText(data)
  return Promise.all(
    ownerEmails.map(o => sendEmail(o.email, `Paquete vendido - ${data.customerName}`, html, text, {})),
  )
}
```

Ajustar el import de tipos y templates arriba del archivo:
```ts
import { packagePurchasedCustomerHtml, packagePurchasedCustomerText, packageSoldBusinessHtml, packageSoldBusinessText } from './templates'
import type { EmailResult, PackagePurchasedEmailData } from './types'
```
(consolidar con los imports existentes de `./templates` y `./types`).

- [ ] **Step 6: Exportar desde el barrel**

En `src/lib/notifications/index.ts`, agregar al bloque de `./email-provider`:
```ts
  sendPackagePurchasedNotification,
  sendPackageSoldNotificationToBusiness,
```
al bloque de `./templates`:
```ts
  packagePurchasedCustomerHtml, packagePurchasedCustomerText,
  packageSoldBusinessHtml, packageSoldBusinessText,
```
y al `export type`:
```ts
  PackagePurchasedEmailData,
```

- [ ] **Step 7: Correr — debe pasar**

Run: `npx vitest run src/lib/notifications/packages.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git -C . add src/lib/notifications/types.ts src/lib/notifications/templates.ts src/lib/notifications/email-provider.ts src/lib/notifications/index.ts src/lib/notifications/packages.test.ts
git commit -m "feat(packages): notificaciones de compra (email a clienta + a la dueña)"
```

---

### Task 10: Webhook — dispatch de paquete + metadata por tipo + refund + revalidación

**Files:**
- Modify: `src/app/api/webhooks/mercado-pago/route.ts`
- Test: `src/app/api/webhooks/mercado-pago/route.packages.test.ts` (crear; si ya hay un test del webhook, seguir su patrón de mocks)

- [ ] **Step 1: Escribir el test de dispatch de paquete**

Seguir el patrón del test existente del webhook si lo hay (revisar `src/app/api/webhooks/mercado-pago/*.test.ts`). El test debe cubrir: (a) `approved` con `packagePurchaseId` (sin `bookingId`) → llama `applyApprovedPackagePayment` y NO `applyApprovedPayment`; (b) validación de metadata por tipo paquete; (c) `rejected` no activa. Mockear `mpFetchWithToken` vía `global.fetch`, `prisma`, `applyApprovedPayment`, `applyApprovedPackagePayment`, notificaciones y `next/cache`.

```ts
// src/app/api/webhooks/mercado-pago/route.packages.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const applyApprovedPayment = vi.fn()
const applyApprovedPackagePayment = vi.fn()
vi.mock('@/server/services/finance', () => ({
  applyApprovedPayment: (...a: unknown[]) => applyApprovedPayment(...a),
  applyApprovedPackagePayment: (...a: unknown[]) => applyApprovedPackagePayment(...a),
}))
vi.mock('@/lib/notifications', () => ({
  sendNotificationSafely: (_l: string, fn: () => unknown) => fn(),
  sendMultiNotificationSafely: (_l: string, fn: () => unknown) => fn(),
  sendBookingConfirmedNotification: vi.fn(),
  sendPackagePurchasedNotification: vi.fn().mockResolvedValue({ success: true }),
  sendPackageSoldNotificationToBusiness: vi.fn().mockResolvedValue([{ success: true }]),
}))
const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/logger', () => ({ logger: { webhook: { received: vi.fn(), rejected: vi.fn() }, payment: { approved: vi.fn() }, error: vi.fn() } }))
vi.mock('@/lib/payments/encryption', () => ({ decryptSecret: () => 'tok' }))
vi.mock('@/lib/promotions/release', () => ({ releaseRedemptionForBooking: vi.fn() }))
vi.mock('@/lib/loyalty/credit', () => ({ reverseVisitPoints: vi.fn() }))
vi.mock('@/lib/loyalty/automatic', () => ({ reverseAutoRewardsForBooking: vi.fn() }))

const prismaMock = {
  payment: { findUnique: vi.fn(), update: vi.fn() },
  paymentAccount: { findFirst: vi.fn().mockResolvedValue({ accessTokenEncrypted: 'enc' }) },
  packagePurchase: { findUnique: vi.fn() },
  $transaction: (fn: (t: unknown) => unknown) => fn(prismaMock),
}
vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

import { POST } from './route'

function req(id = 'mp1') {
  return new Request(`https://app/api/webhooks/mercado-pago?data.id=${id}`, { method: 'POST', body: JSON.stringify({ data: { id } }) }) as never
}

const packagePayment = {
  id: 'pay1', provider: 'mercado_pago', status: 'pending', bookingId: null,
  packagePurchaseId: 'pp1', businessId: 'b1', amount: 50000, currency: 'CLP',
  paymentType: 'package_purchase', paymentMethod: null, providerPaymentId: null,
  booking: null, packagePurchase: { customerId: 'c1' },
}

describe('webhook — dispatch de paquete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'global'
    delete process.env.MERCADO_PAGO_WEBHOOK_SECRET
    prismaMock.payment.findUnique.mockResolvedValue(packagePayment)
    prismaMock.packagePurchase.findUnique.mockResolvedValue({ id: 'pp1', customerId: 'c1' })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'mpprov1', status: 'approved', transaction_amount: 50000, currency_id: 'CLP',
        external_reference: 'pay1',
        metadata: { localPaymentId: 'pay1', packagePurchaseId: 'pp1', businessId: 'b1', paymentType: 'package_purchase' },
      }),
    }) as never
  })

  it('approved de paquete llama applyApprovedPackagePayment y revalida dashboard', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(applyApprovedPackagePayment).toHaveBeenCalled()
    expect(applyApprovedPayment).not.toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/paquetes')
  })

  it('rechaza si falta packagePurchaseId en metadata', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'mpprov1', status: 'approved', transaction_amount: 50000, currency_id: 'CLP', external_reference: 'pay1', metadata: { localPaymentId: 'pay1', businessId: 'b1', paymentType: 'package_purchase' } }),
    })
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect(applyApprovedPackagePayment).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npx vitest run src/app/api/webhooks/mercado-pago/route.packages.test.ts`
Expected: FAIL — hoy el pago sin bookingId responde 400 "Pago no asociado a una reserva".

- [ ] **Step 3: Implementar los cambios en el webhook**

En `src/app/api/webhooks/mercado-pago/route.ts`:

(a) Imports:
```ts
import { applyApprovedPayment, applyApprovedPackagePayment } from '@/server/services/finance'
import { sendBookingConfirmedNotification, sendNotificationSafely, sendMultiNotificationSafely, sendPackagePurchasedNotification, sendPackageSoldNotificationToBusiness } from '@/lib/notifications'
import { revalidatePath } from 'next/cache'
```

(b) Extender el include del lookup de Payment (líneas ~184-187):
```ts
    const payment = await prisma.payment.findUnique({
      where: { id: localPaymentId },
      include: { booking: true, packagePurchase: { select: { customerId: true } } },
    })
```

(c) Reemplazar el bloque de validación de metadata (el `if (mpStatus === 'approved') { const requiredMetadataFields = [...] ... }`) por un branch por tipo:

```ts
    if (mpStatus === 'approved') {
      const isPackage = !payment.bookingId && !!payment.packagePurchaseId
      const requiredMetadataFields = isPackage
        ? (['localPaymentId', 'packagePurchaseId', 'businessId', 'paymentType'] as const)
        : (['localPaymentId', 'bookingId', 'businessId', 'paymentType'] as const)
      const missingFields = requiredMetadataFields.filter(f => !metadata[f])
      if (missingFields.length > 0) {
        console.error('[MP Webhook] missing required metadata fields for approved payment', { mpPaymentId, missingFields })
        return NextResponse.json({ error: `Missing required metadata: ${missingFields.join(', ')}` }, { status: 400 })
      }
      if (metadata.localPaymentId !== payment.id) {
        return NextResponse.json({ error: 'localPaymentId mismatch' }, { status: 400 })
      }
      if (isPackage) {
        if (metadata.packagePurchaseId !== payment.packagePurchaseId) {
          return NextResponse.json({ error: 'packagePurchaseId mismatch' }, { status: 400 })
        }
        if (metadata.paymentType !== 'package_purchase') {
          return NextResponse.json({ error: 'paymentType mismatch' }, { status: 400 })
        }
      } else {
        if (metadata.bookingId !== payment.bookingId) {
          return NextResponse.json({ error: 'bookingId mismatch' }, { status: 400 })
        }
        if (metadata.paymentType !== payment.paymentType) {
          return NextResponse.json({ error: 'paymentType mismatch' }, { status: 400 })
        }
      }
      if (metadata.businessId !== payment.businessId) {
        return NextResponse.json({ error: 'businessId mismatch' }, { status: 400 })
      }
    }
```

(d) Reemplazar el bloque de dispatch approved (el `if (mpStatus === 'approved') { const bookingId = payment.bookingId; if (!bookingId) return 400; ... }`) por un branch por tipo. Sustituir todo el bloque `if (mpStatus === 'approved') { ... }` (líneas ~336-387) por:

```ts
    if (mpStatus === 'approved') {
      if (payment.bookingId) {
        const bookingId = payment.bookingId
        const result = await prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: { id: payment.id },
            data: { providerPaymentId: mpPayment.id, rawPayload: mpPayment as unknown as Prisma.InputJsonValue },
          })
          return applyApprovedPayment({
            tx, bookingId, businessId: payment.businessId, amount: payment.amount, currency: payment.currency,
            provider: 'mercado_pago', providerPaymentId: mpPayment.id, paymentType: payment.paymentType,
            paymentMethod: payment.paymentMethod, rawPayload: mpPayment as unknown as Prisma.InputJsonValue, paymentId: payment.id,
          })
        })
        if (!result || !result.booking) throw new Error('Reserva no encontrada')
        if (result.wasConfirmed) {
          await sendNotificationSafely('booking confirmed', () => sendBookingConfirmedNotification(bookingId, payment.businessId))
        }
        logger.payment.approved(payment.id, bookingId, payment.businessId)
        return NextResponse.json({ success: true, message: 'Payment approved', bookingId: result.booking.id })
      }

      // Rama paquete
      const packagePurchaseId = payment.packagePurchaseId
      if (!packagePurchaseId) {
        return NextResponse.json({ error: 'Pago sin reserva ni paquete asociado' }, { status: 400 })
      }
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: { providerPaymentId: mpPayment.id, rawPayload: mpPayment as unknown as Prisma.InputJsonValue },
        })
        await applyApprovedPackagePayment({
          tx, packagePurchaseId, businessId: payment.businessId, amount: payment.amount, currency: payment.currency,
          provider: 'mercado_pago', providerPaymentId: mpPayment.id, paymentType: payment.paymentType,
          paymentMethod: payment.paymentMethod, rawPayload: mpPayment as unknown as Prisma.InputJsonValue, paymentId: payment.id,
        })
      })

      await sendNotificationSafely('package purchased customer', () =>
        sendPackagePurchasedNotification(packagePurchaseId, payment.businessId))
      await sendMultiNotificationSafely('package sold business', async () => {
        const purchase = await prisma.packagePurchase.findUnique({
          where: { id: packagePurchaseId },
          include: { product: { select: { name: true } }, customer: { select: { name: true } }, business: { select: { name: true, currency: true } } },
        })
        if (!purchase) return [{ success: false as const, skipped: 'Compra no encontrada' }]
        return sendPackageSoldNotificationToBusiness(payment.businessId, {
          businessName: purchase.business.name,
          customerName: purchase.customer.name,
          productName: purchase.product.name,
          totalSessions: purchase.quantity + purchase.bonusQuantity,
          pricePaid: purchase.pricePaid,
          businessCurrency: purchase.business.currency || 'CLP',
        })
      })

      const customerId = payment.packagePurchase?.customerId
      if (customerId) revalidatePath(`/dashboard/customers/${customerId}`)
      revalidatePath('/dashboard/paquetes')
      revalidatePath('/dashboard/payments')
      logger.payment.approved(payment.id, packagePurchaseId, payment.businessId)
      return NextResponse.json({ success: true, message: 'Package payment approved', packagePurchaseId })
    }
```

(e) En el branch de `refunded/charged_back`, después del `if (finalStatus === 'refunded' && payment.bookingId) { ...reversals... }`, agregar la rama de paquete (documentada, sin revertir grants en B4b-2):

```ts
        // Paquete: B4b-2 solo degrada el Payment (arriba). No se revierten grants
        // (política de reversión de paquete activo = B4b-3). El refund real por MP
        // también es B4b-3; acá solo queda el registro degradado.
        // (sin acción adicional)
```

- [ ] **Step 4: Correr — debe pasar**

Run: `npx vitest run src/app/api/webhooks/mercado-pago/route.packages.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verificar que el camino de reserva sigue verde**

Run: `npx vitest run src/app/api/webhooks/mercado-pago`
Expected: PASS — todos los tests del webhook de reserva intactos.

- [ ] **Step 6: Commit**

```bash
git -C . add src/app/api/webhooks/mercado-pago/route.ts src/app/api/webhooks/mercado-pago/route.packages.test.ts
git commit -m "feat(packages): webhook MP dispatch de paquete + metadata por tipo + revalidación dashboard"
```

---

### Task 11: Rutas públicas `/paquetes/[slug]`, `/paquetes`, `/paquetes/confirmation`

**Files:**
- Create: `src/app/paquetes/[slug]/page.tsx`, `src/app/paquetes/page.tsx`, `src/app/paquetes/confirmation/page.tsx`

> Nota: estos son server components; se verifican por `tsc`/build y por el e2e smoke de Task 16. No requieren unit test propio (la lógica testeable ya está en Tasks 1, 4, 8 y en el checkout action).

- [ ] **Step 1: Crear `src/app/paquetes/[slug]/page.tsx`** (mirror de `book/[slug]/page.tsx`)

```tsx
export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { PackagesBusinessPage } from '@/components/packages/packages-business-page'
import { getPackagesBusinessBySlug } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { resolveOnlinePaymentAvailabilityForBusiness } from '@/lib/payments/factory'
import { getPackageCheckoutPrefill } from '@/server/actions/packages-checkout'

interface PaquetesPageProps {
  params: Promise<{ slug: string }>
}

export default async function PaquetesSlugPage({ params }: PaquetesPageProps) {
  const { slug } = await params
  const tenant = await getTenantFromRequest()

  if (tenant) {
    if (tenant.slug !== slug) notFound()
    redirect('/paquetes')
  }

  const business = await getPackagesBusinessBySlug(slug)
  if (!business) notFound()

  const [availability, prefill] = await Promise.all([
    resolveOnlinePaymentAvailabilityForBusiness(business.id),
    getPackageCheckoutPrefill(business.id),
  ])

  return (
    <PackagesBusinessPage
      business={business}
      profileHref={`/b/${business.slug}`}
      onlineAvailable={availability.available}
      onlineReason={availability.reason ?? null}
      prefill={prefill}
    />
  )
}
```

- [ ] **Step 2: Crear `src/app/paquetes/page.tsx`** (mirror de `book/page.tsx`, variante subdominio)

```tsx
import { headers } from 'next/headers'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { PackagesBusinessPage } from '@/components/packages/packages-business-page'
import { getPackagesBusinessBySubdomain } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { resolveOnlinePaymentAvailabilityForBusiness } from '@/lib/payments/factory'
import { getPackageCheckoutPrefill } from '@/server/actions/packages-checkout'

export default async function PaquetesIndexPage() {
  const requestHeaders = await headers()
  const tenant = await getTenantFromRequest(requestHeaders)

  if (tenant) {
    const business = await getPackagesBusinessBySubdomain(tenant.subdomain)
    if (business) {
      const [availability, prefill] = await Promise.all([
        resolveOnlinePaymentAvailabilityForBusiness(business.id),
        getPackageCheckoutPrefill(business.id),
      ])
      return (
        <PackagesBusinessPage
          business={business}
          profileHref="/"
          onlineAvailable={availability.available}
          onlineReason={availability.reason ?? null}
          prefill={prefill}
        />
      )
    }
  }

  const businesses = await prisma.business.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
    take: 10,
  })

  return (
    <div className="studio-shell py-10">
      <div className="mx-auto max-w-2xl px-4">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-semibold tracking-normal text-primary">Paquetes</h1>
          <p className="mt-2 text-muted-foreground">Selecciona un negocio para ver sus paquetes</p>
        </div>
        <div className="space-y-4">
          {businesses.map((business) => (
            <Link key={business.id} href={`/paquetes/${business.slug}`} className="studio-card block p-6 transition-shadow hover:shadow-[var(--cream-shadow)]">
              <h2 className="text-lg font-semibold text-primary">{business.name}</h2>
              <p className="mt-1 font-semibold text-muted-foreground">Ver paquetes →</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Crear `src/app/paquetes/confirmation/page.tsx`** (mirror de `book/confirmation/page.tsx`)

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { derivePackageConfirmationState } from '@/lib/payments/package-confirmation-state'
import { formatMoney } from '@/lib/money'

interface ConfirmationPageProps {
  searchParams: Promise<{ purchaseId?: string }>
}

export default async function PackageConfirmationPage({ searchParams }: ConfirmationPageProps) {
  const { purchaseId } = await searchParams
  if (!purchaseId) notFound()

  const user = await getCurrentUser()
  if (!user) notFound()

  const purchase = await prisma.packagePurchase.findUnique({
    where: { id: purchaseId },
    include: {
      product: { select: { name: true } },
      customer: { select: { userId: true } },
      business: { select: { name: true, slug: true, subdomain: true, currency: true } },
      payments: { select: { status: true } },
    },
  })
  if (!purchase) notFound()

  const tenant = await getTenantFromRequest()
  if (tenant && tenant.businessId !== purchase.businessId) notFound()
  if (purchase.customer.userId !== user.id) notFound()

  const state = derivePackageConfirmationState(purchase)
  const cardHref = tenant ? '/mi' : `/mi/${purchase.business.slug}`
  const totalSessions = purchase.quantity + purchase.bonusQuantity

  const config = {
    active: { icon: CheckCircle2, iconColor: 'text-primary', iconBg: 'bg-primary/10', title: '¡Paquete listo!', message: `Tu paquete ${purchase.product.name} está activo con ${totalSessions} sesiones disponibles.` },
    pending: { icon: Clock, iconColor: 'text-amber-500', iconBg: 'bg-amber-50', title: 'Procesando tu pago', message: 'Mercado Pago está procesando el pago. Te confirmaremos cuando se apruebe; podés refrescar esta página.' },
    rejected: { icon: XCircle, iconColor: 'text-destructive', iconBg: 'bg-destructive/10', title: 'Pago no aprobado', message: 'El pago no pudo procesarse. Podés intentar comprar de nuevo.' },
  }[state]
  const Icon = config.icon

  return (
    <main className="studio-shell">
      <div className="mx-auto max-w-md px-4 py-12">
        <div className={`mx-auto mb-6 flex size-16 items-center justify-center rounded-full ${config.iconBg}`}>
          <Icon className={`size-8 ${config.iconColor}`} />
        </div>
        <h1 className="text-center font-heading text-2xl font-semibold text-primary">{config.title}</h1>
        <p className="mt-2 text-center text-muted-foreground">{config.message}</p>

        <div className="studio-card mt-6 p-4 text-sm">
          <div className="flex justify-between py-1"><span className="text-muted-foreground">Paquete</span><span className="font-semibold">{purchase.product.name}</span></div>
          <div className="flex justify-between py-1"><span className="text-muted-foreground">Sesiones</span><span className="font-semibold">{totalSessions}</span></div>
          <div className="flex justify-between py-1"><span className="text-muted-foreground">Total</span><span className="font-semibold">{formatMoney(purchase.pricePaid, purchase.business.currency || 'CLP')}</span></div>
        </div>

        <div className="mt-6">
          <Button asChild className="h-12 w-full rounded-full">
            <Link href={cardHref}>Ver mis paquetes</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Verificar compilación**

Run: `npx tsc --noEmit | grep '^src/app/paquetes' || echo "OK sin errores en paquetes"`
Expected: `OK sin errores en paquetes` (los componentes que aún no existen se crean en Task 12; si `tsc` marca el import de `PackagesBusinessPage`, es esperado hasta Task 12 — se resuelve al final de esa task).

> Como `tsc` fallará por el import de componentes aún inexistentes, **committear Task 11 y 12 juntas** o crear primero stubs. Recomendado: hacer Task 12 inmediatamente después y correr `tsc` al cierre de la 12.

- [ ] **Step 5: Commit**

```bash
git -C . add src/app/paquetes
git commit -m "feat(packages): rutas públicas /paquetes/[slug], /paquetes, /paquetes/confirmation"
```

---

### Task 12: Shell + catálogo + wizard de checkout (cliente)

**Files:**
- Create: `src/components/packages/packages-business-page.tsx`, `package-catalog.tsx`, `package-checkout.tsx`

- [ ] **Step 1: Crear `packages-business-page.tsx`** (server shell, mirror de `booking-business-page.tsx`)

```tsx
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PackageCatalog } from './package-catalog'
import type { PackagesBusiness } from '@/lib/business/public'

interface PackagesBusinessPageProps {
  business: PackagesBusiness
  profileHref: string
  onlineAvailable: boolean
  onlineReason: string | null
  prefill: { email: string | null; name: string; phone: string; hasCustomer: boolean } | null
}

export function PackagesBusinessPage({ business, profileHref, onlineAvailable, onlineReason, prefill }: PackagesBusinessPageProps) {
  return (
    <main className="studio-shell">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <Link href={profileHref} className="flex size-10 items-center justify-center rounded-full text-primary transition-colors hover:bg-muted" aria-label="Volver al perfil">
            <ArrowLeft className="size-6" />
          </Link>
          <div className="text-center">
            <h1 className="font-heading text-xl font-semibold tracking-tight text-primary">Paquetes</h1>
            <p className="text-sm text-muted-foreground">{business.name}</p>
          </div>
          <div className="flex size-10 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary">
            {business.name.slice(0, 1).toUpperCase()}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-8">
        <PackageCatalog
          businessId={business.id}
          slug={business.slug}
          currency={business.currency || 'CLP'}
          products={business.packageProducts.map(p => ({
            id: p.id,
            name: p.name,
            quantity: p.quantity,
            bonusQuantity: p.bonusQuantity,
            price: p.price,
            expiryDays: p.expiryDays,
            appliesToAll: p.appliesToAll,
            serviceNames: p.services.map(s => s.name),
          }))}
          onlineAvailable={onlineAvailable}
          onlineReason={onlineReason}
          isLoggedIn={!!prefill}
          prefill={prefill}
        />
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Crear `package-catalog.tsx`** (cliente)

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import { PackageCheckout } from './package-checkout'

export interface CatalogProduct {
  id: string
  name: string
  quantity: number
  bonusQuantity: number
  price: number
  expiryDays: number | null
  appliesToAll: boolean
  serviceNames: string[]
}

interface PackageCatalogProps {
  businessId: string
  slug: string
  currency: string
  products: CatalogProduct[]
  onlineAvailable: boolean
  onlineReason: string | null
  isLoggedIn: boolean
  prefill: { email: string | null; name: string; phone: string; hasCustomer: boolean } | null
}

export function PackageCatalog({ businessId, slug, currency, products, onlineAvailable, onlineReason, isLoggedIn, prefill }: PackageCatalogProps) {
  const [selected, setSelected] = useState<CatalogProduct | null>(null)

  if (products.length === 0) {
    return <p className="text-center text-muted-foreground">Este negocio todavía no publicó paquetes.</p>
  }

  if (selected && isLoggedIn && prefill) {
    return (
      <PackageCheckout
        product={selected}
        currency={currency}
        prefill={prefill}
        onCancel={() => setSelected(null)}
      />
    )
  }

  const loginHref = (productId: string) =>
    `/ingresar?next=${encodeURIComponent(`/paquetes/${slug}?comprar=${productId}`)}`

  return (
    <div className="grid gap-4">
      {!onlineAvailable && (
        <p className="rounded-lg border border-border/60 bg-muted/40 p-3 text-sm text-muted-foreground">
          {onlineReason || 'Este negocio coordina el pago directamente.'}
        </p>
      )}
      {products.map((p) => {
        const total = p.quantity + p.bonusQuantity
        return (
          <div key={p.id} className="studio-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-primary">{p.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {total} sesiones{p.bonusQuantity > 0 ? ` (${p.quantity} + ${p.bonusQuantity} bonus)` : ''}
                </p>
                {p.expiryDays && <p className="text-xs text-muted-foreground">Vence a los {p.expiryDays} días</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.appliesToAll ? 'Aplica a todos los servicios' : `Aplica a: ${p.serviceNames.join(', ')}`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold text-primary">{formatMoney(p.price, currency)}</p>
              </div>
            </div>
            <div className="mt-4">
              {!onlineAvailable ? (
                <Button disabled className="w-full rounded-full">No disponible online</Button>
              ) : isLoggedIn ? (
                <Button className="w-full rounded-full" onClick={() => setSelected(p)}>Comprar</Button>
              ) : (
                <Button asChild className="w-full rounded-full">
                  <Link href={loginHref(p.id)}>Ingresar para comprar</Link>
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Crear `package-checkout.tsx`** (cliente, wizard 2 pasos + redirect-vs-mock)

```tsx
'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/money'
import { AlertCircle, Loader2 } from 'lucide-react'
import { createPackagePurchase, initiatePackagePayment } from '@/server/actions/packages-checkout'
import type { CatalogProduct } from './package-catalog'

interface PackageCheckoutProps {
  product: CatalogProduct
  currency: string
  prefill: { email: string | null; name: string; phone: string; hasCustomer: boolean }
  onCancel: () => void
}

export function PackageCheckout({ product, currency, prefill, onCancel }: PackageCheckoutProps) {
  const [name, setName] = useState(prefill.name)
  const [phone, setPhone] = useState(prefill.phone)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Key estable por montaje: retry dentro del mismo montaje reusa la pending.
  useMemo(() => Math.random(), []) // fuerza identidad de montaje (no se usa el valor)

  const total = product.quantity + product.bonusQuantity

  async function handleBuy() {
    setError('')
    if (!name.trim()) return setError('Ingresá tu nombre')
    if (!phone.trim()) return setError('Ingresá tu teléfono')
    if (!acceptedTerms) return setError('Debes aceptar los términos')

    setLoading(true)
    try {
      const { purchaseId } = await createPackagePurchase({
        packageProductId: product.id,
        name: name.trim(),
        phone: phone.trim(),
        acceptedTerms: true,
      })
      const res = await initiatePackagePayment({ purchaseId })
      if ('redirectUrl' in res) {
        window.location.href = res.redirectUrl
        return
      }
      // Provider mock (sin redirect): ir directo a confirmación.
      window.location.href = `/paquetes/confirmation?purchaseId=${purchaseId}`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar la compra')
      setLoading(false)
    }
  }

  return (
    <div className="studio-card p-5">
      <button onClick={onCancel} className="mb-4 text-sm font-semibold text-primary underline">← Volver al catálogo</button>
      <h3 className="text-lg font-semibold text-primary">{product.name}</h3>
      <p className="text-sm text-muted-foreground">{total} sesiones · {formatMoney(product.price, currency)}</p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="text-sm font-semibold text-primary">Nombre</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre" />
        </div>
        <div>
          <label className="text-sm font-semibold text-primary">Teléfono</label>
          <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+56 9 1111 2222" inputMode="tel" />
        </div>
        <div>
          <label className="text-sm font-semibold text-primary">Email</label>
          <Input value={prefill.email ?? ''} readOnly disabled />
        </div>
        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)} className="mt-1" />
          Acepto los términos y condiciones de la compra.
        </label>
      </div>

      {error && (
        <p className="mt-3 flex items-center gap-2 text-sm text-destructive"><AlertCircle className="size-4" />{error}</p>
      )}

      <Button className="mt-4 h-12 w-full rounded-full" onClick={handleBuy} disabled={loading}>
        {loading ? <><Loader2 className="mr-2 size-4 animate-spin" />Procesando…</> : `Pagar ${formatMoney(product.price, currency)}`}
      </Button>
    </div>
  )
}
```

> Nota: el auto-abrir del checkout desde `?comprar=<productId>` (post-login) se puede resolver leyendo el search param en `PackageCatalog` con `useSearchParams`; si se agrega, envolver el componente en `<Suspense>` (requisito de Next 16 para `useSearchParams`). Para B4b-2 el flujo mínimo (volver logueada y clickear "Comprar") ya funciona; el auto-open es mejora opcional dentro de esta task si el tiempo lo permite.

- [ ] **Step 4: Verificar compilación completa**

Run: `npx prisma generate && npx tsc --noEmit | grep '^src/' || echo "0 errores en src/"`
Expected: `0 errores en src/`. Si aparece algún error por `useSearchParams` sin Suspense, resolverlo antes de commitear.

- [ ] **Step 5: Correr suite + lint**

Run: `npx vitest run && npx eslint src/components/packages src/app/paquetes`
Expected: PASS / sin errores de lint.

- [ ] **Step 6: Commit**

```bash
git -C . add src/components/packages
git commit -m "feat(packages): shell + catálogo + wizard de checkout (cliente)"
```

---

### Task 13: CTA "Paquetes" en la landing del negocio

**Files:**
- Modify: `src/components/public/business-profile.tsx`
- Modify (callers): las páginas que renderizan `BusinessProfile` (`src/app/b/[slug]/page.tsx` y la variante subdominio) para pasar `hasPackages`.

- [ ] **Step 1: Agregar prop y CTA en `business-profile.tsx`**

En la interfaz `BusinessProfileProps` agregar:
```ts
  packagesHref?: string
```
En la firma del componente: `{ business, bookingHref = `/book/${business.slug}`, accountCta, packagesHref }`.

Agregar un import de icono (junto a los `lucide-react`): `Package` → cambiar la línea de import para incluir `Package`.

Debajo del botón "Reservar ahora" (dentro del `div` fixed-bottom, después del `<Button asChild ...>Reservar ahora</Button>`), agregar:

```tsx
          {packagesHref && (
            <Button asChild variant="outline" className="mt-2 h-12 w-full rounded-full text-base font-semibold">
              <Link href={packagesHref}>
                <Package className="mr-2 size-5" />
                Ver paquetes
              </Link>
            </Button>
          )}
```

- [ ] **Step 2: Pasar `packagesHref` desde las páginas que usan `BusinessProfile`**

En cada caller (buscar con `grep -rn "<BusinessProfile" src/app`), calcular si el negocio tiene paquetes activos y pasar el href. Ejemplo para la variante path `src/app/b/[slug]/page.tsx`:

```tsx
// donde ya se carga el business para el perfil, sumar el conteo:
const hasPackages = await prisma.packageProduct.count({ where: { businessId: business.id, isActive: true } }).then(n => n > 0)
// ...
<BusinessProfile business={business} accountCta={...} packagesHref={hasPackages ? `/paquetes/${business.slug}` : undefined} />
```

Para la variante subdominio, usar `packagesHref={hasPackages ? '/paquetes' : undefined}`.

> Si el perfil usa un reader cacheado sin `packageProducts`, hacer el `count` aparte (no romper el include cacheado de `publicBusinessInclude`).

- [ ] **Step 3: Verificar compilación + lint**

Run: `npx tsc --noEmit | grep '^src/' || echo "0 errores"; npx eslint src/components/public/business-profile.tsx`
Expected: `0 errores` / sin errores de lint.

- [ ] **Step 4: Commit**

```bash
git -C . add src/components/public/business-profile.tsx src/app/b
git commit -m "feat(packages): CTA 'Ver paquetes' en la landing del negocio (solo si hay paquetes activos)"
```

---

### Task 14: Fixes de visibilidad owner (historial de pagos + refund source-aware)

**Files:**
- Modify: `src/server/actions/customers.ts`
- Modify: `src/app/dashboard/customers/[id]/package-panel.tsx`
- Test: `src/server/actions/customers.packages.test.ts` (crear)

- [ ] **Step 1: Test — ocultar `package_purchase` pending del historial**

```ts
// src/server/actions/customers.packages.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/auth/server', () => ({ requireBusiness: vi.fn().mockResolvedValue({ businessId: 'b1' }), ForbiddenError: class extends Error {} }))
const paymentFindMany = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    customer: { findFirst: vi.fn().mockResolvedValue({ id: 'c1', name: 'Ana', phone: 'x', email: null, notes: null, birthDate: null, createdAt: new Date(), updatedAt: new Date() }) },
    booking: { findMany: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _count: { id: 0 }, _max: {}, _sum: {} }) },
    payment: { findMany: (...a: unknown[]) => paymentFindMany(...a), aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
  },
}))
import { getCustomerDetail } from './customers'

describe('getCustomerDetail — historial de pagos', () => {
  beforeEach(() => paymentFindMany.mockReset())
  it('excluye package_purchase pending del listado de pagos', async () => {
    paymentFindMany.mockResolvedValue([])
    await getCustomerDetail('c1')
    const where = paymentFindMany.mock.calls[0][0].where
    // pending package_purchase no debe aparecer: se exige NOT { paymentType: 'package_purchase', status: 'pending' }
    expect(JSON.stringify(where)).toContain('package_purchase')
  })
})
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npx vitest run src/server/actions/customers.packages.test.ts`
Expected: FAIL — el where no filtra `package_purchase` pending.

- [ ] **Step 3: Implementar el filtro en `getCustomerDetail`**

En el `prisma.payment.findMany` dentro del `Promise.all` de `getCustomerDetail`, cambiar el `where`:

```ts
    prisma.payment.findMany({
      where: {
        customerId,
        businessId,
        // Ocultar compras de paquete pending (fantasmas): se muestran desde approved.
        NOT: { paymentType: 'package_purchase', status: 'pending' },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, amount: true, status: true, paymentType: true, paymentMethod: true, paidAt: true, createdAt: true, provider: true },
    }),
```

- [ ] **Step 4: Correr — debe pasar**

Run: `npx vitest run src/server/actions/customers.packages.test.ts`
Expected: PASS.

- [ ] **Step 5: Refund source-aware en `package-panel.tsx`**

(a) Agregar `source: string` al type `PackagePurchaseItem`.

(b) En `getCustomerPackages` (packages.ts) el `findMany` usa `include` sin `select`, así que ya devuelve `source`. Verificar que el caller que pasa `packages` al panel no lo esté recortando (si mapea campos, agregar `source`).

(c) En `onRefund`, ajustar el mensaje de confirmación según `source`. Reemplazar la función `onRefund` para recibir el item:

```tsx
  function onRefund(p: PackagePurchaseItem) {
    setError(null)
    const online = p.source === 'online'
    const msg = online
      ? 'Esta compra fue online (tarjeta). Al reembolsar acá se cancelan las sesiones y se revierte el ledger, pero DEBES devolver el cargo manualmente en Mercado Pago. ¿Continuar?'
      : '¿Reembolsar este paquete? Se cancelarán las sesiones restantes.'
    if (!confirm(msg)) return
    startTransition(async () => {
      try {
        await refundPackagePurchase(p.id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error')
      }
    })
  }
```

Y en el botón, cambiar `onClick={() => onRefund(p.id)}` por `onClick={() => onRefund(p)}`.

- [ ] **Step 6: Verificar compilación + lint**

Run: `npx tsc --noEmit | grep '^src/' || echo "0 errores"; npx eslint src/app/dashboard/customers/[id]/package-panel.tsx src/server/actions/customers.ts`
Expected: `0 errores` / sin errores.

- [ ] **Step 7: Commit**

```bash
git -C . add src/server/actions/customers.ts src/app/dashboard/customers/[id]/package-panel.tsx src/server/actions/customers.packages.test.ts
git commit -m "feat(packages): ocultar package_purchase pending del historial + aviso source-aware en refund"
```

---

### Task 15: Línea de ingresos por paquete en el dashboard

**Files:**
- Modify: `src/server/actions/ledger.ts`
- Modify: `src/app/dashboard/page.tsx` (o `src/app/dashboard/payments/page.tsx`, donde se muestre el resumen financiero)
- Test: `src/server/actions/ledger.packages.test.ts` (crear)

- [ ] **Step 1: Test — `getFinancialSummary` suma línea de paquete sin doble-contar**

```ts
// src/server/actions/ledger.packages.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/auth/server', () => ({ requireBusiness: vi.fn().mockResolvedValue({ businessId: 'b1' }) }))
const aggregate = vi.fn()
const count = vi.fn().mockResolvedValue(0)
vi.mock('@/lib/db', () => ({
  prisma: {
    ledgerEntry: { aggregate: (...a: unknown[]) => aggregate(...a), findMany: vi.fn() },
    payment: { aggregate: (...a: unknown[]) => aggregate(...a) },
    booking: { aggregate: (...a: unknown[]) => aggregate(...a), count: () => count() },
  },
}))
import { getFinancialSummary } from './ledger'

describe('getFinancialSummary — ingresos por paquete', () => {
  beforeEach(() => aggregate.mockReset())
  it('devuelve packageIncomeToday/Month derivados de package_sale neto de refund con packagePurchaseId', async () => {
    // El orden de aggregates depende de la implementación; devolvemos un valor por llamada.
    aggregate.mockResolvedValue({ _sum: { amount: 1000, remainingBalance: 0 } })
    const summary = await getFinancialSummary()
    expect(summary).toHaveProperty('packageIncomeToday')
    expect(summary).toHaveProperty('packageIncomeMonth')
  })
})
```

- [ ] **Step 2: Correr — debe fallar**

Run: `npx vitest run src/server/actions/ledger.packages.test.ts`
Expected: FAIL — `packageIncomeToday` no existe.

- [ ] **Step 3: Implementar en `getFinancialSummary`**

> **Del audit (GAP-6):** netear los refunds de paquete YA en B4b-2. `getPackageSalesTotal` (packages.ts) ya define "ventas de paquete" como `SUM(package_sale) − SUM(refund_issued con packagePurchaseId != null)`; el refund de paquete ya emite ese ledger entry hoy. Usar la MISMA definición (neta) acá evita introducir una tercera definición bruta que habría que reconciliar en B4b-3.

Agregar cuatro aggregates al `Promise.all` (ventas de paquete hoy/mes = `package_sale` menos `refund_issued`, con `packagePurchaseId != null`, en la ventana):

```ts
    // Ventas de paquete (income) hoy/mes
    prisma.ledgerEntry.aggregate({
      where: { ...baseWhere, type: 'package_sale', packagePurchaseId: { not: null }, occurredAt: { gte: today } },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { ...baseWhere, type: 'package_sale', packagePurchaseId: { not: null }, occurredAt: { gte: thisMonth } },
      _sum: { amount: true },
    }),
    // Refunds de paquete hoy/mes (para netear)
    prisma.ledgerEntry.aggregate({
      where: { ...baseWhere, type: 'refund_issued', packagePurchaseId: { not: null }, occurredAt: { gte: today } },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { ...baseWhere, type: 'refund_issued', packagePurchaseId: { not: null }, occurredAt: { gte: thisMonth } },
      _sum: { amount: true },
    }),
```

Agregar las variables a la desestructuración del `Promise.all` (al final, para no correr los índices existentes):
```ts
  const [incomeToday, incomeMonth, totalDeposited, totalPending, totalRefunded, totalBookings, completedBookings, cancelledBookings, packageSaleToday, packageSaleMonth, packageRefundToday, packageRefundMonth] = await Promise.all([
```

Y al objeto de retorno (netos, floor en 0):
```ts
    packageIncomeToday: Math.max(0, (packageSaleToday._sum.amount ?? 0) - (packageRefundToday._sum.amount ?? 0)),
    packageIncomeMonth: Math.max(0, (packageSaleMonth._sum.amount ?? 0) - (packageRefundMonth._sum.amount ?? 0)),
```

- [ ] **Step 4: Incluir `packagePurchase` en `getLedgerEntries`**

```ts
    include: {
      booking: true,
      payment: true,
      packagePurchase: { include: { product: { select: { name: true } }, customer: { select: { name: true } } } },
    },
```

- [ ] **Step 5: Correr — debe pasar**

Run: `npx vitest run src/server/actions/ledger.packages.test.ts`
Expected: PASS.

- [ ] **Step 6: Mostrar la línea en el dashboard**

En la página que renderiza el resumen (buscar `getFinancialSummary` con `grep -rn "getFinancialSummary" src/app`), agregar una tarjeta/línea usando `summary.packageIncomeToday` / `summary.packageIncomeMonth`, con `formatMoney(value, currency)`. Ubicarla junto a las líneas de `incomeToday`/`incomeMonth` existentes.

> **Del audit (GAP-5) — etiquetado obligatorio:** la página `dashboard/paquetes/page.tsx` ya muestra `getPackageSalesTotal()` como **"Total vendido"** (neto histórico, sin ventana). Para no exhibir el mismo concepto con dos cifras confusas, rotular esta línea del dashboard principal explícitamente con ventana temporal: **"Ventas de paquetes (mes)"** / **"(hoy)"** — NO usar "Ingresos por paquete" a secas ni la palabra "Total". Ambas cifras usan ahora la misma definición neta (Step 3), así que la de paquetes-page = histórico neto y la del dashboard = mismo neto acotado al mes/día: consistentes, solo difieren en la ventana. Documentar en un comentario que `incomeToday`/`incomeMonth` (KPI de reservas) siguen excluyendo paquetes (`packagePurchaseId: null`), por lo que esta línea es aditiva, no solapada.

- [ ] **Step 7: Verificar compilación + lint**

Run: `npx tsc --noEmit | grep '^src/' || echo "0 errores"; npx eslint src/server/actions/ledger.ts`
Expected: `0 errores` / sin errores.

- [ ] **Step 8: Commit**

```bash
git -C . add src/server/actions/ledger.ts src/app/dashboard src/server/actions/ledger.packages.test.ts
git commit -m "feat(packages): línea de ingresos por paquete en el dashboard + packagePurchase en getLedgerEntries"
```

---

### Task 16: Test de integración + gate por rebanada

**Files:**
- Test: `src/server/services/finance.package-online.integration.test.ts` (crear; seguir el patrón de los tests de integración existentes — buscar `describe.*integ` o los que usan la DB de test)

- [ ] **Step 1: Escribir el test de integración de compra completa**

Cubre: `createPackagePurchase` (pending) → `initiatePackagePayment` (Payment pending, provider mock) → simular `approved` vía `applyApprovedPackagePayment` en tx → assert: `PackagePurchase.status === 'active'`, grants = quantity+bonus, `LedgerEntry` `package_sale` con `packagePurchaseId`, y que una consulta de `/mi` por `userId` (Customer linkeada) devuelve la compra.

Seguir el patrón de setup/teardown de los tests de integración del repo (mismo `prisma` real de test, `beforeEach` limpiando tablas). Estructura:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { applyApprovedPackagePayment } from '@/server/services/finance'
// helpers de fixtures del repo (business, user, customer con userId, packageProduct)

describe('compra online de paquete (integración)', () => {
  beforeEach(async () => { /* limpiar tablas relevantes según patrón del repo */ })

  it('approved activa la compra, emite grants, asienta el ledger y queda visible por userId', async () => {
    // 1. fixtures: business + user + PackageProduct(quantity 5, bonus 1, price 50000)
    // 2. crear Customer con userId=user.id + PackagePurchase(status pending, source online, snapshots)
    // 3. crear Payment(pending, package_purchase, packagePurchaseId)
    // 4. aplicar aprobación:
    await prisma.$transaction(tx => applyApprovedPackagePayment({
      tx, packagePurchaseId, businessId, amount: 50000, currency: 'CLP',
      provider: 'mercado_pago', providerPaymentId: 'mp1', paymentType: 'package_purchase', paymentId,
    }))
    // asserts:
    const purchase = await prisma.packagePurchase.findUnique({ where: { id: packagePurchaseId } })
    expect(purchase?.status).toBe('active')
    const grants = await prisma.promotionGrant.count({ where: { packagePurchaseId } })
    expect(grants).toBe(6)
    const ledger = await prisma.ledgerEntry.findFirst({ where: { packagePurchaseId, type: 'package_sale' } })
    expect(ledger?.amount).toBe(50000)
    // visible por userId:
    const viaUser = await prisma.packagePurchase.findMany({ where: { customer: { userId: user.id }, status: 'active' } })
    expect(viaUser).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Correr el test de integración**

Run: `npx vitest run src/server/services/finance.package-online.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Gate — suite unit completa**

Run: `npx vitest run`
Expected: PASS (toda la suite verde).

- [ ] **Step 4: Gate — tipos (0 errores en src/)**

Run: `npx prisma generate && npx tsc --noEmit | grep '^src/' || echo "0 errores en src/"`
Expected: `0 errores en src/`.

- [ ] **Step 5: Gate — lint**

Run: `npx eslint src/`
Expected: sin errores.

- [ ] **Step 6: Gate — `/simplify` (4 ángulos) sobre el diff de la rama**

Correr el skill `/simplify` contra el diff acumulado; aplicar/deduplicar hallazgos de reuse/simplificación/eficiencia/altitud. Commitear los ajustes.

- [ ] **Step 7: Gate — code review 5-finders con verificación**

Correr la revisión de código (5 finders + verificación) sobre el diff; corregir hallazgos confirmados; re-correr suite + tsc + lint tras los fixes.

- [ ] **Step 8: Commit final de gate + PR SIN auto-merge**

```bash
git -C . add -A  # solo si quedan ajustes del gate; preferir git add de archivos explícitos
git commit -m "chore(packages): gate B4b-2 (simplify + code review)"
git push -u origin claude/b4b-packages-online
gh pr create --base main --head claude/b4b-packages-online \
  --title "feat(packages): B4b-2 compra online pública de paquetes prepagos" \
  --body "$(cat <<'EOF'
## Resumen
Compra online de paquetes prepagos con Mercado Pago desde `/paquetes` (login requerido), activación por webhook (grants + ledger), notificaciones (clienta + dueña), línea de ingresos por paquete en el dashboard y aviso source-aware en refund.

Segunda rebanada de B4b (predecesora #72). Enfoque C: helper compartido `createMpPreferenceForPayment` + acciones de checkout + dispatch en webhook. Camino de reservas con contrato idéntico.

Spec: `docs/superpowers/specs/2026-07-12-packages-B4b-2-online-purchase-design.md`
Plan: `docs/superpowers/plans/2026-07-12-packages-B4b-2-online-purchase.md`

## Fuera de alcance (B4b-3)
Transferencia bancaria para paquetes, cron sweep de holds, refund real por MP, política de chargeback de paquete activo.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> **NO** usar `--auto` ni bypass de checks. El merge requiere OK explícito del usuario por PR.

---

## Self-Review (checklist del autor)

**Cobertura del spec:**
- Rutas `/paquetes/[slug]`, `/paquetes`, `/paquetes/confirmation` → Task 11. ✅
- Catálogo + gating por disponibilidad online → Tasks 11, 12. ✅
- Mini-wizard login-requerido → Task 12 (+ prefill Task 6). ✅
- Notificaciones clienta + dueña → Task 9 (dispatch Task 10). ✅
- Línea de ingresos por paquete → Task 15. ✅
- Aviso source-aware en refund → Task 14. ✅
- Readers cacheados + revalidación → Tasks 1, 2, 3. ✅
- Helper compartido (enfoque C) → Task 5. ✅
- `getPackageConfirmationUrl` → Task 4. ✅
- Webhook dispatch + metadata por tipo + refund branch + revalidación → Task 10. ✅
- Fixes visibilidad owner (pending fuera de historial + panel) → Tasks 3, 14. ✅
- `derivePackageConfirmationState` → Task 8. ✅
- CTA landing → Task 13. ✅
- Testing unit + integración + gate → Tasks 1-16. ✅

**Decisiones cerradas:**
- Sin puntos de lealtad por comprar → no se toca loyalty; `applyApprovedPackagePayment` no acredita puntos. ✅
- Refund source-aware ahora / MP real en B4b-3 → Task 14 (aviso) + webhook branch documentado (Task 10). ✅
- Ingresos por paquete al dashboard → Task 15. ✅
- Login requerido → Task 6 (`getCurrentUser` obligatorio) + Task 12 (gate). ✅

**Consistencia de tipos/nombres:** `createPackagePurchase({packageProductId,name,phone,acceptedTerms})` → `{purchaseId}`; `initiatePackagePayment({purchaseId})` → `{redirectUrl}|{confirmed}`; `derivePackageConfirmationState({status,payments})`; `PackagesBusiness`, `PackagePurchasedEmailData`, `CatalogProduct` usados consistentemente entre tasks. ✅

**Landmines cubiertas:** await en revalidate (T3), no `join` (T1), tsc grep (T16), sin migración, costura email→Customer (T6), git add explícito. ✅
