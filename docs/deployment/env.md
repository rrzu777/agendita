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

## Web Push cancellation reminders

Web Push is optional, but its VAPID configuration is atomic. Leave all three
VAPID variables absent to disable push safely, or configure all three together:

```bash
NEXT_PUBLIC_VAPID_PUBLIC_KEY=... # public browser key; embedded at build time
VAPID_PRIVATE_KEY=...            # server secret; never expose or commit
VAPID_SUBJECT=mailto:soporte@agendita.cl
ENCRYPTION_KEY=...               # also required when Web Push is enabled
```

- Generate the VAPID pair once with `npx web-push generate-vapid-keys`. Store
  the private key only in the deployment secret manager.
- `VAPID_SUBJECT` must be a `mailto:` address or an HTTPS URL.
- `ENCRYPTION_KEY` encrypts the stored browser subscription and signs guest
  grants. Keep it stable within an environment; rotating it invalidates stored
  encrypted subscriptions and outstanding grants.
- A partial VAPID trio or a complete trio without `ENCRYPTION_KEY` blocks the
  build and production startup. Changing `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
  requires a new deployment.

The browser permission, `/notificaciones`, and `/sw.js` must live on the
canonical origin produced by `getAppUrl`, not on tenant subdomains. In
production, set `APP_DOMAIN` and `NEXT_PUBLIC_APP_DOMAIN` to that same host
(for example, `www.agendita.cl`); tenant booking URLs continue to use
`<negocio>.agendita.cl`.

On iOS, Web Push requires iOS/iPadOS 16.4 or newer and Agendita installed to the
home screen. Opening the booking page in a normal Safari tab is not sufficient.

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

## Web Push smoke checks

Run these against the deployed canonical origin. They verify routing and worker
headers, not delivery to a real device:

```bash
APP_ORIGIN=https://www.agendita.cl

curl -fsSI "$APP_ORIGIN/notificaciones"
curl -fsS -D /tmp/agendita-sw.headers "$APP_ORIGIN/sw.js" -o /tmp/agendita-sw.js
rg -i 'content-type: application/javascript|cache-control: no-cache|service-worker-allowed: /' /tmp/agendita-sw.headers
rg "addEventListener\('(push|notificationclick)'" /tmp/agendita-sw.js
```

For an isolated test booking, the authenticated cron response must also report
zero application errors. Supply `CRON_SECRET` from the secret manager without
printing it:

```bash
curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$APP_ORIGIN/api/cron/cancellation-warnings" \
  | jq -e '.sent >= 0 and .skipped >= 0 and .errors == 0'
```

This cron can send real notifications to every eligible booking. Do not invoke
it manually until the rollout is isolated to test data or the scheduled run is
intended.
