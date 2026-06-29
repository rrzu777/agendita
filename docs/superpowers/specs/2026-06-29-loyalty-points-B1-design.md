# B1 · Núcleo de puntos (fidelización) — Design

> **Sub-rebanada de B.** Primera de la descomposición de B (fidelización/gamificación).
> Hermanas (briefs hijos, después): B2 canje · B3 condiciones automáticas · B4 gamificación derivada.
> Índice: `../2026-06-28-promotions-loyalty-roadmap.md` · Memoria: `[[promotions-loyalty-initiative]]`

**Fecha:** 2026-06-29 · **Estado:** diseñado (este spec) → siguiente: writing-plans.

## Objetivo

Capa de **puntos** montada sobre el dominio existente: un negocio prende un programa de
fidelización, sus clientas **acumulan puntos** al completar reservas, y cada clienta ve su
saldo e historial por un **link mágico "Mi tarjeta"** (sin login hasta D). La dueña configura
el programa y puede **ajustar puntos manualmente**. Los puntos son la **moneda base** de la
gamificación (sellos/niveles/insignias se derivarán en B4); B1 solo entrega el cimiento:
acumular + ver.

## Arquitectura

- **Saldo = `sum(LoyaltyLedger.points)`**, nunca un contador mutable. Ledger **append-only**
  (misma filosofía server-authoritative de A: la historia es inmutable y auditable).
- **Todo anclado a `Customer.id`**, no al token. El `loyaltyToken` es solo *una forma de
  resolver* la clienta → cuando llegue D (login) se agrega una segunda vía de resolución
  sobre el mismo `customerId`, sin migrar datos. Helper `resolveLoyaltyCustomer()` para que D
  solo le sume un branch.
- **Earn server-authoritative**: el crédito se calcula y persiste dentro de la misma
  transacción donde la reserva entra a `completed`.
- **Reuso**: se apoya en el patrón de link mágico ya probado (`reviewToken`), en el hook de
  `completed` de `updateBookingStatus`, y en el `$transaction` del webhook de MP donde A ya
  libera el canje.

## Alcance

**Dentro (B1):**
- `LoyaltyConfig` (config por negocio) + `LoyaltyLedger` (append-only) + `Customer.loyaltyToken`.
- Motor puro `computeEarnedPoints`.
- Earn al completar reserva (público + dashboard), idempotente.
- Clawback (reversa) al reembolsar una reserva completada.
- Ajuste manual de puntos por la dueña.
- "Mi tarjeta" pública (read-only): saldo + historial.
- Link de "Mi tarjeta" en notificaciones de confirmación y completada.
- Página de config en dashboard + saldo/historial/ajuste en el detalle de clienta.

**Fuera (otras sub-rebanadas / YAGNI):**
Canje / `PromotionGrant` (B2) · sellos / niveles / insignias / rachas (B4) · cumpleaños /
win-back / referidas / reseña→premio (B3) · **expiración de puntos** · paquetes prepagados ·
backfill retroactivo al prender el programa · reporting/analytics de puntos.

## Modelo de datos

Tres cambios de schema + un enum.

```prisma
enum LoyaltyReason {
  visit            // +puntos al completar una reserva
  visit_reversal   // -puntos al reembolsar una reserva ya acreditada (clawback)
  adjustment       // ±puntos manual por la dueña
}

model LoyaltyConfig {
  id            String   @id @default(cuid())
  businessId    String   @unique
  isActive      Boolean  @default(false)
  programName   String   // ej. "Puntos Mismoxita"
  pointsPerVisit Int     @default(0)   // puntos fijos por reserva completada
  spendPerPoint Int?                    // "cada $X = 1 punto"; null/0 = off
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  business      Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
}

model LoyaltyLedger {
  id              String        @id @default(cuid())
  businessId      String
  customerId      String
  points          Int           // delta con signo (puede ser negativo)
  reason          LoyaltyReason
  bookingId       String?       // set en visit / visit_reversal; null en adjustment
  note            String?       // nota de la dueña en adjustment
  metadata        Json?         // desglose de trazabilidad (ver abajo)
  createdByUserId String?       // dueña/admin en adjustment; null en eventos automáticos
  createdAt       DateTime      @default(now())

  business        Business  @relation(fields: [businessId], references: [id], onDelete: Cascade)
  customer        Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
  booking         Booking?  @relation(fields: [bookingId], references: [id], onDelete: SetNull)

  @@unique([bookingId, reason])      // idempotencia DB de visit y visit_reversal
  @@index([businessId, customerId])
  @@index([customerId])
}
```

