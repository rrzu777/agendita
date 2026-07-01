# Relleno de color por servicio en el calendario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que en el calendario (día/semana/mes) cada reserva se pinte con el color del servicio a relleno completo, con texto legible (WCAG AA) y el estado visible mediante puntito+ícono y atenuado/tachado.

**Architecture:** Toda la lógica visual vive en dos módulos puros y testeables — `src/lib/calendar/color.ts` (contraste/derivación de color) y `src/lib/calendar/booking-appearance.ts` (mapa estado→apariencia) — y el componente `calendar-views.tsx` solo consume `bookingAppearance()` y aplica estilos inline. Sin cambios de base de datos.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind, lucide-react (íconos), Vitest (jsdom) para tests.

**Spec:** `docs/superpowers/specs/2026-06-30-calendar-service-color-fill-design.md`

---

## File Structure

- **Create** `src/lib/calendar/color.ts` — helpers puros de color: parseo de hex, luminancia relativa, ratio de contraste (WCAG), elección de color de texto legible y derivación de un tono de borde. Sin React.
- **Create** `src/lib/calendar/booking-appearance.ts` — combina los helpers de color + el estado de la reserva en un único objeto `BookingAppearance` que el componente consume. Sin React.
- **Create** `tests/unit/calendar-color.test.ts` — tests de `color.ts`.
- **Create** `tests/unit/booking-appearance.test.ts` — tests de `booking-appearance.ts`.
- **Create** `tests/unit/calendar-views-fill.test.tsx` — test de render (SSR) que verifica el relleno en día y mes.
- **Modify** `src/components/dashboard/calendar-views.tsx` — `BookingBlock` (timeline) y `MonthView` (filitas) consumen `bookingAppearance()`; se eliminan los mapas `statusBlockClasses` y `statusDotColors`.

**Comandos de test:**
- Un archivo: `npx vitest --run tests/unit/<archivo>`
- Todo: `npm run test:unit`

---

### Task 1: Helpers de color base (parse + luminancia + contraste)

**Files:**
- Create: `src/lib/calendar/color.ts`
- Test: `tests/unit/calendar-color.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/calendar-color.test.ts
import { describe, it, expect } from 'vitest'
import { parseHex, relativeLuminance, contrastRatio } from '@/lib/calendar/color'

describe('parseHex', () => {
  it('parsea hex con y sin #', () => {
    expect(parseHex('#FFB3BA')).toEqual({ r: 255, g: 179, b: 186 })
    expect(parseHex('FFB3BA')).toEqual({ r: 255, g: 179, b: 186 })
  })
  it('devuelve null para valores inválidos o ausentes', () => {
    expect(parseHex('nope')).toBeNull()
    expect(parseHex('#FFF')).toBeNull()
    expect(parseHex(undefined)).toBeNull()
    expect(parseHex(null)).toBeNull()
  })
})

describe('relativeLuminance', () => {
  it('blanco ~1 y negro ~0', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 2)
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 2)
  })
})

describe('contrastRatio', () => {
  it('blanco vs negro es 21:1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0)
  })
  it('mismo color es 1:1', () => {
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run tests/unit/calendar-color.test.ts`
Expected: FAIL — no puede importar `@/lib/calendar/color` (módulo no existe).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/calendar/color.ts
export const DEFAULT_SERVICE_COLOR = '#e5e7eb' // gris neutro de respaldo

export type RGB = { r: number; g: number; b: number }

