# Diseño — Motor de promociones (rebanada A)

**Fecha:** 2026-06-28
**Estado:** aprobado en brainstorming + revisión adversarial incorporada; pendiente de plan de implementación
**Autor:** Roberto + Claude

---

## 1. Contexto y north-star

Agendita es un SaaS multi-tenant de reservas para estudios de belleza (uñas,
barbería, belleza en general) en Chile, WhatsApp-first. Queremos un sistema de
**promociones + fidelización** estructurado para el endgame, construido por
rebanadas.

### Decomposición (cada rebanada = su propio spec)

| | Qué | Construye sobre |
|---|---|---|
| **A** (este spec) | Motor de promociones: `Promotion` + `Redemption`, condición por código, recompensa %/fijo/gratis, aplicado en reserva pública y manual → escribe `Booking.discountAmount` | nada (base) |
| **B** | Fidelización/juego: `LoyaltyLedger` + `LoyaltyConfig` (puntos como moneda base), condiciones `automatic`/`granted`, superficie de la clienta vía link mágico "Mi tarjeta" | A + eventos |
| **C** | Campañas/alcance: segmentar (cumple del mes, inactivas, frecuentes) → WhatsApp/email | A + B |
| **D** | Login de clienta (después): Google OAuth + email → enriquece la superficie de B | — |
| **E** | Multimoneda/multisite (formateo + wording) — track independiente | — |

### Principios transversales (aplican a A)

- **Todo configurable por negocio** — montos, valores de recompensa, topes,
  vigencia, límites. Nada hardcodeado.
- **Trazabilidad** — los canjes son un **libro de canjes** inmutable salvo su
  ciclo de estado (`applied → released`); cada fila lleva `source`,
  `createdByUserId`, `releaseReason`, `metadata`.
- **Currency-clean** — el código nuevo de plata usa un helper
  `formatMoney(monto, currency)`; **prohibido** hardcodear `toLocaleString('es-CL')`
  o `$` en la UI nueva (evita deuda al track E). `Business.currency` ya existe.
- **Endgame-ready** — `Promotion.triggerType` + `conditions` ya están en el
  modelo, así B no requiere re-arquitectura.

---

## 2. Alcance de A

**Dentro:**
- Modelo `Promotion` (condición + recompensa + límites) y `PromotionRedemption`
  (libro de canjes).
- `triggerType = code` (la clienta o la dueña escribe un código). El modelo
  soporta `automatic`/`granted` pero A **no** los evalúa (eso es B).
- Recompensa: `percentage`, `fixed_amount`, `free_service`.
- Aplicación en **reserva pública** (wizard) y **reserva manual** (panel).
- Precio recalculado **server-side** → escribe `Booking.discountAmount`,
  `finalAmount`, `depositRequired` (capeado), `remainingBalance`.
- Panel: lista, crear/editar (soft-deactivate), reporte de canjes con export CSV.

**Fuera (forward-notes, no bloquean A):**
- Condiciones automáticas (día, primera visita, cumpleaños) → B.
- Promos emitidas a una clienta puntual (`granted`) → B necesitará `PromotionGrant`
  (promo + clienta + token + expira + usada). A deja el modelo compatible.
- Descuento ad-hoc sin código en el panel → posible follow-up ("promo manual").
- Multimoneda real (decimales/minor-units, payment-provider por país) → track E.

---

## 3. Modelo de datos

### Enums

```
PromotionTrigger   = code | automatic | granted          // A solo usa `code`
PromotionReward    = percentage | fixed_amount | free_service
RedemptionStatus   = applied | released
RedemptionSource   = public_booking | dashboard_booking | system
RedemptionRelease  = cancelled | no_show | hold_expired | refunded   // por qué se liberó
```

### `Promotion`

```
model Promotion {
  id              String   @id @default(cuid())
  businessId      String

  name            String              // interno ("Verano 2026")
  description     String?             // texto para la clienta (opcional)

  triggerType     PromotionTrigger    @default(code)
  code            String?             // normalizado UPPER+trim; null si no es `code`
  conditions      Json?               // condicionales (B); vacío en A, validado con zod

  rewardType      PromotionReward
  rewardValue     Int                 // % (1–100) o monto CLP; 0 si free_service
  maxDiscount     Int?                // tope de descuento en CLP

  appliesToAll    Boolean  @default(true)
  services        Service[] @relation("PromotionServices")  // si !appliesToAll

  validFrom       DateTime?
  validUntil      DateTime?
  minSpend        Int?
  maxRedemptions  Int?                // total (null = ilimitado)
  maxPerCustomer  Int?                // por clienta (best-effort, ver §12)
  redemptionCount Int      @default(0) // denormalizado; reconciliable (§7)

  isActive        Boolean  @default(true)
  metadata        Json?
  createdByUserId String?
  updatedByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  business        Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  redemptions     PromotionRedemption[]

  @@unique([businessId, code])         // code nullable → múltiples null OK (Postgres)
  @@index([businessId, isActive])
}
```

