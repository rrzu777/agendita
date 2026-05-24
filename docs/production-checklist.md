# Production Readiness Checklist

## Estado: Beta Real en Producción

This checklist covers all infrastructure and configuration required to run Agendita in production.

---

## ✅ Listo (implementado en el codebase)

### Environment Validation
- [x] `DATABASE_URL` — siempre requerido
- [x] `DIRECT_URL` — siempre requerido
- [x] `NEXT_PUBLIC_SUPABASE_URL` — siempre requerido
- [x] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — siempre requerido
- [x] `APP_DOMAIN` — siempre requerido, sin path
- [x] `NEXT_PUBLIC_APP_DOMAIN` — siempre requerido, sin path
- [x] `PAYMENT_PROVIDER` — siempre requerido (`mock`, `manual`, `mercado_pago`, `webpay`)
- [x] `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION` — booleano estricto, requerido si provider es `mock` en production
- [x] `assertValidEnv()` — fail-fast al boot con mensajes claros

### Rate Limiting
- [x] Production usa Redis (Upstash REST) — fail-closed si no está configurado
- [x] Dev/test usa `MemoryRateLimiter` in-process
- [x] Keys incluyen acción + IP + opcional userId/businessId
- [x] `getClientIp()` con `x-forwarded-for` → `x-real-ip` → `unknown`
- [x] `checkRateLimit()` es async (necesario para `getClientIp()`)

### Logging
- [x] `src/lib/logger.ts` — JSON estructurado server-side
- [x] Campos: `level`, `event`, `message`, `businessId`, `userId`, `bookingId`, `paymentId`, `requestId`, `metadata`
- [x] Secrets redactados: tokens, secrets, authorization, rawPayload, rawResponse
- [x] Emails parcialmente redactados
- [x] Eventos: `booking.created`, `payment.initiated/approved/failed`, `webhook.received/rejected`, `auth.failure`, `tenant.resolve.failed`, `rate_limit.blocked`
- [x] Integrado en: `createBooking`, `initiatePayment`, `MP webhook route`, `proxy` middleware
- [x] Reemplaza `console.error` en webhook route

### Error Handling
- [x] `src/lib/errors.ts` — `ActionError` + `safeAction()` wrapper
- [x] Errores Prisma → mensaje genérico seguro
- [x] Errores inesperados → loggeados + mensaje genérico al cliente
- [x] `safePaymentError()` para mensajes de pago user-friendly

### Observabilidad UI
- [x] `src/app/error.tsx` — error boundary global
- [x] `src/app/not-found.tsx` — 404 page

### Cache Strategy
- [x] Static cache tags: `public-business-by-slug`, `public-business-by-subdomain`, `booking-business-by-slug`, `booking-business-by-subdomain`
- [x] `revalidateBusinessPublicPaths()` invalida los mismos 4 tags estáticos + paths por slug
- [x] Isolation por tenant garantizada por el cache key (slug/subdomain como argumento de función), no por tags dinámicos

### Webhook Security
- [x] Mercado Pago: validación de firma HMAC `x-signature`
- [x] Fetch directo a API de MP (no confiar en el payload)
- [x] Validación de `external_reference` contra DB
- [x] Validación de metadata fields para pagos `approved`
- [x] Idempotencia: pagos ya approved devuelven 200 sin side effects
- [x] `providerPaymentId` conflict detection
- [x] Logs estructurados para webhook received/rejected/approved

### Private Actions Authorization
- [x] `requireBusiness()` / `requireBusinessRole()` — businessId de sesión, no del cliente
- [x] Servicios, availability, time-blocks, bookings, payments, ledger, customers, reviews — ownership check con `businessId`
- [x] Reviews dashboard: `businessId` ownership en approve/hide/ensure-review-token
- [x] Settings: subdomain uniqueness verificado contra businessId propio

### External URL Validation
- [x] `profileImageUrl` y `logoUrl` validados como URL http/https en schema
- [x] `instagram` y `whatsapp` normalizados (no se guarda URL completa)

### Open Redirect Protection
- [x] Payment `returnUrl` usa `getBusinessPublicUrl()` que siempre apunta a dominio propio

### Input Sanitization
- [x] `customerName` / `customerPhone` / `customerEmail` — validados con Zod en booking
- [x] `comment` en reviews — nullable, no HTML
- [x] `notes` en customers — nullable, opcional

---

## 🔧 Requiere configuración externa

### 1. Variables de Entorno Obligatorias

