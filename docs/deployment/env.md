# Environment Variables

## Required Variables

| Variable | Description |
|-----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Prisma) |
| `DIRECT_URL` | Direct database connection for Prisma migrations |
| `APP_DOMAIN` | Application domain (e.g., `agendita.com`) |
| `PAYMENT_PROVIDER` | Payment provider: `mock`, `manual`, `mercado_pago`, or `webpay` |

## Optional Variables

| Variable | Description |
|-----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `NEXT_PUBLIC_SUPABASE_URL` | Public Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase anon key |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL (required in production) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token (required in production) |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `MERCADO_PAGO_ACCESS_TOKEN` | Mercado Pago access token (required when `PAYMENT_PROVIDER=mercado_pago`) |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Mercado Pago webhook secret |
| `NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY` | Mercado Pago public key |
| `NEXT_PUBLIC_APP_DOMAIN` | Public app domain override |

## Validation

Environment validation runs automatically:

- **At build time**: `npm run build` executes `scripts/validate-env.js` before compiling.
- **At server startup**: `instrumentation.ts` calls `assertValidEnv()` in production Node.js runtime.

The build-time check catches missing required variables before deployment. The runtime check serves as a secondary fail-fast in serverless environments.

## Payment Provider

Set `PAYMENT_PROVIDER` to one of:

- `mock` — development/sandbox mode (default)
- `mercadopago` — legacy name (invalid, will be rejected)
- `mercado_pago` — production Mercado Pago integration
- `manual` — manual payment recording only (no public checkout)
- `webpay` — not yet implemented

When using `mercado_pago`, you must also set `MERCADO_PAGO_ACCESS_TOKEN` and `MERCADO_PAGO_WEBHOOK_SECRET`.

## Domain Format

`APP_DOMAIN` accepts formats:
- `agendita.com` (auto-prepended with `https://`)
- `https://agendita.com` (full URL)

Local development uses `localhost:3000` automatically.