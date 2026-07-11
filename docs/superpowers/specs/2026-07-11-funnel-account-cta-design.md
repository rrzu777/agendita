# CTA de cuenta en el funnel público de reservas — Design

**Fecha:** 2026-07-11 · **Estado:** aprobado por el usuario (fast-follow de D1)
**Contexto previo:** D1-a (login Google + /mi, PR #50/#66) y D1-b (self-service cancel/reschedule, PR #68) mergeados. El login de clienta existe pero el funnel público nunca lo menciona ni lee la sesión.

## Objetivo

Que el funnel público invite a la clienta a usar su cuenta: loguearse para autocompletar sus datos (y garantizar la vinculación), ver su cuenta desde la landing del negocio, y crear cuenta después de reservar. Sin fricción para invitadas: el flujo guest queda intacto.

## Hechos verificados del código (base del diseño)

- La cookie de sesión Supabase ya cubre todos los subdominios (`cookie-domain.ts` → `.agendita.cl`), pero **ninguna page del funnel lee la sesión** hoy.
- El OAuth siempre resuelve en el host de la app (`getAppUrl('/auth/callback')`), y `sanitizeNext` solo acepta paths root-relative → **no puede expresar un retorno cross-subdominio**. `sanitizeNext` NO se toca.
- El middleware no hace redirects por host: `/ingresar`, `/mi`, etc. renderizan igual en subdominios de tenant; los links relativos se quedan en el host actual.
- El paso "Tus datos" (`step-customer.tsx`) es un form client-side sin prefill; el wizard (`wizard.tsx`) es `useState` puro, sin persistencia; `BookingData` contiene `Date`s y campos de servicio denormalizados.
- La vinculación vía 3 (`linkCustomerFromBookingSession`) exige **match case-insensitive del email verificado de la sesión con el email tipeado**; el email del funnel es **opcional**. Vía 1 (`prepareMiUser`) también vincula por email verificado.
- Superficies post-reserva: `StepConfirmation` (modes `paid`/`pending`), los estados inline de transferencia en `StepPayment` (`transfer-details`/`transfer-declared`, acción crítica "Ya transferí"), y la page durable `/book/confirmation?bookingId=` (7 estados, incluye `TransferPanel` cuando `canDeclare`).
- `signOut` está cableado a `redirect('/')` sin parámetro.
- El banner de paquetes (`usePackageAvailability`) se activa por **teléfono** del paso "Tus datos".
- `/mi/[slug]` hace `notFound()` si el usuario no tiene Customer vinculada en ese negocio; `/mi` (home) nunca 404ea.
- Precedente de CTA: `/tarjeta/[token]` → "Guardar mi tarjeta en mi cuenta" → `/ingresar?next=…`.

## Diseño

### 1. Lectura de sesión en el funnel

Las pages del funnel (`src/app/page.tsx` subdominio, `src/app/book/page.tsx`, y las variantes path-based `/b/[slug]`, `/book/[slug]`) leen `getCurrentUser()` y, con sesión, la Customer vinculada del negocio (`userId` + `businessId`, la más antigua por `createdAt asc` — mismo criterio que `/mi/[slug]`). Baja como prop `sessionCustomer: { name, email, phone } | null` + `sessionEmail: string | null` al perfil y al wizard.

**Verificación obligatoria en el plan:** las pages del funnel ya leen `headers()` (tenant) y deberían ser dinámicas, pero `revalidateBusinessPublicPaths` sugiere caching por tags/paths. Confirmar que agregar `getCurrentUser()` (lee cookies) no cambia el perfil de caching actual; si alguna variante era estática, decidir explícitamente (lo esperado: ya son dinámicas y esto sale gratis).

### 2. Redirector confiable `/ir/[slug]`

Route handler (o page mínima) en `src/app/ir/[slug]/`: busca el negocio por slug en la DB; si no existe → `notFound()`; si existe → `redirect(getBookingFunnelUrl(business) + '?continuar=1')`. El destino sale de la DB, nunca del parámetro → no es open redirect y `sanitizeNext` acepta `/ir/<slug>` por ser root-relative. Es el único mecanismo nuevo de retorno cross-subdominio.

### 3. CTA en el paso "Tus datos" (`step-customer.tsx` + `wizard.tsx`)

**Sin sesión:** banner "¿Ya tienes cuenta? **Ingresa** y completamos tus datos". Al click:
1. El wizard serializa su estado a `sessionStorage` (key con el `businessId`/slug): `serviceId`, `date`/`timeSlot` como ISO strings, los campos de cliente parciales, `idempotencyKey`, `promotionCode`, y un `savedAt` timestamp.
2. Navega a `/ingresar?next=/ir/<slug>` (link relativo; `/ingresar` renderiza bien en el subdominio y el callback resuelve en el host de la app).

**Restauración:** al montar el wizard con `?continuar=1` en la URL y estado guardado con `savedAt` < 30 min: re-deriva el servicio desde la prop `services` por `serviceId` (si ya no existe o está inactivo, descarta todo y arranca limpio), repone `date`/`timeSlot` (ISO→Date), datos parciales y `currentStep` = paso "Tus datos". Limpia el storage tras restaurar (y también cuando está expirado). Sin el flag `?continuar=1` no se restaura nada.

**Con sesión:** prefill **editable** — nombre y email desde la sesión; teléfono desde `sessionCustomer` si existe. Línea informativa "Reservando como <email> · **No soy yo**". "No soy yo" solo **limpia el prefill localmente** (NO llama a `signOut` — perdería el estado del wizard; la clienta puede reservar para otra persona sin salir de su cuenta). Si edita el email, no habrá vinculación automática (regla vía 3 existente, sin guards nuevos). Sinergia gratis: el teléfono prefilleado activa el banner de paquetes existente.

### 4. CTA en la landing del negocio (`business-profile.tsx`)

Link discreto en la parte superior del perfil (texto pequeño, alineado a la derecha, sobre el contenido — no compite con "Reservar ahora"):
- Sin sesión: "Ingresar" → `/ingresar?next=/ir/<slug>`.
- Con sesión y Customer vinculada en el negocio: "Mi cuenta" → `/mi/<slug>` (relativo).
- Con sesión sin Customer vinculada: "Mi cuenta" → `/mi`.

### 5. CTA post-reserva

- **`StepConfirmation` (wizard):**
  - Sin sesión **y la reserva tiene email**: "Crea tu cuenta para ver y gestionar esta reserva" → `/ingresar?next=/mi`, con copy que pida usar **el mismo email** de la reserva (la vinculación vía 1 depende del match). Sin email en la reserva: **no se muestra** (llevaría a un /mi vacío).
  - Con sesión: "Ver mis reservas" → `/mi` (home; nunca 404ea aunque la vinculación no haya ocurrido por email editado).
- **`/book/confirmation`:** mismo CTA con las mismas condiciones, pero **solo cuando no hay acción de transferencia pendiente** (`canDeclare === false`). Jamás en los estados inline `transfer-details`/`transfer-declared` del wizard (ahí "Ya transferí"/"Ver estado" es la acción primaria).

### 6. Copy y consistencia

Mismo lenguaje del precedente de la tarjeta: "Ingresar", "Mi cuenta", segunda persona; nunca "login". Los tres CTAs comparten el mismo par de verbos.

## Fuera de alcance (documentado, no construir)

- Mostrar puntos/premios de fidelización dentro del funnel (fast-follow de loyalty).
- Email OTP como método de login (D2, bloqueado por Resend).
- Bloquear el email de la sesión en el form (se decidió prefill editable).
- Parámetro de retorno para `signOut`.

## Errores y bordes

- `/ir/[slug]` con slug inexistente → `notFound()`.
- Estado guardado corrupto/expirado → descartar silenciosamente y arrancar el wizard limpio.
- Servicio del estado guardado ya inactivo → descartar todo el estado (no restaurar parcial).
- Sesión sin fila `User` de Prisma: `getCurrentUser` devuelve el user de Supabase igual; el prefill usa datos de sesión y la Customer vinculada simplemente no existe → prefill de nombre/email solamente. Nada crashea.

## Testing

- **Unit:** redirector (slug válido → URL del funnel con `?continuar=1`; inexistente → 404). Helper de serialización/restauración del estado del wizard (round-trip con Dates, expirado, servicio inexistente, flag ausente).
- **Component (renderToStaticMarkup + mock next/navigation):** `step-customer` en 3 estados (guest banner, prefill con sesión, "No soy yo" limpiado); CTA de `StepConfirmation` en 4 combinaciones (sesión × email); CTA condicional en `business-profile`.
- **Integración:** no se necesita nueva (la vinculación vía 1/vía 3 ya está cubierta por los tests de D1-a).
- **e2e (opcional, no requerido):** smoke de landing CTA con sesión de admin.

Sin migración, sin cambios de schema, sin tocar `sanitizeNext` ni `signOut`.
