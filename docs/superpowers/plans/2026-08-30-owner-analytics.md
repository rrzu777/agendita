# Owner Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar adquisición, embudo de reservas y un dashboard para dueños con datos verificables, captura consentida y retención acotada.

**Architecture:** Seis tablas nuevas en PostgreSQL separan sesiones, intentos, eventos, enlaces, cobertura y agregados diarios. Booking y los dominios transaccionales conservan la autoridad sobre creación, pagos, canjes y estado actual. Contratos puros compartidos, captura POST firmada, worker acotado de consolidación/limpieza y dashboard autorizado sin eventos crudos en el cliente.

**Tech Stack:** Next.js 16.3.2 App Router, React 19.2.8, TypeScript, Prisma 5.22, PostgreSQL, Zod 4, Vitest 4, Playwright, Upstash REST existente; sin librería nueva de charts.

**Spec:** `docs/superpowers/specs/2026-08-30-owner-analytics-design.md`

**Autorización:** el usuario aprobó implementar el diseño y confirmó crear el worktree con “ok dale ejecuta”. Worktree: `.worktrees/owner-analytics`, rama `feature/owner-analytics`. No autorizó despliegue, activación, envío de mensajes, cobros reales ni cambios remotos.

## Global Constraints

- Base comprobada mediante `git ls-remote origin refs/heads/main`: `c5ea7146e936ab41a8df60e79c3fbd34a84cdf1a`. El checkout principal sigue en `216f47e345b585ffa0dd6603af8b327e5698533a`, rama de tours; no implementar sobre esa base antigua.
- Preservar el spec no trackeado y todos los worktrees existentes. No limpiar ni cambiar sus ramas.
- Leer las guías pertinentes de `node_modules/next/dist/docs/` antes de escribir código Next.js.
- `OWNER_ANALYTICS_ENABLED=false` por defecto y lista explícita de negocios habilitados.
- Captura opt-in, no preseleccionada, sin bloquear ni condicionar la reserva.
- Sin identificador, bootstrap, eventos ni cola de analytics antes de aceptar.
- Ventana de conversión: 24 horas desde el inicio del intento. Sesión: máximo 24 horas; un intento tiene su propio vencimiento.
- Entradas completas y parciales separadas. No llamar personas únicas o leads a sesiones/intentos.
- `attemptStartedAt <= Booking.createdAt < conversionDeadlineAt`; el commit o el evento visual no sustituyen ese timestamp.
- 20 eventos y 16 KiB por lote; 200 eventos por intento y por stream de superficie de sesión.
- 10 bootstraps/minuto por IP y negocio; 30 lotes/minuto por intento.
- Cola de máximo 100 eventos; envío cada 5 segundos o al cambiar visibilidad; dos reintentos transitorios con backoff; descartar eventos con más de cinco minutos sin enviar.
- Retención cruda: 90 días desde el inicio de sesión, copiada a hijos/snapshot; tolerancia operativa de borrado de hasta 24 horas adicionales.
- Agregados: 90 días en esta implementación. La opción de 13 meses permanece bloqueada hasta aprobar su política y procedimiento de borrado.
- Preferencia de consentimiento versionada por negocio y origen web durante 180 días.
- Job de limpieza cada hora, lotes de 1.000 y máximo 10.000 filas por invocación, con continuaciones idempotentes. Pausar captura cuando el vencido más antiguo lleva 12 horas pendiente.
- Sin presupuesto global y por negocio configurado y validado, no activar captura. Sin limitador distribuido en producción, no capturar.
- Sin nombres, email, teléfono, dirección, notas, identificador de cliente, IP persistida en analytics, user agent completo, URL/referrer completos, textos de error, códigos de promo crudos ni credenciales en eventos/logs.
- Owner/admin únicamente: permisos en página, DAL y cada mutación; negocio derivado de sesión autenticada.
- No IA semanal, recuperación comercial, nuevo resumen financiero, publicación de PR, push ni activación productiva.

## Execution and quality gates

Cada tarea sigue rojo → implementación mínima → verde → revisión independiente de especificación/calidad → corrección/revisión → verificación → commit local. No iniciar una tarea dependiente antes de aprobar la anterior. Registrar comandos y resultados en el ledger del plan. El trabajo de lectura, preparación de fixtures y revisión de riesgos puede avanzar en paralelo, sin múltiples implementadores escribiendo a la vez.

