# Insights semanales para métricas de dueños

**Fecha:** 2026-09-05

**Estado:** diseño técnico para revisión

**Dependencias:** métricas confiables y alertas operacionales verificadas

**Activación:** fuera de alcance; no se llama a OpenAI ni se envían correos reales

## 1. Objetivo

Entregar a cada owner/admin un resumen semanal útil del funnel: hechos
verificables, hasta tres oportunidades y acciones pequeñas que pueda probar. El
dashboard muestra el reporte persistido y, opcionalmente, envía exactamente el
mismo contenido por email.

La regla central es: **el motor determinista calcula; la IA sólo redacta**. El
modelo no recibe eventos crudos, no calcula tasas, no inventa causalidad y no
puede proponer acciones fuera de un catálogo cerrado.

## 2. Alcance y no objetivos

Incluye:

- resumen semanal de una cohorte cerrada de siete días;
- hechos y recomendaciones deterministas con evidencia numérica;
- narración opcional mediante OpenAI Responses API;
- historial de hasta 90 días en el dashboard;
- opt-in separado para IA y para un email semanal;
- presupuestos, reintentos acotados y degradación sin IA.

No incluye:

- atribuir intención, causa, ingreso, ROI o pérdida de ventas;
- enviar PII, etiquetas libres, códigos promocionales o eventos al modelo;
- mensajes a clientes, recuperación de abandonos o cambios automáticos;
- chat con los datos, herramientas del modelo o acceso del modelo a la DB;
- comparar negocios entre sí;
- IA sobre menos de 20 intentos completos maduros;
- activar captura, consentimiento v2, cron, email o credenciales.

## 3. Arquitectura y flujo

El subsistema tiene cinco unidades:

1. **Selector semanal:** descubre semanas cerradas sin reporte y retoma estados
   reintentables cuyo `nextRetryAt` venció, antes de crear trabajo nuevo.
2. **Motor de hechos:** lee métricas y desgloses propios, comprueba cobertura y
   calcula señales canónicas.
3. **Catálogo de acciones:** asocia cada señal elegible a acciones permitidas.
4. **Narrador:** recibe sólo hechos/acciones canónicos y devuelve JSON estricto.
5. **Publicador:** persiste el reporte y, si existe opt-in, envía ese mismo
   artefacto a un único owner/admin.

Un workflow separado corre cada hora. La ruta tiene máximo 60 segundos, deadline
cooperativo de 40 segundos y concurrencia de proveedor 1. Descubre hasta 25
candidatos, pero sólo reclama trabajo si quedan al menos 20 segundos: 15 de
request y 5 de persistencia. Consultas/transacciones se acotan a 5 segundos.
El driver tiene presupuesto global de 8 minutos y hasta 20 requests. Guarda
cursor de recorrido en `AnalyticsJobHeartbeat` con jobKey `weekly_insights`,
lease y fencing definidos en el spec operacional. Retoma el cursor en la próxima
ejecución y vuelve al inicio sólo al completar el recorrido; así evita inanición.
La elegibilidad horaria se calcula en
la zona del negocio: miércoles desde las 09:00 se genera la semana local anterior
de lunes 00:00 a lunes 00:00. El margen hasta el miércoles reduce cohortes aún
madurando o publicaciones tardías.

La ruta espera y persiste el resultado; no usa `after()` ni trabajo fire-and-
forget. Los límites de duración del route handler siguen siendo autoritativos.

## 4. Modelo de datos

### `AnalyticsInsightPreference`

Una fila opcional por negocio.

| Campo | Contrato |
| --- | --- |
| `businessId` | PK/FK con borrado en cascada |
| `aiNarrativeEnabled` | `false` por defecto; opt-in explícito owner/admin |
| `emailEnabled` | `false` por defecto; independiente de IA |
| `recipientBusinessUserId` | FK nullable a una membresía del negocio |
| `acceptedPrivacyVersion` | versión aceptada al habilitar IA; debe ser 2 |
| `updatedByUserId`, `updatedAt` | auditoría mínima |

El destinatario debe seguir perteneciendo al mismo negocio y tener rol `owner` o
`admin` al guardar y al enviar. Si pierde membresía/rol o email, se omite el envío
y se deshabilita `emailEnabled`; el reporte del dashboard permanece.