> **`@@unique([businessId, code])` + código normalizado:** la unicidad es sobre el
> string crudo. La normalización (UPPER+trim) debe ser el **único** camino de
> escritura — vía `.transform()` en el zod schema, aplicado antes de todo
> insert/update, con test. (No usamos citext.)
> **M2M `PromotionServices`:** la tabla join implícita no lleva `businessId`, así
> que el action **debe validar que cada `serviceId` conectado pertenezca al
> `businessId`** antes de `connect` (anti cross-tenant).

### `PromotionRedemption` (libro de canjes)

```
model PromotionRedemption {
  id              String   @id @default(cuid())
  businessId      String
  promotionId     String
  bookingId       String
  customerId      String              // SIEMPRE presente (gap #1)
  discountAmount  Int                 // CLP efectivamente descontado
  status          RedemptionStatus  @default(applied)
  releaseReason   RedemptionRelease?  // por qué se liberó (trazabilidad)
  releasedAt      DateTime?
  source          RedemptionSource
  createdByUserId String?
  metadata        Json?
  createdAt       DateTime @default(now())

  promotion       Promotion @relation(fields: [promotionId], references: [id])
  booking         Booking   @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  customer        Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@unique([bookingId])               // "una promo por reserva" + idempotencia
  @@index([businessId, promotionId])
  @@index([promotionId, customerId])  // para el chequeo maxPerCustomer (§4)
}
```

Reciprocidad: agregar `redemptions PromotionRedemption[]` en `Booking` y `Customer`.
`Promotion` **no se borra** (soft via `isActive`), por eso la FK del canje es segura.

> **Modelo de mutación:** el canje es inmutable **salvo** la transición de estado
> `applied → released` (update in-place de `status`/`releaseReason`/`releasedAt`).
> No se insertan filas nuevas en release. Como el reschedule **no** cambia de
> servicio (`rescheduleBooking` no toma `serviceId`), nunca hace falta re-insertar
> un canje para una reserva → `@@unique([bookingId])` es correcto.

### `Booking` (ya existe — A lo alimenta)

`discountAmount`, `finalAmount`, `depositRequired`, `remainingBalance` ya existen.
A los **recalcula** (§5/§6). Hoy `finalAmount = service.price` siempre y
`depositRequired = service.depositAmount` crudo: A introduce el descuento en
**ambos** caminos de creación.

### Ledger

Las promos **no** emiten `LedgerEntry`. El descuento no es plata que se mueve; se
captura en `Booking.discountAmount`/`finalAmount` + el `PromotionRedemption`. La
reconciliación financiera es contra `finalAmount`, que ya descuenta. (El enum
`LedgerEntryType.discount_applied` existente queda sin uso por ahora.)

### Migración

Aditiva: 2 tablas + 5 enums + tabla join `_PromotionServices` + columnas de relación
recíproca. Sin cambios destructivos (FKs nuevas con `onDelete: Cascade`, sin
NOT-NULL-sin-default en tablas existentes). Se aplica con `prisma migrate deploy`
(patrón ya usado para `birthDate`).

---

## 4. Regla central: `isRedeemable()`

Evaluador server-side único (semilla del motor de condicionales de B). Canjeable
para `{ businessId, serviceId, customerId, totalPrice, now }` si **todo** se cumple:

- `isActive === true`
- `now` dentro de `[validFrom, validUntil]` (si definidos)
- `maxRedemptions == null || redemptionCount < maxRedemptions`
- `maxPerCustomer == null ||` canjes `applied` de esa clienta para esta promo `< maxPerCustomer`
- `minSpend == null || totalPrice >= minSpend`
- `appliesToAll || serviceId ∈ promo.services`

Devuelve `{ ok: true, discount } | { ok: false, reason }`. La razón **no** se expone
literal a la clienta pública (anti-enumeración, §9).

### Cálculo del descuento (CLP, sin decimales)

```
percentage   → min( floor(totalPrice * rewardValue / 100), maxDiscount ?? ∞ )
fixed_amount → min( rewardValue, totalPrice )
free_service → totalPrice            // == 100% de ese servicio
```

`Math.floor` en el %: nunca regala de más por redondeo.

---

## 5. Flujos de aplicación

### 5.1 Reserva pública (la clienta usa un código)

