# Vercel Deployment Guide

## Overview

Agendita is a Next.js 16 app using the App Router, deployed on Vercel. This guide covers the deployment steps and production checklist.

## Prerequisites

- Vercel account with team/org set up
- GitHub repository connected to Vercel
- Domain configured (or using Vercel-provided subdomain)

---

## Step 1 — Environment Variables

Set all required environment variables in Vercel's **Environment Variables** section for both `Production` and `Preview` environments.

### Required

| Name | Value | Notes |
|------|-------|-------|
| `DATABASE_URL` | `postgresql://...` | Prisma connection string |
| `DIRECT_URL` | `postgresql://...` | Direct connection for migrations |
| `APP_DOMAIN` | `yourdomain.com` | No path, no trailing slash |
| `NEXT_PUBLIC_APP_DOMAIN` | `yourdomain.com` | Same as APP_DOMAIN |
| `PAYMENT_PROVIDER` | `mock` (dev) or `mercado_pago` (prod) | |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | |

### Required in Production

| Name | Value | Notes |
|------|-------|-------|
| `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION` | `false` | Only set to `true` if you want mock payments in production |
| `UPSTASH_REDIS_REST_URL` | `https://xxx.upstash.io` | Rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | `...` | Rate limiting |
| `RESEND_API_KEY` | `re_...` | Email |
| `FROM_EMAIL` | `noreply@yourdomain.com` | Must be verified domain in Resend |
| `MERCADO_PAGO_ACCESS_TOKEN` | `APP_USR-...` | Only if PAYMENT_PROVIDER=mercado_pago |
| `MERCADO_PAGO_WEBHOOK_SECRET` | `...` | Only if PAYMENT_PROVIDER=mercado_pago |
| `NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY` | `APP_USR-...` | Only if PAYMENT_PROVIDER=mercado_pago |

> **Note**: `NEXT_PUBLIC_*` variables are inlined at build time. Changing them requires a new deployment.

---

## Step 2 — Build Configuration

The `package.json` build command already includes environment validation:

```
node scripts/validate-env.js && prisma generate && next build
```

No additional build configuration needed. The `instrumentation.ts` file registers the `assertValidEnv()` check on server startup.

### Framework Preset

Set in Vercel project settings:
- **Framework Preset**: Next.js
- **Build Command**: Leave as default (`npm run build` uses `package.json` override)

---

## Step 3 — Database Migrations

Before deploying, run migrations in production:

```bash
# Using direct URL (bypasses connection pooler)
DIRECT_URL=postgresql://... npx prisma migrate deploy
```

Or via the Vercel dashboard → Your project → Deployments → select a deployment → **Redeploy** after migrations.

The `postinstall` script runs `prisma generate` automatically during deployment.

---

## Step 4 — Cron Job for Hold Expiration

Add a cron job to expire stale booking holds every 5 minutes:

In Vercel: **Settings → Cron Jobs → Add Cron Job**

```
Schedule: */5 * * * *
URL: https://yourdomain.com/api/cron/expire-holds
Headers: (none required - cron is internal)
```

The endpoint is at `src/app/api/cron/expire-holds/route.ts` and is protected by checking for a secret header or internal network call.

---

## Step 5 — Domain Configuration

### DNS

If using a custom domain:

```
# Subdomain for business booking pages
*.yourdomain.com → CNAME → cname.vercel-dns.com

# Apex domain (optional, for the main app)
yourdomain.com → A → 76.76.21.21
```

### Vercel Domains

Add your domain in **Settings → Domains**. Vercel will automatically provision SSL certificates.

---

## Step 6 — Deployment

### Trigger a Deployment

1. Push to `main` branch — Vercel auto-deploys
2. Or: **Deployments → Trigger Deploy** → select a branch/commit

### Verify Deployment

```bash
# Check deployment URL
vercel ls

# Pull deployment info
vercel env pull
```

### Health Check

Visit `https://yourdomain.com/api/health` or check the landing page `/` loads without errors.

---

## Post-Deployment Checklist

- [ ] Environment variables set in Vercel (not `.env` — those don't deploy)
- [ ] Database migrations applied (`prisma migrate deploy`)
- [ ] Redis (Upstash) credentials configured for rate limiting
- [ ] Mercado Pago webhook URL registered in MP dashboard
- [ ] Resend domain verified
- [ ] DNS wildcard record for business subdomains
- [ ] Vercel Cron job for hold expiration added
- [ ] Build completes successfully
- [ ] Unit tests pass: `npm run test:unit`
- [ ] E2E tests pass: `npm run test:e2e`

---

## Rollback

In Vercel: **Deployments → select working deployment → ... → Redeploy**

Or revert in git and push to trigger automatic redeploy.

---

## Common Issues

### Build fails: `MISSING: DATABASE_URL`

Environment variables are not set in Vercel. Go to **Settings → Environment Variables** and add them. Do not commit `.env` files.

### Build fails: `MISSING: APP_DOMAIN`

Same as above — the build-time validation script catches this.

### Rate limiting not working in production

Check that `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set. If they're missing, the app uses `FailClosedRateLimiter` which blocks all requests.

### Mercado Pago webhook not receiving events

1. Check the webhook URL is registered in MP Developers Dashboard
2. Verify `MERCADO_PAGO_WEBHOOK_SECRET` is set
3. Check the webhook endpoint logs in Vercel → Functions