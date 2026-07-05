# Fixes de disponibilidad y flujo de reserva — Diseño

**Fecha:** 2026-07-05
**Estado:** aprobado en conversación; pendiente revisión final del spec
**Origen:** reporte real del negocio de Jackeline (`cmqx6vu7n00023iabktw4sviv`, tz `America/Santiago`)

## Diagnóstico (reproducido contra datos de producción, solo lectura)

Configuración real: Mar 14:00–17:30 · Jue/Vie/Sáb 09:00–14:30 · Lun/Mié inactivos. Servicios: MANICURA RUSA 225 min, ESMALTADO 90 min. Serie recurrente "Almuercito" 12:00–14:00 lun–sáb desde 2026-07-02.

1. **"Viernes sin horas"**: la MANICURA (225 min) no cabe en ningún día — martes la ventana dura 210 min; jue/vie/sáb el único inicio posible (09:00→12:45) choca con el almuerzo 12:00–14:00. Desde que existe la serie, el servicio es imposible de reservar en todo el calendario y la dueña no tiene forma de saberlo.
2. **"Jueves solo aparece 12pm"**: lead time de 120 min oculto (`slots.ts`) + reserva existente 10:30–12:00 + slots anclados a apertura con paso = duración (no se re-anclan tras obstáculos) → solo quedaba el candidato de las 12:00.
3. **"Martes 4 horas → 3 al refrescar"**: el corte de lead time es móvil (mirando el día actual) y los holds `pending_payment` bloquean slots hasta expirar. Comportamiento por diseño pero invisible.
4. **Rate limit**: `getAvailableTimeSlots` usa `checkRateLimit('available-slots', 10, 60000)` — 10 clicks de fecha por minuto por IP lo agotan y la UI titula el error "No hay horarios disponibles". Existe config `'get-availability'` (60/min) sin usar.

Auditoría adicional (2 agentes, código + runtime): tests unitarios de disponibilidad en verde (53/53).

## Alcance: 5 PRs en orden

### PR 1 — Honestidad de la UI + fixes chicos (sin migración)

- Rate limit: usar `checkRateLimit('get-availability')` (config 60/min) en `getAvailableTimeSlots`; quitar el override 10/min.
- `step-time.tsx`: estado de error separado del estado "sin horas" (hoy el catch cae en el mismo layout); en error, mensaje propio + botón reintentar.
- Lead time visible: constante compartida `LEAD_TIME_MINUTES = 120` en `src/lib/availability/` (hoy duplicada en `slots.ts` y `validation.ts`); en `step-time`, cuando el día consultado es hoy, aviso "las horas con menos de 2 h de anticipación no se muestran".
- Walk-ins de la dueña: `assertSlotIsAvailable` acepta `options.leadTimeMinutes`; `createBookingFromDashboard` y `rescheduleBooking` pasan `0` (la dueña puede anotar a quien entra por la puerta). El flujo público mantiene 120.
- Validar `startTime < endTime` en `updateAvailabilityRule` (zod refine, como ya hacen los schemas de bloqueos) + chequeo con mensaje en `availability-editor.tsx`. Hoy una regla invertida mata el día en silencio.
- Infra: `vitest.config.ts` excluye `**/.worktrees/**` pero los worktrees viven en `.claude/worktrees/` → agregar `**/.claude/**` al exclude.

### PR 2 — Timezone del negocio en todo el flujo

Problema: el wizard público construye el día seleccionado con la medianoche del dispositivo (`step-date.tsx:16`) y muestra horas con `toLocaleTimeString`/`format` del navegador (`step-time.tsx:96`, confirmación, pago). Una clienta en otro huso consulta el día equivocado y ve horas distintas a las reales. El form del dashboard (`new-booking-form.tsx:238`) tiene el mismo bug lado dueña; `reschedule-form.tsx:60` es el patrón correcto (`fromZonedTime`).

- El wizard recibe `business.timezone` como prop.
- `step-date`: el instante de consulta se construye con `fromZonedTime('<yyyy-MM-dd> 12:00', tz)` (mediodía local del negocio, inmune a bordes DST). Sin cambio de firma del server action.
- Todas las horas/fechas visibles al cliente (`step-time`, `step-confirmation`, `step-payment`) se formatean con `formatInTimeZone(..., business.timezone, ...)`.
- `new-booking-form`: construir el instante con `fromZonedTime` espejo de reschedule; el `min` del input de fecha usa la fecha local del negocio (hoy usa `toISOString()`, que de noche en Chile bloquea "hoy").

### PR 3 — Re-anclaje de slots (decisión: opción B, no grilla fija)

`generateSlots` pasa de "grilla anclada a apertura con paso = duración" a **subtracción de intervalos**:

1. Intervalos libres del día = ventana de la regla − bloqueos efectivos − reservas activas (mismos filtros de status/hold actuales).
2. En cada intervalo libre, slots anclados al inicio del intervalo, paso = duración, mientras quepan.
3. El grid dentro de cada intervalo es estable respecto al reloj: el lead time solo filtra candidatos (`start < now + LEAD_TIME`), no re-ancla — los slots desaparecen al pasar el corte pero nunca se corren de hora.
4. Paridad con validación en el borde de la ventana: excluir slots con `start > now + bookingWindowDays` (hoy `slots.ts:71-75` filtra por inicio de regla y `validation.ts:57-61` por slot → el último día ofrece slots inbookeables).

