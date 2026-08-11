# Mercado Pago Recurring Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar mensualidades automáticas de Agendita con Mercado Pago y cerrar los gaps sandbox, OAuth y webhook del checkout multi-tenant.

**Architecture:** Mantener dos bounded contexts financieros: `subscriptions` usa únicamente la cuenta vendedora de Agendita; `payments` usa únicamente el token OAuth del negocio receptor. Ambos reciben eventos en rutas separadas, consultan Mercado Pago antes de aplicar efectos y delegan transiciones idempotentes a servicios de dominio transaccionales.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript, Prisma 5/PostgreSQL, Vitest, Mercado Pago Subscriptions/Checkout Pro APIs, Resend, GitHub Actions.

## Global Constraints

- Sólo mensual automático; no planes anuales, prorrateos ni cambio autónomo de plan.
- Trial configurable con 30 días por defecto y gracia configurable con 7 días por defecto.
- Exenciones `family & friends` son manuales, auditadas y no solicitan tarjeta hasta vencer.
- Cancelación efectiva al final del periodo; sin reembolso automático.
- Checkout alojado: Agendita nunca captura ni almacena tarjetas.
- `BusinessSubscription.status` es la fuente de verdad; `Business.subscriptionStatus` se sincroniza en la misma transacción.
- Sandbox y producción no comparten tokens ni IDs externos.
- Ningún redirect confirma dinero; sólo webhook o reconciliación verificada.
- `MP_SUBSCRIPTIONS_ENABLED` y `SUBSCRIPTION_ENFORCEMENT_ENABLED` son controles independientes y fail-closed.
- Toda migración es forward-only; no modificar migraciones ya aplicadas.
- No registrar tokens, secretos, passwords de prueba, URLs de checkout ni cuerpos crudos del proveedor.
- Antes de modificar código Next.js, leer `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `node_modules/next/dist/docs/01-app/02-guides/forms.md` y `node_modules/next/dist/docs/01-app/02-guides/redirecting.md`.

---

## File map

**Nuevos módulos de dominio**

- `src/lib/subscriptions/clock.ts`: reloj inyectable para reglas temporales.
- `src/lib/subscriptions/state-machine.ts`: transiciones puras de trial, exención, mora, cobro y cancelación.
- `src/lib/subscriptions/transition.ts`: aplica transiciones atómicas Prisma y auditoría.
- `src/lib/subscriptions/mercado-pago-client.ts`: transporte server-only para planes, suscripciones y facturas.
- `src/lib/subscriptions/mercado-pago-mappers.ts`: normaliza estados/payloads externos.
- `src/lib/subscriptions/webhook.ts`: verificación y procesamiento idempotente de eventos recurrentes.
- `src/lib/subscriptions/reconciliation.ts`: consulta y reparación de drift.
- `src/lib/cron/subscription-billing.ts`: avisos, cierres, gracia y reconciliación programada.

**Nuevas rutas/acciones**

- `src/server/actions/subscription-billing.ts`: iniciar checkout y solicitar cancelación.
- `src/app/api/mercado-pago/subscriptions/callback/route.ts`: retorno no autoritativo.
- `src/app/api/webhooks/mercado-pago/subscriptions/route.ts`: webhook recurrente dedicado.
- `src/app/api/cron/subscription-billing/route.ts`: cron autenticado.

**Persistencia/UI/configuración**

- `prisma/schema.prisma` y nueva migración `prisma/migrations/20260811030000_mp_recurring_billing/migration.sql`.
- `src/app/dashboard/billing/page.tsx` y componentes locales de facturación.
- `src/app/admin/businesses/[businessId]/page.tsx`, `admin-actions.tsx` y acciones admin.
- `src/lib/env.ts`, `src/lib/health/dependencies.ts`, `.github/workflows/cron.yml` y documentación QA.

---

### Task 1: Modelo persistente y migración forward-only

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260811030000_mp_recurring_billing/migration.sql`
- Modify: `prisma/seed.ts`
- Test: `src/lib/subscriptions/schema-contract.test.ts`

**Interfaces:**
- Produces: `MercadoPagoEnvironment`, `SubscriptionProvider`, `SubscriptionPlanMapping`, campos externos de `BusinessSubscription` y claves idempotentes de `SubscriptionPayment`.

- [ ] **Step 1: Escribir el test de contrato del schema**

Crear un test que lea `prisma/schema.prisma` y exija los enums/campos/índices acordados. Debe comprobar, como mínimo:

```ts
expect(schema).toContain('enum MercadoPagoEnvironment')
expect(schema).toContain('sandbox')
expect(schema).toContain('production')
expect(schema).toContain('model SubscriptionPlanMapping')
expect(schema).toContain('complimentaryUntil')
expect(schema).toContain('cancelAtPeriodEnd')
expect(schema).toContain('providerPaymentId')
expect(schema).toContain('@@unique([provider, environment, providerPaymentId])')
expect(schema).toContain('model SubscriptionNotificationDelivery')
expect(schema).toContain('providerPreferenceId')
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test -- src/lib/subscriptions/schema-contract.test.ts`

Expected: FAIL porque el contrato todavía no está en Prisma.

- [ ] **Step 3: Extender el schema sin reescribir historia**

Añadir enums de entorno/proveedor y un mapping de plan por entorno. Añadir a `BusinessSubscription` snapshots `amount`, `currency`, `provider`, `environment`, `providerPlanId`, `providerSubscriptionId`, `nextBillingAt`, `lastPaidAt`, `pastDueAt`, `graceEndsAt`, `graceDays`, `cancelAtPeriodEnd`, `cancellationRequestedAt`, `complimentaryUntil`, `complimentaryReason`, `billingEnabled`, `lastReconciledAt`. Añadir a `SubscriptionPayment` los IDs externos, timestamps y metadata sanitaria.

Usar índices únicos parciales en SQL cuando un campo nullable no deba admitir dos valores no nulos iguales. Agregar un índice parcial que impida más de una suscripción facturable no cancelada por negocio. Incluir `SubscriptionNotificationDelivery` con clave dedupe única y campos indexables `providerPreferenceId`/entorno en `Payment`, porque Tasks 7 y 11 los consumen. No eliminar campos existentes.

- [ ] **Step 4: Escribir migración con backfill seguro**

La migración debe:

1. crear tipos/tablas/campos nullable;
2. backfillear `amount` desde `Plan.priceMonthly`, `currency='CLP'`, `graceDays=7`;
3. preservar estados y periodos actuales;
4. crear índices sólo después del backfill;
5. no activar `billingEnabled` para negocios existentes.

- [ ] **Step 5: Actualizar seed y validar rutas realistas**

Mantener planes mensuales existentes, fijar trial predeterminado en 30 días y no crear IDs externos ficticios. Ejecutar:

```bash
npx prisma format
npx prisma validate
npx prisma generate
npm test -- src/lib/subscriptions/schema-contract.test.ts
```

Expected: todo PASS.

- [ ] **Step 6: Probar upgrade real en una base temporal**

Aplicar primero migraciones anteriores y luego la nueva, verificando que filas existentes conservan plan/estado. Seguir `docs/migrations.md`; no usar `prisma db push` como evidencia.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/seed.ts prisma/migrations/20260811030000_mp_recurring_billing src/lib/subscriptions/schema-contract.test.ts
git commit -m "feat: persist recurring subscription state"
```

### Task 2: Máquina de estados y transición atómica

**Files:**
- Create: `src/lib/subscriptions/clock.ts`
- Create: `src/lib/subscriptions/state-machine.ts`
- Create: `src/lib/subscriptions/state-machine.test.ts`
- Create: `src/lib/subscriptions/transition.ts`
- Create: `src/lib/subscriptions/transition.integration.test.ts`
- Modify: `src/server/actions/admin.ts`

**Interfaces:**
- Produces: `BillingClock`, `deriveSubscriptionTransition(input)`, `applySubscriptionTransition(prisma, command)`.
- Consumes: modelos de Task 1.

- [ ] **Step 1: Escribir tests fallidos de reglas temporales**

Cubrir tabla completa:

```ts
it.each([
  ['trial vigente', 'trialing'],
  ['exención vigente', 'trialing'],
  ['trial vencido sin autorización', 'past_due'],
  ['fallo dentro de gracia', 'past_due'],
  ['aprobado durante gracia', 'active'],
  ['gracia vencida con enforcement off', 'past_due'],
  ['gracia vencida con enforcement on', 'suspended'],
  ['cancelAtPeriodEnd antes del cierre', 'active'],
  ['cancelAtPeriodEnd al cierre', 'cancelled'],
])('%s -> %s', ...)
```

Añadir casos que prueben que una exención no consume trial, un duplicado no avanza periodo y un cobro fuera de orden no degrada un estado más nuevo.

- [ ] **Step 2: Ejecutar y comprobar FAIL**

Run: `npm test -- src/lib/subscriptions/state-machine.test.ts`

- [ ] **Step 3: Implementar reglas puras con reloj explícito**

Definir:

```ts
export type BillingClock = { now(): Date }
export type SubscriptionCommand =
  | { type: 'invoice_approved'; providerPaymentId: string; paidAt: Date; periodEnd: Date }
  | { type: 'invoice_failed'; occurredAt: Date }
  | { type: 'time_elapsed'; at: Date; enforcementEnabled: boolean }
  | { type: 'cancel_at_period_end'; requestedAt: Date }
  | { type: 'provider_cancelled'; occurredAt: Date }