`emailEnabled=true` exige destinatario. No exige IA: un negocio puede recibir el
resumen determinista. `aiNarrativeEnabled=true` exige mostrar y aceptar la
sección de privacidad versión 2.

### `AnalyticsWeeklyInsight`

Una fila por negocio y fecha local de inicio de semana, con clave única
`businessId + weekStart`. Zona y límites UTC se congelan al crearla. Un cambio
de zona no crea otro reporte para esa fecha ni permite intervalos solapados con
reportes ya existentes; la semana de transición se marca incompatible.

| Campo | Contrato |
| --- | --- |
| `id` | UUID |
| `businessId` | FK tenant |
| `weekStart`, `weekEnd`, `businessTimeZone` | rango local `[inicio, fin)` congelado |
| `sourceConsentVersion`, `definitionVersion`, `engineVersion`, `promptVersion` | semántica reproducible; IA sólo usa consentimiento fuente v2 |
| `inputHash` | SHA-256 del input canónico ya calculado |
| `facts` | JSON validado de hechos, evidencia, calidad y acciones allowlisted |
| `narrative` | JSON nullable validado; nunca texto libre sin estructura |
| `status` | `insufficient_data`, `deterministic_ready`, `ready` o `generation_failed` |
| `model` | modelo efectivo nullable |
| `providerResponseId` | ID técnico nullable; nunca se expone al owner |
| `inputTokens`, `outputTokens` | uso reportado nullable |
| `generationAttempts`, `lastFailureCode`, `nextRetryAt` | resumen de intentos durables |
| `leaseToken`, `leaseExpiresAt`, `generationState` | CAS; `idle`, `running`, `retry_wait` o `terminal` |
| `revision`, `sourceRevisionHash`, `deliveryLockedAt` | control de revisión y congelación de contenido |
| `emailStatus` | proyección del estado en `AnalyticsEmailDelivery` |
| `generatedAt`, `retentionExpiresAt` | expiración máxima de 90 días |

Cambiar modelo/prompt/motor no crea otro reporte ni reinicia presupuesto. Antes
del primer intento de proveedor pueden refrescarse hechos y aumentar revisión.
Al reclamar generación se congelan hechos, inputHash y versiones para sus dos
intentos; al reclamar email se congela además el payload de entrega. Un reporte
`ready` es terminal. No hay regeneración automática después de éxito ni de email.
La UI muestra fecha de corte: es un snapshot, no un reflejo mutable del dashboard.

Estados `generation_failed` recuperables se retoman al vencer `nextRetryAt`;
`insufficient_data` por publicación pendiente se revisa cada hora hasta viernes
09:00 local. Falta permanente de cobertura/retención y bajo volumen maduro son
terminales. El selector hace catch-up hasta dos semanas atrasadas y nunca envía
backfill más antiguo. Activar IA después de entregar el resumen aplica a semanas
futuras. Apagar IA durante un retry deja el reporte determinista terminal.

### `AnalyticsInsightGenerationAttempt`

Tabla adicional por reserva de llamada: `id`, `weeklyInsightId`, `attemptNumber`
(único por reporte), `budgetWeekStartUtc`, `reservedAt`, `startedAt`, `finishedAt`,
`leaseToken`, `status` (`reserved`, `succeeded`, `failed`, `ambiguous`, `cancelled`),
`failureCode`, `providerResponseId`, `inputTokens`, `outputTokens`,
`retentionExpiresAt`. No almacena prompt, texto de error ni respuesta cruda.
Cada reserva consume presupuesto aunque el worker muera antes de enviar; nunca
se libera una reserva ambigua. Se conservan hasta 90 días desde reservar y sin
PII; borrar el informe anula su FK, no borra reservas del presupuesto vigente.
El job semanal usa la fila singleton de heartbeat para `circuitOpenUntil` y
`probeLeaseUntil`, actualizados bajo el mismo lock global del presupuesto.

`AnalyticsDailyMetric` incorpora `consentVersion` a su grano y clave única. Las
filas históricas se backfillean como versión 1 y nunca son elegibles para IA. La
nueva captura consentida se publica como versión 2. Antes de activar v2, una
migración aditiva propaga versión a intentos y snapshots de Booking desde su
sesión; fuentes sin procedencia verificable quedan `unknown` y fuera de IA.
Credenciales, transporte, bootstrap, eventos, períodos, agregado, freeze/purga y
DAL deben transportar/verificar la versión fuente, no el valor global actual.

