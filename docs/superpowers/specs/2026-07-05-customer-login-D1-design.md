# D1 — Login de clienta (Google) + superficie `/mi` + self-service de reservas

> **Estado:** aprobado en brainstorming (2026-07-05). Brief origen: `../briefs/2026-06-28-D-login-clienta.md`.
> **Rebanadas:** D1-a (auth + vinculación + `/mi` read-only) y D1-b (self-service). D2 (email OTP) queda fuera de este spec.

## Decisiones de producto (cerradas)

1. **D antes de B4b.** El login de clienta resuelve la superficie de compra de paquetes online; el backend de B4b no cambia por esperar.
2. **Identidad multi-negocio:** una cuenta (Google) sirve para todos los negocios donde la clienta reserva. Un `User` → N `Customer` (uno por negocio).
3. **Login opcional:** el funnel guest por teléfono queda intacto. Login solo agrega valor, nunca fricción.
4. **Vinculación por 3 vías:** email verificado (auto-link), token de tarjeta (explícito), reserva logueada.
5. **Auth:** solo Google OAuth en D1. Email OTP es D2 (bloqueado por proveedor de email: Resend caído → rotar key o migrar a Brevo).
6. **Alcance:** tarjeta completa + historial + próximas reservas + canje, **y** cancelar/reprogramar sola.
7. **Ventana de autogestión:** configurable por negocio (`selfServiceCutoffHours`, default 24; 0 = sin límite).
8. **Depósitos al cancelar:** sin reembolso automático. El release de promo/paquete es automático (lógica existente); la plata la resuelve la dueña como hoy.

## Arquitectura elegida

**Mismo proyecto Supabase, reusar `User`, link por `Customer.userId`.** Una persona = un auth user de Supabase = una fila `User`, sin enum de tipo de usuario. El rol es contextual: dueña = tiene `BusinessUser`; clienta = tiene `Customer` vinculados. Una misma persona puede ser ambas. Se descartaron: proyecto Supabase separado (duplica infra, rompe el caso dueña-que-es-clienta) y auth propia (reinventa sesiones).

Dato clave verificado: la cookie de sesión ya se comparte con subdominios de tenant (`src/lib/auth/cookie-domain.ts` → `.agendita.cl`), así que la sesión de la clienta está disponible en el funnel público de cada negocio sin tocar cookies.

## 1. Modelo de datos (migración aditiva, D1-a)

```prisma
model Customer {
  // ...existente
  userId String?
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)
  @@index([userId])
}

model Business {
  // ...existente
  selfServiceCutoffHours Int @default(24) // 0 = sin límite
}
```

- `User` no cambia. `onDelete: SetNull`: borrar la cuenta desvincula, no borra historial del negocio.
- `userId` nullable para siempre: los Customer guest no requieren cuenta.
- Sin backfill. Aplicar con `db execute` + **`migrate resolve --applied`** (landmine §2.3 del handoff).

## 2. Auth y guards

- **Gap crítico #1 (verificado):** la fila `User` de Prisma solo se crea al registrar un negocio (`createBusinessForUser`, `src/lib/auth/actions.ts:246`). Fix: **`ensureUserRow()`** — upsert por `id` (= Supabase auth id) con email/nombre del token — corre al entrar a cualquier superficie de clienta, antes de cualquier vinculación.
- **Gap crítico #2 (verificado):** `sanitizeNext` defaultea a `/dashboard` y el layout del dashboard manda a authed-sin-negocio a `/recover-business` (le recrearía un negocio a una clienta). Fix: (a) `/ingresar` siempre manda `next=/mi`; (b) el redirect de "sin negocio" del dashboard decide: si el user tiene `Customer` vinculados → `/mi`; si no → `/recover-business` como hoy.
- **`/ingresar`:** página pública mínima, botón Google, `?next=` sanitizado con `sanitizeNext` (default `/mi` en este contexto). Reusa el flujo PKCE/callback existente sin cambios.
- **Guard nuevo:** `requireCustomerSession()` en `src/lib/auth/` — exige sesión Supabase, devuelve `{ user }`. No exige `BusinessUser`. Toda action de clienta valida ownership con `customer.userId === user.id`; jamás confía en ids del cliente.
- **Dashboard intacto:** `requireBusiness`/`requireBusinessRole` siguen protegiendo el dashboard. Test explícito: clienta logueada no accede a `/dashboard`.
- **e2e bypass:** `getE2ETestUser` ya tolera users sin negocios; los e2e de clienta usan el mismo header bypass con un user sin `BusinessUser`. Verificar, no construir.