Dos touchpoints; **el segundo manda**:

1. **Preview (read-only, interactivo).** Campo opcional al **inicio de `StepPayment`**
   (después del paso de contacto → ya hay teléfono y servicio en `BookingData`).
   Server action **`previewPromotion(businessId, code, serviceId, phone?)`**:
   - Recibe `businessId` igual que `createBooking` (caller-supplied); **busca la
     promo y el servicio `where { businessId, ... }`** (tenant-scoped, nunca por
     código global).
   - **Rate-limited** con bucket propio `preview-promotion` keyed **per-IP** +
     respuesta **genérica** ("código inválido") sin distinguir "no existe" de "no
     aplica".
   - Devuelve `{ discount, finalAmount }` para mostrar "−$4.000 · pagas $16.000".
     **No** crea canje.

2. **Apply (autoritativo).** Dentro de la transacción de `createBooking`:
   - La clienta se resuelve (find-or-create por `(businessId, phone)`) **antes**,
     así el canje siempre tiene `customerId`.
   - Re-resuelve con `isRedeemable()`. Si ya no aplica (race con el tope): la
     reserva **no se crea**, error claro ("el código ya no está disponible").
   - Si OK: **persiste en la misma tx, antes de cualquier `Payment`/preferencia MP**:
     `discountAmount`, `finalAmount = totalPrice − discount`,
     **`depositRequired = min(service.depositAmount, finalAmount)`**,
     `remainingBalance`; inserta el `PromotionRedemption` e **incrementa
     `redemptionCount` atómicamente** — branch:
     `maxRedemptions == null ? increment incondicional : updateMany where redemptionCount < maxRedemptions`.

> **Plumbing:** el código viaja por `BookingData` (wizard) → `createBookingSchema`
> (nuevo campo `promotionCode?`) → firma de `createBooking`. No es drop-in de UI.

### 5.2 Reserva manual (la dueña aplica un código)

Mismo campo + preview en `new-booking-form`. El canje queda `source =
dashboard_booking` + `createdByUserId`. **Crítico:** `createBookingFromDashboard`
calcula `discountAmount`/`finalAmount`/`depositRequired` capeado **una sola vez al
inicio** y usa esas cifras descontadas en **todos** los modos de pago
(`full_paid → finalAmount`, `deposit_paid → depositRequired` capeado) para que
`recalcBookingFromPayments` no clasifique mal.

### 5.3 Pago online (Mercado Pago)

- `initiatePayment` deriva el monto de `depositRequired`/`remainingBalance`. Como
  §5.1 ya persiste esos valores **descontados** antes de llamarlo,
  `initiatePayment` **no se modifica** y MP cobra el abono correcto.
- El descuento debe quedar **commiteado en la tx de `createBooking` antes de crear
  la preferencia**; nunca recalcular en `initiatePayment` (el webhook reconcilia
  `transaction_amount` contra `Payment.amount`; un descuento tardío rompería esa
  igualdad).
- El canje se crea `applied` ya en `pending_payment` (reserva el cupo); si el hold
  vence → `released` (§7).
- **Reserva 100% gratis:** el skip-MP se decide por **`finalAmount <= 0` y
  `depositRequired <= 0` post-descuento** (no por el deposit crudo del servicio).
  El cap de `depositRequired` (§6) es **load-bearing** para que el free se confirme
  sin pasar por MP.
- **Confirmación de un hold ya creado nunca re-valida la promo** (aunque la dueña
  la desactive/edite mientras el hold vive): se honra el `discountAmount` ya escrito
  (el canje es inmutable).

---

## 6. Interacción con el abono (decidido)

- El descuento reduce **`finalAmount`**.
- **`depositRequired` se persiste capeado a `finalAmount`** (`min(service.depositAmount,
  finalAmount)`). Nunca se pide abono mayor a lo que se debe; si la promo deja en
  $0, el abono es $0 → habilita el skip-MP del free (§5.3).
- Rationale: el abono es protección anti-no-show; no se encoge por la promo salvo
  que supere el total.

---

## 7. Ciclo de vida del canje

Triggers de `release` (todos: marcar `status=released`, set `releaseReason` +
`releasedAt`, y **decrementar `redemptionCount` con piso atómico**
`updateMany where redemptionCount > 0`):

