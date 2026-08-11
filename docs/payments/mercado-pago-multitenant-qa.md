# QA Mercado Pago Multi-Tenant — Plan de pruebas sandbox

## Objetivo

Verificar que cada negocio cobra en su propia cuenta de Mercado Pago, sin mezcla de tenants,
sin tokens expuestos y con webhook idempotente.

## Prerrequisitos

1. App de Mercado Pago creada en [Mercado Pago Developers](https://www.mercadopago.com/developers)
2. Credenciales configuradas en `.env.local`:
   - `MERCADO_PAGO_CLIENT_ID`
   - `MERCADO_PAGO_CLIENT_SECRET`
   - `MERCADO_PAGO_REDIRECT_URI` (HTTPS público en entornos compartidos)
   - `MERCADO_PAGO_ENVIRONMENT` (`sandbox` o `production`, explícito)
   - `ENCRYPTION_KEY` (obligatoria también en sandbox/dev y con provider manual;
     cifra tokens OAuth en reposo)
3. Dos cuentas sandbox de prueba (vendedores):
   - Seller A (`TEST-USER-A-...`)
   - Seller B (`TEST-USER-B-...`)
4. Una cuenta comprador sandbox para simular pagos

Registrar la callback exacta
`https://<APP_DOMAIN>/api/mercado-pago/callback`. La health protegida valida
la configuración OAuth, pero nunca prueba tokens de negocios arbitrarios.
`up` significa configurado, no conectado ni cobro E2E validado.
Health sólo comprueba que `ENCRYPTION_KEY` esté presente: nunca la expone, usa
para descifrar ni intenta leer tokens almacenados.
El origen debe coincidir exactamente con `APP_DOMAIN`: no se agrega ni elimina
`www`, no se aceptan puertos alternos, query, hash ni credenciales embebidas.
Los previews con otro hostname requieren su propia configuración; nunca se
reutiliza silenciosamente la callback canónica de producción.

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

### 6. Credencial OAuth del seller expirada
- En sandbox, expirar la credencial OAuth sandbox de Seller A (o esperar su
  expiración natural). En producción, este caso sólo usa credenciales OAuth
  productivas del seller conectado; nunca reutilizar credenciales sandbox.
- Procesar pago
- **Esperado:** la cuenta queda `expired`, se encola
  `subscription_oauth_expired` y no existe fallback a credenciales globales o
  de otro ambiente

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
-- Distribución por estado, sin IDs ni agrupación por negocio
SELECT status, COUNT(*) FROM "Payment" GROUP BY status;

-- LedgerEntry único por Payment
SELECT COUNT(*) AS duplicate_payment_groups
FROM (
  SELECT "paymentId" FROM "LedgerEntry"
  WHERE "paymentId" IS NOT NULL
  GROUP BY "paymentId" HAVING COUNT(*) > 1
) duplicates;
-- Debe retornar el número 0; no expone los paymentId.

-- Payment.businessId coincide con Booking.businessId
SELECT COUNT(*) AS cross_tenant_mismatches
FROM "Payment" p JOIN "Booking" b ON p."bookingId" = b.id
WHERE p."businessId" != b."businessId";
-- Debe retornar el número 0.
```

## Validaciones seguridad

```sql
-- Sólo indica si existen cuentas con material ausente; nunca devuelve blobs.
SELECT COUNT(*) AS accounts_missing_encrypted_material
FROM "PaymentAccount"
WHERE "accessTokenEncrypted" IS NULL OR "accessTokenEncrypted" = '';

-- No hay tokens en SubscriptionLog
SELECT COUNT(*) AS suspicious_log_rows
FROM "SubscriptionLog"
WHERE notes LIKE '%access_token%' OR notes LIKE '%APP_USR%';
-- Ambas consultas deben retornar el número 0.
```

## Validaciones fallback

- Negocio sin MP puede operar con pago manual ✅
- Desconectar MP deshabilita checkout online ✅
- Historial de pagos sigue visible después de desconectar ✅

## Automatización

Ejecutar `npm run payments:qa` para la matriz offline. Para PostgreSQL local
fresco, usar `NODE_ENV=test` y `TEST_DATABASE_URL`, `DATABASE_URL` y
`DIRECT_URL` idénticas, con host loopback y base `agendita_payment_qa_test`, y
ejecutar `npm run payments:qa -- --postgres`. Ninguno de
estos comandos autoriza tráfico externo ni prueba que el seller recibió dinero.

Tests unitarios existentes cubren:
- `mercado-pago-webhook.test.ts`: firma, idempotencia, validaciones metadata, amount
- `mercado-pago-provider.test.ts`: createPayment, verifyPayment, handleWebhook
- `payment-factory.test.ts`: resolución de providers, disponibilidad, multi-tenant

Para automatizar casos sandbox reales, se recomienda usar Playwright E2E con cuentas sandbox.
Ver `tests/e2e/` para ejemplos de estructura.

Todo checkout OAuth real, recepción por Seller Test y entrega de webhook del
proveedor sigue **pendiente externo** hasta ejecutarse manualmente en sandbox.

## Evidencia requerida

- Capturas de pantalla de cada caso
- Conteos, estados, timestamps redondeados y booleans; nunca IDs de
  reservas/pagos/negocios/proveedor
- Resultado PASS/FAIL por caso
- Bugs encontrados con pasos para reproducir

Nunca compartir IDs, tokens, URLs de checkout ni payloads como evidencia.
Usar sólo PASS/FAIL, conteos, estados y timestamps redondeados. Al terminar,
desconectar y revocar los sellers sandbox y eliminar únicamente datos de prueba.