Antes de ejecutar:

- [x] Resolver la preferencia de worktree: `.worktrees/owner-analytics`, rama `feature/owner-analytics`, base exacta anterior; carpeta ignorada verificada y autorización recibida.
- [x] Copiar spec/plan al worktree con su contenido íntegro; originales conservados en checkout principal.
- [x] Instalar dependencias propias con `npm ci --ignore-scripts`; 819 paquetes, sin enlazar `node_modules`.
- [x] Usar URLs sintéticas loopback al generar/validar Prisma. No cargar `.env.local` del proyecto.
- [x] Ejecutar baseline unitario y typecheck en la base exacta; 402 archivos/3674 pruebas aprobadas y una omitida, typecheck aprobado. Evidencia en el ledger.
- [x] Crear una base local desechable exclusiva `agendita_owner_analytics_test`; PostgreSQL16 en 127.0.0.1:55439, ambas URLs sintéticas explícitas, 54 migraciones base aplicadas. No usar el guard genérico como única verificación.

## Module and interface map

| Área | Archivos nuevos principales | Responsabilidad |
| --- | --- | --- |
| Contratos | `src/lib/analytics/contracts.ts`, `policy.ts`, `attribution.ts`, `credential.ts` | Schemas cerrados, límites, normalización y firma/verificación server-only. |
| Cálculo | `src/lib/analytics/funnel.ts`, `daily-metrics.ts`, `report-types.ts` | Reductor determinista, poblaciones, celdas y DTOs sin acceso a red/DB. |
| Captura server | `src/lib/analytics/public-context.ts`, `budget.ts`, `ingest.ts`, `booking-snapshot.ts` | Tenant verificado, presupuestos atómicos, bootstrap/replay y asociación opcional. |
| Consultas/jobs | `src/server/analytics/repository.ts`, `reports.ts`, `maintenance.ts` | Consultas por tenant, proyecciones acotadas, publicación y purga. |
| Captura cliente | `src/lib/analytics/client-store.ts`, `client-transport.ts`, `src/components/analytics/public-analytics.tsx` | Consentimiento, propiedad del stream, cola persistida y contexto de React. |
| Dashboard | `src/components/dashboard/analytics/` y `src/app/dashboard/metricas/` | Cards, series SVG, embudo, tablas, calidad y enlaces. |

Los nombres exportados definidos abajo forman el contrato entre tareas. Si un cambio resulta necesario, actualizar productor y consumidores en el plan/ledger antes de delegar el consumidor.

## Task 1: Contratos, esquema y cálculo puro

**Files:**
- Modify: `prisma/schema.prisma`.
- Create: `prisma/migrations/20260831000000_owner_analytics/migration.sql`.
- Create: los siete módulos de contratos/cálculo del mapa anterior.
- Create: `tests/unit/analytics-contracts.test.ts`, `analytics-credential.test.ts`, `analytics-funnel.test.ts`, `analytics-daily-metrics.test.ts`.
- Create: `tests/integration/analytics-schema.test.ts`.

**Interfaces:**
- `analyticsEventSchema`: unión Zod estricta de todos los eventos de la sección 4 del spec; `AnalyticsEventInput = z.infer<typeof analyticsEventSchema>`.
- Evento común: `eventId: UUID`, `type`, `sequence: entero positivo`, `selectionRevision` cuando corresponde y `data` cerrada por tipo. Business/session/attempt del registro se derivan de la credencial, no de campos libres del evento.
- `normalizeAcquisition(input): AcquisitionSource`, con canal enum, enlace verificado opcional y versión de normalización. No devuelve URLs ni UTM arbitrarios.
- `signAnalyticsCredential(claims, secret): string`, `verifyAnalyticsCredential(token, {secret, businessId, origin, now}): AnalyticsClaims | null`. Unión discriminada `scope: session | attempt`, versión 1, IDs, tiempos, retención y origen normalizado firmados; sólo `attempt` puede producir snapshot de Booking.
- `reduceFunnelAttempt({attempt, events, bookings, now}): AttemptProjection`, con madurez, conversión autoritativa, prefijo coherente máximo, contexto final, calidad, servicios considerados/seleccionados/convertidos y resultados de disponibilidad.
- `aggregateDailyMetrics({sessions, attempts, coverage, definitionVersion}): DailyMetricCell[]`; poblaciones y dimensiones cerradas, contadores enteros y marcador de publicación.
- `ratio(numerator, denominator): number | null`; nunca infinito ni porcentaje precalculado persistido.

