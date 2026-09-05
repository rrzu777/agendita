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

1. **Selector semanal:** descubre negocios habilitados cuya semana anterior está
   cerrada y aún no tiene reporte.
2. **Motor de hechos:** lee métricas y desgloses propios, comprueba cobertura y
   calcula señales canónicas.
3. **Catálogo de acciones:** asocia cada señal elegible a acciones permitidas.
4. **Narrador:** recibe sólo hechos/acciones canónicos y devuelve JSON estricto.
5. **Publicador:** persiste el reporte y, si existe opt-in, envía ese mismo
   artefacto a un único owner/admin.

Un workflow separado corre cada hora. El servidor procesa como máximo 25
negocios por invocación y devuelve cursor. La elegibilidad horaria se calcula en
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

Una fila por negocio, semana y conjunto de versiones.

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
| `generationAttempts`, `lastFailureCode`, `nextRetryAt` | control durable de reintento |
| `emailStatus`, `emailAttempts`, `emailedAt`, `emailFailureCode` | entrega del artefacto persistido |
| `generatedAt`, `retentionExpiresAt` | expiración máxima de 90 días |

Clave única: negocio + semana + zona + `definitionVersion` + `engineVersion` +
`promptVersion`. Antes de una llamada al proveedor se crea/reclama la fila y se
incrementa `generationAttempts` en transacción. Esto permite contar también
llamadas fallidas y aplicar un presupuesto global sin otra tabla.

`AnalyticsDailyMetric` incorpora `consentVersion` a su grano y clave única. Las
filas históricas se backfillean como versión 1 y nunca son elegibles para IA. La
nueva captura consentida se publica como versión 2; no se mezclan versiones en
un reporte ni se reinterpretan datos antiguos.

## 5. Elegibilidad y calidad

El motor sólo usa la semana anterior cuando se cumplen todas estas condiciones:

- existen los siete marcadores diarios esperados;
- todos están `closed`, con cobertura `complete`, misma zona y misma definición;
- todos tienen `consentVersion=2`; datos o períodos versión 1 quedan excluidos;
- no hay período de captura cerrado o deshabilitado dentro de la semana;
- hay al menos 20 intentos `complete` maduros;
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

Se emiten como máximo tres señales, ordenadas por evidencia y alcance:

| Señal | Requisito adicional | Acciones permitidas |
| --- | --- | --- |
| `availability_empty_high` | al menos 5 intentos afectados y tasa >=30%; diagnóstico `no_capacity` sólo si fue demostrado | revisar cobertura de agenda; probar nuevos bloques en fechas consultadas |
| `step_drop_high` | al menos 5 interrupciones conocidas; caída >=25 puntos entre pasos válidos | revisar claridad del paso; probar simplificación guiada |
| `payment_branch_drop_high` | al menos 5 afectados; pantalla/método observado con cobertura completa | revisar instrucciones y métodos ofrecidos; probar copy aclaratorio |
| `service_conversion_gap` | ambos servicios con >=10 intentos y brecha >=20 puntos | revisar disponibilidad/configuración del servicio; comparar su presentación |
| `channel_conversion_gap` | ambos canales con >=10 intentos y brecha >=20 puntos | revisar coherencia del enlace/campaña fuera de analytics; repetir medición |
| `capture_quality_risk` | parciales o gaps >=10% del total observado | corregir cobertura antes de tomar decisiones comerciales |

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
reintentos automáticos del SDK: máximo 1
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
- `confidence`: `limited`, `moderate` o `strong`.

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

El claim transaccional toma un advisory lock PostgreSQL global, suma
`generationAttempts` de la semana y reserva una llamada antes de liberar el
lock. Así dos workers no pueden sobrepasar el presupuesto. Sin límite global
positivo no hay llamadas. Cada reporte admite dos intentos de proveedor como
máximo. El SDK maneja un único reintento elegible;
Agendita no agrega otro loop inmediato. Un segundo intento de reporte puede
ocurrir en una ejecución posterior, después de una hora, con el mismo
`inputHash`.

No se reintentan errores de autenticación, billing, schema o configuración. Si
hay cinco fallas consecutivas de proveedor durante seis horas, se abre el circuit
breaker lógico: no se reservan nuevas llamadas por seis horas y se conserva sólo
salida determinista. Su estado se deriva de filas durables, no de memoria.

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
usa una clave idempotente por `weeklyInsightId + recipientBusinessUserId`.

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

Reportes, hechos y metadatos de proveedor vencen como máximo a los 90 días. El
mantenimiento purga `AnalyticsWeeklyInsight` vencidos. Deshabilitar IA evita
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
  emails; no borrar reportes existentes.

## 12. Pruebas y gates de salida

Pruebas unitarias:

- siete días, zonas, DST, miércoles 09:00 y ventanas `[inicio, fin)`;
- todas las razones de ineligibilidad y borde de 20 intentos;
- umbrales, orden y máximo de tres señales;
- ninguna tasa calculada por el modelo ni dimensión libre en el prompt;
- schema Zod/JSON, refusals, truncamiento, IDs inventados y strings límite;
- presupuesto, circuit breaker y dos intentos máximos.

Pruebas de integración PostgreSQL:

- claim concurrente produce una llamada lógica por reporte;
- suma global de intentos no excede el presupuesto;
- aislamiento por negocio y validación de recipient role;
- purga a 90 días;
- cambio de opt-in durante ejecución cancela llamada/envío;
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
