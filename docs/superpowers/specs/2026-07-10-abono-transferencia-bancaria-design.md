# Abono por transferencia bancaria — Design Doc

**Fecha:** 2026-07-10
**Estado:** aprobado (diseño v3 — incorpora dos rondas de auditoría contra el código real)

## 1. Contexto y objetivo

La dueña pidió: *"abono de reservas a la cuenta bancaria de la dueña para cuando esté configurado el abono y no esté configurado o disponible el MercadoPago... o quizás puedan convivir como opciones"*.

Hoy el único método de abono online es MercadoPago. Si el negocio no lo tiene conectado, el wizard muestra un fallback de texto ("coordina por WhatsApp o transferencia") y la reserva queda `pending_payment` sin camino dentro del sistema. La dueña ya puede registrar pagos recibidos por fuera con `createManualPayment` (diálogo "Registrar pago"), pero la clienta no tiene forma de declarar que transfirió ni de ver "en verificación".

**Objetivo v1:** que el negocio configure sus datos bancarios; que la clienta pueda elegir "transferencia" como método de abono (conviviendo con MP si ambos están), ver los datos, transferir por su cuenta y declarar "ya transferí"; y que la dueña verifique o rechace desde el dashboard.

## 2. Decisiones de producto (cerradas con el usuario)

1. Si MP y transferencia están ambos configurados, la clienta **elige** entre los dos.
2. Confirmación **mixta**: la clienta declara "ya transferí" → estado "por verificar" → la dueña verifica manualmente.
3. **Sin comprobante** (upload de imagen) en v1.
4. Plazos **configurables**: una ventana para declarar (default 24 h) y otra para que la dueña verifique (default 48 h; vacío = sin límite, opt-in explícito).
5. **Reusar `PaymentProvider.manual`** + `paymentMethod: 'transferencia'`. NO se agrega `bank_transfer` al enum (el `switch` de `factory.ts:26` no es exhaustivo-checked; agregar un valor al enum crea un hueco silencioso en runtime).
6. **Reusar la UI de `ManualPaymentDialog`** para verificar, con monto pre-cargado editable — pero apuntando a una server action nueva (ver §6.2; la action actual crea un Payment nuevo y dejaría huérfano el declarado).
7. Los datos bancarios son visibles para cualquiera que llegue al paso de pago con transferencia elegida. Aceptado y explícito: son datos que la dueña hoy manda por WhatsApp a desconocidos.

## 3. Modelo de datos

### 3.1 `BankTransferAccount` (modelo nuevo, 1:1 con Business)

`PaymentAccount` no sirve de molde (`accessTokenEncrypted` es NOT NULL y no tiene campos legibles). Modelo propio:

```prisma
model BankTransferAccount {
  id            String   @id @default(cuid())
  businessId    String   @unique
  business      Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  accountHolder String   // nombre del titular
  rut           String   // RUT del titular
  bankName      String
  accountType   String   // "corriente" | "vista" | "ahorro" — texto libre, sin enum
  accountNumber String
  email         String?  // email para avisar la transferencia (opcional)
  instructions  String?  // texto libre de la dueña ("poner nombre y fecha en el asunto")
  isEnabled     Boolean  @default(true)
  // Ventanas configurables (decisión 4). Viven acá y no en Business:
  // toda la config de transferencia queda en un solo modelo y un solo form.
  holdHours     Int      @default(24)  // plazo para transferir y declarar
  verifyHours   Int?     @default(48)  // plazo para que la dueña verifique; null = sin límite
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

Texto plano (no es un secreto: la dueña quiere que se vean). Migración vía flujo normal (`migrate dev` + revisar el .sql por DROPs de ramas hermanas antes de commitear).

### 3.2 Sin migración de enums ni de estados

Verificado contra `prisma/schema.prisma`: `PaymentProvider.manual`, `PaymentStatus.pending`, `PaymentType.deposit` y `BookingStatus.pending_payment` ya existen. El estado "transferencia por verificar" **no es una columna**: se deriva como

> booking `pending_payment` **+** Payment(`provider: manual`, `paymentMethod: 'transferencia'`, `status: pending`, `type: deposit`, `providerPaymentId: "bt-declared:<bookingId>"`)

### 3.3 `providerPaymentId` determinístico (idempotencia + discriminador)

El unique `@@unique([bookingId, provider, providerPaymentId])` **no muerde con NULL** (comentario explícito en el schema): un doble click en "Ya transferí" crearía dos Payments. Fix sin migración: `providerPaymentId = "bt-declared:" + bookingId`. Efectos:

- El unique sí muerde → el create duplicado tira P2002 → la action lo captura y responde éxito (idempotencia real).
- Sirve de discriminador: distingue "declarada por la clienta" de un pago manual con `paymentMethod: 'Transferencia'` que la dueña registró por su cuenta (hoy ya posible vía `ManualPaymentDialog`). El badge "por verificar" del dashboard solo mira los `bt-declared:`.

### 3.4 Efectos verificados de un Payment `pending` (por qué esto no rompe nada)

- `Booking.paymentStatus` solo lo escriben la creación y `recalcBookingFromPayments`, que suma **exclusivamente** `status: 'approved'` (`finance.ts:225-247`). Un pending no toca `paymentStatus`, `depositPaid` ni `remainingBalance` → el filtro del cron (`paymentStatus: 'unpaid'`) sigue matcheando y la reserva expira sola si nadie actúa.
- Ledger, finanzas y totalPaid por clienta solo cuentan approved → inmunes.
- `getPayments` lista todos los payments sin filtrar status → la fila pending **aparece en la tabla Pagos del dashboard** con su badge "Pendiente" existente. Deseado: es visibilidad extra, no un bug.

## 4. Ciclo de vida

```
elige transferencia ──► booking pending_payment, hold = ahora + holdHours (24h)
        │
        ├─ no declara a tiempo ──► cron expireStaleHolds la expira (sin cambios de query)
        │
        ▼
