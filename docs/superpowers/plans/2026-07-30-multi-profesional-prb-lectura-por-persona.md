# Multi-profesional PR B — la lectura por persona

> Sub-skill de ejecución: `superpowers:executing-plans`. Los pasos son checkboxes.

**Meta:** que todo el camino de lectura de horario —slots del funnel, reprogramar, aviso
de "no cabe" y la validación al escribir una reserva— sepa preguntar *de quién* es el
horario, sin cambiar ni un resultado mientras nadie tenga horario propio.

**Arquitectura:** un módulo nuevo (`lib/availability/scope.ts`) resuelve qué reglas y qué
bloqueos cuentan para un negocio + una persona; `getEffectiveBlocks` pasa a recibir un
alcance explícito; los tres lectores y `validation.ts` piden el alcance en vez de asumir
"del negocio". El motor (`generateSlots`) no se toca.

**Stack:** Next 16.2.6 App Router, Prisma 5.22, Postgres, vitest.

---

## Por qué este PR va ANTES del que escribe

El spec (§391) ordenaba al revés: primero la escritura (horario por persona + pantalla),
después los lectores. Con ese orden, la dueña abre Disponibilidad, le da a Juan un
horario propio, la pantalla lo guarda **y el funnel lo ignora** hasta el PR siguiente.

Es la falla que ya pagamos en el PR A, pero peor: ahí sólo se guardaba un nombre; acá se
guardaría un **horario que la dueña cree vigente**, y las clientas seguirían reservando
en horas en las que Juan no atiende. Una pantalla que promete lo que el PR siguiente
habilita no se arregla con una nota en el cuerpo del PR — eso no lo lee quien usa la
pantalla.

Invertido, este PR es **un no-op observable**: mientras ninguna fila tenga
`professionalId`, todo alcance resuelve a "del negocio" y los resultados son los de hoy.
Y cuando llegue la pantalla, funciona el día que se mergea.

Costo de la inversión, dicho: el PR más riesgoso del track entra sin nada visible que lo
respalde. La red son los tests de integración que ya existen (`slot-conflicts`,
`booking`, `effective-blocks`, `time-block-series`) más los que agrega este PR.

---

## Decisiones

### 1. `BlockScope`, y `everyone` es sólo para mostrar

`getEffectiveBlocks` recibe un alcance explícito, no un `professionalId` opcional:

```ts
export type BlockScope =
  | { kind: 'business' }                             // sólo los del negocio
  | { kind: 'professional'; professionalId: string } // los del negocio + los de esa persona
  | { kind: 'everyone' }                             // TODOS — para mostrar, nunca para calcular
```

Tres motivos para el tipo en vez de un `professionalId: string | null`:

- **`null` y "todos" no son lo mismo y hoy se confundirían.** El calendario del panel
  (`getTimeBlocksByRange`) tiene que **mostrar** los bloqueos de todo el equipo; el
  cálculo de slots del negocio tiene que ignorarlos (las vacaciones de Juan no cierran el
  local). Un solo `professionalId: null` para las dos cosas daría un calendario que
  esconde bloqueos o un local que cierra de más.
- **`undefined` en un `where` de Prisma no filtra: matchea todo** (landmine del repo). Un
  parámetro obligatorio con tres casos nombrados no tiene forma de llegar en `undefined`.
- **El orden posicional era una trampa**: `getEffectiveBlocks(businessId, start, end, timezone, professionalId)`
  tiene dos `string` pegados y cambiarlos de lugar compila. Por eso la firma pasa a
  objeto.

### 2. Herencia: sin filas propias, el horario es el del negocio

`resolveAvailabilityRules(businessId, professionalId)`:

- `professionalId === null` → las reglas con `professionalId: null` (las de hoy).
- una persona **con** filas propias → **sólo** las suyas.
- una persona **sin ninguna** fila propia → las del negocio.

La alternativa era sembrarle a cada persona sus 7 reglas al crearla. Se descarta por dos
razones: la gente cargada por el PR A ya existe sin reglas (habría que backfillear), y
sobre todo porque después la dueña cambia el horario del salón y **no se propaga** — se
queda editando N+1 horarios sin entender por qué el nuevo no aplica.

Con herencia, sumar gente no puede romper la disponibilidad de nadie: hasta que la dueña
decida lo contrario, todos atienden en el horario del salón.

**La herencia es "todo o nada" a propósito, no por día.** Si fuera por día, alguien que
trabaja sólo los sábados heredaría el horario del negocio de lunes a viernes — que es
justo lo contrario de lo que la dueña configuró. Tener una sola fila propia ya significa
"esta persona tiene su horario".

**El costo se paga en el PR de escritura y hay que decirlo acá**: materializar el horario
de una persona tiene que copiar **las 7 filas en una sola operación**. Si la pantalla
deja editar el lunes de un horario heredado y eso crea una única fila, la persona queda
con lunes y **cerrada de martes a domingo**, en silencio. Ese es el bug más caro del PR
siguiente y nace de esta decisión.

### 3. `EffectiveBlock` se lleva `professionalId`