Y en `Customer`:

```prisma
  loyaltyToken String? @unique   // capability token del link mágico (lazy)
  loyaltyLedger LoyaltyLedger[]
```

(más las back-relations correspondientes en `Business` y `Booking`).

**Notas de diseño del schema:**
- `@@unique([bookingId, reason])`: en Postgres los `NULL` son distintos entre sí, así que los
  `adjustment` (bookingId null) no colisionan, mientras que se garantiza **un solo `visit` y un
  solo `visit_reversal` por reserva** → idempotencia ante reintentos del webhook / dobles llamadas.
- `booking onDelete: SetNull`: si se borra una reserva, el asiento sobrevive (saldo histórico
  intacto), solo pierde el puntero.
- `LoyaltyConfig.isActive @default(false)`: el programa nace apagado; nada acumula hasta que la
  dueña lo prende explícitamente.
- Editar `pointsPerVisit`/`spendPerPoint` **no reescribe asientos pasados** (la historia es
  inmutable; cada asiento ya capturó su desglose en `metadata`).

## Motor puro de acumulación

`src/lib/loyalty/earn.ts` — función pura, sin I/O, unit-testeada como `evaluate.ts` de A.

```ts
export interface EarnConfig { pointsPerVisit: number; spendPerPoint: number | null }
export interface EarnInput { finalAmount: number }
export interface EarnBreakdown {
  total: number
  pointsPerVisit: number
  pointsFromSpend: number
  finalAmount: number
  spendPerPoint: number | null
}

export function computeEarnedPoints(config: EarnConfig, input: EarnInput): EarnBreakdown {
  const pointsPerVisit = Math.max(0, config.pointsPerVisit | 0)
  const spendPerPoint = config.spendPerPoint && config.spendPerPoint > 0 ? config.spendPerPoint : null
  const finalAmount = Math.max(0, input.finalAmount | 0)
  const pointsFromSpend = spendPerPoint ? Math.floor(finalAmount / spendPerPoint) : 0
  return {
    total: pointsPerVisit + pointsFromSpend,
    pointsPerVisit, pointsFromSpend, finalAmount, spendPerPoint,
  }
}
```

- Usa `Booking.finalAmount` (lo realmente cobrado tras el descuento de A).
- El `EarnBreakdown` se guarda **completo** en `ledger.metadata` (trazabilidad máxima:
  permite que la tarjeta diga "+10 por visita, +16 por tu gasto de $16.000").

## Earn — flujo

Helper `creditVisitPoints(tx, booking, config)` (en `src/lib/loyalty/credit.ts`), llamado
**dondequiera que una reserva entra a `completed`**:

1. `updateBookingStatus(completed)` — dentro del `$transaction` existente (junto al `reviewToken`).
2. Cualquier path que cree la reserva ya en `completed` (p. ej. carga manual desde dashboard).

Lógica:
- Si `!config?.isActive` → no hace nada.
- Si `!booking.customerId` → no hace nada (guard walk-in / reserva sin clienta).
- `breakdown = computeEarnedPoints(config, { finalAmount: booking.finalAmount })`.
- Si `breakdown.total <= 0` → no hace nada.
- `tx.loyaltyLedger.create({ businessId, customerId, points: total, reason: 'visit', bookingId, metadata: breakdown })`, con **catch `P2002`** (la unique `(bookingId,'visit')` lo hace idempotente → ya acreditado, no-op).

## Clawback — reversa por reembolso

Helper `reverseVisitPoints(tx, bookingId)` (en `src/lib/loyalty/credit.ts`), llamado en el
webhook de MP cuando `finalStatus === 'refunded'`, en el **mismo `$transaction`** donde A ya
libera el canje (`src/app/api/webhooks/mercado-pago/route.ts:432`):

