# Refactorización de Finanzas: Servicio Centralizado de Pagos Aprobados

## Contexto

Actualmente los pagos, reservas y ledger están dispersos en múltiples Server Actions:

- `src/server/actions/bookings.ts::confirmPayment` — confirma un pago existente y aplica a la reserva.
- `src/server/actions/payments.ts::createManualPayment` — crea un pago manual y aplica a la reserva.
- `src/server/actions/payments.ts::verifyAndConfirmPayment` — verifica con proveedor y aplica a la reserva.
- `src/server/actions/ledger.ts::createLedgerEntry` — crea asientos contables manualmente.
- `src/lib/booking-payments.ts::applyPaymentToBooking` — función auxiliar que actualiza la reserva y crea ledger, pero está mal ubicada y tiene bugs lógicos.

Problemas identificados:
1. `applyPaymentToBooking` siempre cambia `status` a `confirmed`, ignorando si el abono no cubre `depositRequired` (debería quedar `pending_payment`).
2. Duplicación de lógica transaccional entre `confirmPayment`, `createManualPayment` y `verifyAndConfirmPayment`.
3. `PaymentForm` históricamente ha llamado múltiples actions; necesitamos una única fuente de verdad.
4. No hay idempotencia robusta por `providerPaymentId` para evitar crear dos pagos aprobados por el mismo proveedor.

## Objetivo

Crear un servicio centralizado e idempotente `applyApprovedPayment` que sea la única función responsable de:
- Validar la reserva.
- Crear/actualizar el registro `Payment` aprobado (sin duplicados).
- Crear exactamente un `LedgerEntry` por `Payment` aprobado.
- Recalcular `depositPaid`, `remainingBalance`, `paymentStatus` y `status` desde cero, basándose en **todos los pagos aprobados existentes**.

## Arquitectura

```
┌─────────────────────────────────────┐
│  PaymentForm (UI)                   │
│  ├─ createManualPayment (action)   │
│  └─ verifyAndConfirmPayment (action)│
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  confirmPayment (action)            │
│  createManualPayment (action)       │
│  verifyAndConfirmPayment (action)   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  applyApprovedPayment (service)     │
│  ├─ Valida booking                 │
│  ├─ Upsert Payment aprobado        │
│  ├─ Crea LedgerEntry               │
│  ├─ Recalcula totales              │
│  └─ Actualiza Booking              │
└─────────────────────────────────────┘
```

## Reglas de Negocio

### Recálculo de Booking

Dado `approvedPayments = sum(Payment.amount where status = approved)`:

1. `depositPaid = approvedPayments`
2. `remainingBalance = max(0, finalAmount - approvedPayments)`
3. Si `approvedPayments >= finalAmount`:
   - `paymentStatus = fully_paid`
   - `remainingBalance = 0`
4. Si `approvedPayments >= depositRequired`:
   - `paymentStatus = deposit_paid`
   - `status = confirmed` (si estaba `pending_payment`)
5. Si `approvedPayments < depositRequired`:
   - `paymentStatus = pending_payment`
   - `status = pending_payment`

### Idempotencia

- Si ya existe un `Payment` con el mismo `provider` + `providerPaymentId` (y `providerPaymentId` no es null), no se crea un nuevo Payment.
- Si el Payment ya está `approved`, no se actualiza su estado ni se duplica el LedgerEntry.

### Validaciones

- `amount > 0`
- Booking pertenece al `businessId` indicado.
- Booking no está en estado terminal (`cancelled`, `no_show`, `expired`, `completed`) salvo caso explícito (no se implementa en este ciclo).

## Componentes

### `src/server/services/finance.ts`

Función principal:

```ts
export async function applyApprovedPayment({
  tx,
  bookingId,
  businessId,
  amount,
  provider,
  providerPaymentId,
  paymentType,
  paymentMethod,
  rawPayload,
  createdByUserId,
}: {
  tx: Prisma.TransactionClient;
  bookingId: string;
  businessId: string;
  amount: number;
  provider: PaymentProvider;
  providerPaymentId: string | null;
  paymentType: PaymentType;
  paymentMethod?: string | null;
  rawPayload?: Prisma.JsonValue;
  createdByUserId?: string | null;
})
```

Nota: Recibe `tx` para que pueda ser invocada dentro de transacciones existentes o directamente.

### Refactor de Actions Existentes

- **`confirmPayment`**: Debe envolver a `applyApprovedPayment`. Primero localiza el `Payment` existente, luego llama al servicio dentro de una transacción.
- **`createManualPayment`**: Debe crear el `Payment` inicial y luego delegar todo el recálculo a `applyApprovedPayment`.
- **`verifyAndConfirmPayment`**: Después de verificar con el proveedor, debe llamar a `applyApprovedPayment`.

### Cleanup

- `src/lib/booking-payments.ts::applyPaymentToBooking` se elimina o se marca como obsoleto; toda la lógica migra a `finance.ts`.
- `PaymentForm` no debe llamar `createLedgerEntry` manualmente (actualmente no lo hace, pero se asegura que siga usando solo `createManualPayment`).

## Tests

Archivo: `tests/unit/finance-service.test.ts`

Casos a cubrir:
1. Abono crea exactamente 1 Payment y 1 LedgerEntry.
2. Pago final posterior no duplica Payment ni LedgerEntry para el mismo `providerPaymentId`.
3. Pago final deja `remainingBalance = 0` y `paymentStatus = fully_paid`.
4. Doble `providerPaymentId` no duplica registros.
5. Pago manual actualiza `depositPaid`, `remainingBalance` y `status` correctamente.
6. Pagos parciales acumulan (`depositPaid` suma todos los aprobados).
7. Booking en estado `cancelled` rechaza el pago.
8. `amount <= 0` rechazado.

## Criterios de Aceptación

- [ ] Registrar pago manual crea 1 `Payment` y 1 `LedgerEntry`.
- [ ] `depositPaid` es la suma acumulada de todos los pagos aprobados.
- [ ] `remainingBalance` es correcto (`finalAmount - depositPaid`, mínimo 0).
- [ ] No se producen duplicados de Payment ni LedgerEntry.
- [ ] Build y tests unitarios pasan.
- [ ] No se eliminan datos financieros existentes.

## Restricciones

- No implementar Mercado Pago / Webpay (scope fuera).
- No borrar datos financieros existentes.
- Mínimo cambio posible en la interfaz pública de las actions (signaturas existentes se respetan salvo ajustes internos).
