# Saldo restante por transferencia bancaria — Diseño

Feature #3 del backlog bank-transfer. Rama `claude/balance-transfer`. Diseño aprobado 2026-07-11; doble auditoría de integración aplicada (2 agentes: dinero/estados/carreras + superficies/consumidores).

## 1. Decisiones de producto (fijadas con el usuario)

1. **Quién/dónde:** la clienta declara desde `/book/confirmation`; la dueña verifica desde el dashboard (simétrico al flujo del abono). `/mi` NO cambia en v1.
2. **Ventana:** reservas `confirmed` o `completed` con `remainingBalance > 0`. Sin límite temporal (se puede pagar después de atendida).
3. **Elegibilidad:** cualquier reserva (aunque el abono haya sido MP o manual), con la única condición de que el negocio tenga la transferencia habilitada (`BankTransferAccount.isEnabled`).
4. **Monto:** siempre el saldo completo, server-authoritative (`remainingBalance` al momento de declarar). Parciales siguen siendo territorio de la dueña vía pago manual.
5. **Arquitectura:** enfoque A — discriminador explícito nuevo `bt-balance:<bookingId>` (NO sufijo dentro de `bt-declared:`; verificado: `'bt-balance:'` no matchea ningún `startsWith('bt-declared:')` existente). Razón: ninguna query existente cambia de significado implícitamente.

## 2. Modelo (sin migración de schema)

Payment nuevo al declarar el saldo:
- `provider: 'manual'`, `providerPaymentId: btBalanceId(bookingId) = 'bt-balance:<bookingId>'` (determinístico → el unique `[bookingId, provider, providerPaymentId]` da idempotencia estructural: UN saldo declarado por reserva).
- `paymentType`: derivado server-side con `deriveManualPaymentType(booking, amount)`. Es PROVISIONAL: el verify lo re-deriva antes de `applyApprovedPayment` (patrón actual, verify.ts:88-93) y el match de finance.ts:153 compara contra la fila fresca — no mostrar el tipo de declare como autoritativo.
- `status: 'pending'`, `amount = booking.remainingBalance`, `paymentMethod: 'Transferencia'`.
- **Sin hold**: no se toca `holdExpiresAt` ni hay plazo. Un saldo sin verificar no congela cupo; la presión es la sección del dashboard con antigüedad visible.

En `src/lib/bank-transfer/declared.ts` (fuente única de la semántica):
- `BT_BALANCE_PREFIX = 'bt-balance:'`, `btBalanceId(bookingId)`.
- `declaredBalancePaymentWhere`, `isDeclaredBalancePayment(p)`, `hasPendingBalanceTransfer(b)` (booking `confirmed|completed` + payment bt-balance pending).
- `anyDeclaredTransferWhere` = OR de los dos prefijos (pending) — para superficies de verificación y sweeps de cancelación.
- Los helpers de abono existentes NO cambian de significado (`hasPendingDeclaredTransfer` queda deposit-only, ver §5).

## 3. Action clienta: `declareBalanceTransfer(bookingId)`

Nueva en `src/server/actions/bank-transfer-public.ts` (misma familia que `declareBankTransfer`).

Guards (en tx):
1. Rate limit público (mismo criterio que declare de abono).
2. Booking existe; `status ∈ {confirmed, completed}`; errores por estado: pendiente → "Primero confirmá tu reserva pagando el abono."; cancelada → "Tu reserva fue cancelada."; expirada → mensaje propio; `no_show` → "Esta reserva quedó como no asistida: escribile al negocio."
3. Cuenta `isEnabled` (si no → "Este negocio no tiene transferencia bancaria habilitada").
4. `remainingBalance > 0` (si no → "Esta reserva no tiene saldo pendiente.").
5. Idempotencia por status del bt-balance existente:
   - `pending` → éxito silencioso (ya declaró).
   - `approved` **con `remainingBalance === 0`** → éxito silencioso (ya verificado; jamás tocar).
   - `approved` **con `remainingBalance > 0`** (verificación parcial previa) → **error claro**: "Tu transferencia anterior fue registrada parcialmente. Escribile al negocio para coordinar el resto." — NUNCA éxito silencioso (auditoría: el unique impide un segundo bt-balance; el silencio sería un botón muerto para siempre).
   - `cancelled`/`rejected` → REACTIVAR el mismo Payment (status→pending, amount=remainingBalance actual, createdAt=now).
   - `refunded`/`failed` → error fuerte "Contactá al negocio."
