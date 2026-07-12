# CTA de cuenta en el funnel público — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el funnel público invite a la clienta a usar su cuenta: prefill con sesión en "Tus datos", link "Ingresar"/"Mi cuenta" en la landing del negocio, y CTA post-reserva — con retorno cross-subdominio vía redirector `/ir/[slug]` y restauración del wizard.

**Architecture:** Las pages del funnel (ya dinámicas: leen `headers()`) empiezan a leer la sesión con un helper server-side (`getFunnelSession`). El retorno post-OAuth usa un redirector cuyo destino sale de la DB (`sanitizeNext` intacto). El estado del wizard se serializa a `sessionStorage` con TTL 30 min y se restaura solo con el flag `?continuar=1`. Los CTAs post-reserva nunca compiten con acciones de transferencia bancaria.

**Tech Stack:** Next.js 16 App Router, Prisma, Vitest 4 (`vi.hoisted`), renderToStaticMarkup + mock `next/navigation` para component tests.

**Spec:** `docs/superpowers/specs/2026-07-11-funnel-account-cta-design.md`

---

## Landmines del repo

1. `sanitizeNext` NO se toca: solo acepta paths root-relative. `/ir/<slug>` pasa porque es root-relative.
2. `signOut` NO se toca ni se llama desde el funnel ("No soy yo" solo limpia el prefill local).
3. Component tests: `renderToStaticMarkup` + mock de `next/navigation` (useRouter/redirect) o el render lanza. Los `useEffect` NO corren en static markup — la lógica de restore se testea como función pura, no montando el wizard.
4. tsc no corre en vitest/lint: antes de push `npx prisma generate && npx tsc --noEmit | grep '^src/'` → cero errores nuevos.
5. Worktrees: `git -C <worktree>` + `git add` de archivos explícitos (nunca `-A`). Paths con corchetes van entre comillas.
6. `useSearchParams()` en client components exige Suspense boundary — usar `window.location.search` dentro de `useEffect` en su lugar.
7. En el wizard, el tipo `Service` viene de `@prisma/client`; el import de tipos desde `wizard.tsx` en módulos lib es type-only (se borra en build, no crea ciclo runtime).

**Setup:** la rama `claude/d1-funnel-cta` ya existe sobre `origin/main` con el spec committeado. `npm install && npx prisma generate` si el worktree está frío.

---

### Task 1: Helpers puros de persistencia del wizard — `src/lib/booking/wizard-storage.ts`

**Files:**
- Create: `src/lib/booking/wizard-storage.ts`
- Test: `tests/unit/wizard-storage.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/wizard-storage.test.ts
import { describe, expect, it } from 'vitest'
import { serializeWizardState, restoreWizardState, wizardStorageKey } from '@/lib/booking/wizard-storage'
import type { BookingData } from '@/components/booking/wizard'

const NOW = new Date('2026-07-11T12:00:00Z').getTime()

const service = {
  id: 's1', name: 'Manicure', price: 20000, durationMinutes: 60,
  depositAmount: 5000, pastelColor: '#f4dbca', isActive: true,
} as never // Service de Prisma: solo usamos estos campos

const data: BookingData = {
  serviceId: 's1', serviceName: 'Manicure', servicePrice: 20000, serviceDuration: 60,
  serviceDeposit: 5000, serviceColor: '#f4dbca',
  date: new Date('2026-07-20T00:00:00Z'),
  timeSlot: { start: new Date('2026-07-20T15:00:00Z'), end: new Date('2026-07-20T16:00:00Z') },
  customerName: 'Maria', customerPhone: '+56911111111', customerEmail: 'maria@example.com',
  customerNotes: '', idempotencyKey: 'idem-1', promotionCode: 'PROMO',
}

describe('wizardStorageKey', () => {
  it('es por negocio', () => {
    expect(wizardStorageKey('b1')).not.toBe(wizardStorageKey('b2'))
  })
})

describe('serialize + restore round-trip', () => {
  it('restaura Dates, datos de clienta, idempotencyKey y promo, rederivando el servicio', () => {
    const raw = serializeWizardState(data, NOW)
    const restored = restoreWizardState(raw, [service], NOW + 60_000)
    expect(restored).not.toBeNull()
    expect(restored!.serviceId).toBe('s1')
    expect(restored!.serviceName).toBe('Manicure')
    expect(restored!.date).toEqual(new Date('2026-07-20T00:00:00Z'))
    expect(restored!.timeSlot).toEqual({ start: new Date('2026-07-20T15:00:00Z'), end: new Date('2026-07-20T16:00:00Z') })
    expect(restored!.customerEmail).toBe('maria@example.com')
    expect(restored!.idempotencyKey).toBe('idem-1')
    expect(restored!.promotionCode).toBe('PROMO')
  })

  it('sin servicio elegido no serializa nada', () => {
    expect(serializeWizardState({ ...data, serviceId: null }, NOW)).toBeNull()
  })

  it('expirado (>30 min) devuelve null', () => {
    const raw = serializeWizardState(data, NOW)
    expect(restoreWizardState(raw, [service], NOW + 31 * 60_000)).toBeNull()
  })

  it('servicio inexistente o inactivo descarta TODO el estado (no restaura parcial)', () => {
    const raw = serializeWizardState(data, NOW)
    expect(restoreWizardState(raw, [], NOW)).toBeNull()
    expect(restoreWizardState(raw, [{ ...(service as object), isActive: false } as never], NOW)).toBeNull()
  })

  it('JSON corrupto o null devuelve null sin lanzar', () => {
    expect(restoreWizardState('{{{', [service], NOW)).toBeNull()
    expect(restoreWizardState(null, [service], NOW)).toBeNull()
  })
})
```

