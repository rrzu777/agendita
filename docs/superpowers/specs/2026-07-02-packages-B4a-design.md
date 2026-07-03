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
  (`free_service`, `pointsSpent 0`, `packagePurchaseId`). El **flip atómico**, la **reactivación
  en cancelación** y el **vencimiento** reusan el engine; lo NUEVO es la **selección** por
  (clienta, servicio) — no existe hoy (el consumo es solo-por-código).
- **Promo de respaldo = una `Promotion` marcador por negocio con `triggerType 'granted'`** (NO un
  enum nuevo `package`: la reactivación del grant en `release.ts:28` rutea por `'granted'`). La
  **cobertura sale del snapshot de la compra**, no de la promo (que es appliesToAll), así editar un
  producto no altera paquetes ya vendidos.
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
  opcional), `appliesToAll` (Bool) + relación `services` (alcance), `isActive` (Bool), auditoría +
  timestamps.
- **`PackagePurchase`** (una venta): `id`, `businessId`, `customerId`, `packageProductId`,
  `pricePaid` (Int), `quantity` (Int), `bonusQuantity` (Int) — **snapshot** de la compra —,
  **snapshot del alcance** `coversAll` (Bool) + `coveredServiceIds` (String[]) —, `source`
  (`'manual'` | `'online'`), `paymentMethod` (String?, ej. efectivo/transferencia/tarjeta — para
  `manual`), `paidAt` (DateTime), `status` (`active`|`refunded`), `expiresAt` (DateTime?),
  `refundedAt` (DateTime?), `refundedAmount` (Int?), auditoría + timestamps.
- **`PromotionGrant`** += `packagePurchaseId` (String?, FK) + índice. Los grants de paquete se
  distinguen por tener `packagePurchaseId` **no nulo**.

**Promotion de respaldo (una compartida por negocio, NO por producto).** Los grants exigen un
`promotionId`. Se usa **una** `Promotion` marcador por negocio, creada lazily: `triggerType:
'granted'` (⚠️ **reusar `'granted'`, NO agregar un enum `package`**: `releaseRedemptionForBooking`
rutea la reactivación del grant por `triggerType === 'granted'` en `release.ts:28`; un valor nuevo
tomaría la rama de código-promo y **no** reactivaría el grant en cancelación/no-show), `rewardType:
'free_service'`, `appliesToAll: true`, `pointsCost: null` (→ excluida de `redemptionOptionWhere` y
del catálogo de la tarjeta, que filtran `pointsCost not null`), nombre/metadata marcador
(`package-coverage`). **La cobertura real de cada grant NO sale de esta promo** (que es
appliesToAll) sino del **snapshot de la `PackagePurchase`** (`coversAll`/`coveredServiceIds`),
chequeado en la selección (`findApplicablePackageGrant`). Así, editar el alcance de un
`PackageProduct` **no** cambia la cobertura de paquetes ya vendidos; solo afecta ventas futuras.
La reward `free_service` cubre el precio del servicio de la reserva (→ `finalAmount 0`) sin
depender de `serviceIds`.

**Sin cambios en el enum `PromotionTrigger`.**

### Emisión de grants al vender

`sellPackage` (server action, owner) en una `$transaction`:
1. Resuelve/crea la `Customer` por teléfono (normalizado, patrón de la reserva).
2. Crea `PackagePurchase` (`source: 'manual'`, `pricePaid`, `paymentMethod`, `paidAt: now`,
   `status: 'active'`, `expiresAt: expiryDays ? now + expiryDays : null`).
3. Emite `quantity + bonusQuantity` `PromotionGrant` (`promotionId` = el marcador del negocio,
   `code` único por grant, `pointsSpent: 0`, `status: 'active'`, `expiresAt` = el de la compra,
   `refundOnExpiry: false`, `forfeitOnNoShow: false`, `packagePurchaseId`).
   - **Idempotencia — `requestId` DISTINTO por grant.** `@@unique([customerId, requestId])`
     (`schema.prisma:664`) permite **un** grant por `requestId`; N grants con el mismo `requestId`
     rompen en el 2º insert (P2002 → aborta la tx). Derivar `requestId = \`${saleRequestId}#${i}\``
     (determinista, i=0..N-1) → un reintento de la misma venta colisiona idempotentemente en cada
     una de las N filas.

### Consumo en la reserva (auto-select + reuso del flip)

**No existe hoy un path de aplicación por (clienta, servicio):** `applyPromotionInTx` es
**solo-por-código** (`apply.ts:16`, `if (!code) return null`; resuelve el grant por `code`). Hay
que escribir un entry point nuevo — **no** sobrecargar el parámetro `code`.

- `findApplicablePackageGrant(tx, businessId, customerId, serviceId)`: devuelve el grant
  `status: 'active'`, **`packagePurchaseId` no nulo**, cuya `PackagePurchase` es `active`, **no
  vencida** (`expiresAt IS NULL OR expiresAt >= now`, chequeado en la query — **no** depender de
  que el reconcile lazy haya corrido) y cuyo **snapshot** cubre el `serviceId` (`coversAll` o
  `serviceId ∈ coveredServiceIds`). Ordena por `expiresAt` asc (usa antes lo que vence antes;
  nulls al final).