6. **Guard de carrera REAL contra cancel/no_show concurrente** (auditoría: releer el status en la tx NO serializa bajo ReadCommitted): `updateMany` guardado sobre la fila de booking — `where: { id, status: { in: ['confirmed','completed'] } }, data: { updatedAt: new Date() }` — que toma el row lock y serializa con `cancelBookingInTx`/`updateBookingStatus`; `count === 0` → error por estado. El create/update del Payment va después, en la misma tx. P2002 en el create → éxito (otro request ganó).

Post-tx (best-effort): email a la dueña "transferencia del saldo por verificar" — template HERMANO del declare de abono (los templates actuales hornean el copy en html+text sin discriminador; no parametrizar), reusando `BankTransferDeclaredEmailData` (ya trae amount). Revalidate de las superficies dashboard.

## 4. Verificación dueña (`bank-transfer-verify.ts` + `finance.ts`)

`loadDeclaredPayment` acepta ambos prefijos. En `confirmBankTransfer`, **el branch por tipo va ANTES de la lógica de hold** (auditoría: los confirmed retienen `holdExpiresAt` vencido — `recalcBookingFromPayments` nunca lo nullea — y el branch de re-validación de cupo actual dispararía `assertSlotIsAvailable` sobre una reserva ya firme; un TimeBlock agregado después bloquearía verificar el saldo):
- **Abono (`bt-declared:`)**: comportamiento actual intacto (guard "ya tiene abono aprobado" — que además bloquearía TODO saldo, porque el abono aprobado siempre existe —, re-validación de cupo si hold vencido, etc.).
- **Saldo (`bt-balance:`)**: guards propios: booking `confirmed|completed` (errores específicos para cancelled/no_show, no el genérico de `assertBookingPayable`), `amount ≤ remainingBalance` (ya existe), SIN re-validación de cupo y sin tocar el guard de abono aprobado.
- **`allowCompleted` por finance** (CRÍTICO de auditoría): `assertBookingPayable` (`src/lib/booking-payments.ts:26-34`) rechaza `completed` como terminal y `applyApprovedPayment` lo llama incondicional (`finance.ts:127`). Se agrega opción `allowCompleted?: boolean` a `assertBookingPayable` y se enhebra por `ApplyApprovedPaymentInput`, seteada SOLO desde la rama saldo de `confirmBankTransfer` (nunca desde webhook MP ni confirmPayment). §7 corregido: finance.ts SÍ se toca (esta opción + §5-bis).
- `paymentType` se re-deriva al confirmar; `recalcBookingFromPayments` hace el resto (→ `fully_paid` si cubre todo; el status de booking no cambia — `recalc` solo confirma pending_payment).
- Post-confirm: email best-effort a la clienta "recibimos tu pago del saldo" — send + template HERMANOS nuevos (hoy NO existe email al cliente para el caso no-confirmante; verify solo manda `sendBookingConfirmedNotification` si `wasConfirmed`). Extender un type hermano de `BankTransferVerifyCustomerEmailData` con `amount`/`currency`.

**Rechazar saldo** (`rejectBankTransfer`): la cancelación de booking interna ya es no-op segura (updateMany scoped a `pending_payment`, verify.ts:138-141 — validado). Cambios obligatorios: (a) email por prefijo — template hermano "no pudimos verificar tu transferencia del saldo; escribile al negocio o volvé a declarar" SIN mención de cancelación (el actual dice "tu reserva fue cancelada": falso para saldos); (b) el `window.confirm` del dialog/section dice "Se cancelará la reserva" — para saldos debe decir "La reserva NO se cancela; la clienta podrá volver a declarar" (copy por tipo, obligatorio, no opcional). La clienta puede re-declarar (reactivación §3.5).