El despliegue primero soporta lectura de ambas versiones manteniendo emisión v1.
La activación v2 posterior cierra períodos v1 y abre v2 sin solapamiento, requiere
nuevo consentimiento explícito y no reutiliza aceptación almacenada v1. Tokens
v1 en vuelo pueden finalizar dentro de su ventana original, siempre etiquetados
v1; no se convierten a v2. Los nuevos flujos usan v2. Las claves y consultas
históricas incluyen consentimiento en todas sus dimensiones y marcadores.

## 5. Elegibilidad y calidad

El motor sólo usa la semana anterior cuando se cumplen todas estas condiciones:

- existen marcadores de publicación para los siete días y cada población
  utilizada; no se confunden con las celdas métricas del mismo día;
- todos están `closed`, con cobertura `complete`, misma zona y misma definición;
- el resumen determinista admite semanas íntegramente v1 o íntegramente v2;
  una semana mixta muestra el motivo de incompatibilidad. La narrativa
  IA requiere siete días íntegramente v2, sin fuentes v1/unknown ni mezcla;
- los períodos cubren el intervalo completo sin huecos; que un período termine
  después del intervalo no invalida su cobertura histórica;
- para recomendaciones/IA hay al menos 20 intentos `complete` maduros; por debajo
  se muestran conteos deterministas y aviso de muestra insuficiente, sin consejo;
- la consulta de desgloses crudos, cuando una señal la necesita, responde
  `complete` y sigue dentro de retención;
- numerador y denominador de cada comparación pertenecen a la misma población.

Si falla cobertura o retención, el estado es `insufficient_data` con un código
cerrado; no se convierte ausencia en cero y no se llama al modelo. Las entradas
parciales sólo alimentan una advertencia de calidad, nunca recomendaciones.

No se comparan semanas con distinta definición o zona. Una comparación contra
la semana anterior sólo aparece si esa semana también cumple todos los gates y
tiene al menos 20 intentos completos maduros. Sin comparación válida, se informa
el valor actual sin afirmar tendencia.

## 6. Motor determinista de hechos

Cada hecho contiene `factId`, `signalCode`, `numerator`, `denominator`, tasa
calculada localmente, período, comparación nullable, nivel de evidencia y
`actionIds` permitidos. Los porcentajes mostrados se derivan otra vez desde los
enteros persistidos para evitar inconsistencias.

Todas las señales comerciales usan intentos completos maduros, separan
convertidos/interrupciones conocidas/medición incompleta y excluyen estos últimos
de inferencias de interrupción. `confidence` es `limited` para todo este MVP y
se calcula en servidor: los umbrales son heurísticos, no significancia estadística.
Las comparaciones de servicio/canal quedan como desglose descriptivo sin ranking
ni recomendación automática hasta validar una regla de incertidumbre adecuada.

Se emiten como máximo tres señales; prioridad fija disponibilidad, paso, pago,
luego mayor número afectado y desempate por código. Calidad aparece aparte y
nunca compite con recomendaciones comerciales:

| Señal | Requisito adicional | Acciones permitidas |
| --- | --- | --- |
| `availability_empty_high` | intentos con >=1 resultado vacío vigente / intentos con >=1 resultado vigente no erróneo; denominador >=20, afectados >=5 y tasa >=30% | revisar reglas/fechas consultadas; probar cupos sólo si la subpoblación `no_capacity` satisface por sí misma esos umbrales |
| `step_drop_high` | interrupciones conocidas cuyo último paso válido es S / intentos con paso S observado válido; denominador >=20, afectados >=5 y tasa >=25%; misma rama aplicable, revisiones obsoletas excluidas | revisar claridad del paso |
| `payment_branch_drop_high` | interrupciones conocidas en pago / intentos con esa pantalla de pago válida observada; denominador >=20, afectados >=5 y tasa >=25%; no interpreta espera posterior a Booking como interrupción | revisar instrucciones y métodos ofrecidos |
| `capture_quality_risk` | unión de intentos parciales y con gap / total de intentos observados, sin doble conteo; >=10% | advertencia determinista de calidad separada de IA |