- [x] Escribir primero fixtures manuales de los seis ejemplos del spec. Los tests deben fallar por falta de comportamiento, no por errores del entorno.

```ts
expect(ratio(4, 10)).toBe(0.4)
expect(ratio(1, 0)).toBeNull()
expect(ratio(1 + 9, 2 + 90)).toBeCloseTo(0.10869565217391304)
expect(analyticsEventSchema.safeParse({
  eventId: '59f1ff5d-bf6f-4b96-b6e0-1be52096731a',
  type: 'customer_step_completed', sequence: 1,
  selectionRevision: 1, data: { email: 'fixture@example.invalid' },
}).success).toBe(false)
```

- [x] Ejecutar `npm run test:unit -- tests/unit/analytics-contracts.test.ts tests/unit/analytics-credential.test.ts tests/unit/analytics-funnel.test.ts tests/unit/analytics-daily-metrics.test.ts` y registrar el rojo.
- [x] Implementar la unión estricta, normalización, HMAC con comparación segura y validación de todos los claims. Un token de otro tenant/origen, vencido, alterado o de sesión no produce snapshot.
- [x] Implementar el reductor por secuencia/revisión. No unir hitos incompatibles; no inventar pasos automáticos; huecos conocidos separan interrupción de medición incompleta. Numerador de conversión por servicio es subconjunto del denominador de interés observado maduro.
- [x] Crear los seis modelos del spec y snapshot escalar nullable de Booking. Incluir FKs compuestas sesión/intento/evento, checks de alcance y snapshot, unicidades de ID/secuencia y claves no nulas de celdas diarias; índices de consulta y limpieza. IDs históricos de servicio/profesional no llevan FK restrictiva ni cascade.
- [x] Preparar una migración aditiva manual; validar con Prisma y aplicar sólo a la base local exclusiva. Los tests intentan realmente insertar cruces de sesión del mismo tenant, duplicados y snapshots parciales; deben ser rechazados por PostgreSQL.
- [x] Ejecutar pruebas focales, integración de esquema, typecheck, lint y revisión independiente. Checkpoints locales `1b9cc04` + fix `1a8920b`; revisión aprobada, 36 unitarias y 7 PostgreSQL. Detalle y regresiones en ledger/report.

## Task 2: Captura pública, atribución y vínculo con reservas

**Files:**
- Create: `src/lib/analytics/public-context.ts`, `budget.ts`, `ingest.ts`, `booking-snapshot.ts`.
- Create: `src/app/api/analytics/[slug]/session/route.ts`, `attempt/route.ts`, `events/route.ts` bajo el mismo segmento.
- Create: `src/server/analytics/repository.ts`, `src/server/actions/analytics.ts`.
- Modify: `src/server/actions/bookings.ts`, `src/lib/business/urls.ts`, `src/app/ir/[slug]/route.ts`.
- Create: `tests/unit/analytics-ingest.test.ts`, `analytics-budget.test.ts`, `analytics-public-context.test.ts`, `analytics-booking-snapshot.test.ts`, `analytics-actions.test.ts`.
- Create: `tests/integration/analytics-ingest.test.ts`, `analytics-booking-snapshot.test.ts`.
- Extend: `tests/unit/bookings-idempotency.test.ts`, `tests/integration/booking-retry.integration.test.ts`.

