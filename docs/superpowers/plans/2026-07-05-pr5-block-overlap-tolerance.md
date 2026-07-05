# PR 5 — Tolerancia de solape con bloqueos: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que una cita invada hasta X minutos por borde de un bloqueo (p. ej. MANICURA 09:00–12:45 sobre un almuerzo 12:00–14:00 con tolerancia 45), configurable por bloqueo, default 0 = comportamiento actual.

**Architecture:** Columna `overlapToleranceMinutes Int @default(0)` en `TimeBlock` y `TimeBlockSeries` (única migración del batch; la aplica `prisma migrate deploy` en el build de Vercel — NUNCA `db execute` manual). La semántica vive en un solo lugar: helper puro `shrinkBlock(block)` que devuelve los bordes efectivos `[start + tol, end − tol]` (o null si el bloqueo colapsa). Lo consumen `generateSlots` (obstáculos) y `assertSlotIsAvailable` (chequeos de solape). `expandSeries` propaga la tolerancia de la serie a cada ocurrencia. UI: campo numérico opcional en `BlockFormFields`, validado a ≤ mitad de la duración del bloqueo.

**Branch:** `claude/availability-pr5` stackeada sobre `claude/availability-pr4` (comparte `time-blocks.ts` y los formularios de bloqueo con PR 4, y `slots.ts` con PR 3).

**Nota post-merge:** al mergear, Vercel aplica la migración. El cliente Prisma generado en `node_modules` es compartido entre worktrees: regenerarlo con el schema nuevo ANTES de que la columna exista en la DB rompe el dev local — regenerar solo tras aplicar la migración (o dejar que CI/Vercel lo hagan).

---

### Task 1: Migración + schema

**Files:**
- Modify: `prisma/schema.prisma` (modelos `TimeBlock` y `TimeBlockSeries`)
- Create: `prisma/migrations/20260705200000_add_block_overlap_tolerance/migration.sql`

- [ ] **Step 1:** Agregar a ambos modelos (después de `reason`):

```prisma
  overlapToleranceMinutes Int @default(0)
```

- [ ] **Step 2:** Crear la migración a mano (patrón de las existentes):

```sql
-- Permite que una cita invada hasta N minutos por borde del bloqueo.
ALTER TABLE "TimeBlock" ADD COLUMN "overlapToleranceMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TimeBlockSeries" ADD COLUMN "overlapToleranceMinutes" INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 3:** `npx prisma generate` (ver nota post-merge: si el dev local del usuario está corriendo contra la DB sin la columna, coordinar; para CI del PR no hay problema porque genera desde el schema del branch).

- [ ] **Step 4:** Commit (`prisma/schema.prisma` + carpeta de migración).

---

### Task 2: Helper `shrinkBlock` + tolerancia en `generateSlots`

**Files:**
- Create: `src/lib/availability/shrink-block.ts`
- Modify: `src/lib/availability/slots.ts` (interface `TimeBlockLike` + construcción de obstáculos)
- Test: `tests/unit/shrink-block.test.ts`, `tests/unit/slots.test.ts`

- [ ] **Step 1: Tests que fallan**

`tests/unit/shrink-block.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shrinkBlock } from '@/lib/availability/shrink-block'

describe('shrinkBlock', () => {
  const start = new Date('2026-05-11T16:00:00Z') // 12:00 Santiago
  const end = new Date('2026-05-11T18:00:00Z')   // 14:00 Santiago

  it('returns the block untouched with tolerance 0 or undefined', () => {
    expect(shrinkBlock({ startDateTime: start, endDateTime: end })).toEqual({ start, end })
    expect(shrinkBlock({ startDateTime: start, endDateTime: end, overlapToleranceMinutes: 0 })).toEqual({ start, end })
  })

  it('shrinks both edges by the tolerance', () => {
    const r = shrinkBlock({ startDateTime: start, endDateTime: end, overlapToleranceMinutes: 45 })
    expect(r?.start.toISOString()).toBe('2026-05-11T16:45:00.000Z')
    expect(r?.end.toISOString()).toBe('2026-05-11T17:15:00.000Z')
  })

  it('returns null when the tolerance collapses the block', () => {
    expect(shrinkBlock({ startDateTime: start, endDateTime: end, overlapToleranceMinutes: 60 })).toBeNull()
    expect(shrinkBlock({ startDateTime: start, endDateTime: end, overlapToleranceMinutes: 90 })).toBeNull()
  })
})
```

En `tests/unit/slots.test.ts` agregar:

```ts
  it('lets a service eat into a tolerant block (caso MANICURA + almuerzo)', () => {
    // Regla 09:00-14:30, servicio 225 min, almuerzo 12:00-14:00 con tolerancia 45
    const localRules = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '14:30', isActive: true },
    ]
    const blocks = [
      {
        startDateTime: new Date('2026-05-11T16:00:00Z'), // 12:00 Santiago
        endDateTime: new Date('2026-05-11T18:00:00Z'),   // 14:00 Santiago
        overlapToleranceMinutes: 45,
      },
    ]
    // Sin tolerancia: 0 slots (09:00-12:45 pisa el almuerzo). Con 45: 09:00 existe.
    const slots = generateSlots(baseDate, 225, localRules, blocks, [], { timezone, now: testNow })
    expect(slots.map((s) => s.start.toISOString())).toEqual(['2026-05-11T13:00:00.000Z'])
  })
