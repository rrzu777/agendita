# Environment Variables

## Required Variables

| Variable | Description |
|-----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Prisma) |
| `DIRECT_URL` | Direct database connection for Prisma migrations |
| `APP_DOMAIN` | Application domain (e.g., `agendita.com`) |
| `NEXT_PUBLIC_APP_DOMAIN` | Public app domain (e.g., `agendita.com`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |

## Payment Provider

`PAYMENT_PROVIDER` controls how public checkout works:

| Value | Public checkout | Notes |
|-------|-----------------|-------|
| `manual` | **Disabled** — fallback manual/pending | Beta manual. No online payments. Booking created as `pending_payment`. |
| `mercado_pago` | Per-business (requires `PaymentAccount.connected`) | MP sandbox or production. Needs OAuth or global token. |
| `mock` | Dev/test only | Never enables real MP per business. Forbidden in production without override. |
| `webpay` | Not implemented | Never enables MP per business. |

### Beta manual (recomendado para lanzamiento)

```
PAYMENT_PROVIDER=manual
```

Con `manual`, el checkout público siempre muestra el fallback "Este negocio coordina el abono directamente". Las reservas se crean como `pending_payment` sin pago online. Los pagos se registran desde el dashboard.

### Mercado Pago multi-tenant

Para habilitar Mercado Pago por negocio:

```
PAYMENT_PROVIDER=mercado_pago
```

Y además requiere OAuth (por negocio) o token global:

```
# OAuth (requerido para multi-tenant real)
MERCADO_PAGO_CLIENT_ID=...
MERCADO_PAGO_CLIENT_SECRET=...
MERCADO_PAGO_REDIRECT_URI=https://app.agendita.com/api/mercadopago/callback

# O sin OAuth, usar token global (legacy/deprecado para cobro tenant)
MERCADO_PAGO_ACCESS_TOKEN=...
```

Cada negocio conecta su propia cuenta Mercado Pago desde `/dashboard/settings/payments`. Los tokens se almacenan cifrados en `PaymentAccount.accessTokenEncrypted`.

### Mercado Pago producción

En producción, adicionalmente se requiere:

```
MERCADO_PAGO_WEBHOOK_SECRET=...    # Firma de webhooks
ENCRYPTION_KEY=...                 # Cifrado AES-256-GCM de tokens por negocio
```

**NO-GO para Mercado Pago producción** hasta completar QA sandbox completo.

## Optional Variables

| Variable | Description |
|-----------|-------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side ops) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL (required in production) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token (required in production) |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `FROM_EMAIL` | Sender email for transactional emails |
| `NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY` | Mercado Pago public key (optional, for client-side SDK) |

## Validation

Environment validation runs automatically:

- **At build time**: `npm run build` executes `scripts/validate-env.js` before compiling.
- **At server startup**: `instrumentation.ts` calls `assertValidEnv()` in production Node.js runtime.

The build-time check catches missing required variables before deployment.

## Domain Format

`APP_DOMAIN` accepts formats:
- `agendita.com` (auto-prepended with `https://`)
- `https://agendita.com` (full URL)

Local development uses `localhost:3000` automatically.
