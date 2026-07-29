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
| Confirmación manual | Flag del negocio (`requireBookingApproval`), no del rubro. Sólo aplica sin abono (ver Track 2). |
| Multi-profesional | Resuelto: los dos modelos son válidos y coexisten (ver Track 5). |
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

**Estado: ✅ IMPLEMENTADO** (un PR). Cero cambio de comportamiento para los negocios
que no encienden el flag.

Hoy los estados eran `pending_payment → confirmed`. Un negocio sin abono recibía
reservas auto-confirmadas: cualquiera le llena la agenda.

## La decisión de alcance que hay que entender antes de tocar esto

**El flag SÓLO aplica a las reservas sin abono.** Si el servicio pide abono, la
reserva sigue naciendo `pending_payment` y el flag no hace nada.

El motivo no es pereza: aprobar DESPUÉS de cobrar obliga a devolver plata, que es
justo lo que el abono existe para evitar. Y con abono el negocio ya tiene un filtro
manual — con transferencia bancaria la dueña verifica a mano y puede rechazar.

**El agujero que queda:** un negocio con Mercado Pago + abono + confirmación manual
no tiene ningún filtro (MP cobra y auto-confirma). Cerrarlo exige mover la aprobación
ANTES del cobro, lo que implica una superficie nueva de "pagá tu reserva" alcanzable
por link desde un email — hoy el pago sólo vive dentro del funnel `/book/[slug]`. Es
un track propio, no un parche.

## Qué se construyó

- `Business.requireBookingApproval Boolean @default(false)` — flag, no rubro.
  Switch en Ajustes, con el copy que aclara lo del abono.
- `BookingStatus.pending_confirmation` nuevo. Migración
  `20260729180000_booking_manual_approval` (el `ADD VALUE` va solo y sin usarse en la
  misma migración: Postgres no deja referenciar un valor de enum recién creado dentro
  de la transacción que lo crea, y `migrate deploy` corre cada archivo en una).
- `src/lib/bookings/approval.ts` — fuente única: `HELD_STATUSES`,
  `OCCUPYING_STATUSES`, `initialPublicBookingStatus()`, `approvalHoldExpiresAt()`.
- **Aceptar = `updateBookingStatus(id, 'confirmed')`** (entrada nueva en
  `VALID_STATUS_TRANSITIONS`); limpia el hold y dispara el email de confirmación.
  **Rechazar = `cancelBooking(id, motivo)`**, que ya existía: libera canjes, cancela
  declaraciones y ahora manda el motivo en el email. No hicieron falta actions nuevas.
- Vencimiento: se reusa `holdExpiresAt` (campo e índice `[status, holdExpiresAt]` ya
  existían, y todo lo que lo lee filtra además por status). Ventana de 24h **acotada a
  la hora de la cita**: una solicitud no puede seguir viva después del turno.
- Sweep nuevo en `expire-holds.ts` → `expired` + email a la clienta con el motivo.
  **No filtra por `paymentStatus`** a diferencia del sweep de holds de pago: un
  servicio gratis nace `fully_paid` y ese filtro lo dejaba colgado para siempre.

## Landmine: el estado nuevo ocupa el cupo en CUATRO lugares

Tiene que bloquear el slot mientras el hold viva, igual que `pending_payment`:

1. `HELD_STATUSES` en `lib/bookings/approval.ts` — la fuente.
2. `generateSlots` (en memoria) → usa `isHeldStatus()`.
3. `overlappingActiveBookingsWhere` de `time-blocks.ts` (Prisma) → usa las constantes.
4. **El SQL crudo de `assertNoBookingOverlap`** (`availability/validation.ts`) →
   **repite los literales a mano.** No se pueden parametrizar: un `IN` de enums en
   `$queryRaw` manda los valores como `text` y Postgres rompe con
   `operator does not exist`. La única red de esa duplicación son los dos casos de
   integración `slot-conflicts.test.ts` ("ocupa el cupo" / "libera el cupo").

`getEffectiveBlocks` NO hacía falta tocarlo: es de bloqueos, no de reservas. Los dos
loaders que sí leen reservas (`availability.ts`, `reschedule-slots.ts`) filtran con
`notIn: ['cancelled','no_show','expired']`, así que ya incluían el estado nuevo.

## Fuera de alcance, a propósito

- **`suggestedStartDateTime`** ("te propongo otro horario" con link para re-reservar).
  El rechazo con motivo libre ya funciona; proponer alternativa es un seam limpio
  para un follow-up.
- El copy de `getReviveReopenState` para una solicitud expirada dice "esta reserva no
  eligió transferencia: confirmala y registrá el pago aparte". El camino que importa
  (confirmar) funciona; la frase sobra cuando no hay nada que pagar. No recibe
  `depositRequired` y threadearlo no valía el PR.

