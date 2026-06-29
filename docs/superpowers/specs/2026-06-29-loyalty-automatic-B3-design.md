# B3 — Condiciones automáticas (fidelización) · Diseño

> **Estado:** spec. Rebanada B3 de la iniciativa promociones + fidelización.
> Índice: `../2026-06-28-promotions-loyalty-roadmap.md` · Brief: `../briefs/2026-06-28-B-fidelizacion.md`
> Predecesoras MERGEADAS: A (motor de promos por código), B1 (núcleo de puntos), B2 (canje).

## 1. Objetivo

Reglas de fidelización **automáticas** que emiten una recompensa (un **grant** reusable
o **puntos** directos) sin código, evaluadas server-side cuando ocurre un evento del
negocio (reserva completada, reseña, referral) o en un barrido temporal (cumpleaños,
aniversario, win-back). Reusa el motor unificado: una regla = `Promotion(triggerType='automatic')`
con `conditions` JSON, emitiendo por las primitivas ya existentes de B1 (ledger) y B2 (grants).

**En alcance (6 condiciones):** `first_visit`, `review`, `referral` (event-driven) +
`birthday`, `anniversary`, `winback` (cron diario).

**Fuera de alcance:** campañas proactivas multi-destinatario (C); login de clienta (D);
endurecimiento anti-fraude de referidas con identidad fuerte (D).

## 2. Decisiones cerradas (brainstorming)

- **Modelo:** reglas = `Promotion(triggerType='automatic')` + `conditions` JSON. No hay
  entidad nueva de "regla" (respeta el motor unificado ya cerrado en el roadmap).
- **Recompensa:** puntos **o** grant. `Promotion.rewardPoints != null` ⇒ acredita puntos;
  `null` ⇒ emite un grant (reusa `rewardType`/`rewardValue`/servicios/expiración como B2).
- **Precedencia:** `Promotion.priority` configurable. En una **misma ocasión** gana la de
  mayor prioridad y se emite **una sola**. La ocasión del barrido temporal es `(clienta, día)`;
  los eventos discretos (completar/reseña/referral) son ocasiones separadas y disparan c/u.
  **Limitación documentada:** coincidencias cross-canal (ej. cumpleaños por cron el mismo día
  que primera-visita por evento) pueden emitir ambas — coordinarlo cruzaría canales y no se
  justifica en este corte.
- **Referidas:** premio a la **1ª reserva completada** de la referida; beneficiaria
  (`both`/`referrer`/`referred`) y montos **configurables**. Default `both`.
- **Clawback (G5):** `LoyaltyConfig.clawbackAutoRewardOnRefund` (default **false**). No es
  explotable por la clienta (los reembolsos los inicia la dueña/MP). Si se activa, solo las
  recompensas gatilladas por reserva (`first_visit`, `referral`) se reversan al reembolsar
  esa reserva; las temporales nunca.
- **Reseña (G6):** premio al **enviar** la reseña, cualquier rating, cap 1 por reserva
  (dedup natural por `Review.bookingId @unique`). No se condiciona a aprobación ni a rating
  para no "comprar" rating positivo (sesgaría las reviews).
- **Notificación (G4):** B3 incluye un **email transaccional simple** (reusa `notifications`)
  para birthday/winback/referral. Campañas reales → C. La recompensa siempre queda visible en
  "Mi tarjeta" → "Mis recompensas" (B2).
- **Una regla por (negocio, kind)** (M1): a lo sumo una regla automática activa por tipo.
- **Gate `config.isActive`** (M3): programa pausado ⇒ ninguna regla automática emite.

## 3. Disparadores

| kind | Cuándo | Enganche |
|---|---|---|
| `first_visit` | 1ª reserva completada de la clienta | `updateBookingStatus(completed)`, en la tx, tras `creditVisitPoints` |
| `review` | reseña enviada | `submitReview` (envuelto en tx; dedup por `bookingId`) |
| `referral` | 1ª reserva completada de la referida | misma tx de completar (flip del `Referral` pendiente) |
| `birthday` | cumpleaños ±`windowDays` (TZ del negocio) | cron diario |
| `anniversary` | aniversario de `firstCompletedAt` ±`windowDays` | cron diario |
| `winback` | última completada hace ≥ `inactivityDays`, sin emitir en `cooldownDays` | cron diario |

