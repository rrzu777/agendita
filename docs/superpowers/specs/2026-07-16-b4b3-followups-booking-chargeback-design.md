# Follow-ups B4b-3: chargeback de reservas + fixes — Diseño

**Fecha:** 2026-07-16
**Contexto:** B4b-3 ([PR #76](https://github.com/rrzu777/agendita/pull/76), squash `4137e83`) cerró transferencia de paquetes + refund real MP + chargeback de paquete activo, y documentó 4 follow-ups. Esta rebanada toma los que mueven plata; los otros dos (retomar transferencia abandonada, factory bt-*) quedan explícitamente fuera.

## Alcance

1. **Chargeback/refund de RESERVAS post-approved** — el gap grande: hoy el webhook MP ignora por completo un `charged_back`/`refunded` que llega con el Payment ya `approved` (early-return en `route.ts` ~línea 400). La rama existente que sí hace clawback (~línea 598) solo corre si el pago **nunca** se aprobó — letra muerta en la práctica.
2. **Bug "zombie" del panel de la dueña** (descubierto explorando): una transferencia de paquete **declarada** cuyo hold venció desaparece del panel y del contador (`pendingPackageTransferWhere` filtra `holdExpiresAt >= now`) pero el sweep la exime de expirar → queda `pending` invisible para siempre, con la plata de la clienta en el limbo.
3. **Reconciliación MP↔local = el eco del webhook** — no se construye un job: cuando el refund en MP triunfa pero la tx local falla, MP igual emite un webhook `refunded` que cae en la rama de paquete de B4b-3 (compra aún `active` → reversión voluntary). Solo se verifica/completa la cobertura de test y se documenta la garantía.

**Política aprobada para reservas confirmadas futuras con chargeback:** marcar + alarmar; **la dueña decide**. Un bot no cancela horas de personas: la reserva queda `confirmed`, el cupo y el descuento siguen; la dueña elige cancelar, cobrar de nuevo o atender igual.

**Sin migración** — todos los campos y enums necesarios ya existen (`BookingPaymentStatus.refunded`, `LedgerEntryType.refund_issued`, `LedgerDirection.expense`).

## §1 · Núcleo: `reverseBookingPaymentInTx` (`src/lib/bookings/reverse-payment.ts`, nuevo)

Espejo del patrón `reversePackagePurchaseInTx` de B4b-3, pero la unidad de idempotencia es el **Payment** (no hay "purchase" que flipear). Recibe `(tx, opts)` con `{ paymentId, bookingId, businessId, customerId, amount, currency, now }` y hace, en orden:

1. **Flip atómico CAS:** `tx.payment.updateMany({ where: { id: paymentId, status: 'approved' }, data: { status: 'refunded', ... } })`. Si `count === 0` → retorna `{ reversed: false }` sin tocar nada más (redelivery, carrera con otro proceso). Este flip ES la idempotencia de todo el flujo.
2. **Booking:** `paymentStatus → 'refunded'`. El `status` de la reserva **no se toca**.
3. **Ledger:** asiento compensatorio `type: 'refund_issued'`, `direction: 'expense'`, con `bookingId` seteado y `paymentId: null` — el `@@unique([paymentId])` ya lo consume el asiento original del pago (mismo truco que el refund de paquete). Monto = `transaction_amount` del pago de MP.
4. **Loyalty (clawback):** `reverseVisitPoints(tx, bookingId)` (no-op si la reserva nunca se completó — los puntos se ganan al completar) + `reverseAutoRewardsForBooking(tx, bookingId, now, businessId)` **gateado por** `LoyaltyConfig.clawbackAutoRewardOnRefund` — exactamente la semántica que la rama muerta de ~598 ya invocaba.
5. **La redención de promo NO se libera:** la reserva sigue viva con su descuento y su cupo. Si la dueña después cancela, el flujo normal de cancelación (`cancelBookingInTx` → `releaseRedemptionForBooking`) la libera. Liberarla acá dejaría una reserva confirmada con descuento aplicado pero redención suelta (contadores de promo corruptos).

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

Si el gate matchea pero `reversed === false` → 200 idempotente (eco/redelivery).

**Guard anti-redelivery en la rama vieja (~564):** hoy, un webhook re-entregado sobre un Payment que la rama nueva ya dejó `refunded` caería en la rama vieja y **re-ejecutaría el clawback** (releaseRedemption + reverseVisitPoints de nuevo). La rama vieja pasa a actuar **solo si el Payment local está `pending`** (único estado no-terminal local: el webhook guarda `in_process` de MP como `pending`) — su propósito original: degradar pagos que nunca se aprobaron. Cualquier otro estado (`approved` ya está cubierto arriba; `refunded`/`cancelled`/`rejected`) → 200 idempotente sin side effects.

## §3 · Notificación `BookingDisputed`

Template nuevo calcado de `PackageDisputed` (shape en `src/lib/notifications/types.ts`, builder en `templates.ts`, sender en `email-provider.ts`/`index.ts`): negocio, clienta, servicio, fecha/hora, N° de reserva (`formatBookingNumber`), monto disputado. Se envía con `sendMultiNotificationSafely` **fuera de la tx** (best-effort, igual que todas las notifs). Solo en modo chargeback.

## §4 · Fix del bug zombie del panel

En `src/lib/bank-transfer/declared.ts`, `pendingPackageTransferWhere` pierde la condición `holdExpiresAt: { gte: now }` (y el parámetro `now` de la firma). Justificación: el predicado ya exige `payments: { some: declaredPkgTransferPaymentWhere } }` — solo matchea compras con transferencia declarada — y el sweep de `expireStaleHolds` exime a las declaradas de expirar a propósito (la plata pudo enviarse). El filtro de hold no protegía nada: solo escondía de la dueña las declaradas con hold vencido, dejándolas pending invisibles para siempre.

Callers a actualizar (2): `src/app/dashboard/page.tsx` (contador home) y `getPendingPackageTransfers` en `src/server/actions/packages.ts`.

## §5 · Reconciliación MP↔local: garantía por eco, sin job

Escenario: `refundPackagePurchase` emite el refund real en MP con éxito y la tx local falla justo después → la compra queda `active` con la plata ya devuelta. **Auto-sanación existente:** MP emite un webhook `payment.updated` con status `refunded`; ese webhook cae en la rama de paquete de B4b-3 (`packagePurchaseId && !bookingId && purchase.status === 'active'`) → reversión voluntary completa. El reintento manual de la dueña también es seguro (idempotencyKey en MP + flip atómico local).

Trabajo de esta rebanada: **verificar** que el caso "webhook `refunded` con compra aún `active` → reversión voluntary" tenga test explícito en `tests/unit/mercado-pago-webhook-packages.test.ts` (agregarlo si falta) y documentar la garantía en un comentario en la rama del webhook. Para reservas, el mismo eco queda cubierto por la rama nueva de §2.

## Testing

- **Unit — núcleo §1:** flip exitoso (payment refunded, paymentStatus refunded, asiento expense con paymentId null, reverseVisitPoints llamado, auto-rewards solo con config on); flip con `count === 0` → `{ reversed: false }` y cero side effects; redención NO liberada.
- **Unit — webhook §2:** `charged_back` sobre booking approved → núcleo + notif; `refunded` sobre booking approved → núcleo sin notif; redelivery (payment ya refunded) → 200 sin side effects; gate no matchea paquetes (`packagePurchaseId` sin `bookingId` sigue yendo a su rama).
- **Unit — guard §2 rama vieja:** webhook `refunded` sobre Payment ya `refunded` → 200 idempotente, sin releaseRedemption ni clawback repetidos.
- **Unit — §4:** declarada con hold vencido matchea el predicado; sin declarar no matchea (sin importar hold).
- **Integración (Docker PG :5433):** chargeback end-to-end de una reserva **completada** con puntos ganados: puntos revertidos en LoyaltyLedger, asiento expense en LedgerEntry, `paymentStatus: 'refunded'`, `status: 'completed'` intacto, Payment `refunded`.

## Fuera de alcance (documentado, no bloquea)

- **Refunds parciales de MP:** un refund parcial NO cambia el status del pago (queda `approved` con `transaction_amount_refunded > 0`) — no entra por esta rama y no se maneja.
- **Reserva con abono + saldo donde solo un pago recibe chargeback:** `paymentStatus` pasa a `'refunded'` global aunque el otro pago siga en pie — simplificación consciente; la alarma a la dueña da el contexto para decidir.
- **Retomar transferencia de paquete abandonada** (follow-up 3 de B4b-3) y **factory bt-*** (follow-up 4): fuera de esta rebanada por decisión de alcance.
- **Acción de la dueña "reembolsar reserva" con refund real MP:** hoy el refund de reserva se hace desde el panel de MP; darle botón propio en el dashboard (reusando `provider.refundPayment`) es una rebanada futura.
