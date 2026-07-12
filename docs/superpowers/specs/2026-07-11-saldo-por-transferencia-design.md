# Saldo restante por transferencia bancaria — Diseño

Feature #3 del backlog bank-transfer. Rama `claude/balance-transfer`. Diseño aprobado 2026-07-11.

## 1. Decisiones de producto (fijadas con el usuario)

1. **Quién/dónde:** la clienta declara desde `/book/confirmation`; la dueña verifica desde el dashboard (simétrico al flujo del abono). `/mi` NO cambia en v1.
2. **Ventana:** reservas `confirmed` o `completed` con `remainingBalance > 0`. Sin límite temporal (se puede pagar después de atendida).
3. **Elegibilidad:** cualquier reserva (aunque el abono haya sido MP o manual), con la única condición de que el negocio tenga la transferencia habilitada (`BankTransferAccount.isEnabled`).
4. **Monto:** siempre el saldo completo, server-authoritative (`remainingBalance` al momento de declarar). Parciales siguen siendo territorio de la dueña vía pago manual.
5. **Arquitectura:** enfoque A — discriminador explícito nuevo `bt-balance:<bookingId>` (NO sufijo dentro de `bt-declared:`). Razón: ninguna query existente cambia de significado implícitamente; cada helper dice qué matchea.

## 2. Modelo (sin migración de schema)

Payment nuevo al declarar el saldo:
- `provider: 'manual'`, `providerPaymentId: btBalanceId(bookingId) = 'bt-balance:<bookingId>'` (determinístico → el unique `[bookingId, provider, providerPaymentId]` da idempotencia estructural: UN saldo declarado por reserva).
- `paymentType`: derivado server-side con `deriveManualPaymentType(booking, amount)` (dará `final_payment` si hay abono pagado, `full_payment` si el saldo es el total). NO hardcodear.
- `status: 'pending'`, `amount = booking.remainingBalance`, `paymentMethod: 'Transferencia'`.
- **Sin hold**: la reserva ya está firme; no se toca `holdExpiresAt` ni hay plazo. Un saldo declarado sin verificar no congela cupo — la presión es solo la sección del dashboard (con antigüedad visible).

En `src/lib/bank-transfer/declared.ts` (fuente única de la semántica):
- `BT_BALANCE_PREFIX = 'bt-balance:'`, `btBalanceId(bookingId)`.
- `declaredBalancePaymentWhere` (provider manual + status pending + startsWith bt-balance:) e `isDeclaredBalancePayment(p)`.
- `anyDeclaredTransferWhere` = OR de los dos prefijos (pending) — para superficies de verificación que deben ver ambos.
- Los helpers de abono existentes NO cambian de significado.

## 3. Action clienta: `declareBalanceTransfer(bookingId)`

Nueva en `src/server/actions/bank-transfer-public.ts` (misma familia que `declareBankTransfer`; comparte rate-limit helper y estilo).

