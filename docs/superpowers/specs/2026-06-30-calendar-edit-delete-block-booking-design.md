# Diseño — Editar o eliminar bloqueo o reserva desde el calendario (#2)

**Fecha:** 2026-06-30
**Estado:** Aprobado (diseño) — pendiente de plan de implementación
**Alcance:** Interactividad en `/dashboard/calendar` (día/semana/mes) para bloqueos y reservas. Un cambio de esquema (nueva acción de servidor `updateTimeBlock`; sin migración de base de datos).

## Contexto

En `src/components/dashboard/calendar-views.tsx`:

- **Bloqueos (`BlockBand`, líneas 448–460):** se renderizan como `<div>` sin ningún
  `onClick`. Hoy la **única** forma de eliminar un bloqueo es navegar a
  `/dashboard/availability` y usar `DeleteBlockButton` (`src/components/dashboard/block-time-modal.tsx:253–279`),
  que llama a `deleteTimeBlock` **sin confirmación**. No existe ninguna acción de
  servidor para **editar** un bloqueo (`src/server/actions/time-blocks.ts` solo tiene
  `createTimeBlock`, `getTimeBlocks`, `getTimeBlocksByRange`, `deleteTimeBlock`).
- **Reservas en día/semana (`BookingBlock`, líneas 398–446):** ya son un `<button>`
  que dispara `onBookingClick` (línea 385) → `setActiveBooking` (línea 89) → abre
  `BookingDrawer` (líneas 164–173), el cual ya tiene botones **Reprogramar** (enlaza a
  `/dashboard/bookings/[id]/reschedule`) y **Cancelar** (`CancelBookingButton`), solo
  visibles si `status` es `confirmed` o `pending_payment`
  (`src/components/dashboard/booking-drawer.tsx:153–168`).
- **Reservas en mes (`MonthView`, líneas 203–296):** cada celda de día es un único
  `<Link href={hrefFor('day', day)}>` (línea 244) que envuelve **todo** el contenido,
  incluidas las filitas de reserva (líneas 261–285). No hay forma de interactuar con
  una reserva puntual sin salir a la vista de día — anidar un botón dentro de un
  `<Link>` (una etiqueta `<a>`) tampoco es válido en HTML.

## Requisito

Poder **editar o eliminar un bloqueo**, y **editar o cancelar una reserva**,
directamente desde el calendario, sin navegar a otra pantalla para encontrarlas.

## Decisiones tomadas

1. **Reagendar sigue siendo un enlace** a la página existente
   (`/dashboard/bookings/[id]/reschedule`); no se reconstruye inline. Ya vive dentro
   del mismo drawer/menú unificado (`BookingDrawer`), así que cumple el objetivo sin
   duplicar la lógica de slots disponibles.
2. **Bloqueos: limitados a día/semana.** La vista de mes no muestra bloqueos hoy y no
   se agrega esa capacidad en este alcance — solo se hace interactivo lo que ya se
   muestra.
3. **"Eliminar reserva" = "Cancelar"** (el flujo `updateBookingStatus(id, 'cancelled')`
   que ya existe). Las reservas nunca se borran físicamente (arrastran pagos, puntos
   de lealtad, `reviewToken`, notificaciones); no se agrega un borrado real.
4. **Bloqueos: clic → mismo modal de creación, en modo edición**, con un botón
   Eliminar (con confirmación), en vez de un menú/popover intermedio.
5. **Reservas en mes: el mismo `BookingDrawer`** que día/semana, sin duplicar UI.

## Diseño

### Parte 1 — Bloqueos (día/semana)

**`BlockBand` se convierte en botón.** Recibe un `onClick` que abre el diálogo de
edición con los datos del bloqueo. Mantiene el mismo aspecto visual (banda rayada);
solo gana interactividad y un `aria-label` descriptivo (motivo + horario).

**Componente nuevo y separado: `EditBlockDialog`** (no se sobrecarga
`BlockTimeModal`). `BlockTimeModal` ya se usa en **dos lugares** —
`src/components/dashboard/calendar-views.tsx:133` y
`src/app/dashboard/availability/page.tsx:45` — con un botón trigger que administra su
propio estado `open`. Convertirlo en un componente de doble modo (creación
self-managed + edición controlada por props opcionales) mezclaría dos modelos de
estado en un mismo componente y arriesgaría afectar la página de disponibilidad sin
querer. En vez de eso:

- Nuevo archivo `src/components/dashboard/edit-block-dialog.tsx`, exclusivo del
  calendario, **siempre controlado** por el padre:
  `EditBlockDialog({ block, timezone, open, onOpenChange }: { block: CalendarTimeBlock; timezone: string; open: boolean; onOpenChange: (open: boolean) => void })`.
- `BlockTimeModal` (`block-time-modal.tsx`) **no cambia su API pública** — sigue
  siendo solo el flujo de creación, usado igual en ambas páginas.
