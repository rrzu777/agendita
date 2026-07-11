# Revivir reservas expiradas — diseño

**Fecha:** 2026-07-11 · **Estado:** aprobado (decisiones del usuario + doble auditoría de gaps)
**Contexto:** feature #2 del backlog post-transferencia-bancaria (specs 2026-07-10 y 2026-07-11). Hoy `expired` es terminal: si la clienta transfirió pero el cron expiró la reserva antes de la verificación, `confirmBankTransfer` responde "creá la reserva de nuevo desde el calendario". Este feature reemplaza ese dead-end.

## 1. Decisiones del usuario

1. **Alcance:** la dueña (owner|admin) puede revivir **cualquier** reserva expirada, no solo las de transferencia.
2. **Destino:** el diálogo ofrece **dos salidas**: "Confirmar reserva" (expired → confirmed) o "Dar nuevo plazo para pagar" (expired → pending_payment con hold nuevo).
3. **Ventana:** regla natural por salida. Confirmar vale incluso con turno pasado (registra lo que ocurrió). Dar plazo solo con turno futuro (guard server-side, no solo UI).
4. **Promos:** la revivida **mantiene el precio descontado** aunque la redemption se haya liberado al expirar. Se acepta el posible sobre-uso del cap de la promo (caso raro); no se re-reclama ni se recalcula. Documentar en comentario.

## 2. Action `reviveBooking` (núcleo)

Archivo nuevo `src/server/actions/revive-booking.ts` — `'use server'`, **solo funciones async exportadas** (landmine conocida); el tipo/const del modo (`'confirm' | 'reopen'`) vive en `src/lib/` si hace falta compartirlo.

```
reviveBooking(bookingId: string, mode: 'confirm' | 'reopen'): Promise<{ ok: true }>
```

Requiere `requireBusinessRole(['owner','admin'])`. Todo dentro de una `prisma.$transaction`:

1. `findFirst({ where: { id: bookingId, businessId } })` — cargar la booking del negocio (guard cross-tenant; hallazgo A4). Error claro si no existe o `status !== 'expired'`.
2. **Chequeo de solape puro** (ver §3) cuando aplica:
   - `confirm` + turno futuro: sí. `confirm` + turno pasado: no (el constraint de la DB es la red, ver paso 4).
   - `reopen`: siempre (además del guard "turno futuro").
3. Según modo:
   - **`confirm`**: `updateMany where { id, businessId, status: 'expired' } data { status: 'confirmed', holdExpiresAt: null }`. CAS: `count === 0` → "Esta reserva ya fue modificada".
   - **`reopen`** (solo si `paymentMethod === BANK_TRANSFER_METHOD` **y** la cuenta de transferencia del negocio existe y está `isEnabled` — ver §5): mismo `updateMany` guard pero `data { status: 'pending_payment', holdExpiresAt: addHours(now, account.holdHours), transferReminderCustomerSentAt: null, transferReminderBusinessSentAt: null }`. El reset de flags rehabilita los recordatorios del cron (validado: los where de `transfer-reminders.ts` exigen flag null).
   - **`reopen` además cancela los Payments MP viejos**: `tx.payment.updateMany where { bookingId, provider: 'mercado_pago', status: { in: ['pending','in_process'] } } data { status: 'cancelled' }`. Sin esto, `deriveConfirmationState` mostraría "verifying" sin salida y el recordatorio-clienta quedaría bloqueado (hallazgo A3/B2). El webhook MP es idempotente frente a esto (revalida contra el Payment local).
4. **Constraint `Booking_no_overlap`** (EXCLUDE parcial sobre pending_payment/confirmed/completed): el `updateMany` puede violarlo aun cuando el chequeo de solape pasó — p.ej. otra `pending_payment` con hold recién vencido que el assert considera libre pero el EXCLUDE cuenta; o el confirm de turno pasado sin chequeo (hallazgo A1). Envolver la tx en try/catch que detecte la violación (Postgres 23P01, llega como error genérico de Prisma — detectar por `Booking_no_overlap` en el mensaje) y traducirla a `"Ese horario ya está ocupado por otra reserva."`.
5. **Los Payments no se tocan** en `confirm` (el bt-declared `cancelled` queda como histórico; el abono se registra después con `ManualPaymentDialog`/`createManualPayment`, flujo existente). La redemption liberada no se re-reclama (decisión 4).
6. La tx retorna el `holdExpiresAt` escrito (para el email — no recalcular fuera; hallazgo A10).

Post-tx: emails (§6), `revalidatePath('/dashboard/bookings' | '/dashboard' | '/dashboard/payments')` + `await revalidateBusinessPublicPaths(businessId)` (landmine del await).