**Interfaces:**
- `resolvePublicAnalyticsContext(request, slug): Promise<PublicAnalyticsContext | null>` devuelve negocio activo, zona y origen exacto. Ignora `x-business-subdomain` y `x-forwarded-host` sin confianza explícita; verifica el host público contra dominio configurado/subdominio/customDomain del negocio.
- `bootstrapAnalyticsSession(context, input)`, `bootstrapAnalyticsAttempt(context, input)`: `{id, credential, startedAt, expiresAt, retentionExpiresAt}`. Input de intento exige credencial de sesión y clave bootstrap independiente.
- `ingestAnalyticsBatch(context, {credential, events}): Promise<BatchReceipt>`; cada recibo es `accepted | replay | rejected`, con categoría cerrada.
- Extensión de integración Task4: lote opcional `captureGap: true`, cero eventos sólo con esa señal, confirmación `captureGapRecorded: true` tras marcar el stream existente; mismas credencial/tenancy/rate gates y presupuesto mínimo1. Sin cambio del schema de eventos ni DB.
- `reserveAnalyticsBudget({businessId, cost, now}): Promise<boolean>`: reserva global y tenant en un solo EVAL distribuido; fallo cerrado, sin compartir buckets de pagos/reservas.
- `getBookingAnalyticsSnapshot({credential, selectionRevision, businessId, origin, now}): VerifiedBookingAnalyticsSnapshot | null`, sin consulta externa ni mutación de intentos.
- Actions autorizadas: `createAcquisitionLink(input)`, `archiveAcquisitionLink(id)`, `setAnalyticsCollectionEnabled(enabled)`. Esta última exige los gates de configuración/privacidad/piloto; desactivar siempre debe ser posible y no habilita el flag global.

- [x] Escribir tests rojos de origen/header falsificado, tenant cruzado, opt-out, configuración incompleta, límite global/tenant y bootstrap con respuesta perdida.

```ts
expect(getBookingAnalyticsSnapshot({
  credential: 'invalid-signature', businessId: 'negocio-a', origin: 'https://example.invalid',
  selectionRevision: 1, now: new Date('2026-08-30T12:00:00Z'),
})).toBeNull()
```

- [x] Ejecutar los tests focales y registrar el rojo. Implementar el contexto público sin reutilizar ciegamente `getTenantFromRequest()` en `/api`: el proxy actual excluye API antes de sanear su header interno.
- [x] Implementar idempotencia con unicidad en DB y recuperación tras conflicto/commit con respuesta perdida. Payload canónico idéntico es replay; conflicto de ID o secuencia marca captura incompleta. Serializar límites de 200 eventos por stream para evitar sobrepasarlos con lotes concurrentes.
- [x] Añadir presets de rate limit aislados o llamar el limitador con action y límites explícitos. Un EVAL comprueba ambos presupuestos antes de incrementarlos; reservas de presupuesto sin escritura posterior pueden perder capacidad de captura, nunca producir gastos/datos de negocio extra.
- [x] Validar tamaño real antes de parsear, Content-Type, Origin exacto, consent version, scope y IDs de dimensiones del tenant. Token inválido en captura rechaza el lote; en Booking sólo omite analytics.
- [x] Copiar los claims verificados exclusivamente en `tx.booking.create`; no cambiar retornos idempotentes ni la equivalencia de inputs financieros. No incluir analytics en precio, notificaciones, cupos o transacciones accesorias.
- [x] Enlaces de adquisición opacos: canal/campaña/promoción inmutables, archivar sin reatribuir histórico; nombre visible editable sólo como etiqueta actual. Preservar `ref` separado al propagar `acq`/UTMs permitidos y `continuar=1`.
- [x] Probar concurrentemente replays, límite de stream, FK de sesión cruzada y reservas con token inválido/expirado. Verificar que el estado transaccional y la idempotencia de Booking no cambian.
- [x] Verificación focal, typecheck/lint y revisión independiente antes del commit local `feat: collect consented owner analytics safely`.

## Task 3: Cohortes diarias, consultas y mantenimiento

**Files:**
- Create: `src/server/analytics/reports.ts`, `maintenance.ts`.
- Extend: `src/server/analytics/repository.ts`, `src/server/actions/analytics.ts`.
- Create: `src/app/api/cron/owner-analytics/route.ts`.
- Create: `scripts/run-owner-analytics-cron.sh`; mantenerlo separado del timeout compartido de crons transaccionales.
- Create: `.github/workflows/owner-analytics.yml` con ejecución horaria condicionada a variable de repositorio desactivada por defecto.
- Create: `tests/unit/analytics-reports.test.ts`, `analytics-maintenance.test.ts`, `analytics-cron.test.ts`.
- Create: `tests/integration/analytics-rollups.test.ts`, `analytics-retention.test.ts`, `analytics-report-isolation.test.ts`.

