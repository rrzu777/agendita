# Multi-profesional — diseño

> Track 5 (y último) de la iniciativa de verticalización por rubro. El plan de los
> 5 tracks vive en `docs/superpowers/plans/2026-07-28-verticalizacion-rubros.md`.

**Problema.** Un dueño de salón gestiona a sus 4 personas en UNA cuenta: la plata, las
fichas y el calendario son del negocio, pero la agenda es de cada persona. Hoy agendita
asume una sola agenda por negocio, así que 4 barberos no pueden atender a la misma hora.

**El barbero independiente ya funciona hoy** con su propia cuenta y no requiere trabajo.
Este diseño cubre el otro caso.

---

## Principio rector: la presencia de gente es el interruptor

No hay flag, no hay "modo salón", no hay nada que la dueña tenga que configurar bien.
El comportamiento se deriva de **cuántos profesionales activos** tiene el negocio:

| Profesionales activos | Comportamiento |
|---|---|
| 0 | **Idéntico a hoy.** Agenda del negocio, sin paso nuevo en el funnel, `professionalId = null` en las reservas nuevas. |
| 1 | Sin paso en el funnel: se asigna sola. Su nombre y bio sí salen en la página pública. |
| 2 o más | Aparece el paso de elegir; los horarios pasan a ser por persona. |

Consecuencias que se sostienen a propósito:

- **La migración no reescribe ni una fila.** Todo lo nuevo es nullable y `null` significa
  exactamente lo que hay hoy.
- **La vuelta atrás es un click.** Desactivar a toda la gente devuelve el negocio al
  comportamiento de hoy. La regla es por profesionales **activos**, no existentes —
  sin eso, dar de baja al último dejaba todos los servicios sin nadie asignado y por lo
  tanto no reservables: agenda brickeada.
- Lo único que no se deshace son las reservas ya hechas con una persona, que conservan
  la suya.

---

## Modelo

### `Professional`

Se llama `Professional`, **no** `StaffMember`: el enum `BusinessRole` ya tiene un valor
`staff` (hoy muerto, cero usos en `src`) que es un **rol de login**. Un modelo
`StaffMember` sin cuenta propia al lado de un rol `staff` que sí es una cuenta confunde
a cualquiera que lea el código.

```prisma
model Professional {
  id         String   @id @default(cuid())
  businessId String
  name       String
  bio        String?
  isActive   Boolean  @default(true)
  sortOrder  Int      @default(0)
  /// Dónde atiende ESTA persona. Se intersecta con las del servicio: un servicio
  /// a domicilio + alguien que no viaja = combinación que el funnel no ofrece.
  /// El default es sólo el del schema: al crear a alguien desde el panel se
  /// pre-marca la UNIÓN de las modalidades de los servicios que se le asignan.
  /// Dejarlo en on_site a secas dejaría un servicio online-only sin nadie que
  /// lo pueda dar, y el negocio no se enteraría.
  modalities ServiceModality[] @default([on_site])
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  business  Business           @relation(fields: [businessId], references: [id], onDelete: Cascade)
  services  Service[]          @relation("ProfessionalServices")
  rules     AvailabilityRule[]
  blocks    TimeBlock[]
  series    TimeBlockSeries[]
  bookings  Booking[]

  @@index([businessId, isActive])
}
```

**Sin cuenta propia.** No hay login por profesional. Colgarle un `userId` nullable
después no rompe nada de esto.

**Sin foto en la v1.** `GalleryImage` es un modelo muerto (cero lecturas y cero
escrituras en todo `src`), así que **no existe ninguna vía para servir una imagen
pública**. La única maquinaria de imágenes es la del track 4, privada a propósito
(ruta autenticada + GET prefirmado de 60s). Armar la pública es una sub-feature entera.
Arranca con iniciales.

### `professionalId` nullable en cuatro tablas

`Booking`, `AvailabilityRule`, `TimeBlock`, `TimeBlockSeries`.

**Semántica de `null` — es lo que da la migración gratis:**