Los nombres de campañas, servicios y profesionales no entran en el input de IA.
La UI puede resolver nombres propios después, desde consultas tenant autorizadas,
pero el reporte persistido y el prompt usan códigos/IDs canónicos. Ninguna acción
afirma que la señal sea causa; usa lenguaje de prueba y verificación.

## 7. Contrato con OpenAI

Se usa la Responses API en modo foreground, sin herramientas, navegación,
archivos ni conversación. Configuración inicial:

```text
model: gpt-5.6-luna
reasoning.effort: none
store: false
max_output_tokens: 700
timeout de cliente: 15 segundos
reintentos automáticos del SDK: 0
```

`gpt-5.6-luna` está orientado a cargas sensibles a costo y soporta Responses API
y Structured Outputs. El modelo queda en `OWNER_ANALYTICS_AI_MODEL` para permitir
migración controlada, pero sólo modelos de una allowlist probada pueden arrancar.
Cambiar modelo incrementa `promptVersion` o una versión de configuración que
impide mezclar resultados silenciosamente.

El output usa Structured Outputs con JSON Schema estricto (`text.format`) y se
valida además con Zod. El esquema contiene:

- `summary`: máximo 320 caracteres;
- `findings`: máximo tres, cada uno con `factId`, `headline`, `explanation` y
  exactamente uno o dos `actionIds` recibidos;
- `caveats`: de cero a tres códigos allowlisted;
- la confianza se añade desde el motor; el modelo no devuelve ese campo.

La aplicación rechaza IDs no entregados, números nuevos, porcentajes en campos de
texto, acciones ajenas al catálogo, más elementos o strings fuera de límite. Una
negativa del modelo, truncamiento, schema inválido o referencia inválida produce
`generation_failed`; los hechos deterministas siguen disponibles.

La documentación oficial indica que Structured Outputs garantiza ajuste al
schema y aun así la aplicación debe validar la aptitud del resultado. También
indica que Responses conserva estado por defecto durante al menos 30 días cuando
`store` se omite o es `true`; por eso el request exige `store:false`. Esto no se
presentará como “cero retención”: antes de activar se revisarán las condiciones
de abuso, procesamiento regional y contrato aplicables a la cuenta.

