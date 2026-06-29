# Diseño — B2 · Canje de puntos (loyalty redemption)

> Rebanada **B2** de la iniciativa promociones + fidelización. Índice:
> `../2026-06-28-promotions-loyalty-roadmap.md`. Depende de **A** (motor de promos)
> y **B1** (núcleo de puntos), ambas mergeadas a `main`.

## Objetivo

Cerrar el lado de **gastar** puntos: la dueña define un **catálogo de canje**
(opciones "X puntos → tal recompensa"), la clienta **canjea** puntos por una
recompensa (que es una promo emitida puntualmente — un `PromotionGrant` con
código), y ese código se aplica a una reserva reusando el motor de A.

## Decisiones cerradas (no re-litigar)

1. **Enfoque A:** una opción de catálogo = una `Promotion(triggerType='granted')`
   con `pointsCost`. Canjear = descontar puntos + emitir `PromotionGrant`. Aplicar
   el grant a la reserva = extender `applyPromotionInTx`. Máximo reúso del motor de A.
2. **Superficie de canje:** clienta self-service desde "Mi tarjeta" (scopeada por
   `loyaltyToken`) **y** la dueña desde el panel de la clienta. El grant lleva un
   **código al portador** que viaja por el mismo campo `promotionCode` de la reserva
   (pública y manual) — sin tocar esos flujos.
3. **Puntos se descuentan al canjear** (asiento negativo `redemption`), no al
   reservar. El stock de la opción (`maxRedemptions`) **se consume al canjear**.
4. **Vencimiento configurable** (`grantExpiryDays`: override por opción → default del
   negocio → `null` = no vence). Al vencer sin usarse: si `refundOnExpiry`, se
   **reembolsan** los puntos (`redemption_reversal`); si no, se pierden. Default del
   negocio: **reembolsa** (`refundPointsOnExpiry @default(true)`).
5. **Release grant-aware:** al cancelarse/liberarse una reserva con grant aplicado,
   la recompensa **se reactiva** (la clienta la recupera). En `no_show` también se
   reactiva por default (perder la reserva ya es castigo); flag
   `forfeitGrantOnNoShow @default(false)` para la dueña estricta.
6. **Snapshot de políticas en el grant:** `expiresAt`, `refundOnExpiry` y
   `forfeitOnNoShow` se congelan en el `PromotionGrant` al emitirlo. Cambiar la config
   después no altera retroactivamente la promesa hecha a la clienta.
7. **Código al portador:** `customerId` del grant es trazabilidad del redentor, no
   reja (evita matcheo de identidad frágil pre-D). Quien tiene el código lo usa, como
   un código de promo.
8. **Reconciliación de vencidos lazy** (sin cron): corre en toda superficie que
   muestre saldo (Mi tarjeta, panel, y al inicio de cada canje). Limitación conocida:
   una clienta totalmente inactiva no recibe su reembolso hasta volver. Cron de barrido
   = follow-up de ops (no hay infra de cron hoy).
9. **Pausa global:** con `LoyaltyConfig.isActive=false` no se puede canjear y el
   catálogo se oculta en Mi tarjeta.
10. **Una promo por reserva:** grant y código son mutuamente excluyentes por reserva
    (comparten el único campo `promotionCode`). Se preserva la invariante de A.
11. **Notificación de confirmación de canje → se difiere a C (campañas).** En B2 el
    código se muestra en Mi tarjeta apenas se canjea.

## Cambios de schema (migración aditiva)

### `enum LoyaltyReason`
Sumar `redemption` y `redemption_reversal`:
```prisma
enum LoyaltyReason {
  visit
  visit_reversal
  adjustment
  redemption
  redemption_reversal
}
```

### `enum GrantStatus` (nuevo)
```prisma
enum GrantStatus {
  active      // emitido, sin usar
  redeemed    // aplicado a una reserva
  expired     // venció sin reembolso
  reversed    // venció y se reembolsaron los puntos
}
```

### `Promotion` (sumar columnas, no romper A)
```prisma
  pointsCost      Int?     // si está seteado y triggerType='granted' => opción de catálogo
  grantExpiryDays Int?     // override del vencimiento para grants de esta opción
```