| Tabla | `null` significa | Con persona |
|---|---|---|
| `AvailabilityRule` | El horario del negocio (las filas que existen hoy) | El horario de esa persona |
| `TimeBlock` / `TimeBlockSeries` | Cierra para **todos** (feriado del salón) | Sólo esa persona (sus vacaciones) |
| `Booking` | Reserva sin persona: **choca contra todos** | Choca sólo con esa persona |

La regla de `Booking` es conservadora a propósito: son las reservas hechas antes de que
el salón tuviera equipo, y nunca queremos meterle a alguien una cita encima.

### `Service ↔ Professional`

Muchos-a-muchos (`ProfessionalServices`). Un servicio que nadie hace **no se puede
reservar**, y el panel lo avisa en el mismo lugar donde hoy avisa que un servicio no
cabe en el horario (`computeServiceFit`). Defensas para que ese estado sea raro:

- Al crear una persona vienen todos los servicios activos pre-marcados.
- Al crear un servicio se pre-asigna a todo el equipo activo.
- Si el negocio tiene 0 profesionales activos, la relación no se consulta (cae al caso
  de hoy).

Prefiero que la dueña vea el error antes que una clienta se lo encuentre.

### Bajas, no borrados

**No se puede borrar a una persona con reservas futuras; se desactiva.** Un `SetNull` en
sus reservas las convertiría en reservas sin persona, que por la regla de arriba
bloquean a **todo el equipo**: un salón de 4 se queda sin agenda y nadie entiende por
qué. `isActive = false` la saca del funnel y le deja sus citas intactas.

---

## Disponibilidad

### El motor no se toca

`generateSlots` (`src/lib/availability/slots.ts`) ya recibe reglas, bloqueos y reservas
como arrays desde afuera. El multi-profesional **no es un cambio del motor, es un
cambio de qué se le da de comer.** El diff de `slots.ts` es cero y sus tests siguen
valiendo enteros.

Lo que sí importa: `generateSlots` hace `rules.find(r => r.dayOfWeek === dow && r.isActive)`
— toma la **primera** que matchea. Si le llegan mezcladas las reglas del negocio y las
de una persona, elige una arbitrariamente. **El filtrado tiene que pasar antes de
llamarlo, sin excepción.**

### El módulo de scope

Módulo nuevo (`src/lib/availability/scope.ts`) con una sola responsabilidad: dado un
negocio y una persona (o ninguna), resolver qué reglas, qué bloqueos y qué reservas
cuentan. Los tres lectores pasan por ahí.

**La superficie de lectura son tres helpers**, no seis call sites:

1. `_getAvailableTimeSlots` — el funnel público (`src/server/actions/availability.ts`)
2. `computeRescheduleSlots` — **compartido** por las dos vías de reprogramar, la de la
   dueña (`availability.ts:124`) y la self-service de la clienta
   (`my-bookings.ts:219`). Ninguna de las dos recorta los escalares del booking, así
   que `professionalId` llega gratis en las dos.
3. `computeServiceFit` — el aviso "este servicio no cabe" del panel

Con `getEffectiveBlocks` debajo de todos.

### `getEffectiveBlocks`

Dos cambios, y el segundo es el que se pasa por alto:

1. **Las dos queries** necesitan `OR: [{ professionalId: null }, { professionalId }]` —
   la de `timeBlock` y la de `timeBlockSeries`.

   **Ese `OR` con `undefined` no filtra: matchea todo.** Prisma borra las claves
   `undefined`, así que `{ professionalId: undefined }` queda en `{}` — un filtro vacío
   que matchea TODAS las filas — y el `OR` entero pasa a ser "cualquiera". Un caller que
   se olvide de pasar la persona ve **los bloqueos de todo el equipo mezclados** y
   reporta como ocupadas horas que están libres. No corrompe datos, pero se disfraza del
   reporte "los horarios no funcionan", sin error en ningún log. Por eso el parámetro es
   `professionalId: string | null` **explícito**, nunca opcional: que el compilador
   obligue a decidir. Es el mismo mecanismo que
   `staffId ?? null` en el lookup de la regla, un nivel más arriba.

   **Y la asimetría de la query se mantiene.** `effective-blocks.ts:23` compara `until`
   contra el piso del día local a propósito: la query es un **superconjunto deliberado**
   y el recorte fino lo hace `expandSeries`. Apretar la query de más ahí ya costó un bug
   (una serie acotada perdía su último día). El filtro de persona se suma sin tocar esa
   holgura.
