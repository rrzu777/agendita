# C1 — Campañas (blast WhatsApp + promo real) · Diseño

> Rebanada C1 de la capa **C (campañas/alcance)** del roadmap promociones+fidelización.
> Brief: `docs/superpowers/briefs/2026-06-28-C-campanas.md`. Índice: `docs/superpowers/2026-06-28-promotions-loyalty-roadmap.md`.

## Objetivo

La dueña elige un **segmento** de clientas y les hace llegar una **promo real** (un código de descuento/servicio-gratis) por **WhatsApp de un toque**. Cada mensaje lleva un `PromotionGrant` propio de esa clienta, emitido en el momento del envío. Cierra el loop del endgame: A/B generan el premio, C lo entrega.

## Alcance

**Dentro de C1:**
- Crear una campaña: elegir segmento + promo (del catálogo o inline) + editar el mensaje.
- 4 segmentos: cumpleañeras del mes, inactivas hace X días, frecuentes (≥N completadas), con saldo pendiente.
- Emisión perezosa de un grant gratis por clienta al tocar "Enviar por WhatsApp".
- Persistencia: `Campaign` + `CampaignRecipient` (idempotencia + "enviado ✓" + métricas derivadas).
- Captura opcional de `birthDate` en el flujo de reserva (para que el segmento de cumpleaños tenga audiencia).

**Fuera de C1 (rebanadas futuras):** canal email (Resend caído), envío masivo por WhatsApp Business API, plantillas guardadas reusables, opt-out/consentimiento de clientas, analytics de apertura/clic, segmentos configurables arbitrarios (con/sin reseña, etc.).

## Decisiones tomadas

1. **Enfoque A — mint perezoso al enviar.** El código se emite recién al tocar "Enviar" en esa fila; nadie que la dueña saltee se lleva un código huérfano ni consume stock.
2. **Promo: del catálogo o inline** (ambas). La inline se crea como `Promotion(triggerType:'granted')`.
3. **4 segmentos** (arriba).
4. **Persistencia Campaign + Recipient.**
5. **Campañas INDEPENDIENTES del programa de puntos:** emiten y se canjean aunque `LoyaltyConfig.isActive=false` (como los paquetes). El código viaja por WhatsApp y el apply al reservar no chequea `isActive`.
6. **Sumar captura de `birthDate`** en C1 (campo opcional en el flujo de reserva).
7. **Sin opt-out en C1** (igual al botón "pedir reseña por WhatsApp" ya existente: envío iniciado por la dueña, un toque por clienta). Anotado como responsable a futuro.

## Arquitectura

### Modelo de datos (migración aditiva)

```prisma
model Campaign {
  id              String              @id @default(cuid())
  businessId      String
  business        Business            @relation(fields: [businessId], references: [id], onDelete: Cascade)
  name            String
  segmentType     CampaignSegment
  segmentParams   Json?               // { inactiveDays?: number, frequentMin?: number } — snapshot
  promotionId     String
  promotion       Promotion           @relation(fields: [promotionId], references: [id], onDelete: Restrict)
  messageTemplate String
  createdByUserId String?
  createdAt       DateTime            @default(now())
  recipients      CampaignRecipient[]
  @@index([businessId, createdAt])
}

model CampaignRecipient {
  id         String          @id @default(cuid())
  campaignId String
  campaign   Campaign        @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  customerId String
  customer   Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
  grantId    String?         // el PromotionGrant emitido al enviar (null hasta el primer envío)
  grant      PromotionGrant? @relation(fields: [grantId], references: [id], onDelete: SetNull)
  sentAt     DateTime?
  @@unique([campaignId, customerId])
  @@index([campaignId])
}

enum CampaignSegment { birthday_month  inactive  frequent  pending_balance }
```

Migración a mano (NO `migrate dev`/`migrate diff` — arrastra ramas hermanas), aplicada a la DB compartida con `db execute` + `migrate resolve --applied` (landmine `migrate-via-db-execute-needs-resolve`). Relaciones inversas en `Business`, `Customer`, `Promotion`, `PromotionGrant`.

### Módulos nuevos

- `src/lib/campaigns/schema.ts` — Zod (`createCampaignSchema`, `campaignSegmentParamsSchema`), consts (defaults de X días / N frecuentes), tipos. **Lib plano** (no `'use server'`).
- `src/lib/campaigns/segments.ts` — queries de segmento puras/tx-aware: `queryCampaignSegment(db, businessId, segment, params, now): Promise<{ customerId, name, phone, birthDate, ... }[]>`. Una función por segmento, todas scopeadas por `businessId` + guard de teléfono válido.
- `src/lib/campaigns/message.ts` — `renderCampaignMessage(template, vars)` puro: sustituye `{nombre}`, `{codigo}`, `{vencimiento}`, `{negocio}`. + defaults de mensaje por segmento.
- `src/lib/campaigns/mint.ts` — `mintCampaignGrant(tx, { businessId, promotion, customerId, requestId, config, createdByUserId })`: modelado en `activatePackagePurchaseInTx` (NO `emitAutomaticReward`). `generateGrantCode` + `promotionGrant.create({ pointsSpent:0, refundOnExpiry:false, forfeitOnNoShow:false, status:'active', expiresAt })`. Idempotente por `@@unique([customerId,requestId])` + catch P2002.
- `src/server/actions/campaigns.ts` — `'use server'`: `createCampaign`, `sendCampaignMessage`, `getCampaigns`, `getCampaignDetail`, `listCampaignPromotions`. Sólo funciones async (landmine `use-server-export-boundary-pitfall`).