"Ya transferí" (declare) ──► Payment manual/pending/bt-declared creado (idempotente)
        │                    hold = ahora + verifyHours (48h) o NULL si verifyHours es null
        │                    email a la dueña
        │
        ├─ dueña VERIFICA ──► Payment approved + booking confirmed (§6.2)
        ├─ dueña RECHAZA ───► Payment rejected + booking cancelled (§6.3)
        └─ nadie actúa ─────► cron la expira + cancela el Payment pending + email a la clienta (§7)
```

Guards de transición (todas las actions mutan con `updateMany` + guard de status dentro de una transacción, nunca `update` a ciegas — el cron corre en paralelo):

- **declare**: guard `status: 'pending_payment'` AND `holdExpiresAt > now`. Si `count === 0` → error "tu reserva expiró, volvé a reservar"; NO crea Payment ni notifica. Cierra la carrera declare-vs-cron en ambas direcciones (el cron ya re-chequea status/hold dentro de su propia tx).
- **verificar**: ver §6.2 (incluye re-chequeo de cupo).
- **rechazar**: guard `status: 'pending_payment'`.

**Booking `expired` es terminal en v1.** Si el cron la expiró antes de que la dueña verificara, la verificación falla con mensaje claro: "Esta reserva expiró. Registrá el pago creando la reserva de nuevo desde el calendario." No revivimos expiradas: revivir exige re-validar cupo + re-crear holds y no lo justifica el caso borde (la dueña controla `verifyHours` justamente para darse el margen que necesite).

## 5. Flujo público (wizard de reserva)

### 5.1 Disponibilidad de métodos

`getOnlinePaymentAvailability` queda **como está** (es MP-específica y la consumen también settings e `initiatePayment`, que debe seguir siendo un gate MP-only). Se agrega una consulta separada de disponibilidad de transferencia: `BankTransferAccount.isEnabled` + `effectiveDeposit > 0`. El paso de pago combina ambas:

| MP | Transferencia | Paso de pago muestra |
|----|---------------|----------------------|
| ✔ | ✔ | selector de método (decisión 1) |
| ✔ | ✘ | flujo MP actual, sin cambios |
| ✘ | ✔ | transferencia directo |
| ✘ | ✘ | fallback actual |

- Con `effectiveDeposit === 0` (servicio sin abono, o promo/paquete que lo deja en 0) la opción transferencia **no aparece** — mismo tratamiento que MP hoy (rama "Confirmar reserva").
- **Copys a corregir**: los `reason` de `factory.ts:330,339` y el fallback de `step-payment.tsx:443` dicen "coordina el abono directamente por WhatsApp o transferencia". Cuando la transferencia sea un método real del sistema, ese texto es confuso: reescribir a "coordina el abono directamente con el negocio" (sin la palabra "transferencia").

### 5.2 Crear la reserva con método transferencia

No existe "extender el hold al elegir": la booking se crea recién al click del botón de pago y el hold nace dentro de `createBooking` (`bookings.ts:301`). Entonces:

- `createBooking` acepta un parámetro nuevo `paymentMethod?: 'bank_transfer'`. Si viene:
  - valida server-side que el negocio tenga `BankTransferAccount.isEnabled` y `effectiveDeposit > 0` (nunca confiar en el cliente);
  - setea `holdExpiresAt = now + holdHours` en vez de +15 min.
- **Trampa verificada**: con promo o paquete, `recomputeBookingAmountsAfterDiscount` (`recompute.ts:25`) pisa `holdExpiresAt` a +15 min incondicionalmente dentro de la misma tx. El recompute recibe la duración del hold como parámetro (o re-setea después del update). Sin este fix, toda transferencia con promo pierde su ventana de 24 h.

### 5.3 Pantalla de datos bancarios + declarar

Tras crear la booking en modo transferencia, el paso muestra: monto exacto del abono (server-authoritative: `min(depositRequired, remainingBalance)`), datos de `BankTransferAccount` (titular, RUT, banco, tipo, número, email, instrucciones), botón copiar datos, la ventana de tiempo ("tenés 24 h para transferir y avisarnos"), y el botón **"Ya transferí"**.

`declareBankTransfer(bookingId)` — server action nueva, flujo público sin sesión (misma postura de seguridad que `initiatePayment`/`verifyAndConfirmPayment`: la identidad es el `bookingId` cuid + rate limit con `checkRateLimit`, patrón `payments.ts:64`). Dentro de una tx:

1. `updateMany` de la booking con guard (§4) seteando `holdExpiresAt = now + verifyHours` (o `NULL` si `verifyHours` es null). `count === 0` → error legible.
2. `create` del Payment `manual/'transferencia'/pending/deposit` con monto calculado server-side y `providerPaymentId: "bt-declared:" + bookingId`. P2002 → tratar como éxito (ya declaró).
3. Post-tx: email a la dueña (§8).

Después de declarar, el wizard muestra "Transferencia en verificación — te avisaremos cuando el negocio la confirme" **más el link persistente a `/book/confirmation?bookingId=`** (el paso final del wizard es efímero; esa página es la fuente de verdad, §5.5).

### 5.4 Volver atrás y pagar con MP (bug latente a cerrar)

Verificado: `BookingData.idempotencyKey` nunca se persiste (`wizard.tsx:29-43`) y `step-payment.tsx:244` genera una nueva por montaje. Si la clienta eligió transferencia (booking creada, hold 24 h), vuelve atrás y elige MP, el remount genera otra key → segundo `createBooking` para el mismo slot → **rechazado por su propia booking**. La clienta queda bloqueada de su horario 24 h.

Fix: persistir la `idempotencyKey` en el estado del wizard la primera vez que se genera (via `updateData`), de modo que cualquier re-submit reuse la misma booking; el path MP paga contra esa booking existente vía `initiatePayment` (ya acepta cualquier booking pagable, `payments.ts:100-113`). Si paga MP con el hold de 24 h vigente, el webhook confirma y el hold largo se vuelve irrelevante. Si abandona, el hold de 24 h retiene el cupo — es exactamente lo que la ventana significa; aceptado.

### 5.5 Página de confirmación (`/book/confirmation`)

Dos cambios verificados como necesarios:

1. La query filtra `payments: { where: { provider: 'mercado_pago' } }` (`page.tsx:33`) → incluir también `manual` (o quitar el filtro y filtrar en derive).
2. `deriveConfirmationState` (`confirmation-state.ts`):
   - **Primero** corta por `booking.status`: `expired` → estado nuevo "expirada" ("Tu reserva expiró porque no se completó el pago a tiempo"); `cancelled` → "cancelada". Hoy derive no mira ninguno de los dos y mostraría "verificando tu pago" sobre una reserva muerta.
   - Después: Payment `manual` pending con `bt-declared:` → `verifying`, con copy provider-aware ("Estamos verificando tu transferencia. El negocio la confirmará a la brevedad") — la copy actual de `verifying` dice "Mercado Pago está procesando el pago" hardcodeado (`page.tsx:71`).
   - El caso MP-abandonado no se rompe: ya muestra `verifying` hoy (el Payment MP pending se pre-crea antes del redirect).

## 6. Flujo dueña (dashboard)

### 6.1 Sección "Transferencias por verificar"

En la página de Reservas, un bloque arriba de la tabla listando las bookings `pending_payment` con Payment `bt-declared:` pendiente: clienta, servicio, fecha de la reserva, monto declarado, **antigüedad de la declaración** ("hace 3 h"), y acciones Verificar / Rechazar. Este bloque es el contrapeso obligatorio de `verifyHours = null`: si la dueña elige "sin límite", lo único que evita cupos congelados para siempre es que esta lista esté visible con antigüedad.

Requiere que `getBookings` incluya payments (hoy no los trae, `bookings.ts:153-163`) — select acotado (`id, provider, status, paymentMethod, providerPaymentId, amount, createdAt`), no el objeto entero.

En la tabla de reservas misma, esas filas muestran el badge derivado "Transferencia por verificar" (variante naranja) en lugar del "Pendiente de pago" genérico. Es un label derivado en la página (booking.status no cambia), no una key nueva del enum en `STATUS_MAPS.booking`.

### 6.2 Verificar — `confirmBankTransfer(paymentId, amount)`

Se reusa la **UI** de `ManualPaymentDialog` (monto pre-cargado con el declarado, editable, método fijo "Transferencia") apuntando a una action nueva. No se reusa `createManualPayment`: verificado que siempre crea un Payment nuevo (`payments.ts:428-443`) → dejaría el declarado huérfano en pending y duplicaría la fila.

Dentro de una tx, en este orden (cada paso cierra un bug verificado):

1. Cargar booking + Payment pending. Si el Payment no está `pending` → error ("ya fue procesado"). Si la booking está `expired`/`cancelled` → error terminal (§4). Si la booking ya tiene un Payment `approved` (p. ej. pagó MP después de declarar) → error "esta reserva ya tiene el abono pagado" — cierra el doble cobro.
2. **Si `holdExpiresAt < now`: re-validar el cupo** — correr el chequeo de solape de slot dentro de la tx. Con el hold vencido, availability ya estaba ofreciendo ese horario (`slots.ts:96-101`) y otra clienta pudo tomarlo; `applyApprovedPayment` no re-chequea solape, confirmaría a ciegas un doble-booking. Si el slot ya está tomado → error claro a la dueña ("el horario ya fue tomado por otra reserva; contactá a la clienta para reagendar"). Con `holdExpiresAt = NULL` (verifyHours sin límite) este paso no aplica: NULL sigue **bloqueando** el cupo (`validation.ts:163`), nadie pudo tomarlo.
3. Si el hold venció: `updateMany` de la booking (guard `status: 'pending_payment'`) seteando `holdExpiresAt` a un valor futuro corto (now + 1 h), solo para esquivar `assertBookingPayable` — que tira con `pending_payment` + hold vencido (`booking-payments.ts:28-34`) y se re-ejecuta con re-fetch dentro de `applyApprovedPayment` (`finance.ts:108-120`); el update previo en la misma tx hace que el re-fetch lo vea. El valor exacto da igual: el paso 5 confirma la booking inmediatamente.
4. `update` del Payment: `amount` al valor editado por la dueña y `paymentType` re-derivado con `deriveManualPaymentType` — `applyApprovedPayment(paymentId)` exige igualdad **exacta** de amount y paymentType (`finance.ts:137-148`); sin este update previo, el "monto editable" revienta.
5. `applyApprovedPayment(paymentId, ...)` — aprueba, recalcula saldos, crea ledger, transiciona `pending_payment → confirmed` y dispara la notificación de pago recibido existente.

### 6.3 Rechazar — `rejectBankTransfer(paymentId)`

Action nueva sin precedente directo (nada pone hoy un Payment manual en `rejected`). Dentro de una tx:

1. Payment `pending` → `rejected` (guard de status).
2. Booking → `cancelled` con guard `status: 'pending_payment'` + liberar el canje de promo si hay (mismas piezas que `cancelBooking`, `bookings.ts:961-1013`, que es el precedente pero no toca Payments).
3. Post-tx: email a la clienta con copy propia ("El negocio no pudo verificar tu transferencia; tu reserva fue cancelada. Si transferiste, contactalo directamente") — la copy genérica de cancelación no explica el motivo.

El cupo vuelve solo: availability excluye `cancelled`. Nota para derive: con Payment `rejected` + booking `cancelled`, el corte por status de §5.5 (cancelada primero) evita la copy engañosa actual de `rejected` ("tu reserva quedó pendiente").

## 7. Cron (`expireStaleHolds`) — cambios acotados

La **query no cambia**: una declarada mantiene `paymentStatus: 'unpaid'` (§3.4), así que si `holdExpiresAt` vence sin verificación, el cron la expira solo. Lo que sí cambia (el "cero cambios al cron" del diseño v2 no se sostenía):

1. Tras expirar el lote, buscar los Payments `manual`/`pending` con `providerPaymentId LIKE 'bt-declared:%'` de esas bookings y marcarlos `cancelled`. Sin esto quedan huérfanos en pending para siempre y derive mostraría "verificando" sobre reservas muertas.
2. Para esas mismas bookings (transferencia declarada, no el checkout MP abandonado), enviar email a la clienta: "Tu reserva expiró sin que se verificara el pago. Si transferiste, contactá al negocio." **Best-effort**: `Customer.email` es opcional en el flujo público; si no hay email no llega a nadie y la página de confirmación es la fuente de verdad (mostrará "expirada", §5.5). Usar `sendNotificationSafely` — un fallo de email no debe romper el cron.

Verificar la cadencia real del cron en la config de Vercel (no hay `vercel.json` en el repo; la memoria del proyecto dice que corre cada hora) y documentarla en el plan: con cadencia horaria, una reserva puede vivir hasta ~1 h pasada su ventana.

## 8. Notificaciones (solo email; whatsapp.ts solo construye links)

| Evento | A quién | Mecanismo |
|---|---|---|
| Declaró transferencia | Dueña (+admins) | Nuevo. Patrón `getBusinessOwnerEmails` + `sendNotificationSafely` (mismo esquema que `sendNewBookingNotificationToBusiness`). Incluye clienta, servicio, fecha, monto y link al dashboard. |
| Transferencia verificada | Clienta | Existente: `applyApprovedPayment` ya dispara la notificación de pago recibido. |
| Transferencia rechazada | Clienta | Nuevo, copy propia (§6.3). Best-effort. |
| Reserva expirada con transferencia declarada | Clienta | Nuevo, desde el cron (§7). Best-effort. |

## 9. Settings (dashboard → Pagos)

Sección nueva "Transferencia bancaria" en `settings/payments`: form client component nuevo (la página actual es server component sin forms controlados) con los campos de `BankTransferAccount`, toggle habilitar/deshabilitar, y las dos ventanas con explicación en horas ("plazo para que la clienta transfiera", "plazo para verificar — vacío = sin límite" con advertencia de que sin límite el cupo queda retenido hasta que la dueña actúe).

Server actions: `saveBankTransferAccount` + `setBankTransferEnabled` en un archivo de actions nuevo. **Landmine conocido**: los módulos `'use server'` solo pueden exportar funciones async — el schema Zod y cualquier const/tipo van en un módulo aparte (precedente con comentario: `business-settings.ts:15-16`). Ya causó dos 500 en settings.

## 10. Seguridad

- `declareBankTransfer`: sin sesión, identidad = `bookingId` cuid + rate limit — consistente con `initiatePayment`. Impacto de una declaración falsa: bajo (la dueña verifica; lo peor es retener un cupo `verifyHours` horas, y la sección §6.1 lo hace visible).
- Todas las mutaciones server-side re-validan: `isEnabled`, `effectiveDeposit > 0`, monto calculado en el server, guards de status en tx.
- Datos bancarios visibles a cualquiera que elija transferencia en el wizard: aceptado (decisión 7).
- `confirmBankTransfer`/`rejectBankTransfer`: solo miembros del negocio (guard de autorización estándar de las actions de dashboard).

## 11. Fuera de alcance v1

- Upload de comprobante.
- Verificación automática contra API bancaria / reconciliación.
- Transferencia para el **saldo restante** (solo abono/deposit; el saldo sigue registrándose con `createManualPayment` como hoy).
- Webpay u otros providers.
- Revivir bookings expiradas (§4).
- Recordatorios intermedios ("te quedan 2 h para transferir").

## 12. Testing

- **Integration (Postgres real, patrón `packages-actions.test.ts`)**: `declareBankTransfer` (feliz, idempotencia por doble click → un solo Payment, guard con hold vencido → error y cero Payments, monto server-side ignora el cliente); `confirmBankTransfer` (feliz con monto editado ≠ declarado, hold vencido + slot re-tomado → error, booking expired → error, doble pago MP-aprobado → error); `rejectBankTransfer` (Payment rejected + booking cancelled + redemption liberada); cron extendido (expira + cancela Payment declarado; no toca declaradas con hold vigente; no manda email si la clienta no dejó email).
- **Unit**: `deriveConfirmationState` con los casos nuevos (expired/cancelled cortan primero; manual pending → verifying; MP-abandonado sigue igual); disponibilidad de métodos (tabla de §5.1); recompute no pisa el hold parametrizado.
- **Component (`renderToStaticMarkup` + mock `next/navigation`)**: paso de pago con selector de métodos, pantalla de datos bancarios, sección "por verificar" del dashboard.
