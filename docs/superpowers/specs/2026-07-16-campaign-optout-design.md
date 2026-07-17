# Opt-out de campañas — Diseño

**Fecha:** 2026-07-16
**Contexto:** C1 (campañas WhatsApp, PR #78) está en producción. El opt-out es prerequisito de C-email y de bulk send: antes de escalar el volumen de mensajes, la clienta necesita una forma de decir "no me manden más promociones" y el sistema necesita respetarlo en todas las puertas de salida de marketing.

## Objetivo

Una clienta puede quedar excluida de toda comunicación de **marketing** (campañas WhatsApp hoy, email de campañas mañana, emails promocionales del cron de fidelización). Lo puede marcar la dueña (en la ficha) o la propia clienta (autogestión). Es reversible en ambos sentidos. Los mensajes **transaccionales** no se ven afectados.

## Decisiones tomadas (con el usuario)

1. **Quién marca:** dueña (ficha de clienta) Y clienta (autogestión en `/mi/[slug]` y `/tarjeta/[token]`).
2. **Granularidad:** un solo flag para todos los canales (`marketingOptOutAt`). Por-canal es YAGNI hoy.
3. **Retroactividad:** el opt-out bloquea también el envío en campañas ya materializadas (no solo campañas nuevas).
4. **Cron `loyalty-automatic`:** el grant automático (cumpleaños/aniversario/winback) **se emite igual** (aparece en su tarjeta), pero el **email promocional se omite** para clientas opt-out.

## Qué es marketing y qué no

| Superficie | Clasificación | Afectada |
|---|---|---|
| Campañas (envío WA un-toque, `sendCampaignMessage`) | Marketing | Sí — bloqueo de envío |
| Segmentos de campaña (`queryCampaignSegment`) | Marketing | Sí — exclusión de listas nuevas |
| Email birthday/winback del cron `loyalty-automatic` | Marketing | Sí — se omite el email (el grant se emite) |
| Email de recompensa por referido (`referral.ts`) | Transaccional (participó activamente) | No |
| Recordatorios de reserva / transferencia (crons) | Transaccional | No |
| Pedido de reseña post-visita (manual) | Transaccional-ish | No |
| Botones de contacto 1:1 del dashboard | Manual de la dueña | No (pero la dueña ve el badge) |
| Link de tarjeta en confirmaciones | Transaccional | No |

## Modelo de datos

Un solo campo nuevo:

```prisma
model Customer {
  // ...
  marketingOptOutAt DateTime?   // null = acepta campañas; timestamp = cuándo se dio de baja
}
```

- Migración SQL a mano (`ALTER TABLE "Customer" ADD COLUMN "marketingOptOutAt" TIMESTAMP(3);`), aplicada con el ritual de DB compartida: `db execute` → verificar columna → `migrate resolve --applied`.
- Sin tabla de historial (YAGNI), sin índice (los queries ya filtran por `businessId` indexado).
- El timestamp hace de mini-auditoría (cuándo). Quién lo marcó no se registra.
- El flag es **por fila Customer** (= por negocio). Una clienta con ficha en dos negocios tiene opt-out independiente en cada uno. La vinculación de cuenta (`link.ts`) no lo toca. El match por teléfono en `findOrCreateCustomerInTx` reusa la misma fila, así que el flag sobrevive re-reservas.

## Enforcement (las puertas)

### Puerta 1 — campañas nuevas: `src/lib/campaigns/segments.ts`

`fetchSegmentRows` agrega `marketingOptOutAt: null` al where de los 4 segmentos. Para `frequent` y `pending_balance` (que parten de `booking.groupBy`), el filtro va en `customersByIds` — un solo punto común. Para `birthday_month` e `inactive`, en su where directo. La clienta opt-out no aparece en la lista materializada de ninguna campaña nueva.

### Puerta 2 — campañas en curso: `src/server/actions/campaigns.ts`

`sendCampaignMessage` agrega `marketingOptOutAt` al select del customer y, si está seteado, lanza `Error('La clienta pidió no recibir campañas')` **antes** de mintear el grant: no se crea beneficio, no se marca `sentAt`, no se devuelve `waUrl`.

### Puerta 3 — cron: `src/lib/cron/loyalty-automatic.ts`

El select de candidatas agrega `marketingOptOutAt`. La emisión del grant no cambia. El bloque de email (`kind === 'birthday' || kind === 'winback'`) agrega el guard `&& !c.marketingOptOutAt`.

## Actions

### Dueña — `src/server/actions/customers.ts` (junto a `updateCustomer`/`updateCustomerNotes`)

```
setCustomerMarketingOptOut(customerId: string, optedOut: boolean)
```
- `requireBusinessRole(['owner', 'admin'])`, ownership por `businessId` en el where del update (patrón existente).
- `optedOut ? new Date() : null`. Reversible.
- `revalidatePath` de la ficha y la lista.

### Clienta — módulo reusable `src/lib/campaigns/optout.ts` + actions

Core tx-aware:
```
setMarketingOptOutByCustomerId(db, customerId, optedOut): Promise<void>
```

Dos actions públicas que lo envuelven:
- **Por token** (`/tarjeta`): `setMarketingOptOutByToken(token, optedOut)` — resuelve con `resolveLoyaltyCustomer` (misma confianza que ver la tarjeta / canjear puntos). Rate limit bucket nuevo `'optout': { maxRequests: 10, windowMs: 60_000 }` en `src/lib/rate-limit.ts`.
- **Por sesión** (`/mi`): `setMarketingOptOutAsMe(customerId, optedOut)` — patrón `redeemPointsAsMe`: verifica que el Customer pertenezca al user de la sesión.

**Requisito C-email:** la action por token es exactamente la que reusará el link de unsubscribe del futuro canal email (footer → `/tarjeta/[token]` o página de baja que llama la misma action). No crear una segunda mecánica de baja cuando llegue C-email.

## UI

### Dashboard

- **Ficha de clienta** (`dashboard/customers/[id]`): toggle "Acepta campañas" (switch existente, patrón del toggle de bank-transfer). Debajo, si está opt-out, texto con la fecha ("Se dio de baja el dd/MM/yyyy").
- **Lista de clientas** (`customer-list.tsx`): badge "No campañas" junto al nombre para filas opt-out (agregar el campo a `CustomerListItem`).
- **Detalle de campaña** (`dashboard/campanas/[id]`): las filas de clientas opt-out muestran "No contactar" en lugar del botón verde de WhatsApp (el dato viaja en el select de `getCampaignDetail`). En las métricas del encabezado se agrega el conteo "No contactar: N"; esas filas no cuentan como pendientes de envío.

### Clienta

- **`/tarjeta/[token]`**: sección al pie de la tarjeta — si acepta: link/botón discreto "No quiero recibir promociones de {negocio}"; si está opt-out: mensaje "No recibirás promociones de {negocio}" + botón "Volver a recibirlas". Server action bindeada server-side con el token (mismo patrón que `redeemAction` en esa página: el token NO viaja en el body del form).
- **`/mi/[slug]`**: misma sección/estado por cada Customer vinculada del negocio, usando la action por sesión.

## Errores

- `sendCampaignMessage` bloqueado: error con mensaje claro que el recipient-list ya sabe renderizar por fila (mecanismo de per-row error existente). En la práctica el botón ni se muestra (la fila dice "No contactar"), el error es la red de seguridad ante carreras (opt-out entre render y click).
- Action por token con token inválido: mismo comportamiento que la tarjeta (no revelar nada).
- Rate limit excedido: mensaje genérico existente.

## Testing

- **Unit:** guard del cron (no manda email a opt-out, sí emite grant — sobre `selectTimedRuleForCustomer`/flujo con mocks), core `setMarketingOptOutByCustomerId`, render de fila "No contactar" en recipient-list, badge en customer-list, sección de baja en tarjeta (component test con mock de next/navigation).
- **Integración (DB test local 5433):**
  - `queryCampaignSegment` excluye opt-out en los 4 segmentos.
  - `sendCampaignMessage` rechaza y NO mintea grant ni marca sentAt.
  - `setCustomerMarketingOptOut` respeta ownership (negocio ajeno falla).
  - `setMarketingOptOutByToken` marca y desmarca; token inválido falla.
  - `setMarketingOptOutAsMe` verifica pertenencia al user.
- **e2e:** no se agrega spec nuevo (el flujo queda cubierto por unit+integración; el e2e actual no se ve afectado porque el default es null).

## Fuera de alcance

- Historial/auditoría de quién marcó el opt-out.
- Opt-out por canal (WhatsApp vs email por separado).
- Excluir del programa de fidelización (grants automáticos siguen emitiéndose).
- Footer de unsubscribe en el template de WhatsApp (el mensaje no cambia).
- C-email en sí (siguiente slice; este diseño solo le deja lista la action por token).