### Componentes / rutas

- `src/app/dashboard/campañas/page.tsx` (server) + `campaign-list.tsx` (client) + `new-campaign-dialog.tsx` (client) — mirror de `dashboard/promociones`.
- `src/app/dashboard/campañas/[id]/page.tsx` (server) + `recipient-list.tsx` (client) — la lista de destinatarias con botón "Enviar por WhatsApp" por fila.
- Entrada en `src/components/dashboard/sidebar.tsx` (después de Fidelización). Nota: `mobileItems = slice(0,4)` → no entra al nav móvil inferior (ok).
- Extraer `<RewardFields>` compartido (hoy el editor de recompensa está duplicado inline en `promotion-form.tsx` y `redemption-catalog.tsx`) y reusarlo en el alta inline de promo de campaña.

## Flujos

### Crear campaña
1. Dueña abre "Nueva campaña" → elige **segmento** (+ X días / N si aplica) → ve el **conteo** de clientas alcanzables (teléfono válido).
2. Elige **promo**: del catálogo (`listCampaignPromotions` = todas las `triggerType:'granted'` del negocio) **o** crea una inline (`<RewardFields>` → `Promotion(triggerType:'granted', pointsCost:null)`). `pointsCost:null` la mantiene fuera del catálogo de canje por puntos.
3. Edita el **mensaje** (template con default por segmento + placeholders).
4. `createCampaign`: crea `Campaign` + materializa `CampaignRecipient` por cada clienta del segmento (snapshot; sólo customerId + sin grant todavía). `requireBusinessRole(['owner','admin'])` + `checkRateLimit('create-campaign', …, { userId, businessId })` + `revalidatePath`.

### Enviar (un toque por destinataria)
- Réplica exacta de `review-link-button`: click → `window.open('','_blank')` **síncrono** → `await sendCampaignMessage(recipientId)` → `win.location.href = waUrl`. **No hay "enviar a todas"** (el browser bloquea `window.open` en loop / tras await).
- `sendCampaignMessage(recipientId)`:
  1. Carga recipient + campaign + customer + promotion; guard de ownership por `businessId`.
  2. **Mint perezoso** (tx chica): `mintCampaignGrant(tx, { …, requestId:'campaign:<campaignId>#<customerId>' })`. Idempotente — reenviar reusa el mismo grant.
  3. Compone el mensaje: `renderCampaignMessage(template, { nombre, codigo: grant.code, vencimiento: grant.expiresAt, negocio })`.
  4. Setea `recipient.sentAt` (si no estaba) + `grantId`.
  5. Devuelve `{ waUrl }` (`buildWhatsappUrl(phone, message)`) o `{ waUrl: null }` si sin teléfono → fallback copiar.

### Métricas (derivadas, en el detalle)
- **Alcance:** `recipients.count`.
- **Enviadas:** `sentAt != null`.
- **Canjearon:** grants `status:'redeemed'`.
- **Vigentes:** `status:'active' AND (expiresAt IS NULL OR expiresAt >= now)` — el filtro de expiración es **obligatorio** (no hay cron; `reconcileExpiredGrants` es perezoso por clienta, así que un grant vencido sigue `active` en DB hasta que se lea su tarjeta).

### Captura de birthDate
- Campo **opcional** "cumpleaños" en el paso de datos de la clienta del flujo de reserva (público + dashboard). Se pasa a `findOrCreateCustomerInTx` y se escribe **sólo si la clienta no tenía `birthDate`** (nunca pisa uno cargado). El form de edición de cliente ya lo captura.
- Convención de almacenamiento existente: `birthDate` a **00:00Z** (`new Date('${v}T00:00:00Z')`) para que la columna `@db.Date` no se corra por timezone. El segmento de cumpleaños compara el **mes** contra "ahora" en la **tz del negocio** (copiar la convención de `automatic-match.ts`).

## Segmentos — predicados exactos (queries dedicadas)

No se reusa `getCustomers` (cap de 500 + semántica equivocada: `lastBookingAt` = max `startDateTime` futuro-inclusive, `bookingCount` incluye pendientes). Cada segmento es su propia query, scopeada por `businessId`, y **excluye clientas sin teléfono válido** (`normalizePhone(phone).length >= 8`).