**Interfaces:**
- `getOwnerAnalyticsReport(input): Promise<OwnerAnalyticsReport>` desde una action que deriva tenant/rol. Input cerrado de período y filtros; el cliente nunca envía un negocio confiable.
- `OwnerAnalyticsReport`: período/zona/corte, estado de cobertura, resumen por población, tendencia, funnel, calidad, servicios, canales/enlaces, canjes y estados actuales en bloques separados, hasta tres oportunidades.
- `publishAnalyticsCohort({businessId, localDate, timezone, definitionVersion, now}): Promise<CohortPublicationResult>`.
- `runOwnerAnalyticsMaintenance({now, maxRows, cursor}): Promise<{errors:number, deleted:number, published:number, hasMore:boolean, nextCursor:string|null}>`.

- [x] Escribir tests rojos de suma ponderada, cero/sin datos, madurez, una conversión con dos Bookings, cobertura desigual y filtros de otro negocio.

```ts
expect(report.complete.conversion).toEqual({ numerator: 4, denominator: 10, rate: 0.4 })
expect(report.partial.conversion).toEqual({ numerator: 2, denominator: 3, rate: 2 / 3 })
expect(report.comparison.status).toBe('coverage_not_comparable')
```

- [x] Implementar lecturas acotadas y proyección por intento/par intento-servicio antes de joins. No cargar todo el histórico de eventos en JS ni paginar miles de filas en el browser. El worker puede procesar páginas acotadas de intentos, con máximo 200 eventos por intento, para aplicar el reductor compartido.
- [x] Publicar sólo cohortes cuyas ventanas estén cerradas más una hora de reconciliación. Dentro de una transacción y lock de cohorte reemplazar todas las celdas y marcador, incluyendo grupos que desaparecieron; ninguna lectura mezcla revisiones.
- [x] Implementar granos independientes total/canal/enlace/servicio; los filtros históricos incompatibles se rechazan explícitamente. No consolidar estados actuales de Booking, dinero ni canjes mutables como si fueran resultados históricos fijos.
- [x] Congelar revisión válida antes de la primera purga de una fuente de la cohorte; conservarla hasta su vencimiento. Fuente ausente sin revisión válida produce histórico no disponible, no cero. Una falla de rollup nunca prolonga retención.
- [x] Limpiar eventos/intentos/sesiones y snapshots con presupuesto reservado, lotes y continuaciones. Borrar sólo columnas analytics de Booking, nunca la reserva. Cerrar/registrar cobertura al pausar por backlog o límites.
- [x] Cron con `hasValidBearerSecret`, errores explícitos y `errors: 0` sólo cuando corresponde. El script itera continuaciones con límite temporal y devuelve fallo si queda backlog peligroso. No habilitar variable del workflow ni invocarlo en producción.
- [x] Probar carreras publicación/purga, reintentos, eliminaciones selectivas, backlog >10.000 y tenant deletion en la base local exclusiva; verificar índices con planes de consulta de fixtures representativos.
- [x] Verificación/revisión antes del commit local `feat: aggregate and retain owner analytics cohorts`. Checkpoints `afcf728` + `5ef75b6`; revisión independiente y focal aprobadas, sin hallazgos abiertos. Evidencia en report/ledger.

## Task 4: Consentimiento y captura resiliente del flujo público

