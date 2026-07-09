# Tablas del dashboard — PR3 (tablas internas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar las últimas 4 tablas (Billing, Admin lista de negocios, Admin detalle de negocio ×2, Redemptions) al patrón unificado de `docs/superpowers/specs/2026-07-09-unified-dashboard-tables-design.md`, y borrar el componente `BookingCard` muerto. Cierra la iniciativa de 3 PRs.

**Architecture:** Mismo patrón que PR1/PR2 — `<TableMobileCard>` en `lg:hidden` + `<Table fixed>` + `TruncatedCell`/`StatusBadge`/`TABLE_COL` en `hidden lg:block`. Todas las tablas de este PR son **read-only** (sin `TableActions`), excepto la lista de negocios de Admin que conserva su único link "Ver detalle" (sin kebab, ya que no hay acciones secundarias). Se agrega un mapa `subscription` a `StatusBadge` porque el status de suscripción (trialing/active/past_due/suspended/cancelled) hoy se colorea de forma distinta y con distinta fidelidad en `admin/page.tsx` (3 buckets, con pérdida de información) y `billing/page.tsx` (5 colores reales, local) — se unifica en una sola fuente con los 5 estados reales.

**Tech Stack:** Next.js App Router (Server Components), React 19, Tailwind, vitest + `renderToStaticMarkup`.

---

## Contexto para quien ejecute este plan

- Primitivas ya existen en `src/components/ui/`: `table.tsx` (`fixed` prop), `truncated-cell.tsx`, `status-badge.tsx`, `table-mobile-card.tsx`, `table-widths.ts`. **No las modifiques salvo lo indicado en Task 1.**
- Patrón de referencia ya migrado: [`src/components/dashboard/ledger-table.tsx`](../../../src/components/dashboard/ledger-table.tsx) (tabla read-only simple) y las dos tablas de [`src/app/dashboard/customers/[id]/page.tsx`](../../../src/app/dashboard/customers/[id]/page.tsx) (bookings + payments, mismo tipo de dato que este PR toca). Cópialas de referencia para el marcado exacto (`lg:hidden` cards, `hidden lg:block` tabla, `whitespace-normal` en montos).
- Tests con `renderToStaticMarkup` de `react-dom/server` + `vi.mock('next/navigation', ...)`. Los diálogos/menús de Radix no renderizan contenido en `renderToStaticMarkup` (no aplica aquí, ninguna tabla de este PR usa `TableActions`).
- Todas las tablas van bajo `min-width` con el wrapper `overflow-x-auto` existente como red de seguridad — no lo quites.
- Corre `npm test` (o el runner de vitest del proyecto) después de cada tarea.

## File Structure

- Modify: `src/components/ui/status-badge.tsx` — agrega mapa `subscription`.
- Modify: `src/app/dashboard/billing/page.tsx` — tabla "Historial de pagos" → patrón unificado.
- Modify: `src/app/admin/page.tsx` — tabla de negocios → patrón unificado + mapa `subscription`.
- Modify: `src/app/admin/businesses/[businessId]/page.tsx` — tablas "Reservas recientes" y "Pagos recientes" → patrón unificado.
- Modify: `src/app/dashboard/promociones/redemptions-button.tsx` — tabla del diálogo → `fixed` + anchos + `TruncatedCell` + `StatusBadge` + variante móvil.
- Modify: `src/components/dashboard/booking-card.tsx` — borra el componente `BookingCard` muerto y todo lo que solo él usaba; conserva el tipo `CalendarBooking`.
- Test: `tests/unit/status-badge-maps.test.tsx` — agrega caso `subscription`.
- Test: `tests/unit/billing-page.test.tsx` (nuevo).
- Test: `tests/unit/admin-businesses-page.test.tsx` (nuevo).
- Test: `tests/unit/admin-business-detail-page.test.tsx` (nuevo).
- Test: `tests/unit/redemptions-button.test.tsx` (nuevo).

---

### Task 1: Mapa `subscription` en StatusBadge