**`VALID_STATUS_TRANSITIONS` no se toca** (`expired: []` en `bookings.ts:62`): el path genérico `updateBookingStatus` no sabe re-validar cupo; se agrega un comentario en el mapa apuntando a `reviveBooking` como único camino de salida de `expired`.

## 3. Chequeo de solape puro (variante de disponibilidad)

`assertSlotIsAvailable` exige además servicio activo, duración igual a la actual, regla del día activa y `bookingWindowDays` — cualquiera de esas rechazaría revives legítimos de una cita ya pactada (hallazgo A6). Se agrega en `src/lib/availability/validation.ts` una función `assertSlotFreeOfConflicts({ tx, businessId, startDateTime, endDateTime, excludeBookingId })` que:

- Toma el **mismo advisory lock** por negocio+día que `assertSlotIsAvailable` (serializa contra `createBooking`/`rescheduleBooking`).
- Valida **solo** solapes contra reservas activas (`pending_payment` con hold vigente o null, `confirmed`, `completed`) y bloqueos de tiempo (vía `getEffectiveBlocks`, el read-path canónico de bloques).
- Sin lead time, sin ventana, sin chequeo de servicio (equivale a `leadTimeMinutes: 0` y reglas ignoradas).

Implementación: extraer/reusar la porción de solapes de `assertSlotIsAvailable` para no duplicar la lógica. `confirmBankTransfer` **no** se migra a la variante en este PR (mismo landmine pre-existente, fuera de alcance — anotar como follow-up).

## 4. Fix a `declareBankTransfer` (pre-requisito del reopen)

En `src/server/actions/bank-transfer-public.ts`, el check de idempotencia hoy hace `findFirst` por `providerPaymentId` **sin filtrar status** → tras un reopen, el Payment `bt-declared` `cancelled` produce éxito silencioso sin declarar nada. Cambia a distinguir por status del Payment existente:

- `pending` o `approved` → éxito idempotente, sin tocar nada (el `approved` es alcanzable vía confirmación parcial y reactivarlo corrompería el ledger — hallazgo A2; `rejected` es inalcanzable porque rechazar cancela la booking — hallazgo B5 — pero si apareciera cae en el else de abajo por robustez).
- `cancelled` (o `rejected`) → **reactivar**: dentro del **mismo guard de carrera existente** (`updateMany booking { status:'pending_payment', holdExpiresAt > now }` que setea el hold según `verifyHours`), `tx.payment.update` a `{ status: 'pending', amount: min(depositRequired, remainingBalance), createdAt: now }`. El `createdAt = now` es semánticamente "declaró de nuevo" y evita que el recordatorio-dueña rama `verifyHours=null` (24h desde `createdAt`) dispare al instante. Notifica a la dueña como declaración nueva (mismo email).
- Cuando el guard de carrera da `count === 0`, el mensaje deja de ser siempre "Tu reserva expiró…": diferenciar por `booking.status` (expirada vs cancelada vs ya confirmada) — hallazgo A9.

El test de integración existente "doble declare = un solo Payment" conserva su semántica (rama `pending`); se agregan tests del camino `cancelled → pending` (hallazgo B11).

## 5. UI — `ReviveBookingDialog`

- **Punto de entrada:** filas `expired` de `/dashboard/bookings`. Hoy `booking-row-actions.tsx:58-62` corta con `isActionable = confirmed || pending_payment` → se agrega la rama expired con el botón/ítem **"Revivir"**, y el bloque correspondiente en la **card móvil** (`bookings/page.tsx:121-166`, hoy solo tiene ramas confirmed y pending_payment) — hallazgo B6. El calendario/drawer no ofrece revivir en v1.
- **Diálogo** (client component nuevo `src/components/dashboard/revive-booking-dialog.tsx`, patrón de referencia `verify-transfer-dialog.tsx`: dos acciones, `useTransition` + `router.refresh()`, error inline): muestra servicio/clienta/fecha/saldo pendiente y las dos salidas:
  - **"Confirmar reserva"** — siempre disponible.
  - **"Dar nuevo plazo para pagar"** — solo si turno futuro **y** `paymentMethod === 'bank_transfer'` **y** cuenta habilitada; si no, deshabilitada con explicación corta ("el turno ya pasó" / "esta reserva no eligió transferencia" / "la transferencia está deshabilitada"). El server re-valida las tres condiciones (hallazgos A8/B2 — una reserva MP reabierta caería en una página sin CTA de pago; v1 no reabre MP).