```

- [ ] **Step 2: Implementar**

`src/lib/availability/shrink-block.ts`:

```ts
import { addMinutes } from 'date-fns'

export interface ShrinkableBlock {
  startDateTime: Date
  endDateTime: Date
  /** Minutos que una cita puede invadir por cada borde del bloqueo. */
  overlapToleranceMinutes?: number
}

/**
 * Bordes efectivos de un bloqueo para el cálculo de solape: la tolerancia
 * encoge el bloqueo por ambos lados. Devuelve null si el bloqueo queda sin
 * núcleo (tolerancia >= mitad de la duración): en ese caso no bloquea nada.
 * Única fuente de esta semántica — la consumen generateSlots y validation.
 */
export function shrinkBlock(block: ShrinkableBlock): { start: Date; end: Date } | null {
  const tolerance = block.overlapToleranceMinutes ?? 0
  if (tolerance <= 0) return { start: block.startDateTime, end: block.endDateTime }
  const start = addMinutes(block.startDateTime, tolerance)
  const end = addMinutes(block.endDateTime, -tolerance)
  if (end <= start) return null
  return { start, end }
}
```

En `slots.ts`: `TimeBlockLike` gana `overlapToleranceMinutes?: number`; la construcción de obstáculos usa `shrinkBlock` para los bloqueos (filtrando null):

```ts
  const obstacles = [
    ...blocks.map((b) => shrinkBlock(b)).filter((b): b is { start: Date; end: Date } => b !== null),
    ...bookings.filter(blocksSlot).map((b) => ({ start: b.startDateTime, end: b.endDateTime })),
  ]
```

- [ ] **Step 3:** Verde + commit.

---

### Task 3: Tolerancia en validación y expansión de series

**Files:**
- Modify: `src/lib/calendar/expand-series.ts` (tipo `EffectiveBlock` + propagación), `src/lib/availability/effective-blocks.ts` (mapeo one-off), `src/lib/availability/validation.ts` (chequeos de bloqueo)
- Test: `tests/unit/expand-series.test.ts`, `tests/unit/availability-validation.test.ts`

- [ ] **Step 1: Tests que fallan** — (a) `expandSeries` propaga `overlapToleranceMinutes` de la serie a cada ocurrencia; (b) `assertSlotIsAvailable` acepta un slot que invade 45 min de un bloqueo one-off con tolerancia 45 y lo rechaza con tolerancia 0 (mock del tx: `timeBlock.findMany` en vez de `findFirst` — ver Step 2); (c) ídem vía serie.

- [ ] **Step 2: Implementar**

- `expand-series.ts`: `EffectiveBlock` gana `overlapToleranceMinutes?: number`; cada ocurrencia emitida copia el de la serie (los override de excepción conservan el de la serie).
- `effective-blocks.ts`: el mapeo de one-off incluye el campo.
- `validation.ts`: reemplazar `timeBlock.findFirst` por `findMany` (mismo where de solape crudo, select `startDateTime, endDateTime, overlapToleranceMinutes`) y evaluar en JS: `oneOff.some((b) => { const s = shrinkBlock(b); return s && s.start < endDateTime && startDateTime < s.end })`. Para series: aplicar `shrinkBlock` a cada ocurrencia expandida en el `some()` existente.
- Los tests existentes de validación mockean `timeBlock.findFirst` → actualizar el mock a `findMany` (array).

- [ ] **Step 3:** Verde + commit.

---

### Task 4: Server actions + formulario

**Files:**
- Modify: `src/server/actions/time-blocks.ts` (zod schemas + create/update de bloque y serie persisten el campo), `src/components/dashboard/block-form-fields.tsx` (+ los modals que arman el payload)
- Test: `tests/unit/time-blocks.test.ts`, `tests/unit/block-form-fields.test.tsx`

- [ ] **Step 1:** Zod: `overlapToleranceMinutes: z.number().int().min(0).max(240).optional()` + refine: ≤ mitad de la duración del bloqueo (calcular de start/end del payload). Mensaje: 'La tolerancia no puede superar la mitad de la duración del bloqueo'.
- [ ] **Step 2:** UI: input numérico opcional en `BlockFormFields` — label «Permitir que una cita invada hasta (min)», hint «0 = el bloqueo es estricto». Persistencia en create/update de bloque y serie + derivación en `deriveBlockFormValues`.
- [ ] **Step 3:** Tests de schema (rechaza tolerancia > mitad) y de componente (el campo aparece y arma el payload). Verde + commit.

---

### Task 5: Suite completa + PR

- [ ] `npx vitest run` verde; `npx tsc --noEmit` = baseline; eslint limpio.
- [ ] Push + `gh pr create` "Block overlap tolerance (PR 5/5)" — cuerpo con semántica, migración (la aplica Vercel), y el caso objetivo (tolerancia 45 en el almuerzo → MANICURA recupera las 09:00). SIN merge (lo decide el usuario). Nota de orden: requiere mergear antes PR 3 y PR 4.
