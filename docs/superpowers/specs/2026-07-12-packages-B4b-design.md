# B4b — Compra online de paquetes prepagados (Mercado Pago + transferencia) + ledger unificado — Design

**Fecha:** 2026-07-12 · **Estado:** aprobado por el usuario
**Contexto previo:** B4a (venta manual de paquetes + consumo) mergeada (PR #38). El core de pagos está acoplado a `Booking` (`Payment.bookingId` NOT NULL, `applyApprovedPayment` moldeado a reserva). D1 (login de clienta + `/mi` + funnel con CTA de cuenta) mergeado — se reusa su matching de sesión, el redirector `/ir/[slug]` y el componente `AccountCta`.

## Objetivo

Que una clienta compre un paquete prepagado **online** desde una página pública `/paquetes`, pagando con **Mercado Pago** o **transferencia bancaria**, sin fricción de invitada (prefill/vinculación si hay sesión, igual que el funnel de reservas). Y que **toda** venta de paquete (online y manual) quede registrada en el ledger financiero como ingreso — hoy la plata de paquetes es invisible para el dashboard.

## Hechos verificados del código (base del diseño)

- **`Payment.bookingId` es NOT NULL** con FK `onDelete: Cascade` (`prisma/schema.prisma:439`) → hoy no existe un `Payment` sin reserva. `applyApprovedPayment` (`src/server/services/finance.ts:96-224`) — único camino que escribe `Payment` + su `LedgerEntry` — hace `booking.findUnique` y tira si no existe, luego `recalcBookingFromPayments`.
- **`LedgerEntry` ya es booking-agnóstico**: `bookingId`/`paymentId`/`customerId` todos opcionales (`schema.prisma:490-528`). Falta el valor de enum `package_sale` en `LedgerEntryType`. `PaymentType` no tiene variante de paquete.
- **`PackagePurchase` NO está acoplado a `Booking` ni `Payment`** (`schema.prisma:739-767`): `pricePaid`, `quantity`, `bonusQuantity`, `coversAll`, `coveredServiceIds[]`, `source String` (hoy siempre `'manual'`), `paymentMethod?`, `status String @default("active")` (hoy solo `active`/`refunded`). **No tiene `holdExpiresAt`.**
- **`sellPackage`** (`src/server/actions/packages.ts:86-142`) crea el `PackagePurchase` + N `PromotionGrant free_service` apuntando a una promo marcador `package-coverage` por negocio; grants idempotentes por `@@unique([customerId, requestId])`. **No escribe `Payment` ni `LedgerEntry` ni notifica.** `getPackageSalesTotal` (`packages.ts:219-226`) suma `pricePaid` directo, bypasseando el ledger.
- **Consumo** (`src/lib/packages/consume.ts`): `findApplicablePackageGrant`/`applyPackageInTx` keyed en `(businessId, customerId, serviceId)`, filtra `packagePurchase.status === 'active'`. **`source` nunca se lee/filtra** → un paquete online (mismo shape, `source:'online'`) se consume idéntico.
- **`/mi` ya muestra paquetes**: `loadLoyaltyCardData` (`src/lib/loyalty/card-data.ts:30-73`) ya consulta `packagePurchase` y `LoyaltyCard` (`src/components/loyalty/loyalty-card.tsx:81-94`) ya renderiza "Mis paquetes · N sesiones disponibles". **Cero UI nueva del lado clienta** — solo hay que garantizar el link de la `Customer`.
- **Matching de `Customer` duplicado inline** en `createBooking` (`bookings.ts:311-347`) y `createBookingFromDashboard` (`:820-856`); **no hay helper compartido**. Clave: `findFirst({ phone: normalizePhone(phone), businessId })` + `linkCustomerFromBookingSession(tx, customer, sessionUser, businessId)`.
- **Vinculación vía 1** (`linkCustomersByVerifiedEmail`, `link.ts:31-44`) exige `Customer.email` no-null (case-insensitive vs email verificado). MP fuerza el email del pagador (`mercado-pago-provider.ts:103`).
- **Sweep de holds** (`src/lib/cron/expire-holds.ts` → `/api/cron/expire-holds`, hora en `.github/workflows/cron.yml`) solo barre `Booking`. No conoce `PackagePurchase`.
- **`/ir/[slug]`** (`src/app/ir/[slug]/route.ts:18`) hardcodea `getBookingFunnelUrl` como destino. `sanitizeNext` solo acepta paths root-relative. `getAccountCta` (`session-prefill.ts`) ya es genérico.
- **`revalidateBusinessPublicPaths`** (`src/server/actions/revalidate-business.ts:14-33`) revalida `/`, `/book`, `/b/[slug]`, `/book/[slug]` — no `/paquetes`. `upsertPackageProduct`/`archivePackageProduct` solo revalidan `/dashboard/paquetes`.
- **Disponibilidad de pago** por negocio: `resolveOnlinePaymentAvailabilityForBusiness` (MP OAuth por tenant, opcional) + `getBankTransferInfo`. El funnel de reservas cae a transferencia y, si no hay ninguno, a reserva manual "pago después". **Paquetes no tiene camino manual público.**
- **Notificaciones** todas booking-shaped (`serviceName`/`startDateTime`/`bookingNumber` requeridos, `src/lib/notifications/types.ts`). Venta de paquete hoy no notifica. **Resend caído** → los emails se saltan silenciosamente (`email-provider.ts:87-92`); WhatsApp funciona.
- **Puntos** se ganan solo al completar reserva (`creditVisitPoints`, idempotencia `@@unique([bookingId, reason])`, exige `bookingId`). La venta manual da 0 puntos (decisión B4a).

## Decisiones cerradas

1. **Quién/cómo compra:** híbrido — comprable como invitada con prefill/vinculación si hay sesión (igual que el funnel de reservas).
2. **Punto de entrada:** página dedicada `/paquetes` (+ `/paquetes/[slug]` path) con link discreto desde la landing; `/mi` linkea ahí para recompra.
3. **Métodos de pago:** Mercado Pago **+ transferencia bancaria** (paridad con reservas).
4. **Ledger unificado:** toda venta de paquete (online y manual) escribe al ledger de acá en adelante; **sin backfill** del histórico de B4a.
5. **Arquitectura de pago:** `Payment` polimórfico (Enfoque 1) — `bookingId` nullable + `packagePurchaseId?`, `applyApprovedPayment` bifurcado.
6. **Puntos en la compra:** **NO** — consistente con la venta manual; consumir la sesión igual gatilla `pointsPerVisit` en la reserva cubierta. (Documentado; extender a "puntos por compra" quedaría como fast-follow con `LoyaltyReason` nuevo + idempotencia sin `bookingId`.)
7. **Notificaciones:** las 3 superficies con tipos nuevos **desacoplados** de la forma booking, degradando con gracia mientras Resend esté caído (WhatsApp donde aplique, skip silencioso del email).
8. **Empty-state:** gatear el CTA de compra tras el chequeo de disponibilidad; si no hay ni MP ni transferencia, mostrar "compra online no disponible" (la dueña sigue con la venta manual de B4a). Sin "pagar después" público en v1.

## Diseño

### Modelo de datos (migración aditiva, bajo riesgo)

- `Payment.bookingId` → **nullable**; nuevo `Payment.packagePurchaseId String?` + relación a `PackagePurchase`. Invariante a nivel app (y check si es barato): exactamente uno de `bookingId`/`packagePurchaseId` presente. `Payment.customerId` sigue requerido.
- `PackagePurchase`: nuevo `holdExpiresAt DateTime?`; `status` gana `pending` (MP sin aprobar / transferencia declarada) y `expired` (hold vencido). `source` gana el valor `'online'` (sigue siendo `String`).
- Enums: `PaymentType.package_purchase`, `LedgerEntryType.package_sale`. El reembolso de paquete **reusa** `LedgerEntryType.refund_issued` (para que `totalRefunded` lo capture sin tocar su filtro).
- `mapPaymentTypeToLedgerEntryType`/`mapPaymentTypeToLedgerDirection` (`finance.ts:15-47`, switch exhaustivo) ganan el caso `package_purchase` → `package_sale`/`income` (TS fuerza el manejo).

### Núcleo compartido

- **`findOrCreateCustomerInTx(tx, { businessId, phone, name, email, sessionUser })`** (nuevo, `src/lib/customers/`): matcher único (clave `businessId` + `normalizePhone(phone)`), crea si falta, backfillea `email` en match existente, y llama `linkCustomerFromBookingSession` si hay sesión. Refactor: `createBooking` y `createBookingFromDashboard` pasan a usarlo (preservando su semántica actual de atribución de referido / backfill). La compra de paquete lo reusa verbatim → **imposible** crear una Customer divergente.
- **`activatePackagePurchaseInTx(tx, purchase, { source, requestId, paymentId? })`** (nuevo): `status → active`, emite los N grants (extrae la lógica de emisión de `sellPackage`, idempotente por `perGrantRequestId`), escribe `LedgerEntry(type: package_sale, direction: income, amount: pricePaid, packagePurchaseId, paymentId?, bookingId: null, customerId)`, y encola la notificación de activación. **Lo invocan los tres caminos**: MP aprobado (webhook), transferencia confirmada (dueña), y `sellPackage` manual (que ahora escribe al ledger vía este helper).

### `applyApprovedPayment` — bifurcación

Se extrae el tronco compartido (upsert del `Payment` + su `LedgerEntry` cuando aplica). Luego:
- **Rama reserva** (`bookingId` presente): igual que hoy — `booking.findUnique` + `assertBookingPayable` + `recalcBookingFromPayments`.
- **Rama paquete** (`packagePurchaseId` presente): salta todo lo de booking; carga el `PackagePurchase`, valida que esté `pending` y pertenezca al negocio, y llama `activatePackagePurchaseInTx`. No toca `recalcBookingFromPayments`.

### Webhook de Mercado Pago

Acepta `packagePurchaseId` en el `metadata` como alternativa a `bookingId`. Reusa tal cual: verificación HMAC, re-verificación con el token del negocio, idempotencia (pre-crear `Payment` pending), transiciones de estado. En `approved` con `packagePurchaseId` → rama paquete de `applyApprovedPayment`. En `refunded` → enruta a `refundPackagePurchase` (que ya revierte grants) en vez de las reversiones booking-keyed.

### Flujo de compra `/paquetes`

Página pública (subdominio `/paquetes` + path `/paquetes/[slug]`), dinámica (lee sesión). Lista los `PackageProduct` activos con "Comprar". Gateada por disponibilidad: si no hay ni MP ni transferencia, muestra los packs pero con "compra online no disponible" (sin botón muerto). Link discreto desde la landing (`business-profile.tsx`) y desde `/mi` (recompra).

Wizard de compra:
1. **Contacto** — prefill editable desde la sesión (`getFunnelSession`), **email requerido** (para la vinculación vía 1). Sin sesión, banner de login reusando el patrón del funnel; el retorno usa `/ir/[slug]?dest=paquetes`.
2. **Método** — MP y/o transferencia según disponibilidad.
   - **MP:** crea `PackagePurchase(status: pending, source: 'online')` vía `findOrCreateCustomerInTx` + `Payment(pending, packagePurchaseId, paymentType: package_purchase)`; preferencia MP con `metadata { packagePurchaseId, businessId, paymentType, localPaymentId }`; redirect. Webhook aprobado → `activate`.
   - **Transferencia:** crea `PackagePurchase(status: pending, holdExpiresAt = now + ventana, source: 'online')` — la `ventana` reusa la misma duración de hold que la transferencia de reservas (la config/constante que hoy usa el flujo de `Booking`; se identifica en B4b-3), sin inventar un setting nuevo. Muestra instrucciones + "ya transferí" (declaración). La dueña confirma en el dashboard → `activate`.
3. **Confirmación** — `/paquetes/confirmation?purchaseId=` (análoga a `/book/confirmation`), estados: `active` / `pending-transfer` (instrucciones + declarar) / `rejected` / `expired`. Reusa `AccountCta` (crear cuenta / ver mis paquetes) con las mismas reglas que el CTA post-reserva (solo con email; nunca sobre la acción de declarar transferencia).

### Redirector de login

`/ir/[slug]` gana un `?dest=` **server-resuelto contra allowlist** (`book` | `paquetes`): `book` → `getBookingFunnelUrl`, `paquetes` → nuevo `getPackagesPageUrl`. Nunca acepta un destino arbitrario del cliente (mantiene el no-open-redirect). `sanitizeNext` intacto.

### Dashboard (dueña)

- **Confirmación de transferencias de paquetes:** superficie análoga a `PendingTransfersBanner` + `confirmBankTransfer`/`rejectBankTransfer`, scopeada a `PackagePurchase.status === 'pending'` con hold vivo. Confirmar → `activate`; rechazar → `status: rejected` (sin grants, sin ledger).
- **Lista de ventas en `/dashboard/paquetes`:** hoy solo muestra el catálogo + "Total vendido"; se agrega una tabla de `PackagePurchase` (source, status, método, fecha). `package-panel.tsx` maneja el estado `pending` (badge + acciones) y muestra `source`.
- **Ledger:** `getPackageSalesTotal` **deriva del ledger** (`sum(package_sale) neto de refund_issued de paquetes`) → fuente única. `LedgerTable` gana `package_sale: 'Venta de paquete'`. `PaymentType.package_purchase` queda **excluido** de `totalDeposited` (que filtra `paymentType: 'deposit'`).

### Reembolso

`refundPackagePurchase` escribe, **dentro de la misma tx**, un `LedgerEntry(type: refund_issued, direction: expense, amount: refundedAmount prorrateado)` — el monto es el prorrateo de `computePackageRefund`, **no** `pricePaid`. Reusa `refund_issued` → `totalRefunded` lo captura sin cambios.

### Cron / expiración

`expireStaleHolds` se extiende (o gana una función hermana con el mismo patrón transaccional) para barrer `PackagePurchase` con `status: pending` y `holdExpiresAt < now` → `status: expired` (sin grants). Rueda en la cadencia horaria existente (`/api/cron/expire-holds`), sin schedule nuevo.

### Notificaciones (tipos nuevos desacoplados)

Tres superficies, con data shapes propios (sin `serviceName`/`startDateTime`/`bookingNumber`), vía la infra `sendNotificationSafely` con skip silencioso del email mientras Resend esté caído:
- **Clienta "paquete activado"** (al activar, ambos métodos).
- **Dueña "paquete vendido online"** (al activar).
- **Dueña "declararon transferencia de un paquete"** (al declarar, análoga a `sendBankTransferDeclaredToBusiness`).

### Revalidación

`revalidateBusinessPublicPaths` agrega `/paquetes` y `/paquetes/[slug]` (+ equivalente subdominio). `upsertPackageProduct`/`archivePackageProduct` la llaman (hoy no lo hacen) → sin precios stale.

## Rebanado de entrega (3 PRs incrementales, cada uno shippable)

- **B4b-1 — Generalización del core (sin UI pública):** migración (`Payment` polimórfico, `PackagePurchase.holdExpiresAt`/estados, enums), `findOrCreateCustomerInTx` (+ refactor de los 2 caminos de booking), `activatePackagePurchaseInTx`, `sellPackage` manual ahora escribe al ledger vía el helper, `getPackageSalesTotal` deriva del ledger, `LedgerTable`/`package-panel` labels, `applyApprovedPayment` bifurcado (rama paquete lista pero aún sin caller público). Valor inmediato: la plata de paquetes se ve en finanzas. Riesgo mínimo sobre reservas (con tests del branch de reserva antes de tocar `applyApprovedPayment`).
- **B4b-2 — Compra online con Mercado Pago:** página `/paquetes` + `/paquetes/[slug]` + wizard + rama paquete del webhook MP + `/paquetes/confirmation` + `/ir/[slug]?dest=paquetes` + `getPackagesPageUrl` + revalidación + link desde landing/`/mi` + notificaciones de activación/venta. El grueso del valor.
- **B4b-3 — Transferencia bancaria de paquetes:** estado pending por transferencia + declaración pública + panel de confirmación de la dueña + extensión de `expireStaleHolds` + notificación de transferencia declarada.

Cada rebanada = spec honrada, tests, gate (suite + `tsc` 0 src + eslint + /simplify + code review 5-finders) y PR propio sin auto-merge. El plan de implementación arranca por **B4b-1**.

## Fuera de alcance (documentado, no construir)

- Backfill del histórico de `PackagePurchase` de B4a al ledger (opcional si un negocio lo pide).
- Puntos de fidelización por compra de paquete (fast-follow: `LoyaltyReason` nuevo + idempotencia por `packagePurchaseId`).
- Reembolso automático vía MP (el reembolso sigue siendo owner-initiated vía `refundPackagePurchase`; solo se le suma el asiento en el ledger).
- "Reservar el pack, pagar después" público (no hay camino manual público en v1).

## Errores y bordes

- MP `rejected` → `PackagePurchase` queda `pending`/sin activar, sin grants, sin ledger. La confirmación muestra estado rechazado.
- Invitada por transferencia → se rastrea vía la URL de confirmación (`purchaseId`) + la dueña confirma; **email requerido** en el contacto para que la vinculación vía 1 levante el paquete al loguearse.
- Idempotencia: `Payment` pending pre-creado se reusa ante doble-click (como reservas); emisión de grants idempotente por `requestId`; `LedgerEntry` único por `paymentId`.
- Servicio del pack: la cobertura se snapshotea en `PackagePurchase` (`coversAll`/`coveredServiceIds`) al comprar (ya existe en B4a), decoplado de ediciones posteriores del `PackageProduct`.
- Sin sesión Prisma `User`: `getFunnelSession` funciona igual; el prefill usa datos de sesión y la Customer vinculada simplemente no existe.

## Testing

- **Unit:** `findOrCreateCustomerInTx` (match/create/backfill/link), `activatePackagePurchaseInTx` (grants + ledger + idempotencia), bifurcación de `applyApprovedPayment` (rama paquete no toca booking; rama reserva intacta), `getPackageSalesTotal` derivado del ledger, helpers de URL/redirector `?dest`.
- **Integración:** compra MP aprobada → grants + ledger; transferencia declarada → pending → confirmada → activa; reembolso → asiento prorrateado; expiración de hold → `expired`.
- **Component:** wizard de compra (prefill/guest/empty-state), confirmación en sus 4 estados, panel de confirmación de la dueña.
- **e2e (no requerido):** smoke de compra MP con identidad admin (runtime-skip local), como el resto de e2e reales.

Sin tocar `sanitizeNext` ni `signOut`. La migración es aditiva y nullable (bajo riesgo); se aplica con `db execute` + `migrate resolve --applied` (ver landmine del initiative) para no romper el deploy de Vercel.
