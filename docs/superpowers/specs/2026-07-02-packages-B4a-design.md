# Paquetes prepagados — Diseño (B4a: catálogo + venta manual + consumo)

**Rebanada:** B4a de la iniciativa promociones + fidelización. Cierra (con B4b) la parte
"prepago" de "B". Índice: `../2026-06-28-promotions-loyalty-roadmap.md`. Memoria:
`promotions-loyalty-initiative`.

> **Decomposición:** B4 se construye en dos ciclos desde este diseño compartido.
> **B4a (este spec):** catálogo de productos-paquete + venta manual + consumo en reservas +
> reembolso manual + vencimiento. **100% aditivo, no toca el núcleo de pagos.**
> **B4b (sub-proyecto siguiente, esbozado al final):** compra online vía Mercado Pago
> (generaliza `Payment` a propósito polimórfico + branch del webhook + página pública de
> compra). Se especifica en su propio ciclo.

## Problema / objetivo

Un salón quiere vender **paquetes de sesiones prepagadas** (ej. "Pack de 5 manicuras") que la
clienta consume a lo largo de varias reservas. Es compromiso + ingreso adelantado. Reusa el
motor de grants ya probado (B2/B3) para el consumo, y no requiere login de clienta (atribución
por teléfono, como la reserva pública).

## Decisiones cerradas (del brainstorming)

- **Cobertura:** N sesiones de un **conjunto configurable de servicios** (1 o varios, vía
  `appliesToAll`/`serviceIds`). El crédito por monto (stored-value) se difiere a **B5 gift cards**.
- **Consumo = reuso del motor de grants (Approach A).** Una compra emite N `PromotionGrant`
  (`free_service`, scoped), y el consumo/cancelación/no-show/vencimiento reusan el ciclo de
  grants existente.
- **Pago en B4a = venta manual**, registrada **directo en `PackagePurchase`** (no en el modelo
  `Payment`, que exige `bookingId`). El online (MP) es B4b.
- **Consumo automático con opt-out:** al reservar un servicio cubierto, si la clienta tiene un
  paquete activo, se aplica por defecto (reserva cubierta, `finalAmount 0`) pero se puede
  **destildar** para guardar la sesión. El paquete **toma precedencia sobre códigos de descuento**
  (es plata prepaga; **una promo por reserva**).
- **Vencimiento configurable por producto** (`expiryDays` opcional). Sesiones no usadas al vencer
  **se pierden** (sin reembolso automático).
- **Reembolso manual** (owner): cancela las sesiones **no usadas** (grants activos), marca la
  compra `refunded`, registra el monto. Las usadas quedan consumidas. El movimiento de plata es
  out-of-band en B4a (reembolso MP automático = fast-follow de B4b).
- **UI:** página propia **"Paquetes"** en el dashboard (separada de Fidelización).

## Arquitectura

### Modelo de dominio (migración aditiva)

- **`PackageProduct`** (catálogo, por negocio): `id`, `businessId`, `name`, `quantity` (sesiones,
  ≥1), `bonusQuantity` (≥0, default 0), `price` (Int, moneda del negocio), `expiryDays` (Int?,
  opcional), `isActive` (Bool), `promotionId` (FK a la **Promotion de respaldo**), auditoría +
  timestamps.
  - **Promotion de respaldo:** cada `PackageProduct` posee una `Promotion` con
    **`triggerType: 'package'`** (nuevo valor del enum `PromotionTrigger`), `rewardType:
    'free_service'`, `appliesToAll`/`services` = el alcance del paquete. Los grants apuntan a
    ella, de modo que el consumo reusa `applyPromotionInTx` (rama `free_service`) sin cambios. El
    trigger `package` la excluye naturalmente de las queries existentes (catálogo de canje
    filtra `granted`+`pointsCost not null`; reglas `automatic`; promos por código `code`).