### `LoyaltyConfig` (sumar columnas)
```prisma
  grantExpiryDays      Int?     // default del negocio; null = no vence
  refundPointsOnExpiry Boolean  @default(true)
  forfeitGrantOnNoShow Boolean  @default(false)
```

### `PromotionGrant` (nuevo modelo)
```prisma
model PromotionGrant {
  id                String      @id @default(cuid())
  businessId        String
  promotionId       String
  customerId        String
  code              String
  pointsSpent       Int
  status            GrantStatus @default(active)
  expiresAt         DateTime?
  refundOnExpiry    Boolean     // snapshot de LoyaltyConfig al emitir
  forfeitOnNoShow   Boolean     // snapshot de LoyaltyConfig al emitir
  requestId         String      // idempotencia del canje (nonce por render)
  redeemedBookingId String?     @unique
  redeemedAt        DateTime?
  reversedAt        DateTime?
  metadata          Json?
  createdByUserId   String?
  createdAt         DateTime    @default(now())

  business  Business  @relation(fields: [businessId], references: [id], onDelete: Cascade)
  promotion Promotion @relation(fields: [promotionId], references: [id])
  customer  Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@unique([businessId, code])
  @@unique([customerId, requestId])   // idempotencia anti doble-click
  @@index([customerId, status])
  @@index([businessId, promotionId])
}
```
Relaciones inversas: `Promotion.grants PromotionGrant[]`, `Customer.loyaltyGrants
PromotionGrant[]`, `Business.promotionGrants PromotionGrant[]`.

**Nota sobre `LoyaltyLedger.@@unique([bookingId, reason])`:** los asientos
`redemption`/`redemption_reversal` tienen `bookingId = null`. En Postgres los NULL
son distintos en un índice único, así que múltiples asientos `(null, 'redemption')`
para la misma clienta conviven sin violar la restricción. La trazabilidad al grant
va en `metadata.grantId`.

## Módulos nuevos / modificados

### `src/lib/loyalty/redeem.ts` (nuevo)
`redeemForGrant(tx, args)` — núcleo transaccional del canje. **Asume estar dentro de
una `$transaction`** (la action provee el lock). Orden:

```
args: { businessId, customerId, promotion (con services), config, requestId,
        createdByUserId, now }
1. await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${customerId}))`
2. IDEMPOTENCIA (antes de tocar stock/saldo): existing = findUnique grant por
   (customerId, requestId). if (existing) return existing  // canje ya hecho
3. reconcileExpiredGrants(tx, customerId, businessId)   // saldo fresco
4. balance = sum(points) de LoyaltyLedger (customerId, businessId)
5. validar opción: promotion.triggerType==='granted' && promotion.isActive &&
   promotion.pointsCost != null  (else throw 'La recompensa no está disponible')
   - tope por clienta (maxPerCustomer): count de grants (status active|redeemed)
     de esta promo+clienta < maxPerCustomer  (bajo el lock => seguro)
6. if (balance < promotion.pointsCost) throw 'No tienes puntos suficientes'
7. stock atómico (NO depende del lock per-customer):
   - maxRedemptions == null  => update redemptionCount: { increment: 1 }
   - else updateMany({ where: { id, redemptionCount: { lt: maxRedemptions } },
                       data: { redemptionCount: { increment: 1 } } })
     if (count === 0) throw 'La recompensa se agotó'
8. expiresAt = now + (promotion.grantExpiryDays ?? config.grantExpiryDays) días
   (si ambos null => null)
9. grant = create PromotionGrant({ ...snapshots refundOnExpiry/forfeitOnNoShow,
     code: generado único, pointsSpent: pointsCost, requestId, status: active })
10. create LoyaltyLedger({ points: -pointsCost, reason: 'redemption',
     metadata: { grantId: grant.id, promotionId }, createdByUserId })