Referencias oficiales:

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Controles y retención de datos](https://developers.openai.com/api/docs/guides/your-data#v1responses)
- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [Precios de API](https://developers.openai.com/api/docs/pricing)
- [Reintentos y rate limits](https://developers.openai.com/api/docs/guides/rate-limits#retrying-with-exponential-backoff)

## 8. Presupuestos, reintentos y circuit breaker

Variables de aplicación, todas inactivas o vacías por defecto:

```text
OWNER_ANALYTICS_INSIGHTS_ENABLED=false
OWNER_ANALYTICS_INSIGHTS_BUSINESS_IDS=
OWNER_ANALYTICS_AI_MODEL=gpt-5.6-luna
OWNER_ANALYTICS_AI_MAX_WEEKLY_CALLS=
OWNER_ANALYTICS_AI_MAX_INPUT_TOKENS_PER_CALL=2500
OWNER_ANALYTICS_AI_MAX_OUTPUT_TOKENS_PER_CALL=700
OWNER_ANALYTICS_AI_MAX_ATTEMPTS_PER_REPORT=2
```

Un advisory lock PostgreSQL global protege la comprobación de presupuesto,
circuit breaker y reserva de llamada. La semana de gasto es lunes 00:00 UTC a
lunes 00:00 UTC según `reservedAt`, nunca la semana analizada. Se cuentan todas
las reservas en `AnalyticsInsightGenerationAttempt`. Sin límite positivo no se
llama. Cada informe admite dos reservas totales, incluso tras cambios de versión.
Cada reserva autoriza un único request HTTP; SDK sin retries. Lease de generación
de 45 segundos y finalización CAS con token: respuesta tardía se descarta. Lease
expirado queda `ambiguous`, consume presupuesto y puede habilitar un segundo
intento después de una hora, con igual inputHash. No se garantiza una única
facturación ante timeout; sí máximo dos requests y un solo informe publicado.

No se reintentan errores de autenticación, billing, schema, negativa o configuración.
Timeout, red, 5xx y rate limit temporal admiten el segundo intento, con
`nextRetryAt=max(ahora+1h, Retry-After válido)` y jitter hasta 60 segundos.
Cinco resultados fallidos/ambiguos consecutivos, ordenados por finalización e ID
dentro de seis horas, abren el circuito seis horas. Un éxito rompe la secuencia.
Vencido el plazo, sólo una reserva obtiene probe lease; éxito cierra circuito,
falla/ambigüedad lo reabre. No se recalcula el vencimiento por cada lectura.

Los tokens reportados se almacenan para auditoría. El límite de input se valida
antes del request con el tokenizador compatible; el límite de output es del
request. Los precios son externos y cambiantes: el gate primario es cantidad de
llamadas/tokens, no una estimación monetaria falsa. Operaciones revisa costo real
antes de ampliar el allowlist.

## 9. Email y UX

El dashboard muestra:

- semana y zona horaria;
- calidad/cobertura y tamaño de muestra;
- hechos deterministas con numerador y denominador;
- texto “generado con IA” sólo cuando `status=ready`;
- estados claros: datos insuficientes, IA desactivada, generación fallida o
  reporte vencido;
- control owner/admin para opt-in de IA y, por separado, email/destinatario.

El email toma el reporte ya persistido. No dispara una nueva generación. Incluye
la misma evidencia, caveats y enlace a `/dashboard/metricas`; no incluye datos de
clientes ni pixel de seguimiento propio. Su envío se reclama en transacción y
usa la outbox `AnalyticsEmailDelivery` del spec operacional, con clave única
`weeklyInsightId:weekly_digest` independiente de destinatario/revisión. El
payload y email se congelan en el primer claim. Cambio de email, rol, destinatario
u opt-in cancela entregas aún no iniciadas; después de un intento no se sustituye
el destinatario bajo la misma clave ni se crea otra entrega automáticamente.
Reintentos revalidan autorización y usan el mismo payload. Revocar no puede
recuperar un email ya aceptado por el proveedor. Se aplican lease, tres llamadas
y corte de 23 horas de la outbox. Un fallo de generación ya enviado como resumen
determinista no provoca otro email al recuperarse la IA.

Si IA está desactivada o falla, el negocio puede ver/recibir el resumen
determinista. Si faltan datos confiables, no se envía un “consejo” vacío; el
dashboard explica el gate y el email se omite.

## 10. Privacidad, consentimiento y aislamiento

La página actual afirma que el piloto no envía datos a modelos de IA. Antes de
cualquier llamada real se exige:

1. actualizar `/privacy#metricas-reservas` con proveedor, finalidad, campos
   agregados enviados, controles de retención y derecho a desactivar;
2. aumentar `consentVersion` de analytics a 2 sin reinterpretar consentimiento
   versión 1, y publicar `AnalyticsDailyMetric.consentVersion=2` sólo para esas
   nuevas cohortes;
3. aprobación legal/privacidad registrada por configuración;
4. opt-in owner/admin por negocio y allowlist explícito;
5. credencial server-only y proyecto OpenAI aprobado;
6. verificación de alertas operacionales y siete días de medición confiable.

El prompt nunca contiene nombre/email/teléfono/dirección de cliente, Booking,
notas, hora exacta, evento crudo, nombre de negocio, campaña, promoción, servicio
o profesional. El aislamiento tenant se aplica antes de calcular; no existe una
consulta cross-tenant para generar el reporte.

Reportes, hechos y payload de email vencen en el mínimo de: fin UTC de la semana
más 90 días y vencimiento más temprano de las fuentes utilizadas (incluida la
semana de comparación). Ese vencimiento se fija al crear y sólo puede acortarse;
reintentos/revisiones no lo extienden. El DAL oculta vencidos inmediatamente y
la purga acotada dispone de hasta 24 horas, como el mantenimiento existente.
Las reservas de llamada sin contenido tienen su plazo técnico separado de 90
días desde reserva y conservan presupuesto aunque se borre el informe.
El mantenimiento purga `AnalyticsWeeklyInsight` vencidos. Deshabilitar IA evita
nuevas llamadas; no elimina antes de plazo un reporte ya generado, salvo acción
explícita de borrado definida por privacidad.

## 11. Fallos y recuperación

- Datos insuficientes: persistir razón cerrada, mostrarla, no llamar ni enviar.
- OpenAI no disponible/timeout/rate limit: preservar hechos, registrar código
  cerrado, reintentar sólo bajo presupuesto.
- Resultado inválido/refusal: no mostrar narrativa parcial; hechos permanecen.
- Persistencia posterior a respuesta falla: el intento ya reclamado cuenta para
  presupuesto; se puede reintentar una vez en otra ejecución.
- Resend falla: no regenerar; reintentar sólo entrega del mismo reporte.
- Preferencia cambia durante el job: revalidar opt-in, rol y destinatario justo
  antes de llamar y antes de enviar.
- Captura/operaciones se vuelven no saludables: suspender nuevas generaciones y
  emails hasta recuperar operación. Cerrar captura voluntariamente después de
  la semana no invalida hechos históricos; revocar opt-in sí cancela nuevas
  llamadas/envíos. Una revocación se revalida antes del request; no se promete
  retirar datos ya aceptados por el proveedor.

## 12. Pruebas y gates de salida

Pruebas unitarias:

- siete días, zonas, DST, miércoles 09:00 y ventanas `[inicio, fin)`;
- todas las razones de ineligibilidad y borde de 20 intentos;
- umbrales, orden y máximo de tres señales;
- ninguna tasa calculada por el modelo ni dimensión libre en el prompt;
- schema Zod/JSON, refusals, truncamiento, IDs inventados y strings límite;
- presupuesto por semana de gasto UTC, circuito half-open y dos requests reales máximos;
- cohortes v1/v2 mixtas, tokens v1 en vuelo y procedencia desconocida;
- ramas opcionales, denominadores exactos y acciones sólo con diagnóstico demostrado.

Pruebas de integración PostgreSQL:

- claims concurrentes, worker muerto y respuestas tardías respetan lease/fencing;
- upgrade de prompt/modelo no duplica informe, email ni presupuesto;
- reanudar cursor no pierde candidatos y deadline impide reclamar trabajo excesivo;
- retención se conserva tras revisión, comparación y reintento;
- envío ambiguo mantiene payload/destinatario y corta retries a las 23 horas;
- suma global de intentos no excede el presupuesto;
- aislamiento por negocio y validación de recipient role;
- purga a 90 días;
- cambio de opt-in antes del request cancela llamada/envío; después no promete retractación;
- email reutiliza exactamente el reporte persistido.

Pruebas HTTP/UI:

- auth de cron y server actions owner/admin;
- estados accesibles del dashboard;
- toggles separados con defaults apagados;
- proveedor y email mocks, sin red real en CI.

Gates operacionales antes de activación:

- privacidad versión 2 y revisión legal aprobadas;
- alertas durables verificadas de extremo a extremo;
- al menos siete días de cohortes completas en un negocio allowlisted;
- evaluación manual de un set dorado de reportes contra hechos esperados;
- límites de costo/tokens configurados y dashboard de uso revisado;
- autorización explícita del piloto.

Código desplegado, migraciones aplicadas o CI verde no activan ninguno de esos
gates por sí solos.

## 13. Cierre de la revisión de gaps

El conjunto requiere seis tablas nuevas: heartbeat, incidentes, outbox de emails,
preferencias, informes e intentos de generación. La outbox se entrega con alertas
y se amplía aditivamente con la FK semanal. Orden de implementación: operaciones
y entrega durable; transición de consentimiento; motor/reportes; narrador y UI.

| Gap revisado | Contrato corregido |
| --- | --- |
| Presupuesto y circuito | Una reserva por request, SDK sin retry, historial de resultados y half-open exclusivo |
| Recuperación de workers/envíos | Leases, CAS, payload congelado y corte de idempotencia |
| Heartbeat engañoso | Éxito sólo al completar recorrido, no cada lote |
| Consentimiento v2 | Compatibilidad v1/v2 en toda la cadena y resumen v1 sin IA |
| Duplicados y reanudación | Identidad estable negocio-semana y estados reintentables explícitos |
| Duración de lotes | Deadline, concurrencia 1, margen antes de reclamar y cursor durable |
| Calidad de recomendaciones | Denominadores, ramas y confianza del servidor; comparaciones sólo descriptivas |
| Retención | Vencimiento inmutable ligado a fuentes; política operacional separada |
| Monitor y purga | Skip esperado externo, detección de apagado inesperado y purga independiente del heartbeat |