- **`PackagePurchase`** (una venta): `id`, `businessId`, `customerId`, `packageProductId`,
  `pricePaid` (Int), `source` (`'manual'` | `'online'`), `paymentMethod` (String?, ej.
  efectivo/transferencia/tarjeta — para `manual`), `paidAt` (DateTime), `status`
  (`active`|`refunded`), `expiresAt` (DateTime?), `refundedAt` (DateTime?), `refundedAmount`
  (Int?), auditoría + timestamps.
- **`PromotionGrant`** += `packagePurchaseId` (String?, FK) + índice. Los grants de paquete se
  distinguen por tener `packagePurchaseId` no nulo (y su promotion tiene `triggerType 'package'`).

Enum `PromotionTrigger` += `package`. (Aditivo.)

### Emisión de grants al vender

`sellPackage` (server action, owner) en una `$transaction`:
1. Resuelve/crea la `Customer` por teléfono (normalizado, patrón de la reserva).
2. Crea `PackagePurchase` (`source: 'manual'`, `pricePaid`, `paymentMethod`, `paidAt: now`,
   `status: 'active'`, `expiresAt: expiryDays ? now + expiryDays : null`).
3. Emite `quantity + bonusQuantity` `PromotionGrant` (`promotionId` = el de respaldo, `code`
   único por grant, `pointsSpent: 0`, `status: 'active'`, `expiresAt` = el de la compra,
   `refundOnExpiry: false`, `forfeitOnNoShow: false`, `packagePurchaseId`).
   - Idempotencia: `requestId` por venta (unique `[customerId, requestId]` ya existe); reintentos
     no duplican.

### Consumo en la reserva (reuso de grants + auto-select)

Nuevo helper puro-ish `findApplicablePackageGrant(tx, businessId, customerId, serviceId)`:
- Devuelve el grant **activo, no vencido**, cuya promotion (`triggerType 'package'`) cubre el
  `serviceId` (`appliesToAll` o el servicio en su set) y `packagePurchaseId` no nulo, ordenando
  por `expiresAt` ascendente (usa antes lo que vence antes; nulls al final).
- En `createBooking` (pública) y en la reserva manual: tras resolver clienta + servicio, si
  `usePackage` (default true, opt-out del cliente/dueña) y hay grant aplicable, se aplica por el
  **flip de grant existente** (marca `redeemed`, `redeemedBookingId`, cobertura `free_service` →
  `finalAmount 0`). **Precedencia:** si aplica un paquete, se ignora cualquier código de
  descuento ingresado (una promo por reserva; el paquete gana).
- **Opt-out UI:** el funnel público, tras capturar el teléfono, consulta paquetes activos y
  muestra "Usar tu paquete (quedan N)" con un toggle default-on. La reserva manual (owner)
  muestra lo mismo al elegir la clienta.

### Ciclo de vida (reuso total)

- **Cancelación / no-show / reembolso de la reserva:** `releaseRedemptionForBooking` ya reactiva
  el grant (vuelve a `active`) — la sesión se recupera. Sin código nuevo.
- **Vencimiento:** `reconcileExpiredGrants` ya expira grants vencidos (los de paquete tienen
  `refundOnExpiry: false` → se pierden, sin devolver puntos). Sin código nuevo.
- **Saldo:** sesiones restantes = grants `active` de la compra; usadas = `redeemed`.

### Reembolso manual del paquete

`refundPackagePurchase(purchaseId)` (server action, owner) en una `$transaction`:
- Marca `PackagePurchase.status = 'refunded'`, `refundedAt`, `refundedAmount` (default: proporción
  de sesiones no usadas × precio/sesión, editable por la dueña).
- Cancela los grants `active` de la compra (`status: 'reversed'`, `reversedAt`). Los `redeemed`
  quedan intactos (sesiones ya entregadas).
- El movimiento de plata es out-of-band (la dueña reembolsa por su medio). Idempotente: si ya
  está `refunded`, no-op.

## UI (B4a)

- **Página "Paquetes"** (`/dashboard/paquetes`, nueva entrada en el sidebar): CRUD de
  `PackageProduct` (nombre, servicios/alcance, cantidad, bonus, precio, vencimiento, activo).
  Reusa el patrón de formularios del catálogo de canje.
