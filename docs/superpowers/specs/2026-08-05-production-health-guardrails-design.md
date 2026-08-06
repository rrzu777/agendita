# Guardrails de salud de producción

**Estado:** aprobado para implementación.

## Contexto

El 5 de agosto de 2026, el deploy y CI de `main` estaban verdes y los crons
programados terminaban correctamente, pero producción respondía `503` en
`/api/health`: PostgreSQL y Supabase estaban disponibles, mientras Upstash
devolvía `401 WRONGPASS`. La API de Resend rechazaba la llave y el token global
de Mercado Pago devolvía `403`.

Este cambio no rota credenciales. Agrega señales confiables y un procedimiento
operativo para que una degradación así deje de quedar escondida detrás de un
deploy exitoso.

## Objetivos

1. Hacer que el chequeo de Redis pruebe el mismo contrato REST y la misma familia
   de comando que el rate limiter: `POST EVAL` autenticado con timeout acotado.
2. Mantener un health público mínimo y sumar un health profundo autenticado para
   las dependencias externas que el incidente demostró invisibles.
3. Detectar automáticamente una salud degradada sin impedir la ejecución de los
   crons existentes.
4. Dejar un runbook sin secretos para recuperar Upstash, Resend y Mercado Pago y
   validar el ciclo real después de rotar credenciales.

## No objetivos

- Rotar o leer credenciales desde el código.
- Cambiar la política fail-closed del rate limiter.
- Configurar `METRICS_SECRET`, un proveedor de alertas o dashboards externos.
- Ejecutar pagos reales, enviar emails o modificar datos de producción.
- Exponer información sensible o mensajes crudos de proveedores en cualquiera de
  los endpoints de salud.
- Interpretar una prueba read-only de credenciales como reemplazo del QA real de
  envío de email o del ciclo de pagos/webhooks.
- Cambiar en este PR cómo `Scheduled crons` interpreta los campos `errors`; ese
  endurecimiento tendrá un PR separado para no hacer que un cron salte los demás.

## Diseño

### 1. Transporte REST compartido de Upstash

Se extraerá el transporte actualmente privado de `RedisRateLimiter` a un módulo
server-only pequeño. Su interfaz aceptará URL, token, comando y argumentos; hará
`POST` con el arreglo JSON `[command, ...args]`; devolverá `result`; y lanzará
ante HTTP no exitoso o una respuesta `{ error }`.

El transporte aceptará un `AbortSignal` opcional. `RedisRateLimiter` lo consumirá
con un timeout de tres segundos sin cambiar sus reglas, Lua, contadores ni
comportamiento fail-closed: una dependencia lenta quedará bloqueada en tiempo
acotado en vez de colgar la función hasta el timeout de Vercel.

El health check usará `EVAL` con un script sin escrituras que devuelve el resultado
de `redis.call("PING")`. Sólo marcará Redis `up` cuando el resultado sea exactamente
`PONG`. Esto prueba autenticación, transporte y permiso de scripting —la familia de
comando que usa el rate limiter— sin crear claves. Un `PING` directo no alcanza:
Upstash ofrece tokens read-only que pueden autenticar pero no sirven para el Lua
que muta el contador.

Una configuración ausente seguirá apareciendo como `not_configured` en el detalle,
pero en `NODE_ENV=production` una dependencia requerida ausente hará que el estado
global sea `degraded`. Cualquier timeout, `401`, error de proveedor o respuesta
inesperada será `down`.

La respuesta pública conservará únicamente:

```json
{
  "status": "ok | degraded",
  "checks": {
    "db": "up | down",
    "redis": "not_configured | up | down",
    "supabase": "not_configured | up | down"
  },
  "timestamp": "ISO-8601"
}
```

No se expondrán URLs, tokens ni cuerpos de error.

### 2. Health profundo autenticado

Se agregará `/api/health/dependencies`, protegido con el helper fail-closed
`hasValidBearerSecret(request, process.env.CRON_SECRET)`. Reutiliza un secreto que
ya está tanto en Vercel como en GitHub Actions; no introduce configuración nueva.

El endpoint ejecutará en paralelo y con timeout de tres segundos:

- El mismo probe `EVAL` de Upstash del health público.
- `GET https://api.resend.com/domains`, sólo si `RESEND_API_KEY` está configurada;
  exige HTTP exitoso y al menos el contrato JSON esperado. Esto valida la llave,
  no la entrega de un email.
- `GET https://api.mercadopago.com/users/me` con el token global cuando
  `PAYMENT_PROVIDER=mercado_pago` o cuando el modo OAuth por negocio está completo
  sin provider explícito; valida la credencial que el webhook usa para su lookup
  inicial, no los tokens OAuth de cada negocio ni un pago completo.

