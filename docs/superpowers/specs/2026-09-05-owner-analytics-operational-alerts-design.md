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
| `lastSuccessAt` | último recorrido completo sin errores ni continuaciones pendientes |
| `lastStatus` | `running`, `succeeded`, `partial` o `failed` |
| `consecutiveFailures` | aumenta en `partial/failed`, vuelve a cero en éxito |
| `consecutiveSuccesses` | aumenta en éxito, vuelve a cero en `partial/failed` |
| `lastResult` | JSON cerrado: `errors`, `deleted`, `published`, `hasMore`, `overdueMs`, `dangerous`, `beyondTolerance`, `durationMs` |
| `updatedAt` | reloj de persistencia |

El driver genera un `runId` para todo el recorrido horario y lo conserva entre
continuaciones. La fila añade `leaseToken`, `leaseExpiresAt`, `lastProgressAt`,
`nextBatchSequence` y `runErrors`. El lease de ejecución dura 11 minutos, por
encima del límite total del driver, y no se amplía con cada lote. Cada lote lleva
`runId` y secuencia; un CAS reclama la secuencia esperada y rechaza duplicados
concurrentes. Reintentar un lote cuya respuesta se perdió falla cerrado para ese
recorrido; el siguiente recorrido puede repetir mantenimiento idempotente.

Un lote con `hasMore=true` actualiza progreso, nunca `lastSuccessAt`. Sólo el
lote terminal con `hasMore=false`, cero errores acumulados y sin retención
vencida marca éxito. El driver comunica agotamiento/error mediante finalización
protegida; si muere sin comunicarlo, el monitor expira el lease y registra un
único fracaso. Contadores de éxito/falla avanzan una vez por `runId`, mediante
CAS. Un nuevo recorrido no pisa un lease activo. La finalización exige el token
vigente; un request antiguo no puede reemplazar un recorrido posterior. El JSON no admite
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
| `healthySince` | primera evaluación sana; se borra al reaparecer la señal |
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

`hasMore=true` representa progreso. Agotar el recorrido sin llegar al lote
terminal produce `partial`; excepción o lease vencido produce `failed`.
Los dos éxitos necesarios para resolver son dos recorridos completos distintos.
La condición de 24 horas de atraso tiene su propio hito de notificación
`beyond_tolerance`, aunque la severidad ya fuera crítica a las 12 horas.

El endpoint retorna `healthy`, `warning`, `critical`, `not_initialized` o
`not_enabled`. Con la variable externa de repositorio
`OWNER_ANALYTICS_MONITOR_EXPECTED=true`, el script exige monitor habilitado e
inicializado y sale distinto de cero ante cualquier estado distinto de
`healthy`, respuesta inválida, timeout o error HTTP. Si esa variable está apagada,
`not_enabled` es un skip esperado y no rompe los checks existentes; si el endpoint
está habilitado se evalúa igualmente su salud. Por lo tanto GitHub Actions
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

### `AnalyticsEmailDelivery`: outbox durable compartida

Se añade una tercera tabla operacional, reutilizada por el subsistema semanal.
Campos: `id`, `incidentId?`, `weeklyInsightId?` (este último FK se añade en la
migración semanal), `dedupeKey` único, `notificationKind`, `payloadHash`, payload
HTML/texto y destinatarios congelados, `status`, `leaseToken`, `leaseExpiresAt`,
`firstProviderAttemptAt`, `attempts`, `nextAttemptAt`, `providerMessageId?`,
`lastFailureCode`, `sentAt`, `retentionExpiresAt`. Exactamente un padre obligatorio;
su pertenencia y cascada se refuerzan en DB. Los emails de destinatarios sólo
existen en esta tabla de entrega, no en detalles de incidentes ni prompts.

Estados: `pending`, `sending`, `sent`, `failed`, `ambiguous`, `manual_review`,
`cancelled`. Un claim CAS otorga lease de 90 segundos; request al proveedor
máximo 15 segundos, sin reintentos automáticos. Una finalización exige token
vigente. Lease vencido tras comenzar envío se considera ambiguo. Reintentos
usan la misma clave, destinatarios y contenido; máximo tres llamadas con
separación de 15 minutos. A las 23 horas desde el primer intento se suspende
reenvío automático y pasa a `manual_review`, siguiendo el patrón de suscripciones
existente; verificar la ventana soportada por Resend antes de implementar.

La clave de alerta usa incidente + hito + secuencia durable; repetir evaluación
no crea otra secuencia. Apertura, escalamiento, hito 24h, recordatorio y resolución
son entregas distintas. Un envío pendiente previo se cancela al resolver si no
comenzó; si es ambiguo se reconcilia sin cambiar su payload. No se envía resolución
antes de confirmar alguna alerta previa. Falta de configuración deja entrega
pendiente sin gastar intento. Fallas del proveedor no afectan mantenimiento.

`OWNER_ANALYTICS_ALERTS_ENABLED=false` evita llamadas al proveedor pero no evita
heartbeat, evaluación ni persistencia del incidente. Así se puede validar el
sistema antes de habilitar correo.

## 7. Endpoints, workflows y configuración

- `POST /api/cron/owner-analytics` añade `runId` y secuencia de lote al driver;
  conserva `cursor` y los campos de resultado. Driver y ruta se despliegan
  coordinadamente. Requests legacy pueden ejecutar mantenimiento, pero no
  acreditar salud de un recorrido instrumentado.
- `POST /api/cron/owner-analytics-run-finish` acepta sólo runId/token y código
  cerrado de error/agotamiento, exige `CRON_SECRET` y finaliza por CAS.
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
- Incidentes resueltos se purgan a los 90 días desde resolución. Los abiertos
  conservan únicamente estado operativo actual hasta resolver; no acumulan
  observaciones históricas. Esta política operativa es distinta de la retención
  de datos del funnel. Payloads/destinatarios de entregas de alertas vencen a los
  90 días de crear la entrega; claves técnicas de dedupe permanecen hasta purgar
  su incidente. El endpoint de lectura no expone contenido vencido.
- Detalles y códigos son allowlists; no se persisten stack traces ni mensajes de
  excepción.
- Los endpoints usan comparación segura del Bearer existente, `no-store`, método
  único y validación estricta.
- El monitor no devuelve datos de clientes, campañas, negocios o destinatarios.
- La migración es aditiva. Rollback de aplicación puede dejar tablas sin uso; no
  se eliminan mientras existan incidentes dentro de retención.

## 9. Fallos y recuperación

- Si falla exclusivamente el registro de heartbeat, se intenta la purga acotada
  existente y se devuelve error operacional después; no se acredita éxito ni se
  publica una cohorte bajo ese recorrido. Si la DB completa está caída, ambas
  operaciones fallarán; no se promete drenaje en ese caso.
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
- falla exclusiva de heartbeat permite intentar purga y sigue reportando error;
- continuaciones exitosas seguidas de agotamiento nunca acreditan éxito;
- lease vencido, finalización tardía y lote duplicado no duplican contadores;
- resultado ambiguo recupera la misma entrega y respeta ventana de 23 horas;
- falla de email no afecta datos de analytics ni Booking.

Pruebas HTTP/workflow:

- auth, método, query/body, `no-store` y esquema de respuesta;
- matriz de monitor esperado/habilitado, incluyendo skip inicial y desactivación inesperada;
- proveedor mock verifica destinatarios internos e idempotencia.

Antes del piloto se exige evidencia real de: una ejecución manual exitosa,
heartbeat visible, incidente sintético abierto/notificado/resuelto, GitHub Action
fallida ante endpoint inaccesible y receptor externo confirmado. Tener código o
CI verde no satisface este gate.
