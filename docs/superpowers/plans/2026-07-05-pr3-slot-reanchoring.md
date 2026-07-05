# PR 3 — Re-anclaje de slots: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los slots se ofrezcan pegados al término de cada cita/bloqueo (sin desperdiciar espacio libre) y que el último día de la ventana no ofrezca slots que la validación rechaza.

**Architecture:** `generateSlots` pasa de grilla anclada a apertura (paso = duración) a **sustracción de intervalos**: obstáculos = bloqueos + reservas activas, ordenados; barrido para obtener intervalos libres dentro de la ventana de la regla; en cada intervalo libre se anclan slots a su inicio con paso = duración. El lead time solo filtra candidatos (grid estable respecto al reloj). El chequeo de booking window pasa de nivel-día a nivel-slot (paridad con `assertSlotIsAvailable`). La firma pública no cambia; `validation.ts` no cambia (no exige grid).

**Branch:** `claude/availability-pr3` desde `origin/main` (independiente del PR 2; no comparten archivos).

**Decisión registrada (spec):** opción B (re-anclaje) sobre grilla fija de 15/30 min — prioriza agenda compacta sin huecos muertos.

---

### Task 1: Reescritura de `generateSlots` con tests del nuevo comportamiento

**Files:**
- Modify: `src/lib/availability/slots.ts:36-116`
- Test: `tests/unit/slots.test.ts` (agregar casos; los existentes deben seguir pasando sin modificación)

- [ ] **Step 1: Tests que fallan** — agregar al describe:

```ts
  it('re-anchors slots after an off-grid booking instead of losing the free space', () => {
    // Caso real (Jackeline): regla 09:00-14:30, servicio 90 min,
    // cita existente 09:45-11:15 (13:45Z-15:15Z).
    const localRules = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '14:30', isActive: true },
    ]
    const bookings = [
      {
        startDateTime: new Date('2026-05-11T13:45:00Z'),
        endDateTime: new Date('2026-05-11T15:15:00Z'),
        status: 'confirmed',
      },
    ]
    const slots = generateSlots(baseDate, 90, localRules, [], bookings, { timezone, now: testNow })
    // Antes: solo quedaba 12:00 (16:00Z). Ahora: 11:15 y 12:45, pegados a la cita.
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      '2026-05-11T15:15:00.000Z', // 11:15 Santiago
      '2026-05-11T16:45:00.000Z', // 12:45 Santiago
    ])
  })

  it('re-anchors slots after a time block', () => {
    // Regla 09:00-18:00, servicio 60, almuerzo 12:30-14:00 (16:30Z-18:00Z)
    const blocks = [
      { startDateTime: new Date('2026-05-11T16:30:00Z'), endDateTime: new Date('2026-05-11T18:00:00Z') },
    ]
    const slots = generateSlots(baseDate, 60, rules, blocks, [], { timezone, now: testNow })
    const starts = slots.map((s) => s.start.toISOString())
    // Mañana anclada a apertura: 09:00-12:00 (última que cabe antes del bloqueo: 11:00)
    expect(starts).toContain('2026-05-11T13:00:00.000Z') // 09:00
    expect(starts).toContain('2026-05-11T15:00:00.000Z') // 11:00
    expect(starts).not.toContain('2026-05-11T16:00:00.000Z') // 12:00 no cabe (12:00+60 > 12:30... sí cabe 12:00-13:00? NO: 13:00 > 12:30 bloqueo) 
    // Tarde re-anclada al fin del bloqueo: 14:00, 15:00, 16:00, 17:00
    expect(starts).toContain('2026-05-11T18:00:00.000Z') // 14:00
    expect(starts).toContain('2026-05-11T21:00:00.000Z') // 17:00
  })

  it('excludes slots beyond bookingWindowDays even on the boundary day', () => {
    // now = domingo 10 mayo 14:00 Santiago (18:00Z); window 1 día
    // => maxStart = lunes 11 mayo 14:00 Santiago (18:00Z)
    const now = new Date('2026-05-10T18:00:00Z')
    const slots = generateSlots(baseDate, 60, rules, [], [], { timezone, now, bookingWindowDays: 1 })
    expect(slots.length).toBeGreaterThan(0)
    const lastStart = slots[slots.length - 1].start.toISOString()
    // Último slot ofrecible: 14:00 Santiago (18:00Z); antes se ofrecían hasta las 17:00
    expect(lastStart).toBe('2026-05-11T18:00:00.000Z')
  })
```

