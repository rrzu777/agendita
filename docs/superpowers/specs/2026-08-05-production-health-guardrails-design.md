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

1. Hacer que el chequeo de Redis use el mismo contrato REST que el rate limiter:
   `POST` al endpoint base con un comando plano y autenticado.
2. Detectar automáticamente un `/api/health` degradado sin impedir la ejecución
   de los crons existentes.
3. Dejar un runbook sin secretos para recuperar Upstash, Resend y Mercado Pago y
   validar el ciclo real después de rotar credenciales.

## No objetivos

- Rotar o leer credenciales desde el código.
- Cambiar la política fail-closed del rate limiter.
- Configurar `METRICS_SECRET`, un proveedor de alertas o dashboards externos.
- Ejecutar pagos reales, enviar emails o modificar datos de producción.
- Ampliar `/api/health` con información sensible o mensajes crudos de proveedores.

## Diseño

### 1. Transporte REST compartido de Upstash

Se extraerá el transporte actualmente privado de `RedisRateLimiter` a un módulo
server-only pequeño. Su interfaz aceptará URL, token, comando y argumentos; hará
`POST` con el arreglo JSON `[command, ...args]`; devolverá `result`; y lanzará
ante HTTP no exitoso o una respuesta `{ error }`.

`RedisRateLimiter` consumirá este transporte sin cambiar sus reglas, Lua,
contadores ni comportamiento fail-closed. El health check lo consumirá con
`PING`, y sólo marcará Redis `up` cuando el resultado sea exactamente `PONG`.
Una configuración ausente seguirá apareciendo como `not_configured`; cualquier
timeout, `401`, error de proveedor o respuesta inesperada será `down`.

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

### 2. Monitor independiente en GitHub Actions

Se agregará un workflow `Production health` con ejecución horaria y manual. Usará
`vars.APP_BASE_URL` con fallback a `https://www.agendita.cl`, llamará
`/api/health` con timeout y reintentos acotados, y exigirá HTTP `200` más
`status == "ok"`.

El workflow será independiente de `Scheduled crons`: una falla del health check
debe producir una ejecución roja visible, pero nunca saltarse `expire-holds`,
recordatorios o fidelización. No necesita secretos nuevos.

Este alcance aprovecha las notificaciones nativas de GitHub Actions. Integrar
Slack, email dedicado, Sentry o Prometheus queda para otra decisión operativa.

### 3. Runbook de recuperación

Se agregará `docs/production-incident-recovery.md` con este orden:

1. Contener pagos online pasando temporalmente a manual cuando Mercado Pago no
   sea confiable.
2. Rotar el par URL/token de Upstash y redeployar.
3. Exigir `POST PING` exitoso y `/api/health` en `200`.
4. Rotar Resend, confirmar dominio y hacer un envío controlado.
5. Reparar Mercado Pago y completar su QA sandbox antes de reactivarlo.
6. Ejecutar smoke de reserva, disponibilidad, transferencia, reprogramación,
   cron, webhook, ledger e idempotencia.

El documento sólo enumerará nombres de variables y verificaciones; nunca valores.

## Pruebas

- Transporte Upstash: comando/headers/body correctos, error HTTP y `{ error }`.
- Health route: `PONG` produce Redis `up`; credencial rechazada, timeout o
  resultado inesperado producen Redis `down` y HTTP `503`; ausencia de variables
  conserva `not_configured`.
- Rate limiter: sus regresiones actuales deben seguir verdes usando el transporte
  compartido.
- Workflow: revisión de sintaxis y ejecución manual en el PR/tras merge.
- Validación final focalizada, lint, typecheck/build y `git diff --check`.

## Criterios de aceptación

- El health check reproduce correctamente el fallo real de Upstash y se recupera
  a `200` cuando `PING` responde `PONG`.
- Ningún error público revela credenciales ni respuesta cruda del proveedor.
- Una salud degradada vuelve rojo `Production health` sin bloquear crons.
- El runbook permite que una persona rote servicios y demuestre recuperación con
  evidencia observable.
- No cambia el contrato funcional de reservas, pagos ni rate limits.
