# Verticalización por rubro — Plan de implementación

> **Para agentes:** este documento tiene la hoja de ruta de los 5 tracks y el detalle
> paso a paso del Track 1. Los tracks 2–5 tienen diseño cerrado pero **no** pasos
> detallados; se escriben justo antes de ejecutarlos, porque cada uno depende de lo
> que dejó el anterior (el track 2 y el 5 tocan los dos el motor de slots).

**Objetivo:** que agendita deje de asumir "salón de uñas en Chile" y sirva a barberías,
masajes, terapias y rubros remotos (constelaciones, registros akáshicos) sin
duplicar producto.

**Arquitectura:** la variabilidad real es **por servicio**, no por rubro. El rubro
(`BusinessCategory`, ya existe) sólo elige *defaults* y *vocabulario*. Nada de
`if (category === 'barber')` en lógica de negocio — si un rubro necesita un
comportamiento, ese comportamiento se expresa como configuración de un motor común.

**Stack:** Next.js 16 App Router, Prisma/Postgres, vitest (unit + integration),
Playwright (e2e), Tailwind + shadcn.

---

## Contexto: qué ya existe

- `enum BusinessCategory { nails, barber, hair_salon, beauty, massage, therapy, other }`
  en `prisma/schema.prisma:36`.
- El registro ya pide "Rubro" (`src/app/register/page.tsx:130`).
- El rubro se usa para **una sola cosa**: sembrar servicios de ejemplo
  (`SERVICE_TEMPLATES`, `src/lib/auth/actions.ts:17`). Después no se lee nunca más.
- `getCurrentUserWithBusiness()` (`src/lib/auth/user.ts`) está envuelto en
  `React.cache` y devuelve el business completo — incluido `category`. Leer el rubro
  en cualquier server component del dashboard **no cuesta una query extra**.
- No hay ningún `createContext` en el proyecto. El track 1 introduce el primero.

## Decisiones cerradas

| Decisión | Resuelto |
|---|---|
| Vocabulario | Femenino en `nails`, `beauty`, `hair_salon`. Neutro en `barber`, `massage`, `therapy`, `other`. |
| Modalidad | Es un atributo **del servicio**, no del negocio. Un servicio puede tener varias. |
| Confirmación manual | Flag del negocio (`requireBookingApproval`), no del rubro. |
| Multi-profesional | **Pendiente** — depende de quién cobra (ver Track 5). |
| Rubros nuevos | No se agregan valores al enum en esta iniciativa. `other` ya cubre constelaciones/registros akáshicos: lo que ese caso necesita es *modalidad online*, no un rubro propio. |

## Orden y por qué

1. **Vocabulario** — el barbero real ve texto mal escrito hoy. Barato, cero riesgo.
2. **Confirmación manual** — un barbero sin abono tiene la agenda abierta a que se la llenen. Es el que más le duele.
3. **Modalidad** (local / domicilio / online) — desbloquea domicilio y rubros remotos.
4. **Fotos en la ficha** — alto valor en uñas y color, no urgente.
5. **Multi-profesional** — el más grande, y puede que no haga falta.

---

# Track 1 — Vocabulario por rubro

**Entrega:** un PR. Ningún cambio de comportamiento para los negocios existentes
(`nails`/`beauty`/`hair_salon` siguen leyendo exactamente lo mismo que hoy).

## El problema real

Hay ~60 strings de cara al usuario con género femenino hardcodeado, repartidos en
UI del dashboard, plantillas de email y mensajes de error de server actions.

En castellano el género **sólo** rompe en artículos, adjetivos y participios — los
verbos no concuerdan. Así que "Tus clientas verán estos datos" → "Tus clientes verán
estos datos" es un reemplazo de sustantivo y ya está correcto. Sólo un puñado de
frases necesita cuidado real:

- `Reactivar inactivas` → `inactivos` (adjetivo)
- `Referidas` → `Referidos` (adjetivo nominalizado)
- `una clienta` → `un cliente` (artículo)
- `La clienta` / `Esta clienta` → `El cliente` / `Este cliente`
- `ambas reciben` → `ambos reciben`

Por eso el léxico guarda **frases con concordancia ya resuelta**, no palabras sueltas
que después haya que pegar. Nada de trucos tipo `inactiv${v.o}s`: son ilegibles y se
rompen con el primer adjetivo irregular.

## Estructura de archivos

- Crear: `src/lib/vocabulary/index.ts` — léxicos + `getVocabulary(category)`. Puro, sin deps.
- ~~Crear: `src/lib/vocabulary/server.ts`~~ — se descartó en la ejecución, ver desviación 2.
- Crear: `src/components/vocabulary-provider.tsx` — context + `useVocabulary()` para client components.
- Crear: `tests/unit/vocabulary.test.ts`
- Modificar: `src/app/dashboard/layout.tsx` — envolver el árbol en el provider.
- Modificar: los ~25 archivos con strings de género (listados por tarea abajo).

## Estado: ✅ ENTREGADO

Lo que efectivamente se hizo, con las desviaciones respecto del diseño de arriba.

### Módulo

- `src/lib/vocabulary/index.ts` — 28 entradas por léxico (`FEMININE` / `NEUTRAL`),
  `getVocabulary(category)` e `interpolate(text, vocabulary)`.
- `src/components/vocabulary-provider.tsx` — contexto + `useVocabulary()`, colgado del
  layout del dashboard. **Es el primer contexto de React del proyecto.**
- `tests/unit/vocabulary.test.ts` — 8 casos, incluido el que compara las claves de los
  dos léxicos (el olvido más probable es agregar una clave a uno solo).