La respuesta autenticada contiene únicamente estados `up`, `down`,
`not_configured` o `not_required`. Un request sin secreto válido recibe `401` sin
revelar si el secreto está configurado.

En producción, Upstash y Resend son requeridos. Mercado Pago es requerido cuando
`PAYMENT_PROVIDER=mercado_pago` o cuando están completos
`MERCADO_PAGO_CLIENT_ID`, `MERCADO_PAGO_CLIENT_SECRET` y
`MERCADO_PAGO_REDIRECT_URI` sin provider explícito; con `manual` queda
`not_required`. Cualquier dependencia requerida que no esté `up` produce HTTP
`503`.

### 3. Monitor independiente en GitHub Actions

Se agregará un workflow `Production health` cada 15 minutos y manual. Usará
`vars.APP_BASE_URL` con fallback a `https://www.agendita.cl`, llamará al health
profundo con `Authorization: Bearer ${{ secrets.CRON_SECRET }}`, timeout y tres
intentos acotados, y exigirá HTTP `200` más `status == "ok"`. Ante fallo imprimirá
únicamente el JSON sanitario del endpoint, nunca headers ni variables.

El workflow será independiente de `Scheduled crons`: una falla del health check
debe producir una ejecución roja visible, pero nunca saltarse `expire-holds`,
recordatorios o fidelización. No necesita secretos nuevos.

Este alcance aprovecha las notificaciones nativas de GitHub Actions. Integrar
Slack, email dedicado, Sentry o Prometheus queda para otra decisión operativa.

### 4. Runbook de recuperación

Se agregará `docs/production-incident-recovery.md` con este orden:

1. Contener pagos online pasando temporalmente a manual cuando Mercado Pago no
   sea confiable.
2. Rotar el par URL/token de Upstash y redeployar.
3. Exigir `EVAL` sanitario exitoso, `/api/health` en `200` y el health profundo
   autenticado en `200`.
4. Rotar Resend, confirmar dominio y hacer un envío controlado hasta estado
   `Delivered` o un terminal explícito; un `200` de List Domains no prueba entrega.
5. Reparar el token global de Mercado Pago y completar su QA sandbox con un
   negocio OAuth distinto de la cuenta dueña de la app antes de reactivarlo.
6. Ejecutar smoke de reserva, disponibilidad, transferencia, reprogramación,
   cron, webhook, ledger e idempotencia.

El documento sólo enumerará nombres de variables y verificaciones; nunca valores.

## Pruebas

- Transporte Upstash: comando/headers/body/signal correctos, error HTTP y
  `{ error }`.
- Rate limiter: timeout de tres segundos, regresiones actuales verdes y mismo
  comportamiento fail-closed usando el transporte compartido.
- Health público: `EVAL -> PONG` produce Redis `up`; credencial rechazada, timeout
  o resultado inesperado producen Redis `down` y HTTP `503`; una dependencia
  requerida ausente conserva `not_configured` en el detalle pero degrada producción.
- Health profundo: auth fail-closed; probes paralelos; Resend inválido y token
  global MP inválido producen `503`, incluido el modo OAuth sin provider; MP
  manual produce `not_required`; nunca se filtra el cuerpo de error del proveedor.
- Workflow: revisión de sintaxis y ejecución manual tras el deploy de `main`;
  reintentos acotados y failure visible sin tocar `Scheduled crons`.
- Validación final focalizada, lint, typecheck/build y `git diff --check`.

## Criterios de aceptación

- El health público reproduce el fallo real de Upstash y se recupera a `200`
  cuando el `EVAL` sanitario devuelve `PONG`.
- El health profundo reproduce los rechazos reales de Resend y Mercado Pago, y
  distingue correctamente MP manual de MP requerido.
- Ningún error público o autenticado revela credenciales ni respuesta cruda del
  proveedor.
- Una salud degradada vuelve rojo `Production health` sin bloquear crons.
- El runbook permite que una persona rote servicios y demuestre recuperación con
  evidencia observable.
- No cambia el contrato funcional de reservas, pagos ni rate limits.

## Follow-up explícito

`Scheduled crons` hoy considera exitoso cualquier HTTP 2xx aunque el JSON de
recordatorios o fidelización tenga `errors > 0`. Se diseñará y entregará en otro
PR un agregador que ejecute siempre los cuatro crons, preserve sus resultados y
falle el workflow al final si hubo errores internos. No se mezcla aquí porque una
implementación ingenua con `bash -e` podría impedir que corran los crons restantes.