- [ ] **Step 2: Run `npx vitest run tests/unit/wizard-storage.test.ts`** → FAIL (módulo no existe).

- [ ] **Step 3: Implementation**

```ts
// src/lib/booking/wizard-storage.ts
import type { Service } from '@prisma/client'
import type { BookingData } from '@/components/booking/wizard'

/** Persistencia del wizard para el viaje a /ingresar y de vuelta (spec CTA funnel).
 *  Helpers puros (testeables): el wizard hace el sessionStorage.get/set. */

const TTL_MS = 30 * 60_000

export function wizardStorageKey(businessId: string): string {
  return `agendita:wizard:${businessId}`
}

interface SavedState {
  savedAt: number
  serviceId: string
  date: string | null
  timeSlotStart: string | null
  timeSlotEnd: string | null
  customerName: string
  customerPhone: string
  customerEmail: string
  customerNotes: string
  idempotencyKey: string | null
  promotionCode?: string
}

export function serializeWizardState(data: BookingData, now: number = Date.now()): string | null {
  if (!data.serviceId) return null
  const saved: SavedState = {
    savedAt: now,
    serviceId: data.serviceId,
    date: data.date ? data.date.toISOString() : null,
    timeSlotStart: data.timeSlot ? data.timeSlot.start.toISOString() : null,
    timeSlotEnd: data.timeSlot ? data.timeSlot.end.toISOString() : null,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerEmail: data.customerEmail,
    customerNotes: data.customerNotes,
    idempotencyKey: data.idempotencyKey,
    ...(data.promotionCode ? { promotionCode: data.promotionCode } : {}),
  }
  return JSON.stringify(saved)
}

/** Devuelve el BookingData completo a restaurar, o null si el estado no sirve
 *  (expirado, corrupto, o el servicio ya no existe/está inactivo — en ese caso
 *  se descarta TODO: nada de restauraciones parciales). Los campos denormalizados
 *  del servicio se re-derivan de la lista actual, no del snapshot. */
export function restoreWizardState(raw: string | null, services: Service[], now: number = Date.now()): BookingData | null {
  if (!raw) return null
  let saved: SavedState
  try {
    saved = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof saved?.savedAt !== 'number' || now - saved.savedAt > TTL_MS) return null

  const service = services.find((s) => s.id === saved.serviceId)
  if (!service || !service.isActive) return null

  return {
    serviceId: service.id,
    serviceName: service.name,
    servicePrice: service.price,
    serviceDuration: service.durationMinutes,
    serviceDeposit: service.depositAmount,
    serviceColor: service.pastelColor || '',
    date: saved.date ? new Date(saved.date) : null,
    timeSlot: saved.timeSlotStart && saved.timeSlotEnd
      ? { start: new Date(saved.timeSlotStart), end: new Date(saved.timeSlotEnd) }
      : null,
    customerName: saved.customerName ?? '',
    customerPhone: saved.customerPhone ?? '',
    customerEmail: saved.customerEmail ?? '',
    customerNotes: saved.customerNotes ?? '',
    idempotencyKey: saved.idempotencyKey ?? null,
    ...(saved.promotionCode ? { promotionCode: saved.promotionCode } : {}),
  }
}
```

NOTA: verifica en `prisma/schema.prisma` los nombres reales de los campos de `Service` (`price`, `durationMinutes`, `depositAmount`, `pastelColor`, `isActive`) — ajusta si difieren y reporta.

- [ ] **Step 4: Run** → PASS. También `npx tsc --noEmit | grep '^src/'` → vacío.

- [ ] **Step 5: Commit**

```bash
git add src/lib/booking/wizard-storage.ts tests/unit/wizard-storage.test.ts
git commit -m "feat(funnel-cta): helpers de persistencia del wizard con TTL"
```

---

### Task 2: Helper de sesión para el funnel — `src/lib/customers/session-prefill.ts`

**Files:**
- Create: `src/lib/customers/session-prefill.ts`
- Test: `tests/unit/funnel-session-prefill.test.ts`

- [ ] **Step 1: Tests** (mocks vía `vi.hoisted`: `@/lib/auth/user` → `getCurrentUser`, `@/lib/db` → `prisma.customer.findFirst`):