Nota del segundo test: con bloqueo 12:30-14:00 y grilla de mañana anclada a las 09:00, el candidato 12:00-13:00 pisa el bloqueo → el último de la mañana es 11:00. Ajustar el comentario del test a esa realidad (la aserción `not.toContain('...16:00...')` es correcta).

- [ ] **Step 2: Verificar que fallan** — `npx vitest run tests/unit/slots.test.ts` → FAIL en los 3 nuevos (el primero devuelve solo 12:00; el segundo no re-ancla a 14:00; el tercero incluye slots > maxStart).

- [ ] **Step 3: Reescribir el cuerpo de `generateSlots`**

Mantener firma, opciones y filtros de reservas idénticos. Nuevo cuerpo (reemplaza desde el cálculo de `maxStart` hasta el final):

```ts
  const availabilityStart = fromZonedTime(`${localDateStr} ${rule.startTime}`, timezone)
  const availabilityEnd = fromZonedTime(`${localDateStr} ${rule.endTime}`, timezone)

  const cutoff = addMinutes(now, leadTimeMinutes)
  // Paridad con assertSlotIsAvailable: rechaza startDateTime > now + window,
  // así que el filtro es por slot (no por día) para no ofrecer inbookeables.
  const maxStart = addDays(now, bookingWindowDays)

  const blocksBooking = (booking: BookingLike): boolean => {
    if (booking.status === 'cancelled' || booking.status === 'no_show' || booking.status === 'expired') return false
    if (booking.status === 'pending_payment' && booking.holdExpiresAt && booking.holdExpiresAt <= now) return false
    return true
  }

  // Obstáculos que intersectan la ventana del día, ordenados por inicio
  const obstacles = [
    ...blocks.map((b) => ({ start: b.startDateTime, end: b.endDateTime })),
    ...bookings.filter(blocksBooking).map((b) => ({ start: b.startDateTime, end: b.endDateTime })),
  ]
    .filter((o) => o.start < availabilityEnd && o.end > availabilityStart)
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  // Barrido: intervalos libres = ventana − obstáculos
  const freeIntervals: { start: Date; end: Date }[] = []
  let cursor = availabilityStart
  for (const o of obstacles) {
    if (o.start > cursor) {
      freeIntervals.push({ start: cursor, end: o.start < availabilityEnd ? o.start : availabilityEnd })
    }
    if (o.end > cursor) cursor = o.end
  }
  if (cursor < availabilityEnd) freeIntervals.push({ start: cursor, end: availabilityEnd })

  // Slots anclados al inicio de cada intervalo libre (agenda compacta).
  // El lead time solo filtra candidatos: el grid no se corre con el reloj.
  const slots: TimeSlot[] = []
  for (const interval of freeIntervals) {
    let current = interval.start
    while (addMinutes(current, durationMinutes) <= interval.end) {
      if (current >= cutoff && current <= maxStart) {
        slots.push({ start: new Date(current), end: addMinutes(current, durationMinutes) })
      }
      current = addMinutes(current, durationMinutes)
    }
  }

  return slots
```

Actualizar el JSDoc de la función: describir sustracción de intervalos y re-anclaje (el texto actual describe la grilla anclada a apertura).

- [ ] **Step 4: Verificar** — `npx vitest run tests/unit/slots.test.ts tests/unit/availability-validation.test.ts tests/unit/reschedule-availability.test.ts` → PASS (existentes + nuevos).

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add src/lib/availability/slots.ts tests/unit/slots.test.ts
git -C <worktree> commit -m "Re-anchor slots after bookings and blocks via interval subtraction"
```

---

### Task 2: Suite completa + PR

- [ ] **Step 1:** `npx vitest run` → PASS; `npx eslint src/lib/availability` → limpio; `npx tsc --noEmit` → baseline (17).
- [ ] **Step 2:** Sanity check contra datos reales: re-correr el repro del diagnóstico (scratchpad) confirmando que ESMALTADO gana slots pegados a citas donde corresponda y MANICURA sigue en 0 (esperado, lo resuelven PR 4/5).
- [ ] **Step 3:** Push + `gh pr create` (título "Re-anchor availability slots (PR 3/5)") — SIN merge; el merge lo decide el usuario.