**Files:**
- Create: `src/lib/analytics/client-store.ts`, `client-transport.ts`, `src/components/analytics/public-analytics.tsx`.
- Modify: `src/components/public/business-profile.tsx`, `src/components/booking/wizard.tsx`, `step-service.tsx`, `step-time.tsx`, `step-payment.tsx` y, si requiere un seam adicional, `step-customer.tsx`, sólo en sus puntos de interacción. La finalización de datos puede observarse en el callback real `StepCustomer.onSubmit` del wizard; no exige modificar el hijo si su contrato existente basta. La vista del perfil puede observarse desde el provider montado en su página, sin modificar BusinessProfile si no hace falta.
- Modify: `src/app/b/[slug]/page.tsx`, `src/app/page.tsx`, `src/app/book/[slug]/page.tsx`, `src/app/book/page.tsx`.
- Modify: `src/lib/availability/slots.ts`, `src/server/actions/availability.ts`, `src/server/actions/promotions.ts` para resultados tipados compatibles.
- Modify: `src/lib/availability/team-slots.ts` para resultado tipado de cualquier profesional desde el mismo cálculo, conservando adapter legacy; razones diferentes o no demostrables → `unknown`.
- Extend: `src/lib/analytics/ingest.ts` y tests unit/integration de ingesta para la señal `captureGap` del contrato Task2; no modificar schema de eventos ni DB. La pérdida local conocida omite sólo selectionRevision del snapshot, no la credencial ni la conversión.
- Extend: `src/lib/analytics/public-context.ts` con elegibilidad SSR server-only booleana compartida por las cuatro páginas, sin bootstrap en GET ni serializar configuración privada; fallo, inactivo, configuración incompleta o período cerrado → false. Cubrir con tests focales de contexto público.
- Create: `tests/unit/analytics-client-store.test.ts`, `analytics-client-transport.test.ts`, `public-analytics.test.tsx`, `analytics-wizard.test.tsx`, `analytics-availability.test.ts`.
- Extend: suites de `wizard-storage`, `funnel-session-prefill`, `step-time-professional` y `step-payment` que existan en la base.

**Interfaces:**
- `PublicAnalytics` provider con negocio público/slug/zona/configuración de elegibilidad, nunca secreto de firma; provider común para perfil y wizard.
- `usePublicAnalytics()`: `track(event)`, `changeSelection(context)`, `startAttempt(entryType)`, `bookingCredential()`, `completeAttempt()`, `withdrawConsent()`; todas seguras/no-op sin consentimiento o sin contexto.
- `bookingCredential()` devuelve únicamente token firmado y revisión para `bookingInput()`, sin esperar captura ni red.
- Tras `completeAttempt`, los efectos pasivos/retry de checkout no reabren captura. Una selección explícita que inicia otro flujo puede rearmarla en la misma instancia, con intento nuevo/parcial si empieza a mitad; conserva el stream anterior y no cambia idempotencia financiera.
- Nuevo resultado de disponibilidad `{slots, emptyReason}` desde el mismo generador; el action legacy sigue devolviendo `TimeSlot[]` para consumidores no migrados. `unknown` cuando no puede demostrarse una causa única.

- [x] Escribir test rojo que renderice provider + wizard sin consentimiento y pruebe cero bootstraps/eventos/identificadores; reservar y rechazar métricas siguen disponibles.

```tsx
expect(screen.getByRole('button', { name: 'Permitir métricas' })).toBeEnabled()
expect(screen.getByRole('button', { name: 'Continuar sin métricas' })).toBeEnabled()
expect(analyticsRequests).toEqual([])
expect(analyticsStorageKeys()).toEqual([])
```

- [x] Implementar preferencia180d por negocio/origen, botones equivalentes y retirada accesible; nada de analytics antes de optar. Mantener aceptación contractual de Booking completamente separada.
- [x] Persistir en una sola escritura atómica el evento, secuencia y revisión antes de enviar; manejar storage ausente, cola llena, eventos >5min, replays, respuestas parciales y crash tras commit. Protocolo de propiedad de pestaña evita escritores concurrentes de storage clonado; si no se garantiza, la copia no captura.
- [x] Registrar vistas sólo tras hidratación/visibilidad, no prefetch. Abrir tarjeta multimodal produce interés; elegir modalidad produce selección. Reutilizar claves de `wizard-steps.ts`; conservar contexto válido tras login y declarar parcial si no se puede recuperar.
- [x] Instrumentar disponibilidad con generación por petición y revisión de selección. Corregir el guard de respuesta obsoleta en el seam necesario sin cambiar las reglas de agenda. Diagnósticos de ventana/lead-time/no ofrecido/capacidad desde el mismo cálculo, no deducciones en UI.
- [x] Registrar pantalla de `pantallaDeDatos`, condición económica y método explícito separados. Validación de promo sin código crudo; submit y salida a checkout no son pago ni confirmación. Una respuesta asíncrona antigua no cambia la evidencia vigente.
- [x] Cubrir service A→hora A→B→pérdida hora B→Booking B, cualquier profesional, restore, promo100%, paquete, transferencia y configuración sin pago online.
- [x] Verificación/revisión antes del commit local `feat: instrument booking funnel with optional consent`.