- **Vender** desde el **detalle de la clienta** (panel): elegir producto + método de pago +
  confirmar → `sellPackage`. Muestra los paquetes activos de la clienta (sesiones restantes) con
  botón **Reembolsar**.
- **Reserva (pública + manual):** toggle "Usar tu paquete (quedan N)" cuando aplica.
- **"Mi tarjeta"** (`/tarjeta/[token]`): sección "Mis paquetes" con sesiones restantes y
  vencimiento.
- Todo currency-clean (`formatMoney`).

## Manejo de errores / edge cases

- Vender un producto inactivo o de otro negocio → error (scoped por `businessId`).
- `quantity ≥ 1`, `bonusQuantity ≥ 0`, `price ≥ 0`, `expiryDays > 0` o null (zod).
- Doble-submit de venta → `requestId` idempotente.
- Reserva con paquete + código a la vez → paquete gana (una promo/reserva).
- Cliente sin paquete o vencido → flujo normal (sin cobertura).
- Servicio no cubierto por el paquete → no se aplica.
- Concurrencia (dos reservas casi simultáneas consumiendo el último grant): el flip de grant es
  atómico (una reserva gana, la otra no encuentra grant aplicable) — reuso de la atomicidad
  existente.

## Testing

- **Unit:** `findApplicablePackageGrant` (elige por vencimiento, respeta alcance/estado);
  cálculo de `expiresAt` y del `refundedAmount` por prorrateo; emisión N+bonus grants; zod del
  producto.
- **Integración:** vender → N grants activos; consumir en reserva → 1 redeemed, saldo baja;
  cancelar la reserva → grant vuelve a activo; reembolsar → activos a reversed, redeemed intactos;
  vencer (reconcile) → expired.
- **e2e Playwright:** owner crea producto en "Paquetes" → vende a una clienta desde su panel →
  crea reserva manual del servicio cubierto → la reserva queda cubierta (finalAmount 0) y el saldo
  baja de N a N-1. (Fechas dentro de `bookingWindowDays`; targetear fila por nombre único;
  `test.setTimeout` amplio para el flujo largo — aprendizajes de e2e previos.)

## Migración (aditiva)

Tablas `PackageProduct`, `PackagePurchase`; columna `PromotionGrant.packagePurchaseId` + índice;
enum `PromotionTrigger` += `package`; relaciones inversas en `Business`/`Customer`/`Promotion`.
**Aplicar SOLO con OK explícito**, vía DIRECT_URL + `prisma db execute` del `.sql` (NUNCA
`migrate deploy`); si el `.sql` trae `zsh: command not found: _nvm_load` en la línea 1, borrarla.

## Reglas de repo

Módulos `'use server'` exportan solo funciones async; helpers module-local sin export. Todo
`revalidate*` con `await`. Currency-clean (`formatMoney`). Mantener la suite verde. No mergear
hasta OK explícito; PR al final.

## B4b (sub-proyecto siguiente — esbozo, NO en este ciclo)

- Generalizar `Payment`: `bookingId` → nullable + `purpose` (`booking`|`package`) +
  `packagePurchaseId?`. Ajustar el índice unique y `applyApprovedPayment`.
- Branch en el webhook MP: `external_reference`/metadata de propósito `package` → al `approved`,
  activar la `PackagePurchase` (emitir grants) en vez de confirmar reserva; refund → cancelar
  grants activos.
- **Página pública de compra** (tokenizada / atribución por teléfono-email, sin login) + checkout
  MP (reusa `PaymentProvider.createPayment` generalizado a referencia polimórfica).
- La venta manual de B4a puede, opcionalmente, empezar a crear filas `Payment` para reporte
  unificado (decisión de B4b).

## Fuera de alcance (futuro)

- Crédito por monto / stored-value → **B5 gift cards**.
- Compra online → **B4b**.
- Reembolso automático vía MP → fast-follow de B4b.
- Transferir/regalar un paquete a otra persona → B5.