| Evento | Dónde | Nota |
|---|---|---|
| Cancelación | `cancelBooking` | **hoy es un `update` pelado** → hay que **envolver** status+release+decremento en un `$transaction` nuevo |
| No-show | `updateBookingStatus(no_show)` | **hoy es `updateMany` pelado** → mismo wrap en `$transaction` |
| Hold vencido | cron `expireStaleHolds` | **hoy es `updateMany` masivo** sin enumerar IDs → hay que **rehacerlo** para liberar los canjes de las reservas expiradas (agrupado por promo) |
| Reembolso / contracargo | webhook MP (`refunded`/`charged_back`) | **el webhook hoy solo toca el `Payment`, no el booking** → faltaba este trigger; agregarlo (libera el cupo) |

- **Reschedule** → el canje se mantiene; no se re-valida.
- **Drift de `redemptionCount`:** como es denormalizado, va a derivar. Helper de
  **reconciliación** (`count(redemptions where status='applied')`) corrible on-demand
  / por cron para sanarlo.
- El reporte de impacto cuenta solo canjes `applied`.

---

## 8. Pantallas del panel

Nuevo ítem de sidebar **"Promociones"** (`/dashboard/promociones`, icono `Ticket`),
pensado para colgar luego de un grupo "Marketing" con B y C. Bottom-nav móvil sin
cambios. Responsive (acabamos de hacer el pase de tablet).

### 8.1 Lista
Cards/tabla: **nombre · código · recompensa · alcance · usos (12/50) · vigencia ·
estado**. El **estado es derivado** de `isRedeemable` + `redemptionCount` (sin N+1):
`Activa · Programada · Vencida · Agotada · Inactiva`. Acciones: crear · editar ·
activar/desactivar (**nunca borrar** — soft) · ver canjes.

### 8.2 Crear / editar
Form que mapea el modelo, con **preview en vivo**. Reglas:
- Código **normalizado** (UPPER+trim, único por negocio).
- Si la promo **ya tiene canjes**: el `code` se **bloquea**; cambios de
  recompensa/alcance **solo afectan a futuro** (los canjes pasados son inmutables).
- `free_service` + `appliesToAll` → **nudge** a elegir servicios específicos.
- Servicio en el alcance que quedó **inactivo** → simplemente nunca matchea (el
  booking rechaza servicios inactivos upstream); mostrar chip "servicio inactivo".
- Todo el dinero con `formatMoney(currency)`.

### 8.3 Reporte de canjes
- Por promo: clienta · reserva · monto descontado · fecha · `source` · estado +
  `releaseReason`.
- Agregados: total canjes · total descontado · ticket promedio (excluye `released`).
- **Export CSV** con BOM (Excel + tildes); el action **gateado a `owner/admin`** y
  scoped por `businessId` (PII de clientas).

### 8.4 Roles
- Gestionar promos / reporte / export: `owner/admin`.
- **Aplicar** un código al reservar: cualquiera que pueda crear reservas (incl.
  `staff`) y la clienta en público.

---

## 9. Validaciones y disciplina técnica

- `createPromotionSchema`/`updatePromotionSchema` (zod, en `@/lib/promotions/`):
  nombre, código (regex + `.transform()` de normalización como único camino de
  escritura), coherencia `rewardType`↔`rewardValue` (% 1–100; montos ≥ 0),
  `validUntil > validFrom`, alcance (serviceIds ∈ businessId), límites ≥ 0.
- `conditions`/`metadata` JSON validados con zod al escribir.
- **Multi-tenant**: cada query/action scoped por `businessId`; `previewPromotion`
  y apply validan que promo **y** servicio pertenezcan al `businessId` pasado.
- ⚠️ **`'use server'`**: `promotions.ts` exporta **solo funciones async**.
  Schemas/tipos/`isRedeemable`/`formatMoney`/helper CSV viven en `@/lib/promotions/`
  puro (pitfall que ya nos mordió 2 veces — ver memorias del repo).
- `revalidateBusinessPublicPaths` y demás **siempre `await`** (otra memoria).
- **Rate-limit**: bucket `preview-promotion` per-IP en `previewPromotion`; las
  mutaciones con `checkRateLimit`. (El "drenaje" de una promo limitada vía reservas
  reales repetidas está acotado por `create-booking` (20/min) y le cuesta al atacante
  una reserva real cancelable — aceptable.)
- **Currency-clean**: `formatMoney`; cero `es-CL`/`$` hardcodeado nuevo.

---

## 10. Estructura de archivos y puntos de integración

```
src/lib/promotions/
  schema.ts          # zod create/update/conditions/metadata + tipos + enums-as-types
  evaluate.ts        # isRedeemable() + cálculo de descuento (puro, testeable)
  csv.ts             # helper export (puro)
src/lib/money.ts     # formatMoney(monto, currency)  (compartido)
src/server/actions/
  promotions.ts      # 'use server' — CRUD, previewPromotion, reporte (solo async fns)
src/app/dashboard/promociones/
  page.tsx · promotion-form.tsx · redemptions report + export
```