2. **`EffectiveBlock` es un tipo proyectado** (`id`, `startDateTime`, `endDateTime`,
   `reason`, `overlapToleranceMinutes`) que se construye en **dos** lugares: el `.map`
   de los bloqueos sueltos (`effective-blocks.ts:41`) y adentro de `expandSeries`. Un
   `professionalId` en la serie **muere en la proyección**, no en el filtro. Filtrar
   sólo las filas guardadas deja los recurrentes sin dueño.

### `computeServiceFit` por persona

Hoy simula contra las reglas del negocio. Con horario por persona, ese aviso queda
calculado sobre un horario que ya no usa nadie: o no avisa cuando debería, o avisa de
un problema que no existe. Pasa a ser por persona **en el mismo PR que parte los
horarios**, no después.

### Validación al escribir

`assertSlotIsAvailable` (`src/lib/availability/validation.ts`) suma:

- `professionalId: professionalId ?? null` **explícito** en el lookup de la regla.
  Prisma **borra** del `where` las claves con valor `undefined`: un `undefined` acá no
  es "no encontrado", es "traeme la regla de cualquiera". Es el bug del track 4 otra
  vez, esta vez en el camino crítico de reservar.
- Que la persona sea del negocio, esté activa y haga ese servicio.
- Que la modalidad de la reserva esté en las de la persona.