- Busca el asiento `visit` de ese `bookingId`. Si no existe → no-op.
- Inserta `{ points: -original.points, reason: 'visit_reversal', bookingId, metadata: { reversedLedgerId, originalPoints } }`, con **catch `P2002`** (idempotente: una sola reversa por reserva).
- El ledger refleja la verdad (puede dejar el saldo en negativo si hubo ajustes previos a la
  baja); la **tarjeta y el detalle muestran `Math.max(0, saldo)`** para no confundir a la clienta,
  pero el historial muestra el asiento real.

## Ajuste manual (dueña)

Server action `adjustCustomerPoints(customerId, delta, note)`:
- `requireBusinessRole(['owner','admin'])` + rate-limit (key `loyalty-adjust`).
- Valida `delta` entero `≠ 0` y `note` (zod). Verifica que la clienta pertenece al negocio.
- **Sum + insert dentro de un `$transaction`** (evita TOCTOU): computa el saldo dentro de la tx
  y **rechaza si `saldo + delta < 0`**; si pasa, inserta `{ points: delta, reason: 'adjustment',
  note, createdByUserId, metadata: { previousBalance } }`.
- `await revalidatePath('/dashboard/customers/[id]')`.

## Cómputo de saldo / historial

`src/lib/loyalty/balance.ts` (o en el server action layer):
- `getLoyaltyBalance(tx|prisma, customerId): Promise<number>` → `aggregate _sum.points` (default 0).
- `getLoyaltyHistory(customerId, limit = 50)` → últimos asientos `orderBy createdAt desc`, con
  `booking` mínimo para contexto. Paginación = YAGNI (B1: tope fijo).

## "Mi tarjeta" — superficie de la clienta

- Ruta pública `src/app/tarjeta/[token]/page.tsx` (sin auth).
- `resolveLoyaltyCustomer(token)` → `Customer` por `loyaltyToken` (+ su `business` y `LoyaltyConfig`).
- Si token inválido o no existe → "no disponible" amigable (no revela si el token existió).
- Si `config.isActive === false` → **banner "programa pausado"** + saldo read-only (no se pierde
  la cara ante la clienta; no se emiten links nuevos ni se acredita).
- Muestra: `programName`, **primer nombre** de la clienta (sin apellido/teléfono/email),
  **saldo grande "{n} pts"** (`max(0, saldo)`), e historial (fecha · etiqueta de motivo · ±delta,
  con desglose desde `metadata` cuando exista). Solo lectura — canjear es B2.
- Etiquetas de motivo: `visit`→"Visita", `visit_reversal`→"Reembolso", `adjustment`→"Ajuste".

**Token (lazy):** `ensureLoyaltyToken(customer)` genera `crypto.randomUUID()` y lo persiste la
primera vez que se necesita (al armar una notificación con `config.isActive`). Mismo perfil de
riesgo que `reviewToken` (capability no adivinable; expone solo nombre + puntos).

## Notificaciones

Extender las plantillas de **confirmación de reserva** y **reserva completada** (email + WhatsApp)
con una línea "Tu tarjeta de puntos: {url}", **solo si `config.isActive`**:
- `url = ${baseUrl}/tarjeta/${ensureLoyaltyToken(customer)}`.
- Currency-clean: cualquier monto en las plantillas usa `formatMoney` (los puntos no son moneda;
  se muestran como "{n} pts").

## Panel de la dueña

- **Nueva página** `src/app/dashboard/fidelizacion/page.tsx` + ítem en sidebar
  (`src/components/dashboard/sidebar.tsx`, ícono `Sparkles`). Form de config: toggle `isActive`,
  `programName`, `pointsPerVisit`, `spendPerPoint`. Server actions `getLoyaltyConfig` /
  `upsertLoyaltyConfig`.
- **Detalle de clienta** (`src/app/dashboard/customers/[id]/page.tsx`): tarjeta con saldo +
  historial + form de ajuste manual (delta + nota).

## Server actions — convenciones

`src/server/actions/loyalty.ts` con `'use server'`:
- **Solo funciones async exportadas** (regla `[[use-server-export-boundary-pitfall]]`): tipos,
  enums y constantes viven en `src/lib/loyalty/*`, no se exportan desde el módulo `'use server'`.