**Cron:** `src/lib/cron/loyalty-automatic.ts` (`runAutomaticLoyalty(now)`) +
`src/app/api/cron/loyalty-automatic/route.ts` (Bearer `CRON_SECRET`, molde de `send-reminders`) +
step en `.github/workflows/cron.yml`. Corre cada hora pero es **idempotente** (§5), así que
emite a lo sumo una vez por ocasión aunque se ejecute 24×/día.

**TZ:** "hoy" se evalúa en la `timezone` del negocio. `birthDate` es `@db.Date`; se comparan
mes/día. `firstCompletedAt` ídem para aniversario.

## 4. `conditions` JSON (validado con Zod por kind)

```jsonc
{
  "kind": "birthday|first_visit|review|anniversary|winback|referral",
  "windowDays": 7,        // birthday/anniversary
  "inactivityDays": 90,   // winback
  "cooldownDays": 180,    // winback
  "beneficiary": "both|referrer|referred"  // referral
}
```

Recompensa (campos de `Promotion`): `rewardPoints` (puntos) **o** `rewardType`+`rewardValue`+
`services`/`appliesToAll`+`grantExpiryDays` (grant). Validación: una regla automática define
exactamente una de las dos formas.

## 5. Idempotencia / dedup (uniforme grant + puntos)

- **Puntos:** `LoyaltyLedger.dedupeKey String?` + `@@unique([businessId, dedupeKey])` (NULL
  múltiple permitido en Postgres → visit/adjustment intactos). Reason nuevo `bonus`
  (+ `bonus_reversal` para clawback). Los `bonus` van con `bookingId = null` +
  `metadata.triggeringBookingId` para no chocar con `@@unique([bookingId, reason])` cuando
  `first_visit` y `referral` caen en la misma reserva.
- **Grants:** `requestId` determinista ⇒ reusa `@@unique([customerId, requestId])` de B2.
  Emitidos con `pointsSpent = 0` y **`refundOnExpiry = false`** (G1: nunca se pagaron puntos,
  no hay reembolso fantasma en vencimiento).
- **dedupeKey / requestId por kind:**
  - barrido temporal (birthday/anniversary/winback): **por ocasión** →
    `${customerId}:${YYYY-MM-DD}:auto-timed`. Una vez que cualquier regla temporal emitió para
    esa clienta ese día, ninguna otra dispara — aunque el cron reintente (G3). Esto hace la
    precedencia determinista e idempotente.
  - `first_visit`: `${customerId}:first_visit`
  - `review`: `${customerId}:review:${bookingId}`
  - `referral`: `${referredCustomerId}:referral` (+ flip atómico del `Referral`).

## 6. Emisor compartido

`emitAutomaticReward(tx, { businessId, customerId, rule, dedupeKey, requestId, triggeringBookingId? })`:
- `rule.rewardPoints != null` ⇒ `loyaltyLedger.create({ reason:'bonus', points, dedupeKey,
  bookingId:null, metadata:{ triggeringBookingId, ruleId } })`. P2002 ⇒ ya emitido, no-op.
- si no ⇒ emite grant (reusa `generateGrantCode` de B2; `pointsSpent:0`, `refundOnExpiry:false`,
  `forfeitOnNoShow` de config, `expiresAt` desde `grantExpiryDays`, `requestId`,
  `metadata:{ triggeringBookingId, ruleId, auto:true }`). P2002 ⇒ ya emitido, no-op.
- Envía el email transaccional (G4) best-effort tras emitir (no rompe la tx si falla; patrón
  `sendNotificationSafely`).

**Precedencia en el barrido temporal:** por clienta, juntar las reglas temporales que matchean,
ordenar por `priority` desc, intentar emitir la primera con la dedupeKey de ocasión; si el
insert gana (no P2002), listo; si pierde (ya había emisión de ocasión), no se emite otra.

## 7. Referidas

- Entidad `Referral { id, businessId, referrerCustomerId, referredCustomerId @unique,
  status: ReferralStatus(pending|rewarded|void), triggeringBookingId String?, rewardedAt
  DateTime?, createdAt }` + índices `[businessId, status]`, `[referrerCustomerId]`.