## 5. Superficies dueña

- **`getBookings`**: include de payments pasa a `anyDeclaredTransferWhere` + `providerPaymentId` en el select (discriminador).
- **Dos predicados, no uno** (auditoría): `hasPendingDeclaredTransfer` conserva su semántica de abono (badge naranja que REEMPLAZA el status en tabla `bookings/page.tsx:294`, card `:64` y fila del home `dashboard/page.tsx:182` — correcto solo para pending_payment). Para saldos, `hasPendingBalanceTransfer` alimenta un badge ADICIONAL "Saldo por verificar" que NO reemplaza "Confirmada"/"Completada" (la dueña no debe perder la señal de estado firme). Ambos call sites de badge (tabla + card) se extienden.
- **`pendingTransfers` builder + PendingTransfersSection/banner/contador**: pasan a alimentarse por pago-declarado-pendiente (abono O saldo), **excluyendo bookings cancelled/expired** (auditoría: la carrera declare-vs-cancel puede dejar un pending sobre cancelada; no mostrarla como accionable). Item con `kind: 'abono' | 'saldo'` para badge y copy de WhatsApp. Lookup por prefijo explícito, nunca `payments[0]` ciego.
- **Verify dialog**: copys por tipo (título/confirm de rechazo, ver §4).
- **`ManualPaymentDialog`**: si `hasPendingBalanceTransfer(booking)`, mostrar aviso "Hay una transferencia del saldo por verificar — verificala o rechazala antes de registrar otro pago" (no bloquea).

### 5-bis. Autolimpieza del pending obsoleto (auditoría I4)

En `recalcBookingFromPayments` (finance.ts): si el nuevo `remainingBalance === 0`, `updateMany` los Payments `bt-balance:` pendientes de esa booking → `cancelled`. Cubre todos los caminos (pago manual, MP, verify del propio saldo — su propio Payment ya está approved y no matchea el sweep). Sin esto: clienta declara, paga en efectivo al llegar, dueña registra manual → chip clavado cuyo único destino es un rechazo con email confuso.

### 5-ter. Estados que matan pendings

- `cancelBookingInTx` (`mutate.ts:37-40`): where pasa a `anyDeclaredTransferWhere` (una línea).
- `updateBookingStatus` → `cancelled` o `no_show` (auditoría I2: hoy no toca payments y dejaría un bt-balance pending huérfano): en su tx, `updateMany` payments `anyDeclaredTransferWhere` → `cancelled`. `completed` NO cancela nada (pagar después de atendida es el punto).

## 6. Superficie clienta (`/book/confirmation`)

- Elegibilidad del bloque "Pagá el saldo por transferencia": estado confirmado/completado + `remainingBalance > 0` + cuenta habilitada + **sin bt-balance `pending` NI `approved`** (auditoría I1: un approved con saldo residual — verificación parcial — NO debe reabrir el CTA; mostrar en su lugar "Tu transferencia fue registrada parcialmente: escribile al negocio."). Datos bancarios reusando el panel del abono con: prop de action (`TransferPanel` hardcodea `declareBankTransfer`), label "saldo" (hoy dice "Transferí el abono de $X"), sin plazo; la condición de fetch de `bankInfo` (hoy solo `canDeclare` de abono) se extiende al caso saldo.
- Con bt-balance `pending` → "Saldo en verificación: avisale al negocio si pasan varios días." mostrando el `amount` del Payment (lo que declaró; agregar `amount` al select de payments de la página), no el `remainingBalance` vivo.
- Con bt-balance `rejected` → nota de una línea "Tu último aviso no pudo verificarse" + el bloque de declarar (re-declare reactiva).
- **Copy para `completed`** (auditoría I5): la página hoy dice "Reserva confirmada / Te esperamos el [fecha]" — incoherente para una cita pasada a la que mandamos a pagar el saldo. Branch local por `booking.status === 'completed'`: título "Gracias por tu visita" + referencia al saldo pendiente. `deriveConfirmationState` NO cambia.
- `canDeclare` del abono no interfiere (requiere state `pending` + hold vivo; mutuamente excluyente con confirmado — validado).