```ts
// tests/unit/funnel-session-prefill.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCurrentUser, mockFindFirst } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockFindFirst: vi.fn(),
}))
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mockGetCurrentUser }))
vi.mock('@/lib/db', () => ({ prisma: { customer: { findFirst: mockFindFirst } } }))

import { getFunnelSession } from '@/lib/customers/session-prefill'

describe('getFunnelSession', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sin sesión → null', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    expect(await getFunnelSession('b1')).toBeNull()
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('con sesión y Customer vinculada: prefill desde la Customer más antigua', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'maria@example.com', user_metadata: { name: 'Maria Meta' } })
    mockFindFirst.mockResolvedValue({ name: 'Maria Cliente', phone: '+56911111111' })
    const s = await getFunnelSession('b1')
    expect(s).toEqual({ email: 'maria@example.com', name: 'Maria Cliente', phone: '+56911111111', hasCustomer: true })
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: 'b1', userId: 'u1' },
      orderBy: { createdAt: 'asc' },
    }))
  })

  it('con sesión sin Customer: nombre desde user_metadata, teléfono vacío, hasCustomer false', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'maria@example.com', user_metadata: { name: 'Maria Meta' } })
    mockFindFirst.mockResolvedValue(null)
    const s = await getFunnelSession('b1')
    expect(s).toEqual({ email: 'maria@example.com', name: 'Maria Meta', phone: '', hasCustomer: false })
  })

  it('sesión sin email (borde) → null', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: undefined, user_metadata: {} })
    expect(await getFunnelSession('b1')).toBeNull()
  })
})
```

- [ ] **Step 2: FAIL → Step 3: Implementation**

```ts
// src/lib/customers/session-prefill.ts
import { getCurrentUser } from '@/lib/auth/user'
import { prisma } from '@/lib/db'

export interface FunnelSession {
  email: string
  name: string
  phone: string
  hasCustomer: boolean
}

/** Sesión de clienta para el funnel público: email de la sesión + datos de su
 *  Customer vinculada en ESTE negocio (la más antigua, mismo criterio que /mi/[slug]).
 *  Solo lectura sobre la propia sesión — no expone datos de terceros. */
export async function getFunnelSession(businessId: string): Promise<FunnelSession | null> {
  const user = await getCurrentUser()
  if (!user?.email) return null

  const customer = await prisma.customer.findFirst({
    where: { businessId, userId: user.id },
    orderBy: { createdAt: 'asc' },
    select: { name: true, phone: true },
  })

  return {
    email: user.email,
    name: customer?.name || user.user_metadata?.name || user.user_metadata?.full_name || '',
    phone: customer?.phone ?? '',
    hasCustomer: customer !== null,
  }
}
```

- [ ] **Step 4: PASS + tsc limpio → Step 5: Commit**

```bash
git add src/lib/customers/session-prefill.ts tests/unit/funnel-session-prefill.test.ts
git commit -m "feat(funnel-cta): getFunnelSession — sesión + Customer vinculada para el funnel"
```

---

### Task 3: Redirector confiable — `src/app/ir/[slug]/route.ts`

**Files:**
- Create: `src/app/ir/[slug]/route.ts`
- Test: `tests/unit/ir-redirector.test.ts`

**Por qué:** el OAuth termina en el host de la app y `sanitizeNext` solo acepta paths root-relative → no puede expresar `slug.agendita.cl/book`. `/ir/<slug>` ES root-relative (pasa sanitizeNext) y el destino sale de la DB, nunca del parámetro → no es open redirect.

- [ ] **Step 1: Tests** (mock `@/lib/db`):

```ts
// tests/unit/ir-redirector.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindUnique } = vi.hoisted(() => ({ mockFindUnique: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { business: { findUnique: mockFindUnique } } }))

import { GET } from '@/app/ir/[slug]/route'

function call(slug: string) {
  return GET(new Request('https://agendita.cl/ir/' + slug), { params: Promise.resolve({ slug }) })
}

describe('GET /ir/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_APP_DOMAIN', 'agendita.cl')
  })

  it('slug válido → 302 al funnel del subdominio con ?continuar=1', async () => {
    mockFindUnique.mockResolvedValue({ slug: 'salon-ana', subdomain: 'salonana' })
    const res = await call('salon-ana')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://salonana.agendita.cl/book?continuar=1')
  })

  it('negocio sin subdominio → 302 al path /book/[slug]', async () => {
    mockFindUnique.mockResolvedValue({ slug: 'salon-ana', subdomain: null })
    const res = await call('salon-ana')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://agendita.cl/book/salon-ana?continuar=1')
  })

  it('slug inexistente → 404', async () => {
    mockFindUnique.mockResolvedValue(null)
    const res = await call('nope')
    expect(res.status).toBe(404)
  })
})
```

(Si `vi.stubEnv` no altera lo que lee `getConfiguredAppDomain` porque el módulo cachea, ajusta: lee `src/lib/business/urls.ts` — `getConfiguredAppDomain()` lee `process.env` en cada llamada, así que `vi.stubEnv` en `beforeEach` funciona. Verifica y reporta.)

- [ ] **Step 2: FAIL → Step 3: Implementation**