## 3. Vinculación Customer ↔ cuenta

Módulo único `src/lib/customers/link.ts`, tres puntos de entrada:

1. **Email verificado (auto-link):** tras login/entrada a `/mi`, `linkCustomersByVerifiedEmail(userId, email)`:
   - Solo si el token trae `email_verified` (Google lo garantiza; el guard queda listo para D2/OTP).
   - Match `trim` + case-insensitive contra `Customer.email`, **solo `userId: null`** (`updateMany`) → nunca pisa un link existente, idempotente, barato en cada login.
   - Duplicados (mismo email en 2+ Customer del mismo negocio): se vinculan todos — son saldos reales y separados; la UI agrupa por negocio. El merge de duplicados es problema pre-existente del dashboard, fuera de D1.
2. **Token de tarjeta (explícito):** CTA "Guardar mi tarjeta" en `/tarjeta/[token]` → `/ingresar?next=/tarjeta/<token>/vincular`. La página `vincular` ejecuta una server action que revalida el token en el momento y vincula solo si `userId: null`; si ya está vinculado a otra cuenta → error claro, no pisa. Redirige a `/mi`.
3. **Reserva logueada:** en `createBooking` público, si hay sesión, el Customer resuelto/creado por teléfono recibe `userId` si no lo tiene. Vía de alta para clientas nuevas sin historial.

Regla única de conflictos: **nunca sobrescribir un `userId` existente.** Desvincular/merge queda fuera de D1 (soporte manual).

Riesgo aceptado (decisión explícita): un typo de email ajeno en un Customer podría auto-vincular el historial de otra persona a la cuenta dueña de ese email. Impacto bajo (ve puntos/reservas), mitigado porque el email debe coincidir exacto y estar verificado en el lado de la cuenta.

## 4. Superficie `/mi`

- **`/mi`** — home multi-negocio: una card por Customer vinculado agrupadas por negocio (nombre, puntos, próxima reserva). Estado vacío explicativo ("abrí el link de tu tarjeta o hacé una reserva con este email"). Header mínimo con "Salir" (signOut existente).
- **`/mi/[slug]`** — detalle por negocio: tarjeta completa (puntos, recompensas, canje, paquetes) + próximas reservas + historial. Si hay más de un Customer vinculado en el mismo negocio (duplicados), el detalle lista cada tarjeta por separado — no se combinan saldos.
  - **Cero reimplementación:** los componentes de `/tarjeta/[token]` se extraen a compartidos; ambas rutas los renderizan. La diferencia es solo cómo se resuelve el Customer (token vs sesión).
  - El canje reusa `redeemForGrant` con ownership por sesión en vez de token.
  - **Landmine P2028:** `getCustomerLoyalty` corre tx interactiva — correrla sola primero y el resto de lecturas en paralelo después (mismo fix que `customers/[id]/page.tsx`).
- **`/tarjeta/[token]` sigue viva** como superficie guest y punto de entrada de vinculación.

## 5. Self-service de reservas (D1-b)