**Puntos de integración (todos requieren edición real):**
- `src/server/actions/bookings.ts`: `createBooking` y `createBookingFromDashboard`
  (calcular descuento + persistir finalAmount/depositRequired capeado/remainingBalance
  en la tx); `cancelBooking` y `updateBookingStatus` (**introducir `$transaction`**
  + release); `createBookingSchema` (+`promotionCode?`).
- `src/lib/cron/expire-holds.ts`: reabajar para liberar canjes de las expiradas.
- `src/app/api/webhooks/mercado-pago/route.ts`: liberar canje en `refunded`/`charged_back`.
- `src/components/booking/wizard.tsx` + `step-payment.tsx`: `BookingData` +
  campo de código + preview; `initiatePayment` **sin cambios**.
- `src/components/dashboard/sidebar.tsx`: ítem "Promociones".

---

## 11. Estrategia de tests

- **Unitarios puros:** `evaluate.ts` (cada condición: inactiva, fuera de ventana,
  agotada, por-clienta, minSpend, alcance; null en límites) y cálculo de descuento
  (%, fijo, gratis, tope, floor, cap a totalPrice). `schema.ts` (normalización de
  código, coherencia tipo↔valor, fechas, serviceIds).
- **Acción (mock prisma):** `previewPromotion` (tenant-scope, rate-limit, respuesta
  genérica); aplicación atómica (incremento, branch null); idempotencia por
  `bookingId`; release+decremento (con piso) en cancel/no-show/expire/refund;
  reconciliación de `redemptionCount`.
- **e2e (Playwright):** crear promo en panel → reservar en público con el código →
  ver descuento en la reserva + canje en el reporte; reserva 100% gratis confirma
  sin MP.

---

## 12. Riesgos / edge cases

- **`maxPerCustomer` es best-effort.** Customer es find-or-create por
  `(businessId, phone)` y `phone` **no es único** ni verificado → un atacante usa
  un teléfono nuevo por canje. La enforcement real espera el login de clienta (D).
  **`maxRedemptions` es el único tope duro.**
- Enumeración de códigos → rate-limit per-IP + respuesta genérica.
- Race en tope global → incremento atómico (branch null); race por-clienta → conteo
  en transacción (riesgo bajo).
- Promo editada/desactivada con un hold vivo → la confirmación honra el
  `discountAmount` ya escrito; no re-valida.
- Reserva 100% gratis → confirma sin MP (depende del cap de depositRequired).
- Reembolso/contracargo → libera cupo (vía webhook).
- Borrado de promos → soft (isActive) para preservar el libro de canjes.
- Drift de `redemptionCount` → helper de reconciliación.

---

## 13. Forward-notes para B/C/D/E (no se construyen en A)

- **B:** `conditions` + `triggerType=automatic/granted`; `PromotionGrant`;
  `LoyaltyLedger`/`LoyaltyConfig` (puntos); superficie "Mi tarjeta" por link mágico.
- **C:** segmentación + entrega WhatsApp/email.
- **D:** login de clienta (Google OAuth + email) → enchufa a "Mi tarjeta" y hace
  `maxPerCustomer` enforceable de verdad.
- **E:** `formatMoney` ya sembrado en A; falta decidir minor-units (decimales) y
  proveedor de pago por país.

---

## 14. Revisión adversarial incorporada (2026-06-28)

Tres revisores cruzaron el spec con el código real. Cambios aplicados:
- **Modelo:** relaciones FK `Booking`/`Customer` en el canje; reframe append-only →
  "inmutable salvo status"; índice `[promotionId, customerId]`; `releaseReason`;
  branch null en `maxRedemptions`; validación de `serviceIds ∈ businessId`;
  normalización de código como único camino de escritura; decisión de no tocar el
  ledger.
- **Pagos:** decisión load-bearing — persistir `finalAmount` descontado +
  `depositRequired` capeado dentro de la tx de `createBooking*` antes del `Payment`/MP;
  `initiatePayment` sin cambios; skip-MP del free keyed en `finalAmount<=0 &&
  depositRequired<=0`; cifras descontadas en todos los modos de pago manual.
- **Ciclo de vida:** `cancelBooking`/`updateBookingStatus` necesitan `$transaction`
  nuevo; `expire-holds` reabajado; **reembolso libera el canje** (webhook); piso
  atómico en el decremento; helper de reconciliación.
- **Seguridad:** `previewPromotion(businessId, …)` tenant-scoped; rate-limit per-IP;
  `maxPerCustomer` documentado como best-effort; export CSV gateado a owner/admin.