```ts
// src/app/ir/[slug]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getBookingFunnelUrl } from '@/lib/business/urls'

/** Redirector confiable app-host → funnel del tenant. El destino sale de la DB
 *  (slug/subdomain del negocio), nunca del parámetro: no es open redirect.
 *  `/ir/<slug>` es root-relative → sanitizeNext lo acepta como `next` post-OAuth.
 *  `?continuar=1` le dice al wizard que restaure su estado guardado. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const business = await prisma.business.findUnique({
    where: { slug },
    select: { slug: true, subdomain: true },
  })
  if (!business) {
    return new NextResponse('Negocio no encontrado', { status: 404 })
  }
  return NextResponse.redirect(getBookingFunnelUrl(business, 'continuar=1'), 302)
}
```

- [ ] **Step 4: PASS + tsc limpio → Step 5: Commit**

```bash
git add "src/app/ir/[slug]/route.ts" tests/unit/ir-redirector.test.ts
git commit -m "feat(funnel-cta): redirector /ir/[slug] hacia el funnel del tenant"
```

---

### Task 4: StepCustomer — banner de login y prefill con sesión

**Files:**
- Modify: `src/components/booking/step-customer.tsx`
- Test: `tests/unit/step-customer-session.test.tsx`

Props nuevas de `StepCustomer` (además de las actuales `data`, `onSubmit`, `onBack`):
- `sessionEmail: string | null` — email de la sesión (null = sin sesión).
- `onLoginCta: (partial: Partial<BookingData>) => void` — el wizard guarda estado y navega a /ingresar. StepCustomer le pasa su `formData` local para no perder lo tipeado.

- [ ] **Step 1: Component tests** (patrón del repo: `renderToStaticMarkup`; StepCustomer no usa `next/navigation`, no necesita ese mock — verifica):

```tsx
// tests/unit/step-customer-session.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StepCustomer } from '@/components/booking/step-customer'
import type { BookingData } from '@/components/booking/wizard'

const data: BookingData = {
  serviceId: 's1', serviceName: 'Manicure', servicePrice: 20000, serviceDuration: 60,
  serviceDeposit: 0, serviceColor: '', date: null, timeSlot: null,
  customerName: 'Maria', customerPhone: '+56911111111', customerEmail: 'maria@example.com',
  customerNotes: '', idempotencyKey: null,
}
const noop = vi.fn()

describe('StepCustomer con sesión', () => {
  it('sin sesión: muestra el banner "¿Ya tienes cuenta?"', () => {
    const html = renderToStaticMarkup(
      <StepCustomer data={{ ...data, customerName: '', customerPhone: '', customerEmail: '' }} sessionEmail={null} onLoginCta={noop} onSubmit={noop} onBack={noop} />,
    )
    expect(html).toContain('¿Ya tienes cuenta?')
    expect(html).toContain('Ingresa')
  })

  it('con sesión: muestra "Reservando como" + "No soy yo" y NO el banner', () => {
    const html = renderToStaticMarkup(
      <StepCustomer data={data} sessionEmail="maria@example.com" onLoginCta={noop} onSubmit={noop} onBack={noop} />,
    )
    expect(html).toContain('Reservando como maria@example.com')
    expect(html).toContain('No soy yo')
    expect(html).not.toContain('¿Ya tienes cuenta?')
  })
})
```

("No soy yo" limpia el form: es interacción con estado — el static markup no la ejerce; se cubre con la lógica simple del handler y revisión. NO montar con jsdom si el repo no lo hace ya.)

- [ ] **Step 2: FAIL → Step 3: Implementation** — en `step-customer.tsx`:

```tsx
// firma nueva
export function StepCustomer({ data, sessionEmail, onLoginCta, onSubmit, onBack }: {
  data: BookingData
  sessionEmail: string | null
  onLoginCta: (partial: Partial<BookingData>) => void
  onSubmit: (data: Partial<BookingData>) => void
  onBack: () => void
}) {
  const [formData, setFormData] = useState({ /* igual que hoy */ })
  // "No soy yo": reserva para otra persona SIN cerrar sesión (signOut perdería el wizard).
  const [dismissedSession, setDismissedSession] = useState(false)
  const showSession = sessionEmail !== null && !dismissedSession

  function handleNotMe() {
    setDismissedSession(true)
    setFormData({ customerName: '', customerPhone: '', customerEmail: '', customerNotes: formData.customerNotes })
  }
```

Bloque JSX ANTES del `<form>` (después del `<p>` de subtítulo):

```tsx
      {sessionEmail === null && (
        <button
          type="button"
          onClick={() => onLoginCta(formData)}
          className="mb-6 w-full rounded-2xl border border-primary/25 bg-secondary/40 px-4 py-3 text-left text-sm text-primary transition hover:bg-secondary/60"
        >
          ¿Ya tienes cuenta? <span className="font-semibold underline">Ingresa</span> y completamos tus datos.
        </button>
      )}
      {showSession && (
        <p className="mb-6 text-sm text-muted-foreground">
          Reservando como {sessionEmail} ·{' '}
          <button type="button" onClick={handleNotMe} className="font-semibold text-primary hover:underline">No soy yo</button>
        </p>
      )}
```

