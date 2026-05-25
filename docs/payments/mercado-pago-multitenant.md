# Mercado Pago Multi-Tenant — Arquitectura

## Visión general

Cada negocio conecta su propia cuenta de Mercado Pago vía OAuth.
Agendita no usa un `MERCADO_PAGO_ACCESS_TOKEN` global para cobrar a los tenants.
La clienta paga directo al Mercado Pago del negocio. Agendita registra el estado del pago.

## Modelo de datos

### PaymentAccount

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | TEXT (PK) | CUID |
| businessId | TEXT (FK → Business) | Negocio dueño de la cuenta |
| provider | TEXT | Siempre 'mercado_pago' |
| providerAccountId | TEXT? | user_id de Mercado Pago |
| accessTokenEncrypted | TEXT | Token cifrado con AES-256-GCM |
| refreshTokenEncrypted | TEXT? | Refresh token cifrado |
| publicKeyEncrypted | TEXT? | Public key cifrada |
| expiresAt | TIMESTAMP? | Expiración del token |
| status | PaymentAccountStatus | pending/connected/expired/disconnected/error |
| connectedAt | TIMESTAMP? | Fecha de conexión |
| disconnectedAt | TIMESTAMP? | Fecha de desconexión |
| rawMetadata | JSONB? | Metadata adicional |

Unique constraint: `[businessId, provider]`

## Cifrado

- Algoritmo: AES-256-GCM
- IV: 16 bytes aleatorios por operación
- Auth tag: 16 bytes
- Key derivation: scrypt con salt fijo `agendita-mp-encryption-v1`
- Key: `ENCRYPTION_KEY` desde env vars
- Helper: `encryptSecret(plaintext) → base64`, `decryptSecret(base64) → plaintext`

## Flujo OAuth

1. Negocio hace click en "Conectar Mercado Pago" en `/dashboard/settings/payments`
2. `startMercadoPagoConnect` genera state anti-CSRF: `{businessId}:{random}:{expiresAt}:{hmac}`
3. Redirect a `https://auth.mercadopago.cl/authorization` con client_id, state, redirect_uri
4. Mercado Pago redirige al callback `/api/mercado-pago/callback?code=...&state=...`
5. Callback valida:
   - State no expirado y firma HMAC válida
   - Code presente
6. Intercambia code por tokens via `POST /oauth/token`
7. Cifra access_token, refresh_token, public_key
8. Upsert en PaymentAccount con status=connected
9. Redirect a `/dashboard/settings/payments?success=connected`

## Flujo de pago (initatePayment)

1. Cliente crea reserva → `createBooking` → estado `pending_payment`
2. `initiatePayment`:
   - Valida booking pagable y hold no expirado
   - Calcula monto autoritativo (desde DB, no frontend)
   - `getOnlinePaymentProviderForBusiness(businessId)`:
     - Busca PaymentAccount.connected para el business
     - Desencripta accessToken
     - Crea provider con `createMercadoPagoProvider(accessToken)`
   - Pre-crea Payment local (status=pending) con id usado como external_reference
   - Crea preferencia MP con:
     - `external_reference = localPaymentId`
     - `metadata = { businessId, bookingId, localPaymentId, paymentType }`
     - `notification_url = APP_URL/api/webhooks/mercado-pago`
   - Retorna redirectUrl para checkout MP

## Flujo webhook

1. Mercado Pago POST a `/api/webhooks/mercado-pago` con data.id
2. Validar firma con `MERCADO_PAGO_WEBHOOK_SECRET` (HMAC SHA-256)
3. Consultar pago a MP con **token global** (SOLO para obtener external_reference)
   - El token global es MERCADO_PAGO_ACCESS_TOKEN, credencial a nivel de aplicación
   - Se usa **exclusivamente** para el lookup inicial del external_reference
   - NUNCA se usa para aplicar/confirmar pagos
4. Resolver Payment local via external_reference = localPaymentId
5. Obtener businessId desde Payment
6. **Para pagos approved: OBLIGATORIO** buscar PaymentAccount.connected para ese businessId
   - Si no existe PaymentAccount → RECHAZAR (no aplicar pago)
   - Si falla decrypt del token → RECHAZAR (no aplicar pago)
   - Si falla fetch con token del negocio → RECHAZAR (no aplicar pago)
   - Solo tras re-verificación exitosa con token del negocio → continuar
7. Validar metadata: localPaymentId, bookingId, businessId, paymentType
8. Validar amount, currency, provider
9. Si approved: `applyApprovedPayment` vía servicio financiero central
10. Si ya approved: retornar 200 idempotentemente

## Desconexión

- Botón "Desconectar" en `/dashboard/settings/payments`
- `disconnectMercadoPago`: cambia status a 'disconnected', registra disconnectedAt
- No borra PaymentAccount (historial preservado)
- Nuevos pagos online quedan deshabilitados

## Variables de entorno

| Variable | Uso | Obligatoria |
|----------|-----|-------------|
| MERCADO_PAGO_CLIENT_ID | OAuth client_id | Solo para OAuth connect |
| MERCADO_PAGO_CLIENT_SECRET | OAuth client_secret | Solo para OAuth connect |
| MERCADO_PAGO_REDIRECT_URI | OAuth callback URL | Solo para OAuth connect |
| MERCADO_PAGO_ACCESS_TOKEN | **Token nivel app. Solo para lookup inicial de external_reference en webhook. NUNCA para aplicar pagos.** | Sí (webhook lookup) |
| MERCADO_PAGO_WEBHOOK_SECRET | Firma webhook HMAC | Sí en producción |
| ENCRYPTION_KEY | Clave para cifrar/descifrar tokens de negocios + firmar OAuth state | **Sí — obligatorio para Mercado Pago** |
| APP_URL | URL base de la app (usada para notification_url del webhook) | Sí |

### Semántica de MERCADO_PAGO_ACCESS_TOKEN

El `MERCADO_PAGO_ACCESS_TOKEN` es una credencial a **nivel de aplicación** (no de negocio).
Se usa **exclusivamente** para:
1. El lookup inicial en el webhook (obtener `external_reference` desde un pago)
2. Cualquier operación de infraestructura que no involucre dinero de tenants

**NUNCA** se usa para:
- Crear preferencias de pago para negocios (eso usa el token del negocio)
- Aplicar/confirmar pagos (eso requiere re-verificación con token del negocio)
- Cobrar a nombre de un negocio

## Restricciones

- No split payments (cada pago va a una sola cuenta)
- No comisiones de plataforma
- No confirmar pago por redirect (solo webhook)
- No tokens en logs ni payloads al cliente
- No usar token de negocio A para booking de negocio B
