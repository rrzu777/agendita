# B4b-3 — Transferencia de paquetes + refund real por MP + política de chargeback — Design

**Fecha:** 2026-07-12 · **Estado:** aprobado por el usuario
**Contexto previo:** B4b-1 (core polimórfico + ledger unificado, PR #72) y B4b-2 (compra online pública + wizard + webhook MP, PR #75) mergeadas a main. Esta es la tercera y última rebanada de B4b. El design general vive en `docs/superpowers/specs/2026-07-12-packages-B4b-design.md`; esta rebanada honra su sección "B4b-3" y **expande** dos piezas que aquél había parkeado como out-of-scope: el **refund real por Mercado Pago** y la **política de reversión de paquete activo (chargeback)**.

## Objetivo

Cerrar la compra online de paquetes con paridad total respecto a las reservas:
1. **Transferencia bancaria** como segundo método de pago de paquetes (declaración pública + confirmación de la dueña + expiración de holds).
2. **Refund real por Mercado Pago** cuando la dueña reembolsa un paquete pagado online (hoy el reembolso es sólo contable: revierte grants y asienta el ledger, pero la plata no vuelve).
3. **Política de chargeback** de un paquete ya activo: cuando MP avisa `charged_back`/`refunded` involuntario, revertir la cobertura y clawback de puntos, marcar la compra como disputada y alertar a la dueña.

## Hechos verificados del código (base del diseño)

Verificados contra el árbol actual (worktree `claude/b4b-packages-online`, post-#75):

- **El early-return que bloquea el chargeback está en `route.ts:346`, no en `:518`.** `src/app/api/webhooks/mercado-pago/route.ts:346` hace `if (payment.status === 'approved') return 200` **sin side-effects para cualquier `mpStatus`**. Un paquete activo tiene su `Payment` en `approved`, así que un webhook `charged_back` muere ahí y jamás alcanza la rama de estados terminales (`:510-558`, cuyo guard `:518-526` es inalcanzable para un approved). El comentario `route.ts:555-557` confirma que la reversión de paquete es trabajo de B4b-3.
- **`refundPackagePurchase` es sólo contable** (`src/server/actions/packages.ts:113-162`): `requireBusinessRole(['owner','admin'])`, calcula `computePackageRefund` (prorrateo por sesiones no usadas, tope `pricePaid`), y dentro de su propia `$transaction` revierte grants `status:'active'` → `reversed`, marca `PackagePurchase.status:'refunded'` + `refundedAt`/`refundedAmount`, y crea `LedgerEntry(refund_issued, expense, packagePurchaseId)`. **No llama a MP.** El asiento se crea **sin `paymentId`** (`packages.ts:151`) → no lo protege `@@unique([paymentId])` (`schema.prisma:525`). Sólo revalida `/dashboard/customers/[id]` (`packages.ts:161`), a diferencia de `sellPackage` (`packages.ts:52-53,61-62`) que revalida `/dashboard/paquetes` + público.
- **`PaymentProvider` no tiene `refundPayment`** (`src/lib/payments/types.ts:47-52`): sólo `name`/`createPayment`/`verifyPayment`/`handleWebhook`. Implementaciones: `mercado-pago-provider.ts`, `manual-provider.ts`, `mock-provider.ts`, más el **wrapper literal `mercadoPagoPaymentProvider`** (`mercado-pago-provider.ts:190-195`, objeto separado que delega al global) — 4 objetos que TS obliga a completar. `factory.ts:33` tiene un case `webpay` que sólo `throw` (sin objeto). `getMercadoPagoProviderForBusiness(businessId)` (`factory.ts:285-308`) desencripta el token OAuth del negocio; el webhook lo usa para re-verificar (`route.ts:227-233`). `mpRequestWithToken` (`mercado-pago-provider.ts:51-73`) setea sólo Authorization + Content-Type — **no threadea `X-Idempotency-Key`**.
- **Semántica de "consumido":** `applyPackageInTx` (`src/lib/packages/consume.ts:46-49`) voltea el grant **`active`→`redeemed` atómicamente al crear la reserva**, setea `redeemedBookingId` (slot `@unique`) y crea un `PromotionRedemption(status:'applied')`. **No existe estado `reserved`.** Por lo tanto un grant atado a una reserva *upcoming/pending/hold* ya está `redeemed`, no `active`. "No consumido" en el código actual = grant `active` = no atado a ninguna reserva.
- **`refundPackagePurchase` / conteos miran sólo `active`:** `packages.ts:126,133,140`, `getCustomerPackages:195`, `getActivePackagesForCustomer:178`. Ninguno toca `redeemed` → un paquete disputado con una reserva futura agendada seguiría cubriéndola gratis si sólo revirtiéramos `active`.
- **Reversión de un grant `redeemed` sin limpieza rompe `release`:** si se marca `reversed` sin anular `redeemedBookingId` ni el `PromotionRedemption`, un cancel/no-show posterior corre `releaseRedemptionForBooking` (`src/lib/promotions/release.ts:19-30`) que flipea el redemption `applied`→`released`, y luego `reactivateGrantForBooking` (`release.ts:59-62`, filtra `status:'redeemed'`) hace no-op sobre el grant ya `reversed` → estado inconsistente (redemption released, grant atascado `reversed`, `redeemedBookingId` ocupando el `@unique`).
- **Puntos por sesión cubierta:** una reserva cubierta por paquete tiene `finalAmount:0` (`src/lib/booking/recompute.ts:17`), pero `creditVisitPoints` (`src/server/actions/bookings.ts:524-532`) igual acredita el flat `pointsPerVisit` al completar cuando no hay `minSpendToEarn` (`src/lib/loyalty/earn.ts:26`). `reverseVisitPoints` está keyeada por `bookingId` (`src/lib/loyalty/credit.ts:53-54`, `@@unique([bookingId, reason])`). La rama de reservas del webhook ya hace clawback (`route.ts:544-553`); paquetes no tiene equivalente.
- **Prefijo de transferencia declarada:** `declaredTransferPaymentWhere` filtra `providerPaymentId startsWith 'bt-declared:'` (`src/lib/bank-transfer/declared.ts:26`); `btDeclaredId(bookingId)` (`:14`). Un `bt-declared:pkg:...` **satisface ese `startsWith`** → los sweeps booking-scoped (`expire-holds.ts:83`, `transfer-reminders.ts:67,149`, `/mi`) lo agarrarían por accidente. `bt-balance:` (`:56-58`) ya sentó el precedente de usar un **prefijo distinto**, no un sub-namespace.
- **`bank-transfer-verify.ts` / `bank-transfer-public.ts` son booking-shaped:** `loadDeclaredPayment` lanza si `!payment.bookingId` (`verify:42`); confirmar llama `applyApprovedPayment` (booking-only); rechazar hace `booking.updateMany` + `releaseRedemptionForBooking`. Declare* keyea en `booking.paymentMethod`, race-guard `booking.updateMany` sobre `holdExpiresAt`, `proofKey(businessId, bookingId, kind)`.
- **`expireStaleHolds`** (`src/lib/cron/expire-holds.ts:26-97`) es Booking-only (`db: Pick<..., 'booking'|'payment'|'$transaction'>`); no conoce `PackagePurchase`. Las purchases `pending` aún no tienen grants (los crea `activate`), así que la expiración no limpia grants.
- **Superficies de la dueña, hoy ciegas a paquetes online pendientes:** `getCustomerPackages` filtra `status in ['active','refunded']` (`packages.ts:191`) → `pending`/`expired` invisibles. `package-panel.tsx:105-107` sólo mapea `active`/`refunded`; cualquier otro cae al string crudo, y el botón "Reembolsar" (`:109`) no se gatea por estado. `PendingTransfersBanner` (`src/components/dashboard/pending-transfers-banner.tsx`) y el contador del home (`src/app/dashboard/page.tsx:59-61`) son 100% booking-shaped y linkean a `/dashboard/bookings`.
- **Notificaciones a la dueña = email-only, Resend caído:** `getBusinessOwnerEmails` (`email-provider.ts:146`) → Resend. **No hay canal WhatsApp hacia la dueña** (`business.whatsapp` es el número público para contactar a la clienta). `BankTransferDeclaredEmailData` (`types.ts:128-140`) exige `serviceName`+`startDateTime` (booking-shaped). `PackagePurchasedEmailData` (`types.ts:204-213`) ya es el patrón desacoplado a imitar.
- **Confirmation page miente post-terminal:** `derivePackageConfirmationState` (`src/lib/payments/package-confirmation-state.ts:13`) mapea `refunded`→`'rejected'` → `confirmation/page.tsx:71-77` muestra "Pago no aprobado, intentá de nuevo"; y no tiene `expired` → un `pending` con hold vencido cae en `'pending'` → "Procesando tu pago" para siempre.
- **`/mi` filtra `status:'active'`** (`src/lib/loyalty/card-data.ts:58`, y `_count` en `:68`): tras chargeback/refund el paquete sale de `/mi` y los grants pasan a `reversed` → **sin sesiones fantasma** (verificado). Un `pending` por transferencia tampoco aparece en `/mi` hoy.
- **`getPackageSalesTotal`** (`packages.ts:200-209`) = `SUM(package_sale) − SUM(refund_issued con packagePurchaseId)` **sin piso** → un chargeback por monto completo (que con fees puede superar `pricePaid`) puede dejar el total negativo, renderizado directo en `/dashboard/paquetes/page.tsx:37`. Los KPI windowed (`ledger.ts:150-166`) ya hacen `Math.max(0, ...)`. Los asientos de paquete hardcodean `currency:'CLP'` (`activate.ts:86`, `packages.ts:155`) aunque el Payment online usa `business.currency`.
- **Aislamiento de KPI de reservas OK mientras el asiento lleve `packagePurchaseId`:** `getFinancialSummary` filtra `refund_issued` con `packagePurchaseId:null` para `totalRefunded` (`ledger.ts:133-140`) e `incomeToday/Month` con `packagePurchaseId:null` (`:100-116`). Test de aislamiento: `tests/unit/ledger-package-isolation.test.ts`.

## Decisiones cerradas

1. **Alcance de B4b-3:** transferencia de paquetes **+** refund real por MP **+** política de chargeback (el usuario reabrió las dos piezas parkeadas).
2. **Monto del refund voluntario por MP:** **prorrateado** por sesiones no usadas (`computePackageRefund`), refund parcial real a la tarjeta. Las sesiones ya consumidas no se devuelven.
3. **Profundidad del chargeback:** **reversión total + clawback de puntos** (máximo rigor). Revierte grants `active` **y** `redeemed` de reservas upcoming no completadas (descubriendo la reserva), **y** hace clawback de puntos de las sesiones ya completadas del paquete disputado.
4. **Asimetría voluntario vs chargeback:** el refund **voluntario** conserva su semántica actual (sólo grants `active`, prorrateo, sin tocar reservas comprometidas ni puntos — es una acción deliberada de la dueña). El **chargeback** es la reversión total (la plata ya se fue involuntariamente).
5. **Fate de la reserva upcoming descubierta:** **no auto-cancelar.** Se libera la cobertura, se recomputan los montos → la reserva queda `pending_payment` (cobrable), owner-visible, y se notifica a la dueña. La dueña decide (cobrar en sitio, cancelar, etc.).
6. **Prefijo de transferencia de paquete:** `bt-pkg-declared:<purchaseId>` (distinto de `bt-declared:`), para no ser barrido por queries booking-scoped.
7. **Recordatorios de transferencia de paquete:** **out-of-scope** (la semántica del hold de paquete difiere; se difiere junto al retrofit de reservas).

## Diseño

### Modelo de datos (migración aditiva, bajo riesgo)

- **`PackagePurchase.chargebackAt DateTime?`** — único campo nuevo. Distingue un chargeback (status `refunded` + `chargebackAt` set) de un refund voluntario (status `refunded`, `chargebackAt` null). Permite badge "Disputado" ≠ "Reembolsado" e idempotencia.
- `PackagePurchase.status` sigue siendo `String` libre (no enum Prisma). Los estados en juego (`active`/`pending`/`expired`/`refunded`/`rejected`) se **centralizan en una const/tipo TS** (`src/lib/packages/status.ts`, nuevo) para evitar typos. Sin enums nuevos de Prisma; `PaymentStatus` ya tiene `refunded`/`failed`.
- Migración se aplica con `db execute` + `migrate resolve --applied` (landmine del initiative), verificando primero que la columna no exista ya en la DB compartida.

### Interfaz de pago: `refundPayment`

Se agrega a `PaymentProvider` (`types.ts`):

```ts
export interface RefundPaymentInput {
  providerPaymentId: string   // id del pago en el provider (MP payment id)
  amount: number              // monto a reembolsar (parcial permitido)
  currency: string
  idempotencyKey: string      // determinístico: refund:pkg:<purchaseId>
  accessToken?: string        // token OAuth del negocio (MP per-tenant)
}
export interface RefundPaymentResult {
  refundId: string | null     // id del refund en el provider (null para manual/mock)
  status: 'refunded' | 'pending' | 'failed'
  rawResponse: unknown
}
```

Implementaciones:
- **MP** (`mercado-pago-provider.ts` + wrapper literal): `POST /v1/payments/{providerPaymentId}/refunds` con `{ amount }`, header `X-Idempotency-Key: idempotencyKey`, `Authorization: Bearer <accessToken del negocio>`. `mpRequestWithToken` gana un parámetro opcional de idempotency-key. Un 200/201 → `{ refundId, status:'refunded' }`; un error de red/HTTP → lanza (no se escribe nada).
- **`manual-provider` / `mock-provider`:** no-op que devuelve `{ refundId:null, status:'refunded' }` (no hay pasarela; el reembolso de transferencia/manual es out-of-band, sólo contable, como hoy).
- **`webpay` (factory):** sigue siendo un `throw` (stub), sin objeto que implementar.

**Alcance:** sólo el reembolso de **paquetes** llama `refundPayment` en v1. El retrofit del refund real a **reservas** queda documentado como out-of-scope.

### Núcleo compartido: `reversePackagePurchaseInTx`

Se extrae de `refundPackagePurchase` un helper puro de tx (`src/lib/packages/reverse.ts`, nuevo), **reusable por la owner-action (con auth) y el webhook (sin auth)** — espejo de `activatePackagePurchaseInTx`. Firma:

```ts
reversePackagePurchaseInTx(tx, purchase, opts: {
  mode: 'voluntary' | 'chargeback'
  amount: number                 // prorrateo (voluntary) o monto MP completo (chargeback)
  currency: string               // de payment.currency, NO 'CLP' literal
  paymentId: string | null       // para idempotencia del asiento
  now: Date
}): Promise<void>
```

Comportamiento común (ambos modos), todo dentro de la tx del caller:
1. Revierte grants `status:'active'` del `packagePurchaseId` → `reversed` + `reversedAt`.
2. Marca `PackagePurchase`: `status:'refunded'`, `refundedAt`, `refundedAmount = amount`; si `mode==='chargeback'` además `chargebackAt = now`.
3. **Asiento idempotente:** `LedgerEntry(type:'refund_issued', direction:'expense', amount, currency, packagePurchaseId, customerId)`. Para no duplicar ante redelivery de MP / doble-click, se le adjunta `paymentId` (cuando existe) y se hace **`upsert` sobre una clave única** (mismo patrón que `activate.ts:94-97`; ver "Idempotencia" abajo). El `packagePurchaseId` es **invariante** (aísla el KPI de reservas).

Comportamiento sólo `mode==='chargeback'` (reversión total):
4. Revierte grants `status:'redeemed'` cuya reserva (`redeemedBookingId`) esté **upcoming no completada**: por cada uno, dentro de la tx —
   - marca el `PromotionRedemption` correspondiente `applied`→`released` (o `reversed`),
   - anula `redeemedBookingId` en el grant y lo marca `reversed` (evita el estado inconsistente que rompe `reactivateGrantForBooking`),
   - **descubre la reserva:** recomputa sus montos (`recompute`) → la reserva vuelve a `pending_payment` (cobrable), **sin auto-cancelar**, y encola la notif a la dueña ("una reserva quedó sin cobertura por un contracargo").
5. **Clawback de puntos** de las sesiones **ya completadas** del paquete: por cada `redeemedBookingId` de un grant del paquete cuya reserva esté `completed`, `reverseVisitPoints(tx, bookingId)` (idempotente por `@@unique([bookingId, reason])`) y, si `loyaltyConfig.clawbackAutoRewardOnRefund`, `reverseAutoRewardsForBooking(tx, bookingId, now, businessId)`.

El **refund voluntario** invoca `reversePackagePurchaseInTx(mode:'voluntary')` → sólo pasos 1-3. El **chargeback** invoca `mode:'chargeback'` → pasos 1-5.

### `refundPackagePurchase` (owner-action) — method-aware + refund real

1. `requireBusinessRole` + rate limit (como hoy).
2. Carga la compra + su `Payment` (`provider`, `providerPaymentId`). Idempotencia: si `purchase.status === 'refunded'` → no-op.
3. Calcula `refund = computePackageRefund(...)` (prorrateo).
4. **Si `payment.provider === mercado_pago` y hay `providerPaymentId`:** llama `provider.refundPayment({ amount: refund, idempotencyKey: 'refund:pkg:'+purchaseId, accessToken: <token del negocio> })` **FUERA de la `$transaction`** (I/O de red). Si falla → error visible, no se toca nada.
5. Sólo con éxito de MP (o provider manual/mock que es no-op OK), abre la tx y llama `reversePackagePurchaseInTx(mode:'voluntary', amount: refund, currency: payment.currency, paymentId: payment.id)`.
6. Revalida `/dashboard/customers/[id]`, `/dashboard/paquetes` y `revalidateBusinessPublicPaths(businessId)` (alinea con `sellPackage`).

### Webhook de MP — rama de chargeback de paquete

En `route.ts`, **antes del early-return `:346`** (o ramificando ahí), cuando el `Payment` es de paquete (`packagePurchaseId`) y el `mpStatus` es `charged_back`/`refunded`:
- Carga el `PackagePurchase`. **Idempotencia clave:** si `purchase.status !== 'active'` → no-op 200 (el paquete ya fue reembolsado/disputado; esto cubre el **eco del refund voluntario** propio — que dejó `status:'refunded'` — y el **redelivery** at-least-once de MP).
- Si `purchase.status === 'active'`: dentro de una `$transaction`, `tx.payment.update({ status:'refunded', providerPaymentId, rawPayload })` + `reversePackagePurchaseInTx(mode:'chargeback', amount: <monto del payload de MP>, currency: payment.currency, paymentId: payment.id, now)`.
- Fuera de la tx: notif "paquete disputado" a la dueña + revalida `/dashboard/customers/[id]`, `/dashboard/paquetes`, público.
- **Reservas intactas:** la perforación del guard es exclusiva para `packagePurchaseId && purchase.status==='active'`; la rama booking sigue con su comportamiento actual (approved no se degrada).

### Idempotencia (resumen de invariantes)

- **Asiento de reversión:** único por `(packagePurchaseId, paymentId, type:'refund_issued')` vía `upsert` (o una clave determinística). Evita doble egreso ante redelivery de MP o doble-click.
- **Refund real MP:** `X-Idempotency-Key = refund:pkg:<purchaseId>` → un retry re-emite el mismo refund (MP dedupe) sin devolver plata dos veces. Orden MP-antes-de-tx + guard `status==='refunded'` evita plata-sin-asiento: si MP tuvo éxito pero la tx falló, un retry re-llama MP (dedupe, no-op) y completa el asiento.
- **Eco vs chargeback:** distinción por `purchase.status` (`active` = chargeback genuino; ≠`active` = ya procesado). El `chargebackAt` distingue en datos.
- **Caso secuencial refund-voluntario-parcial→chargeback:** el guard `status!=='active'` saltea el chargeback (la compra ya está `refunded`). **Out-of-scope documentado:** el delta entre el prorrateo devuelto y el monto completo del chargeback no se re-asienta; es un borde raro (dueña reembolsó parcial y aparte hubo contracargo).

### Flujo de transferencia de paquete

- **Wizard `/paquetes`, método transferencia:** crea `PackagePurchase(status:'pending', holdExpiresAt = now + ventana de transferencia, source:'online')` vía `findOrCreateCustomerInTx` + `Payment(provider:'manual', paymentMethod:'Transferencia', status:'pending', packagePurchaseId)`. La ventana reusa la constante/config que hoy usa la transferencia de **reservas** (se identifica en el plan; no se inventa setting nuevo). Muestra instrucciones bancarias (`getBankTransferInfo`) + "ya transferí".
- **Declaración pública** (`bank-transfer-public.ts` gana rama de paquete): `providerPaymentId` determinístico **`bt-pkg-declared:<purchaseId>`**, race-guard sobre `PackagePurchase.holdExpiresAt`. Los helpers de `declared.ts` ganan variantes de paquete (`btPkgDeclaredId(purchaseId)`, where con `packagePurchaseId`, predicados).
- **Panel de la dueña** (`bank-transfer-verify.ts` gana rama de paquete): confirmar → `activatePackagePurchaseInTx` (grants + ledger + notif de activación, ya de B4b-1/2); rechazar → `status:'rejected'` (sin grants, sin ledger). `getCustomerPackages` incluye `pending`/`expired`. Un **banner/contador de transferencias de paquete pendientes** paralelo al de reservas (no reusa el booking-shaped) — es el **fallback real** de la notif (Resend caído). Badges: `pending`→"Por confirmar", `expired`→"Vencido", "Disputado" (chargeback) ≠ "Reembolsado" (voluntario); "Reembolsar" sólo visible en `active`.
- **Confirmation `/paquetes/confirmation`:** `derivePackageConfirmationState` gana estados `expired` y `disputed`/`refunded` con copy propio ("tu compra expiró" / "este pago fue reembolsado", no reintentables) — distintos de `rejected` (pago no aprobado, reintentable).

### Cron / expiración

`expireStaleHolds` se extiende (o gana función hermana con el mismo patrón) para barrer `PackagePurchase` con `status:'pending'` y `holdExpiresAt < now` → `status:'expired'`, con `updateMany` guardando `status:'pending'` en el where (gana la carrera vs la activación del webhook / `verifyAndConfirmPackagePayment`). Cancela además el `Payment` pending huérfano (espejo del sweep de reservas). No hay grants que limpiar (las pending aún no los tienen). Rueda en la cadencia horaria existente (`/api/cron/expire-holds`). Los **recordatorios de transferencia** (`transfer-reminders.ts`) quedan **out-of-scope**.

### Notificaciones (shapes desacoplados)

Dos shapes nuevos, sin `serviceName`/`startDateTime`/`bookingNumber`, siguiendo `PackagePurchasedEmailData`:
- **`PackageTransferDeclared` → dueña** (al declarar la transferencia; análoga a `sendBankTransferDeclaredToBusiness` pero sin datos de booking).
- **`PackageDisputed` → dueña** (al procesar el chargeback).

Ambas por `sendMultiNotificationSafely` con skip silencioso del email (Resend caído). Como no hay WhatsApp a la dueña, **el banner/contador del dashboard es el canal de respaldo** (documentado). La reserva descubierta por chargeback reusa/extiende la notif de cambio a la dueña.

### Revalidación

`reversePackagePurchaseInTx` y el webhook de chargeback revalidan `/dashboard/customers/[id]`, `/dashboard/paquetes` y `revalidateBusinessPublicPaths`. `getPackageSalesTotal` clampea a `Math.max(0, ...)` (el egreso real del chargeback vive en el detalle del ledger).

## Rebanado interno (orden de ataque, un solo PR)

Sugerido por dependencia (todo en el PR de B4b-3):
1. Migración `chargebackAt` + const de estados + `getCustomerPackages`/panel/badges (base visible).
2. `refundPayment` en la interfaz + 4 implementaciones + `mpRequestWithToken` idempotency-key + token per-tenant.
3. `reversePackagePurchaseInTx` (extraído, modo voluntary primero) + `refundPackagePurchase` method-aware (refund real MP) + idempotencia del asiento + revalidación.
4. Rama de chargeback del webhook (perforación del guard `:346`) + reversión total (redeemed/upcoming descubrir reserva + clawback puntos) + notif disputado.
5. Transferencia de paquete: prefijo `bt-pkg-declared:`, helpers de `declared.ts`, ramas de `bank-transfer-public`/`verify`, wizard método transferencia, confirmation states, banner/contador de la dueña, notif declarada.
6. `expireStaleHolds` extendido a paquetes.

## Fuera de alcance (documentado, no construir)

- Retrofit del refund real por MP a **reservas** (hoy también es sólo contable).
- Recordatorios de transferencia de paquete (`transfer-reminders`).
- Caso secuencial refund-voluntario-parcial → chargeback (el delta no se re-asienta).
- Corrección del bug pre-existente `currency:'CLP'` literal en `activate.ts`/`sellPackage` (los asientos **nuevos** de B4b-3 sí toman `payment.currency`; el retrofit del histórico es aparte).
- Comprobante de transferencia (R2) para paquetes (la feature de reservas está dormida hasta configurar R2).

## Errores y bordes

- **Guard del webhook:** la perforación es quirúrgica (`packagePurchaseId && status==='active'`); las reservas y los estados no-terminales siguen intactos.
- **Plata devuelta sin asiento:** imposible en régimen normal por el orden MP→tx + idempotency-key (retry reconcilia). Si MP falla, nada cambia.
- **Reserva descubierta:** vuelve a `pending_payment`, no se cancela; la dueña la ve y decide. Si estaba `completed`, no se descubre (sólo clawback de puntos).
- **Moneda:** los asientos nuevos toman `payment.currency`; los agregados (`getPackageSalesTotal`/`getFinancialSummary`) no agrupan por moneda hoy — un negocio no-CLP ya tiene el bug pre-existente, fuera de alcance.
- **KPI negativo:** clamp a 0 en `getPackageSalesTotal`; los windowed ya clampean.
- **Sin sesión Prisma `User`:** el webhook corre sin auth; `reversePackagePurchaseInTx` no depende de `requireBusinessRole` (por eso se extrae del `'use server'`).

## Testing

- **Unit:** `refundPayment` de cada provider (MP arma el POST correcto con idempotency-key + token del negocio; manual/mock no-op); `reversePackagePurchaseInTx` (voluntary: grants active + asiento idempotente; chargeback: + redeemed/upcoming descubre reserva + limpia redemption + clawback puntos); `derivePackageConfirmationState` (expired/disputed/refunded/rejected); helpers `bt-pkg-declared` (prefijo distinto, no capturado por `declaredTransferPaymentWhere` de reservas); `getPackageSalesTotal` clamp; guard de idempotencia del webhook por `status`.
- **Integración (Postgres local Docker `agendita-test-pg` :5433):** refund voluntario MP → grants active reversados + asiento prorrateado + purchase refunded; chargeback de paquete con una reserva upcoming + una completada → reserva descubierta a `pending_payment`, puntos de la completada revertidos, asiento por monto completo, `chargebackAt` set; redelivery del webhook → no duplica; eco del refund voluntario → no-op; transferencia declarada → pending → confirmada → activa; expiración de hold de paquete → `expired` + Payment cancelado.
- **Component:** wizard método transferencia (instrucciones + declarar); confirmation en estados nuevos; panel de la dueña (badges pending/expired/disputed, gate del botón Reembolsar); banner/contador de transferencias de paquete.
- **e2e (no requerido):** smoke de compra por transferencia con identidad admin (runtime-skip local), como el resto.

## Gate (por el PR)

Suite unit + `prisma generate && tsc --noEmit | grep '^src/'` (0 errores src) + eslint + `/simplify` (4 ángulos) + code review 5-finders con verificación. PR sin auto-merge; merge sólo con OK explícito. Migración aditiva aplicada con `db execute` + `migrate resolve --applied` (verificar columna antes). Sin tocar `sanitizeNext` ni `signOut`. Sin `relationLoadStrategy:'join'`.