El form no cambia (los valores prefilleados llegan vía `data` desde el wizard — Task 5).

- [ ] **Step 4: PASS (nuevo test + suite entera de unit) → Step 5: Commit**

```bash
git add src/components/booking/step-customer.tsx tests/unit/step-customer-session.test.tsx
git commit -m "feat(funnel-cta): banner de login y estado de sesión en el paso Tus datos"
```

---

### Task 5: Wizard — prefill, guardado y restauración

**Files:**
- Modify: `src/components/booking/wizard.tsx`
- Modify: `src/components/booking/booking-business-page.tsx`
- Test: la lógica pura ya está testeada en Task 1; los tests de componentes existentes del wizard (si los hay — busca `wizard` en tests/unit) deben seguir verdes con las props nuevas.

- [ ] **Step 1: Props nuevas del wizard**

```tsx
interface BookingWizardProps {
  businessId: string
  slug: string                       // para /ingresar?next=/ir/<slug>
  timezone: string
  services: Service[]
  cancellationPolicy?: string | null
  referralToken?: string
  session: { email: string; name: string; phone: string } | null  // FunnelSession sin hasCustomer
}
```

- [ ] **Step 2: Prefill inicial desde la sesión** — reemplaza `useState<BookingData>(initialData)`:

```tsx
  const [data, setData] = useState<BookingData>(() =>
    session
      ? { ...initialData, customerName: session.name, customerPhone: session.phone, customerEmail: session.email }
      : initialData,
  )
```

- [ ] **Step 3: Restauración con `?continuar=1`** — `useEffect` al montar (usa `window.location.search`, NO `useSearchParams` — landmine §6):

```tsx
  // Restaura el estado guardado antes del viaje a /ingresar (solo con ?continuar=1;
  // el storage se limpia siempre para no restaurar dos veces ni dejar residuo).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!new URLSearchParams(window.location.search).has('continuar')) return
    const key = wizardStorageKey(businessId)
    const raw = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    const restored = restoreWizardState(raw, services)
    if (!restored) return
    // El prefill de sesión pisa los campos de contacto del snapshot: ahora está logueada.
    setData(session
      ? { ...restored, customerName: session.name || restored.customerName, customerPhone: session.phone || restored.customerPhone, customerEmail: session.email }
      : restored)
    setCurrentStep(restored.timeSlot ? 4 : restored.date ? 3 : 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, [])
```

Imports: `import { useEffect } from 'react'`, `import { restoreWizardState, serializeWizardState, wizardStorageKey } from '@/lib/booking/wizard-storage'`.

- [ ] **Step 4: Handler del CTA de login** y paso de props a StepCustomer:

```tsx
  function handleLoginCta(partial: Partial<BookingData>) {
    const merged = { ...data, ...partial }
    const raw = serializeWizardState(merged)
    if (raw) sessionStorage.setItem(wizardStorageKey(businessId), raw)
    window.location.href = `/ingresar?next=${encodeURIComponent(`/ir/${slug}`)}`
  }
```

y en el render del paso 4:

```tsx
          <StepCustomer data={data} sessionEmail={session?.email ?? null} onLoginCta={handleLoginCta} onSubmit={(customerData) => {
            updateData(customerData)
            nextStep()
          }} onBack={prevStep} />
```

- [ ] **Step 5: `booking-business-page.tsx`** — props nuevas `slug` y `session`, threading al wizard:

```tsx
interface BookingBusinessPageProps {
  business: BookingBusiness
  profileHref: string
  referralToken?: string
  session: { email: string; name: string; phone: string } | null
}
// ...
        <BookingWizard
          businessId={business.id}
          slug={business.slug}
          timezone={business.timezone || 'America/Santiago'}
          services={business.services}
          cancellationPolicy={business.cancellationPolicy}
          referralToken={referralToken}
          session={session}
        />
```

(Verifica que `BookingBusiness` incluye `slug`; si no, agrégalo al select de `getBookingBusinessBySubdomain` en `src/lib/business/public.ts` y reporta.)

- [ ] **Step 6: Suite + tsc + eslint sobre los 2 archivos → Commit**

```bash
git add src/components/booking/wizard.tsx src/components/booking/booking-business-page.tsx
git commit -m "feat(funnel-cta): prefill de sesión + guardar/restaurar estado del wizard"
```

---

### Task 6: Pages del funnel — leer sesión y verificación de rendering

**Files:**
- Modify: `src/app/book/page.tsx`
- Modify: `src/app/book/[slug]/page.tsx`
- Test: verificación manual/CI (pages async: sin component test nuevo; el cableado lo cubre el e2e existente del funnel en CI).

- [ ] **Step 1:** En `src/app/book/page.tsx`, dentro del branch `if (business)`:

```tsx
import { getFunnelSession } from '@/lib/customers/session-prefill'
// ...
    if (business) {
      const session = await getFunnelSession(business.id)
      return <BookingBusinessPage business={business} profileHref="/" referralToken={referralToken} session={session ? { email: session.email, name: session.name, phone: session.phone } : null} />
    }
```