```bash
# Base (siempre)
DATABASE_URL=postgresql://user:pass@host:5432/agendita
DIRECT_URL=postgresql://user:pass@host:5432/agendita   # para Prisma migrations directas
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
APP_DOMAIN=tu-dominio.com
NEXT_PUBLIC_APP_DOMAIN=tu-dominio.com
PAYMENT_PROVIDER=mercado_pago   # o manual/webpay/mock

# Production con Mercado Pago
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-...   # del dashboard de Mercado Pago
MERCADO_PAGO_WEBHOOK_SECRET=           # del dashboard de Mercado Pago (ver sección Webhook más abajo)

# Production con email (Resend)
RESEND_API_KEY=re_...
FROM_EMAIL=noreply@tu-dominio.com    # dominio verificado en Resend

# Production Rate Limiting (Upstash — único proveedor soportado)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=...
```

### 2. DNS — Dominio Wildcard

```
# Para subdominios de negocios
*.tu-dominio.com → CNAME → tu-proxy.vercel.app

# O si usas Vercel:
*.tu-dominio.com → A → 76.76.21.21
```

### 3. Supabase — Auth URLs

Verificar que en el dashboard de Supabase estén configuradas:
- **Site URL**: `https://tu-dominio.com`
- **Redirect URLs**: `https://tu-dominio.com/**`

### 4. Mercado Pago — Webhook

1. Ir a [Mercado Pago Developers](https://mercadopago.com.ar/developers)
2. Seleccionar tu aplicación
3. Ir a **Webhooks** → Notificaciones de pago:
   ```
   https://tu-dominio.com/api/webhooks/mercado-pago
   ```
4. En **Credenciales de producción**, copiar el `Secret` (clave de verificación de firma) — es diferente del Access Token
   - Se encuentra en: Tu aplicación → Gestión de credenciales → Producción → Secret
   - Asignar como `MERCADO_PAGO_WEBHOOK_SECRET`

**Importante**: El secret del webhook (`MERCADO_PAGO_WEBHOOK_SECRET`) es diferente del `ACCESS_TOKEN`. No son intercambiables.

### 5. Resend — Dominio verificado

1. Ir a [Resend](https://resend.com/emails/domains)
2. Agregar y verificar dominio para emails (`tu-dominio.com`)
3. Configurar DNS records (SPF, DKIM, MX)
4. El email `FROM_EMAIL` debe usar el dominio verificado

### 7. Redis / Upstash (Rate Limiting)

1. Crear cuenta en [Upstash](https://upstash.com)
2. Crear database Redis
3. Copiar `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`

**Importante**: En producción, si Upstash no está configurado, la app falla cerrada (bloquea todos los requests con rate limit). No hay fallback en memoria para production.

### 7. Prisma Migrate Deploy

```bash
# En producción (no usar prisma migrate dev)
DATABASE_URL=... npx prisma migrate deploy
```

### 8. Cron — Expirar holds de reservas

Agregar un cron job para expirar reservas con `holdExpiresAt` vencida:

```bash
# Cada 5 minutos — expirar holds vencidos
*/5 * * * * curl -X POST https://tu-dominio.com/api/cron/expire-holds
```

Verificar que el endpoint `/api/cron/expire-holds` esté implementado y protegido.

---

## 🧪 Smoke Commands

```bash
# Verificar que el build pasa
npm run build

# Verificar que los tests unitarios pasan
npm test

# Verificar que lint pasa
npm run lint

# Verificar E2E (requiere entorno corriendo)
npm run test:e2e
```

---

## 🔄 Rollback Básico

Si algo sale mal en producción:

1. **Revertir deploy**: Volver al commit anterior en Vercel / tu plataforma
2. **Desactivar business**: Si hay problema de negocio específico, marcar `isActive: false` en la DB
3. **Deshabilitar payments**: Cambiar `PAYMENT_PROVIDER=manual` temporalmente
4. **Deshabilitar rate limit**: Configurar `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` de backup (no hay fallback en memoria para production)

---

## 📋 Notas de Configuración

- `APP_DOMAIN` y `NEXT_PUBLIC_APP_DOMAIN` deben ser hostname **sin path y sin trailing slash**
- `NEXT_PUBLIC_` vars se inlined al build time — cambiar estas vars requiere rebuild
- Rate limiting en production falla **cerrado** (bloquea todo) si Redis no está disponible
- El webhook de Mercado Pago espera signatures con `x-signature` header en formato `ts={timestamp},v1={hmac}`
- `checkRateLimit()` es now async — todos los callers deben awaited