- **Link:** URL pública de reserva con `?ref=<loyaltyToken referidora>` (reusa token de "Mi
  tarjeta", lazy vía `resolveOrCreateToken`). "Mi tarjeta" muestra "Referí a una amiga" con
  prefill wa.me (molde de `getReviewWhatsappLink`).
- **Captura** en `createBooking` (público): si llega `ref` válido, la clienta es **nueva** (sin
  match por teléfono en el negocio) y su teléfono ≠ el de la referidora ⇒ `Referral.create(pending)`.
  Guard self-referral (M4). Falla suave: si el ref es inválido, la reserva se crea igual sin referral.
- **Emisión** en `updateBookingStatus(completed)` de la referida: flip atómico
  `updateMany({ where:{ referredCustomerId, status:'pending' }, data:{ status:'rewarded',
  rewardedAt, triggeringBookingId } })`; si `count===1`, emite a referida y/o referidora según
  `beneficiary`. Idempotente por el flip + dedupeKeys.

## 8. Clawback (configurable, default off)

Si `LoyaltyConfig.clawbackAutoRewardOnRefund`: al reembolsar/cancelar la reserva gatillante
(en el path que ya llama `releaseRedemptionForBooking` — webhook MP `refunded` y cancel/no_show),
`reverseAutoRewardsForBooking(tx, bookingId)`:
- puntos: busca `loyaltyLedger` con `metadata.triggeringBookingId == bookingId` y reason `bonus`
  sin reversa; inserta `bonus_reversal` por `-points` (idempotente por dedupeKey de reversa).
- grant: busca grants automáticos (`metadata.triggeringBookingId == bookingId`); si `active`
  ⇒ flip a `reversed`; si ya `redeemed`/aplicado, se respeta (ya se usó). Idempotente por guard.
- Las recompensas temporales (sin `triggeringBookingId`) nunca se tocan.

## 9. Integración con módulos existentes (gaps cerrados)

- **G2:** `listPromotions` pasa a filtrar `triggerType: 'code'` (excluye `automatic` y `granted`)
  para no mezclar reglas automáticas en la lista de promos por código.
- **Apply/release/expiry (B2):** un grant automático es un `PromotionGrant` normal ⇒ se aplica,
  libera y vence por los mismos paths sin cambios (salvo `refundOnExpiry=false` ya cubierto).
- **Earn (B1):** `first_visit` y `creditVisitPoints` coexisten (welcome + puntos de visita).
- **view.ts:** labels `bonus: 'Bonificación'`, `bonus_reversal: 'Reversa de bonificación'` (M5).
- **Denormalización (M2):** `Customer.firstCompletedAt` se setea en la 1ª completación (sirve a
  `first_visit` y a `anniversary`, y evita escanear bookings en el cron).

## 10. Delta de schema (migración aditiva)

- `enum LoyaltyReason` +`bonus` +`bonus_reversal`
- `enum ReferralStatus { pending, rewarded, void }`
- `Promotion` +`rewardPoints Int?` +`priority Int @default(0)`
- `LoyaltyLedger` +`dedupeKey String?` + `@@unique([businessId, dedupeKey])`
- `LoyaltyConfig` +`clawbackAutoRewardOnRefund Boolean @default(false)`
- `Customer` +`firstCompletedAt DateTime?` + relaciones a `Referral`
- modelo `Referral` (arriba)

**Gate de migración:** se aplica a la DB **solo con confirmación explícita** del usuario; nunca
prod sin OK. Al generar con `prisma migrate diff --script > file`, **verificar que no se cuele la
línea de ruido del shell** (`zsh: command not found: _nvm_load`) en la línea 1 del `.sql` (pasó en B2).

## 11. Testing

- **Unit:** matchers puros birthday/anniversary/winback (TZ, bordes de ventana, cooldown);
  `emitAutomaticReward` (puntos vs grant, P2002 no-op); precedencia por prioridad + dedup de
  ocasión; referral flip; clawback on/off; validación Zod de `conditions` por kind.
- **Integración (Postgres real):** cron sweep idempotente (correr 2× ⇒ una emisión); apply de un
  grant automático; clawback al reembolsar con flag on.
- **e2e Playwright (header bypass, sin contraseñas):** configurar reglas en `/dashboard/fidelizacion`;
  primera-visita; reseña→premio; referral end-to-end (link → reserva nueva → completar → ambas
  premiadas); gate `config.isActive`. Suite completa verde.

## 12. Reglas de repo (recordatorio)

Módulos `'use server'` exportan **solo funciones async**; todo `revalidate*` con `await`;
currency-clean (`formatMoney`); e2e por header bypass (`x-e2e-test-user-email` +
`x-e2e-auth-secret`, `ENABLE_E2E_AUTH_BYPASS=true`, env vía `dotenvx -f .env.local`).