# Track 3 — Modalidad de atención

**Estado: ✅ IMPLEMENTADO** (un PR). Un negocio que no toca nada sigue funcionando
igual: todo nace `on_site` y esa modalidad no cambia ni una pantalla.

- `enum ServiceModality { on_site, at_home, online }`.
- `Service.modalities ServiceModality[] @default([on_site])` — varias por servicio; el
  funnel sólo pregunta cuando hay más de una.
- `Booking.modality` (**NOT NULL con default**, así el backfill lo hace la propia
  columna y nadie tiene que manejar un null que nunca significó nada) +
  `Booking.serviceAddress` (domicilio) + `Booking.meetingUrl` (online).
- `Business.defaultMeetingUrl` — la sala fija de Zoom/Meet. Se **copia** a la reserva
  al crearla: si el negocio la cambia después, las citas ya avisadas conservan el link
  que la clienta recibió. Sin esto, "modalidad online" era una etiqueta que no
  entregaba nada y la practicante tenía que mandar el link por WhatsApp igual.
- Desbloquea constelaciones y registros akáshicos sin agregar rubros al enum.

## Decisiones que conviene no re-litigar

- **La modalidad es del SERVICIO, no del rubro.** Cero `if (category === ...)`.
- **No toca la agenda.** El tiempo de traslado entre domicilios es un problema real de
  disponibilidad y merece su propia iniciativa — no lo metas de contrabando acá.
- **El server manda.** `resolveBookingModality` ignora lo que pida el cliente cuando el
  servicio tiene una sola modalidad, y rechaza una que el servicio no ofrece. La
  dirección se descarta fuera de domicilio en vez de guardarse "por las dudas".
- **El picker vive dentro de la tarjeta del servicio**, no en un paso nuevo: con una
  sola modalidad el click avanza como siempre y el funnel no se alarga.

## Landmines encontradas al construirlo

1. **`Service.modalities` es la primera lista escalar de enums del proyecto**
   (`"ServiceModality"[]` en Postgres). `tests/integration/service-modality.test.ts`
   existe para que la migración se pruebe de verdad: default del backfill, round-trip
   del array y filtro `has`.
2. **Los mocks de `service.findFirst` mentían.** Ninguno devolvía `modalities`, así que
   `sortModalities` reventaba con un TypeError. Se arreglaron los fixtures en vez de
   ablandar el helper: un `findFirst` real SIEMPRE trae la columna.
3. **La dirección restaurada del wizard tiene que colgarse de la modalidad RESUELTA**,
   no de la guardada. Si la dueña sacó "a domicilio" mientras la clienta iba a
   `/ingresar`, la modalidad se descarta pero la dirección sobrevivía. Lo cazó un test.
4. **`useState` después de un early return.** El picker se agregó dentro de
   `StepService`, que retorna temprano cuando no hay servicios. Lo cazó el lint.

## Fuera de alcance, a propósito

- Editar el `meetingUrl` de UNA reserva desde el dashboard (hoy sale de la sala fija).
- Un modelo de "zonas de cobertura" o recargo por domicilio.

# Track 4 — Fotos en la ficha

**Estado: ✅ IMPLEMENTADO** (un PR). Un negocio que nunca sube una foto no ve
ningún cambio salvo un panel vacío en la ficha.

- `CustomerPhoto` — `businessId`, `customerId`, `bookingId?`, `key` (única),
  `contentType`, `caption?`, `createdAt`.
- `src/lib/storage/photos.ts` — espejo de `proof.ts`: tipos permitidos (**sólo
  imágenes**, nada de PDF), tope de 5 MB, cuota de 60 por ficha, armado y
  validación de la key, schema del attach.
- El bucket es el mismo de los comprobantes, así que `ProofStorage` pasó a
  llamarse **`ObjectStorage`** (`getObjectStorage`, `isObjectStorageAvailable`) y
  ganó `remove()`. Lo que distingue una feature de otra es el prefijo de la key,
  no el transporte.
- Las fotos se sirven por `/dashboard/photos/[photoId]`, que verifica el negocio
  y redirige a un GET prefirmado de 60s. **Nunca** se expone la key ni una URL
  pública, igual que el comprobante.
- Se ven en la ficha (panel "Fotos", columna ancha) y en el drawer de la agenda,
  filtradas por esa cita.

## Decisiones que conviene no re-litigar

- **La key la arma el servidor.** El token es un `crypto.randomUUID()` generado
  en el presign; cuando la key vuelve del cliente para el attach,
  `isOwnCustomerPhotoKey` exige el prefijo exacto de ESA ficha y que lo que sigue
  sea un token nuestro y nada más. Sin eso, cualquiera podía colgarse el objeto
  de otro negocio en su propia ficha.