- `applyPackageInTx(tx, { businessId, customerId, serviceId, bookingId, totalPrice, ... })` (nuevo):
  selecciona el candidato, hace el **flip atómico** (`updateMany({ where: { id, status: 'active' },
  data: { status: 'redeemed', redeemedBookingId, redeemedAt } })` con guard `count === 1`, igual
  que `apply.ts:38-42`) y **crea una `PromotionRedemption`** (bookingId, promotionId = marcador,
  discountAmount = totalPrice) — esto es lo que hace que `releaseRedemptionForBooking` (rama
  `'granted'`) reactive el grant en cancelación. Devuelve `{ discountAmount, packagePurchaseId }`.
- **Precedencia en `bookings.ts` (pública + manual):** ANTES de aplicar promos, si `usePackage`
  (default true) y hay grant aplicable → aplicar el paquete y **saltear `applyPromotionInTx`**
  (ignorar el `promotionCode` ingresado). El paquete gana (una promo por reserva; `@@unique
  ([bookingId])` en `PromotionRedemption`, `schema.prisma:633`).
- **Recálculo compartido (evita el bug de depósito):** hoy el bloque que recomputa
  `finalAmount/depositRequired/status/paymentStatus` está **gateado a que `applyPromotionInTx`
  devuelva no-null** (`bookings.ts:321`, público; `816-846`, manual). Extraer ese bloque a un
  helper **`recomputeAmountsAfterDiscount(booking, discountAmount)`** y llamarlo también cuando
  aplica un paquete; si no, la reserva cubierta quedaría en `finalAmount = price` /
  `pending_payment` y **pediría depósito**. La UI de "$0 sin pago" ya existe
  (`step-payment.tsx:86-89,244-247`) y se reusa.
- **Opt-out UI:** el teléfono se conoce en el paso de **Pago** del funnel (`StepPayment`,
  `wizard.tsx` paso 4→5); ahí una nueva action `getActivePackagesForCustomer(businessId, phone,
  serviceId)` (patrón de `previewPromotion`) alimenta el toggle **"Usar tu paquete (quedan N)"**
  (default-on). El estado del opt-out se agrega a `BookingData` + a `createBookingSchema`
  (`skipPackage?`). La reserva manual (form paralelo servicio/cliente) lo muestra reactivo cuando
  ambos están seteados.

### Ciclo de vida (reuso del engine)

- **Cancelación / no-show / reembolso de la reserva:** `releaseRedemptionForBooking` reactiva el
  grant a `active` **porque la promo marcador es `triggerType 'granted'`** (`release.ts:28`) — la
  sesión se recupera. Sin código nuevo (dado el reuso de `'granted'`).
- **Vencimiento:** `reconcileExpiredGrants` expira grants vencidos con `refundOnExpiry: false` sin
  devolver puntos (`grant.ts:37-43`). Es **lazy per-cliente** (sin cron) → las queries de saldo
  filtran `expiresAt` en el WHERE, no confían en que el reconcile haya corrido.
- **Saldo:** sesiones restantes = grants `active` **y no vencidos** de la compra; usadas =
  `redeemed`.

### Grants de paquete FUERA de las listas de recompensas (fix de fuga)

Las dos listas de grants existentes (`tarjeta/[token]/page.tsx:53-57` "Mis recompensas" y
`getCustomerLoyalty` `loyalty.ts:153-157`, panel) consultan `status: 'active'` **sin** filtrar por
tipo → mostrarían cada sesión de paquete como una tarjeta de recompensa con **código canjeable
suelto**. Ambas queries deben agregar **`packagePurchaseId: null`**. Los paquetes se muestran
aparte, agrupados por compra, en su propia sección "Mis paquetes" (tarjeta) y en el panel de la
clienta.

### Reembolso manual del paquete

`refundPackagePurchase(purchaseId)` (server action, owner) en una `$transaction`:
- Marca `PackagePurchase.status = 'refunded'`, `refundedAt`, `refundedAmount`.
- **Default del monto** (editable por la dueña): `min(pricePaid, round(usosNoUsados × pricePaid /
  (quantity + bonusQuantity)))`. Denominador = total de sesiones (pagadas + bonus), así el
  reembolso nunca supera `pricePaid` (usosNoUsados ≤ total). Trata todas las sesiones por igual;
  como es editable, la exactitud fina no bloquea.
- Cancela los grants `active` (no vencidos) de la compra (`status: 'reversed'`, `reversedAt`). Los
  `redeemed`/`expired` quedan intactos (sesiones ya entregadas o perdidas).
- El movimiento de plata es out-of-band (la dueña reembolsa por su medio). Idempotente: si ya está
  `refunded`, no-op.