11. return grant
```
**Idempotencia (paso 2):** el chequeo de existencia por `(customerId, requestId)`
corre **antes** del incremento de stock, bajo el advisory lock que serializa los
canjes de la misma clienta — así un doble-click no llega a incrementar stock dos
veces. El `@@unique([customerId, requestId])` + catch P2002 en el `create` (paso 9)
es defensa en profundidad: ante esa carrera la tx entera hace rollback (incl. el
incremento) y la action reintenta leyendo el grant existente.

`generateGrantCode(tx, businessId)` — código normalizado (base32 Crockford, sin
chars ambiguos, ~10 chars). Verifica colisión contra `promotion.code` **y**
`promotionGrant.code` del negocio; reintenta ante `@@unique([businessId, code])`.
Devuelve ya normalizado (mismo `normalizeCode` que A aplica al input).

### `src/lib/loyalty/grant.ts` (nuevo)
`reconcileExpiredGrants(tx, customerId, businessId)` — flip atómico de vencidos,
idempotente:
```
for cada grant active con expiresAt < now (o resolver en lote con updateMany):
  reversed-path (refundOnExpiry=true):
    flipped = updateMany({ where:{ id, status:'active', expiresAt:{ lt: now } },
                           data:{ status:'reversed', reversedAt: now } })
    if (flipped.count === 1) create LoyaltyLedger({ points:+pointsSpent,
        reason:'redemption_reversal', metadata:{ grantId } })
  expired-path (refundOnExpiry=false):
    updateMany({ where:{ id, status:'active', expiresAt:{ lt: now } },
                 data:{ status:'expired' } })   // sin asiento
