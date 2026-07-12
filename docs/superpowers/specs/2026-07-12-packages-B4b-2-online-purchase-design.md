# B4b-2 — Compra online pública de paquetes prepagos (diseño)

**Fecha:** 2026-07-12
**Iniciativa:** promociones/lealtad → B4b (compra online de paquetes). Segunda de 3 rebanadas.
**Predecesora:** B4b-1 (#72, mergeada) — core financiero: `Payment` polimórfico, ledger unificado, `activatePackagePurchaseInTx`, `applyApprovedPackagePayment` (sin caller público todavía), `holdExpiresAt`.
**Sucesora:** B4b-3 — transferencia bancaria + cron sweep de holds + confirmación de la dueña + refund real por MP.

---

## Goal

Permitir que una clienta **logueada** compre un paquete prepago (`PackageProduct`) online con Mercado Pago desde una página pública, y que al aprobarse el pago el paquete se active automáticamente (grants + ledger) y quede visible en su cuenta `/mi`.

## Arquitectura (enfoque C — híbrido)

Reusar el tronco de pago ya existente. Extraer un helper privado compartido para la creación de preferencia MP; agregar acciones públicas de checkout de paquete que arman su propio `Payment(pending)`; agregar un branch de dispatch en el webhook. El camino de reservas casi no se toca.

**Stack:** Next.js 16 App Router, Prisma + PostgreSQL (Supabase), Mercado Pago (per-business OAuth, cliente `fetch` hand-rolled), Resend (email), Vitest 4, TypeScript strict.

## Alcance

**Dentro:**
- Rutas públicas `/paquetes/[slug]` (path) + `/paquetes` (subdominio) + `/paquetes/confirmation`.
- Catálogo público de `PackageProduct` activos, con gating por disponibilidad de pago online.
- Mini-wizard de checkout (login requerido) → Mercado Pago → activación por webhook.
- Notificaciones: email a la clienta + email a los owners/admins.
- Línea de ingresos por paquete en el dashboard principal (decisión 3).
- Aviso source-aware en el refund de paquetes online (decisión 2).

**Fuera (B4b-3):** transferencia bancaria para paquetes, cron sweep de `holdExpiresAt`, API real de refund por MP (`refundPayment`).

**Fuera (decisión explícita):** puntos de lealtad por comprar paquete (decisión 1 — no se acreditan).

---

## Decisiones cerradas

1. **Sin puntos de lealtad por comprar paquete.** Los puntos siguen atados a visitas completadas. Se documenta que una visita cubierta por paquete tiene `finalAmount = 0`, por lo que con `minSpendToEarn` configurado no acredita puntos por visita (comportamiento actual, intencional).
2. **Refund online = aviso source-aware ahora; API real en B4b-3.** Cuando `source === 'online'`, el flujo de reembolso advierte a la dueña que debe devolver el cargo manualmente en Mercado Pago. El ledger/grants se revierten como hoy. `refundPayment` en `PaymentProvider` + `/v1/payments/{id}/refunds` queda para B4b-3.
3. **Agregar ingresos por paquete al dashboard.** `getFinancialSummary` suma una línea de ingresos por paquete (derivada del ledger `package_sale` neto de `refund_issued` con `packagePurchaseId`), y el dashboard principal la muestra. `getLedgerEntries` incluye `packagePurchase` para que las filas `package_sale` no queden huérfanas.
4. **Login requerido** antes de comprar; el paquete queda atado a la cuenta `/mi` vía el email verificado de sesión.
5. **Catálogo `/paquetes/[slug]` + mini-wizard** (sin pasos de fecha/hora).
6. **Ventana `pending` UX:** la página `/paquetes/confirmation` muestra estado "procesando tu pago" (mirror del `verifying` de reservas) mientras el webhook tarda; `/mi/[slug]` sigue mostrando solo paquetes `active`.

---

## Modelo de datos

Sin migración nueva. Se usan campos ya existentes de B4b-1:
- `PackagePurchase.status`: `'pending'` (pre-creada) → `'active'` (activada por webhook) → `'refunded'`.
- `PackagePurchase.source`: `'online'` (nuevo valor de string; hoy solo existe `'manual'`).
- `PackagePurchase.holdExpiresAt`: se setea a `now + 30min` en la pre-creación (para el sweep de B4b-3; en B4b-2 solo se usa para rechazar reuse de pendings vencidas).
- `Payment.packagePurchaseId` + `paymentType: 'package_purchase'` + `@@unique([packagePurchaseId, provider, providerPaymentId])`.

---

## Flujo de datos

1. Clienta abre `/paquetes/[slug]` (catálogo). Si el negocio no tiene MP conectado, no se renderiza botón "Comprar" funcional (estado explicativo).
2. Click en "Comprar" en un paquete:
   - Si **no logueada** → link a `/ingresar?next=/paquetes/[slug]?comprar=<productId>`.
   - Si **logueada** → abre el `PackageCheckout` (cliente) para ese producto.
3. **Paso 1 (datos):** nombre (prefill del `Customer` del negocio si existe por `userId`; si no, del account), teléfono (requerido solo si el account no tiene `Customer` en este negocio), email (del account, read-only), términos.
4. **Paso 2 (pago):** `createPackagePurchase` → `initiatePackagePayment` → redirect a MP (o confirmación sync si mock).
5. MP redirige de vuelta a `/paquetes/confirmation?purchaseId=…`. Estado inicial: "procesando".
6. **Webhook** (async): valida firma + metadata, dispatch a `applyApprovedPackagePayment` → `activatePackagePurchaseInTx` (grants + ledger + status `active`) → notificaciones → revalidación dashboard.
7. La clienta refresca la confirmación (o vuelve a `/mi/[slug]`) y ve las sesiones disponibles.

---

## Componentes por archivo

### Datos públicos cacheados
**Modificar `src/lib/business/public.ts`:**
- Agregar `getPackagesBusinessBySlug(slug)` y `getPackagesBusinessBySubdomain(subdomain)` con `unstable_cache` (revalidate 60, tags `packages-business-by-slug` / `-subdomain`). Include: business + `packageProducts` activos con sus `services` (para mostrar cobertura). **NO usar `relationLoadStrategy:'join'`** (landmine documentado en el archivo).
- Exportar tipo `PackagesBusiness`.

**Modificar `src/server/actions/revalidate-business.ts`:**
- Agregar a `CACHE_TAGS`: `packagesBySlug`, `packagesBySubdomain`.
- `revalidateTag(...)` de ambos + `revalidatePath('/paquetes')` + `revalidatePath('/paquetes/${business.slug}')`.

**Modificar `src/server/actions/packages.ts`:**
- `upsertPackageProduct` y `archivePackageProduct` → `await revalidateBusinessPublicPaths(businessId)` (hoy no lo llaman; sin esto el catálogo público queda stale). **Await obligatorio** (landmine: sin await el proceso sale 128).

### Rutas públicas
**Crear:**
- `src/app/paquetes/[slug]/page.tsx` — server, `dynamic='force-dynamic'`. Guard de tenancy (mirror `book/[slug]/page.tsx`): si hay tenant y `tenant.slug !== slug` → `notFound()`; si hay tenant → `redirect('/paquetes')`. Carga vía `getPackagesBusinessBySlug`. Resuelve disponibilidad online con `resolveOnlinePaymentAvailabilityForBusiness(business.id)`. Renderiza shell.
- `src/app/paquetes/page.tsx` — server, variante subdominio (mirror `book/page.tsx`): tenant → carga por subdominio; sin tenant → selector/`notFound()`.
- `src/app/paquetes/confirmation/page.tsx` — server. Lee `?purchaseId=`. `getCurrentUser()`; carga `PackagePurchase` + product + payments + business. **Guard de ownership**: si hay tenant y `tenant.businessId !== purchase.businessId` → `notFound()`; y valida que `purchase.customer.userId === user.id`. Deriva estado con helper (ver abajo). Muestra sesiones disponibles + link a `/mi/[slug]`.
- **No** crear `src/app/paquetes/layout.tsx` (el catálogo/confirmación son públicos; el gate de login va en el checkout).

### Shell + wizard (cliente)
**Crear:**
- `src/components/packages/packages-business-page.tsx` — server shell (mirror `booking-business-page.tsx`): header + monta el catálogo/checkout cliente pasando `products`, `businessId`, `slug`, `onlineAvailable`, `sessionCustomer` (prefill).
- `src/components/packages/package-catalog.tsx` — cliente. Grilla de cards (reusa estilos `studio-*` / `src/components/ui/*`). Por card: nombre, `quantity (+bonus)` sesiones, precio (`formatMoney`), vencimiento, cobertura. Botón "Comprar": si `!onlineAvailable` → deshabilitado + nota; si no logueada → `Link` a `/ingresar?next=…`; si logueada → abre `PackageCheckout` con `selectedProductId`.
- `src/components/packages/package-checkout.tsx` — cliente. Wizard numérico + bag único (mirror `wizard.tsx`): Paso 1 datos, Paso 2 pago. Idempotency key por mount (`useMemo`). Redirect-vs-mock branching (mirror `step-payment.tsx`).
- `src/lib/payments/package-confirmation-state.ts` — `derivePackageConfirmationState(purchase)` → `'active' | 'pending' | 'rejected'` (mirror `deriveConfirmationState`).

### Acciones de servidor
**Crear `src/server/actions/packages-checkout.ts`** (público, `getCurrentUser()` — NO `requireBusinessRole`):
- **`createPackagePurchase(input)`**:
  - `getCurrentUser()`; rechaza si no autenticada.
  - Valida (Zod): `packageProductId`, `name`, `phone`, `acceptedTerms`.
  - Carga `PackageProduct` activo (scoped por businessId del producto).
  - **Re-gate online**: `getOnlinePaymentProviderForBusiness(businessId)` (throw con `reason` si no disponible).
  - `findOrCreateCustomerInTx(tx, { businessId, phone, name, email: user.email (verificado de sesión), sessionUser: user })` — **pasar el email verificado es load-bearing** para que `/mi/[slug]` muestre la compra; linkea `userId` (Vía 3).
  - **Reuse**: si existe `PackagePurchase{status:'pending'}` para (customerId, productId) con `holdExpiresAt >= now` → reusar; si `holdExpiresAt < now` → NO reusar, crear fresca.
  - Crear `PackagePurchase{ status:'pending', source:'online', holdExpiresAt: now+30min, expiresAt: from product.expiryDays, snapshots coversAll/coveredServiceIds/quantity/bonusQuantity/pricePaid }`.
  - Devuelve `{ purchaseId }`.
- **`initiatePackagePayment({ purchaseId })`**:
  - `getCurrentUser()`; carga purchase; valida ownership (`customer.userId === user.id`).
  - `getOnlinePaymentProviderForBusiness(businessId)`.
  - **Pre-crea** `Payment{ status:'pending', paymentType:'package_purchase', packagePurchaseId, providerPaymentId:null, businessId, customerId, amount:pricePaid, currency }` (reusa pending existente para el purchase → anti doble-click).
  - Llama al helper compartido `createMpPreferenceForPayment(...)` con `returnUrl: getPackageConfirmationUrl(business, purchaseId)`, `webhookUrl`, `customerEmail`, `metadata: { packagePurchaseId, businessId, paymentType:'package_purchase', localPaymentId }`.
  - Provider mock (sin redirect) → `verifyAndConfirmPackagePayment`.
  - Devuelve `{ redirectUrl }` o `{ confirmed:true }`.
- **`verifyAndConfirmPackagePayment({ purchaseId })`**: camino no-redirect (mock/tests) → `applyApprovedPackagePayment` directo.

### Helper compartido (corazón del enfoque C)
**Modificar `src/server/actions/payments.ts`:**
- Extraer privado **`createMpPreferenceForPayment(provider, { payment, description, returnUrl, webhookUrl, customerEmail, metadata })`**: hace `provider.createPayment(...)` + persiste `rawPayload` (preferenceId, init_point). `initiatePayment` (reserva) delega este bloque; contrato de reserva idéntico. `getAppUrl()` (variante local de `payments.ts`) para el webhookUrl compartido.

**Modificar `src/lib/business/urls.ts`:**
- Agregar `getPackageConfirmationUrl(business, purchaseId)` = `getBusinessPublicUrl(business)` + `/paquetes/confirmation?purchaseId=…` (maneja subdominio vs path).

### Webhook
**Modificar `src/app/api/webhooks/mercado-pago/route.ts`:**
- Importar `applyApprovedPackagePayment`.
- **Validación de metadata** (hoy hardcodea `bookingId`): branch por tipo — para pago de paquete validar `packagePurchaseId` (required-fields = `['localPaymentId','packagePurchaseId','businessId','paymentType']`, `metadata.packagePurchaseId === payment.packagePurchaseId`, `paymentType === 'package_purchase'`).
- **Reemplazar guard `!bookingId → 400`** por dispatch: `payment.bookingId ? applyApprovedPayment(...) + notif reserva : applyApprovedPackagePayment({ tx, packagePurchaseId, businessId, amount, currency, provider:'mercado_pago', providerPaymentId, paymentType:'package_purchase', paymentMethod, rawPayload, paymentId }) + notifs paquete + revalidación dashboard`.
- **`refunded/charged_back`**: hoy solo hace reversals de reserva guardados por `bookingId`. Para paquete: branch explícito — bajar el `Payment` (sin reversal de grants; los grants solo existen post-activación). Si la compra ya estaba `active` y llega chargeback, dejar registrado el `Payment` degradado (no auto-revertir grants en B4b-2; documentar).
- Tras el commit de activación: `revalidatePath('/dashboard/customers/${purchase.customerId}')`, `revalidatePath('/dashboard/paquetes')`, `revalidatePath('/dashboard/payments')` (mirror del `sellPackage` manual). En la capa de ruta, no dentro del tx helper.

### Notificaciones
**Modificar `src/lib/notifications/{templates,email-provider,index}.ts`:**
- Templates `packagePurchasedCustomerHtml/Text` (a la clienta: "Compraste el paquete X — N sesiones disponibles" + link `/mi/[slug]`) y `packageSoldBusinessHtml/Text` (a la dueña).
- `sendPackagePurchasedNotification(purchaseId, businessId)` → email a `customer.email` con `replyTo: getBusinessReplyToEmail(businessId)`.
- `sendPackageSoldNotificationToBusiness(businessId, data)` → itera `getBusinessOwnerEmails` (owners = solo email; no hay canal/preferencia).
- Dispatch desde el branch de paquete del webhook, envuelto en `sendNotificationSafely(...)`.

### Fixes de visibilidad owner (del audit)
**Modificar `src/server/actions/packages.ts`:**
- `getCustomerPackages`: filtrar `status: { in: ['active','refunded'] }` (excluir `pending`) para que las compras abandonadas no aparezcan como "0 sesiones · pending" en el panel de la dueña.

**Modificar `src/server/actions/customers.ts`:**
- Historial de pagos (`getCustomerDetail`): decidir mostrar/ocultar `Payment{status:'pending', paymentType:'package_purchase'}`. Se ocultan los `package_purchase` pending del historial (se muestran solo desde `approved`), para no acumular pendientes fantasma. (Totales ya están safe: `totalPaidApproved` filtra `approved`.)

**Modificar `src/app/dashboard/customers/[id]/package-panel.tsx`:**
- El botón de reembolso, cuando `source === 'online'`, muestra el aviso "esta compra fue con tarjeta; reembolsá el cargo manualmente en Mercado Pago" (decisión 2).

### Ingresos por paquete en dashboard (decisión 3)
**Modificar `src/server/actions/ledger.ts`:**
- `getFinancialSummary`: agregar línea `packageIncomeToday/Month` (sum `package_sale` neto de `refund_issued` con `packagePurchaseId != null`). NO mezclar con `incomeToday/Month` (que siguen excluyendo `packagePurchaseId`).
- `getLedgerEntries`: incluir `packagePurchase` en el `include` para que las filas `package_sale` tengan contexto (nombre/cliente) en la vista de ledger.

**Modificar el dashboard principal** (`src/app/dashboard/page.tsx` y/o `payments/page.tsx`): mostrar la línea de ingresos por paquete.

### CTA en la landing
**Modificar `src/components/public/business-profile.tsx`:**
- Sección/CTA "Paquetes" (solo si el negocio tiene `PackageProduct` activos) linkeando a `/paquetes/[slug]`.

---

## Comportamiento documentado (no-bugs, aceptados)

- **Ownership por teléfono (phone-squatting).** El `Customer` se keyea por `(businessId, normalizePhone)`. Si la clienta logueada tipea un teléfono que ya pertenece a otro `Customer`, el paquete se ata a ese registro (o lo absorbe si estaba sin email/userId). Es el tradeoff ya aceptado (la cuenta logueada se lleva la ficha). Se documenta: **la propiedad del paquete sigue al teléfono**, y un teléfono mal tipeado enruta la compra a otro Customer.
- **Ventana pending.** Entre el redirect de MP y la aprobación del webhook, la compra está `pending`: `/mi/[slug]` no la muestra; `/paquetes/confirmation` muestra "procesando".

---

## Testing

**Unit:**
- `createPackagePurchase`: pending creation, reuse de pending viva, rechazo de reuse vencida, link por email verificado, rechazo sin login, re-gate online.
- `initiatePackagePayment`: pre-create Payment, reuse pending, preferencia, ownership.
- `createMpPreferenceForPayment`: compartido; el camino de reserva sigue idéntico (contrato).
- Webhook dispatch de paquete: `approved` → `applyApprovedPackagePayment`; validación de metadata por tipo; `rejected` no activa; `refunded` branch de paquete.
- `derivePackageConfirmationState`.
- `getCustomerPackages` excluye `pending`.
- `getFinancialSummary` con línea de paquete (no doble-conteo; pending no cuenta).

**Integración:**
- Compra completa → webhook approved → grants + ledger `package_sale` + status `active` + `/mi/[slug]` (por `userId`) devuelve la compra.

**e2e:** smoke de catálogo + gate de login (no requerido / puede ser flaky).

**Gate por rebanada:** suite unit completa + `prisma generate && tsc --noEmit | grep '^src/'` (0 errores src) + eslint + `/simplify` (4 ángulos) + code review 5-finders con verificación + PR SIN auto-merge; merge solo con OK explícito.

---

## Forward-compat (B4b-3)

- **Transferencia bancaria para paquetes:** reusar el patrón de #71 (bt-balance) — `createManualPayment`-style para paquete + confirmación de la dueña.
- **Cron sweep de holds:** barrer `PackagePurchase{status:'pending', holdExpiresAt < now}` → cancelar + limpiar `Payment` pending asociado.
- **Refund real por MP:** agregar `refundPayment` a `PaymentProvider` + `/v1/payments/{id}/refunds`; llamarlo desde `refundPackagePurchase` cuando `source === 'online'`.
- **Chargeback de paquete activo:** política de reversión de grants ya consumidos (fuera de B4b-2).