- **`birthday_month`:** `birthDate` no null y su **mes** (leído en UTC, por la convención 00:00Z) == mes actual en tz del negocio. (Prisma no hace `EXTRACT` tipado → fetch de `birthDate not null` + filtro en JS, como el cron.)
- **`inactive` (X días):** `lastCompletedAt` no null y `now - lastCompletedAt >= X días`. Las que nunca completaron (`null`) quedan **excluidas** (consistente con `isWinbackInactive`). X configurable, default 60.
- **`frequent` (N):** `count(bookings status='completed') >= N`. N configurable, default 3. (Completadas, NO el `bookingCount` de `getCustomers` que incluye pendientes.)
- **`pending_balance`:** `sum(remainingBalance) > 0` sobre bookings con status `notIn [cancelled, no_show, expired]`.

**Riesgo anotado:** el segmento de cumpleaños depende de que `birthDate` esté poblado; con la captura nueva se llena de a poco (histórico arranca casi vacío). **Riesgo menor:** los segmentos pueden incluir la fila `Customer` de la propia dueña/staff si reservó como clienta (no hay exclusión de miembros hoy); aceptable para C1, anotado.

## Emisión del grant — detalle

- **No reusar `emitAutomaticReward`** (rule/points-first: mintea puntos si `rewardPoints!=null`, fabrica una regla falsa). Mint dedicado modelado en `activatePackagePurchaseInTx`.
- Grant gratis: `pointsSpent:0`, `refundOnExpiry:false` (evita fila de ledger `redemption_reversal` de 0 puntos), `forfeitOnNoShow:false`, `status:'active'`.
- `expiresAt = (promotion.grantExpiryDays ?? config.grantExpiryDays)` días desde now, o `null` si ambos null.
- `code` vía `generateGrantCode(tx, businessId)` (base32 Crockford, colisión contra `Promotion.code` + `PromotionGrant.code`, 8 reintentos).
- **No consume `maxRedemptions`** de la promo (igual que auto/paquetes; el tope natural es el tamaño del segmento). El canje al reservar (`applyPromotionInTx`, rama grant) funciona idéntico a un grant canjeado por puntos; release/expiración también (reactiva en cancel, `forfeitOnNoShow:false` → no se pierde por no_show).
- **Sin advisory lock** (no toca puntos/saldo). **Una tx chica por envío** — NO batch-mint del segmento en una sola tx (landmine P2028 con `connection_limit=1`).
- Archivar la promo después NO revoca grants ya emitidos (el apply no exige `isActive`); correcto para una campaña ya enviada.

## Seguridad / trust

- Todas las acciones son de dueña: `requireBusinessRole(['owner','admin'])` + ownership re-chequeado por `businessId` en cada carga.
- Rate limit: buckets nuevos `'create-campaign'` y `'send-campaign'` en `RATE_LIMITS`, con context `{ userId, businessId }`. `send-campaign` dimensionado para ráfagas (un tap por clienta).
- WhatsApp es envío manual iniciado por la dueña desde su propio WhatsApp (mismo posture que el botón de reseña) → sin gate de consentimiento en C1.

## Testing

- **Unit:** `renderCampaignMessage` (placeholders, faltantes); defaults de mensaje; helpers de segmento puros (predicados de fecha/umbral); guard de teléfono.
- **Integration:** cada query de segmento (seed de clientas + bookings/pagos → asserts de membresía); `createCampaign` (materializa recipients, snapshot, excluye sin-teléfono); `sendCampaignMessage` (mint idempotente — doble envío = 1 grant; setea sentAt/grantId; devuelve waUrl; sin-teléfono → null); métricas derivadas; independencia de `isActive` (emite con programa apagado); captura de birthDate (no pisa existente).
- **Component:** `recipient-list` (botón por fila, estado enviado ✓, patrón open-window); `<RewardFields>` compartido.

## Módulos / archivos

**Nuevos:** `prisma` (migración + 2 modelos + enum), `src/lib/campaigns/{schema,segments,message,mint}.ts`, `src/server/actions/campaigns.ts`, `src/app/dashboard/campañas/{page.tsx,campaign-list.tsx,new-campaign-dialog.tsx,[id]/page.tsx,[id]/recipient-list.tsx}`, `src/components/dashboard/reward-fields.tsx` (extracción compartida).

**Modificados:** `prisma/schema.prisma` (relaciones inversas), `src/lib/rate-limit.ts` (2 buckets), `src/components/dashboard/sidebar.tsx` (nav), `src/lib/customers/find-or-create.ts` (+birthDate opcional, sin pisar), el paso de datos del flujo de reserva (público + dashboard) + su schema (campo cumpleaños opcional), `promotion-form.tsx` + `redemption-catalog.tsx` (usar `<RewardFields>`).

**Reusa:** `generateGrantCode` (`redeem.ts`), `buildWhatsappUrl` + `normalizePhone` (`whatsapp.ts`/`customers/phone.ts`), patrón open-window (`review-link-button.tsx`), `applyPromotionInTx`/release (canje), `requireBusinessRole`/`checkRateLimit`/`revalidatePath`, layout de `dashboard/promociones`.
