# Campañas — Envío masivo (bulk send)

**Fecha:** 2026-07-18
**Rebanada:** última de Rama C (campañas). Construye sobre C1 (#78), opt-out (#80), C-email (#83) y cleanups C1 (#86).
**Estado:** diseño aprobado → siguiente paso `writing-plans`.

---

## 1. Meta

Que la dueña envíe una campaña a **toda la lista** sin recorrer fila por fila:

- **Email** → un botón "Enviar todos los emails" que drena en tandas desde el navegador, con barra de progreso en vivo.
- **WhatsApp** → un modo "guiado" que abre los `wa.me` de a uno, un toque por clienta, avanzando solo.

**Sin migración, sin cron nuevo, sin columnas nuevas.** `CampaignRecipient.sentAt` es el marcador de progreso durable (ya idempotente por diseño de C1/C-email).

## 2. Por qué los dos canales son asimétricos (restricción de base)

- **Email** (`sendCampaignEmail`, `src/server/actions/campaigns.ts:149-182`) envía **server-side** vía Resend y marca `sentAt` solo si el envío triunfa. Es **totalmente automatizable**: un loop puede recorrer todas.
- **WhatsApp** (`sendCampaignMessage`, `campaigns.ts:127-143`) **no envía nada**: mintea el grant y devuelve un `wa.me` que el cliente abre para que la dueña toque "enviar" a mano. **No se puede automatizar** sin WhatsApp Business API (que no tenemos). El máximo alcanzable es un walk-through de un toque por clienta.

Por eso "masivo" significa cosas distintas por canal, y el diseño los trata distinto.

## 3. Decisiones cerradas (no re-litigar)

1. **Alcance:** cubre ambos canales — email masivo en background (por tandas) + WhatsApp guiado.
2. **Motor de email:** por tandas desde el navegador (client-driven chunked). Descartado el drainer por cron: la escala de un salón (decenas a bajos cientos por segmento) no lo amerita, evita migración + configurar un schedule en Vercel (paso externo bloqueado), es instantáneo/visible, y es resumible gratis (mint + `sentAt` idempotentes). Si algún día hay listas de miles o se quiere fire-and-forget, se migra al patrón `sendReminders` (claim CAS) — anotado, no ahora.
3. **WhatsApp guiado — marcado optimista:** abrir el `wa.me` marca `sentAt` y avanza (un toque por clienta), igual que el envío por fila de hoy. Si la dueña abre pero no manda, queda "Enviado" (puede reenviar). El grant se mintea igual.
4. **Promo archivada (isActive=false) entre crear la campaña y enviar:** el envío masivo **corta y avisa** (fail-fast) — respeta la intención de archivar y evita emitir beneficios contra una promo apagada (que además se ven en la tarjeta aunque fidelización esté off). Gate barato en `prepareCampaignSend`.
5. **`maxRedemptions`:** **no se enforca** en el minteo (YAGNI). Las promos de campaña se crean inline sin tope por defecto; el riesgo de sobre-emisión es teórico.
6. **Botones por fila actuales:** se **mantienen**. El masivo es aditivo, no reemplaza el flujo per-fila existente.

## 4. Hallazgos de la auditoría de integración y sus fixes

La auditoría (3 agentes sobre notificaciones/rate-limit, loyalty/grants, concurrencia/staleness) destapó gaps que un diseño aislado no veía. El diseño los incorpora:

### 4.1 🔴 Doble-envío de email — requiere claim atómico

`sentAt` se marca con read-then-write (no CAS): `sendCampaignEmail` hace `campaignRecipient.update({ sentAt: recipient.sentAt ?? new Date() })` (`campaigns.ts:177-180`) donde `recipient.sentAt` se leyó sin lock en `prepareCampaignSend` (`src/lib/campaigns/send.ts:37-58`). El envío a Resend ocurre **antes** de escribir `sentAt` (`campaigns.ts:164-171`). Dos tandas solapadas (dos pestañas, doble-clic, retry del cliente) pasan ambas con `sentAt` null → **la misma clienta recibe dos emails**. El grant es idempotente por `requestId` (`src/lib/campaigns/mint.ts:22-26`), el email **no**.

**Fix:** antes de llamar a Resend, hacer un claim atómico estilo `src/lib/cron/send-reminders.ts:58-66`:
```
const claim = await db.campaignRecipient.updateMany({
  where: { id: recipientId, sentAt: null },
  data: { sentAt: now },
})
if (claim.count === 0) return { sent: false, skipped: 'already_sent' }
// ... enviar por Resend ...
// si el envío falla: liberar → updateMany({ where:{ id, sentAt: now }, data:{ sentAt: null } })
```
El claim reserva la fila; el envío solo procede si `count===1`; se libera en caso de falla para permitir reintento. **WhatsApp no necesita este claim** (no envía server-side; un doble-fire solo produce dos `waUrl`, no dos mensajes), pero el modo guiado igual filtra `sentAt==null` en el cliente.

### 4.2 🔴 Minteo secuencial — nunca `Promise.all`

`prepareCampaignSend` abre una **transacción interactiva por destinataria** (`send.ts:70-82`). Bajo el pgbouncer `connection_limit=1` de este proyecto, un fan-out con `Promise.all(recipients.map(...))` explota con P2028 (landmine documentada en `src/lib/loyalty/card-data.ts:27-31`). **El loop de la tanda itera secuencial** (`for … of` con `await`). No hay `pg_advisory_xact_lock` en el mint, así que no hay deadlock — el riesgo es puramente agotar el pool.

### 4.3 🔴 Rate limit de email + techo de Resend

- El bucket `send-campaign-email` está en **30/min por usuario** (`src/lib/rate-limit.ts:51`, `campaigns.ts:151`) — bloquearía el bulk tras 30 emails. **Fix:** bucket propio `send-campaign-bulk-email` con presupuesto holgado, keyed por `{userId, businessId}`.
- Resend tiene su propio techo (~2/s por cuenta) que **hoy nadie respeta**: un `resend.emails.send` por llamada (`src/lib/notifications/email-provider.ts:136-144`), **sin batch API, sin retry de 429, sin backoff** (`email-provider.ts:146-163`). **Fix:** tandas chicas (~10) secuenciales — la latencia de red de cada `resend.emails.send` (~200-500ms) pacea naturalmente a ~2/s y cabe en el timeout por defecto. Si el server detecta un 429/`error` retryable, corta la tanda y devuelve una señal de backoff; el cliente espera y reintenta (idempotente por el claim liberado).
- **`maxDuration`:** no hay config en el repo (ni `vercel.json` ni `export const maxDuration`), así que la action corre bajo el timeout por defecto (~10-15s). Tandas de ~10 envíos secuenciales caben; **no** aumentamos `maxDuration` (mantener chunks chicos es más simple y suficiente).

### 4.4 🟡 Manejo por-ítem, revalidación y queries

- **Catch-and-skip por ítem** en ambos caminos: opt-out (puerta 2 tira throw en `send.ts:61-63`), destinataria borrada (`onDelete: Cascade`, `schema.prisma:894` → `ForbiddenError` en `send.ts:59`), contacto inválido (email no `isEmailable` → `{sent:false}`; teléfono no whatsappeable → `waUrl:null`), promo archivada (nuevo gate). Un ítem que falla **no aborta** la tanda; se tallа y se reporta al final.
- **Contacto es LIVE, no snapshot:** `CampaignRecipient` guarda solo `campaignId, customerId, grantId, sentAt` (`schema.prisma:889-901`); email/teléfono se leen live de `Customer` (`send.ts:42-47`). El snapshot congela **quién** está en la lista, no **cómo** contactarla — cambios de contacto se manejan como skip.
- **Revalidar una vez al final:** la página `[id]` es `force-dynamic` (`page.tsx:14`); un `router.refresh()` por destinataria = N refetches completos de `getCampaignDetail`. El cliente refresca **una sola vez** al terminar la tanda/loop.
- **Izar el reply-to:** `getBusinessReplyToEmail` (`email-provider.ts:182-185`) corre una query por email → resolverlo **una vez por tanda** y pasarlo a cada envío.

### 4.5 🟢 Limpio — sin acción

Los grants de campaña **no escriben ledger ni mueven puntos ni KPIs**: `createGrantInTx` solo crea la fila `promotionGrant` (`src/lib/loyalty/grant.ts:53-71`), `pointsSpent:0`, `refundOnExpiry:false`. `getFinancialSummary`/balances agregan `ledgerEntry`/`loyaltyLedger`, intactos. Mintear en masa no descuadra nada. No hay contención sobre la promo (no se toca `redemptionCount` al mintear).

## 5. Riesgo aceptado (documentado, no se resuelve acá)

**Dominio FROM compartido + colisión con crons.** El FROM es un `FROM_EMAIL` global de toda la app (`email-provider.ts:97-99`), no per-business; los crons de recordatorios usan el mismo key de Resend con `Promise.all` sin límite (`src/lib/cron/transfer-reminders.ts:124,201,263,323`). Una campaña masiva grande concentra reputación de spam en ese dominio y puede colisionar con un cron corriendo a la vez, degradando también el mail transaccional. Aislarlo (dominios Resend per-business) es otro proyecto. **Mitigación barata opcional (fuera de alcance por defecto):** un tope suave que avise si la campaña supera N destinatarias de email.

## 6. Arquitectura

### 6.1 Email masivo — por tandas

**Nueva server action** `sendCampaignEmailBatch(campaignId: string)`:
1. `requireBusinessRole(['owner','admin'])`.
2. Rate limit `send-campaign-bulk-email` (bucket nuevo, holgado).
3. Query de la próxima tanda: los primeros ~10 `CampaignRecipient` de la campaña con `sentAt: null` cuyo `Customer` tiene canal email y sin opt-out (fuente de verdad server-side; no confía en IDs del cliente).
4. Resolver `getBusinessReplyToEmail` **una vez**.
5. `for` secuencial sobre la tanda; por recipient:
   - **claim atómico** (`updateMany where sentAt:null → count===1`); si 0 → skip `already_sent`.
   - `prepareCampaignSend` (mint idempotente + render) con **gate de promo activa** (corta si `!promotion.isActive`).
   - `sendOneCampaignEmail` (helper extraído del cuerpo actual de `sendCampaignEmail`) → `resend.emails.send`.
   - si falla: **liberar** (`sentAt` → null) + registrar `{name, message}`; si 429/retryable → marcar `retryAfter` y cortar la tanda.
6. Devuelve `{ sent, skipped, failed, errors: [{name, message}], remaining, retryAfter? }`.

**Cliente** (en `recipient-list.tsx`, extraído a `BulkSendControls`):
- Botón "Enviar todos los emails (N)" donde N = email-pendientes contados de los props.
- Loop: llama `sendCampaignEmailBatch`, actualiza barra `sent/total`, repite mientras `remaining > 0`; si `retryAfter` → espera y reintenta.
- "Pausar" opcional (deja de llamar; reanuda idempotente por el claim).
- Al terminar: **un** `router.refresh()` + lista de fallidas (nombre + motivo).

### 6.2 WhatsApp guiado — un toque por clienta

**No necesita action nueva** — reusa `sendCampaignMessage(recipientId)`.

**Cliente (solo UI, en `BulkSendControls`):**
- Arma la cola ordenada de whatsapp-pendientes filtrando `sentAt == null` de los props (los props ya traen `sentAt`, `page.tsx:79`; orden `customer.name asc`, `campaigns.ts:114`).
- Tarjeta enfocada con la clienta actual. Un clic (un gesto de usuario):
  1. `window.open('', '_blank')` sincrónico (patrón anti-bloqueo actual, `recipient-list.tsx`).
  2. `await sendCampaignMessage(id)` → mintea + marca `sentAt` + devuelve `waUrl`.
  3. `win.location.href = waUrl`.
  4. avanza el puntero al próximo pendiente → progreso `k/total`.
- Opt-out mid-cola (throw) → salta con nota y avanza. Cola vacía → "Listas las N de WhatsApp ✓".
- Los botones por fila siguen existiendo (aditivo).

## 7. Componentes / archivos

- **`src/server/actions/campaigns.ts`** — nueva `sendCampaignEmailBatch`; refactor: extraer el cuerpo de envío de `sendCampaignEmail` a un helper compartido en `send.ts`.
- **`src/lib/campaigns/send.ts`** — `sendOneCampaignEmail(db, businessId, recipientId, replyTo, createdByUserId)` (extraído, idéntico comportamiento); `claimRecipientForSend`/`releaseRecipientClaim` (CAS helpers); `listPendingEmailRecipients(db, campaignId, limit)`; **gate de promo activa** dentro de `prepareCampaignSend`. Como `prepareCampaignSend` es el core compartido, el gate aplica **también al envío por-fila** (single send) — consistente y deseable: enviar contra una promo archivada falla-rápido en cualquier camino. Es un cambio de comportamiento menor del single-send existente, intencional.
- **`src/lib/rate-limit.ts`** — bucket `send-campaign-bulk-email`.
- **`src/app/dashboard/campanas/[id]/recipient-list.tsx`** — extraer `BulkSendControls` (barra de email + tarjeta guiada de WhatsApp) para no engordar el archivo; los botones por fila quedan.

## 8. Manejo de errores

- Por-ítem tolerado y tallado; la tanda nunca aborta en bloque.
- Opt-out mid-batch → skipped (no failed).
- Resend falla → grant persiste (idempotente), `sentAt` liberado → reintentable re-corriendo el bulk.
- 429/retryable → tanda corta + `retryAfter` → el cliente hace backoff.
- Email no `isEmailable` / teléfono no whatsappeable → skipped.
- Promo archivada → error visible "esta promo está pausada".

## 9. Testing

- **Unit:** `sendOneCampaignEmail` se comporta idéntico al cuerpo actual; el claim atómico bloquea el segundo envío; `sendCampaignEmailBatch` cuenta bien `sent/skipped/failed/remaining` y **tolera throws** por-ítem sin abortar; gate de promo archivada corta.
- **Integración (Docker PG `agendita-test-pg` :5433):** drenar una campaña mixta con 1 opt-out + 1 sin email + 1 promo archivada → `sent/skipped` correctos; **re-run no manda nada** (idempotente); dos loops solapados **no** producen doble-email (claim).
- **Componente:** la barra avanza; el guiado de WhatsApp filtra las enviadas y llama la action; **mock de `next/navigation`** (landmine: `useRouter()` throws sin mock).

## 10. Fuera de alcance (YAGNI)

- Sin migración, sin cron, sin columna de estado/error/canal en el recipient (`sentAt` es el progreso).
- Sin "programar envío para después".
- Sin tracking de aperturas/clicks (fuera de Rama C; necesitaría infra nueva).
- Sin `maxRedemptions` enforcement, sin dominios Resend per-business.
- WhatsApp sigue manual/optimista (sin Business API).
- El tope suave anti-spam queda como mitigación opcional documentada, no se construye por defecto.