- Los 4 campos del formulario (fecha, hora inicio, hora fin, motivo) se extraen a un
  componente presentacional compartido `BlockFormFields` (props: valores + handlers
  `onChange`), usado tanto por `BlockTimeModal` como por `EditBlockDialog`, para no
  duplicar el markup de los inputs.
- `CalendarViews` mantiene un estado `activeBlock: CalendarTimeBlock | null` (mismo
  patrón que `activeBooking`, línea 89). Al hacer clic en un `BlockBand`, se llama
  `setActiveBlock(block)`. Se renderiza `{activeBlock && <EditBlockDialog block={activeBlock} ... />}`
  — mismo patrón de montaje condicional que ya usa `BookingDrawer` (líneas 164–173),
  no una instancia siempre montada con `open=false`.
- **Precarga con conversión de zona horaria correcta:** `date`/`startTime`/`endTime`
  se derivan de `block.startDateTime`/`endDateTime` (strings ISO en UTC) usando
  `formatInTimeZone` con el `timezone` del negocio — el mismo patrón que ya usa
  `booking-drawer.tsx` — **no** un parseo naive de `Date`, que desfasaría el horario
  mostrado respecto al real.
- El botón de submit dice "Guardar cambios" y llama a
  `updateTimeBlock(block.id, data)`; se agrega un botón **Eliminar** en el footer,
  a la izquierda de Cancelar/Guardar. `EditBlockDialog` no tiene selector de presets
  (ese selector es exclusivo del flujo de creación en `BlockTimeModal`).
- **Confirmación al eliminar:** al presionar Eliminar, el diálogo cambia a un estado
  de confirmación (no existe un componente `AlertDialog` en `src/components/ui/`,
  solo `Dialog` genérico — se reutiliza ese, sin agregar una dependencia nueva): se
  ocultan los campos y se muestra "¿Eliminar este bloqueo? Esta acción no se puede
  deshacer" con botones Cancelar/Eliminar definitivamente. Cualquier cambio sin
  guardar en los campos se descarta al confirmar la eliminación. Solo al confirmar se
  llama a `deleteTimeBlock`. Esto es más estricto que el patrón actual en
  `/dashboard/availability` (que borra sin confirmar) porque desde el calendario es
  más fácil tocar por accidente.
- Tras guardar o eliminar con éxito: `router.refresh()` + `onOpenChange(false)`,
  igual que el patrón ya usado en `BlockTimeModal`/`DeleteBlockButton`.

**Nueva acción de servidor `updateTimeBlock`** en `src/server/actions/time-blocks.ts`,
junto a las existentes:

- Firma: `updateTimeBlock(id: string, data: { startDateTime: Date; endDateTime: Date; reason: string | null; confirmOverlap?: boolean })`.
- **Única exportación nueva del módulo.** `src/server/actions/time-blocks.ts` es un
  archivo `'use server'`; solo debe exportarse la función `async` en sí — no arrastrar
  ninguna constante o tipo suelto como export nuevo, porque exportar algo que no sea
  una función desde un módulo `'use server'` rompe en runtime (ya ha causado 500s en
  este proyecto).
- Mismo guard de autorización que `createTimeBlock`/`deleteTimeBlock`:
  `requireBusinessRole(['owner', 'admin'])`.
- Reutiliza `createTimeBlockSchema` para validar (fin > inicio) y el límite de 32
  días. El chequeo de solape con reservas (`overlappingBookings` +
  `requiresConfirmation`) — que consulta `Booking`, no otros `TimeBlock` — se ejecuta
  **solo si `startDateTime` o `endDateTime` cambiaron** respecto al bloqueo guardado
  (se compara contra el registro actual antes de actualizar). Así, editar solo el
  motivo sin tocar el horario no vuelve a pedir confirmación de un solape ya aceptado
  al crearlo; cambiar el horario sí revalida contra las reservas existentes.
- `prisma.timeBlock.updateMany({ where: { id, businessId }, data: {...} })`, con el
  mismo patrón de "0 filas afectadas → `ForbiddenError`" que usa `deleteTimeBlock`.
- Mismo rate limit (`checkRateLimit('update-timeblock', 20, 60000)`) y mismas
  revalidaciones que `createTimeBlock`/`deleteTimeBlock`: `revalidatePath` para
  `/dashboard/availability` y `/dashboard/calendar`, y **`await
  revalidateBusinessPublicPaths(businessId)`** — llamarla sin `await` ya ha colgado el
  proceso (exit 128) en este proyecto; es el error más fácil de cometer al copiar este
  patrón, así que el `await` es obligatorio, no opcional.

### Parte 2 — Reservas en vista de mes

**Patrón "stretched link"** (en vez de convertir la celda a `<div onClick>`, que
perdería la navegación por teclado y el clic derecho/central "abrir en pestaña nueva"
que el `<Link>` actual sí tiene — sería un retroceso de accesibilidad):

- La celda mantiene su `<Link href={hrefFor('day', day)}>`, pero pasa a cubrir la
  celda como una **capa de fondo** (`absolute inset-0`, dentro de un contenedor
  `relative`), en vez de envolver todo el contenido.