```

La función pura devuelve `nextStatus`, cambios de fechas y `auditAction`; no toca Prisma ni `process.env`.

- [ ] **Step 4: Probar la máquina**

Run: `npm test -- src/lib/subscriptions/state-machine.test.ts`

Expected: PASS.

- [ ] **Step 5: Escribir test de atomicidad**

Probar con el arnés de integración Prisma que `BusinessSubscription.status`, `Business.subscriptionStatus`, pago y log se confirman juntos; una violación de unicidad debe hacer rollback total.

- [ ] **Step 6: Implementar servicio transaccional**

`applySubscriptionTransition` debe usar una única `prisma.$transaction`, realizar CAS sobre estado/versión o timestamps, crear pago con `upsert` por ID externo y sincronizar el campo compatible. Los métodos admin existentes deben delegar en este servicio en vez de duplicar transiciones.

- [ ] **Step 7: Ejecutar pruebas focalizadas e integración**

```bash
npm test -- src/lib/subscriptions/state-machine.test.ts
npm run test:integration -- src/lib/subscriptions/transition.integration.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/subscriptions src/server/actions/admin.ts
git commit -m "feat: add atomic subscription state machine"
```

### Task 3: Configuración y cliente de Mercado Pago Subscriptions

**Files:**
- Create: `src/lib/subscriptions/mercado-pago-client.ts`
- Create: `src/lib/subscriptions/mercado-pago-client.test.ts`
- Create: `src/lib/subscriptions/mercado-pago-mappers.ts`
- Create: `src/lib/subscriptions/mercado-pago-mappers.test.ts`
- Modify: `src/lib/env.ts`
- Modify: `scripts/validate-env.js`

**Interfaces:**
- Produces: `createMpSubscriptionClient(config)`, DTOs server-only y `normalizeMpSubscription`/`normalizeMpInvoice`.

- [ ] **Step 1: Escribir tests de configuración fail-closed**

Exigir que `MP_SUBSCRIPTIONS_ENABLED=true` requiera token, webhook secret, callback URL y `MERCADO_PAGO_ENVIRONMENT`. Rechazar valores distintos de `sandbox|production`. Exigir que sandbox y producción utilicen nombres de variables separados o un selector explícito, nunca fallback silencioso.

- [ ] **Step 2: Escribir tests HTTP fallidos**

Mockear `fetch` y comprobar Authorization, timeout, content type, endpoint y que los errores sanitizados nunca incluyan body/token. Cubrir crear/consultar plan, crear/consultar/cancelar suscripción y buscar facturas.

- [ ] **Step 3: Implementar transporte y DTOs mínimos**

La interfaz pública será:

```ts
type MpSubscriptionClient = {
  createPlan(input: CreatePlanInput): Promise<MpPlan>
  getPlan(id: string): Promise<MpPlan>
  createSubscription(input: CreateSubscriptionInput): Promise<MpSubscription>
  getSubscription(id: string): Promise<MpSubscription>
  cancelSubscription(id: string): Promise<MpSubscription>
  getInvoice(id: string): Promise<MpInvoice>
  searchInvoices(subscriptionId: string): Promise<MpInvoice[]>
}
```

Usar `AbortSignal.timeout(5000)` o helper equivalente, `external_reference` local opaca, `frequency=1`, `frequency_type='months'`, `currency_id='CLP'` y checkout alojado.

- [ ] **Step 4: Implementar mappers exhaustivos**

Estados desconocidos deben mapear a `ignored` y nunca a `approved`. Monto CLP debe ser entero positivo. Fechas inválidas producen error de contrato sin mutación local.

- [ ] **Step 5: Ejecutar tests**

```bash
npm test -- src/lib/subscriptions/mercado-pago-client.test.ts src/lib/subscriptions/mercado-pago-mappers.test.ts src/lib/env.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/subscriptions/mercado-pago-* src/lib/env.ts scripts/validate-env.js
git commit -m "feat: add Mercado Pago subscriptions client"
```

### Task 4: Creación de plan, checkout y callback no autoritativo

**Files:**
- Create: `src/server/actions/subscription-billing.ts`
- Create: `src/server/actions/subscription-billing.test.ts`
- Create: `src/app/api/mercado-pago/subscriptions/callback/route.ts`
- Create: `src/app/api/mercado-pago/subscriptions/callback/route.test.ts`
- Modify: `src/app/dashboard/billing/page.tsx`

**Interfaces:**
- Produces: `startSubscriptionCheckout()`, `requestSubscriptionCancellation()`.
- Consumes: cliente Task 3 y transición Task 2.

- [ ] **Step 1: Leer documentación local Next.js requerida**

```bash
sed -n '1,240p' node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/02-guides/forms.md
sed -n '1,180p' node_modules/next/dist/docs/01-app/02-guides/redirecting.md
```

- [ ] **Step 2: Escribir tests de elegibilidad**

Rechazar flag apagado, negocio fuera del rollout, exención vigente, plan sin mapping, suscripción externa ya activa y usuario no owner/admin. Aceptar trial próximo a vencer o mora sin autorización. El monto debe venir de snapshot/plan DB, nunca del formulario.

- [ ] **Step 3: Implementar sincronización de plan externa**

Crear plan externo una vez por plan/entorno con `upsert` y recuperación ante carrera de unicidad. No modificar automáticamente planes externos ya usados si cambia el precio; crear una nueva versión de mapping para nuevas altas.

- [ ] **Step 4: Implementar inicio de checkout**

Crear una referencia opaca de un solo uso ligada a business/subscription/entorno, persistirla antes del request y devolver/redirect al `init_point` alojado. El trial externo debe terminar en la fecha local acordada. No devolver token ni payload externo al cliente.

- [ ] **Step 5: Probar callback como señal provisional**

El callback valida referencia/state, consulta al proveedor y redirige a `/dashboard/billing?subscription=processing|active|failed`. Nunca escribe `active` basado sólo en query params.

- [ ] **Step 6: Ejecutar tests y commit**

```bash
npm test -- src/server/actions/subscription-billing.test.ts src/app/api/mercado-pago/subscriptions/callback/route.test.ts
git add src/server/actions/subscription-billing* src/app/api/mercado-pago/subscriptions/callback src/app/dashboard/billing/page.tsx
git commit -m "feat: start hosted subscription checkout"
```

### Task 5: Webhook recurrente firmado e idempotente

**Files:**
- Create: `src/lib/payments/mercado-pago-signature.ts`
- Create: `src/lib/payments/mercado-pago-signature.test.ts`
- Modify: `src/app/api/webhooks/mercado-pago/route.ts`
- Create: `src/lib/subscriptions/webhook.ts`
- Create: `src/lib/subscriptions/webhook.test.ts`
- Create: `src/app/api/webhooks/mercado-pago/subscriptions/route.ts`
- Create: `src/app/api/webhooks/mercado-pago/subscriptions/route.test.ts`

**Interfaces:**
- Produces: `verifyMercadoPagoSignature(input)`, `processSubscriptionWebhook(event)`.

- [ ] **Step 1: Extraer firma bajo tests de regresión**

Mover HMAC/replay del webhook actual a helper compartido sin cambiar el manifiesto. Cubrir firma válida, inválida, request ID ausente, timestamp viejo y buffers de longitudes distintas.

- [ ] **Step 2: Escribir matriz de eventos recurrentes**

Cubrir evento aprobado, rechazado, pendiente, cancelado, duplicado, fuera de orden, ID desconocido, monto/moneda/vendedor incorrectos y timeout al consultar proveedor.

- [ ] **Step 3: Implementar ruta fina y procesador**

La ruta sólo parsea, autentica y delega. El procesador consulta el objeto externo, valida invariantes y llama `applySubscriptionTransition`. Duplicados responden 200; errores transitorios 502; firma/inconsistencia 401/400 sin mutación.

- [ ] **Step 4: Añadir prueba concurrente**

Ejecutar dos procesamientos del mismo invoice simultáneamente y demostrar un solo `SubscriptionPayment`, un solo avance de periodo y un solo log financiero.

- [ ] **Step 5: Ejecutar tests y commit**

```bash
npm test -- src/lib/payments/mercado-pago-signature.test.ts src/lib/subscriptions/webhook.test.ts src/app/api/webhooks/mercado-pago/subscriptions/route.test.ts
git add src/lib/payments/mercado-pago-signature* src/lib/subscriptions/webhook* src/app/api/webhooks/mercado-pago
git commit -m "feat: process recurring billing webhooks"
```

### Task 6: Reconciliación, grace period y cron

**Files:**
- Create: `src/lib/subscriptions/reconciliation.ts`
- Create: `src/lib/subscriptions/reconciliation.test.ts`
- Create: `src/lib/cron/subscription-billing.ts`
- Create: `src/lib/cron/subscription-billing.test.ts`
- Create: `src/app/api/cron/subscription-billing/route.ts`
- Create: `src/app/api/cron/subscription-billing/route.test.ts`
- Modify: `.github/workflows/cron.yml`

**Interfaces:**
- Produces: `reconcileSubscription(id)`, `runSubscriptionBillingCron({ now })`.

- [ ] **Step 1: Escribir tests de reconciliación**

Un webhook perdido debe repararse consultando suscripción y facturas. Timeout o payload incompleto no degrada estado. Un estado externo más antiguo no revierte un pago local aprobado.

- [ ] **Step 2: Escribir tests temporales del cron**

Usar reloj fijo para 7/3/1 días, trial vencido, exención vencida, grace vigente/vencida, cancelación al cierre y enforcement on/off. Dos corridas simultáneas no duplican efectos.

- [ ] **Step 3: Implementar reconciliación y cron por lotes**

Procesar páginas acotadas, registrar cursor/resultado sanitario y aislar errores por negocio. Seleccionar filas candidatas dentro de DB y reclamar trabajo con CAS; no mantener transacción abierta durante requests HTTP.

- [ ] **Step 4: Implementar ruta autenticada y workflow**

Usar `hasValidBearerSecret`. La ruta devuelve conteos `{processed,reconciled,notified,suspended,errors}` sin IDs. Agregar step independiente a `cron.yml` que se ejecute aunque otra familia de cron falle; al final el job debe quedar rojo si hubo un error interno.

- [ ] **Step 5: Ejecutar tests y commit**

```bash
npm test -- src/lib/subscriptions/reconciliation.test.ts src/lib/cron/subscription-billing.test.ts src/app/api/cron/subscription-billing/route.test.ts
git add src/lib/subscriptions/reconciliation* src/lib/cron/subscription-billing* src/app/api/cron/subscription-billing .github/workflows/cron.yml
git commit -m "feat: reconcile recurring subscriptions"
```

### Task 7: Notificaciones idempotentes

**Files:**
- Modify: `src/lib/notifications/types.ts`
- Modify: `src/lib/notifications/templates.ts`
- Modify: `src/lib/notifications/index.ts`
- Create: `src/lib/notifications/subscriptions.ts`
- Create: `src/lib/notifications/subscriptions.test.ts`
- Modify: `src/lib/cron/subscription-billing.ts`

**Interfaces:**
- Produces: `sendSubscriptionNotification(kind, data)` y claves dedupe por `subscriptionId:kind:effectiveDate`.

- [ ] **Step 1: Escribir tests de contenido y dedupe**

Cubrir avisos 7/3/1, activación, aprobado, fallido, recuperación, suspensión, cancelación solicitada/efectiva y OAuth expirado. Verificar que no se incluyen IDs externos, secretos ni datos de tarjeta.

- [ ] **Step 2: Implementar plantillas y persistencia de entrega**

Reutilizar el proveedor de email existente. Persistir o registrar una clave única antes de enviar con estado `pending/sent/failed`; permitir reintento de `failed`, no de `sent`.

- [ ] **Step 3: Aislar efectos**

La transición financiera se confirma aunque falle Resend. El cron recoge notificaciones fallidas sin repetir las enviadas.

- [ ] **Step 4: Ejecutar tests y commit**

```bash
npm test -- src/lib/notifications/subscriptions.test.ts src/lib/cron/subscription-billing.test.ts
git add src/lib/notifications src/lib/cron/subscription-billing.ts
git commit -m "feat: notify subscription lifecycle events"
```

### Task 8: Administración de plan, trial, exención y rollout

**Files:**
- Modify: `src/server/actions/admin.ts`
- Create: `src/server/actions/admin-subscriptions.test.ts`
- Modify: `src/app/admin/businesses/[businessId]/page.tsx`
- Modify: `src/app/admin/businesses/[businessId]/admin-actions.tsx`
- Create: `src/app/admin/businesses/[businessId]/admin-subscription-controls.tsx`

**Interfaces:**
- Produces: acciones `adminSetComplimentaryPeriod`, `adminClearComplimentaryPeriod`, `adminConfigureBilling`, `adminReconcileSubscription`.

- [ ] **Step 1: Escribir tests de autorización y validación**

Sólo platform admin. Fecha debe ser futura, motivo obligatorio y límites `trialDays 0..365`, `graceDays 0..30`. Quitar exención no cobra ni crea checkout automáticamente. Habilitar rollout tampoco cobra.

- [ ] **Step 2: Implementar acciones auditadas**

Todas usan servicio transaccional y guardan actor/email/motivo. `adminReconcileSubscription` sólo consulta proveedor y aplica máquina de estados; no acepta un estado arbitrario desde formulario.

- [ ] **Step 3: Implementar controles UI**

Mostrar estado local, entorno, trial, exención, mora, próxima fecha, cancelación y última reconciliación. Confirmar acciones sensibles. No renderizar IDs externos completos.

- [ ] **Step 4: Ejecutar tests, lint y commit**

```bash
npm test -- src/server/actions/admin-subscriptions.test.ts
npm run lint -- --quiet
git add src/server/actions/admin.ts src/server/actions/admin-subscriptions.test.ts src/app/admin/businesses
git commit -m "feat: administer recurring billing rollout"
```

### Task 9: Experiencia de facturación de la dueña

**Files:**
- Modify: `src/server/actions/subscriptions.ts`
- Modify: `src/app/dashboard/billing/page.tsx`
- Create: `src/app/dashboard/billing/subscription-actions.tsx`
- Create: `src/app/dashboard/billing/page.test.tsx`
- Modify: `src/app/refund-policy/page.tsx`
- Modify: `src/app/terms/page.tsx`

**Interfaces:**
- Consumes: acciones Task 4 y modelo Task 1.

- [ ] **Step 1: Escribir tests por estado**

Renderizar trial, exención, activación requerida, processing, active, past_due con fecha de gracia, suspended, cancelAtPeriodEnd y cancelled. Verificar que una exenta no ve CTA que implique cargo inmediato.

- [ ] **Step 2: Reemplazar instrucciones manuales**

Mostrar CTA “Activar mensualidad automática”, retorno provisional y cancelación al cierre. Deshabilitar doble submit. Explicar que el cobro ocurre al terminar trial/exención según corresponda.

- [ ] **Step 3: Actualizar términos y reembolsos**

Eliminar la afirmación de que toda suscripción beta se gestiona manualmente. Documentar recurrencia mensual, cancelación al cierre, gracia y ausencia de reembolso automático sin prometer comportamiento no implementado.

- [ ] **Step 4: Ejecutar tests y commit**

```bash
npm test -- src/app/dashboard/billing/page.test.tsx
npm run typecheck
git add src/server/actions/subscriptions.ts src/app/dashboard/billing src/app/refund-policy/page.tsx src/app/terms/page.tsx
git commit -m "feat: expose automatic subscription billing"
```

### Task 10: OAuth sandbox y refresh seguro del negocio

**Files:**
- Modify: `src/server/actions/mercado-pago-connect.ts`
- Modify: `src/app/api/mercado-pago/callback/route.ts`
- Create: `src/lib/payments/mercado-pago-oauth.ts`
- Create: `src/lib/payments/mercado-pago-oauth.test.ts`
- Modify: `src/lib/payments/factory.ts`
- Create: `src/lib/payments/factory.oauth-refresh.test.ts`

**Interfaces:**
- Produces: `exchangeAuthorizationCode`, `refreshBusinessAccessToken`, `getValidBusinessAccessToken`.

- [ ] **Step 1: Escribir tests de separación de ambiente**

Sandbox agrega exactamente `test_token: true`; producción no lo agrega. State incluye entorno firmado y callback rechaza mismatch. Una fila sandbox nunca se selecciona en producción.

- [ ] **Step 2: Escribir tests de refresh concurrente**

Token vigente no refresca. Token próximo a vencer refresca una vez bajo concurrencia. Respuesta inválida conserva token anterior; `invalid_grant` definitivo marca `expired`. Ningún error imprime body.

- [ ] **Step 3: Implementar cliente OAuth server-only**

Extraer intercambio del route handler. Persistir nuevo access/refresh token cifrado y expiración en transacción CAS. El factory obtiene siempre token válido y nunca cae al token global.

- [ ] **Step 4: Ejecutar tests y commit**

```bash
npm test -- src/lib/payments/mercado-pago-oauth.test.ts src/lib/payments/factory.oauth-refresh.test.ts
git add src/server/actions/mercado-pago-connect.ts src/app/api/mercado-pago/callback/route.ts src/lib/payments
git commit -m "fix: isolate sandbox OAuth and refresh tokens"
```

### Task 11: Resolver el tenant antes de consultar pagos de servicios

**Files:**
- Modify: `src/lib/payments/mercado-pago-provider.ts`
- Modify: `src/server/actions/payments.ts`
- Modify: `src/server/actions/packages-checkout.ts`
- Modify: `src/app/api/webhooks/mercado-pago/route.ts`
- Create: `src/app/api/webhooks/mercado-pago/route.test.ts`
- Modify: `docs/payments/mercado-pago-multitenant.md`

**Interfaces:**
- Produces: localización segura `providerPreferenceId -> Payment -> businessId` antes del fetch externo.

- [ ] **Step 1: Escribir test que reproduzca el gap**

Crear un pago con token del negocio y simular que el token global no puede hacer `GET /v1/payments/{id}`. El webhook debe poder resolver el negocio sin esa llamada y verificar luego con su token.

- [ ] **Step 2: Persistir índice de preferencia local**

Al crear la preferencia, guardar su ID y entorno en `Payment.rawPayload` tipado o campos dedicados indexables. Si Mercado Pago permite incluir una referencia estable en la notificación firmada, validarla además, pero no confiar en metadata/query sin consulta posterior.

- [ ] **Step 3: Reordenar webhook**

Resolver el `Payment` local por referencia/preference indexada; cargar `PaymentAccount` del mismo business; consultar `/v1/payments/{id}` con ese token; exigir coincidencia de `external_reference`, metadata, vendedor, monto y moneda. Eliminar el fetch inicial con `MERCADO_PAGO_ACCESS_TOKEN`.

- [ ] **Step 4: Cubrir aislamiento adversarial**

Tests deben rechazar token del negocio A para pago B, referencia inexistente, preference duplicada, metadata cruzada, pago aprobado con monto distinto y webhook duplicado.

- [ ] **Step 5: Actualizar arquitectura y ejecutar tests**

```bash
npm test -- src/app/api/webhooks/mercado-pago/route.test.ts src/lib/payments/create-preference.test.ts
npm run test:integration -- src/server/actions/packages-checkout.initiate.test.ts
git add prisma src/lib/payments/mercado-pago-provider.ts src/server/actions/payments.ts src/server/actions/packages-checkout.ts src/app/api/webhooks/mercado-pago/route.ts src/app/api/webhooks/mercado-pago/route.test.ts docs/payments/mercado-pago-multitenant.md
git commit -m "fix: verify tenant payments with seller credentials"
```

### Task 12: Health, observabilidad y documentación operativa

**Files:**
- Modify: `src/lib/health/dependencies.ts`
- Modify: `src/app/api/health/dependencies/route.ts`
- Modify: `src/lib/env.ts`
- Modify: `docs/payments/mercado-pago-qa.md`
- Modify: `docs/payments/mercado-pago-multitenant-qa.md`
- Create: `docs/payments/mercado-pago-subscriptions-qa.md`
- Modify: `docs/production-checklist.md`

**Interfaces:**
- Produces: probes read-only separados y runbooks sin secretos.

- [ ] **Step 1: Escribir tests de health**

Cobros deshabilitados => `not_required`; habilitados con credencial inválida => `down`; OAuth multi-tenant verifica configuración pero no tokens de negocios arbitrarios. Respuestas públicas nunca incluyen mensajes crudos.

- [ ] **Step 2: Implementar señales separadas**

Reportar `mercadoPagoSubscriptions` y `mercadoPagoOAuth` por separado. El probe recurrente usa una consulta read-only de cuenta/plan conocida; no crea plan, autorización ni pago.

- [ ] **Step 3: Escribir runbooks paso a paso**

Documentar variables por nombre, creación de webhook por ruta, rotación, rollback con flags, sandbox mensualidad, sandbox cliente→dueña, evidencia esperada y limpieza de cuentas de prueba. Marcar explícitamente que configuración verde no prueba un cobro E2E.

- [ ] **Step 4: Ejecutar tests y commit**

```bash
npm test -- src/lib/health/dependencies.test.ts src/app/api/health/dependencies/route.test.ts
git add src/lib/health src/app/api/health/dependencies src/lib/env.ts docs/payments docs/production-checklist.md
git commit -m "docs: operate Mercado Pago billing safely"
```

### Task 13: Gate de verificación local y revisión adversarial

**Files:**
- Review: todos los archivos modificados en Tasks 1-12

- [ ] **Step 1: Ejecutar suite focalizada completa**

```bash
npm test -- src/lib/subscriptions src/lib/payments src/lib/cron/subscription-billing.test.ts src/lib/notifications/subscriptions.test.ts src/server/actions/subscription-billing.test.ts src/server/actions/admin-subscriptions.test.ts src/app/api/webhooks/mercado-pago src/app/api/mercado-pago
```

Expected: PASS sin tests omitidos relevantes.

- [ ] **Step 2: Ejecutar gates globales**

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
git diff --check
```

