# Tablas del dashboard — PR2: tablas dueña-facing + TableMobileCard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Migrar las 6 tablas dueña-facing restantes al patrón unificado de PR1 y construir la primitiva `<TableMobileCard>` que las tablas desktop-only necesitan para ser responsive.

**Architecture:** Reusa las primitivas de PR1 (`Table fixed`, `TruncatedCell`, `TableActions`, `StatusBadge`, `TABLE_COL`). Extiende `StatusBadge` con los mapas de estado que faltan (servicio, promo, review, pago, dirección). Añade `<TableMobileCard>` para la variante <1024px. El patrón de referencia YA implementado es la tabla de Reservas: [`src/app/dashboard/bookings/page.tsx`](../../../src/app/dashboard/bookings/page.tsx) y [`src/components/dashboard/booking-row-actions.tsx`](../../../src/components/dashboard/booking-row-actions.tsx). **Míralos antes de migrar cada tabla** — replican exactamente el uso de las primitivas.

**Tech Stack:** Next.js App Router, React 19, Tailwind, radix-ui, lucide-react, vitest + `renderToStaticMarkup`.

**Dependencia:** Este plan se apoya en las primitivas de PR1 (PR #56). Ejecutarlo DESPUÉS de que #56 esté mergeado a `main` (o crear la rama de PR2 a partir de la rama de #56). No empezar sobre `main` si #56 no está mergeado.

Referencias: spec `docs/superpowers/specs/2026-07-09-unified-dashboard-tables-design.md`; plan PR1 `docs/superpowers/plans/2026-07-09-unified-dashboard-tables-pr1.md`.

---

## Convenciones (de PR1, respetar)

- Tests desde el worktree: `npx vitest --run <archivo>`. Componente = `renderToStaticMarkup` + `vi.mock('next/navigation', ...)`. NO testing-library.
- `table-fixed`: **una sola** columna flexible (la principal, sin ancho) por tabla; las demás de texto llevan `w-[...]` de `TABLE_COL` o un `max-width`. **Montos NUNCA truncan** (`whitespace-normal` + ancho holgado).
- Regla de acciones: primaria visible + kebab; sin secundarias → solo botón; read-only → sin columna de acciones; nada de kebab vacío.
- **Landmine Radix:** cualquier `Dialog` que vaya al kebab se iza fuera del menú (props controladas `open`/`onOpenChange`/`hideTrigger` en el componente del diálogo + `onSelect={(e) => { e.preventDefault(); setOpen(true) }}` en el item). Ver `booking-row-actions.tsx` como referencia.
- Breakpoint tabla→card: `hidden lg:block` (tabla) + `lg:hidden` (cards). Migrar cualquier `md:` existente a `lg:`.
- `git add <archivos específicos>`, commit por tarea, `--no-verify` ok. No tocar el checkout principal.

---

## File Structure (PR2)

- Modify `src/components/ui/status-badge.tsx` — añadir mapas `service`, `promo`, `review`, `payment`, `direction`.
- Create `src/components/ui/table-mobile-card.tsx` — `<TableMobileCard>`.
- Modify `src/components/ui/table-widths.ts` — añadir anchos que falten (`code`, `count`, `rating`, etc.).
- Modify `src/components/dashboard/service-table.tsx` — migrar + izar el Dialog de desactivación.
- Modify `src/app/dashboard/customers/customer-list.tsx` — migrar; reusar `TableMobileCard`.
- Modify `src/app/dashboard/promociones/page.tsx` — migrar (Server Component; acciones vía sus componentes existentes).
- Modify `src/app/dashboard/reviews/reviews-client.tsx` — migrar (2 tablas: reviews + elegibles).
- Modify `src/app/dashboard/customers/[id]/page.tsx` — migrar 2 tablas (historial reservas + pagos).
- Modify `src/components/dashboard/ledger-table.tsx` — migrar (read-only).
- Tests: `tests/unit/status-badge-maps.test.tsx`, `tests/unit/table-mobile-card.test.tsx`.

---

### Task 1: Extender `StatusBadge` con los mapas que faltan

**Files:**
- Modify: `src/components/ui/status-badge.tsx`
- Test: `tests/unit/status-badge-maps.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/status-badge-maps.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { StatusBadge } from '@/components/ui/status-badge'

describe('StatusBadge domain maps', () => {
  it('service map: active/inactive', () => {
    expect(renderToStaticMarkup(<StatusBadge map="service" status="active" />)).toContain('Activo')
    expect(renderToStaticMarkup(<StatusBadge map="service" status="inactive" />)).toContain('Inactivo')
  })
  it('review map: pending/approved/hidden', () => {
    expect(renderToStaticMarkup(<StatusBadge map="review" status="approved" />)).toContain('Aprobada')
  })
  it('payment map: approved/rejected', () => {
    expect(renderToStaticMarkup(<StatusBadge map="payment" status="rejected" />)).toContain('Rechazado')
  })
  it('promo map: scheduled', () => {
    expect(renderToStaticMarkup(<StatusBadge map="promo" status="scheduled" />)).toContain('Programada')
  })
  it('direction map: expense', () => {
    expect(renderToStaticMarkup(<StatusBadge map="direction" status="expense" />)).toContain('Gasto')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest --run tests/unit/status-badge-maps.test.tsx`
Expected: FAIL (maps `service`/`review`/`payment`/`promo`/`direction` no existen).

- [ ] **Step 3: Implementar**

En `src/components/ui/status-badge.tsx`, añadir estos mapas y sumarlos a `STATUS_MAPS` (mantener el `booking` existente). Reusar las clases de color de los badges actuales de cada tabla (verificar contra el archivo fuente para no cambiar colores):

```tsx
const SERVICE_STATUS: Record<string, StatusEntry> = {
  active: { label: 'Activo', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  inactive: { label: 'Inactivo', className: 'bg-muted text-muted-foreground' },
}

const REVIEW_STATUS: Record<string, StatusEntry> = {
  pending: { label: 'Pendiente', className: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  approved: { label: 'Aprobada', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  hidden: { label: 'Oculta', className: 'bg-muted text-muted-foreground' },
}

const PAYMENT_STATUS: Record<string, StatusEntry> = {
  pending: { label: 'Pendiente', className: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  approved: { label: 'Aprobado', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  rejected: { label: 'Rechazado', className: 'bg-destructive/10 text-destructive dark:bg-destructive/20' },
  failed: { label: 'Fallido', className: 'bg-destructive/10 text-destructive dark:bg-destructive/20' },
  cancelled: { label: 'Cancelado', className: 'bg-muted text-muted-foreground' },
  refunded: { label: 'Reembolsado', className: 'bg-muted text-muted-foreground' },
}

const PROMO_STATUS: Record<string, StatusEntry> = {
  active: { label: 'Activa', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  scheduled: { label: 'Programada', className: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300' },
  expired: { label: 'Vencida', className: 'bg-muted text-muted-foreground' },
  depleted: { label: 'Agotada', className: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  inactive: { label: 'Inactiva', className: 'bg-muted text-muted-foreground' },
}

const DIRECTION_STATUS: Record<string, StatusEntry> = {
  income: { label: 'Ingreso', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  expense: { label: 'Gasto', className: 'bg-destructive/10 text-destructive dark:bg-destructive/20' },
  neutral: { label: 'Neutral', className: 'bg-muted text-muted-foreground' },
}

export const STATUS_MAPS = {
  booking: BOOKING_STATUS,
  service: SERVICE_STATUS,
  review: REVIEW_STATUS,
  payment: PAYMENT_STATUS,
  promo: PROMO_STATUS,
  direction: DIRECTION_STATUS,
} as const
```

**IMPORTANTE:** antes de fijar labels/keys, abrir cada tabla fuente y confirmar los valores reales de `status`/`state`/`direction`/`promo status` y las etiquetas actuales, para no cambiar el texto que ve la dueña ni romper keys. Si una key real difiere (p.ej. la promo usa otro string que `scheduled`), ajustar el mapa a la key real.

- [ ] **Step 4: Correr y verificar que pasa** — `npx vitest --run tests/unit/status-badge-maps.test.tsx` → PASS.
- [ ] **Step 5: Commit** — `git add src/components/ui/status-badge.tsx tests/unit/status-badge-maps.test.tsx && git commit -m "Add service/review/payment/promo/direction status maps"`

---

### Task 2: `<TableMobileCard>`

**Files:**
- Create: `src/components/ui/table-mobile-card.tsx`
- Test: `tests/unit/table-mobile-card.test.tsx`

Interfaz: una card con título (columna principal), subtítulo opcional, filas label/valor, un slot de badge de estado (arriba a la derecha) y un slot de acciones (abajo). Reusa el look de las cards móviles actuales (`booking-card`, `customer-list`).

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/table-mobile-card.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { TableMobileCard } from '@/components/ui/table-mobile-card'

describe('TableMobileCard', () => {
  it('renders title, subtitle, rows, badge and actions', () => {
    const html = renderToStaticMarkup(
      <TableMobileCard
        title="Manicura semipermanente"
        subtitle="#4738"
        badge={<span>Confirmada</span>}
        rows={[{ label: 'Fecha', value: '11 jul' }, { label: 'Pago', value: '$15.000' }]}
        actions={<button>Completar</button>}
      />,
    )
    expect(html).toContain('Manicura semipermanente')
    expect(html).toContain('#4738')
    expect(html).toContain('Confirmada')
    expect(html).toContain('Fecha')
    expect(html).toContain('$15.000')
    expect(html).toContain('Completar')
  })

  it('omits subtitle, badge and actions when not provided', () => {
    const html = renderToStaticMarkup(<TableMobileCard title="Solo título" rows={[]} />)
    expect(html).toContain('Solo título')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla** — Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

Crear `src/components/ui/table-mobile-card.tsx`:

```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export type TableMobileRow = { label: React.ReactNode; value: React.ReactNode }

export function TableMobileCard({
  title,
  subtitle,
  badge,
  rows,
  actions,
  className,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  badge?: React.ReactNode
  rows: TableMobileRow[]
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('studio-card overflow-hidden p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-primary">{title}</div>
          {subtitle != null && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {badge != null && <div className="shrink-0">{badge}</div>}
      </div>
      {rows.length > 0 && (
        <dl className="mt-3 space-y-1.5 text-sm">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 truncate text-right font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {actions != null && <div className="mt-3 flex flex-wrap justify-end gap-2">{actions}</div>}
    </div>
  )
}
```

Es una función pura (sin `'use client'`) → usable en Server Components. `studio-card` ya existe en `globals.css`.

- [ ] **Step 4: Correr y verificar que pasa** — PASS.
- [ ] **Step 5: Commit** — `git add src/components/ui/table-mobile-card.tsx tests/unit/table-mobile-card.test.tsx && git commit -m "Add shared TableMobileCard primitive"`

---

### Task 3: Anchos de columna que faltan

**Files:**
- Modify: `src/components/ui/table-widths.ts`

- [ ] **Step 1: Añadir claves a `TABLE_COL`** (solo las que no existan ya: `count`, `date`, `time`, `status`, `money`, `contact`, `actions`, `customer` ya existen de PR1):

```ts
  code: 'w-[120px]',
  rating: 'w-[104px]',
  duration: 'w-[104px]',
  uses: 'w-[92px]',
```

- [ ] **Step 2: Commit** — `git add src/components/ui/table-widths.ts && git commit -m "Add code/rating/duration/uses column widths"`

---

### Tasks 4–9: Migrar cada tabla (patrón común)

**Para CADA tabla abajo, seguir estos pasos (mismo patrón que la tabla de Reservas ya migrada — úsala de referencia):**

1. Envolver la tabla en `<Table fixed className={TABLE_MIN_WIDTH}>` dentro de su `studio-card overflow-hidden`, con wrapper `hidden lg:block`.
2. La columna principal (indicada por tabla) → `<TruncatedCell primary={...} secondary={...} />` **sin** ancho (única flex). Otras columnas de texto → `<TruncatedCell className={<width>} />`. Columnas atómicas → `<TableCell className={TABLE_COL.<x>}>`. Montos → `<TableCell>` con `whitespace-normal`, **sin** truncar.
3. Estados → `<StatusBadge map="<map>" status={<realStatus>} />` (usar los mapas de Task 1). Borrar los mapas de color/label locales.
4. Acciones → `<TableActions primary={...}>` + items en el kebab. Diálogos al kebab → izar (props controladas + `hideTrigger`). Read-only → sin columna de acciones.
5. Reemplazar/crear la variante móvil con `lg:hidden` + `<TableMobileCard>`; borrar variantes `md:hidden` duplicadas.
6. Eliminar helpers de truncado JS locales (`truncate()`, `.slice()`), `line-clamp-*`, `max-w-[Npx]` sueltos, y badges hardcodeados.
7. Verificar: `npx eslint <archivo>` limpio (borrar imports sin uso), `npx tsc --noEmit 2>&1 | grep <archivo>` sin salida, y correr cualquier test existente que toque el archivo. Commit por tabla.

**Cada tarea es DONE cuando:** eslint/tsc limpios en el archivo, tests existentes verdes, header y body con la misma cantidad de columnas, montos sin truncar, y la variante `lg:hidden` renderiza `TableMobileCard`.

---

### Task 4: Servicios — `src/components/dashboard/service-table.tsx` (Client)

- Columnas: `#` (`TABLE_COL.count`) · **Nombre** (principal flex, `TruncatedCell` con `secondary={service.description}`) · Precio (`TABLE_COL.money`, sin truncar) · Duración (`TABLE_COL.duration`) · Abono (`TABLE_COL.money`, sin truncar) · Color (ancho fijo chico, ej. `w-[64px]`) · Estado (`TABLE_COL.status`, `<StatusBadge map="service" status={service.isActive ? 'active' : 'inactive'} />`) · Acciones (`TABLE_COL.actions`).
- Acciones: primaria `Editar` (el `ServiceForm` existente como trigger visible); kebab: Activar/Desactivar, (Eliminar si existe). **El Dialog de confirmación de desactivación (líneas ~258-283) se iza**: dale props controladas `open`/`onOpenChange`/`hideTrigger` (patrón `CancelBookingButton`) y ábrelo desde un `DropdownMenuItem` con `onSelect` + `preventDefault`. Si la desactivación hoy es un botón directo con Dialog inline, extraer un pequeño componente cliente análogo a `BookingRowActions`.
- Móvil: nueva variante `lg:hidden` con `<TableMobileCard title={service.name} subtitle={service.description} badge={<StatusBadge map="service" .../>} rows={[Precio, Duración, Abono]} actions={...} />`.
- Commit: `"Migrate Servicios table to unified pattern"`.

### Task 5: Clientes — `src/app/dashboard/customers/customer-list.tsx` (Client)

- Columnas: **Nombre** (principal flex) · Contacto (`TruncatedCell` con `w-[180px]`, teléfono + email; borrar el `truncate(email,28)` JS) · Reservas (`TABLE_COL.count`, badge) · Última reserva (`TABLE_COL.date`) · Pagado (`TABLE_COL.money`, sin truncar) · Pendiente (`TABLE_COL.money`, sin truncar) · Notas (`TruncatedCell` con `w-[160px]`; borrar `truncate(notes,60)` JS) · Acciones (`TABLE_COL.actions`, primaria `Ver` = Link al detalle; sin kebab si no hay más).
- Móvil: **ya tiene** variante `md:hidden` — reemplazarla por `<TableMobileCard>` y cambiar a `lg:hidden`; borrar los `truncate(email,32)`/`truncate(notes,60)` JS (el CSS los maneja).
- Commit: `"Migrate Clientes table to unified pattern"`.

### Task 6: Promociones — `src/app/dashboard/promociones/page.tsx` (Server)

- Columnas: **Nombre** (principal flex, `secondary={promo.description}`; borrar el `line-clamp-1`) · Código (`TABLE_COL.code`, mantener el chip `font-mono`) · Recompensa (texto, `w-[140px]`) · Alcance (texto, `w-[140px]`) · Usos (`TABLE_COL.uses`) · Vigencia (`TABLE_COL.date` ×~2 → `w-[160px]`) · Estado (`TABLE_COL.status`, `<StatusBadge map="promo" status={...} />`; confirmar la key real del status computado) · Acciones (`TABLE_COL.actions`).
- Acciones: primaria `Editar` (`PromotionForm`); kebab: Ver canjes (`RedemptionsButton`), Activar/desactivar (`PromotionToggle`). Estos componentes manejan sus propios diálogos; si alguno usa Dialog con trigger propio dentro del kebab y se cierra solo, izarlo (revisar en verificación visual).
- Móvil: nueva variante `lg:hidden` con `<TableMobileCard>`.
- Commit: `"Migrate Promociones table to unified pattern"`.

### Task 7: Reviews — `src/app/dashboard/reviews/reviews-client.tsx` (Client)

- Tabla principal — Columnas: **Cliente** (principal flex, `secondary={#id.slice(0,8)}` — mantener ese id corto como secondary) · Servicio (`TruncatedCell` `w-[160px]`) · Fecha reserva (`TABLE_COL.date`) · Calificación (`TABLE_COL.rating`, número + estrella) · Comentario (`TruncatedCell` `w-[220px]`; el `line-clamp-2` pasa a truncado de una línea con `title`) · Estado (`TABLE_COL.status`, `<StatusBadge map="review" status={...} />`) · Acciones (`TABLE_COL.actions`, primaria `Aprobar`/`Ocultar` según estado; kebab: Ver en reservas = link).
- Segunda tabla (bookings elegibles): migrar igual (Servicio principal flex, Cliente `w-[160px]`, Fecha `TABLE_COL.date`, Acción = `ReviewLinkButton` en `TableActions`). Read-mostly.
- Móvil: nueva variante `lg:hidden` con `<TableMobileCard>` para la principal.
- Commit: `"Migrate Reviews tables to unified pattern"`.

### Task 8: Detalle de cliente — `src/app/dashboard/customers/[id]/page.tsx` (Server, 2 tablas)

- Tabla 1 (historial reservas): **Servicio** (principal flex, `secondary={formatBookingNumber(...)}`) · Fecha (`TABLE_COL.date`) · Estado (`TABLE_COL.status`, `<StatusBadge map="booking" status={booking.status} />`; borrar `statusBadgeClasses` local) · Total (`TABLE_COL.money`, sin truncar) · Saldo (`TABLE_COL.money`, sin truncar). Read-only → sin columna de acciones. Ya tiene `md:hidden` → reemplazar por `<TableMobileCard>` + `lg:hidden`.
- Tabla 2 (historial pagos): **Monto** (principal — pero es atómico; dejar `TableCell` con `whitespace-normal`, NO truncar; el "principal" acá no trunca) · Tipo (`w-[140px]`) · Estado (`TABLE_COL.status`, `<StatusBadge map="payment" status={payment.status} />`; borrar `paymentStatusBadgeClasses` local) · Fecha (`TABLE_COL.date`) · Método (`TruncatedCell` `w-[140px]`). Read-only. Ya tiene `md:hidden` → `<TableMobileCard>` + `lg:hidden`.
- Nota: como Monto es la columna identificadora pero es atómica, esta tabla NO tiene columna flex de texto; está bien — dale a Método el rol flexible (sin ancho) o mantené todas acotadas y deja que `table-fixed` reparta. Elegir: Método = única flex.
- Commit: `"Migrate customer detail tables to unified pattern"`.

### Task 9: Ledger — `src/components/dashboard/ledger-table.tsx` (Server, read-only)

- Columnas: Fecha (`TABLE_COL.date`) · Tipo (`TruncatedCell` `w-[160px]`) · Dirección (`TABLE_COL.status`, `<StatusBadge map="direction" status={entry.direction} />`; borrar `directionColors`/`directionLabels` locales — confirmar que las keys reales son `income`/`expense`/`neutral`, si no ajustar el mapa) · Monto (`TABLE_COL.money`, sin truncar, mantener el color y el prefijo `—` de gasto) · **Descripción** (principal flex, `TruncatedCell`). Read-only → sin acciones.
- Móvil: nueva variante `lg:hidden` con `<TableMobileCard title={typeLabels[type]} badge={<StatusBadge map="direction" .../>} rows={[Fecha, Monto, Descripción]} />`.
- Commit: `"Migrate Ledger table to unified pattern"`.

---

### Task 10: Verificación

- [ ] **Step 1: Suite completa** — `npm run test:unit` verde. `npx tsc --noEmit` sin errores nuevos en los archivos tocados.
- [ ] **Step 2: Verificación visual (manual, jsdom no mide layout).** En preview con datos reales, para cada una de las 6 páginas: sin scroll horizontal a 1280/1024px; la columna principal trunca con `…` + tooltip; switch a cards bajo 1024px; los kebabs abren y los diálogos (Servicios: desactivar) no se cierran solos; montos no invaden columnas vecinas; badges de estado con colores correctos en claro y oscuro.
- [ ] **Step 3:** Abrir PR con el resumen de tablas migradas + nota de verificación visual. El merge lo hace el usuario.

---

## Self-Review

**Cobertura del spec (PR2):** las 6 tablas dueña-facing del mapa de acciones del spec (Servicios, Clientes, Promociones, Reviews, detalle de cliente ×2, Ledger) tienen tarea (4–9). `<TableMobileCard>` construida (T2) y aplicada a las 4 desktop-only + las 3 que ya tenían card. `<StatusBadge>` extendido a todos los dominios de estado (T1). Truncado CSS-no-JS, montos sin truncar, breakpoint `lg`, izado de diálogos: todos en las convenciones + por-tabla. Quedan para **PR3** las tablas internas (Billing, Admin ×2, Redemptions) y la remoción del `BookingCard` muerto.

**Placeholders:** las tareas 4–9 usan un patrón común concreto + specificación exacta por columna (cuál trunca, cuál lleva qué `TABLE_COL`, cuál es la primaria, qué mapa de StatusBadge, qué acción primaria) en vez de repetir el JSX del piloto 6 veces — eso es DRY deliberado: el piloto (`bookings/page.tsx` + `booking-row-actions.tsx`) es la referencia de código literal. No hay "TBD".

**Consistencia de tipos:** los mapas de `STATUS_MAPS` (T1) se referencian por su key (`service`/`review`/`payment`/`promo`/`direction`) en T4–T9. `TableMobileCard` props (`title`/`subtitle`/`badge`/`rows`/`actions`) definidos en T2 y usados igual en las migraciones. `TABLE_COL` claves nuevas (T3) usadas en T4/T6/T7.

**Riesgo abierto:** las keys reales de estado (`promo` computado, `direction` del ledger, `review state`) deben confirmarse contra el código antes de fijar los mapas — señalado explícitamente en T1/T6/T9. Si una key difiere, ajustar el mapa (no el llamador).
