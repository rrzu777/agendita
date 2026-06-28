# Diseño — Motor de promociones (rebanada A)

**Fecha:** 2026-06-28
**Estado:** aprobado en brainstorming, pendiente de plan de implementación
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
- **Trazabilidad** — los canjes son un libro **append-only** (inmutable); cada
  fila lleva `source`, `createdByUserId`, `metadata`, y ciclo `applied→released`.
- **Currency-clean** — el código nuevo de plata usa un helper
  `formatMoney(monto, currency)`; **prohibido** hardcodear `toLocaleString('es-CL')`
  o `$` en la UI nueva. Esto evita sumar deuda al futuro track E (multimoneda).
  `Business.currency` ya existe (default `CLP`).
- **Endgame-ready** — `Promotion.triggerType` + `conditions` ya están en el
  modelo, así B (cumpleaños, sellos) no requiere re-arquitectura.

---

## 2. Alcance de A

**Dentro:**
- Modelo `Promotion` (condición + recompensa + límites) y `PromotionRedemption`
  (libro de canjes).
- `triggerType = code` (la clienta o la dueña escribe un código). El modelo
  soporta `automatic`/`granted` pero A **no** los evalúa (eso es B).
- Recompensa: `percentage`, `fixed_amount`, `free_service`.
- Aplicación en **reserva pública** (wizard) y **reserva manual** (panel).
- Precio recalculado **server-side** → escribe `Booking.discountAmount` + `finalAmount`.
- Panel: lista, crear/editar (soft-deactivate), reporte de canjes con export CSV.

**Fuera (forward-notes, no bloquean A):**
- Condiciones automáticas (día, primera visita, cumpleaños) → B.
- Promos emitidas a una clienta puntual (`granted`) → B necesitará un registro de
  emisión `PromotionGrant` (promo + clienta + token + expira + usada). A deja el
  modelo compatible; no lo construye.
- Descuento ad-hoc sin código en el panel ("rebájale $5.000 a esta") → posible
  follow-up chico como "promo manual"; **no** en A (rompe trazabilidad si se hace
  mal).
- Multimoneda real (decimales/minor-units, payment-provider por país) → track E.

---

## 3. Modelo de datos

### Enums

```
PromotionTrigger   = code | automatic | granted          // A solo usa `code`
PromotionReward    = percentage | fixed_amount | free_service
RedemptionStatus   = applied | released
RedemptionSource   = public_booking | dashboard_booking | system
```

### `Promotion`

```
model Promotion {
  id              String   @id @default(cuid())
  businessId      String

  name            String              // interno ("Verano 2026")
  description     String?             // texto para la clienta (opcional)

  // Disparador
  triggerType     PromotionTrigger    @default(code)
  code            String?             // normalizado UPPER+trim; null si no es `code`
  conditions      Json?               // condicionales (B); vacío en A, validado con zod

  // Recompensa (configurable)
  rewardType      PromotionReward
  rewardValue     Int                 // % (1–100) o monto CLP; 0 si free_service
  maxDiscount     Int?                // tope de descuento en CLP

  // Alcance
  appliesToAll    Boolean  @default(true)
  services        Service[] @relation("PromotionServices")  // si !appliesToAll

  // Límites (configurables)
  validFrom       DateTime?
  validUntil      DateTime?
  minSpend        Int?
  maxRedemptions  Int?                // total
  maxPerCustomer  Int?                // por clienta
  redemptionCount Int      @default(0) // denormalizado (chequeo rápido + estado)

  isActive        Boolean  @default(true)
  metadata        Json?
  createdByUserId String?
  updatedByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  business        Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  redemptions     PromotionRedemption[]

  @@unique([businessId, code])
  @@index([businessId, isActive])
}
```

### `PromotionRedemption` (append-only)

```
model PromotionRedemption {
  id              String   @id @default(cuid())
  businessId      String
  promotionId     String
  bookingId       String
  customerId      String              // SIEMPRE presente (gap #1)
  discountAmount  Int                 // CLP efectivamente descontado
  status          RedemptionStatus @default(applied)
  releasedAt      DateTime?
  source          RedemptionSource
  createdByUserId String?
  metadata        Json?
  createdAt       DateTime @default(now())

  promotion       Promotion @relation(fields: [promotionId], references: [id])
  // Nota: Promotion NO se borra (soft via isActive), por eso la FK es segura.

  @@unique([bookingId])               // "una promo por reserva" + idempotencia
  @@index([businessId, promotionId])
}
```

`Booking.discountAmount` y `Booking.finalAmount` **ya existen** — A los alimenta.

### Migración

Aditiva: 2 tablas nuevas + 4 enums + tabla join `_PromotionServices`. Sin cambios
destructivos. Se aplica con `prisma migrate deploy` (patrón ya usado para
`birthDate`).

---

## 4. Regla central: `isRedeemable()`