Expected: todos exit 0.

- [ ] **Step 3: Revisar invariantes financieras manualmente**

Trazar estas intercalaciones:

- webhook aprobado vs cron de suspensión;
- webhook duplicado vs reconciliación;
- cancelación vs cobro aprobado;
- refresh token concurrente;
- cambio de precio vs checkout ya iniciado;
- entorno sandbox vs producción;
- negocio A vs negocio B.

No avanzar si alguna ruta puede duplicar periodo/pago, degradar un aprobado, cruzar tenant o confirmar por redirect.

- [ ] **Step 4: Revisar migración real**

Comparar schema previo, SQL, backfill e índices. Ejecutar upgrade desde snapshot compatible con producción y consultas de invariantes, no sólo base limpia.

- [ ] **Step 5: Commit de correcciones encontradas por el gate**

Si el gate encuentra defectos, crear commits focalizados y repetir el gate completo. Si no encuentra defectos, registrar explícitamente que este paso no produjo commit. No mezclar cambios no relacionados.

### Task 14: QA sandbox guiado y rollout productivo

**Files:**
- Follow: `docs/payments/mercado-pago-subscriptions-qa.md`
- Follow: `docs/payments/mercado-pago-multitenant-qa.md`
- Follow: `docs/production-checklist.md`

- [ ] **Step 1: Configurar sandbox sin compartir secretos**

