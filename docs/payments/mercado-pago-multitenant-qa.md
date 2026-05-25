# QA Mercado Pago Multi-Tenant — Plan de pruebas sandbox

## Objetivo

Verificar que cada negocio cobra en su propia cuenta de Mercado Pago, sin mezcla de tenants,
sin tokens expuestos y con webhook idempotente.

## Prerrequisitos

1. App de Mercado Pago creada en [Mercado Pago Developers](https://www.mercadopago.com/developers)
2. Credenciales configuradas en `.env.local`:
   - `MERCADO_PAGO_CLIENT_ID`
   - `MERCADO_PAGO_CLIENT_SECRET`
   - `MERCADO_PAGO_REDIRECT_URI` (ej. `http://localhost:3000/api/mercado-pago/callback`)
3. Dos cuentas sandbox de prueba (vendedores):
   - Seller A (`TEST-USER-A-...`)
   - Seller B (`TEST-USER-B-...`)
4. Una cuenta comprador sandbox para simular pagos

## Preparación

### Negocio A: Mimos Nails
```sql
-- Crear negocios de prueba si no existen
INSERT INTO "Business" (...) VALUES (...);
INSERT INTO "BusinessUser" (...) VALUES (...);
INSERT INTO "BusinessSubscription" (...) VALUES (...);
INSERT INTO "Service" (...) VALUES (...);
INSERT INTO "AvailabilityRule" (...) VALUES (...);
```

### Negocio B: Barbería Demo
(mismo procedimiento)

## Casos felices

### 1. Clienta paga reserva de Business A
- Conectar cuenta Seller A en `/dashboard/settings/payments`
- Crear reserva pública para Business A
- Pagar con cuenta comprador sandbox
- **Esperado:** Booking A queda `confirmed`, Payment A `approved`, LedgerEntry A único
- **Esperado:** Dinero aparece en cuenta Seller A

### 2. Business B no ve nada de A
- Admin de Business B no puede ver la reserva/pago de A
- **Esperado:** Tenant isolation intacta

### 3. Repetir para Business B
- Conectar Seller B, crear reserva, pagar
- **Esperado:** Dinero en cuenta Seller B, sin interferencia con A

## Casos negativos

### 4. Negocio sin PaymentAccount
- Business sin Mercado Pago conectado
- Intentar iniciar pago online
- **Esperado:** Error "Este negocio no tiene Mercado Pago conectado"

### 5. PaymentAccount disconnected
- Desconectar Mercado Pago del negocio
- Intentar iniciar pago online
- **Esperado:** Error de disponibilidad

### 6. Token expirado
- Expirar manualmente el token (o esperar expiración natural)
- Procesar pago
- **Esperado:** Webhook falla o usa fallback con warning

### 7. Webhook cross-tenant
- Enviar webhook de A intentando modificar booking de B
- **Esperado:** Rechazado por businessId mismatch en metadata

### 8. Amount mismatch
- Crear preferencia por $10,000 pero webhook reporta $5,000
- **Esperado:** Rechazado

### 9. Currency mismatch
- Preferencia en CLP, pago en USD
- **Esperado:** Rechazado

### 10. Metadata mismatch
- metadata.localPaymentId no coincide con Payment.id
- metadata.bookingId no coincide
- metadata.businessId no coincide
- **Esperado:** Rechazado en cada caso

### 11. Webhook duplicado
- Enviar mismo webhook 2 veces
- **Esperado:** Primer webhook processes payment. Segundo retorna 200 idempotentemente sin crear LedgerEntry duplicado.

### 12. Redirect sin webhook
- Completar checkout pero webhook nunca llega
- **Esperado:** Booking queda en `pending_payment`, NO confirmado por redirect

### 13. Firma webhook inválida
- Enviar webhook con x-signature inválido
- **Esperado:** 401 Unauthorized

## Validaciones DB

```sql
-- No cross-tenant leakage
SELECT "businessId", COUNT(*) FROM "Payment" GROUP BY "businessId";
-- Debe mostrar solo los businessId correctos

-- LedgerEntry único por Payment
SELECT "paymentId", COUNT(*) FROM "LedgerEntry" GROUP BY "paymentId" HAVING COUNT(*) > 1;
-- Debe retornar 0 filas

-- Payment.businessId coincide con Booking.businessId
SELECT p.id, p."businessId" as p_biz, b."businessId" as b_biz
FROM "Payment" p JOIN "Booking" b ON p."bookingId" = b.id
WHERE p."businessId" != b."businessId";
-- Debe retornar 0 filas
```

## Validaciones seguridad

```sql
-- Tokens en PaymentAccount están cifrados (no legibles)
SELECT id, "accessTokenEncrypted" FROM "PaymentAccount";
-- Debe mostrar strings base64, no tokens planos

-- No hay tokens en SubscriptionLog
SELECT * FROM "SubscriptionLog" WHERE notes LIKE '%access_token%' OR notes LIKE '%APP_USR%';
-- Debe retornar 0 filas
```

## Validaciones fallback

- Negocio sin MP puede operar con pago manual ✅
- Desconectar MP deshabilita checkout online ✅
- Historial de pagos sigue visible después de desconectar ✅

## Automatización

Tests unitarios existentes cubren:
- `mercado-pago-webhook.test.ts`: firma, idempotencia, validaciones metadata, amount
- `mercado-pago-provider.test.ts`: createPayment, verifyPayment, handleWebhook
- `payment-factory.test.ts`: resolución de providers, disponibilidad, multi-tenant

Para automatizar casos sandbox reales, se recomienda usar Playwright E2E con cuentas sandbox.
Ver `tests/e2e/` para ejemplos de estructura.

## Evidencia requerida

- Capturas de pantalla de cada caso
- IDs de reservas/pagos sandbox
- Resultado PASS/FAIL por caso
- Bugs encontrados con pasos para reproducir
