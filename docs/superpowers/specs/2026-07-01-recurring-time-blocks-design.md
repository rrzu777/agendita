# Bloqueos de horario recurrentes (#1) — Diseño

**Fecha:** 2026-07-01
**Estado:** Aprobado, pendiente de plan de implementación
**Requisito previo:** #3 (relleno de color, PR #33) y #2 (editar/eliminar bloqueo o reserva, PR #34) ya en `main`.

## Objetivo

Permitir que un negocio cree un **bloqueo de horario recurrente** (ej. un almuerzo todos los días de lunes a jueves) en vez de tener que crear un bloqueo suelto por cada día. Debe poder:

- Marcar la recurrencia como **opcional** (un bloqueo puede seguir siendo suelto).
- Elegir **duración**: para siempre, 1 mes, o N semanas.
- Elegir **días de la semana** (ej. Lun–Jue).
- **Saltar** o **editar** ocurrencias individuales, o editar/eliminar **toda la serie**.

## Enfoque elegido: expandir al leer (modelo de Google Calendar)

Se evaluaron tres enfoques:

- **A — Materializar ocurrencias + serie padre + cron.** Genera una fila `TimeBlock` por ocurrencia; los consumidores no cambian. Descartado: "para siempre" exige un cron de extensión de horizonte, y en Vercel free el cron es best-effort/diario/poco fiable — apoyar la *correctitud* de un bloqueo permanente en él es frágil.
- **B — Guardar la regla y expandir al leer (elegido).** Es el modelo de iCalendar/RFC 5545 y de la Google Calendar API: se guarda la **regla** (`RRULE`) y las ocurrencias se **expanden en tiempo de lectura**; las excepciones se guardan como skips (`EXDATE`/status `cancelled`) y overrides (`recurringEventId` + `originalStartTime`). "Para siempre" = sin `UNTIL`/`COUNT`, sin horizonte, sin cron.
- **C — Híbrido (materializar perezosamente al leer).** Efectos de escritura en caminos de lectura; más piezas móviles. Descartado.

**Por qué B es seguro aquí:** el único consumidor sensible a concurrencia es la validación anti-doble-reserva (`src/lib/availability/validation.ts`). Se verificó que el chequeo de bloqueo (`validation.ts:99`) es una **simple consulta de existencia que corre ANTES** del `pg_advisory_xact_lock` y del `FOR UPDATE`. La maquinaria de concurrencia protege booking-vs-booking, no el chequeo de bloqueos. Por tanto expandir la regla **en memoria** para ese chequeo no pierde ninguna garantía.