- [ ] **Step 2:** Igual en `src/app/book/[slug]/page.tsx` en su branch de render directo (el branch que redirige a `/book` cuando hay tenant NO cambia).

- [ ] **Step 3: Verificación de rendering (obligatoria, spec §1):** `npm run build 2>&1 | grep -A40 'Route (app)'` — confirmar que `/`, `/book`, `/book/[slug]`, `/b/[slug]` eran y siguen siendo dinámicas (símbolo `ƒ`). Si alguna era estática (`○`/`●`) antes del cambio (compara con `git stash` si hay duda), REPORTA antes de seguir — es una decisión de arquitectura.

- [ ] **Step 4: Suite + tsc → Commit**

```bash
git add src/app/book/page.tsx "src/app/book/[slug]/page.tsx"
git commit -m "feat(funnel-cta): el funnel lee la sesión de clienta"
```

---

### Task 7: CTA en la landing del negocio

**Files:**
- Modify: `src/components/public/business-profile.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/b/[slug]/page.tsx`
- Test: `tests/unit/business-profile-account-cta.test.tsx`

- [ ] **Step 1: Component tests:**

```tsx
// tests/unit/business-profile-account-cta.test.tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BusinessProfile } from '@/components/public/business-profile'
import type { PublicBusiness } from '@/lib/business/public'

// Fixture mínimo: copia el shape de PublicBusiness de un test existente si hay
// (busca `BusinessProfile` o `PublicBusiness` en tests/); si no, construye con
// los campos que el componente usa (name, bio, services: [], etc.).
declare const business: PublicBusiness // reemplaza por el fixture real

describe('BusinessProfile — CTA de cuenta', () => {
  it('sin prop accountCta no renderiza nada nuevo', () => {
    const html = renderToStaticMarkup(<BusinessProfile business={business} />)
    expect(html).not.toContain('Mi cuenta')
    expect(html).not.toContain('>Ingresar<')
  })

  it('anon: link Ingresar hacia /ingresar?next=/ir/[slug]', () => {
    const html = renderToStaticMarkup(
      <BusinessProfile business={business} accountCta={{ label: 'Ingresar', href: '/ingresar?next=%2Fir%2Fsalon-ana' }} />,
    )
    expect(html).toContain('Ingresar')
    expect(html).toContain('/ingresar?next=%2Fir%2Fsalon-ana')
  })

  it('logueada: link Mi cuenta', () => {
    const html = renderToStaticMarkup(
      <BusinessProfile business={business} accountCta={{ label: 'Mi cuenta', href: '/mi/salon-ana' }} />,
    )
    expect(html).toContain('Mi cuenta')
    expect(html).toContain('/mi/salon-ana')
  })
})
```

(El `declare const business` es un marcador de INSTRUCCIÓN: sustitúyelo por un fixture real leyendo el tipo `PublicBusiness` en `src/lib/business/public.ts` — el test debe compilar y correr.)

- [ ] **Step 2: FAIL → Step 3: `business-profile.tsx`** — prop opcional + link arriba a la derecha, dentro del contenedor existente, antes de la primera `<section>`:

```tsx
interface BusinessProfileProps {
  business: PublicBusiness
  bookingHref?: string
  accountCta?: { label: 'Ingresar' | 'Mi cuenta'; href: string }
}

export function BusinessProfile({ business, bookingHref = `/book/${business.slug}`, accountCta }: BusinessProfileProps) {
  // ...
      <div className="mx-auto max-w-[420px] px-4 py-12">
        {accountCta && (
          <p className="-mt-6 mb-4 text-right">
            <Link href={accountCta.href} className="text-sm font-semibold text-primary hover:underline">
              {accountCta.label}
            </Link>
          </p>
        )}
        <section className="mb-10 text-center">
```

- [ ] **Step 4: Pages.** En `src/app/page.tsx` (branch tenant con business):

```tsx
import { getFunnelSession } from '@/lib/customers/session-prefill'
// ...
    if (business) {
      const session = await getFunnelSession(business.id)
      const accountCta = session
        ? { label: 'Mi cuenta' as const, href: session.hasCustomer ? `/mi/${business.slug}` : '/mi' }
        : { label: 'Ingresar' as const, href: `/ingresar?next=${encodeURIComponent(`/ir/${business.slug}`)}` }
      return <BusinessProfile business={business} bookingHref="/book" accountCta={accountCta} />
    }
```

Igual en `src/app/b/[slug]/page.tsx` en su branch de render directo (verifica que `PublicBusiness` trae `id` — lo trae si `getPublicBusinessBySubdomain` lo selecciona; si no, agrégalo al select y reporta). La landing marketing (sin tenant) NO cambia.

- [ ] **Step 5: PASS + suite + tsc → Commit**

```bash
git add src/components/public/business-profile.tsx src/app/page.tsx "src/app/b/[slug]/page.tsx" tests/unit/business-profile-account-cta.test.tsx
git commit -m "feat(funnel-cta): link Ingresar/Mi cuenta en la landing del negocio"
```

