# C-email — Campañas por email — Diseño

**Fecha:** 2026-07-18
**Iniciativa:** promotions + loyalty (rebanada C). Continúa C1 (blast WhatsApp, #78) y opt-out (#80).
**Estado:** aprobado en brainstorm, pendiente writing-plans.

## Objetivo

Agregar email como segundo canal de las campañas de marketing existentes. Hoy una
campaña sólo se puede enviar por WhatsApp (un-toque por fila). Las clientas sin
teléfono whatsappeable pero con email quedan fuera del alcance. C-email las incorpora:
mismo modelo de campaña, misma promo/grant, el canal se decide por clienta.

**No incluye** (rebanadas siguientes): envío masivo ("enviar a todas"), preview de
conteo antes de crear la campaña, editor de asunto/cuerpo separado por canal.

## Decisiones de producto (del brainstorm)

1. **Canal por clienta**: la campaña es una sola; cada destinataria se contacta por su
   mejor canal — WhatsApp si el teléfono es whatsappeable (preferido), email si no lo es
   pero tiene email. Una clienta ofrece **un** canal, no ambos.
2. **Envío un-toque por fila**, como WhatsApp. Botón "Enviar email" por destinataria que
   mintea el grant y envía server-side de inmediato. El bulk de la próxima rebanada se
   apoya sobre esta misma action.
3. **Mismo `messageTemplate`, envuelto en HTML**. El texto de la campaña (placeholders
   `{nombre} {codigo} {vencimiento} {negocio}`) se renderiza como cuerpo del email dentro
   del layout HTML estándar del sistema. Asunto automático, sin campos nuevos en el form.
4. **Unsubscribe → página mínima `/baja/[token]`** que reusa `setMarketingOptOutByToken`
   (#80). Habilita además el header `List-Unsubscribe` one-click (Gmail lo exige para bulk).
5. **Unificar la política de email de marketing**: la puerta de opt-out se mueve a
   `sendRewardEmail`; los emails de cumpleaños/winback del cron ganan footer de baja +
   `List-Unsubscribe`. Cierra la deuda de altitud anotada en el /simplify de #80.

## Arquitectura

### 1. Contactabilidad y segmentos

- **Helper nuevo** `isEmailable(email: string | null | undefined): boolean` en
  `src/lib/customers/email.ts` — simétrico a `isWhatsappablePhone` (no-vacío + contiene `@`
  + un `.` después del `@`; validación laxa, el bounce lo maneja Resend). Con su test unit.
- `src/lib/campaigns/segments.ts`:
  - `SegmentCustomer` gana `email: string | null`.
  - El `select` compartido gana `email: true`.
  - Choke point en `queryCampaignSegment`:
    `rows.filter((c) => (isWhatsappablePhone(c.phone) || isEmailable(c.email)) && !c.marketingOptOutAt)`.
- **Efecto**: los segmentos crecen; entran clientas email-only. Ningún `where` individual
  cambia (la contactabilidad sigue siendo el único post-filtro, decisión de altitud de #80).

### 2. Canal por fila (decidido en server)

- `getCampaignDetail` (`src/server/actions/campaigns.ts`): el select por recipient gana
  `customer.email`.
- `src/app/dashboard/campanas/[id]/page.tsx`: por recipient serializa
  `channel: 'whatsapp' | 'email' | 'none'`:
  - `whatsapp` si `isWhatsappablePhone(phone)` (preferido),
  - si no, `email` si `isEmailable(email)`,
  - si no, `none` (no debería pasar: el segmento ya filtró, pero defensivo).
  Se sigue serializando `optedOut`.
- `RecipientItem` (`recipient-list.tsx`) gana `channel` y `email` (para mostrar destino).
  `sendButton` decide por `channel`:
  - `whatsapp` → botón verde actual (abre `wa.me`, sin cambios),
  - `email` → botón "Enviar email" que llama `sendCampaignEmail`, muestra éxito/error
    inline (sin ventana; el envío es server-side),
  - `none` o `optedOut` → texto "No contactar" (opt-out ya cubierto hoy).
- `statusLabel` no cambia (`Enviado ✓` / `Canjeado ✓` derivados de `sentAt`/`grantStatus`).
- Métrica "Enviadas" sigue contando `sentAt != null`, agnóstica de canal.

### 3. Server: core compartido + action nueva

**Extracción** — `src/lib/campaigns/send.ts` (módulo nuevo, no `'use server'`):

```
prepareCampaignSend(tx-less):
  - fetch recipient (id, sentAt, customer{id,name,phone,email,marketingOptOutAt},
    campaign{id, messageTemplate, promotion{id,grantExpiryDays}, business{name,timezone}})
    scopeado por businessId (ownership)
  - si !recipient → ForbiddenError('Destinataria no encontrada')
  - si customer.marketingOptOutAt → Error('La clienta pidió no recibir campañas')  [puerta 2 retroactiva]
  - mint perezoso idempotente: requestId = `campaign:${campaignId}#${customerId}`,
    P2002 → re-lee grant existente (patrón actual de sendCampaignMessage)
  - devuelve { recipient, grant, message } donde message = renderCampaignMessage(...)
    con vencimiento formateado en la tz del negocio
```

`prepareCampaignSend` **no** marca `sentAt` — cada canal decide cuándo.

`src/server/actions/campaigns.ts`:
- `sendCampaignMessage(recipientId)` (WA): `requireBusinessRole` + rate limit `send-campaign`
  (120/min, sin cambio) → `prepareCampaignSend` → marca `sentAt = sentAt ?? new Date()` y
  `grantId` → devuelve `{ waUrl }` (`isWhatsappablePhone(phone) ? buildWhatsappUrl(...) : null`).
  Comportamiento idéntico al actual.
- `sendCampaignEmail(recipientId)` (nueva): `requireBusinessRole` + rate limit
  **`send-campaign-email` (30/min, bucket nuevo)** → `prepareCampaignSend` → arma y envía el
  email vía `sendCampaignPromoEmail` (§4). **Marca `sentAt`/`grantId` sólo si el envío fue
  exitoso** (a diferencia de WA, acá conocemos el resultado; el grant queda minteado aunque
  falle y el reintento es idempotente). Devuelve `{ sent: boolean; error?: string }`.

**Sin cambio de schema**: `CampaignRecipient.sentAt` único, sin columna de canal. El canal
es derivable de los datos de la clienta y cada fila ofrece un solo canal (YAGNI).

### 4. Política de email de marketing (compartida con el cron)

**`src/lib/notifications/marketing-email.ts`** (módulo nuevo):
- `buildMarketingUnsubscribe(loyaltyToken): { footerHtml, footerText, headers }`
  - `footerHtml`: bloque bajo el `footer()` transaccional:
    "¿No quieres recibir promociones? [Darme de baja](<APP_URL>/baja/<token>)".
  - `headers`: `List-Unsubscribe: <<APP_URL>/api/baja/<token>>, <mailto:...opcional>` +
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058).
- `sendCampaignPromoEmail(args)`: arma asunto automático
  `"{negocio} te dejó un beneficio 🎁"`, cuerpo = `renderCampaignMessage` dentro de
  `baseHtml`, con footer de baja, y llama `sendEmail` con los headers.

**`src/lib/notifications/email-provider.ts`**:
- `SendEmailOptions` gana `headers?: Record<string,string>`; `sendEmail` los propaga a
  `resend.emails.send({ ..., headers })`.
- Exportar/relocalizar `baseHtml`, `footer` de `templates.ts` para que `marketing-email.ts`
  los reuse (hoy son module-local). Preferencia: exportarlos desde `templates.ts`.

**`src/lib/loyalty/reward-email.ts`** — la puerta de opt-out baja aquí:
- `sendRewardEmail` arg `customer` gana `marketingOptOutAt: Date | null`.
- Si `reason` ∈ {`birthday`,`winback`} y `customer.marketingOptOutAt` → skip logueado
  (`loyalty.reward_email.opted_out`), no envía. `referral` **siempre** pasa (agradecimiento,
  cuasi-transaccional) y **no** lleva footer de baja.
- `birthday`/`winback` ganan footer + headers de baja vía `buildMarketingUnsubscribe`
  (link con `ensureLoyaltyToken`, que ya mintea lazy). El asunto no cambia.

**`src/lib/cron/loyalty-automatic.ts`**:
- Elimina `wantsRewardEmail` (y su uso): la puerta ahora vive en `sendRewardEmail`. El select
  del cron ya trae `email`, `loyaltyToken`, `marketingOptOutAt` — pasa `marketingOptOutAt` al arg.
- El grant se sigue emitiendo siempre (puerta 3 de #80 intacta: opt-out silencia el email,
  no el beneficio).

**`src/lib/loyalty/referral.ts`**:
- `notifyReferralReward`: su select gana `marketingOptOutAt` (para satisfacer el nuevo tipo del
  arg), aunque `reason:'referral'` no lo consulta.

### 5. Página pública de baja

- **`src/app/baja/[token]/page.tsx`**: `resolveLoyaltyCustomer(prisma, token)`; token inválido
  → `notFound()`. Reusa `<MarketingOptOutSection>` (#80) con la action `setMarketingOptOutByToken`
  server-bound (patrón `optOutAction` de `/tarjeta/[token]`). Cero mecánica nueva de baja.
- **`src/app/api/baja/[token]/route.ts`**: `POST` para el one-click de `List-Unsubscribe-Post`
  (los clientes de correo hacen POST sin abrir la página). Llama `setMarketingOptOutByToken(token, true)`,
  devuelve `200` siempre que el token resuelva (idempotente), `404` si no. Rate limit: reusa
  `optout-public` (la action ya lo aplica internamente).
- Middleware: `/baja/*` y `/api/*` ya son públicos (mismo trato que `/tarjeta/*`); no requiere
  cambios (verificado en `src/middleware.ts`).

### 6. Copy y bordes

- `src/app/dashboard/campanas/page.tsx` subtítulo y `campaign-list.tsx` empty-state:
  "por WhatsApp o email" (2 strings).
- Clienta con opt-out → "No contactar" (sin cambios respecto de #80, cubre ambos canales).

## Manejo de errores

- `sendCampaignEmail`: si `sendEmail` devuelve `{success:false}` (skip por falta de
  RESEND_API_KEY/FROM_EMAIL, o rechazo de Resend), la action devuelve `{sent:false, error}`
  y **no** marca `sentAt`. El grant minteado persiste; reintentar es idempotente.
- Opt-out retroactivo: `prepareCampaignSend` lanza antes de mintear (igual que hoy WA).
- Página `/baja`: token inválido → 404 suave; doble baja → idempotente (no error).

## Testing

**Unit:**
- `isEmailable` (casos válidos/ inválidos).
- `prepareCampaignSend`: puertas (ownership, opt-out), mint idempotente, render del mensaje
  (con provider/DB mockeados donde aplique — o cubrir el core vía integración).
- `marketing-email.ts`: footer contiene el link `/baja/<token>`, headers `List-Unsubscribe*`.
- `sendRewardEmail`: birthday/winback con opt-out → skip; referral con opt-out → envía, sin footer.
- `RecipientList`: fila `channel:'email'` muestra "Enviar email" y no abre `wa.me`;
  `channel:'whatsapp'` sin cambios; `none`/opt-out → "No contactar".

**Integration:**
- `sendCampaignEmail`: mint + `sentAt` sólo en éxito; opt-out retroactivo bloquea; ownership;
  provider mockeado (éxito y fallo).
- `campaigns-segments`: clienta email-only (sin teléfono whatsappeable, con email) ahora entra
  al segmento; clienta sin ninguno de los dos queda fuera.
- Cron `loyalty-automatic`: sin `wantsRewardEmail`, la puerta la aplica `sendRewardEmail`
  (birthday con opt-out no envía email pero sí emite grant).

**E2E (ajustes, no requeridos):** cobertura opcional de `/baja/[token]` en `public.spec.ts`.

## Archivos

**Nuevos:**
- `src/lib/customers/email.ts` (+ test)
- `src/lib/campaigns/send.ts` (`prepareCampaignSend`)
- `src/lib/notifications/marketing-email.ts`
- `src/app/baja/[token]/page.tsx`
- `src/app/api/baja/[token]/route.ts`

**Modificados:**
- `src/lib/campaigns/segments.ts` (email en select/tipo + choke point)
- `src/server/actions/campaigns.ts` (`sendCampaignEmail`, refactor a `prepareCampaignSend`, email en `getCampaignDetail`)
- `src/lib/rate-limit.ts` (bucket `send-campaign-email`)
- `src/lib/notifications/email-provider.ts` (`headers` en `SendEmailOptions` + propagación)
- `src/lib/notifications/templates.ts` (exportar `baseHtml`/`footer`)
- `src/lib/loyalty/reward-email.ts` (puerta de opt-out + footer de baja)
- `src/lib/cron/loyalty-automatic.ts` (elimina `wantsRewardEmail`, pasa `marketingOptOutAt`)
- `src/lib/loyalty/referral.ts` (`marketingOptOutAt` en el select)
- `src/app/dashboard/campanas/[id]/page.tsx` (serializa `channel` + `email`)
- `src/app/dashboard/campanas/[id]/recipient-list.tsx` (botón email por canal)
- `src/app/dashboard/campanas/page.tsx` + `campaign-list.tsx` (copy)

## No-objetivos / backlog

- Envío masivo ("enviar a todas") — próxima rebanada, se apoya en `sendCampaignEmail`.
- Preview de conteo de segmento antes de crear la campaña.
- Editor de asunto/cuerpo separado por canal.
- Columna de canal en `CampaignRecipient` (sólo si el bulk/analytics lo pide).