### Tres cosas salieron distinto del plan

**1. El léxico terminó bastante más grande que las 11 claves previstas.** El grep
inicial buscaba "clienta" y se perdió el resto del género: `Destinatarias`,
`referidora`, `la referida`, `Inactivas`, `Cumpleañeras del mes`, `Refiere una amiga`,
`ambas ganan`, `para reactivarla`. Un barrido más amplio
(`clienta|dueña|destinatari|referid|amiga|inactiv`) los sacó a todos.

**2. `getBusinessVocabulary()` se creó y se borró en la misma sesión.** Resolvía el
léxico desde la sesión (`getCurrentUserWithBusiness`), lo que agregaba una dependencia
de `cookies()` en server actions que **ya tenían el negocio** en el contexto de
`requireBusiness()`. Reventaba los tests unitarios de esas actions (mockean
`@/lib/auth/server`, no `@/lib/auth/user`) con un error genérico en vez del mensaje
esperado. Las actions ahora usan `getVocabulary(business.category)` a secas.

**3. `ServiceFitWarnings` no puede ser async.** Se volvió `async` para leer el léxico
del servidor y eso rompió sus tres tests: `renderToStaticMarkup` no renderiza un
componente que suspende. Volvió a ser síncrono y recibe `vocabulary` por prop desde
`availability/page.tsx`, que ya tiene el negocio cargado.

### Superficies cubiertas

| Superficie | Cómo llega el léxico |
|---|---|
| Client components del dashboard | `useVocabulary()` |
| Server components del dashboard | `getVocabulary(userData.business.category)` |
| Server actions | `getVocabulary(business.category)` del contexto de auth |
| Presets y labels de segmento (constantes de módulo) | tokens `{clave}` + `interpolate()` |
| Emails al negocio | `clientLabel` como 2º parámetro de la plantilla; el sender lo resuelve |
| Crons y webhooks (sin sesión) | `category` sumada al `select` que ya hacían |
| Tarjeta de fidelización (la ve la clienta) | prop desde `LoyaltyCard` |

### Fuera de alcance, a propósito

- `src/server/actions/my-bookings.ts:52` — `reason: 'cancelada por la clienta desde /mi'`
  es una nota interna del ledger, no la ve nadie.
- `src/lib/campaigns/send.ts:64` — sin `recipient` no hay negocio del cual sacar el
  rubro, así que ese mensaje se redactó sin género en vez de adivinar.

### Landmine encontrada

`npx tsc --noEmit | grep '^src/'` **no ve los errores de tipo en `tests/`**, y además
se frena entero si `.next/dev/types/` tiene un archivo generado obsoleto (TS1434), con
lo cual llega a reportar cero errores cuando en realidad no chequeó nada. Si el
chequeo sale sospechosamente limpio: `rm -rf .next/dev/types` y correrlo sin el grep.

# Track 2 — Confirmación manual del negocio

**Diseño cerrado, pasos pendientes.**

Hoy los estados son `pending_payment → confirmed`. Un negocio sin abono recibe reservas
auto-confirmadas: cualquiera le llena la agenda.

- `Business.requireBookingApproval Boolean @default(false)` — flag, no rubro.
- `BookingStatus.pending_confirmation` nuevo.
- **Landmine:** el estado nuevo tiene que bloquear el slot igual que `confirmed`, o se
  duplican reservas. Hay que sumarlo a toda enumeración de estados que ocupan agenda
  (`generateSlots`, `getEffectiveBlocks`, los índices de `Booking`, `payable-statuses.ts`).
- Aceptar → `confirmed` + email. Rechazar → `cancelled` + `rejectionReason` +
  `suggestedStartDateTime DateTime?` opcional, que el email muestra con link para
  re-reservar.
- Interactúa con holds y con el cron de expiración: una reserva esperando confirmación
  necesita su propio vencimiento, o queda colgada para siempre.

# Track 3 — Modalidad de atención

**Diseño cerrado, pasos pendientes.**

- `enum ServiceModality { on_site, at_home, online }`.
- `Service.modalities ServiceModality[] @default([on_site])` — varias por servicio; el
  wizard sólo pregunta cuando hay más de una.
- `Booking.modality` + `Booking.serviceAddress String?` (domicilio) + `Booking.meetingUrl String?` (online).
- Desbloquea constelaciones y registros akáshicos sin agregar rubros al enum.
- **Fuera de alcance:** tiempo de traslado entre domicilios. Es un problema real de
  agenda y merece su propia iniciativa — no lo metas de contrabando acá.

# Track 4 — Fotos en la ficha

**Diseño cerrado, pasos pendientes.**

- `CustomerPhoto` — `businessId`, `customerId`, `bookingId?`, `key`, `caption?`, `createdAt`.
- Reusa el presign de `src/lib/storage/r2.ts` con un namespace nuevo
  (`src/lib/storage/photos.ts`, espejo de `proof.ts`). Sólo imágenes, sin PDF.
- Se ve en el detalle de la ficha y al abrir una reserva.

# Track 5 — Multi-profesional

**Bloqueado por una pregunta de producto, no por código.**

La pregunta: **¿quién cobra?**

- Si cada barbero cobra lo suyo → cada uno se hace su propia cuenta. **Ya funciona hoy,
  el track no existe.**
- Si el dueño cobra y le paga a los barberos → una cuenta, varios profesionales adentro,
  porque la plata, las fichas y el calendario son del negocio.

Si resulta que hace falta, el diseño arranca por `StaffMember` **sin cuenta propia**
(nombre, foto, bio, horario) y `Booking.staffId`. El login por profesional se cuelga
después sin romper nada.
