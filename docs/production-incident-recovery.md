# Recuperación de dependencias de producción

Este runbook cubre incidentes donde el deploy está disponible pero PostgreSQL,
Supabase, Upstash, Resend o el token global de Mercado Pago no están operativos.
Nunca copies valores de secretos a terminales compartidas, tickets, PRs o chats.

## 1. Confirmar y registrar el incidente

Hay incidente si `/api/health` devuelve HTTP 503 o el workflow
`Production health` queda rojo. Registra hora, deploy SHA y estados sanitizados;
no copies respuestas crudas de proveedores.

```bash
set -o pipefail
curl --fail-with-body --silent --show-error --max-time 15 \
  "$BASE_URL/api/health" | jq

curl --fail-with-body --silent --show-error --max-time 15 \
  --header "Authorization: Bearer $CRON_SECRET" \
  "$BASE_URL/api/health/dependencies" | jq
```

El health profundo sólo debe devolver `redis`, `resend` y `mercadoPago` como
`up`, `down`, `not_configured` o `not_required`.

## 2. Contener antes de reparar

Si Mercado Pago no es confiable, cambia temporalmente
`PAYMENT_PROVIDER=manual` en producción y crea un nuevo deploy. Confirma el
deploy activo y vuelve a consultar ambos health checks antes de informar que la
contención está aplicada.

No marques cobros inciertos como pagados, no reintentes pagos a ciegas y no
habilites pagos online hasta reconciliar provider, booking y ledger.

Si Redis está `down`, asume que las acciones protegidas por rate limit pueden
estar bloqueadas a propósito por la política fail-closed.

## 3. Recuperar Upstash

1. Genera un token Standard nuevo para la base correcta.
2. Actualiza juntos `UPSTASH_REDIS_REST_URL` y
   `UPSTASH_REDIS_REST_TOKEN` en el entorno Production de Vercel.
3. Crea un nuevo deploy y confirma que es el deploy activo.
4. Exige `redis: up` en el health público y el profundo.
5. Ejecuta una acción rate-limited controlada y confirma que no queda bloqueada
   por error.
6. Revoca el token anterior sólo después de esas verificaciones.

El probe ejecuta un `EVAL` sin escrituras que retorna `1`. Esto valida la
familia de comando del rate limiter sin crear claves; no valida por sí solo el
contador completo.

## 4. Recuperar Resend

1. Crea una API key nueva con `sending_access` para preservar mínimo privilegio.
2. Actualiza `RESEND_API_KEY` en Production y crea un nuevo deploy.
3. Exige `resend: up` en el health profundo.
4. Confirma que el dominio remitente siga verificado desde el dashboard de
   Resend.
5. Envía un correo a una casilla QA controlada y sigue el evento hasta
   `Delivered` o un estado terminal explícito.
6. Revoca la llave anterior sólo después de confirmar el deploy y la entrega.

El probe envía un body vacío a Send Email: una llave `sending_access` válida
llega a `missing_required_field`, pero el request nunca puede crear un email.
Esto valida la credencial sin ampliar permisos ni consumir cuota. No prueba
dominio o entrega; esa evidencia sigue siendo el envío controlado y su evento.

## 5. Recuperar Mercado Pago

1. Mantén `PAYMENT_PROVIDER=manual` durante la reparación.
2. Crea un token nuevo, actualiza `MERCADO_PAGO_ACCESS_TOKEN` en Production y
   crea un nuevo deploy sin revocar todavía el anterior.
3. Configura `PAYMENT_PROVIDER=mercado_pago` únicamente en un entorno de QA y
   exige `mercadoPago: up`.
4. Completa un pago sandbox usando un negocio OAuth distinto de la cuenta dueña
   de la aplicación.
5. Confirma webhook válido, transición de booking, asiento de ledger e
   idempotencia ante entrega repetida.
6. Recién entonces reactiva Mercado Pago en Production y repite los health
   checks.
7. Revoca el token anterior sólo con el nuevo deploy activo y el ciclo sandbox
   verificado.

`mercadoPago: up` sólo valida el token global usado por el lookup inicial del
webhook. No prueba tokens OAuth de negocios, cobro, webhook ni settlement.

## 6. Smoke posterior a la recuperación

Completa y registra:

- creación de reserva y disponibilidad;
- pago manual/transferencia y comprobante;
- reprogramación sin perder el estado de pago;
- expiración de holds;
- recordatorios y fidelización;
- webhook, ledger e idempotencia;
- ambos health checks en HTTP 200.

No uses un HTTP 2xx de los crons como única evidencia: revisa también los campos
`errors` de sus respuestas hasta que el workflow de crons sea endurecido.

## 7. Cerrar el incidente

Ejecuta el monitor manualmente y registra su run:

```bash
gh workflow run production-health.yml
gh run list --workflow production-health.yml --limit 3
```

Cierra sólo con deploy SHA, hora, estados sanitizados, evidencia `Delivered`
de email cuando aplique y evidencia sandbox de pago/webhook/ledger cuando se
reactive Mercado Pago.
