# Activación staged de alertas e insights semanales

Estado de esta implementación: código y pruebas locales en la rama de trabajo; flags apagadas, sin migración aplicada a producción, sin llamadas reales a Resend/OpenAI y sin scheduler habilitado.

## Orden seguro

1. Revisar el diff y ejecutar `npx prisma validate`, `npx prisma generate`, typecheck, lint y la suite focal. Aplicar las migraciones aditivas sólo en una copia restaurable; verificar tablas, índices, CHECK y FKs.
2. Desplegar con `OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED=false`, `OWNER_ANALYTICS_ALERTS_ENABLED=false`, `OWNER_ANALYTICS_INSIGHTS_ENABLED=false` y presupuestos vacíos. El dashboard debe degradar a las métricas existentes.
3. Ejecutar el monitor con un heartbeat sintético y confirmar `not_enabled`; no poner `OWNER_ANALYTICS_MONITOR_EXPECTED=true` todavía.
4. Para el piloto, aprobar por separado privacidad/legal, allowlist exacta de negocios, destinatarios owner/admin, Resend, OpenAI, modelo y presupuesto. Configurar primero monitor sin emails, luego `OWNER_ANALYTICS_MONITOR_EXPECTED=true` y observar siete días de estado/backlog.
5. Sólo después habilitar alert emails con un receptor verificado y una alerta sintética. Confirmar una sola entrega por `dedupeKey`, retry con la misma clave y resolución sin duplicados.
6. Para weekly insights, habilitar el workflow sólo con `OWNER_ANALYTICS_INSIGHTS_CRON_ENABLED=true`. Mantener la bandera de aplicación global apagada hasta que existan siete días completos de medición v2; luego activar un negocio de allowlist y confirmar facts, hash, retención y aislamiento tenant.
7. Activar IA y email semanal de forma independiente. Un fallo del proveedor debe dejar estado determinístico y no bloquear Booking/captura.

El cron weekly usa el mismo heartbeat durable que maintenance: las continuaciones
transportan `runId`, `leaseToken`, secuencia y cursor confirmado. El job reserva
tokens, limita llamadas por semana, aplica circuito half-open y espera al menos
una hora entre reintentos y persiste un `Retry-After` válido entre una y 24 horas.
El claim exige consentimiento fuente v2 y revalida el opt-in dentro de la
transacción; si el monitor operacional está habilitado y no está `healthy`, se
persisten facts determinísticos, no se llama a IA y sólo se drenan alertas
operativas (no digest semanales). En `not_initialized` no se drena ningún
outbox. El código de captura pública sigue en v1: antes de cualquier activación
hay que desplegar y verificar el paso de ruta source-consent v2 del plan,
incluido el cierre de v1/apertura de v2 sin solapamiento.
Antes de activar IA aún debe verificarse este comportamiento con un proveedor
simulado/staged y un presupuesto real; un presupuesto de llamadas por sí solo no
es evidencia suficiente de control de costo.

## Evidencia mínima del piloto

- SHA exacto, migración y rollback verificados.
- `not_enabled`, `not_initialized`, `healthy`, `warning` y `critical` observados mediante el endpoint autenticado, sin payload de cliente/tenant.
- Heartbeat: una corrida completa, una continuación, lease vencido y error terminal; comprobar que `lastSuccessAt` sólo cambia en la corrida completa.
- Outbox: apertura, escalamiento, recordatorio, resolución, ambigüedad y corte de 23 h; verificar que los incidentes activos no se purgan.
- Weekly: semana v1 sólo determinística, semana v2 con al menos 20 intentos maduros, semana mixta excluida, cursor repetido idempotente y hash estable.
- Consentimiento: activar/desactivar IA y email desde owner/admin; revocar email antes de send cancela la entrega y perder el rol cancela el retry.
- Consentimiento fuente: con la bandera aún apagada, demostrar que v1 continúa
  siendo la única versión capturable; en staged, cerrar v1/abrir v2, crear una
  semana v2 completa y excluir una semana mixta antes de cualquier proveedor.
- Health-check externo: respuesta malformed/unreachable/`warning` debe fallar sólo cuando `OWNER_ANALYTICS_MONITOR_EXPECTED=true`; con `false` debe omitir la llamada.

## Rollback

Apagar primero scheduler, IA y emails; mantener el purge para cumplir retención. Cerrar preferencias y no borrar Booking, pagos, ledger ni captura existente. No revertir migraciones a ciegas: si se retira la UI, conservar el endpoint de maintenance compatible hasta vaciar payloads vencidos. Rotar secretos sólo según el procedimiento de cron/Resend/OpenAI, nunca registrándolos.