## 7. Qué NO cambia (validado por auditoría contra el código)

- **Crons**: `expire-holds` y `transfer-reminders` intactos — ambos scoped a `pending_payment` (+hold), un bt-balance sobre confirmed/completed nunca entra.
- **`/mi`**: intacto — `BT_DECLARED_SELECT` es deposit-only y el label además exige pending_payment (doble guard).
- **MP / webhook**: intacto — busca su Payment por id y exige `provider === 'mercado_pago'`; un bt-balance manual es inalcanzable.
- **`deriveConfirmationState`**: intacto — confirmed/completed corto-circuita antes del check de transferencia.
- **`reviveBooking`**: intacto — expired solo viene de pending_payment, nunca carga bt-balance.
- **Ledger**: el mapping paymentType→ledger ya es exhaustivo y agnóstico; `deriveManualPaymentType` con depositPaid=0 da `full_payment` con label sensato.
- **CORREGIDO tras auditoría:** `finance.ts` SÍ se toca (opción `allowCompleted` §4 + autolimpieza §5-bis). `booking-payments.ts` SÍ se toca (`allowCompleted`).

## 8. Riesgos aceptados / documentados

- **Sobre-cobro concurrente** (verify + pago manual simultáneos): los guards `amount ≤ remainingBalance` son read-then-write; la ventana existe HOY para pagos manuales (pre-existente, no introducido por esta feature). `recalc` clampea a `fully_paid`, sin corrupción. No se arregla en v1.
- **Asimetría dueña/clienta en `completed`**: la clienta podrá pagar el saldo post-cita, pero `createManualPayment`/`isManualPaymentAllowed` siguen excluyendo `completed` (la dueña no puede registrar efectivo post-cita). Pre-existente; queda como follow-up consciente, NO se cambia en v1.

## 9. Tests

- **Integración** (`tests/integration/`, DB 5433, seeds de `bank-transfer-seed.ts`):
  - declare-balance: happy path (prefijo/monto/paymentType); guards por estado (pending_payment/cancelled/expired/no_show); sin saldo; cuenta deshabilitada; idempotencia pending / approved+saldo-0; **error en approved+saldo-residual**; reactivación cancelled/rejected; P2002; guard de carrera (count===0).
  - confirm de saldo: sobre `confirmed` y sobre `completed` (ejercita `allowCompleted`); ledger `final_payment`; → `fully_paid`; status intacto; `amount > remainingBalance` rechazado; con TimeBlock solapando el turno futuro → igual confirma (no re-valida cupo); abono intacto (regresión del guard).
  - reject de saldo: Payment rejected, booking sigue confirmed, email variante saldo, re-declare reactiva.
  - autolimpieza: pago manual que deja saldo 0 → bt-balance pending pasa a cancelled.
  - `updateBookingStatus` no_show/cancelled → bt-balance pending cancelado.
  - Regresión: suites existentes de bank-transfer-public/verify sin cambios de semántica.
- **Unit**: helpers nuevos de `declared.ts`; bloque de saldo y copy `completed` de la página (renderToStaticMarkup + mocks); templates hermanos (declared-saldo dueña, verificado-saldo clienta, rechazado-saldo clienta).

## 10. Fuera de alcance (v1)

- Recordatorios cron de saldo; `/mi` con montos/CTA; comprobante adjunto (#4, con Cloudflare R2); montos parciales de clienta; segundo bt-balance tras verificación parcial (sufijos `:2`); registrar pagos manuales sobre `completed` (asimetría §8); Webpay/API bancaria.