```
El guard `updateMany` garantiza que sólo la llamada que hace el flip inserta el
reembolso → idempotente aunque dos reconciliaciones corran a la vez. (Implementación:
seleccionar los `active` vencidos y procesarlos uno a uno con el guard, leyendo
`refundOnExpiry`/`pointsSpent`/`id` de cada grant.)

`reconcileExpiredGrants` debe poder correr con un `tx` o con el `prisma` global
(firma `TxLike`, como `releaseRedemptionForBooking`).

### `src/lib/promotions/apply.ts` (modificar `applyPromotionInTx`)
Antes del lookup de promo por código, intentar resolver un **grant**:
```
const code = normalizeCode(args.code); if (!code) return null
const grant = await tx.promotionGrant.findFirst({
  where: { businessId, code, status: 'active' },
  include: { promotion: { include: { services: { select: { id: true } } } } },
})
if (grant) {
  const p = grant.promotion
  if (grant.expiresAt && (args.now ?? new Date()) > grant.expiresAt)
    throw new Error('La recompensa venció')
  // scope + minSpend (stock y tope ya se consumieron al canjear => no se revalidan;
  // tampoco se exige p.isActive: la clienta ya pagó los puntos, se honra)
  if (!p.appliesToAll && !p.services.some(s => s.id === args.serviceId))
    throw new Error('La recompensa no aplica a este servicio')
  if (p.minSpend != null && args.totalPrice < p.minSpend)
    throw new Error('La recompensa requiere un monto mínimo')
  const discount = computeDiscount(
    { ...p, serviceIds: p.services.map(s => s.id) }, args.totalPrice)
  // flip atómico anti doble-aplicación concurrente:
  const flipped = await tx.promotionGrant.updateMany({
    where: { id: grant.id, status: 'active' },
    data: { status: 'redeemed', redeemedBookingId: args.bookingId, redeemedAt: new Date() },
  })
  if (flipped.count === 0) throw new Error('La recompensa ya fue usada')
  await tx.promotionRedemption.create({ data: {
    businessId, promotionId: p.id, bookingId: args.bookingId, customerId: args.customerId,
    discountAmount: discount, source: args.source, createdByUserId: args.createdByUserId ?? null,
  } })  // NO se incrementa redemptionCount (consumido al canjear)
  return { discountAmount: discount, promotionId: p.id }
}
// ...else: camino actual de promo por código (triggerType:'code'), sin cambios
```

### `src/lib/promotions/release.ts` (modificar `releaseRedemptionForBooking`)
Tras encontrar el `PromotionRedemption` y antes del decremento, cargar el
`triggerType` de la promo. Si es `granted`:
```
// NO decrementar redemptionCount (el stock se consumió al canjear, no al aplicar)
// (sigue flippeando applied->released con su guard atómico, como hoy)
const grant = await tx.promotionGrant.findFirst({ where: { redeemedBookingId: bookingId } })
if (!grant) return
const expired = grant.expiresAt && new Date() > grant.expiresAt
if (reason === 'no_show' && grant.forfeitOnNoShow) {
  return  // se pierde: queda 'redeemed', no se reactiva
}
if (expired) {
  // reactivar sobre un grant vencido => aplicar política de vencimiento
  if (grant.refundOnExpiry) {
    const flipped = await tx.promotionGrant.updateMany({
      where: { id: grant.id, status: 'redeemed' }, data: { status: 'reversed', reversedAt: new Date() } })
    if (flipped.count === 1) await tx.loyaltyLedger.create({ data: {
      businessId: grant.businessId, customerId: grant.customerId, points: grant.pointsSpent,
      reason: 'redemption_reversal', metadata: { grantId: grant.id } } })
  } else {
    await tx.promotionGrant.updateMany({ where: { id: grant.id, status: 'redeemed' }, data: { status: 'expired' } })
  }
  return
}
// caso normal: reactivar la recompensa
await tx.promotionGrant.updateMany({
  where: { id: grant.id, status: 'redeemed', redeemedBookingId: bookingId },
  data: { status: 'active', redeemedBookingId: null, redeemedAt: null },
})
```
Los call sites existentes (cancelación dashboard, no-show, refund MP, hold_expired)
quedan sin cambios — heredan el comportamiento.

### `src/lib/loyalty/schema.ts` (modificar)
- `loyaltyConfigSchema`: sumar `grantExpiryDays: optPositiveInt`,
  `refundPointsOnExpiry: z.boolean().optional().default(true)`,
  `forfeitGrantOnNoShow: z.boolean().optional().default(false)`.
- Nuevo `redemptionOptionSchema` (opción de catálogo):
  ```
  name (1..60), rewardType ('percentage'|'fixed_amount'|'free_service'),
  rewardValue (int >0; para percentage 1..100), maxDiscount (optPositiveInt),
  pointsCost (int >0), appliesToAll (boolean), serviceIds (string[] opcional),
  grantExpiryDays (optPositiveInt), maxRedemptions (optPositiveInt),
  maxPerCustomer (optPositiveInt), isActive (boolean)
  ```
  `.strip()`. Reusa la validación de recompensa de A donde aplique.
- Nuevo `redeemSchema`: `{ optionId: string.min(1), requestId: string.min(1) }`.

### `src/lib/loyalty/view.ts` (modificar)
Sumar labels: `redemption: 'Canje'`, `redemption_reversal: 'Reembolso de canje'`.
Helper `canAfford(balance, pointsCost): boolean`.

### `src/server/actions/loyalty.ts` (sumar actions, todas async)
- `listRedemptionOptions()` — owner; promos `granted` del negocio (catálogo).
- `upsertRedemptionOption(data)` — owner (`requireBusinessRole(['owner','admin'])`,
  rate-limit); valida con `redemptionOptionSchema`; crea/actualiza una
  `Promotion(triggerType='granted', pointsCost, grantExpiryDays, ...)`; `revalidatePath`.
- `archiveRedemptionOption(id)` — owner; `isActive=false` (no hard-delete: hay grants
  emitidos que la referencian).
- `redeemPointsAsOwner(customerId, optionId, requestId)` — owner; resuelve clienta
  (scoping por `businessId`), carga opción+config, corre `redeemForGrant` en
  `$transaction`; `revalidatePath` del panel.
- `redeemPointsAsCustomer(loyaltyToken, optionId, requestId)` — público; resuelve
  clienta por token (`resolveLoyaltyCustomer`), exige `config.isActive`, corre
  `redeemForGrant`; `revalidatePath('/tarjeta/[token]')`. Rate-limit por token.
- `getCustomerLoyalty` (modificar) — reconciliar vencidos primero; devolver además
  `grants` activos (con código + `expiresAt`) y el `catalog` (opciones disponibles).

Todas reusan el patrón de B1: `requireBusinessRole`/token, `checkRateLimit`,
validación zod, errores con mensajes claros.

## Superficies (UI)

### `/dashboard/fidelizacion` — sección "Catálogo de canje"
CRUD de opciones (cada una = promo `granted`). Campos: nombre, recompensa
(%/fijo/servicio gratis + valor + tope), `pointsCost`, alcance (todos / servicios),
vencimiento (días, opcional), stock (`maxRedemptions` opcional), tope por clienta
(`maxPerCustomer` opcional), activa. La sección de config de acumulación de B1 suma
los 3 toggles nuevos (`grantExpiryDays`, `refundPointsOnExpiry`, `forfeitGrantOnNoShow`).

**Integración con A:** la UI de promos por código de A debe filtrar su listado a
`triggerType='code'` para no mezclar opciones de catálogo. Tarea explícita en el plan.

### Panel de clienta (`src/app/dashboard/customers/[id]/loyalty-panel.tsx`)
Suma: lista del catálogo con botón **Canjear** por opción (deshabilitado si no
alcanza), y lista de **grants activos** de la clienta (código + vencimiento). El
canje genera un `requestId` (nonce) en el cliente y llama `redeemPointsAsOwner`.

### Mi tarjeta (`src/app/tarjeta/[token]/page.tsx`)
- Reconciliar vencidos al renderizar.
- Sección **Canjear**: opciones del catálogo (las que alcanza, las demás grisadas).
  Cada una es un `form` con `action` server-side que pasa `token` + `optionId` +
  `requestId` (hidden, generado en el server al renderizar) → `redeemPointsAsCustomer`.
  Oculta si `config.isActive=false`.
- Sección **Mis recompensas**: grants activos con código destacado + vencimiento.
- Movimientos: ya muestra los nuevos `reason` vía `loyaltyReasonLabel`.

### `previewPromotion` (de A) — grant-aware
Extender para que, dado un código que es un grant activo, devuelva el descuento/estado
(válido / venció / no aplica al servicio) → la clienta lo ve **antes** de enviar la
reserva, en vez de un fallo duro. Reusa la misma resolución que `applyPromotionInTx`
(versión read-only, sin flip).

## Casos borde cubiertos (resumen)

- Doble-aplicación concurrente del mismo grant → flip atómico `active→redeemed` +
  `redeemedBookingId @unique`.
- Stock compartido entre clientas → incremento condicional atómico (no el lock).
- Doble-click en canjear → `@@unique([customerId, requestId])` + catch P2002 idempotente.
- Reembolso varado de clienta inactiva → reconciliación en toda superficie de saldo +
  limitación documentada + cron como follow-up.
- Config cambiada después de emitir → snapshots en el grant.
- Programa pausado → no canjea, catálogo oculto.
- Grant vencido aplicado a reserva → rechazado en apply y en preview.
- Reserva con grant cancelada/refund/hold_expired → reactiva; `no_show` reactiva
  salvo `forfeitOnNoShow`; reactivación sobre grant ya vencido → aplica política de
  vencimiento.
- Colisión de namespace código/grant → generador low-collision + resolución grant-first.

## Estrategia de tests

### Unit (Vitest, `tests/unit/*.test.ts`)
- `redeem.test.ts`: gates de saldo / stock agotado / tope por clienta; inserta asiento
  negativo + grant; presencia del advisory lock; idempotencia por `requestId` (P2002);
  cálculo de `expiresAt` (override > config > null).
- `grant-reconcile.test.ts`: refund on → `reversed` + asiento; refund off → `expired`
  sin asiento; idempotente ante doble corrida.
- `apply-grant.test.ts` (sobre `applyPromotionInTx`): rama grant activo aplica y marca
  `redeemed` sin incrementar `redemptionCount`; vencido → throw; ya usado → throw;
  fuera de scope / `minSpend` → throw; descuento vía `computeDiscount`.
- `release-grant.test.ts`: `granted` no decrementa `redemptionCount`; reactiva en
  `cancelled`; `no_show` con `forfeitOnNoShow` no reactiva; reactivación sobre vencido
  aplica política.
- `redemption-schema.test.ts`: `redemptionOptionSchema` (pointsCost>0, percentage
  1..100), `redeemSchema`.
- `loyalty-view.test.ts`: labels nuevos + `canAfford`.

### e2e (Playwright, validación one-off como en B1)
Config opción de catálogo → canjear en Mi tarjeta (saldo baja, aparece grant con
código) → reservar usando ese código (descuento aplicado, grant `redeemed`) →
cancelar la reserva (grant reactivado a `active`). Auth-bypass por headers (mismo
mecanismo que B1, sin tipear contraseñas).

## Fuera de alcance (B2)

- Notificación de confirmación de canje (→ C).
- Cron de barrido de vencidos (→ ops/B3).
- Panel de pasivo de grants para la dueña (opcional, no-core).
- Auto-aplicación del grant sin código por identidad de clienta (→ D/login).
- Sellos / niveles / insignias / rachas (→ B4).