## Task 5: Dashboard de métricas y enlaces

**Files:**
- Create: `src/app/dashboard/metricas/page.tsx`, `loading.tsx`, `error.tsx`.
- Create: `src/components/dashboard/analytics/analytics-dashboard.tsx`, `metric-card.tsx`, `trend-chart.tsx`, `funnel-chart.tsx`, `analytics-tables.tsx`, `acquisition-links.tsx`.
- Modify: `src/lib/dashboard/navigation.ts` de origin/main; ampliar sólo el contrato de navegación/tour si su tipado lo requiere.
- Create: `tests/unit/analytics-dashboard.test.tsx`, `analytics-navigation.test.ts`, `analytics-links.test.tsx`.
- Create: `tests/e2e/owner-analytics.spec.ts`.

**Interfaces:**
- `AnalyticsDashboard({report: OwnerAnalyticsReport, periodMode?})`, DTO del Task3 y modo de período UI transmitido por la página tras validar la consulta. El modo conserva preset7/28/90 frente a rango explícito al paginar, sin inferirlo de fechas normalizadas ni modificar el DTO/DAL. Sin consultas directas desde componentes de gráficos.
- Filtros mediante searchParams cerrados/validados en servidor; acciones Task2 para gestión de enlaces. Paginación25 por defecto y máximo100 con orden estable.

- [x] Test rojo: owner/admin ven Métricas en desktop y Más móvil; staff no lo ve ni puede consultar/mutar por llamada directa. Error de reporte nunca se representa como cero.

```tsx
expect(screen.getByText('Conversión en 24 h')).toBeVisible()
expect(screen.getByText('4 de 10 intentos')).toBeVisible()
expect(screen.getByText('Recorrido incompleto')).toBeVisible()
expect(screen.getByRole('table', { name: 'Tendencia diaria' })).toBeVisible()
```

- [x] Usar DashboardHeader, Cards, Button, Select/Table y estilo cálido existente; SVG ligeros con datos tabulares equivalentes. No introducir un sistema visual o biblioteca de charts nuevo.
- [x] Resumen + tendencia + embudo observado + último paso + servicios + adquisición/canjes + oportunidades. Mostrar parcial/completo, en curso, madurez, cobertura, fecha de activación y corte. Estados actuales de reservas en bloque separado sin deltas de seguimiento desigual.
- [x] Oportunidades: regla20/5/30% con cautela y diagnóstico de disponibilidad; cola de aprobación vencida desde `approvalExpiresAt` y la rama `pending_confirmation` de `isDoomedBooking`. Sin consejos de descuento/precio/inversión basados en abandono.
- [x] Histórico sólo dentro de retención vigente90d, sin prometer13meses. Dinero enlaza a Pagos. IA no aparece como resultado generado ni como automatización habilitada.
- [x] Probar teclado, móvil, contraste, estados loading/error/vacío/deshabilitado y tablas accesibles. Fixture E2E sintética y local; no usar cuentas reales.
- [x] Verificación/revisión antes del commit local `feat: add owner acquisition and funnel dashboard`.

## Task 6: Verificación integrada y handoff operativo

**Files:**
- Create: `docs/operations/owner-analytics.md`.
- Extend: `.env.example` con nombres y valores desactivados/sintéticos, sin secretos.
- Modify: `next.config.mjs` únicamente con `logging.serverFunctions: false` para evitar argumentos/credenciales en el registro automático de desarrollo de Next16; mantener peticiones, advertencias y errores. Cubrir configuración y salida real de E2E sin copiar tokens.
- Extend: tests de tareas anteriores sólo cuando QA revele regresiones concretas.
- Update: este plan y ledger con resultados, gates pendientes y SHAs.

