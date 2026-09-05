# Alertas operacionales durables para métricas de dueños

**Fecha:** 2026-09-05

**Estado:** diseño técnico para revisión

**Dependencia:** MVP de métricas para dueños y mantenimiento horario ya implementados

**Activación:** fuera de alcance; todos los flags nuevos permanecen apagados

## 1. Objetivo

Detectar y comunicar fallas que puedan volver incompletas, obsoletas o
incumplidas las métricas de dueños antes de habilitar un piloto. El sistema debe
responder, con evidencia durable, estas preguntas:

- ¿El mantenimiento horario está ejecutándose y terminando?
- ¿La purga conserva el compromiso de retención?
- ¿La publicación de cohortes está fallando repetidamente?
- ¿Ya se notificó el incidente, escaló o se resolvió?

Las métricas en memoria de `src/lib/metrics/operational.ts` siguen sirviendo para
diagnóstico por proceso, pero no son una fuente durable ni un total de flota.

## 2. Alcance y no objetivos

Incluye heartbeat durable, evaluación independiente, incidentes deduplicados,
correo interno y resolución. Reutiliza el cron de mantenimiento, el workflow de
salud de producción, `CRON_SECRET` y el proveedor Resend existente.

No incluye:

- activar captura ni abrir períodos de colección;
- enviar alertas a dueños de negocios o clientes;
- SMS, push, PagerDuty u otro proveedor de observabilidad;
- corregir o reabrir cohortes automáticamente;
- convertir errores técnicos en métricas de negocio;
- prometer detección interna durante una caída total de la aplicación.

La última limitación es deliberada: si la aplicación no responde, no puede
persistir ni enviar su propio incidente. En ese caso, el workflow externo de
GitHub Actions debe fallar y sus notificaciones deben estar configuradas para el
receptor operacional. Esa verificación externa es gate del piloto.

## 3. Arquitectura

Se añaden dos unidades independientes:

1. **Registrador de ejecución.** El mantenimiento escribe inicio y término en
   PostgreSQL. Una finalización vieja no puede sobrescribir una ejecución nueva.
2. **Evaluador operacional.** Un endpoint protegido, invocado por el workflow de
   salud cada 15 minutos, lee heartbeat y backlog, abre/actualiza/resuelve
   incidentes y solicita notificaciones deduplicadas.

El evaluador no depende del workflow horario que vigila. El workflow
`production-health.yml` continúa siendo el reloj independiente; el workflow
`owner-analytics.yml` continúa ejecutando el mantenimiento.

## 4. Modelo de datos

### `AnalyticsJobHeartbeat`

Una fila por trabajo, con `jobKey` único. Para este alcance sólo existe
`owner_analytics_maintenance`.

| Campo | Contrato |
| --- | --- |
| `jobKey` | enum/string cerrada y clave primaria |
| `currentRunId` | UUID de la ejecución más reciente iniciada |
| `lastStartedAt` | inicio autoritativo del servidor |
| `lastCompletedAt` | término más reciente aceptado |
| `lastSuccessAt` | último término sin errores |
| `lastStatus` | `running`, `succeeded`, `partial` o `failed` |
| `consecutiveFailures` | aumenta en `partial/failed`, vuelve a cero en éxito |
| `consecutiveSuccesses` | aumenta en éxito, vuelve a cero en `partial/failed` |
| `lastResult` | JSON cerrado: `errors`, `deleted`, `published`, `hasMore`, `overdueMs`, `dangerous`, `beyondTolerance`, `durationMs` |
| `updatedAt` | reloj de persistencia |

Al iniciar, una transacción asigna un `currentRunId` nuevo y marca `running`. Al
terminar, el `UPDATE` exige ese mismo `currentRunId`; un request antiguo que
finalice tarde no puede reemplazar el estado de uno más nuevo. El JSON no admite
IDs de negocio, emails, payloads de eventos ni texto de excepciones.

### `AnalyticsOperationalIncident`

Una fila por ciclo de vida de incidente.

| Campo | Contrato |
| --- | --- |
| `id` | UUID |
| `activeKey` | clave determinista única mientras está abierto; `null` al resolver |
| `incidentType` | `heartbeat_stale`, `maintenance_failures` o `retention_backlog` |
| `severity` | `warning` o `critical` |
| `openedAt`, `lastObservedAt`, `resolvedAt` | ciclo de vida |
| `lastNotifiedSeverity` | evita reenviar una apertura sin escalamiento |
| `lastNotificationAt` | base del recordatorio |
| `notificationAttempts` | intentos, incluidos fallidos o ambiguos |
| `lastNotificationStatus` | `pending`, `sent`, `failed` o `skipped` |
| `lastNotificationCode` | enum interno cerrado, nunca respuesta cruda del proveedor |
| `details` | JSON cerrado con edad, contador o atraso; sin PII ni IDs tenant |
| `retentionExpiresAt` | 90 días después de resolver |

`activeKey` resuelve concurrencia sin depender de un índice parcial no expresable
por Prisma: las filas abiertas usan, por ejemplo,
`owner_analytics_maintenance:heartbeat_stale`; al resolver se vuelve `null`, lo
que permite conservar ciclos anteriores. La apertura usa `upsert`/transacción
contra esa clave. No hay un incidente por request ni por negocio en este MVP.

## 5. Reglas deterministas

El evaluador usa hora del servidor y estas reglas exactas:

| Señal | Warning | Critical | Resolución |
| --- | --- | --- | --- |
| Heartbeat inexistente | antes de habilitar el monitor responde `not_initialized` y el piloto queda bloqueado | crítico inmediato si el monitor fue habilitado después de la ejecución manual obligatoria y aun así falta la fila | primera ejecución exitosa |
| Heartbeat sin éxito | `lastSuccessAt` hace más de 2 h 15 min | hace 4 h o más | dos ejecuciones exitosas consecutivas |
| Fallas de mantenimiento | 2 ejecuciones `partial/failed` consecutivas | 4 consecutivas | dos éxitos consecutivos |
| Retención vencida | atraso desde 2 h y menor que 12 h | desde 12 h; el cierre de captura existente permanece | dos evaluaciones sin atraso, separadas por al menos 15 min |
| Retención fuera de tolerancia | no aplica | desde 24 h; misma clave de backlog, detalles actualizados y escalamiento inmediato si aún no era crítico | misma regla anterior |

`hasMore=true` no es por sí solo una falla: el driver está diseñado para
continuaciones acotadas. Sí queda en el heartbeat para diagnóstico. Cualquier
`errors > 0` produce estado `partial`. Excepción, timeout o respuesta no válida
produce `failed`.

El endpoint retorna un estado global `healthy`, `warning`, `critical` o
`not_initialized`. El script de salud sale distinto de cero en `warning`,
`critical`, respuesta inválida, timeout o error HTTP; por lo tanto GitHub Actions
también conserva evidencia externa aunque falle el correo interno.

Un atraso positivo menor a 2 horas queda visible en la respuesta como
`hasExpired=true`, pero no abre incidente: el mantenimiento es acotado y puede
necesitar continuaciones normales.

## 6. Notificaciones

Los destinatarios provienen exclusivamente de
`OWNER_ANALYTICS_ALERT_EMAILS`, lista validada de emails operacionales. Nunca se
usan los owners/admins de un negocio.

Se envía correo únicamente cuando:

- se abre un incidente;
- aumenta de `warning` a `critical`;
- permanece abierto por 12 horas desde el último envío;
- se resuelve después de haber sido notificado.

Antes de llamar a Resend, una transacción reclama el envío y registra `pending`.
La clave idempotente deriva de `incidentId + notificationKind + severity +
notificationSequence`, dentro de la ventana soportada por el proveedor. Éxito,
rechazo, falta de configuración y resultado ambiguo quedan registrados. Un fallo
de email nunca cambia el resultado del mantenimiento, la captura ni Booking.

`OWNER_ANALYTICS_ALERTS_ENABLED=false` evita llamadas al proveedor pero no evita
heartbeat, evaluación ni persistencia del incidente. Así se puede validar el
sistema antes de habilitar correo.

## 7. Endpoints, workflows y configuración

- `POST /api/cron/owner-analytics` mantiene su contrato y ahora registra el
  heartbeat alrededor de la ejecución esperada.
- `POST /api/cron/owner-analytics-monitor` exige Bearer `CRON_SECRET`, no acepta
  body ni query params y devuelve `Cache-Control: no-store`.
- `scripts/check-production-health.cjs` consulta el monitor además de los checks
  existentes y valida su esquema.
- `.github/workflows/production-health.yml` sigue cada 15 minutos. No se crea un
  tercer scheduler para vigilar el scheduler.

Nuevas variables de aplicación, apagadas por defecto:

```text
OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED=false
OWNER_ANALYTICS_ALERTS_ENABLED=false
OWNER_ANALYTICS_ALERT_EMAILS=
```

El monitor deshabilitado responde `not_enabled` sin escribir ni enviar. La URL y
el secreto ya usados por production health no se duplican.

## 8. Retención, seguridad y privacidad

- Heartbeat conserva sólo la última ejecución; no es un log histórico.
- Incidentes resueltos se purgan a los 90 días por mantenimiento acotado.
- Detalles y códigos son allowlists; no se persisten stack traces ni mensajes de
  excepción.
- Los endpoints usan comparación segura del Bearer existente, `no-store`, método
  único y validación estricta.
- El sistema no recibe ni devuelve datos de clientes, campañas o negocios.
- La migración es aditiva. Rollback de aplicación puede dejar tablas sin uso; no
  se eliminan mientras existan incidentes dentro de retención.

## 9. Fallos y recuperación

- Si escribir inicio de heartbeat falla, el mantenimiento no comienza: responde
  error para que el workflow externo lo observe.
- Si el trabajo termina pero no puede guardar su término, responde error; la
  siguiente evaluación verá `running` obsoleto.
- Si evaluar incidentes falla, el endpoint falla cerrado y GitHub Actions marca
  el check como fallido.
- Si Resend falla, el incidente queda abierto y el envío puede retomarse después
  del cooldown; no se repite en un bucle apretado.
- Si dos evaluadores corren a la vez, la clave única y el claim transaccional
  permiten a uno solo abrir/notificar.

## 10. Pruebas y evidencia de salida

Pruebas unitarias:

- tabla completa de umbrales y bordes temporales;
- transición apertura, escalamiento, recordatorio y resolución;
- `hasMore` sin errores no incrementa fallas;
- serialización del JSON cerrado y rechazo de PII/texto libre.

Pruebas de integración PostgreSQL:

- finalización antigua no pisa un `currentRunId` nuevo;
- dos evaluadores concurrentes crean un solo incidente y un solo claim;
- purga elimina sólo incidentes resueltos vencidos;
- falla de heartbeat impide ejecutar el trabajo;
- falla de email no afecta datos de analytics ni Booking.

Pruebas HTTP/workflow:

- auth, método, query/body, `no-store` y esquema de respuesta;
- script sale 0 sólo en `healthy` y falla en los demás estados operables;
- proveedor mock verifica destinatarios internos e idempotencia.

Antes del piloto se exige evidencia real de: una ejecución manual exitosa,
heartbeat visible, incidente sintético abierto/notificado/resuelto, GitHub Action
fallida ante endpoint inaccesible y receptor externo confirmado. Tener código o
CI verde no satisface este gate.