---

### Task 8: CTA post-reserva en StepConfirmation

**Files:**
- Modify: `src/components/booking/step-confirmation.tsx`
- Modify: `src/components/booking/wizard.tsx` (threading de `sessionEmail`)
- Test: `tests/unit/step-confirmation-account-cta.test.tsx`

**Reglas (spec §5):** sin sesión Y la reserva tiene email → CTA "crea tu cuenta" con copy que pide usar el mismo email; sin email → NADA; con sesión → "Ver mis reservas" → `/mi` (home, nunca 404ea).

- [ ] **Step 1: Tests** (4 combinaciones):

```tsx
// tests/unit/step-confirmation-account-cta.test.tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StepConfirmation } from '@/components/booking/step-confirmation'
import type { BookingData } from '@/components/booking/wizard'

const base: BookingData = {
  serviceId: 's1', serviceName: 'Manicure', servicePrice: 20000, serviceDuration: 60,
  serviceDeposit: 0, serviceColor: '', date: null,
  timeSlot: { start: new Date('2026-07-20T15:00:00Z'), end: new Date('2026-07-20T16:00:00Z') },
  customerName: 'Maria', customerPhone: '+56911111111', customerEmail: 'maria@example.com',
  customerNotes: '', idempotencyKey: null,
}
const props = { timezone: 'America/Santiago', bookingId: 'b1', bookingNumber: 4738, mode: 'paid' as const }

describe('StepConfirmation — CTA de cuenta', () => {
  it('sin sesión + con email: invita a crear cuenta con ese email', () => {
    const html = renderToStaticMarkup(<StepConfirmation {...props} data={base} sessionEmail={null} />)
    expect(html).toContain('Crea tu cuenta')
    expect(html).toContain('maria@example.com')
    expect(html).toContain('/ingresar?next=/mi')
  })

  it('sin sesión + sin email: NO muestra el CTA (evita el /mi vacío)', () => {
    const html = renderToStaticMarkup(
      <StepConfirmation {...props} data={{ ...base, customerEmail: '' }} sessionEmail={null} />,
    )
    expect(html).not.toContain('Crea tu cuenta')
    expect(html).not.toContain('/ingresar')
  })

  it('con sesión: "Ver mis reservas" hacia /mi (home)', () => {
    const html = renderToStaticMarkup(<StepConfirmation {...props} data={base} sessionEmail="maria@example.com" />)
    expect(html).toContain('Ver mis reservas')
    expect(html).toContain('href="/mi"')
    expect(html).not.toContain('Crea tu cuenta')
  })
})
```

- [ ] **Step 2: FAIL → Step 3: Implementation** — firma: agregar `sessionEmail: string | null` a las props de `StepConfirmation`. Bloque JSX entre el `<p>` del número de reserva y el botón "Volver al inicio":

```tsx
      {sessionEmail === null && data.customerEmail && (
        <div className="mb-6 rounded-2xl border border-primary/25 bg-secondary/40 p-4 text-sm text-primary">
          <p className="mb-2">
            ¿Quieres ver y gestionar esta reserva? Crea tu cuenta ingresando con{' '}
            <span className="font-semibold">{data.customerEmail}</span> (el mismo email de la reserva).
          </p>
          <Link href="/ingresar?next=/mi" className="font-semibold underline">Crear mi cuenta</Link>
        </div>
      )}
      {sessionEmail !== null && (
        <p className="mb-6 text-sm">
          <Link href="/mi" className="font-semibold text-primary underline">Ver mis reservas</Link>
        </p>
      )}
```

En `wizard.tsx`, el render del paso 6 pasa la prop: `<StepConfirmation ... sessionEmail={session?.email ?? null} />`.

- [ ] **Step 4: PASS + suite + tsc → Step 5: Commit**

```bash
git add src/components/booking/step-confirmation.tsx src/components/booking/wizard.tsx tests/unit/step-confirmation-account-cta.test.tsx
git commit -m "feat(funnel-cta): CTA de cuenta post-reserva en la confirmación del wizard"
```

---

### Task 9: CTA condicional en `/book/confirmation`

**Files:**
- Modify: `src/app/book/confirmation/page.tsx`
- Test: `tests/unit/book-confirmation-account-cta.test.tsx` (o amplía el test existente de esa page — busca `book/confirmation` o `confirmation` en tests/unit y sigue su patrón de mocks)

**Reglas:** mismo CTA que Task 8 PERO solo cuando **no hay acción de transferencia pendiente** (`canDeclare === false`). Con sesión → "Ver mis reservas" → `/mi`.

- [ ] **Step 1:** LEE `src/app/book/confirmation/page.tsx` completo: identifica cómo se calcula `canDeclare` (~líneas 60-65), dónde carga el booking (agrega `customer: { select: { email: true } }` al select si no está) y el bloque de botones (~líneas 214-236). Lee el test existente de la page si hay, y copia su esqueleto de mocks (prisma, tenant, searchParams).

