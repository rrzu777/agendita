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
| providerAccountId | TEXT? | user_id vendedor de Mercado Pago; obligatorio al conectar |
| environment | MercadoPagoEnvironment | sandbox/production, sin compartir credenciales |
| accessTokenEncrypted | TEXT | Token cifrado con AES-256-GCM |
| refreshTokenEncrypted | TEXT? | Refresh token cifrado |
| publicKeyEncrypted | TEXT? | Public key cifrada |
| expiresAt | TIMESTAMP? | Expiración del token |
| status | PaymentAccountStatus | pending/connected/expired/disconnected/error |
| connectedAt | TIMESTAMP? | Fecha de conexión |
| disconnectedAt | TIMESTAMP? | Fecha de desconexión |
| rawMetadata | JSONB? | Metadata adicional |

Unique constraint: `[businessId, provider, environment]`

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
     - `notification_url = APP_URL/api/webhooks/mercado-pago?local_payment_id=<Payment.id>`
       (localizador de candidato, nunca prueba de pago)
   - Retorna redirectUrl para checkout MP

## Flujo webhook

1. Mercado Pago POST a `/api/webhooks/mercado-pago` con data.id
2. Validar firma con `MERCADO_PAGO_WEBHOOK_SECRET` (HMAC SHA-256)
3. Resolver el candidato `Payment` por el `local_payment_id` persistido en la URL de notificación
   - El query param sólo localiza; no autoriza ni confirma nada
   - Validar localmente provider, environment y ownership Payment↔booking/paquete antes de red
4. Obtener businessId y environment desde Payment
5. Buscar exclusivamente el `PaymentAccount.connected` de ese business+environment
6. Consultar `/v1/payments/{data.id}` una sola vez con el token OAuth de ese negocio
   - Si no existe PaymentAccount → RECHAZAR (no aplicar pago)
   - Si falla decrypt del token → RECHAZAR (no aplicar pago)
   - Si falla fetch con token del negocio → RECHAZAR (no aplicar pago)
   - No existe fallback a `MERCADO_PAGO_ACCESS_TOKEN`
7. Exigir coincidencia del ID consultado, `external_reference`, `collector_id` vendedor,
   metadata (`localPaymentId`, booking/paquete, businessId, paymentType), monto y moneda
8. Sólo tras la verificación autoritativa continuar con la transición local
9. Si approved: `applyApprovedPayment` vía servicio financiero central
10. Si ya approved: retornar 200 idempotentemente

### Preferencias legacy sin locator

Las preferencias emitidas antes del despliegue de `local_payment_id` no pueden
resolverse de forma segura desde una notificación estándar de pago: Mercado Pago
no incluye un preference ID autoritativo en ese webhook. No se hace lookup global.
Un nuevo intento crea otro `Payment` local y una preferencia nueva; la preferencia
anterior no se reutiliza. Si un pago/refund/chargeback legacy llega tarde, el webhook
falla cerrado y se deriva a reconciliación operativa acotada usando el
`providerPreferenceId`, negocio y ambiente ya persistidos, siempre con la cuenta
vendedora conocida. Nunca se prueba tokens de otros negocios para descubrirlo.

Cada creación usa `Payment.id` como referencia externa estable. El `providerPreferenceId` se
persiste por CAS y jamás se sobrescribe; una respuesta distinta para el mismo intento
queda en reconciliación manual. Los payloads persistidos son proyecciones sanitarias:
no incluyen payer, tarjeta, identificación, tokens, email, URLs ni objetos anidados.

Checkout Preferences no garantiza idempotencia para su `POST`. Por eso Agendita no
envía ni confía en `X-Idempotency-Key`. Antes del POST toma un lease durable por
`Payment.id`: dos requests concurrentes jamás emiten dos preferencias para el mismo
intento. Timeout, 5xx o respuesta 2xx inválida dejan el lease en `manual_review`,
excluyen ese `Payment` del reuso y un nuevo click explícito crea otro intento local.

El inventario legacy es ejecutable, acotado y sólo consulta DB por defecto:

```bash
npm run payments:audit-legacy-mp -- --before 2026-08-11T00:00:00Z --limit 50
```

El resultado expone únicamente conteos `reissue`, `manual_review` y `no_action`
(`reissue` permanece en cero con la evidencia disponible). Ni un
`providerPreferenceId`/ambiente nulo ni una cuenta vendedora ausente o expirada
demuestran que el POST nunca ocurrió: todo pago legacy pendiente se clasifica de
forma conservadora como `manual_review`. Tras revisar los conteos, `--apply` sólo
persiste incidentes idempotentes; no cancela pagos, no crea intentos, no lee
ninguna credencial `MERCADO_PAGO_<AMBIENTE>_ACCESS_TOKEN` de mensualidades, no
prueba tokens y no usa red.

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
| MERCADO_PAGO_SANDBOX_ACCESS_TOKEN / MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN | Credencial vendedora de Agendita para mensualidades, seleccionada estrictamente por `MERCADO_PAGO_ENVIRONMENT` | Sólo facturación SaaS del ambiente correspondiente |
| MERCADO_PAGO_SANDBOX_WEBHOOK_SECRET / MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET | Firma del webhook de mensualidades, estrictamente por ambiente | Sólo facturación SaaS del ambiente correspondiente |
| MERCADO_PAGO_SANDBOX_SUBSCRIPTIONS_CALLBACK_URL / MERCADO_PAGO_PRODUCTION_SUBSCRIPTIONS_CALLBACK_URL | Callback hosted de mensualidades, estrictamente por ambiente | Sólo facturación SaaS del ambiente correspondiente |
| MERCADO_PAGO_WEBHOOK_SECRET | Firma del webhook Checkout Pro clienta→dueña; no es credencial de consulta ni fallback de mensualidades | Sí para ese webhook |
| ENCRYPTION_KEY | Clave para cifrar/descifrar tokens de negocios + firmar OAuth state | **Sí — obligatorio para Mercado Pago** |
| APP_URL | URL base de la app (usada para notification_url del webhook) | Sí |

### Separación de la credencial de Agendita

Las credenciales `MERCADO_PAGO_<AMBIENTE>_*` pertenecen al circuito de
mensualidades dueña→Agendita y nunca hacen fallback entre sandbox y producción.
El webhook de servicios clienta→dueña no las lee. Crear, consultar y aplicar un pago
de servicio requiere siempre el token OAuth cifrado del `PaymentAccount` resuelto
por business y environment; una cuenta ausente/expirada falla cerrada.

## Restricciones

- No split payments (cada pago va a una sola cuenta)
- No comisiones de plataforma
- No confirmar pago por redirect (solo webhook)
- No tokens en logs ni payloads al cliente
- No usar token de negocio A para booking de negocio B