Efecto: los slots quedan pegados al término de cada cita/bloqueo (agenda compacta, sin huecos muertos). Las reservas off-grid (dashboard con hora libre) dejan de fragmentar la disponibilidad por diseño. `assertSlotIsAvailable` no exige grid, así que no cambia.

Nota de expectativas: esto NO rescata a la MANICURA de 225 min — no cabe estructuralmente con el almuerzo actual. Para eso están el PR 4 (avisos) y el PR 5 (tolerancia).

### PR 4 — Avisos en el dashboard (servicio que no cabe + conflictos de bloqueos)

- Helper puro `computeServiceFit(services, rules, effectiveBlocks, tz)`: simula los próximos 7 días (sin reservas, sin lead time) reutilizando `generateSlots`; devuelve por servicio qué días de la semana tienen ≥1 slot posible.
- Página de disponibilidad: banner por cada servicio con 0 días ("MANICURA RUSA no cabe en ningún día con tu horario y bloqueos actuales"), con detalle de por qué (ventana más larga disponible vs duración).
- Formularios de bloqueo (suelto y serie, crear y editar): antes de guardar se calcula (a) reservas pendientes/confirmadas que chocan, (b) servicios que quedarían sin ningún día con slots; se muestra diálogo de confirmación. Esto **unifica** el flujo `requiresConfirmation` que hoy solo tienen los bloqueos sueltos:
  - `createTimeBlockSeries` hoy crea primero y avisa después (`time-blocks.ts:241-268`) → pasar a confirmar antes de crear.
  - `updateTimeBlockSeries` y `overrideSeriesOccurrence` hoy no chequean nada (`time-blocks.ts:295-374`) → agregar el mismo chequeo.
- Fix menor: el chequeo de conflictos de bloqueos sueltos cuenta holds `pending_payment` ya expirados como conflicto (`time-blocks.ts:76`) → filtrar por `holdExpiresAt`.

### PR 5 — Tolerancia de solape con bloqueos (única migración del batch)

- Schema: `overlapToleranceMinutes Int @default(0)` en `TimeBlock` y `TimeBlockSeries`. Migración por archivo con el flujo normal (`prisma migrate` + deploy); **nunca** `db execute` manual (ya rompió un deploy de Vercel).
- Semántica: una cita puede invadir hasta X min por cada borde del bloqueo — el test de solape usa `[start + X, end − X]`. Validación en zod/form: `X ≤ (duración del bloqueo) / 2`.
- `EffectiveBlock` transporta la tolerancia; `expandSeries` la propaga; `generateSlots` y `assertSlotIsAvailable` la aplican (mismo par de sincronía de siempre).
- El calendario de la dueña sigue mostrando el bloqueo completo; si una cita lo invade, el solape se ve (refleja la realidad: "hoy almuerzo 12:45").
- UI: campo opcional en `BlockFormFields` ("Permitir que una cita invada hasta X min").
- Caso objetivo: tolerancia 45 en "Almuercito" → la MANICURA recupera el slot 09:00–12:45 jue/vie/sáb.

## Backlog documentado (no entra en este batch)

Con evidencia de la auditoría; cada uno puede ser su propio PR después:

1. **DST septiembre (Chile)**: `fromZonedTime('<día DST> 00:00')` resuelve al día anterior → excepciones de serie ignoradas ese domingo (`expand-series.ts:59,89`), reschedule consulta el día equivocado (`reschedule-form.tsx:60` con medianoche), anchor de serie corrido (`block-time-modal.tsx:134`). Mitigación parcial: PR 2 usa mediodía para consultas del wizard. Verificado en runtime.
2. **Ocurrencia de serie movida a otro día queda invisible** para disponibilidad y validación (`expandSeries` solo emite en `daysOfWeek`; `edit-series-occurrence-dialog.tsx` permite cambiar la fecha) → se puede reservar encima del bloqueo movido.
3. **Carrera pago/expiración de hold**: el flujo de confirmación de pago (`finance.ts`) no toma advisory lock ni re-chequea solape al flipear `pending_payment → confirmed` → dos reservas confirmadas en el mismo slot (ventana chica, impacto alto).
4. **Calendario público sin señales**: no indica qué días tienen horas ni el límite de `bookingWindowDays` (navegación infinita de meses) → clickeo a ciegas.
5. **Mensajería de holds**: el hold de 15 min es invisible para la clienta; al perder el slot en checkout, "Intentar de nuevo" reintenta el mismo slot condenado; inconsistencia 15 min (público) vs 60 min (dashboard).
6. **Lead time configurable por negocio** (columna `leadTimeMinutes` en `Business`): puede montarse sobre la migración del PR 5 si se quiere.
7. **Cache 60 s de servicios en checkout**: precio potencialmente desactualizado al pagar (`business/public.ts:59-72`).

## Testing

- TDD por PR (test que falla primero). Unit tests en `tests/unit/`; los component tests deben mockear `next/navigation`.
- PR 3 reescribe buena parte de `tests/unit/slots.test.ts` (el paso/anclaje cambia por diseño; los casos de lead time, holds y window se conservan).
- e2e: no es check requerido en CI y el smoke de public-booking es flaky conocido — verificar localmente lo crítico del wizard tras PR 2.

## Decisiones registradas

- Re-anclaje (B) sobre grilla fija (A): prioriza agenda compacta sin huecos muertos (preferencia típica de salones) sobre máxima variedad de inicios.
- Tolerancia de solape entra como PR final separado por la migración.
- Lead time queda hardcodeado (120) pero visible y compartido; configurable va a backlog.
- El flujo de la dueña opera con lead time 0; el público mantiene 120.
