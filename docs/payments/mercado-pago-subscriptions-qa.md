# QA y operación — mensualidad automática de Agendita

Este runbook cubre **dueña → Agendita**. Es independiente del cobro
clienta → dueña y usa credenciales separadas por ambiente.

## Configuración

- `MP_SUBSCRIPTIONS_ENABLED`: habilita nuevas suscripciones.
- `SUBSCRIPTION_ENFORCEMENT_ENABLED`: aplica o difiere suspensión.
- `MERCADO_PAGO_ENVIRONMENT`: `sandbox` o `production`.
- `MERCADO_PAGO_<AMBIENTE>_ACCESS_TOKEN`.
- `MERCADO_PAGO_<AMBIENTE>_WEBHOOK_SECRET`.
- `MERCADO_PAGO_<AMBIENTE>_SUBSCRIPTIONS_CALLBACK_URL`.
- `CRON_SECRET`, igual en runtime y GitHub Actions.

No hay fallback al token genérico ni al otro ambiente. La callback debe ser
HTTPS y terminar en `/api/webhooks/mercado-pago/subscriptions`. Registrar
preapproval y pagos autorizados en Mercado Pago Developers.

## Health seguro

`GET /api/health/dependencies` exige bearer `CRON_SECRET` y reporta:

- `mercadoPagoSubscriptions`: `not_required` con flag apagado,
  `not_configured` si falta configuración, `down` ante credencial inválida y
  `up` tras una consulta read-only de identidad.
- `mercadoPagoOAuth`: valida sólo configuración de la aplicación. Nunca enumera
  ni prueba tokens de negocios.

El health no crea planes, preferencias, autorizaciones ni pagos, no muta DB y
no genera tráfico cobrado. `up` prueba configuración/credencial, **no E2E**.

## Prueba sandbox mensual

1. Seleccionar `sandbox`, dejar ambos flags en `false` y revisar health.
2. Crear vendedor y comprador de prueba separados; nunca usar cuentas reales.
3. Activar `MP_SUBSCRIPTIONS_ENABLED=true`, con enforcement aún en `false`.
4. Iniciar desde `/dashboard/billing` y completar el checkout sandbox.
5. Confirmar por agregados: una suscripción activa, un pago aprobado y una
   notificación terminal. Repetir el webhook no altera los conteos.
6. Probar rechazo, gracia, recuperación y cancelación al final del período. El
   callback por sí solo nunca activa la suscripción.
7. Ejecutar manualmente `Scheduled crons`; observar sólo `processed`,
   `reconciled`, `notified`, `suspended` y `errors`.
8. Activar enforcement sólo después de una ventana estable.

## Señales agregadas de incidente

Con acceso read-only:

```sql
SELECT status, COUNT(*) FROM "BusinessSubscription" GROUP BY status;
SELECT status, COUNT(*) FROM "SubscriptionPayment" GROUP BY status;
SELECT status, COUNT(*) FROM "SubscriptionNotificationDelivery" GROUP BY status;
SELECT status, COUNT(*) FROM "PaymentAccount" GROUP BY status;
```

Alertar por `manual_review`, OAuth `expired`, errores de cron o caída súbita de
aprobaciones. Logs canónicos: `subscription_billing_cron.completed`,
`subscription_billing_cron.item_failed`, `subscription_billing_cron.failed` y
eventos de webhook. No copiar IDs, secretos, URLs ni payloads.

## Rotación, rollback y limpieza

1. Rotar en Mercado Pago, actualizar runtime, desplegar y validar health/sandbox
   antes de retirar la credencial anterior.
2. `MP_SUBSCRIPTIONS_ENABLED=false` detiene nuevas altas.
3. `SUBSCRIPTION_ENFORCEMENT_ENABLED=false` evita nuevas suspensiones; ninguno
   de los flags cancela suscripciones ni deshace pagos aprobados.
4. No aprobar pagos manualmente: enviar casos ambiguos a revisión y reconciliar.
5. Cancelar suscripciones sandbox, revocar usuarios de prueba y conservar sólo
   PASS/FAIL, conteos y timestamps.