- Si la clienta **no tiene email**, el diálogo avisa "Esta clienta no tiene email: avisale por WhatsApp" (reusar `BookingContactButtons`) — hallazgo B9.
- Errores de la action (horario ocupado, ya modificada) se muestran inline en el diálogo.
- Copy en voseo, consistente con las superficies de transferencia ("tenés", "avisale").

## 6. Emails (best-effort, patrones existentes)

- **`confirm` + turno futuro:** `sendBookingConfirmedNotification(bookingId, businessId)` tal cual (ya cubre clienta+dueña). Turno pasado: sin email.
- **`reopen`:** template nuevo `transferReactivatedCustomerHtml/Text` — "tu reserva fue reactivada, tenés hasta {deadline} para transferir y avisarnos" — reusando `bankTransferBlockHtml/Text` + `getBookingConfirmationUrl` (extraídos en PR #65 para esto). Como el reopen exige cuenta habilitada, el bloque bancario siempre tiene datos válidos. `deadline` = el `holdExpiresAt` retornado por la tx. Sin email de clienta (email nullable) no se manda nada — el aviso del diálogo (§5) cubre el hueco.
- **Copy adjacent:** el email "tu reserva expiró" (`sendBankTransferExpiredToCustomer`) suma una línea "el negocio también puede reactivar tu reserva — escribile si ya transferiste" (hallazgo B12), y el error de `confirmBankTransfer` sobre expiradas pasa de "creá la reserva de nuevo desde el calendario" a **"Esta reserva expiró. Revivila desde Reservas y después verificá el pago."** (hallazgo B4; el caso `cancelled` conserva el consejo actual).

## 7. Fixes de superficie incluidos en el mismo PR

- **Home** (`src/app/dashboard/page.tsx:48-52,177-185`): `upcomingBookings` excluye solo cancelled/no_show → una expirada futura aparece en "Próximas citas" con label crudo "expired" e infla el contador. Excluir `expired` del filtro (hallazgo B7).
- **Drawer del calendario** (`booking-drawer.tsx:36-49,79-80`): agregar `expired` a `statusLabels`/`statusBadgeClasses` ("Expirada", gris, coherente con `status-badge.tsx:12`) (hallazgo B8).

## 8. Qué NO cambia (validado por auditoría)

- Crons: sin carreras dañinas. `expire-holds` re-afirma todo su where en tx (una reopened con hold futuro no matchea); una reopened que nadie paga re-expira sola, re-cancela el bt-declared reactivado y re-manda el email — ciclo idempotente.
- `/mi`, `/book/confirmation`, `PendingTransfersSection`, StatusBadge, `getBookings`, `/dashboard/customers/[id]`, tabla de Pagos (ledger): se acomodan solos tras revive/re-declaración; cero cambios.
- `deriveConfirmationState`: el bt-declared `cancelled` no contamina (`isDeclaredTransferPayment` exige `pending`); tras reopen deriva `pending` y `canDeclare` rehabilita el TransferPanel.
- `rescheduleBooking` sigue bloqueando expiradas (primero revivir, después reprogramar).
- Sin migración de schema: cero columnas nuevas.
- Recordatorio pre-cita (`reminderSentAt`): una revivida-confirmada con turno a >23h lo recibe normal (flag quedó null); a <23h no — igual que cualquier confirmación tardía. Documentado, sin fix.

## 9. Tests

- **Unit** (db mock): guards (no expired / cross-tenant / reopen turno pasado / reopen sin transferencia habilitada → errores), CAS count=0, reset de flags + hold correcto en reopen, cancelación de MP pendings, traducción del error de constraint.
- **Integration** (DB test 5433): expirar → revive confirm (turno futuro y pasado); reopen → re-declarar (reactivación del Payment `cancelled`, unique intacto, hold según `verifyHours`, notificación dueña); conflicto de cupo con **TimeBlock** (landmine: el EXCLUDE impide seedear dos bookings activas solapadas — y a la vez un test puede provocar el 23P01 real para la traducción del error usando una booking `completed` solapada, que el EXCLUDE sí cubre y el chequeo de solape... también cubre; usar el TimeBlock para el assert y una `completed` solapada para el catch del constraint en confirm-turno-pasado); declare idempotente rama `pending` (test existente intacto).
- **Component**: `ReviveBookingDialog` (landmine: `renderToStaticMarkup` + mock de `next/navigation`).

## 10. Fuera de alcance

Revivir canceladas; revivir desde el calendario/drawer; botón de pago MP en `/book/confirmation` (habilitaría reopen para MP — anotado como candidato futuro); migrar `confirmBankTransfer` a `assertSlotFreeOfConflicts` (follow-up); re-reclamo de redemptions.