**Files:**
- Modify: `src/components/ui/status-badge.tsx`
- Test: `tests/unit/status-badge-maps.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `describe('StatusBadge domain maps', ...)` en `tests/unit/status-badge-maps.test.tsx`:

```tsx
  it('subscription map: 5 estados reales (no bucketing)', () => {
    expect(renderToStaticMarkup(<StatusBadge map="subscription" status="trialing" />)).toContain('En prueba')
    expect(renderToStaticMarkup(<StatusBadge map="subscription" status="past_due" />)).toContain('Pago pendiente')
  })
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/status-badge-maps.test.tsx`
Expected: FAIL — `map: 'subscription'` no existe en `STATUS_MAPS`.

- [ ] **Step 3: Agregar el mapa**

En `src/components/ui/status-badge.tsx`, agregar después de `DIRECTION_STATUS` (antes de `export const STATUS_MAPS`):

```ts
// Mismos 5 estados que `getSubscriptionStatusLabel` en
// src/lib/subscriptions/enforcement.ts (labels ahí son la fuente canónica;
// este mapa solo agrega color). Reemplaza el bucketing de 3 colores de
// admin/page.tsx y el mapa local de billing/page.tsx.
const SUBSCRIPTION_STATUS: Record<string, StatusEntry> = {
  trialing: { label: 'En prueba', className: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300' },
  active: { label: 'Activo', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  past_due: { label: 'Pago pendiente', className: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  suspended: { label: 'Suspendido', className: 'bg-destructive/10 text-destructive dark:bg-destructive/20' },
  cancelled: { label: 'Cancelado', className: 'bg-muted text-muted-foreground' },
}
```

Y agregar la key al objeto `STATUS_MAPS`:

```ts
export const STATUS_MAPS = {
  booking: BOOKING_STATUS,
  service: SERVICE_STATUS,
  review: REVIEW_STATUS,
  payment: PAYMENT_STATUS,
  promo: PROMO_STATUS,
  direction: DIRECTION_STATUS,
  subscription: SUBSCRIPTION_STATUS,
} as const
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/status-badge-maps.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/status-badge.tsx tests/unit/status-badge-maps.test.tsx
git commit -m "feat: add subscription status map to StatusBadge"
```

---

### Task 2: Migrar tabla de Billing

**Files:**
- Modify: `src/app/dashboard/billing/page.tsx`
- Test: `tests/unit/billing-page.test.tsx` (nuevo)

**Contexto:** Solo se toca la tabla "Historial de pagos" (líneas ~136-182 del archivo actual). El resto de la página (badge de estado de suscripción arriba, tarjetas de "Instrucciones de pago", avisos de trial/past_due/suspended) queda igual — no son tablas, fuera de alcance de este PR. `payment.status` en este dominio usa los mismos valores que `map="payment"` (`approved`, y lo demás cae a pendiente/otro).

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/billing-page.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockGetCurrentUserWithBusiness = vi.hoisted(() => vi.fn())
const mockGetCurrentSubscription = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/user', () => ({
  getCurrentUserWithBusiness: mockGetCurrentUserWithBusiness,
}))

vi.mock('@/server/actions/subscriptions', () => ({
  getCurrentSubscription: mockGetCurrentSubscription,
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCurrentUserWithBusiness.mockResolvedValue({
      user: { id: 'user-1' },
      business: { subscriptionStatus: 'active' },
    })
    mockGetCurrentSubscription.mockResolvedValue({
      subscription: {
        status: 'active',
        plan: { name: 'Plan Pro', priceMonthly: 19990, priceYearly: 0 },
        trialStartAt: null,
        trialEndAt: null,
        currentPeriodStart: new Date('2026-07-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
        interval: 'monthly',
      },
      payments: [
        {
          id: 'pay-1',
          amount: 19990,
          paymentMethod: 'Transferencia',
          status: 'approved',
          notes: null,
          paidAt: new Date('2026-07-01T00:00:00Z'),
          createdAt: new Date('2026-07-01T00:00:00Z'),
        },
      ],
    })
  })

  it('renders the payment history row with a StatusBadge and no raw <table>', async () => {
    const { default: BillingPage } = await import('@/app/dashboard/billing/page')

    const html = renderToStaticMarkup(await BillingPage())

    expect(html).toContain('Transferencia')
    expect(html).toContain('$19.990')
    expect(html).toContain('Aprobado')
    expect(html).not.toContain('<table')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/billing-page.test.tsx`
Expected: FAIL — `expect(html).not.toContain('<table')` falla porque hoy usa `<table>` cruda.

- [ ] **Step 3: Migrar la tabla**

En `src/app/dashboard/billing/page.tsx`, agregar imports (junto a los existentes):

```ts
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
```

Reemplazar el bloque `<div className="overflow-x-auto"><table>...</table></div>` (dentro de `{payments.length > 0 && (...)}`) por:

```tsx
                  <>
                    {/* Mobile: cards */}
                    <div className="space-y-3 lg:hidden">
                      {payments.map((payment) => (
                        <TableMobileCard
                          key={payment.id}
                          title={`$${payment.amount.toLocaleString('es-CL')}`}
                          subtitle={payment.paymentMethod ?? '—'}
                          badge={<StatusBadge map="payment" status={payment.status} />}
                          rows={[
                            {
                              label: 'Fecha',
                              value: (payment.paidAt ?? payment.createdAt).toLocaleDateString('es-CL'),
                            },
                            { label: 'Notas', value: payment.notes ?? '—' },
                          ]}
                        />
                      ))}
                    </div>

                    {/* Desktop: table */}
                    <div className="hidden lg:block studio-card overflow-hidden">
                      <Table fixed className={TABLE_MIN_WIDTH}>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead className={TABLE_COL.date}>Fecha</TableHead>
                            <TableHead className={TABLE_COL.money}>Monto</TableHead>
                            <TableHead className={TABLE_COL.label}>Método</TableHead>
                            <TableHead className={TABLE_COL.status}>Estado</TableHead>
                            <TableHead>Notas</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {payments.map((payment) => (
                            <TableRow key={payment.id}>
                              <TableCell className={TABLE_COL.date}>
                                {(payment.paidAt ?? payment.createdAt).toLocaleDateString('es-CL')}
                              </TableCell>
                              <TableCell className={`${TABLE_COL.money} whitespace-normal font-semibold`}>
                                ${payment.amount.toLocaleString('es-CL')}
                              </TableCell>
                              <TableCell className={`${TABLE_COL.label} text-muted-foreground`}>
                                {payment.paymentMethod ?? '—'}
                              </TableCell>
                              <TableCell className={TABLE_COL.status}>
                                <StatusBadge map="payment" status={payment.status} />
                              </TableCell>
                              <TruncatedCell className="text-muted-foreground" primary={payment.notes ?? '—'} />
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
```

Nota: la card `<CardContent>` que envolvía el `overflow-x-auto` original ahora envuelve directamente este fragmento — no dupliques el wrapper.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/billing-page.test.tsx`
Expected: PASS

- [ ] **Step 5: Correr toda la suite para descartar regresiones**

Run: `npx vitest run`
Expected: todo verde.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/billing/page.tsx tests/unit/billing-page.test.tsx
git commit -m "refactor: migrate billing payment history table to unified pattern"
```

---

### Task 3: Migrar tabla de negocios en Admin

**Files:**
- Modify: `src/app/admin/page.tsx`
- Test: `tests/unit/admin-businesses-page.test.tsx` (nuevo)

**Contexto:** Única columna de acción es el link "Ver detalle" — un solo botón, sin secundarias, así que **no usa `TableActions`** (design.md: "Con primaria sin secundarias → solo el botón"). Se reemplaza el badge de 3 colores por `<StatusBadge map="subscription" status={status} />`, que ya trae label correcta (no hace falta `getSubscriptionStatusLabel` acá, el mapa la incluye) — se puede borrar el import de `getSubscriptionStatusLabel` si queda sin uso en este archivo. Columna flexible = "Negocio" (nombre). El resto lleva ancho fijo.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/admin-businesses-page.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockPrisma = { business: { findMany: vi.fn() } }

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

vi.mock('@/lib/auth/user', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' }),
}))

vi.mock('@/lib/auth/platform-admin', () => ({
  isPlatformAdmin: vi.fn().mockReturnValue(true),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

describe('AdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.business.findMany.mockResolvedValue([
      {
        id: 'biz-1',
        name: 'Salón Luna',
        slug: 'salon-luna',
        subdomain: null,
        subscriptionStatus: 'past_due',
        plan: { name: 'Plan Pro' },
        _count: { bookings: 12, payments: 3 },
      },
    ])
  })

  it('renders the past_due business with its real status label and no raw <table>', async () => {
    const { default: AdminPage } = await import('@/app/admin/page')

    const html = renderToStaticMarkup(await AdminPage())

    expect(html).toContain('Salón Luna')
    expect(html).toContain('Pago pendiente')
    expect(html).toContain('Ver detalle')
    expect(html).not.toContain('<table')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/admin-businesses-page.test.tsx`
Expected: FAIL — usa `<table>` cruda hoy.

- [ ] **Step 3: Migrar la tabla**

En `src/app/admin/page.tsx`, agregar imports:

```ts
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
```

Quitar el import ahora sin uso `Building2, CircleAlert, CircleCheck` de `lucide-react` si dejan de usarse (revisar tras el reemplazo — `Building2` se sigue usando en la card del nombre si se conserva el ícono; si no, bórralo) y `getSubscriptionStatusLabel` si queda sin referencias.

Reemplazar el bloque `<div className="rounded-xl border border-border bg-card"><div className="overflow-x-auto"><table>...</table></div></div>` por:

```tsx
      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {businesses.map((business) => (
          <TableMobileCard
            key={business.id}
            title={business.name}
            subtitle={getBusinessPublicUrl({ slug: business.slug, subdomain: business.subdomain })}
            badge={<StatusBadge map="subscription" status={business.subscriptionStatus} />}
            rows={[
              { label: 'Plan', value: business.plan?.name ?? '—' },
              { label: 'Reservas', value: business._count.bookings },
            ]}
            actions={
              <Link
                href={`/admin/businesses/${business.id}`}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Ver detalle
              </Link>
            }
          />
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden lg:block studio-card overflow-hidden">
        <Table fixed className={TABLE_MIN_WIDTH}>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Negocio</TableHead>
              <TableHead className={TABLE_COL.contact}>Subdominio</TableHead>
              <TableHead className={TABLE_COL.label}>Plan</TableHead>
              <TableHead className={TABLE_COL.status}>Estado</TableHead>
              <TableHead className={TABLE_COL.count}>Reservas</TableHead>
              <TableHead className={TABLE_COL.actions}>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {businesses.map((business) => (
              <TableRow key={business.id}>
                <TruncatedCell className="font-semibold text-primary" primary={business.name} />
                <TruncatedCell
                  className={`${TABLE_COL.contact} text-muted-foreground`}
                  primary={getBusinessPublicUrl({ slug: business.slug, subdomain: business.subdomain })}
                />
                <TableCell className={`${TABLE_COL.label} text-muted-foreground`}>
                  {business.plan?.name ?? '—'}
                </TableCell>
                <TableCell className={TABLE_COL.status}>
                  <StatusBadge map="subscription" status={business.subscriptionStatus} />
                </TableCell>
                <TableCell className={`${TABLE_COL.count} text-muted-foreground`}>
                  {business._count.bookings}
                </TableCell>
                <TableCell className={TABLE_COL.actions}>
                  <Link
                    href={`/admin/businesses/${business.id}`}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Ver detalle
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/admin-businesses-page.test.tsx`
Expected: PASS

- [ ] **Step 5: Correr toda la suite**

Run: `npx vitest run`
Expected: todo verde. Si `Building2`/`CircleAlert`/`CircleCheck` quedaron importados sin uso, el lint (`npm run lint` si existe) lo marca — bórralos.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/page.tsx tests/unit/admin-businesses-page.test.tsx
git commit -m "refactor: migrate admin businesses table to unified pattern"
```

---

### Task 4: Migrar tablas de detalle de negocio en Admin

**Files:**
- Modify: `src/app/admin/businesses/[businessId]/page.tsx`
- Test: `tests/unit/admin-business-detail-page.test.tsx` (nuevo)

**Contexto:** Dos tablas read-only: "Reservas recientes" (agrega `StatusBadge map="booking"` donde hoy muestra `{booking.status}` en texto plano) y "Pagos recientes" (sin cambio de columnas, solo migración de marcado). La tabla de "Bitácora de cambios" es una lista de tarjetas, no una `<table>` — fuera de alcance.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/admin-business-detail-page.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockPrisma = {
  business: { findUnique: vi.fn() },
  plan: { findMany: vi.fn() },
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

vi.mock('@/lib/auth/user', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' }),
}))

vi.mock('@/lib/auth/platform-admin', () => ({
  isPlatformAdmin: vi.fn().mockReturnValue(true),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('@/app/admin/businesses/[businessId]/admin-actions', () => ({
  AdminActions: () => <div>admin actions</div>,
}))

vi.mock('@/app/admin/businesses/[businessId]/copy-link-button', () => ({
  CopyLinkButton: () => <button>copiar</button>,
}))

describe('BusinessDetailPage (admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.plan.findMany.mockResolvedValue([])
    mockPrisma.business.findUnique.mockResolvedValue({
      id: 'biz-1',
      name: 'Salón Luna',
      slug: 'salon-luna',
      subdomain: null,
      city: 'Santiago',
      currency: 'CLP',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      trialEndsAt: null,
      subscriptionStatus: 'active',
      plan: { name: 'Plan Pro' },
      subscriptions: [],
      services: [],
      bookings: [
        {
          id: 'bk-1',
          status: 'confirmed',
          startDateTime: new Date('2026-07-05T14:00:00Z'),
          finalAmount: 15000,
          service: { name: 'Corte' },
          customer: { name: 'Maria Perez' },
        },
      ],
      payments: [
        {
          id: 'pay-1',
          createdAt: new Date('2026-07-01T00:00:00Z'),
          paymentType: 'subscription',
          provider: 'manual',
          amount: 19990,
        },
      ],
      subscriptionLogs: [],
      _count: { bookings: 1, customers: 1, payments: 1 },
    })
  })

  it('renders the booking row with a StatusBadge and no raw <table>', async () => {
    const { default: BusinessDetailPage } = await import('@/app/admin/businesses/[businessId]/page')

    const html = renderToStaticMarkup(
      await BusinessDetailPage({ params: Promise.resolve({ businessId: 'biz-1' }) })
    )

    expect(html).toContain('Maria Perez')
    expect(html).toContain('Confirmada')
    expect(html).toContain('$19.990')
    expect(html).not.toContain('<table')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/admin-business-detail-page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Migrar las dos tablas**

En `src/app/admin/businesses/[businessId]/page.tsx`, agregar imports:

```ts
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
```

Reemplazar el bloque de "Reservas recientes" (el `<div className="overflow-x-auto"><table>...</table></div>` dentro del primer `<Card>`) por:

```tsx
                <>
                  {/* Mobile: cards */}
                  <div className="space-y-3 lg:hidden">
                    {business.bookings.map((booking) => (
                      <TableMobileCard
                        key={booking.id}
                        title={booking.customer?.name ?? '—'}
                        subtitle={booking.service?.name ?? '—'}
                        badge={<StatusBadge map="booking" status={booking.status} />}
                        rows={[
                          { label: 'Fecha', value: booking.startDateTime.toLocaleDateString('es-CL') },
                          { label: 'Total', value: `$${booking.finalAmount.toLocaleString('es-CL')}` },
                        ]}
                      />
                    ))}
                  </div>

                  {/* Desktop: table */}
                  <div className="hidden lg:block studio-card overflow-hidden">
                    <Table fixed className={TABLE_MIN_WIDTH}>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Cliente</TableHead>
                          <TableHead className={TABLE_COL.label}>Servicio</TableHead>
                          <TableHead className={TABLE_COL.date}>Fecha</TableHead>
                          <TableHead className={TABLE_COL.status}>Estado</TableHead>
                          <TableHead className={TABLE_COL.money}>Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {business.bookings.map((booking) => (
                          <TableRow key={booking.id}>
                            <TruncatedCell className="text-primary" primary={booking.customer?.name ?? '—'} />
                            <TruncatedCell
                              className={`${TABLE_COL.label} text-muted-foreground`}
                              primary={booking.service?.name ?? '—'}
                            />
                            <TableCell className={`${TABLE_COL.date} text-muted-foreground`}>
                              {booking.startDateTime.toLocaleDateString('es-CL')}
                            </TableCell>
                            <TableCell className={TABLE_COL.status}>
                              <StatusBadge map="booking" status={booking.status} />
                            </TableCell>
                            <TableCell className={`${TABLE_COL.money} whitespace-normal text-primary`}>
                              ${booking.finalAmount.toLocaleString('es-CL')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
```

Reemplazar el bloque de "Pagos recientes" por:

```tsx
                <>
                  {/* Mobile: cards */}
                  <div className="space-y-3 lg:hidden">
                    {business.payments.map((payment) => (
                      <TableMobileCard
                        key={payment.id}
                        title={`$${payment.amount.toLocaleString('es-CL')}`}
                        subtitle={payment.paymentType}
                        rows={[
                          { label: 'Fecha', value: payment.createdAt.toLocaleDateString('es-CL') },
                          { label: 'Proveedor', value: payment.provider },
                        ]}
                      />
                    ))}
                  </div>

                  {/* Desktop: table */}
                  <div className="hidden lg:block studio-card overflow-hidden">
                    <Table fixed className={TABLE_MIN_WIDTH}>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className={TABLE_COL.date}>Fecha</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead className={TABLE_COL.label}>Proveedor</TableHead>
                          <TableHead className={TABLE_COL.money}>Monto</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {business.payments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell className={`${TABLE_COL.date} text-muted-foreground`}>
                              {payment.createdAt.toLocaleDateString('es-CL')}
                            </TableCell>
                            <TruncatedCell className="text-primary" primary={payment.paymentType} />
                            <TableCell className={`${TABLE_COL.label} text-muted-foreground`}>
                              {payment.provider}
                            </TableCell>
                            <TableCell className={`${TABLE_COL.money} whitespace-normal text-primary`}>
                              ${payment.amount.toLocaleString('es-CL')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/admin-business-detail-page.test.tsx`
Expected: PASS

- [ ] **Step 5: Correr toda la suite**

Run: `npx vitest run`
Expected: todo verde.

- [ ] **Step 6: Commit**

```bash
git add "src/app/admin/businesses/[businessId]/page.tsx" tests/unit/admin-business-detail-page.test.tsx
git commit -m "refactor: migrate admin business detail tables to unified pattern"
```

---

### Task 5: Migrar tabla del diálogo de Redemptions

**Files:**
- Modify: `src/app/dashboard/promociones/redemptions-button.tsx`
- Test: `tests/unit/redemptions-button.test.tsx` (nuevo)

**Contexto:** Este componente ya usa `<Table>`/`<TableRow>`/`<TableCell>` (no `<table>` cruda), pero le falta `fixed` + anchos compartidos + `TruncatedCell` + `StatusBadge` (hoy usa un `<Badge>` con mapa de color local) + variante móvil — el diálogo es `sm:max-w-3xl`, en viewport angosto (<1024px, que incluye tablets en vertical) la tabla de 6 columnas igual aprieta. `map="review"` no aplica; se usa `map="payment"`... no, los estados son `applied`/`released`, dominio propio — no encaja en ningún `STATUS_MAPS` existente. Se agrega un mapa `redemption` nuevo, mismo mecanismo que Task 1.

- [ ] **Step 1: Agregar el mapa `redemption` a StatusBadge (con test)**

Agregar a `tests/unit/status-badge-maps.test.tsx`:

```tsx
  it('redemption map: applied/released', () => {
    expect(renderToStaticMarkup(<StatusBadge map="redemption" status="applied" />)).toContain('Aplicado')
    expect(renderToStaticMarkup(<StatusBadge map="redemption" status="released" />)).toContain('Liberado')
  })
```

Run: `npx vitest run tests/unit/status-badge-maps.test.tsx` → FAIL (mapa no existe).

En `src/components/ui/status-badge.tsx`, agregar tras `SUBSCRIPTION_STATUS`:

```ts
const REDEMPTION_STATUS: Record<string, StatusEntry> = {
  applied: { label: 'Aplicado', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  released: { label: 'Liberado', className: 'bg-muted text-muted-foreground' },
}
```

Y agregarlo a `STATUS_MAPS`:

```ts
export const STATUS_MAPS = {
  booking: BOOKING_STATUS,
  service: SERVICE_STATUS,
  review: REVIEW_STATUS,
  payment: PAYMENT_STATUS,
  promo: PROMO_STATUS,
  direction: DIRECTION_STATUS,
  subscription: SUBSCRIPTION_STATUS,
  redemption: REDEMPTION_STATUS,
} as const
```

Run: `npx vitest run tests/unit/status-badge-maps.test.tsx` → PASS.

- [ ] **Step 2: Escribir el test del componente que falla**

Crear `tests/unit/redemptions-button.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RedemptionsButton } from '@/app/dashboard/promociones/redemptions-button'

vi.mock('@/server/actions/promotions', () => ({
  getPromotionRedemptions: vi.fn(),
}))

describe('RedemptionsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the trigger without the dialog content (closed by default)', () => {
    const html = renderToStaticMarkup(
      <RedemptionsButton promotionId="promo-1" promotionName="Verano 2026" currency="CLP" />
    )

    expect(html).toContain('Ver canjes')
  })
})
```

Este test solo cubre el trigger cerrado (el contenido del diálogo vive en un portal de Radix, no renderiza en `renderToStaticMarkup` — mismo límite documentado para `TableActions` en el design doc). Sirve como regression test de que el archivo sigue compilando y exportando el trigger tras el refactor.

Run: `npx vitest run tests/unit/redemptions-button.test.tsx` → debería pasar ya (nada roto todavía); confirma que corre antes de tocar el archivo.

- [ ] **Step 3: Migrar la tabla dentro del diálogo**

En `src/app/dashboard/promociones/redemptions-button.tsx`:

1. Agregar imports:

```ts
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
```

2. Borrar las constantes locales `statusLabels` y `statusColors` (líneas 14-22) — las reemplaza el mapa `redemption`.

3. Reemplazar el bloque `<div className="studio-card overflow-hidden"><Table>...</Table></div>` (el `else` final del `rows && rows.length === 0 ? ... : (...)`) por:

```tsx
          <>
            {/* Mobile: cards */}
            <div className="space-y-3 lg:hidden">
              {rows?.map((r) => (
                <TableMobileCard
                  key={r.id}
                  title={r.customer?.name || '—'}
                  subtitle={formatDateTime(r.booking?.startDateTime ?? null)}
                  badge={<StatusBadge map="redemption" status={r.status} />}
                  rows={[
                    { label: 'Descuento', value: formatMoney(r.discountAmount, currency) },
                    { label: 'Fecha', value: formatDateTime(r.createdAt) },
                    { label: 'Origen', value: sourceLabels[r.source] ?? r.source },
                  ]}
                />
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden lg:block studio-card overflow-hidden">
              <Table fixed className={TABLE_MIN_WIDTH}>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Clienta</TableHead>
                    <TableHead className={TABLE_COL.date}>Reserva</TableHead>
                    <TableHead className={TABLE_COL.money}>Descuento</TableHead>
                    <TableHead className={TABLE_COL.date}>Fecha</TableHead>
                    <TableHead className={TABLE_COL.label}>Origen</TableHead>
                    <TableHead className={TABLE_COL.status}>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows?.map((r) => (
                    <TableRow key={r.id}>
                      <TruncatedCell className="font-semibold text-primary" primary={r.customer?.name || '—'} />
                      <TableCell className={`${TABLE_COL.date} text-sm`}>
                        {formatDateTime(r.booking?.startDateTime ?? null)}
                      </TableCell>
                      <TableCell className={`${TABLE_COL.money} whitespace-normal`}>
                        {formatMoney(r.discountAmount, currency)}
                      </TableCell>
                      <TableCell className={`${TABLE_COL.date} text-sm`}>{formatDateTime(r.createdAt)}</TableCell>
                      <TableCell className={`${TABLE_COL.label} text-sm`}>
                        {sourceLabels[r.source] ?? r.source}
                      </TableCell>
                      <TableCell className={TABLE_COL.status}>
                        <StatusBadge map="redemption" status={r.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
```

Nota: `Badge` import puede quedar sin uso — bórralo si es así (verificar que no se use en otra parte del archivo, ej. el trigger no lo usa).

- [ ] **Step 4: Correr el test y verificar que sigue pasando**

Run: `npx vitest run tests/unit/redemptions-button.test.tsx`
Expected: PASS (sigue exportando el trigger correctamente).

- [ ] **Step 5: Correr toda la suite**

Run: `npx vitest run`
Expected: todo verde.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/status-badge.tsx tests/unit/status-badge-maps.test.tsx \
  src/app/dashboard/promociones/redemptions-button.tsx tests/unit/redemptions-button.test.tsx
git commit -m "refactor: migrate promotion redemptions table to unified pattern"
```

---

### Task 6: Borrar el componente `BookingCard` muerto

**Files:**
- Modify: `src/components/dashboard/booking-card.tsx`

**Contexto:** `grep -rn "from '@/components/dashboard/booking-card'"` en todo `src/` solo devuelve import de tipo (`import type { CalendarBooking } from './booking-card'`, usado por `calendar-views.tsx` y `booking-drawer.tsx`). El componente `BookingCard` en sí no tiene ningún import — es código muerto desde que Reservas migró a su propia `BookingCard` local en `src/app/dashboard/bookings/page.tsx` (PR1). Se conserva **solo** el tipo `CalendarBooking`.

- [ ] **Step 1: Confirmar que sigue muerto (no se coló un uso nuevo)**

Run: `grep -rn "BookingCard" src --include="*.tsx" --include="*.ts" | grep -v "booking-card.tsx:"`
Expected: ningún resultado que importe `{ BookingCard }` (con o sin `type`) desde `@/components/dashboard/booking-card` — solo referencias a `CalendarBooking` o al `BookingCard` local de `bookings/page.tsx`.

- [ ] **Step 2: Reducir el archivo al tipo únicamente**

Reemplazar el contenido completo de `src/components/dashboard/booking-card.tsx` por:

```tsx
export type CalendarBooking = {
  id: string
  bookingNumber: number | null
  status: string
  startDateTime: string
  endDateTime: string
  service: { name: string } | null
  customer: { name: string; phone: string; email: string | null } | null
  totalPrice: number
  depositPaid: number
  depositRequired: number
  finalAmount: number
  remainingBalance: number
  paymentStatus: string
  customerNotes?: string | null
  internalNotes?: string | null
}
```

(Esto borra el componente `BookingCard`, `statusLabels`, `statusBadgeClasses`, y todos los imports que solo ellos usaban — `useState`, `useTransition`, `useRouter`, `formatInTimeZone`, `es`, `Button`, `Badge`, `BookingDrawer`, `updateBookingStatus`, los íconos de `lucide-react`, `CancelBookingButton`, `isManualPaymentAllowed`.)

- [ ] **Step 3: Correr toda la suite**

Run: `npx vitest run`
Expected: todo verde — `calendar-views.tsx` y `booking-drawer.tsx` siguen resolviendo `CalendarBooking` sin problema (es un `import type`, no depende del valor `BookingCard`).

- [ ] **Step 4: Build de TypeScript**

Run: `npx tsc --noEmit` (o el comando de typecheck del proyecto)
Expected: sin errores — nada más importaba `BookingCard` como valor.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/booking-card.tsx
git commit -m "chore: remove dead BookingCard component, keep CalendarBooking type"
```

---

## Verificación visual (manual, post-implementación)

jsdom no calcula layout — antes de cerrar el PR, verificar en el preview de Vercel:
- Billing: tabla de pagos no desborda a 1024px/1280px; en <1024px se ven cards.
- Admin (lista): badge de estado usa los 5 colores reales (no 3 buckets); "Ver detalle" funciona en card y tabla.
- Admin (detalle de negocio): las 2 tablas migradas no desbordan; bitácora de cambios (no tocada) sigue igual.
- Redemptions: abrir el diálogo desde Promociones → "Ver canjes", achicar el viewport del navegador a <1024px con el diálogo abierto y confirmar que muestra cards, no una tabla apretada dentro del modal.

## Fuera de alcance (YAGNI)

- Badges de estado de suscripción que NO están en una celda de tabla (el badge grande de arriba en `billing/page.tsx`, los badges de arriba en `admin/businesses/[businessId]/page.tsx`) — son decorativos, no tabulares; el design doc acota el alcance a tablas.
- Ordenamiento, paginación, o cambios de datos en cualquiera de las 4 tablas.
- Tocar `getSubscriptionStatusLabel` en `src/lib/subscriptions/enforcement.ts` — sigue siendo la fuente de las labels; `StatusBadge` solo le agrega color.