- **El bucket manda sobre el tamaño y el tipo.** El cliente valida para dar un
  error rápido, pero el attach hace `HEAD` y decide con lo que hay en R2 de
  verdad. Lo que dice el navegador no cuenta.
- **Borrar: primero la fila, después el objeto, y el objeto sin bloquear.** Si R2
  falla, queda un huérfano en el bucket y la foto ya no se ve en ningún lado. Al
  revés, un fallo dejaría la ficha mostrando una foto rota — bastante peor.
- **Al borrar la reserva la foto sobrevive** (`ON DELETE SET NULL`): es de la
  ficha, la cita es sólo dónde se sacó.
- **No exige owner/admin**, a diferencia del comprobante: la ficha ya la ve
  cualquier persona del equipo y las fotos son parte de ella.
- **Las sube el negocio, no la clienta.** No hay superficie pública. El panel lo
  dice explícito ("las ve solo tu equipo").

## Landmines encontradas al construirlo

1. **`tests/unit/customer-detail-page.test.tsx` reventó por un mock incompleto de
   `next/navigation`.** La página empezó a llamar una action envuelta en
   `action()`, que usa `unstable_rethrow`; el mock no lo tenía y el fallo salía
   como "No export is defined", no como "falta mockear las fotos". Se arregló
   mockeando `@/server/actions/customer-photos`.
2. **El drawer sólo monta el panel mientras está abierto.** Si no, la agenda
   pediría las fotos de todas las citas del mes para mostrar una.
3. **Subida de a una, no en paralelo** — por progreso legible y para no saturar
   el uplink del celular. La cuota NO es la razón: es best-effort igual (sin
   constraint en la base, dos pestañas se pasan por una).
4. **Prisma IGNORA un `id: undefined` en el `where`.** `resolveTarget` sin ficha
   ni reserva resolvía a una ficha CUALQUIERA del negocio. Va guard explícito, y
   hay un test de integración que lo fija.
5. **`fetch` TIRA cuando se corta la red** (no devuelve un response con `ok:
   false`). Sin try/catch alrededor del PUT, la excepción se escapaba del bucle
   de subida y dejaba el botón trabado en "Subiendo…" para siempre.
6. **La lectura y la escritura tienen que autorizar igual.** Al principio leer
   las fotos de una reserva ajena devolvía `[]` ("sin fotos") y escribirla decía
   "no encontrada". Ahora las dos pasan por `resolveTarget`.
7. **Tragarse el error de lectura miente.** La ficha hacía `res.ok ? data : []`
   y un R2 caído se veía idéntico a una clienta sin fotos. El motivo viaja al
   panel (`initialError`).

## Fuera de alcance, a propósito

- **Achicar la imagen en el navegador antes de subirla.** Vale la pena (una foto
  de celular son 3-5 MB) pero re-encodear en canvas se come la orientación EXIF
  si se hace mal, y eso son fotos rotadas — peor que fotos pesadas. Mientras
  tanto: tope de 5 MB y `loading="lazy"` en la grilla.
- Miniaturas server-side, álbumes/antes-después explícito, y que la clienta vea
  sus propias fotos desde `/mi`.

# Track 5 — Multi-profesional

**Ya NO está bloqueado.** La pregunta era "¿quién cobra?" y la respuesta del usuario es
que **los dos casos son válidos y hay que cubrirlos**:

- barbero independiente → su propia cuenta. Ya funciona hoy, cero trabajo.
- dueño de salón que gestiona a sus 4 personas en UNA cuenta → esto hay que construirlo,
  porque la plata, las fichas y el calendario son del negocio.

Diseño: `StaffMember` **sin cuenta propia** (nombre, foto, bio, horario) +
`Booking.staffId` **nullable**. Un negocio sin StaffMembers se comporta exactamente
como hoy → cero migración, cero riesgo para las usuarias actuales; la feature se
enciende cuando el dueño agrega a la primera persona. El login por profesional se
cuelga después sin romper nada.

**Lo caro no es el modelo, es la disponibilidad.** Hoy horario, bloqueos y detección de
choques son DEL NEGOCIO ENTERO. Con varias personas la misma hora está libre para una y
ocupada para otra → toca `generateSlots`, y el advisory lock anti-doble-reserva (hoy
keyed por negocio + día local) tiene que incluir a la persona, o dos clientas
reservando con profesionales distintos se estorban. Detrás viene **comisiones**, que es
otro feature entero.

Estimado: el track más grande de los cinco, 4-6 PRs. Va DESPUÉS de 2 y 3.