- **Refactor previo:** extraer el core de `cancelBooking` y `rescheduleBooking` (`src/server/actions/bookings.ts:948`, `:1002`) a `src/lib/bookings/mutate.ts` — funciones tx-aware sin auth. El release de promos/paquetes y el anti-doble-booking ya viven ahí; no se duplican. Las actions de dueña quedan como wrappers con su auth actual.
- **Actions nuevas** en `src/server/actions/my-bookings.ts` (módulo `'use server'`: solo exports `async` — landmine §2.1):
  - `getMyBookings()` — próximas (pending_payment/confirmed, futuras) e historial de los Customer vinculados.
  - `cancelMyBooking(bookingId)` — guards: sesión + ownership + status `pending_payment` o `confirmed` (los únicos con transición válida a `cancelled`) + ventana `startDateTime − now > selfServiceCutoffHours` (0 = sin límite). Depósito intacto.
  - `rescheduleMyBooking(bookingId, newStart)` — misma ventana **sobre el horario actual** (el nuevo slot no tiene restricción de ventana: se rige por las mismas reglas que una reserva nueva del funnel); nuevo slot validado con disponibilidad real (`getEffectiveBlocks` — read path obligatorio para bloqueos — + anti-doble-booking) y dentro de `bookingWindowDays`.
  - Todas con `checkRateLimit` y todo `revalidate*` con `await` (landmine §2.2), incluyendo revalidación de paths del dashboard para que la agenda de la dueña refleje el cambio.
- **Notificaciones:** nueva `sendOwnerBookingChangedNotification` (email a la dueña: "X canceló/reprogramó su reserva") + confirmación a la clienta. Vía `sendNotificationSafely`. Nota operativa: con Resend caído no salen emails; la señal garantizada es el cambio en la agenda del dashboard.
- **UI:** botones cancelar/reprogramar en `/mi/[slug]` solo cuando la ventana lo permite (el server igual re-valida); fuera de ventana, mensaje "contactá al negocio" con la política del negocio. Reprogramar reusa el picker de fecha/hora del funnel público.
- **Settings:** campo "Ventana de autogestión (horas)" en settings de reservas del dashboard, default 24, rango 0–720, con nota "0 = sin límite".

## 6. Rebanado en PRs

| PR | Contenido | Migración |
|---|---|---|
| **D1-a** | Migración · `ensureUserRow` · `/ingresar` · `requireCustomerSession` · fix redirect dashboard-sin-negocio · 3 vías de vinculación · `/mi` + `/mi/[slug]` (tarjeta compartida + reservas read-only + canje) · CTA en tarjeta | Sí (aditiva) |
| **D1-b** | Refactor `mutate.ts` · `cancelMyBooking`/`rescheduleMyBooking` · setting + UI de ventana · notificación a dueña · picker de reprogramación | No |
| **D2** | Email OTP (requiere proveedor de email funcionando) | — |

Cada PR sigue el ciclo estándar: writing-plans → subagent-driven-development (TDD) → /simplify → code review experto → e2e → gate (suite/tsc/lint) → migración con OK explícito → PR → merge con OK.

## 7. Testing

- **Unit:** matching de email (case/trim/verified-only/no-pisar), cálculo de ventana (incluye 0 = sin límite y borde exacto), guards de ownership, `ensureUserRow` idempotente (upsert, conflicto de email único).
- **Component:** mock de `next/navigation` para todo componente que use `useRouter` (landmine §2.5).
- **Integración (CI):** 3 vías de vinculación (incl. no-pisar y token inválido), cancel/reschedule con ownership ajeno, fuera de ventana, status no cancelable, doble-booking en reschedule.
- **e2e (mimosnails, header bypass):** login de clienta (user sin `BusinessUser`), `/mi` con tarjeta vinculada, cancelar dentro de ventana. No es check requerido; deja artefactos en prod.
- **tsc:** cero errores nuevos sobre los ~17 pre-existentes.

## 8. Seguridad

- Open redirect: todo `next` pasa por `sanitizeNext`.
- Ownership server-side en toda action de clienta (`customer.userId === user.id`); ids del cliente nunca son fuente de verdad.
- Auto-link solo con email verificado; vinculación por token revalida el token al ejecutar.
- Rate limiting en actions públicas nuevas.
- `/mi` no expone datos de Customer no vinculados; la clienta no accede a `/dashboard`.

## Fuera de alcance (explícito)

- Email OTP / magic link (D2, bloqueado por proveedor de email).
- Desvincular cuenta / merge de Customer duplicados.
- Reembolso automático de depósitos vía Mercado Pago.
- Compra de paquetes online (B4b — se apoya en esta superficie cuando llegue).
- Enforcement estricto de `maxPerCustomer` por identidad verificada (mejora natural post-D, fast-follow).