- **Todo `revalidate*` con `await`** (regla `[[revalidate-must-be-awaited]]`).
- Acciones: `getLoyaltyConfig`, `upsertLoyaltyConfig`, `adjustCustomerPoints`,
  `getCustomerLoyalty(customerId)` (saldo + historial para el detalle). El earn/clawback NO son
  server actions (corren dentro de transacciones de booking/webhook).

## Estructura de archivos

```
prisma/schema.prisma                         # +LoyaltyConfig, +LoyaltyLedger, +enum, +Customer.loyaltyToken
prisma/migrations/<ts>_add_loyalty/          # migración aditiva (NO aplicar a prod hasta la última task)
src/lib/loyalty/earn.ts                      # computeEarnedPoints (puro)
src/lib/loyalty/credit.ts                    # creditVisitPoints / reverseVisitPoints (in-tx)
src/lib/loyalty/balance.ts                   # getLoyaltyBalance / getLoyaltyHistory
src/lib/loyalty/token.ts                     # ensureLoyaltyToken / resolveLoyaltyCustomer
src/lib/loyalty/schema.ts                    # zod: config + ajuste
src/server/actions/loyalty.ts                # 'use server' (solo async)
src/app/tarjeta/[token]/page.tsx             # Mi tarjeta (pública)
src/app/dashboard/fidelizacion/page.tsx      # config (+ form client component)
src/app/dashboard/customers/[id]/page.tsx    # +tarjeta de puntos + ajuste (modificar)
src/components/dashboard/sidebar.tsx          # +ítem Fidelización (modificar)
src/server/actions/bookings.ts               # creditVisitPoints en path(s) completed (modificar)
src/app/api/webhooks/mercado-pago/route.ts   # reverseVisitPoints en refunded (modificar)
src/lib/notifications/*                       # línea "Mi tarjeta" en confirmación + completada (modificar)
```

## Testing

Unit (estilo A, densidad alta):
- `computeEarnedPoints`: solo visita · solo gasto · ambos · 0 · redondeo `floor` · `spendPerPoint`
  null/0 · montos negativos/0.
- Idempotencia de `creditVisitPoints` (segundo intento = no-op vía P2002).
- `reverseVisitPoints`: reversa correcta · idempotente · no-op si no había `visit`.
- `adjustCustomerPoints`: rechaza saldo negativo · acepta delta válido · TOCTOU (sum dentro de tx).
- `getLoyaltyBalance` con mezcla visit/reversal/adjustment.
- Currency-clean en plantillas/UI nueva (`formatMoney`, nada de `es-CL` hardcodeado).

## Decisiones registradas (resueltas en brainstorming)

1. **Earn = configurable** `pointsPerVisit + pointsFromSpend` (default por visita; earn = suma).
2. **Link "Mi tarjeta"** en confirmación **y** al completar; token reusable por clienta.
3. **Panel B1** = config + ver por clienta + **ajuste manual**.
4. **Clawback = reversa automática** (append-only) en reembolso. *(preferencia explícita del dueño)*
5. **No backfill retroactivo** al prender el programa (la dueña usa ajuste manual si quiere).
6. **Ajuste no permite saldo negativo**; chequeo sum+insert en `$transaction`.
7. **Programa pausado** → tarjeta muestra saldo read-only con banner, no acredita.
8. **Trazabilidad máxima**: cada asiento guarda desglose en `metadata`.
9. **Sin `customerId`** → no se acredita (guard walk-in).

## Compatibilidad con sub-rebanadas futuras

- **B2 (canje):** `PromotionGrant` + gastar puntos = insertar asiento negativo `reason='redemption'`
  (nuevo valor de enum) + emitir promo `triggerType='granted'`. El saldo ya es ledger-based.
- **B3 (condiciones automáticas):** nuevos `reason` (`review`, `referral`, `birthday`…) sobre el
  mismo ledger; nuevos hooks de evento.
- **B4 (gamificación derivada):** sellos/niveles/insignias = vistas puras sobre el saldo; sin
  cambios de schema de B1.
- **D (login):** agrega resolución `User → Customer` junto a `resolveLoyaltyCustomer(token)`; sin
  migración de datos de fidelización.
