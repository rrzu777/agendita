# Follow-ups B4b-3: chargeback de reservas + fixes — Diseño

**Fecha:** 2026-07-16 (rev. 2 tras auditoría de integración con 4 agentes)
**Contexto:** B4b-3 ([PR #76](https://github.com/rrzu777/agendita/pull/76), squash `4137e83`) cerró transferencia de paquetes + refund real MP + chargeback de paquete activo, y documentó 4 follow-ups. Esta rebanada toma los que mueven plata; los otros dos (retomar transferencia abandonada, factory bt-*) quedan explícitamente fuera.

## Alcance

1. **Chargeback/refund de RESERVAS post-approved** — el gap grande: hoy el webhook MP ignora por completo un `charged_back`/`refunded` que llega con el Payment ya `approved` (early-return en `route.ts` ~línea 400). La rama existente que sí hace clawback (~línea 598) solo corre si el pago **nunca** se aprobó — letra muerta en la práctica.
2. **Visibilidad y recuperación para la dueña** (agregado en rev. 2): badge en el panel + montos cobrables restaurados + poder registrar el recobro.
3. **Bug "zombie" del panel de la dueña** (descubierto explorando): una transferencia de paquete **declarada** cuyo hold venció desaparece del panel y del contador (`pendingPackageTransferWhere` filtra `holdExpiresAt >= now`) pero el sweep la exime de expirar → queda `pending` invisible para siempre, con la plata de la clienta en el limbo. Más su simétrico del lado clienta: `declarePackageTransfer` rechaza declarar con hold vencido.
4. **Reconciliación MP↔local = el eco del webhook** — no se construye un job: cuando el refund en MP triunfa pero la tx local falla, MP igual emite un webhook `refunded` que cae en la rama de paquete de B4b-3 (compra aún `active` → reversión voluntary). **Verificado en auditoría: el test ya existe** (`tests/unit/mercado-pago-webhook-packages.test.ts:396`). Solo se documenta la garantía en un comentario en la rama del webhook.

**Política aprobada para reservas confirmadas futuras con chargeback:** marcar + alarmar; **la dueña decide**. Un bot no cancela horas de personas: la reserva queda `confirmed`, el cupo y el descuento siguen; la dueña elige cancelar, cobrar de nuevo o atender igual. (Rev. 2: "cobrar de nuevo" ahora es realmente posible — ver §1.2 y §6.)

**Sin migración** — todos los campos y enums necesarios ya existen (`BookingPaymentStatus.refunded`, `LedgerEntryType.refund_issued`, `LedgerDirection.expense`).

## §1 · Núcleo: `reverseBookingPaymentInTx` (`src/lib/bookings/reverse-payment.ts`, nuevo)

Espejo del patrón `reversePackagePurchaseInTx` de B4b-3, pero la unidad de idempotencia es el **Payment** (no hay "purchase" que flipear). Recibe `(tx, opts)` con `{ paymentId, bookingId, businessId, customerId, amount, currency, now }` y hace, en orden:

1. **Flip atómico CAS:** `tx.payment.updateMany({ where: { id: paymentId, status: 'approved' }, data: { status: 'refunded', ... } })`. Si `count === 0` → retorna `{ reversed: false }` sin tocar nada más (redelivery, carrera). Este flip ES la idempotencia de todo el flujo.
2. **Ledger:** asiento compensatorio `type: 'refund_issued'`, `direction: 'expense'`, con `bookingId` seteado y `paymentId: null` — el `@@unique([paymentId])` ya lo consume el asiento original del pago (mismo truco que el refund de paquete). Monto = `transaction_amount` del pago de MP.
3. **Montos del booking — restaurados vía recalc (rev. 2):** se reusa la lógica de `recalcBookingFromPayments` (`src/server/services/finance.ts:287`, hoy privada — se **extrae/exporta** como helper compartido). Con el Payment ya `refunded` y el asiento expense insertado, el recálculo deriva los valores verdaderos: `depositPaid` baja, `remainingBalance` sube → la dueña puede recobrar, el KPI "Pendiente por cobrar" (`totalPending`) queda correcto, y el drawer deja de mostrar plata que ya no está. **Excepción al recalc:** `paymentStatus` se **overridea a `'refunded'`** (el recalc derivaría `unpaid`/`deposit_paid`; queremos el marcador de disputa). El `status` de la reserva **no se toca**.
4. **Loyalty (clawback):** `reverseVisitPoints(tx, bookingId)` (no-op si la reserva nunca se completó — los puntos se ganan al completar) + `reverseAutoRewardsForBooking(tx, bookingId, now, businessId)` **gateado por** `LoyaltyConfig.clawbackAutoRewardOnRefund` — exactamente la semántica que la rama muerta de ~598 ya invocaba. Ambos verificados idempotentes en auditoría (`credit.ts:53` P2002-safe; `automatic.ts:122` dedupeKey + updateMany).
5. **La redención de promo NO se libera:** la reserva sigue viva con su descuento y su cupo. Si la dueña después cancela, el flujo normal de cancelación (`cancelBookingInTx` → `releaseRedemptionForBooking`) la libera — verificado: ese flujo no toca Payments approved/refunded, cero doble-reversión. Liberarla acá dejaría una reserva confirmada con descuento aplicado pero redención suelta (contadores de promo corruptos).

Retorna `{ reversed: boolean }` para que el caller gatee notificación/revalidate.

## §2 · Rama nueva en el webhook + guard anti-redelivery en la rama vieja

**Rama nueva** en `src/app/api/webhooks/mercado-pago/route.ts`, justo después de la rama de chargeback de paquete (~397) y **antes** del early-return `approved` (~400):

```
gate: (mpStatus === 'charged_back' || mpStatus === 'refunded')
      && payment.bookingId
      && payment.status === 'approved'
```

→ `prisma.$transaction` que llama el núcleo de §1 (con `rawPayload`/`providerPaymentId` actualizados en el flip). Después de la tx, solo si `reversed`:

- `mpStatus === 'charged_back'` → alarma `BookingDisputed` a la dueña (§3).
- `mpStatus === 'refunded'` → silencioso. Asimetría idéntica a paquetes: un refunded post-approved es la dueña (u otro operador) devolviendo desde el panel de MP — voluntario, no disputa.
- `revalidatePath` del dashboard/cliente correspondiente.
- Respuesta 200 con mensaje propio (`Booking chargeback processed` / `Booking refund processed`).

Si el gate matchea pero `reversed === false` → 200 idempotente (eco/redelivery). Mutuamente excluyente con la rama de paquete (`payment.bookingId` vs `!payment.bookingId`) — verificado en auditoría.

**Guard anti-redelivery en la rama vieja (~564) — BLOQUEANTE, no opcional.** Secuencia demostrada en auditoría: la rama nueva deja el Payment `refunded` conservando la redención (§1.5); MP redelivera → el gate nuevo no matchea (ya no está `approved`) → cae en la rama vieja, cuyo guard actual solo corta `approved` → **ejecuta `releaseRedemptionForBooking` (route.ts:599) liberando la redención que deliberadamente conservamos** → reserva confirmada con descuento aplicado pero redención suelta. La rama vieja pasa a actuar **solo si el Payment local está `pending`** (único estado no-terminal local: el webhook guarda `in_process` de MP como `pending`) — su propósito original: degradar pagos que nunca se aprobaron. Cualquier otro estado → 200 idempotente sin side effects.

## §3 · Notificación `BookingDisputed`

Template nuevo calcado de `PackageDisputed` (shape en `src/lib/notifications/types.ts`, builder en `templates.ts`, sender en `email-provider.ts`/`index.ts`): negocio, clienta, servicio, fecha/hora, N° de reserva (`formatBookingNumber`), monto disputado. Se envía con `sendMultiNotificationSafely` **fuera de la tx** (best-effort, igual que todas las notifs). Solo en modo chargeback.

## §4 · Visibilidad en el panel: badge "Pago revertido" (rev. 2)

Hoy `Booking.paymentStatus` no se renderiza en ningún lado (solo comparaciones `=== 'fully_paid'` para color) — un chargeback sería invisible salvo por el email. Se agrega un **badge rojo adicional** (no reemplaza el status de la reserva) cuando `paymentStatus === 'refunded'`, en las 3 superficies de la dueña:

- Tabla de reservas (`src/app/dashboard/bookings/page.tsx`, fila junto al monto).
- Card móvil (`src/components/dashboard/booking-card.tsx`).
- Drawer (`src/components/dashboard/booking-drawer.tsx`, línea de pago).

Label: **"Pago revertido"** (cubre tanto contracargo como refund vía panel MP — ambos escriben el mismo estado; el email de alarma distingue la disputa). Fuente única del label/estilo (helper o entrada en el mapa de labels compartido existente) para no triplicarlo.

## §5 · Fix del bug zombie del panel + declarar con hold vencido

**Lado dueña:** en `src/lib/bank-transfer/declared.ts`, `pendingPackageTransferWhere` pierde la condición `holdExpiresAt: { gte: now }` (y el parámetro `now` de la firma). Justificación: el predicado ya exige `payments: { some: declaredPkgTransferPaymentWhere } }` — solo matchea compras con transferencia declarada — y el sweep de `expireStaleHolds` exime a las declaradas de expirar a propósito (la plata pudo enviarse). El filtro de hold no protegía nada: solo escondía de la dueña las declaradas con hold vencido, dejándolas pending invisibles para siempre. Verificado en auditoría: `confirmPackageTransfer`/`rejectPackageTransfer` no chequean hold (la dueña puede actuar sobre lo que ahora ve), banner y panel comparten el predicado (el fix arregla ambos), y el mapping `payments[0]` del panel sigue garantizado por el `some`.

Callers a actualizar (2): `src/app/dashboard/page.tsx` (contador home) y `getPendingPackageTransfers` en `src/server/actions/packages.ts`.

**Lado clienta (rev. 2):** `declarePackageTransfer` (`src/server/actions/packages-checkout.ts:321`) deja de rechazar por hold vencido — el check `holdExpiresAt < now → throw` se elimina; queda solo el guard `status !== 'pending' → throw` (línea 320). Misma filosofía: la plata pudo enviarse y en paquetes no hay cupo en juego. La ventana es finita naturalmente: cuando el sweep corre, la compra no-declarada pasa a `expired` y el guard de status la rechaza.

## §6 · Recobro: pago manual en reservas `completed` con saldo (rev. 2)

Con los montos restaurados (§1.3), una reserva **futura** chargebackeada vuelve a mostrar saldo y el flujo de pago manual existente funciona solo. Pero una reserva **completada** con chargeback queda trabada: `assertBookingPayable` (`src/lib/booking-payments.ts`) trata `completed` como terminal para `createManualPayment`, y `cancelBooking` también la rechaza — la dueña no tendría NINGUNA acción. Fix: `createManualPayment` (`src/server/actions/payments.ts`) pasa a aceptar reservas `completed` con `remainingBalance > 0`, reusando el mecanismo `allowCompleted` que el saldo por transferencia ya usa (`bank-transfer-verify.ts:87`). El util de UI `isManualPaymentAllowed` (`src/components/dashboard/manual-payment-utils.ts`) se actualiza en consecuencia. Re-cobro vía MP (link de pago a la clienta) queda fuera de alcance.

**Nota de ciclo de vida (aceptado, documentado):** cuando llega plata nueva post-chargeback, `recalcBookingFromPayments` re-deriva `paymentStatus` y el marcador `'refunded'` (y su badge) desaparece — correcto: la deuda se saldó. El asiento `refund_issued` en el ledger y el email de alarma quedan como registro durable de la disputa.

## §7 · Guard de loyalty al completar (rev. 2)

Puerta de atrás detectada en auditoría: chargeback sobre una reserva `confirmed` aún no completada → el clawback del núcleo es no-op (los puntos se ganan al completar) → si la dueña después la completa, `creditVisitPoints` + la emisión de auto-rewards (`updateBookingStatus`, `src/server/actions/bookings.ts:513-589`) acreditan puntos por una visita cuya plata se fue, y nada los revierte (el unique `[bookingId, reason]` no bloquea porque nunca hubo fila `visit`).

Fix: `updateBookingStatus(completed)` **salta el earn de loyalty completo** (visit points + emisión de auto-rewards) si `booking.paymentStatus === 'refunded'`. Si la clienta re-paga antes de completar, el recalc ya limpió el marcador y los puntos fluyen normal.

## Testing

- **Unit — núcleo §1:** flip exitoso (payment refunded, asiento expense con paymentId null, montos recalculados: depositPaid baja / remainingBalance sube, paymentStatus 'refunded' overrideado, reverseVisitPoints llamado, auto-rewards solo con config on); flip con `count === 0` → `{ reversed: false }` y cero side effects; redención NO liberada.
- **Unit — webhook §2:** `charged_back` sobre booking approved → núcleo + notif; `refunded` sobre booking approved → núcleo sin notif; redelivery (payment ya refunded) → 200 sin side effects ni release de redención; gate no matchea paquetes (`packagePurchaseId` sin `bookingId` sigue yendo a su rama).
- **Unit — guard §2 rama vieja:** webhook `refunded` sobre Payment ya `refunded` → 200 idempotente, sin releaseRedemption ni clawback repetidos; Payment `pending` sigue degradándose como hoy.
- **Unit — §4:** el badge renderiza con paymentStatus 'refunded' y no renderiza con los demás valores (componente compartido).
- **Unit — §5:** declarada con hold vencido matchea el predicado; sin declarar no matchea (sin importar hold); `declarePackageTransfer` acepta hold vencido con status pending y rechaza status ≠ pending.
- **Unit — §6:** `createManualPayment` acepta completed con saldo y sigue rechazando completed sin saldo / cancelled / expired; `isManualPaymentAllowed` consistente.
- **Unit — §7:** completar con paymentStatus 'refunded' NO acredita visit points ni emite auto-rewards; completar con paymentStatus normal sigue acreditando.
- **Integración (Docker PG :5433):** chargeback end-to-end de una reserva **completada** con puntos ganados: puntos revertidos en LoyaltyLedger, asiento expense en LedgerEntry, `paymentStatus: 'refunded'`, `remainingBalance` restaurado, `status: 'completed'` intacto, Payment `refunded`; luego `createManualPayment` del recobro → recalc limpia el marcador.

## Fuera de alcance (documentado, no bloquea)

- **Refunds parciales de MP:** un refund parcial NO cambia el status del pago (queda `approved` con `transaction_amount_refunded > 0`) — no entra por esta rama y no se maneja.
- **Mismatch de amount/currency en eventos de chargeback:** los checks globales del webhook (route.ts ~324-339) corren antes de cualquier rama y 400earían un evento con montos distintos. Riesgo preexistente y simétrico con la rama de paquete de B4b-3 (un contracargo total de MP conserva el transaction_amount original, así que en la práctica matchea). Aceptado y documentado, no se toca.
- **`/book/confirmation` le muestra "confirmada y pagada" a la clienta post-chargeback** (deriveConfirmationState cortocircuita por status) — cosmético: quien inició el contracargo en su banco no necesita la corrección; no se toca.
- **Reserva con abono + saldo donde solo un pago recibe chargeback:** el recalc de §1.3 ahora deriva los montos correctos contando el resto de pagos approved, así el caso quedó mejor cubierto que en rev. 1; el `paymentStatus: 'refunded'` global sigue siendo una simplificación consciente hasta que llegue plata nueva.
- **Duplicado pending en el reuse del checkout:** `createPackagePurchase` no reusa una compra pending con hold vencido (filtro `holdExpiresAt >= now` en el reuse) → puede crear una segunda pending del mismo producto. Colateral menor preexistente, fuera de alcance.
- **Retomar transferencia de paquete abandonada** (follow-up 3 de B4b-3) y **factory bt-*** (follow-up 4): fuera de esta rebanada por decisión de alcance.
- **Acción de la dueña "reembolsar reserva" con refund real MP** y **re-cobro vía link de pago MP:** rebanadas futuras.