- El número del día y las filitas de reserva se renderizan **encima**, en un
  contenedor `relative z-10` — son hermanos del `<Link>` en el DOM, no están anidados
  dentro de él.
- Cada fila de reserva se convierte en su propio `<button>` con
  `onClick={(e) => { e.stopPropagation(); onBookingClick(b) }}` (el `stopPropagation`
  evita que el clic también dispare el `<Link>` de fondo), que abre el mismo
  `BookingDrawer` que ya usan día/semana.
- Resultado: el espacio vacío de la celda sigue siendo un link real (teclado, clic
  derecho/central funcionan); tocar una reserva específica la abre en su drawer sin
  navegar.

- `MonthView` gana la prop `onBookingClick: (b: TimelineBooking) => void`, pasada
  desde `CalendarViews` igual que hoy se pasa a `TimelineView` (línea 150, 160):
  `<MonthView ... onBookingClick={setActiveBooking} />` (línea 138).
- El `<BookingDrawer>` que ya se renderiza condicionalmente en `CalendarViews`
  (líneas 164–173) se reutiliza sin cambios — ya soporta esta reserva sin importar
  desde qué vista se abrió.
- Sin cambios en `BookingDrawer` ni en las acciones de reagendar/cancelar: ya
  funcionan igual una vez que `activeBooking` está seteado.

**Resultado de interacción:**
- Tocar el número del día o el espacio vacío de la celda → navega a la vista de día
  (como hoy), incluyendo teclado y clic derecho/central "abrir en pestaña nueva".
- Tocar una reserva específica → abre su drawer de detalle/acciones (Reprogramar
  enlaza afuera, Cancelar actúa en el sitio), sin salir de la vista de mes.

## Archivos afectados

- `src/server/actions/time-blocks.ts` — nueva función `updateTimeBlock` (única
  exportación nueva del módulo).
- `src/components/dashboard/block-time-modal.tsx` — se extraen los 4 campos del
  formulario al componente presentacional compartido `BlockFormFields`. `BlockTimeModal`
  en sí **no cambia su API pública** (sigue siendo solo creación). Sin cambios en
  `DeleteBlockButton`.
- `src/components/dashboard/edit-block-dialog.tsx` **(nuevo)** — `EditBlockDialog`:
  diálogo de edición/eliminación de un bloqueo, siempre controlado por el padre,
  reutiliza `BlockFormFields`.
- `src/components/dashboard/calendar-views.tsx`:
  - `CalendarViews` (líneas 78–176): nuevo estado `activeBlock`; monta
    `EditBlockDialog` condicionalmente (mismo patrón que `BookingDrawer`); pasa
    `onBookingClick` a `MonthView`.
  - `MonthView` (líneas 203–296): nueva prop `onBookingClick`; celda de día pasa al
    patrón "stretched link" (`Link` de fondo `absolute inset-0` + contenido encima);
    filas de reserva pasan a `<button>` con `stopPropagation`.
  - `BlockBand` (líneas 448–460): pasa de `<div>` a `<button>` con `onClick` y
    `aria-label`.

## Sin cambios

- Base de datos / Prisma: no se agrega ninguna migración (`updateTimeBlock` usa el
  modelo `TimeBlock` existente).
- `BookingDrawer`, `CancelBookingButton`, el flujo de reagendar (página existente):
  se reutilizan tal cual.
- Vista de mes para bloqueos: sigue sin mostrarlos (fuera de alcance).
- `DeleteBlockButton` / `/dashboard/availability`: sin cambios.
- API pública de `BlockTimeModal`: sin cambios (sigue usándose igual en ambas
  páginas donde ya se usa).

## Verificación

- Tocar un bloqueo en día/semana abre `EditBlockDialog` precargado con sus datos en
  el horario correcto (respetando el timezone del negocio); guardar cambios los
  persiste; el chequeo de solape con reservas se revalida solo si el horario cambió.
- Eliminar un bloqueo desde el calendario pide confirmación antes de borrar; cualquier
  edición sin guardar en los campos se descarta al confirmar.
- La página `/dashboard/availability` sigue funcionando igual (crear/borrar bloqueos)
  sin ningún efecto secundario del nuevo diálogo de edición.
- Tocar una reserva en la vista de mes abre el mismo drawer que día/semana, con
  Reprogramar/Cancelar funcionando igual.
- Tocar el número de día o el espacio vacío de una celda de mes sigue navegando a la
  vista de día — por teclado (Tab + Enter) y por clic derecho/central (abrir en
  pestaña nueva), no solo por clic normal.
- `updateTimeBlock` tiene tests unitarios: valida fin > inicio, límite de 32 días,
  detecta solape con reservas cuando el horario cambia, **no** vuelve a pedir
  confirmación cuando solo cambia el motivo (mismo horario), respeta el guard de rol
  (`owner`/`admin`), devuelve `ForbiddenError` si el bloqueo no existe o pertenece a
  otro negocio, y llama a `revalidateBusinessPublicPaths` con `await`.