El usuario configura variables en Vercel y webhooks en Mercado Pago. Sólo se confirman nombres, estados y últimos cuatro caracteres si fuese imprescindible; nunca pegar valores en chat, Git o logs.

- [ ] **Step 2: Probar mensualidad sandbox**

Usar Agendita como vendedor y una dueña test como pagadora. Evidencia: checkout autorizado, webhook firmado, `SubscriptionPayment` único, estado/periodo correctos y correo. Probar duplicado y retorno sin webhook.

- [ ] **Step 3: Probar reglas locales temporales**

Con reloj/test fixtures: trial 30 días, avisos 7/3/1, exención, gracia 7 días, enforcement off/on y cancelación al cierre.

- [ ] **Step 4: Probar cliente a dueña sandbox**

Conectar Seller Test User por OAuth sandbox y pagar como Buyer Test User en incógnito. Evidencia: el seller correcto recibe el pago de prueba, el webhook usa su token y la reserva/paquete cambia una sola vez.

- [ ] **Step 5: Activar producción gradualmente**

1. Deploy con ambos flags apagados.
2. Confirmar health y crons.
3. Activar `MP_SUBSCRIPTIONS_ENABLED` sólo para un negocio autorizado.
4. Completar cobro productivo controlado con monto real explícitamente aprobado por el usuario.
5. Observar webhook, conciliación, correo y cancelación.
6. Ampliar allowlist.
7. Activar `SUBSCRIPTION_ENFORCEMENT_ENABLED` sólo después de evidencia estable.

- [ ] **Step 6: Cerrar con evidencia**

Registrar únicamente estados, timestamps, conteos y checks seguros. Mantener como pendiente cualquier ciclo real no ejecutado; no confundir configuración con validación E2E.