export function parseHex(hex: string | undefined | null): RGB | null {
  if (!hex) return null
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const int = parseInt(m[1], 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

function channelLuminance(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex) ?? parseHex(DEFAULT_SERVICE_COLOR)!
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  )
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run tests/unit/calendar-color.test.ts`
Expected: PASS (todos los tests verdes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/color.ts tests/unit/calendar-color.test.ts
git commit -m "feat(calendar): helpers de luminancia y contraste

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Color de texto legible y color de borde derivado

**Files:**
- Modify: `src/lib/calendar/color.ts`
- Test: `tests/unit/calendar-color.test.ts`

- [ ] **Step 1: Write the failing test (añadir al archivo existente)**

```ts
// añadir al final de tests/unit/calendar-color.test.ts
import {
  readableTextColor,
  deriveBorderColor,
  DEFAULT_SERVICE_COLOR,
} from '@/lib/calendar/color'

const DARK_TEXT = '#1f2937'
const LIGHT_TEXT = '#ffffff'

describe('readableTextColor', () => {
  it('elige texto oscuro sobre pastel claro', () => {
    expect(readableTextColor('#FFB3BA')).toBe(DARK_TEXT)
  })
  it('elige texto claro sobre fondo oscuro', () => {
    expect(readableTextColor('#1a1a2e')).toBe(LIGHT_TEXT)
  })
  it('el color elegido cumple contraste >= 4.5:1', () => {
    for (const bg of ['#FFB3BA', '#1a1a2e', '#c7f9cc', '#2b2d42']) {
      expect(contrastRatio(bg, readableTextColor(bg))).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('deriveBorderColor', () => {
  it('devuelve un tono más oscuro que el fondo', () => {
    const bg = '#FFB3BA'
    expect(relativeLuminance(deriveBorderColor(bg))).toBeLessThan(relativeLuminance(bg))
  })
  it('para hex inválido usa el color por defecto', () => {
    expect(deriveBorderColor('nope')).toBe(deriveBorderColor(DEFAULT_SERVICE_COLOR))
  })
})
```

Nota: puede que dos de los pasteles del test (`#FFB3BA`, `#c7f9cc`) no lleguen a 4.5:1 con texto claro; por eso el helper prioriza el texto oscuro que sí cumple. El test lo verifica dinámicamente.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run tests/unit/calendar-color.test.ts`
Expected: FAIL — `readableTextColor` / `deriveBorderColor` no existen.

- [ ] **Step 3: Write minimal implementation (añadir a `color.ts`)**

```ts
// añadir a src/lib/calendar/color.ts
const DARK_TEXT = '#1f2937' // gray-800
const LIGHT_TEXT = '#ffffff'

export function readableTextColor(bgHex: string): string {
  const darkRatio = contrastRatio(bgHex, DARK_TEXT)
  const lightRatio = contrastRatio(bgHex, LIGHT_TEXT)
  if (darkRatio >= 4.5) return DARK_TEXT
  if (lightRatio >= 4.5) return LIGHT_TEXT
  return darkRatio >= lightRatio ? DARK_TEXT : LIGHT_TEXT
}

export function deriveBorderColor(bgHex: string): string {
  const rgb = parseHex(bgHex) ?? parseHex(DEFAULT_SERVICE_COLOR)!
  const factor = 0.72 // ~28% más oscuro
  const toHex = (c: number) => Math.round(c * factor).toString(16).padStart(2, '0')
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run tests/unit/calendar-color.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/color.ts tests/unit/calendar-color.test.ts
git commit -m "feat(calendar): color de texto legible y borde derivado

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Módulo de apariencia por estado (`booking-appearance.ts`)

**Files:**
- Create: `src/lib/calendar/booking-appearance.ts`
- Test: `tests/unit/booking-appearance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/booking-appearance.test.ts
import { describe, it, expect } from 'vitest'
import { bookingAppearance } from '@/lib/calendar/booking-appearance'
import { DEFAULT_SERVICE_COLOR } from '@/lib/calendar/color'

describe('bookingAppearance', () => {
  it('confirmada: relleno = color de servicio, opacidad plena, sin tachado', () => {
    const a = bookingAppearance('#FFB3BA', 'confirmed')
    expect(a.background).toBe('#FFB3BA')
    expect(a.opacity).toBe(1)
    expect(a.strikeThrough).toBe(false)
    expect(a.icon).toBe('check')
    expect(a.textColor).toBe('#1f2937')
  })
  it('pendiente de pago: ícono reloj, opacidad plena', () => {
    const a = bookingAppearance('#FFB3BA', 'pending_payment')
    expect(a.icon).toBe('clock')
    expect(a.opacity).toBe(1)
    expect(a.strikeThrough).toBe(false)
  })
  it('completada: levemente atenuada, sin tachado', () => {
    const a = bookingAppearance('#FFB3BA', 'completed')
    expect(a.opacity).toBe(0.85)
    expect(a.strikeThrough).toBe(false)
  })
  it('cancelada: atenuada, tachada, ícono x', () => {
    const a = bookingAppearance('#FFB3BA', 'cancelled')
    expect(a.opacity).toBe(0.55)
    expect(a.strikeThrough).toBe(true)
    expect(a.icon).toBe('x')
  })
  it('expirada: atenuada, tachada, ícono dash', () => {
    const a = bookingAppearance('#FFB3BA', 'expired')
    expect(a.opacity).toBe(0.55)
    expect(a.strikeThrough).toBe(true)
    expect(a.icon).toBe('dash')
  })
  it('estado desconocido: fallback seguro (plena, sin tachado)', () => {
    const a = bookingAppearance('#FFB3BA', 'weird_status')
    expect(a.opacity).toBe(1)
    expect(a.strikeThrough).toBe(false)
    expect(a.icon).toBe('dash')
  })
  it('sin color de servicio: usa el color por defecto', () => {
    const a = bookingAppearance(undefined, 'confirmed')
    expect(a.background).toBe(DEFAULT_SERVICE_COLOR)
  })
  it('color inválido: usa el color por defecto', () => {
    const a = bookingAppearance('nope', 'confirmed')
    expect(a.background).toBe(DEFAULT_SERVICE_COLOR)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run tests/unit/booking-appearance.test.ts`
Expected: FAIL — módulo `booking-appearance` no existe.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/calendar/booking-appearance.ts
import {
  DEFAULT_SERVICE_COLOR,
  readableTextColor,
  deriveBorderColor,
} from './color'

export type StatusIcon = 'clock' | 'check' | 'x' | 'dash'

export interface BookingAppearance {
  background: string
  textColor: string
  borderColor: string
  opacity: number
  strikeThrough: boolean
  dotColor: string
  icon: StatusIcon
}

type StatusKind = 'active' | 'done' | 'negative'

interface StatusMeta {
  kind: StatusKind
  dotColor: string
  icon: StatusIcon
}

const STATUS_META: Record<string, StatusMeta> = {
  pending_payment: { kind: 'active', dotColor: '#f97316', icon: 'clock' },
  confirmed: { kind: 'active', dotColor: '#22c55e', icon: 'check' },
  completed: { kind: 'done', dotColor: '#3b82f6', icon: 'check' },
  cancelled: { kind: 'negative', dotColor: '#ef4444', icon: 'x' },
  no_show: { kind: 'negative', dotColor: '#dc2626', icon: 'x' },
  expired: { kind: 'negative', dotColor: '#6b7280', icon: 'dash' },
}

const FALLBACK_META: StatusMeta = { kind: 'active', dotColor: '#6b7280', icon: 'dash' }

const OPACITY: Record<StatusKind, number> = {
  active: 1,
  done: 0.85,
  negative: 0.55,
}

export function bookingAppearance(
  pastelColor: string | undefined | null,
  status: string,
): BookingAppearance {
  const background =
    pastelColor && /^#[0-9a-fA-F]{6}$/.test(pastelColor)
      ? pastelColor
      : DEFAULT_SERVICE_COLOR
  const meta = STATUS_META[status] ?? FALLBACK_META
  return {
    background,
    textColor: readableTextColor(background),
    borderColor: deriveBorderColor(background),
    opacity: OPACITY[meta.kind],
    strikeThrough: meta.kind === 'negative',
    dotColor: meta.dotColor,
    icon: meta.icon,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run tests/unit/booking-appearance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/booking-appearance.ts tests/unit/booking-appearance.test.ts
git commit -m "feat(calendar): apariencia de reserva por estado

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `BookingBlock` (timeline día/semana) usa el relleno de servicio

**Files:**
- Modify: `src/components/dashboard/calendar-views.tsx`
- Test: `tests/unit/calendar-views-fill.test.tsx`

- [ ] **Step 1: Write the failing test**

Mockeamos los hijos pesados (`BlockTimeModal` usa `useRouter`, `BookingDrawer` no se usa aquí) para aislar el render a la lógica del timeline.

```tsx
// tests/unit/calendar-views-fill.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/components/dashboard/block-time-modal', () => ({
  BlockTimeModal: () => null,
}))
vi.mock('@/components/dashboard/booking-drawer', () => ({
  BookingDrawer: () => null,
}))

import { CalendarViews } from '@/components/dashboard/calendar-views'

const baseProps = {
  timeBlocks: [],
  todayKey: '2026-06-30',
  timezone: 'America/Santiago',
  businessCurrency: 'CLP',
  businessAddress: null,
}

const booking = {
  id: 'b1',
  startDateTime: '2026-06-30T17:00:00.000Z',
  endDateTime: '2026-06-30T18:00:00.000Z',
  status: 'confirmed',
  customer: { name: 'Ana' },
  service: { name: 'Corte', pastelColor: '#FFB3BA' },
}

describe('CalendarViews — relleno de color (día)', () => {
  it('pinta el bloque con el color del servicio y texto legible', () => {
    const html = renderToStaticMarkup(
      // @ts-expect-error props mínimos de prueba
      <CalendarViews {...baseProps} view="day" date="2026-06-30" bookings={[booking]} />,
    ).toLowerCase()
    expect(html).toContain('background-color:#ffb3ba')
    expect(html).toContain('color:#1f2937')
    expect(html).toContain('ana')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run tests/unit/calendar-views-fill.test.tsx`
Expected: FAIL — hoy `BookingBlock` no aplica `background-color:#ffb3ba` (el color va solo como borde izquierdo).

- [ ] **Step 3: Update imports (`calendar-views.tsx`)**

Reemplaza la línea de import de lucide (línea 23):

```tsx
import { ChevronLeft, ChevronRight, Clock, Check, X, Minus } from 'lucide-react'
```

Añade este import junto a los demás de `@/lib/calendar` (después del bloque de import de `timeline`, ~línea 33):

```tsx
import { bookingAppearance, type StatusIcon } from '@/lib/calendar/booking-appearance'
```

- [ ] **Step 4: Eliminar el mapa `statusBlockClasses` y añadir el mapa de íconos**

Borra por completo el `const statusBlockClasses` (líneas 65–71). Deja `statusDotColors` por ahora (se elimina en la Task 5). Añade, cerca del tope del módulo (p. ej. después de `HOUR_HEIGHT`):

```tsx
const statusIcons: Record<StatusIcon, typeof Clock> = {
  clock: Clock,
  check: Check,
  x: X,
  dash: Minus,
}
```

- [ ] **Step 5: Reescribir `BookingBlock`**

Reemplaza la función `BookingBlock` completa (líneas 380–418) por:

```tsx
function BookingBlock({
  p,
  timezone,
  onClick,
}: {
  p: PositionedItem<TimelineBooking>
  timezone: string
  onClick: () => void
}) {
  const b = p.item
  const widthPct = 100 / p.lanes
  const leftPct = p.lane * widthPct
  const appearance = bookingAppearance(b.service?.pastelColor, b.status)
  const Icon = statusIcons[appearance.icon]
  const start = localTime(b.startDateTime, timezone)
  const strike = appearance.strikeThrough ? 'line-through' : ''

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm transition hover:z-10 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
      style={{
        top: (p.topMin / 60) * HOUR_HEIGHT,
        height: Math.max((p.heightMin / 60) * HOUR_HEIGHT - 2, 18),
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        backgroundColor: appearance.background,
        borderColor: appearance.borderColor,
        color: appearance.textColor,
        opacity: appearance.opacity,
      }}
    >
      <span
        className="absolute right-0.5 top-0.5 flex size-3 items-center justify-center rounded-full ring-1 ring-white"
        style={{ backgroundColor: appearance.dotColor }}
        aria-hidden="true"
      >
        <Icon className="size-2 text-white" strokeWidth={3} />
      </span>
      <div className={`font-semibold ${strike}`}>{start}</div>
      <div className={`truncate ${strike}`}>{b.customer?.name || 'Cliente'}</div>
      {p.heightMin >= 45 && b.service?.name && <div className="truncate">{b.service.name}</div>}
    </button>
  )
}
```

Cambios clave respecto al original: fondo = color de servicio (antes solo borde izquierdo); texto por contraste; borde derivado; puntito con ícono y halo en la esquina; opacidad por estado; se quitó el `opacity-70` de la línea de servicio; anillo de foco por teclado.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest --run tests/unit/calendar-views-fill.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/calendar-views.tsx tests/unit/calendar-views-fill.test.tsx
git commit -m "feat(calendar): relleno de color de servicio en timeline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `MonthView` (filitas) usa el relleno de servicio

**Files:**
- Modify: `src/components/dashboard/calendar-views.tsx`
- Test: `tests/unit/calendar-views-fill.test.tsx`

- [ ] **Step 1: Write the failing test (añadir al archivo existente)**

```tsx
// añadir dentro de tests/unit/calendar-views-fill.test.tsx
describe('CalendarViews — relleno de color (mes)', () => {
  it('pinta la filita de reserva con el color del servicio', () => {
    const html = renderToStaticMarkup(
      // @ts-expect-error props mínimos de prueba
      <CalendarViews {...baseProps} view="month" date="2026-06-30" bookings={[booking]} />,
    ).toLowerCase()
    expect(html).toContain('background-color:#ffb3ba')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run tests/unit/calendar-views-fill.test.tsx`
Expected: FAIL en el caso "mes" — hoy la filita no tiene fondo de color de servicio.

- [ ] **Step 3: Reescribir el `.map` de filitas en `MonthView`**

Reemplaza el bloque `{dayBookings.slice(0, 3).map((b) => ( ... ))}` (líneas 260–267) por:

```tsx
{dayBookings.slice(0, 3).map((b) => {
  const appearance = bookingAppearance(b.service?.pastelColor, b.status)
  return (
    <div
      key={b.id}
      className="flex items-center gap-1 rounded px-1"
      style={{ backgroundColor: appearance.background, color: appearance.textColor }}
    >
      <span
        className="size-1.5 shrink-0 rounded-full ring-1 ring-white"
        style={{ backgroundColor: appearance.dotColor }}
      />
      <span className="truncate text-[10px] leading-tight">
        {b.customer?.name || b.service?.name || 'Reserva'}
      </span>
    </div>
  )
})}
```

- [ ] **Step 4: Eliminar el mapa `statusDotColors` (ya sin uso)**

Borra por completo el `const statusDotColors` (líneas 57–63). Verifica que no quede ninguna referencia:

Run: `grep -n "statusDotColors\|statusBlockClasses" src/components/dashboard/calendar-views.tsx`
Expected: sin resultados.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest --run tests/unit/calendar-views-fill.test.tsx`
Expected: PASS (día y mes).

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/calendar-views.tsx tests/unit/calendar-views-fill.test.tsx
git commit -m "feat(calendar): relleno de color de servicio en vista mes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Verificación final (typecheck + lint + suite completa + revisión visual)

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores. (Si falla por tipos de props en el test, confirma que los `// @ts-expect-error` siguen sobre el JSX correcto.)

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sin errores nuevos. En particular, no debe haber variables sin usar (los mapas `statusBlockClasses`/`statusDotColors` fueron eliminados).

- [ ] **Step 3: Suite completa de unit tests**

Run: `npm run test:unit`
Expected: PASS, incluyendo los 3 archivos nuevos.

- [ ] **Step 4: Revisión visual manual**

Levanta la app y abre `/dashboard/calendar` con reservas de varios servicios/estados. Verifica:
- Día/semana/mes: los bloques tienen **relleno del color del servicio** y el texto es legible.
- El **puntito+ícono de estado** se ve sobre cualquier color; `completed` se ve levemente atenuada; `cancelled`/`no_show`/`expired` atenuadas y tachadas.
- Un **bloque corto** (reserva de 15–20 min) muestra hora + cliente sin romperse.
- Los **bloqueos** siguen como banda gris rayada (sin cambios).
- Foco por teclado: al tabular sobre un bloque aparece el anillo de foco.

- [ ] **Step 5: Commit (si hubo ajustes menores de la revisión)**

```bash
git add -A
git commit -m "chore(calendar): ajustes de revisión visual del relleno de color

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Relleno de color de servicio en día/semana/mes → Tasks 4 (timeline) y 5 (mes). ✅
- Contraste automático WCAG 4.5:1 + quitar `opacity-70` → Task 2 (helper) + Task 4 (uso, sin `opacity-70`). ✅
- Borde derivado con separación → Task 2 (`deriveBorderColor`) + Task 4 (aplicado). ✅
- Paleta de puntitos saturados + halo + ícono por estado → Task 3 (paleta+ícono) + Task 4 (render con halo). ✅
- `completed` levemente atenuada; negativas atenuadas+tachadas → Task 3 (opacidades/strike) + Task 4/5. ✅
- Bloques mínimos (puntito absoluto, ocultar línea de servicio) → Task 4 (`heightMin >= 45` + puntito absoluto). ✅
- Foco por teclado accesible → Task 4 (`focus-visible:ring`). ✅
- Bloqueos sin cambios → `BlockBand` no se toca en ninguna task. ✅
- Sin cambios de base de datos → ninguna task toca Prisma/acciones. ✅
- `expired` con valor por defecto seguro → Task 3 (`STATUS_META.expired` + `FALLBACK_META`). ✅

**Placeholder scan:** sin TBD/TODO; todo el código está completo e incluido.

**Type consistency:** `BookingAppearance` (Task 3) se consume en Tasks 4/5 con los mismos nombres (`background`, `textColor`, `borderColor`, `opacity`, `strikeThrough`, `dotColor`, `icon`); `StatusIcon` se importa en Task 4 para tipar `statusIcons`. `bookingAppearance(pastelColor, status)` con la misma firma en todos los usos. ✅