**Referencias:** [Google Calendar API — Recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents), [Calendars & events](https://developers.google.com/calendar/api/concepts/events-calendars), [RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545).

## Modelo de datos

`TimeBlock` **no cambia** (byte-idéntico). Sigue representando bloqueos **sueltos**; todo el código del #2 (crear/editar/eliminar suelto) queda intacto.

### Nueva tabla `TimeBlockSeries` (la regla)

```prisma
model TimeBlockSeries {
  id          String    @id @default(cuid())
  businessId  String
  daysOfWeek  Int[]                       // 0-6 (0 = domingo), qué días de la semana
  startTime   String                      // "HH:mm" local
  endTime     String                      // "HH:mm" local (mismo día; end > start)
  reason      String?
  anchorDate  DateTime                    // fecha local de inicio (00:00 en tz del negocio)
  until       DateTime?                   // null = para siempre; "1 mes"/"N semanas" se calcula al crear
  isActive    Boolean   @default(true)
  createdAt   DateTime  @default(now())

  business    Business  @relation(fields: [businessId], references: [id], onDelete: Cascade)
  exceptions  TimeBlockException[]

  @@index([businessId, isActive])
}
```

### Nueva tabla `TimeBlockException` (skips + overrides)

```prisma
model TimeBlockException {
  id             String   @id @default(cuid())
  seriesId       String
  occurrenceDate DateTime                 // fecha local de la ocurrencia afectada (00:00 en tz)
  isSkipped      Boolean  @default(false) // true = ocurrencia saltada (EXDATE)
  startDateTime  DateTime?                // override: nueva hora inicio (mismo día)
  endDateTime    DateTime?                // override: nueva hora fin (mismo día)
  reason         String?                  // override: nuevo motivo

  series         TimeBlockSeries @relation(fields: [seriesId], references: [id], onDelete: Cascade)

  @@unique([seriesId, occurrenceDate])
}
```

## Convenciones y restricciones (decisiones cerradas)

1. **Solo mismo día.** Una ocurrencia recurrente empieza y termina el mismo día local (`end > start`, misma fecha). Sin bloqueos recurrentes que crucen medianoche. (Los sueltos siguen pudiendo durar hasta 32 días.)
2. **Override = solo hora/motivo, mismo día.** Editar una ocurrencia individual cambia hora inicio/fin y/o motivo **dentro de su día base**; nunca la mueve a otra fecha. Así `occurrenceDate` siempre coincide con el día base y la lógica de rango es limpia (sin ocurrencias que entran/salen del rango por el borde).
3. **Editar "toda la serie" = split en hoy.** No se reescribe la regla in situ (eso reescribiría el pasado en un modelo expand-on-read). Se hace lo que hace Google con "esta y las siguientes", anclado en hoy: `until = hoy` en la serie vieja + **serie nueva** desde hoy con la regla nueva. El pasado queda inmutable; las reservas ya hechas no se tocan. Esto **resetea las excepciones futuras** de la serie (comportamiento oficial de Google).
4. **Aviso al editar toda la serie.** Antes de confirmar un cambio de serie que descartaría ediciones/skips individuales futuros, la UI muestra un aviso ("esto restablecerá los días que editaste sueltos").
5. **Timezone.** `startTime`/`endTime` son locales ("HH:mm"); `anchorDate`/`until`/`occurrenceDate` representan un **día local** (se guardan como 00:00 en la tz del negocio). Toda comparación de "qué día es" se hace con `formatInTimeZone(..., 'yyyy-MM-dd')` (como `validation.ts:78`), nunca por instante UTC crudo. La composición de cada ocurrencia usa `fromZonedTime` (DST-safe), como el `EditBlockDialog` del #2.
6. **Tope de rango en la expansión.** `expandSeries` acota el número de días que expande (p. ej. máx. ~400 días) para que una vista amplia no expanda sin límite.
7. **Guardas.** Todas las acciones nuevas replican el patrón existente: `requireBusinessRole(['owner','admin'])` + `checkRateLimit` + `await revalidateBusinessPublicPaths(businessId)` (esta última **siempre** con `await`).

## Expansión (el corazón)

### Función pura `expandSeries`

```
expandSeries(series, exceptions, rangeStart, rangeEnd, timezone) -> EffectiveBlock[]
```

Recorre los días locales del rango (acotado por el tope), y para cada día:
- lo descarta si su día-de-semana no está en `daysOfWeek`, si es anterior a `anchorDate`, o si `until` existe y el día es posterior;
- compone `startDateTime`/`endDateTime` con `fromZonedTime(diaLocal + "HH:mm", timezone)`;
- si hay excepción para ese `occurrenceDate`: si `isSkipped` la omite; si es override, usa su hora/motivo;
- ignora excepciones cuyo día ya no genera la regla (huérfanas).

`EffectiveBlock = { id, startDateTime, endDateTime, reason, seriesId?, occurrenceDate? }`. Los bloqueos sueltos traen el `id` real del `TimeBlock` y `seriesId`/`occurrenceDate` en `undefined`. Las ocurrencias recurrentes traen un **id sintético estable** (`` `${seriesId}:${occurrenceDateISO}` ``) para el `key` de React y para que el diálogo de edición sepa a qué serie + fecha apunta.

### Helper `getEffectiveBlocks`

```
getEffectiveBlocks(businessId, rangeStart, rangeEnd) -> EffectiveBlock[]
```

Une (a) bloqueos sueltos `TimeBlock` del rango + (b) ocurrencias expandidas de las series activas del negocio (con sus excepciones). Devuelve la forma que ya consumen los callers.

### Sitios de enrutado (4)

- `src/server/actions/availability.ts` — las dos `prisma.timeBlock.findMany` que alimentan `computeAvailableSlots` pasan por `getEffectiveBlocks`.
- `src/lib/availability/validation.ts:99` — el chequeo de existencia de bloqueo se resuelve expandiendo en memoria (seguro: corre antes del lock).
- `src/server/actions/time-blocks.ts` — `getTimeBlocksByRange` (calendario dashboard) pasa por `getEffectiveBlocks` para que el calendario muestre ocurrencias recurrentes.

## Flujo de creación

En `BlockFormFields`/`BlockTimeModal` se añade un checkbox **"Repetir"**. Al activarse, revela:
- **Chips de días** (Lun–Dom); default = el día de la fecha elegida.
- **Fin**: radio "Para siempre / 1 mes / N semanas" (+ input numérico para N).

- **Apagado** → crea un `TimeBlock` suelto llamando a `createTimeBlock` (sin cambios).
- **Encendido** → llama a nueva acción `createTimeBlockSeries(data)` (deja `createTimeBlock` intacta). Calcula `until` (forever → `null`; 1 mes → `addMonths(anchor, 1)`; N semanas → `addWeeks(anchor, N)`).

**Solape con reservas (crear igual + avisar):** al crear la serie, se calculan las ocurrencias dentro de la ventana de reserva del negocio y se listan los días que se solapan con reservas existentes. La serie **se crea igual** (no se cancelan reservas); el resultado devuelve un aviso con los días en conflicto para mostrarlo en la UI. Coherente con el flujo de bloqueo suelto actual.

## Flujo de editar / saltar

El calendario ya distingue una ocurrencia recurrente (trae `seriesId`) de un bloqueo suelto:

- **Suelto** → `EditBlockDialog` del #2, **sin cambios**.
- **Recurrente** → diálogo que en **Guardar** y en **Eliminar** ofrece **"Solo este día / Toda la serie"**:

| Acción | "Solo este día" | "Toda la serie" |
|---|---|---|
| Guardar (editar) | crea/actualiza excepción **override** (`upsert` por `[seriesId, occurrenceDate]`) | `updateTimeBlockSeries`: **split en hoy** (regla nueva desde hoy), con aviso de reset |
| Eliminar | crea excepción **skip** (`isSkipped = true`) | `deleteTimeBlockSeries`: desactiva/borra la serie + sus excepciones (cascade) |

**Gestión de una serie sin pasar por una ocurrencia (decisión: MVP opción i):** se gestiona clicando una ocurrencia en el calendario (como Google). La página `/dashboard/availability`, que hoy lista `TimeBlock` crudos, muestra además una sección **"Bloqueos recurrentes"** en solo-lectura con un botón para eliminar la serie completa. Sin editor de series independiente (YAGNI).

## Nuevas acciones de servidor (`time-blocks.ts`)

Todas `async` (respetando el límite de `'use server'`: solo funciones exportadas), con `requireBusinessRole(['owner','admin'])`, `checkRateLimit`, y `await revalidateBusinessPublicPaths`:

- `createTimeBlockSeries(data)` → crea serie, calcula `until`, devuelve serie + aviso de solapes.
- `skipSeriesOccurrence(seriesId, occurrenceDate)` → upsert excepción `isSkipped`.
- `overrideSeriesOccurrence(seriesId, occurrenceDate, { startDateTime, endDateTime, reason })` → upsert excepción override (mismo día).
- `updateTimeBlockSeries(seriesId, newRule)` → split en hoy.
- `deleteTimeBlockSeries(seriesId)` → borra serie + excepciones.
- `getTimeBlockSeries()` → lista series activas del negocio (para la sección de disponibilidad).

## Impacto en consumidores

Ninguna interfaz consumida cambia de forma: `computeAvailableSlots`, la validación de reservas y el calendario siguen recibiendo `{ startDateTime, endDateTime, reason }[]`. Solo cambia **de dónde** salen esos objetos (ahora por `getEffectiveBlocks`, que incluye ocurrencias expandidas).

## Estrategia de tests (TDD, red → green)

- **`expandSeries` (pura, exhaustiva):** filtro por día de semana; `anchorDate` como piso; `until` inclusivo/forever + tope de rango; cálculo de "N semanas"/"1 mes"; transición DST; exclusión de skip; aplicación de override; excepción huérfana ignorada.
- **`getEffectiveBlocks`:** unión de sueltos + series; excepciones aplicadas.
- **Acciones:** `createTimeBlockSeries` (cálculo de `until`, aviso de solape); `skipSeriesOccurrence`; `overrideSeriesOccurrence`; `updateTimeBlockSeries` (split en hoy + reset de excepciones futuras, pasado inmutable); `deleteTimeBlockSeries`.
- **Integración de consumidores:** un almuerzo recurrente bloquea un slot público; saltarlo lo libera; la validación de reserva rechaza un slot dentro de una ocurrencia.
- **Render de UI:** con `vi.mock('next/navigation', ...)` (los componentes usan `useRouter`); `renderToStaticMarkup` solo verifica "renderiza sin lanzar" + markup fuera del portal (Radix Dialog usa Portal).

## Landmines del proyecto a respetar

- `'use server'`: **solo** exportar funciones `async` (tipos/consts no-función crashean en runtime).
- `revalidateBusinessPublicPaths`: **siempre** con `await` (sin await mata el proceso, exit 128).
- Tests de componentes: mockear `next/navigation` o `renderToStaticMarkup` lanza "invariant expected app router to be mounted".

## Fuera de alcance (YAGNI)

- Opción de UI "esta y las siguientes" (el mecanismo de split existe internamente, pero no se expone como tercera opción).
- Recurrencia mensual/quincenal, intervalos (cada 2 semanas), `BYMONTHDAY`, etc.
- Editor independiente de series en la página de disponibilidad (solo lectura + eliminar).

## Migración

Aditiva: dos tablas nuevas (`TimeBlockSeries`, `TimeBlockException`). `TimeBlock` sin cambios. Sin migración de datos.