`EffectiveBlock` es un tipo **proyectado** y se construye en dos lugares: el `.map` de
los bloqueos sueltos (`effective-blocks.ts`) y adentro de `expandSeries`
(`lib/calendar/expand-series.ts`). Un `professionalId` que entre al filtro pero no a la
proyección deja los **recurrentes sin dueño** aguas abajo — el calendario no podría
distinguir el feriado del salón de las vacaciones de Juan.

### 4. Una reserva sin persona choca contra todos

En el SQL crudo de `findBookingOverlap`, para una reserva **con** persona:

```sql
AND ("professionalId" IS NULL OR "professionalId" = ${professionalId})
```

Sin cláusula cuando la reserva nueva no tiene persona. Es conservador a propósito: las
reservas de antes del equipo no tienen dueño y nunca queremos meterle una cita encima a
alguien.

### 5. El advisory lock se queda grueso

`acquireAdvisoryXactLock(tx, "${businessId}:${localStartStr}")`, sin la persona. Meterla
en la llave **rompe la serialización**: una reserva vieja con `professionalId = null`
tomaría otro lock, no se serializaría contra las que sí tienen persona, y entrarían las
dos. El costo de dejarlo grueso son milisegundos de espera entre dos clientas del mismo
día.

### 6. Fuera de este PR, a propósito

- **Escribir** horario o bloqueos por persona, y toda la UI. Es el PR siguiente.
- **El paso de elegir persona en el funnel** y `professionalId` en el `create` de la
  reserva. PR D — y necesita antes que `Booking_no_overlap` (el EXCLUDE de Postgres) sepa
  de la persona, que es un PR aparte con chequeo de datos de producción.
- **Los contadores de onboarding** (`availabilityRule.count`, 3 sitios): hoy cuentan
  todas las reglas activas y mientras nadie tenga reglas propias siguen dando lo mismo.
  Van con el PR que puede crear reglas por persona, que es cuando empiezan a mentir.

---

## Archivos

- Modificar: `src/lib/availability/effective-blocks.ts` — firma a objeto, filtro en las
  dos queries, `professionalId` en la proyección.
- Modificar: `src/lib/calendar/expand-series.ts` — `professionalId` en `SeriesLike` y en
  `EffectiveBlock`.
- Crear: `src/lib/availability/scope.ts` — `resolveAvailabilityRules`, `blockScopeFor`.
- Modificar: `src/server/actions/availability.ts` — `_getAvailableTimeSlots`.
- Modificar: `src/lib/availability/reschedule-slots.ts` — las dos vías de reprogramar.
- Modificar: `src/app/dashboard/availability/page.tsx` — el fit con alcance del negocio.
- Modificar: `src/server/actions/time-blocks.ts` — `getTimeBlocksByRange` (`everyone`) y
  `serviceFitAddendum`.
- Modificar: `src/lib/availability/validation.ts` — regla, bloqueos y SQL crudo.
- Modificar: `src/lib/bookings/draft.ts` (si hace falta pasar la persona al validar).
- Tests: `tests/unit/availability-scope.test.ts` (nuevo),
  `tests/unit/get-time-blocks-by-range.test.ts`, `tests/integration/effective-blocks.test.ts`,
  `tests/integration/availability-por-persona.test.ts` (nuevo).

---

## Tareas

### Tarea 1 — `getEffectiveBlocks` con alcance explícito

- [ ] `BlockScope` + firma a objeto en `effective-blocks.ts`
- [ ] filtro en la query de `timeBlock` **y** en la de `timeBlockSeries`
- [ ] `professionalId` en las **dos** construcciones de `EffectiveBlock`
- [ ] los 5 call sites eligen su alcance (el calendario, `everyone`)
- [ ] `npx tsc --noEmit` de vuelta en la línea base

### Tarea 2 — `scope.ts`

- [ ] `resolveAvailabilityRules(businessId, professionalId)` con la herencia
- [ ] test unitario: hereda sin filas propias, no hereda con una sola, negocio con null

### Tarea 3 — los tres lectores

- [ ] `_getAvailableTimeSlots` toma el alcance del `professionalId` que le llegue
- [ ] `computeRescheduleSlots` lo toma del `booking.professionalId`
- [ ] `computeServiceFit` en la página de Disponibilidad, alcance del negocio

### Tarea 4 — `validation.ts`

- [ ] lookup de la regla con `professionalId` **explícito** (`?? null`, nunca `undefined`)
- [ ] `findTimeBlockConflict` con el alcance
- [ ] cláusula de persona en las **dos** ramas del SQL crudo
- [ ] revivir (`assertSlotFreeOfConflicts`) pasa la persona de la reserva

### Tarea 5 — tests

- [ ] integración: bloqueo de una persona no cierra el local; del negocio sí cierra a todos
- [ ] integración: reserva sin persona choca contra todos; con persona sólo con ella
- [ ] integración: la persona sin reglas propias hereda; con reglas propias no
- [ ] `slot-conflicts.test.ts` y `booking.test.ts` siguen verdes sin tocarlos

### Tarea 6 — verificación

- [ ] `npx vitest run` completo
- [ ] `npx eslint src tests` sin errores nuevos
- [ ] `rm -rf .next/dev/types && npx tsc --noEmit` en la línea base (17)
- [ ] PR con el cuerpo explicando que es un no-op observable
