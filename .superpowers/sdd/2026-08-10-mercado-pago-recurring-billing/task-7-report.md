## Task 7: Notificaciones idempotentes

### Implementado

- Plantillas para 7/3/1 días, activación, pago aprobado/fallido, recuperación, suspensión, cancelación solicitada/efectiva y OAuth vencido. El contenido no interpola IDs locales/externos, secretos, tarjetas ni URLs de checkout.
- Outbox `SubscriptionNotificationDelivery`: clave estable `subscriptionId:kind:effectiveDate`, inserción antes de enviar, snapshot inmutable de nombre/destinatarios, claim CAS con lease, `sent` no se vuelve a reclamar y `failed` reintenta.
- La transición financiera encola lifecycle dentro de su misma transacción Prisma; Resend siempre ocurre después del commit desde cron. Una caída entre enqueue y send deja `pending` reclamable.
- Resend usa `batch.send(..., { idempotencyKey })`, no un header visible en el mail. La entrega por batch mantiene privadas las direcciones de owner/admin. Logs de este flujo no llevan destinatarios, subject, ID externo ni detalle externo.
- `concurrent_idempotent_requests` es retryable. `invalid_idempotent_request`/key inválida queda `failed` terminal sanitario. Los reintentos no atraviesan 23 h, antes de la ventana oficial de 24 h de Resend, para no reenviar una respuesta ambigua tras expirar la clave.

### Verificación

- RED: módulo ausente; luego RED de orden: la entrega bloqueaba la transición. GREEN: transición antes de Resend.
- `npm test -- src/lib/notifications/subscriptions.test.ts src/lib/notifications/subscriptions-email-provider.test.ts src/lib/cron/subscription-billing.test.ts` — 34/34.
- `npm test -- src/lib/subscriptions/transition.integration.test.ts src/lib/subscriptions/state-machine.test.ts src/lib/subscriptions/webhook.test.ts` — 89/89.
- PostgreSQL 16 temporal, 42 migraciones aplicadas: `npm run test:integration -- src/lib/cron/subscription-billing.integration.test.ts` — 4/4; `src/lib/subscriptions/transition.integration.test.ts` — 22/22 (incluye carreras de transición).
- `npm run typecheck` — OK.
- `npx eslint ...` — 0 errores; 5 warnings preexistentes en `email-provider.ts`.
- Build con variables locales sanitarias y PostgreSQL temporal: `npm run build` — OK (48 rutas). Mantiene warning preexistente de convención `middleware` de Next.

### Límite explícito

No existe actualmente un escritor que cambie `PaymentAccount` a `expired` (el único consumidor detectado sólo lee ese estado). La plantilla/outbox `subscription_oauth_expired` queda disponible para el futuro writer; conectarla a un lector repetiría avisos y no sería un evento de lifecycle durable.

## Fix round 1

- Nueva migración forward-only separa `eventAt`, `effectiveDate`, `availableAt`, primer intento de proveedor y `manualReviewAt`. Transiciones usan el ID durable de su log como identidad de evento; cancelación se encola al solicitarse y conserva el cierre de período sólo para el copy.
- La ventana de 23 h comienza en `firstProviderAttemptAt`; un aviso nunca intentado sigue disponible aunque sea antiguo. Intentos ambiguos vencidos e idempotency conflicts pasan a `manual_review` sanitario, sin reenvío.
- `npm test -- src/lib/notifications/subscriptions.test.ts src/lib/cron/subscription-billing.test.ts` — 33/33; `npm run typecheck` — OK.
