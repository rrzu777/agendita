# Recordatorios intermedios de transferencia bancaria — Design Doc

**Fecha:** 2026-07-11
**Estado:** aprobado (incorpora dos rondas de auditoría de mecánica + integración contra el código real)
**Feature:** #1 de los 6 items que estaban fuera de alcance del v1 de transferencia bancaria.

## 1. Contexto y objetivo

La feature de abono por transferencia bancaria (PRs #60/#61/#63/#64) está completa: la clienta elige transferir, ve los datos, declara "ya transferí", y la dueña verifica/rechaza desde el dashboard. Pero **nada empuja a nadie antes de que se venza un plazo**:

- La clienta que eligió transferir y cerró la pestaña sin declarar pierde el cupo cuando el hold vence (el cron `expireStaleHolds` la expira en silencio salvo el email de "tu reserva expiró", que llega *después*).
- La dueña que no entra al dashboard en días puede dejar una transferencia declarada sin verificar hasta que expira — y si configuró `verifyHours=null` (sin límite), el cupo queda **congelado para siempre** (landmine conocido; hoy solo lo mitiga el banner del dashboard de PR C).

**Objetivo:** dos recordatorios best-effort por email, disparados por el cron horario existente, que empujen a actuar *antes* del vencimiento:

1. **Clienta** que eligió transferencia y **aún no declaró**, con el hold por vencer → "transferí y avisanos antes de perder el cupo" + datos bancarios + link a la página de confirmación.
2. **Dueña** con una transferencia **declarada sin verificar** que está envejeciendo → "verificá antes de que la reserva expire" + link al dashboard. **Cubre también el caso `verifyHours=null`** (la red de seguridad del cupo congelado).

## 2. Decisiones de producto (cerradas con el usuario)

1. **Ambos** recordatorios (clienta pre-declaración + dueña declarada-sin-verificar).
2. **Offsets constantes en código, no configurables por negocio** (decisión "A"): cero superficie nueva de settings. Upgrade a configurable después es trivial (reemplazar la constante por un campo del negocio) sin retrabajo de la lógica de envío.
3. **Un solo aviso por evento** (no re-recordatorios escalonados).
4. **Solo email.** WhatsApp en la app es link-only (no hay envío automático). Clienta = best-effort (email opcional); dueña = `getBusinessOwnerEmails`.
5. Copy sin número exacto de horas ("te quedan pocas horas" / "hoy") — con cron horario + jitter no se puede prometer "2h" sin mentir.

## 3. Constantes

Al tope de `src/lib/cron/transfer-reminders.ts` (los módulos de cron NO son `'use server'`, así que las constantes pueden vivir junto a la función; el route solo importa la función):

```ts
export const CUSTOMER_REMINDER_HOURS_BEFORE_HOLD = 3   // clienta: avisar cuando faltan ≤3h para que venza el hold
export const BUSINESS_REMINDER_HOURS_BEFORE_VERIFY = 6 // dueña (verifyHours seteado): avisar 6h antes de vencer
export const BUSINESS_REMINDER_HOURS_AFTER_DECLARE = 24 // dueña (verifyHours=null): avisar a las 24h de declarada
```

Con cron horario (`0 * * * *`, hasta ~15 min de atraso), un offset de 3h/6h es cómodo para no perderse por el jitter.

## 4. Modelo de datos (1 migración, 2 columnas)

Dos flags `DateTime?` en `Booking`, espejo del `reminderSentAt` existente (que es para la cita confirmada 24h antes — distinto evento, distinta población, sin colisión):

```prisma
// en model Booking
transferReminderCustomerSentAt DateTime? // CAS del aviso a la clienta (pre-declaración)
transferReminderBusinessSentAt DateTime? // CAS del aviso a la dueña (declarada sin verificar)
```

El timestamp hace doble función: marca "enviado" y es el token de claim del compare-and-swap (mismo patrón que `reminderSentAt`, `send-reminders.ts:60`).

**Migración shared-DB** (landmine `migrate-via-db-execute-needs-resolve`): aplicar con `prisma db execute` + `prisma migrate resolve --applied <migration>`, NO `migrate dev`. Revisar el `.sql` por DROPs de ramas hermanas antes de commitear (landmine `migrate-diff-picks-up-sibling-branches`).

## 5. Selección (queries del cron)

### 5.1 Recordatorio a la clienta (pre-declaración)

Booking que eligió transferir, hold por vencer, y **todavía no declaró ni está pagando por MP**:

```ts
where: {
  status: 'pending_payment',
  paymentStatus: 'unpaid',                 // defensivo, consistente con expire-holds
  paymentMethod: BANK_TRANSFER_METHOD,     // '@/lib/bank-transfer/declared'
  transferReminderCustomerSentAt: null,
  holdExpiresAt: { gt: now, lte: addHours(now, CUSTOMER_REMINDER_HOURS_BEFORE_HOLD) },  // ≤3h para vencer, aún no vencido
  // No declaró AÚN, y no hay un pago MP en vuelo (evita nudge mid-MP → doble pago):
  payments: {
    none: {
      OR: [
        declaredTransferPaymentWhere,                     // '@/lib/bank-transfer/declared'
        { provider: 'mercado_pago', status: 'pending' },
      ],
    },
  },
  // Ventana corta: si el negocio puso holdHours ≤ 3, el offset no tiene sentido
  // (dispararía apenas se crea la reserva). Gatear por el account.
  business: { bankTransferAccount: { isEnabled: true, holdHours: { gt: CUSTOMER_REMINDER_HOURS_BEFORE_HOLD } } },
},
```

`customer.email` presente se chequea en código (skip best-effort si falta), no en el where.

### 5.2 Recordatorio a la dueña (declarada sin verificar, envejeciendo)

Booking con una transferencia declarada pendiente, en **dos ramas** para cubrir `verifyHours=null`:

```ts
where: {
  status: 'pending_payment',
  transferReminderBusinessSentAt: null,
  OR: [
    // (a) verifyHours seteado → holdExpiresAt = now+verifyHours; avisar 6h antes de vencer
    {
      holdExpiresAt: { gt: now, lte: addHours(now, BUSINESS_REMINDER_HOURS_BEFORE_VERIFY) },
      payments: { some: declaredTransferPaymentWhere },
    },
    // (b) verifyHours=null → holdExpiresAt NULL tras declarar; avisar a las 24h de declarada
    {
      holdExpiresAt: null,
      payments: { some: { ...declaredTransferPaymentWhere, createdAt: { lte: subHours(now, BUSINESS_REMINDER_HOURS_AFTER_DECLARE) } } },
    },
  ],
},
```

Rama (b) es la red de seguridad del cupo congelado: sin ella, `holdExpiresAt=null` nunca entraría a una ventana "6h antes de vencer" y la dueña no recibiría nada justo en el caso más riesgoso.

**Reusar `declaredTransferPaymentWhere` / `BANK_TRANSFER_METHOD`** de `@/lib/bank-transfer/declared` — nunca reescribir el trío provider+status+prefijo a mano (el comentario del módulo lo advierte). El bt-declared discrimina la declaración de la clienta de un pago manual de la dueña (`providerPaymentId=null`), así que la rama de la dueña nunca agarra un pago manual.

### 5.3 Exclusividad y transiciones (verificado en la auditoría)

- Clienta (`payments: { none: declared }`) y dueña (`payments: { some: declared }`) son **mutuamente excluyentes** por estado de declaración — una reserva no puede estar en ambas.
- Al declarar, la reserva sale de la query de la clienta y entra a la de la dueña: **handoff limpio**.
- Rechazar/cancelar/expirar una declarada **siempre** saca la reserva de `pending_payment` (verificado: `rejectBankTransfer`, `cancelBooking`, `expireStaleHolds` transicionan booking + cancelan el Payment declarado en la misma tx). No hay camino que deje un Payment fuera de `pending` con la booking en `pending_payment` → no hay re-nudge por "declarada→rechazada→sin-declarar".

## 6. Envío: compare-and-swap con `where` completo

El cron es at-least-once (dos corridas concurrentes pueden leer el mismo lote). El claim atómico es un `updateMany` condicional — **pero re-afirmando el predicado completo, no solo el flag**:

```ts
// Para CADA booking del findMany, antes de enviar:
const claim = await prisma.booking.updateMany({
  where: { id: booking.id, ...FULL_PREDICATE_DE_5.1_O_5.2 },  // status + payments + ventana + flag:null
  data: { transferReminderCustomerSentAt: now },              // (o Business)
})
if (claim.count === 0) { skipped++; continue }  // otra corrida ganó, O el estado cambió (declaró/verificó) en la carrera
// ... enviar email ...
// si el email falla → liberar el flag (volver a null) para reintentar en la próxima corrida
```

**Por qué el `where` completo:** el CAS de `send-reminders` chequea solo `flag:null` (seguro ahí: una cita confirmada no cambia de estado en la ventana de carrera). Acá el estado SÍ cambia — declarar/verificar son exactamente los eventos contra los que corre el recordatorio. Un CAS flag-only mandaría "andá a transferir" a una clienta que recién declaró, o "verificá" a una dueña que recién verificó. Re-afirmar el `where` (como hace `expireStaleHolds`, `expire-holds.ts:47-53`) cierra esa carrera. `updateMany.where` acepta tanto el rango escalar como el filtro de relación `payments`.

Interacción con `expire-holds` (verificado): actúa sobre `holdExpiresAt < now`; el recordatorio exige `holdExpiresAt > now` (rama a) → excluyentes. Los dos steps del cron corren secuenciales con expire-holds primero. El `status='pending_payment'` re-afirmado en el CAS cierra el borde de corridas solapadas.

**Dedupe de reply-to por negocio** (patrón del simplify de PR C, `expire-holds.ts:105-128`): resolver `getBusinessReplyToEmail` una vez por negocio distinto, no por booking, y mandar los emails en paralelo (`Promise.all` con `sendNotificationSafely`, que traga sus propios errores).

## 7. Plomería (endpoint + cron)

Convención del repo: una función de cron ⇒ una route ⇒ un step `curl` (verificado: `expire-holds`, `send-reminders`, `loyalty-automatic` siguen exactamente eso). **Nuevo endpoint, no fold-in** — `expire-holds` es una transacción de transición de estado; los recordatorios son side-effects best-effort; acoplarlos metería envíos de email dentro/alrededor del boundary de la tx. El scan es barato de repetir; la separación de concerns vale más.

- `src/lib/cron/transfer-reminders.ts` — `sendTransferReminders(now = new Date(), db = prisma, deps?)` con `deps` inyectable para los senders (testeable como `expireStaleHolds`). Devuelve `{ customerSent, businessSent, skipped, errors }`.
- `src/app/api/cron/transfer-reminders/route.ts` — auth `Bearer CRON_SECRET`, mismo patrón que `expire-holds/route.ts` (GET+POST → handler).
- `.github/workflows/cron.yml` — un step `curl` nuevo `POST $BASE_URL/api/cron/transfer-reminders`.

## 8. Emails (reuse, no re-armar)

### 8.1 Extracción compartida (pre-requisito, evita divergencia)

PR B ya tiene el bloque de datos bancarios (titular/RUT/banco/tipo/cuenta/email/instrucciones + **plazo** + **link a confirmación**) pero **inline** dentro de `bookingReceivedCustomerHtml/Text` (`templates.ts:146-161` y `:205-222`), consumiendo `BookingEmailData.bankTransfer` (`types.ts:32-42`). Y el link de confirmación está copiado a mano en `bookings.ts:110` y en los returns de MP (`payments.ts:162,192`).

Extraer **antes** de escribir los templates nuevos:

1. `bankTransferBlockHtml(bt, opts)` + `bankTransferBlockText(bt, opts)` en `templates.ts`, sacados de esas líneas exactas; `bookingReceivedCustomer*` pasa a llamarlos (sin cambio de output). El template del recordatorio a la clienta **embebe el mismo sub-objeto `bankTransfer`**, no campos planos → los datos/plazo/link nunca divergen del email de reserva recibida.
2. `getBookingConfirmationUrl(business, bookingId)` en `src/lib/business/urls.ts` (usa `getBusinessPublicUrl` + `/book/confirmation?bookingId=`); lo llaman el sender de PR B, los returns de MP y el recordatorio nuevo. El cron debe `select` `slug` + `subdomain` del negocio para construirlo (mirror `send-reminders.ts:36-37`).
   - Nota (quirk pre-existente, NO se arregla acá): para negocios sin subdominio `getBusinessPublicUrl` antepone `/b/<slug>`, dando `/b/<slug>/book/confirmation`, ruta que no existe (la real es top-level `book/confirmation`). Es un bug compartido con los returns de MP; centralizarlo en un helper es justo donde un fix futuro aterrizaría. Fuera de alcance de este feature.

### 8.2 Templates + senders nuevos

Reusar primitivas: `baseHtml`, `header`, `footer`, `fmtDate` (en timezone del negocio), `fmtCurrency`, `bookingNumberRowHtml`. Estructura como `bookingReminderHtml` (el reminder de cita), copy propio.

| Evento | A quién | Sender nuevo | Contenido |
|---|---|---|---|
| Recordatorio pre-declaración | Clienta | `sendTransferReminderToCustomer` | Voseo: "te quedan pocas horas para transferir el abono y avisarnos" + `bankTransferBlockHtml` (datos + monto + plazo) + link a `/book/confirmation?bookingId=` (botón "Ya transferí"). Best-effort (skip sin email). |
| Recordatorio declarada sin verificar | Dueña (+admins) | `sendTransferReminderToBusiness` | Voseo, misma voz "por verificar" del banner de PR C: "tenés una transferencia por verificar; revisá tu cuenta y confirmá o rechazá" + link a `/dashboard/bookings` (vía `buildDashboardLink()`, mismo target que el banner). `getBusinessOwnerEmails`. |

Asunto: `"<Asunto> - <negocio>"` (forma con guión, consistente con los otros senders de transferencia). Todo vía `sendNotificationSafely`.

Tipos nuevos en `types.ts` (el de la clienta embebe `bankTransfer: BookingEmailData['bankTransfer']`).

## 9. Superficies que NO cambian (YAGNI)

- **`/mi`** ya muestra "Transferencia en verificación"; **`/book/confirmation`** ya muestra `verifying_transfer` + `TransferPanel` con el plazo. Son las superficies durables a las que apunta el recordatorio. Un marcador "recordatorio enviado" es estado sin valor para el usuario → no se construye.
- **Dashboard**: el email a la dueña complementa (no duplica) el banner + sección "por verificar" de PR C; es el canal push cuando no está mirando.

## 10. Testing

- **Unit del cron** (mock `db` + `deps` inyectables, patrón `expire-holds.test.ts`): selección correcta de cada rama (clienta ≤3h; dueña verifyHours-seteado 6h antes; dueña verifyHours=null a las 24h); **exclusión del MP pendiente** (no nudge mid-MP); **guard de holdHours≤3** (no envía); CAS re-afirma el `where` → no envía si declaró/verificó en la carrera; libera flag en fallo de email; skip sin email de clienta; dedupe de reply-to por negocio.
- **Integration** (Postgres real): siembra transferencia sin declarar con hold ≤3h → corre → flag seteado + un solo envío (segunda corrida no reenvía); siembra declarada con verifyHours=null y `Payment.createdAt` de hace 25h → dispara la rama (b); siembra declarada con hold >6h → NO dispara todavía; siembra con MP pendiente → NO dispara la clienta.
- **Unit de templates**: `bankTransferBlockHtml/Text` extraído produce el mismo output que antes en `bookingReceivedCustomer*` (test de regresión); los dos templates nuevos contienen datos/plazo/link (clienta) y el link al dashboard + copy "por verificar" (dueña).
- Verificación final: `tsc --noEmit | grep ^src/` limpio, suite unit + integration verde, lint.

## 11. Fuera de alcance

- Recordatorios escalonados (más de uno por evento).
- WhatsApp automático.
- Configurabilidad de los offsets por negocio (decisión A; upgrade trivial después).
- Arreglar el quirk `/b/<slug>/book/confirmation` (pre-existente, compartido con MP; se centraliza el helper pero no se corrige el path acá).
- Los otros 5 items del backlog (comprobante, API bancaria, saldo restante, Webpay, revivir expiradas) — cada uno su propio ciclo.