- [x] Ejecutar todas las suites nuevas y regresiones de Booking, pagos, promociones, navegación y login contra fixtures locales. Reproducir cualquier fallo en base antes de clasificarlo como preexistente.
- [x] Ejecutar typecheck, lint de archivos afectados, build con env sintético y generación Prisma propia. No usar `vercel-build`: incluye despliegue de migraciones.
- [x] Ejecutar integración sobre base loopback exclusiva validada; inspeccionar tablas/FKs/índices reales, carreras y purga. Medir throughput sintético de ingesta/drenaje antes de recomendar presupuestos del piloto.
- [x] QA de navegador local desktop/móvil con consentimiento, campaña→servicio→hora→reserva y dashboard. Confirmar que offline/errores de captura no rompen la reserva; no confundir unit tests con E2E.
- [ ] Revisión final independiente de toda la rama y cierre de hallazgos. Documentar checks ejecutados, no ejecutados y motivos.
  - Enmienda de revisión final: recuperar un intento persistido vigente tras
    perder la respuesta aunque venza su sesión padre, mediante binding firmado
    original y coincidencias exactas; sin crear intentos con padre vencido,
    extender deadlines ni relajar verificadores ordinarios. Ventana de recovery
    menor que sessionExpiresAt+24h, mismos gates y reintentos acotados; ver spec.
  - Opciones de controles mediante DAL owner/admin separado y prop UI mínima,
    con búsqueda/paginación hasta100 por petición y continuidad accesible. No
    mezclar opciones operativas en métricas DTO; añadir `not_queried` para la
    disponibilidad de diagnósticos que no se consultaron, sin simular purga.
- [x] Runbook: migración aditiva, orden de despliegue, flags/allowlist/periodos, secreto propio, presupuestos medidos, consentimiento, retención, kill switch, mantenimiento con captura apagada y rollback sin borrar hechos transaccionales.
- [x] Entregar commits locales y rutas exactas. Mantener producción sin cambios: no push, PR, merge, deploy, cron real ni activación. Para13meses e IA pedir decisión específica en su etapa, no ampliar este MVP por iniciativa propia.

Task6 evidencia: unit completa424archivos3860pass/9fail/1skip; comparación de base y corrección de entorno/registros de test→focal43/43pass. Integración completa70archivos457pass/1fallo de aserción de medición→retención+rollups focal14/14pass. No se afirma corrida global verde ni revisión independiente completada. Público5/5+rerun visual2/2, dashboard3/3; typecheck/lint/Prisma/build verdes. Cinco Rulings, comandos, tiempos, coste ingesta/drenaje y gates sin activar en `docs/operations/owner-analytics.md`.

## Preflight self-review

| Productor / consumidor | Contrato compartido | Verificación de diseño |
| --- | --- | --- |
| Task1 / Task2 | Schema, claims y snapshot nullable | Copiar sólo claims firmados; no cambia idempotencia financiera. |
| Task1 / Task3 | Reductor, poblaciones y DailyMetricCell | Numeradores subconjunto de denominadores; celdas de servicios no aditivas entre servicios. |
| Task2 / Task4 | Bootstrap/batch/receipt/credencial | No hay identificador preconsent; cola conserva IDs y secuencias tras respuesta perdida. |
| Task3 / Task5 | OwnerAnalyticsReport | No representar error como cero; no ofrecer filtros históricos ausentes ni comparaciones incompatibles. |
| Task2 / Task5 | Roles y enlaces | DAL/action derivados de sesión; enlaces inmutables con archivo sin reatribución. |
| Task3 / Task6 | Purga, congelación y presupuesto | Drenaje verificado antes de activar; una falla de agregado no extiende retención. |
| Task1 | Código/test/schema | Pruebas puras más restricciones ejercitadas en PostgreSQL, no grep del SQL. |
| Task2 | Código/test/tenancy | POST ignora headers internos no saneados; tests de host/origen y cruce de sesiones. |
| Task3 | Código/test/cron | Publicación atómica y congelación antes de purga; workflow independiente apagado. |
| Task4 | Código/test/efectos | Ninguna captura sin opt-in; respuestas obsoletas no producen evidencia. |
| Task5 | Código/test/UI | Fuente de navegación de main; tablas accesibles y métricas transaccionales separadas. |
| Task6 | Código/test/operación | E2E sólo sintético; entrega local no implica producción verificada. |

**Cobertura:** secciones3–5 del spec→Tasks1–4; sección6→Tasks2/4/5; secciones7–8→Tasks3/5; sección9→Tasks2–4/6; sección10→todas; IA13meses/producción siguen gates explícitos. No hay tareas autorizadas para recuperación comercial ni mensajes reales.