**Dónde entra `professionalId` al crear** (post-#121, `7653599`): la **validación** va
adentro de `resolveBookingDraft` (`src/lib/bookings/draft.ts`), que ya resuelve servicio
y modalidad — exactamente de lo que depende validar a la persona — y ya tira `UserError`.
Es **un** lugar. Pero `BookingDraft` no tiene ningún campo de persona y
`tx.booking.create` sigue escrito **dos** veces (`bookings.ts:297` público,
`bookings.ts:787` dashboard), así que la **persistencia** son dos puntos. No confundir
"el helper es compartido" con "hay un solo insert".

`assertNoBookingOverlap` suma al SQL crudo, para una reserva **con** persona:

```sql
AND ("professionalId" IS NULL OR "professionalId" = ${professionalId})
```

Sin cláusula cuando la reserva nueva no tiene persona (choca contra todo).

Ese SQL repite los literales de estado a mano porque un `IN` de enums en `$queryRaw`
llega como `text` y Postgres tira `operator does not exist`. `HELD_STATUSES`
(`src/lib/bookings/approval.ts`) es la fuente para el resto pero el crudo no la puede
importar. Los 2 casos de `tests/integration/slot-conflicts.test.ts` son la **única** red.

### El advisory lock se queda como está

`acquireAdvisoryXactLock(tx, `${businessId}:${localStartStr}`)` — por negocio y día
local, sin la persona.

**Meter la persona en la llave está mal**, aunque el plan original lo pedía: una reserva
vieja con `professionalId = null` tomaría un lock distinto y no se serializaría contra
las reservas con persona, así que entrarían las dos y se pisarían. El costo de dejarlo
grueso es que dos clientas reservando el mismo día esperan una a otra — latencia de
milisegundos en un salón que hace 20 reservas por día, no un resultado incorrecto.

---

## Funnel público

Paso nuevo **entre servicio y fecha**:
`servicio (+modalidad) → profesional → fecha → hora → datos → pago → confirmación`.

Aparece sólo con 2+ profesionales activos que hagan ese servicio. Con 0 o 1, el funnel
es exactamente el de hoy.

**La modalidad ya está resuelta cuando llega este paso.** No es un paso propio: se
elige en línea dentro del paso 1, cuando el servicio tiene más de una
(`pickingModalityFor` en `step-service.tsx:34`). Así que filtrar el equipo por
`modalities ∩ modalidad elegida` es posible y correcto en este orden.

**Trampa del contador de pasos.** `steps` es una constante de módulo de 6 entradas
(`wizard.tsx:71`) y el restore de sesión mapea a índices **hardcodeados**:
`setCurrentStep(restored.timeSlot ? 4 : restored.date ? 3 : 2)` (`wizard.tsx:111`). Un
número de pasos variable rompe las dos cosas en silencio: la barra de progreso y el
paso al que vuelve la clienta. Hay que derivar la lista de pasos y el restore de la
misma fuente.

### "Cualquiera disponible"

Los horarios que ve son la **unión** de los de todo el equipo elegible, **deduplicada
por instante de inicio**: dos personas libres a las 15:00 son un solo horario en
pantalla, no dos. Ojo que la unión no cae en una grilla regular — cada persona ancla sus
slots al borde de sus propias citas (`generateSlots` re-ancla la grilla en cada
obstáculo), así que la lista puede quedar con horarios en minutos "raros". Es correcto,
pero hay que ordenarla explícitamente.

Quién le toca se resuelve **adentro de la transacción, después del advisory lock**, así
no hay carrera:
gana quien tenga **menos citas ese día**, y empatan por el `sortOrder` que definió la
dueña. Reparte carga en vez de cargarle todo al primero de la lista.

**Cuidado con el lead time:** el camino del dashboard pasa `leadTimeMinutes: 0` a
propósito (walk-ins que empiezan ahora). La resolución de "cualquiera" no debe
re-aplicar el default.

### Estado restaurado del wizard

`src/lib/bookings/wizard-storage.ts` restaura estado de sesiones anteriores. Un
`professionalId` de alguien dado de baja, que ya no hace ese servicio, o de otro
negocio, tiene que caerse en la validación y volver al paso. Misma trampa que la
dirección restaurada del track 3, que debía colgarse de la modalidad **resuelta**.

### Reprogramar conserva la persona

En las dos vías. La clienta eligió a Juan; mover la hora no le cambia el barbero, y
re-resolver por lo bajo es el tipo de magia que después nadie puede explicar. Cambiar
de persona es **reasignar**, operación aparte y explícita.

### Revivir

`assertSlotFreeOfConflicts` en el camino de revivir una reserva vencida tiene que
re-validar contra **esa** persona, que puede haberse ocupado mientras el hold estaba
muerto.

---

## Panel

- **`/dashboard/equipo`** — alta, baja, orden, servicios, modalidades, bio.
- **Disponibilidad** — selector de persona; el horario del negocio sigue existiendo
  para el caso de 0 activos.
- **Calendario** — filtro por persona y el nombre en la tarjeta. **No** columnas por
  persona: eso es una reescritura de la vista de día y queda fuera (ver más abajo).
- **Reasignar** — cambiar de profesional **sin mover la hora**. Es la operación de un
  martes cualquiera: alguien avisa que está enfermo y hay que pasarle sus 6 citas del
  día a otro. Bloquear a la persona no alcanza, porque **el bloqueo no mueve las citas
  que ya tiene**.
- **Tablas de reservas** — columna de profesional.
- **Reserva manual** — selector de persona.
- **Ficha de la clienta** — a quién la atendió la última vez.

---

## Integración con el resto de la app

### Vocabulario (track 1) — cambio estructural

`src/lib/vocabulary/index.ts` tiene exactamente **dos** formas (`FEMININE` / `NEUTRAL`)
y mapea los 7 rubros a esas dos. El sustantivo de oficio **no se reduce a dos**:

| Rubro | Sustantivo |
|---|---|
| `barber` | barbero |
| `nails` | manicurista |
| `hair_salon` | estilista |
| `beauty` | especialista |
| `massage` / `therapy` | terapeuta |
| `other` | profesional |

Eso pide overrides **por rubro**, que el módulo hoy no tiene:
`barber: { ...NEUTRAL, professional: 'barbero', … }`. Se mantiene el principio del
módulo: frases escritas a mano con la concordancia resuelta, cero trucos tipo
`` `barber${v.o}` ``.

Claves nuevas: `professional`, `professionals`, `Professional`, `Professionals`,
`theProfessional`, `TheProfessional`, `aProfessional`, `chooseProfessional`,
`noProfessionals`. **No** entran las frases que no varían ni por género ni por rubro
("Cualquiera disponible", "Te atiende") — el módulo sólo guarda lo que varía.

Sin esto, clavar "Profesional" en el funnel y en cinco pantallas del panel recrea
exactamente el problema que el track 1 vino a resolver.

### Emails (`src/lib/notifications/templates.ts`)

Confirmación, recordatorio y reprogramación no mencionan a nadie. La clienta elige a
Juan y no lo recibe por escrito en ninguna parte. `whereRows` (`templates.ts:95`) es el
precedente exacto de cómo el track 3 resolvió lo mismo con la dirección.

### Modalidad (track 3)

`Service.modalities` dice que un servicio se puede pedir a domicilio; **nada dice quién
viaja**. Sin `Professional.modalities`, el funnel ofrece "corte a domicilio con Juan"
cuando Juan no sale del local. Se intersecta: modalidades ofrecidas = las del servicio ∩
las de la persona.

### Sin cambios necesarios (verificado)

- **Comisiones no piden schema nuevo.** `LedgerEntry.bookingId` → `booking.professionalId`
  alcanza para calcular cuánto hizo cada uno. No hay que decidir nada de comisiones
  ahora para no cerrarse la puerta.
- **Diferir la reseña por persona no cuesta datos.** `Review.bookingId` es único y
  obligatorio, así que `booking.professionalId` siempre está; agregarla después es
  derivable al 100%.
- **Confirmación manual (track 2)** sigue siendo del negocio. Quien acepta o rechaza es
  la dueña.
- **Fidelización y paquetes** son por negocio y por servicio; no cambian.

### Pendiente de confirmar

`expireStaleHolds` (`src/lib/cron/expire-holds.ts`) — a primera vista sólo cambia
estados y el cupo se libera solo, pero no está leído. Se confirma en el PR C.

---

## Fuera de alcance, explícito

Cosas que **no** entran, dichas en voz alta para que no se descubran usándolo:

- **Precio por persona.** Un barbero senior cobrando más que el junior es la norma, no
  la excepción, pero `Service.price` y `depositAmount` son un número por servicio. El
  orden del funnel elegido (servicio → profesional → fecha) **deja el lugar justo** para
  que entre después, porque el precio se resolvería en el paso 2. Si entra, arrastra
  paquetes y promociones, que hoy se acotan por servicio y no por persona.
- **Columnas por persona en el calendario.** Un salón real las quiere. Es una
  reescritura de la vista de día, no un filtro. El PR E entrega filtro + nombre.
- **Foto pública** de cada profesional (ver arriba: no hay vía para servir imágenes
  públicas).
- **Reseña por persona**, promos y paquetes por persona, segmentos de campaña por
  persona.
- **Login por profesional.** El modelo no lo impide: un `userId` nullable después.
- **Comisiones.** Feature entero, y los datos ya quedan.

---

## Plan de PRs

Seis PRs **secuenciales desde `main`**. No se apilan: el workflow de CI filtra
`branches: [main]`, así que un PR basado en otra rama no corre **ningún** check, y
reapuntar la base después no dispara nada — hay que cerrar y reabrir el PR.

| PR | Entrega | Riesgo |
|---|---|---|
| **0** | Léxico: sustantivo de oficio por rubro en `lib/vocabulary` + overrides por categoría | Nulo |
| **A** | Modelo `Professional`, relación con servicios, `professionalId` nullable en las 4 tablas, pantalla de equipo, modalidades, baja sin borrado | Nulo — nadie ve nada distinto |
| **B** | Horario y bloqueos por persona, `scope.ts`, `getEffectiveBlocks` con persona (incluida la proyección), `computeServiceFit` por persona, **el CRUD entero de bloqueos** (12 sitios, incluido el split de series), contadores de onboarding, selector en Disponibilidad | Medio — creció con el barrido de queries |
| **C** | Los tres lectores, `assertSlotIsAvailable`, el SQL crudo del solape, revivir | **El más alto** |
| **D** | Funnel: paso de profesional, "cualquiera disponible" resuelto en la tx, emails con el nombre, wizard storage, **los 5 e2e que caminan el funnel** | Medio |
| **E** | Panel: calendario filtrable, columna en tablas, reserva manual, **reasignar**, profesional habitual en la ficha | Bajo |

---

## Superficie completa de queries

Son **22 sitios** los que preguntan por horario o bloqueos, y hoy todos significan "del
negocio". No alcanza con los tres lectores de slots.

### El split de series es el peligroso

`time-blocks.ts:516` copia la serie **campo por campo** a mano (`daysOfWeek`,
`anchorDate`, `until`, `overlapToleranceMinutes`) al partirla en "hoy". Si
`professionalId` no entra en esa copia, **partir el almuerzo recurrente de una persona
cierra el local para todos, todas las semanas.**

Es el olvido más caro posible y la culpa es de la semántica elegida: `null = todos` es lo
que hace que la migración sea gratis, y es lo que convierte una omisión en un cierre
total en vez de en un bloqueo huérfano. El código ya razona sobre qué se conserva
("La tolerancia es de la serie y el diálogo no la edita: se conserva"), así que la
omisión se vería natural. **Test de regresión obligatorio**: partir una serie de una
persona y afirmar que la nueva sigue siendo de esa persona.

### Contadores que empiezan a mentir

`availabilityRule.count({ businessId, isActive: true })` en tres lugares —
`dashboard/page.tsx:40`, `dashboard/onboarding/page.tsx:26`, `onboarding.ts:28` — es
progreso de onboarding ("¿ya configuró su horario?"). Un salón de 4 personas tiene **28**
reglas activas, no 7. Como booleano sobrevive; como número mostrado, miente. Van con
`professionalId: null`.

### Siembra del horario

`create-for-user.ts:154` y `recover-business.ts:155` hacen el `createMany` de las 7
reglas al crear o recuperar un negocio. Quedan en `professionalId: null` — el default lo
da, pero se explicita. **Recuperar un negocio no recupera su equipo**: fuera de alcance,
dicho a propósito.

### CRUD de bloqueos

Doce sitios en `time-blocks.ts` (crear, borrar, editar, partir serie, listar). Cada uno
tiene que contestar "¿esto es del salón o de una persona?". Es más superficie de UI que
"un selector en Disponibilidad" — el PR B carga con esto.

### Caché pública

El funnel se sirve por `getPublicBusinessBySlug` (`lib/business/public.ts`) con
`unstable_cache` y tags estáticos. El equipo entra en ese payload, y el CRUD de equipo
**tiene que llamar `revalidateBusinessPublicPaths`** o la clienta ve un equipo viejo
hasta que algo más invalide. Ojo con la landmine del repo: `revalidate*` sin `await`
mata el proceso.

### e2e

Cinco specs caminan el funnel con la secuencia servicio → fecha → hora (`smoke`,
`public`, `packages`, `loyalty-automatic`, `customer-account`, `self-service`). El paso
nuevo **los rompe a todos a la vez**. No bloquean el merge (e2e no es check requerido)
pero se arreglan en el PR D, no después.

### Rate limit

No hay entrada para gestionar equipo. Se agrega una, como hizo el track 4 con
`photo-upload-url`.

### Confirmado sin cambios

`expireStaleHolds` (`lib/cron/expire-holds.ts`) sólo flipea estados y manda emails, sin
ninguna lógica de slots: **no necesita saber de personas.**

`BusinessRole.staff` no tiene **ni un permiso**: los 70 `requireBusinessRole` del
proyecto son todos `['owner', 'admin']`. El rol está muerto de verdad, y eso refuerza no
llamar `StaffMember` al modelo nuevo.

### Fuera de alcance, confirmado mirando el código

- **KPIs por persona.** `dashboard/page.tsx` calcula ingresos y resumen del negocio
  entero. Abrirlo por persona es, literalmente, comisiones. Es lo primero que va a pedir
  un dueño de salón.
- **Segmentos de campaña por persona.** `CampaignSegment` es `birthday_month`,
  `inactive`, `frequent`, `pending_balance`. "Las clientas de Juan" es marketing natural
  y no entra.

## Dependencias de otra sesión

Dos fixes del backlog de disponibilidad caen **en las líneas exactas** que este track
edita. La sesión de arquitectura los mete como PRs mínimos contra `main` antes de que se
abran los PRs B y C:

- **`expand-series.ts`** — `occurrenceDate` (`:93`) y `computeSeriesUntil` (`:122`) armaban
  la medianoche a mano con `fromZonedTime` en vez de usar `startOfLocalDay`
  (`timezone.ts:45`), que ya resuelve el gap de DST reintentando a las 01:00. El 6 de
  septiembre la medianoche no existe en Santiago, el `occurrenceDate` cae al día anterior,
  la clave del mapa de excepciones no matchea y **una excepción de serie se ignora**.
  `:93` es el object literal de la proyección — el mismo donde entra `professionalId`.
- **`finance.ts`** — el flip `pending_payment → confirmed` no re-chequea solape. El
  `updateMany` sí es atómico contra doble-confirmación (el `where` guarda por status), pero
  si el hold venció **por reloj y el cron todavía no lo flipeó**, otra clienta toma el slot
  legítimamente — tanto `generateSlots` (`slots.ts:102`) como el SQL crudo tratan un hold
  vencido como no-bloqueante a propósito — y el webhook posterior confirma el primero:
  dos reservas confirmadas en la misma hora. El guard vive en `validation.ts:86,94,148`,
  el archivo al que el PR C le agrega la persona.

Que entren primero evita que el guard haya que escribirlo con `professionalId` ya adentro,
y evita rebasar sobre un conflicto en la línea que se está editando. Los PRs 0 y A no
tocan ninguno de los dos archivos, así que corren en paralelo sin esperar.

## Trampas conocidas

Del repo, ya mordieron antes:

1. **Los dos guards AST de CI** (`tests/unit/use-server-exports.test.ts`,
   `tests/unit/server-actions-auth.test.ts`): todo export de un módulo `'use server'`
   tiene que ser una función, y toda action tiene que autenticar o estar en la lista
   `PUBLICAS`. El CRUD de equipo cae justo ahí. (`export const f = hof(g)` **sí** es
   válido, está verificado en build.)
2. **`revalidate*` sin `await` mata el proceso** (exit 128, no es una excepción que se
   atrape).
3. **Los tests de componente necesitan mock de `next/navigation`** —
   `renderToStaticMarkup` + `useRouter()` tira sin él. Los PRs A y E son pantallas de
   panel.
4. **`tsc` no lo corre ni vitest ni eslint.** Correr `tsc --noEmit` a mano, borrando
   antes `.next/dev/types` (se frena con uno viejo) y sin filtrar por `^src/` (esconde
   `tests/`; hay 3 errores preexistentes ahí que no son de este track).
5. **El Postgres local tiene que estar en UTC** o `slot-conflicts.test.ts` falla en
   falso: el SQL de solape castea con el TZ del **servidor**.
6. **`migrate diff` levanta cambios de ramas hermanas.** Revisar el `.sql` a mano y
   dejar sólo los statements propios.
7. **El cliente de Prisma generado es uno solo para todas las worktrees.** Regenerar
   desde este schema ensucia a las otras sesiones; hay que restaurarlo desde `main` al
   terminar.
8. **`AvailabilityRule` no tiene unique sobre `(businessId, dayOfWeek)`**, sólo un
   índice. Agregar un unique con `professionalId` nullable no serviría igual (Postgres
   trata los NULL como distintos) y podría chocar con datos ya duplicados. No se agrega.