Guards (en tx):
1. Rate limit público (mismo criterio que declare de abono).
2. Booking existe; `status ∈ {confirmed, completed}`; si no → error claro por estado (pendiente → "Primero confirmá tu reserva pagando el abono."; cancelada/expirada → mensaje propio).
3. Cuenta `isEnabled` (si no → "Este negocio no tiene transferencia bancaria habilitada").
4. `remainingBalance > 0` (si no → "Esta reserva no tiene saldo pendiente.").
5. Idempotencia por status del bt-balance existente (mismo patrón allowlist que dejó #2 en el declare de abono):
   - `pending` → éxito silencioso (ya declaró).
   - `approved` → éxito silencioso (ya verificado; jamás tocar).
   - `cancelled`/`rejected` → REACTIVAR el mismo Payment (status→pending, amount=remainingBalance actual, createdAt=now).
   - otros (refunded/failed) → error fuerte "Contactá al negocio."
6. Guard de carrera: el update/create del Payment va dentro de la tx; CAS re-afirmando `status ∈ {confirmed, completed}` y recomputando `remainingBalance` desde la booking cargada en la tx. P2002 en el create → éxito (otro request ganó).

Post-tx (best-effort): email a la dueña "transferencia del saldo por verificar" reusando `BankTransferDeclaredEmailData` + template/provider existentes del declare de abono, con copy que diga "saldo" (parámetro o template hermano; decidir en plan según cómo esté factorizado el template actual). Revalidate de las superficies dashboard.

## 4. Verificación dueña (`bank-transfer-verify.ts`)

`loadDeclaredPayment` acepta ambos prefijos (`isDeclaredTransferPayment || isDeclaredBalancePayment`). En `confirmBankTransfer`:
- **Abono (`bt-declared:`)**: comportamiento actual intacto (guard "ya tiene abono aprobado", re-validación de cupo si el hold venció, etc.).
- **Saldo (`bt-balance:`)**: NO aplica el guard "ya tiene el abono pagado" (justamente lo tiene); guards propios: booking `confirmed|completed`, `amount ≤ remainingBalance` (ya existe), SIN re-validación de cupo ni `skipHoldExpiryCheck` (no hay hold en juego). `assertBookingPayable` debe pasar para confirmadas/completadas — verificar su contrato en plan; si rechaza `completed`, permitir explícitamente esa vía para saldos.
- `paymentType` se re-deriva al confirmar (ya lo hace); `applyApprovedPayment` + `recalcBookingFromPayments` hacen el resto (→ `fully_paid` si cubre todo). El status de la booking NO cambia (ya está confirmed/completed; `recalc` solo confirma pending_payment, que acá no aplica).
- Post-confirm: email best-effort a la clienta "recibimos tu pago del saldo" reusando `BankTransferVerifyCustomerEmailData` con template hermano de copy "saldo" (o variante del existente — decidir en plan).

**Rechazar saldo** (`rejectBankTransfer` o la action de rechazo existente): a diferencia del abono, NO cancela la reserva ni libera nada — solo `Payment → rejected` + email a la clienta ("no pudimos verificar tu transferencia del saldo; escribile al negocio o volvé a declarar"). La clienta puede re-declarar (reactivación del punto 3.5).

## 5. Superficies dueña

- **`getBookings`**: el include de payments pasa de `declaredTransferPaymentWhere` a `anyDeclaredTransferWhere` (+ `providerPaymentId` en el select para discriminar).
- **`pendingTransfers` builder** (`src/app/dashboard/bookings/page.tsx`) y **PendingTransfersSection/banner/contador** (`dashboard/page.tsx`): dejan de filtrar por `status === 'pending_payment'` y pasan a "tiene payment declarado pendiente" (abono o saldo). Cada item muestra badge **"Abono"** o **"Saldo"** (derivado del prefijo). El `payments[0]` desnudo se reemplaza por lookup explícito por tipo; si por una carrera hubiera dos, mostrar ambos o priorizar abono — decidir en plan, pero NUNCA index 0 ciego.
- **Verify dialog**: sin cambios estructurales (recibe paymentId + amount); el copy del diálogo distingue abono/saldo si es barato; el server ya valida.

## 6. Superficie clienta (`/book/confirmation`)

- Estado `confirmed` (que incluye `completed` en el derive actual) + `remainingBalance > 0` + cuenta habilitada + sin bt-balance pendiente → bloque "Pagá el saldo por transferencia": datos bancarios (reusar el bloque/panel compartido del abono, sin plazo), monto = saldo, botón "Ya transferí el saldo" → `declareBalanceTransfer`.
- Con bt-balance `pending` → bloque "Saldo en verificación: avisale al negocio si pasan varios días." (sin plazo).
- Con `fully_paid` → nada (el resumen de montos ya muestra saldo 0).
- `deriveConfirmationState` NO cambia (confirmed corto-circuita antes del check de transferencia declarada — correcto). El sub-estado del saldo se deriva localmente en la página desde los payments cargados (la query de payments de la página debe incluir los bt-balance; hoy filtra `provider IN (mercado_pago, manual)` así que ya los trae — verificar el `select` incluya `providerPaymentId`, sí lo incluye).

## 7. Qué NO cambia (validado contra el mapa del código)

- **Crons**: `expire-holds` y `transfer-reminders` quedan deposit-only (scoped a `pending_payment`; un bt-balance nunca entra). Sin recordatorios de saldo en v1.
- **`/mi`**: sin cambios (su `BT_DECLARED_SELECT` sigue siendo de abonos; el label "en verificación" es para pending_payment).
- **MP / webhook**: sin cambios (`paymentType` de MP sigue siendo deposit).
- **Ledger / finance.ts**: sin cambios — ya es paymentType-agnóstico y `recalcBookingFromPayments` suma todos los approved.
- **`cancelBooking`**: hoy cancela declarados vía `declaredTransferPaymentWhere` (solo abonos). Extenderlo a `anyDeclaredTransferWhere` para que cancelar una confirmada con saldo declarado no deje un pending huérfano — cambio de una línea, incluido.

## 8. Tests

- **Integración** (`tests/integration/`, DB 5433, seeds de `bank-transfer-seed.ts`):
  - declare-balance: happy path (payment creado con prefijo/monto/paymentType correctos); guards por estado (pending_payment/cancelled/expired); sin saldo; cuenta deshabilitada; idempotencia pending/approved; reactivación cancelled/rejected; P2002.
  - confirm de saldo: ledger `final_payment`, booking → `fully_paid`, status intacto; sobre `completed` también; `amount > remainingBalance` rechazado; abono intacto (regresión del guard).
  - reject de saldo: Payment rejected, booking sigue confirmed, re-declare reactiva.
  - Regresión: suite existente de bank-transfer-public/verify sin cambios de semántica.
- **Unit**: helpers nuevos de `declared.ts`; componente del bloque de saldo (renderToStaticMarkup + mocks); templates de emails nuevos/variantes.

## 9. Fuera de alcance (v1)

- Recordatorios cron de saldo; `/mi` mostrando montos/CTA; comprobante adjunto (es #4, irá con Cloudflare R2); montos parciales de clienta; Webpay/API bancaria.