Evaluador server-side único (la semilla del "motor de condicionales" que B
extiende). Una promo es canjeable para `{ serviceId, customerId, totalPrice, now }`
si **todo** se cumple:

- `isActive === true`
- `now` dentro de `[validFrom, validUntil]` (si están definidos)
- `redemptionCount < maxRedemptions` (si está definido)
- canjes `applied` de esa clienta para esta promo `< maxPerCustomer` (si definido)
- `totalPrice >= minSpend` (si definido)
- alcance: `appliesToAll || serviceId ∈ promo.services`

Devuelve un resultado tipado `{ ok: true, discount } | { ok: false, reason }`.
La razón **no** se expone literal a la clienta pública (anti-enumeración).

### Cálculo del descuento (CLP, sin decimales)

```
percentage   → min( floor(totalPrice * rewardValue / 100), maxDiscount ?? ∞ )
fixed_amount → min( rewardValue, totalPrice )
free_service → totalPrice            // == 100% de ese servicio
```

`Math.floor` en el %: nunca regala de más por redondeo (gap #6).

---

## 5. Flujos de aplicación

### 5.1 Reserva pública (la clienta usa un código)

Dos touchpoints; **el segundo manda**:

1. **Preview (read-only, interactivo).** Campo opcional "¿Tienes un código?" en el
   wizard, **ubicado después del paso de contacto** (así ya hay teléfono y el
   preview respeta `maxPerCustomer` — gap §2.2). Server action
   `previewPromotion(code, serviceId, phone?)`:
   - **Rate-limited** + respuesta **genérica** ("código inválido") sin distinguir
     "no existe" de "no aplica" (anti-enumeración — gap §2.1).
   - Devuelve `{ discount, finalAmount }` para mostrar "−$4.000 · pagas $16.000".
   - **No** crea canje.

2. **Apply (autoritativo).** Dentro de la transacción de `createBooking`:
   - Re-resuelve con `isRedeemable()` (nunca confía en el cliente).
   - Si ya no es canjeable (race con el tope entre preview y confirm): la reserva
     **no se crea**, vuelve error claro ("el código ya no está disponible").
   - Si OK: escribe `discountAmount`/`finalAmount`, inserta `PromotionRedemption`
     e incrementa `redemptionCount` **atómicamente**
     (`updateMany where redemptionCount < maxRedemptions` — gap §1.2). La clienta
     se resuelve (find-or-create por teléfono) **antes**, así el canje siempre
     tiene `customerId`.

### 5.2 Reserva manual (la dueña aplica un código)

Mismo campo de código + preview en `new-booking-form`. El canje queda con
`source = dashboard_booking` y `createdByUserId`. Las cifras descontadas fluyen a
los modos de pago: `full_paid → finalAmount`, `deposit_paid → abono capeado`
(§6).

### 5.3 Pago online (Mercado Pago)

- La preferencia MP cobra el **abono ya descontado** (§6), no el viejo.
- El canje se crea en estado `applied` ya en `pending_payment` (reserva el cupo).
- Si el hold vence sin pago → `released` (§7).
- Reserva **100% gratis** (`free_service`/100% → `finalAmount = 0`): **se salta el
  pago online y se confirma directo** (no se manda a MP por $0). Hay que validar
  que el flujo actual de "sin abono" cubra el caso.

---

## 6. Interacción con el abono (decidido)

- El descuento reduce **`finalAmount`**.
- **`depositRequired` se mantiene** como lo configuró el servicio, **capeado a
  `finalAmount`** (nunca se pide abono mayor a lo que se debe; si la promo deja en
  $0, el abono es $0).
- Rationale: el abono es protección anti-no-show; no debería encogerse por una
  promo salvo que supere el total.

---

## 7. Ciclo de vida del canje

- `cancelBooking` → canje `released` + **decrementar `redemptionCount`** (libera
  cupo).
- `updateBookingStatus(no_show)` → `released` + decrementar.
- Cron `expire-holds` (hold de pago vencido) → `released` + decrementar.
- **Reschedule** → el canje se mantiene; **no** se re-valida la promo (queda
  bloqueado al aplicarse; relevante para B con condiciones tipo "solo martes").
- Todo dentro de las transacciones de esas acciones que ya existen.
- El reporte de impacto cuenta solo canjes `applied` (excluye `released`).

---

## 8. Pantallas del panel

Nuevo ítem de sidebar **"Promociones"** (`/dashboard/promociones`, icono `Ticket`).
Diseñado para colgar luego de un grupo "Marketing" con B y C. Bottom-nav móvil sin
cambios.

### 8.1 Lista
Cards/tabla: **nombre · código · recompensa · alcance · usos (12/50) · vigencia ·
estado**. El **estado es derivado** de `isRedeemable` + `redemptionCount` (sin
N+1, gap §3.6): `Activa · Programada · Vencida · Agotada · Inactiva`. Acciones:
crear · editar · activar/desactivar (**nunca borrar** — soft) · ver canjes.

### 8.2 Crear / editar
Form que mapea el modelo, con **preview en vivo**. Campos: nombre, descripción,
recompensa (tipo + valor + tope), alcance (todos / elegir servicios con chips),
vigencia, límites (máx. total, máx. por clienta, mínimo). Reglas:
- Código **normalizado** (UPPER+trim), único por negocio.
- Si la promo **ya tiene canjes**: el `code` se **bloquea** (cambiarlo rompe links
  compartidos); cambios de recompensa/alcance **solo afectan a futuro** (los canjes
  pasados son inmutables).
- `free_service` + `appliesToAll` → **nudge** a elegir servicios específicos.
- Todo el dinero formateado con `formatMoney(currency)`.

### 8.3 Reporte de canjes
- Por promo: clienta · reserva · monto descontado · fecha · `source` · estado.
- Agregados: total canjes · total descontado · ticket promedio (excluye
  `released`). Card de impacto en la lista.
- **Export CSV** con BOM (Excel + tildes), mismo patrón que Pagos.

### 8.4 Roles
- Gestionar promos: `owner/admin`.
- **Aplicar** un código al reservar: cualquiera que pueda crear reservas (incl.
  `staff`) y la clienta en público.

---

## 9. Validaciones y disciplina técnica

- `createPromotionSchema` / `updatePromotionSchema` (zod, en `@/lib/promotions/`):
  nombre, código (regex+normalize), coherencia `rewardType`↔`rewardValue`
  (% 1–100; montos ≥ 0), `validUntil > validFrom`, alcance, límites ≥ 0.
- `conditions` y `metadata` JSON validados con zod al escribir.
- **Multi-tenant**: cada query/action scoped por `businessId`.
- ⚠️ **`'use server'`**: el módulo de server actions exporta **solo funciones
  async**. Schemas/tipos/helpers viven en `@/lib/promotions/` puro (pitfall que ya
  nos mordió 2 veces — ver memorias del repo).
- `revalidateBusinessPublicPaths` y demás **siempre `await`** (otra memoria del
  repo).
- **Rate-limit** en `previewPromotion` y en las mutaciones (`checkRateLimit`).
- **Currency-clean**: `formatMoney` helper; cero `es-CL`/`$` hardcodeado nuevo.

---

## 10. Estructura de archivos (propuesta)

```
src/lib/promotions/
  schema.ts          # zod: create/update/conditions/metadata + tipos
  evaluate.ts        # isRedeemable() + cálculo de descuento (puro, testeable)
  format.ts          # formatMoney(monto, currency)  (o src/lib/money.ts compartido)
src/server/actions/
  promotions.ts      # 'use server' — CRUD, previewPromotion, reporte (solo async fns)
src/app/dashboard/promociones/
  page.tsx           # lista
  promotion-form.tsx # crear/editar
  redemptions-...    # reporte por promo + export
```

Integración: `createBooking` y `createBookingFromDashboard` (en
`src/server/actions/bookings.ts`) llaman al resolvedor; `cancelBooking` /
`updateBookingStatus` / cron de holds disparan el `release`.

---

## 11. Estrategia de tests

- **Unitarios (puros, sin DB):** `evaluate.ts` — `isRedeemable` (cada condición:
  inactiva, fuera de ventana, agotada, por-clienta, minSpend, alcance) y el cálculo
  de descuento (%, fijo, gratis, tope, floor/redondeo, cap a totalPrice).
- **Unitarios schema:** `createPromotionSchema`/`updatePromotionSchema` (código
  normalizado, coherencia tipo↔valor, fechas, límites).
- **Acción (mock prisma):** `previewPromotion` (rate-limit, respuesta genérica),
  aplicación atómica (incremento de count), idempotencia por `bookingId`,
  release+decremento en cancelación.
- **e2e (Playwright):** crear promo en el panel → reservar en público con el código
  → ver el descuento en la reserva y el canje en el reporte.

---

## 12. Riesgos / edge cases cubiertos

- Enumeración de códigos → rate-limit + respuesta genérica.
- Race en tope global → incremento atómico; race por-clienta → conteo en
  transacción (riesgo bajo).
- Promo editada entre preview y confirm → apply es autoritativo.
- Reserva 100% gratis → confirma sin pasar por MP.
- Cancel/no-show/hold-expirado → libera cupo.
- Borrado de promos → soft (isActive) para preservar el libro de canjes.

---

## 13. Forward-notes para B/C/D/E (no se construyen en A)

- **B:** `conditions` + `triggerType=automatic/granted`; `PromotionGrant` para
  promos emitidas a una clienta; `LoyaltyLedger`/`LoyaltyConfig` (puntos);
  superficie "Mi tarjeta" por link mágico.
- **C:** segmentación + entrega WhatsApp/email.
- **D:** login de clienta (Google OAuth + email) → enchufa a "Mi tarjeta".
- **E:** `formatMoney` ya sembrado en A; falta decidir minor-units (decimales) y
  proveedor de pago por país.