### Puntos de fidelización en una visita cubierta (decisión)

Una visita cubierta por paquete tiene `finalAmount 0`. `computeEarnedPoints` (`earn.ts`) igual
otorga `pointsPerVisit` (fijo, independiente del monto); los puntos por gasto son 0 (`floor(0 /
spendPerPoint)`). **Decisión: se deja así** — la visita ocurrió y la clienta ya pagó el paquete en
dinero, así que gana sus puntos por visita; sin puntos por gasto (no hubo gasto en esta reserva).
Interacción de config a documentar: si el negocio setea `minSpendToEarn > 0`, una visita de gasto
0 cae bajo el mínimo y **no** gana nada — comportamiento aceptable (sin gasto, sin acreditación).
Sin special-casing en B4a.

### Finanzas / reporte (limitación documentada de B4a)

Toda la capa de finanzas es **booking-keyed**: `LedgerEntry` exige `bookingId`
(`finance.ts:197-213`), y `getFinancialSummary` (`ledger.ts:85-134`) + el export CSV agregan solo
`LedgerEntry`/`Payment`. La plata de la venta de paquete vive en `PackagePurchase` (no toca
`Payment`), así que **B4a no la muestra en "Pagos y finanzas" ni en el ledger/CSV**. Es aceptable
para B4a **siempre que se documente y** la página **Paquetes** muestre su propio **total de ventas
de paquetes** (y por producto). El ledger unificado (Payment con `purpose`) es tamaño-B4b.

## UI (B4a)

- **Página "Paquetes"** (`/dashboard/paquetes`, nueva entrada en el sidebar): CRUD de
  `PackageProduct` (nombre, servicios/alcance, cantidad, bonus, precio, vencimiento, activo) +
  un **total de ventas de paquetes** (y por producto), ya que esta plata NO aparece en "Pagos y
  finanzas" en B4a (ver Finanzas). Reusa el patrón de formularios del catálogo de canje.
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
- Doble-submit de venta → `requestId` **por-grant** (`#i`) idempotente (colisiona por fila).
- Reserva con paquete + código a la vez → paquete gana (una promo/reserva; se saltea el código).
- Cliente sin paquete o vencido → flujo normal (sin cobertura).
- Servicio no cubierto por el **snapshot** de la compra → no se aplica.
- Editar el alcance/precio de un `PackageProduct` → **no** afecta compras previas (snapshot en
  `PackagePurchase`); solo ventas futuras. Desactivar un producto no invalida paquetes ya vendidos
  (se honra lo prepago).
- Concurrencia (dos reservas casi simultáneas consumiendo el último grant): el flip de grant es
  atómico (una reserva gana, la otra no encuentra grant aplicable) — reuso de la atomicidad
  existente.

## Testing

- **Unit:** `findApplicablePackageGrant` (elige por vencimiento; respeta snapshot de alcance,
  estado, y **filtro `expiresAt >= now` en la query**); default de `refundedAmount` (prorrateo con
  denominador quantity+bonus, tope pricePaid); `requestId` por-grant `#i` distinto; zod del
  producto.
- **Integración (los blockers que casi rompen la rebanada):**
  - vender → N grants activos con `requestId` distintos (no P2002);
  - consumir en reserva → 1 `redeemed`, `PromotionRedemption` creada, saldo baja, `finalAmount 0`
    **y sin depósito** (verifica el recálculo compartido);
  - **cancelar/no-show la reserva → el grant de paquete vuelve a `active`** (verifica que la promo
    marcador `'granted'` rutea bien en `release.ts`);
  - reembolsar → activos a `reversed`, `redeemed` intactos;
  - vencer → `expired` sin devolver puntos;
  - **fuga:** los grants de paquete NO aparecen en `getCustomerLoyalty`/tarjeta "Mis recompensas"
    (filtro `packagePurchaseId: null`);
  - precedencia: reserva con paquete + código → gana el paquete, sin P2002.
- **e2e Playwright:** owner crea producto en "Paquetes" → vende a una clienta desde su panel →
  crea reserva manual del servicio cubierto → la reserva queda cubierta (finalAmount 0, sin
  depósito) y el saldo baja de N a N-1. (Fechas dentro de `bookingWindowDays`; targetear fila por
  nombre único; `test.setTimeout` amplio — aprendizajes de e2e previos.)

## Migración (aditiva)

Tablas `PackageProduct` (+ relación `services`), `PackagePurchase` (con snapshot
`coversAll`/`coveredServiceIds`/`quantity`/`bonusQuantity`); columna
`PromotionGrant.packagePurchaseId` + índice; relaciones inversas en `Business`/`Customer`.
**Sin cambios de enum** (la promo marcador reusa `triggerType 'granted'`). **Aplicar SOLO con OK
explícito**, vía DIRECT_URL + `prisma db execute` del `.sql` (NUNCA `migrate deploy`); si el
`.sql` trae `zsh: command not found: _nvm_load` en la línea 1, borrarla.

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