- [ ] **Step 2: Tests** — casos:
1. Estado `confirmed`, sin sesión, booking con email de customer → aparece "Crear mi cuenta" con `/ingresar?next=/mi`.
2. Estado con `canDeclare === true` (transfer pendiente con hold vivo) → NO aparece ningún CTA de cuenta (aunque haya email).
3. Sin email de customer → no aparece.
4. Con sesión (mock `getCurrentUser` → user) → "Ver mis reservas" → `/mi`.

- [ ] **Step 3: Implementation** — en la page:

```tsx
import { getCurrentUser } from '@/lib/auth/user'
// ... tras derivar state/canDeclare:
  const sessionUser = await getCurrentUser()
  const customerEmail = booking.customer?.email ?? null
  const showAccountCta = !canDeclare
```

y en el JSX, junto a los botones existentes (después de ellos, mismo contenedor):

```tsx
      {showAccountCta && sessionUser === null && customerEmail && (
        <div className="mt-4 rounded-2xl border border-primary/25 bg-secondary/40 p-4 text-sm text-primary">
          <p className="mb-2">
            ¿Quieres ver y gestionar esta reserva? Crea tu cuenta ingresando con{' '}
            <span className="font-semibold">{customerEmail}</span> (el mismo email de la reserva).
          </p>
          <Link href="/ingresar?next=/mi" className="font-semibold underline">Crear mi cuenta</Link>
        </div>
      )}
      {showAccountCta && sessionUser !== null && (
        <p className="mt-4 text-sm">
          <Link href="/mi" className="font-semibold text-primary underline">Ver mis reservas</Link>
        </p>
      )}
```

(Ajusta nombres de variables a los reales de la page — `canDeclare`/`state` pueden llamarse distinto; el criterio es del spec: nada de CTA cuando la acción primaria es declarar la transferencia.)

- [ ] **Step 4: PASS + suite + tsc → Step 5: Commit**

```bash
git add src/app/book/confirmation/page.tsx tests/unit/book-confirmation-account-cta.test.tsx
git commit -m "feat(funnel-cta): CTA de cuenta en /book/confirmation sin competir con transferencias"
```

---

### Task 10: Gate final

- [ ] Suite completa: `npx vitest run tests/unit/ 2>&1 | tail -3` → verde (≈1430+).
- [ ] `npx prisma generate && npx tsc --noEmit | grep '^src/'` → CERO errores.
- [ ] `npx eslint` sobre todos los archivos tocados → limpio.
- [ ] `/simplify` sobre el diff de la rama (4 ángulos). Candidato conocido: el bloque de CTA "Crear mi cuenta" duplicado entre `step-confirmation.tsx` y `book/confirmation/page.tsx` — evaluar extraer un componente `AccountCta` compartido si el diff lo amerita.
- [ ] Code review (5 finders + verificación): focos (a) ¿el redirector puede redirigir a un host controlado por input? (no debe: solo DB), (b) ¿`sanitizeNext`/`signOut` intactos?, (c) ¿el prefill filtra datos de OTRO usuario en algún camino? (el helper solo lee la Customer del propio `userId`), (d) ¿el CTA aparece sobre estados de transferencia?, (e) ¿la restauración puede resucitar un servicio inactivo o estado viejo?
- [ ] Verificación funcional local (skill verify si aplica): `npm run dev` + recorrer el funnel guest → banner → (sin OAuth real local) simular retorno con `?continuar=1` y storage sembrado.
- [ ] PR contra main (sin migración). Merge SOLO con OK explícito del usuario.

---

## Self-review (hecho al escribir el plan)

- **Cobertura del spec:** §1 lectura de sesión (T2, T6, T7) ✓ · verificación de caching (T6 paso 3) ✓ · §2 redirector (T3) ✓ · §3 banner + guardado/restauración + prefill + No soy yo (T1, T4, T5) ✓ · §4 landing (T7) ✓ · §5 post-reserva en ambas superficies con guard de transferencia y de email (T8, T9) ✓ · §6 copy consistente (T4/7/8/9 usan "Ingresar"/"Mi cuenta") ✓ · bordes (TTL/corrupto/servicio inactivo T1; slug 404 T3; sesión sin User row: `getFunnelSession` no depende de la fila Prisma User) ✓.
- **Tipos consistentes:** `FunnelSession {email,name,phone,hasCustomer}` (T2) → pages pasan `{email,name,phone}` al wizard (T5/T6) y usan `hasCustomer` solo en la landing (T7) · `serializeWizardState(data, now?) → string|null` y `restoreWizardState(raw, services, now?) → BookingData|null` (T1) usados así en T5 · `accountCta {label,href}` (T7) · `sessionEmail: string|null` en StepCustomer (T4) y StepConfirmation (T8).
- **Sin placeholders:** los tres puntos de verificación contra código vecino (campos de Service en T1, `BookingBusiness.slug` en T5, nombres reales de `canDeclare` en T9, fixture PublicBusiness en T7) están marcados como instrucciones de verificación explícitas con qué mirar y qué reportar.
