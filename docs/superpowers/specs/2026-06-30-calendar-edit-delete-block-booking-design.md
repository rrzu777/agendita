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

**`BlockBand` se convierte en botón.** Recibe un `onClick` que abre el modal de
edición con los datos del bloqueo. Mantiene el mismo aspecto visual (banda rayada);
solo gana interactividad y un `aria-label` descriptivo (motivo + horario).

**`BlockTimeModal` gana un modo "editar".** Hoy administra su propio estado `open`
internamente, con un botón trigger fijo ("Bloquear horario") en la barra del
calendario. Se extiende para soportar un **segundo modo de uso, controlado
externamente**:

- Nuevas props opcionales: `editingBlock?: CalendarTimeBlock`, `open?: boolean`,
  `onOpenChange?: (open: boolean) => void`.
- **Modo creación (default, sin cambios de API pública):** se sigue usando
  `<BlockTimeModal defaultDate={date} timezone={timezone} />` desde la barra del
  calendario (línea 133); administra su propio estado y botón trigger, como hoy.
- **Modo edición (nuevo):** `CalendarViews` mantiene un estado
  `activeBlock: CalendarTimeBlock | null` (mismo patrón que `activeBooking`, línea 89).
  Al hacer clic en un `BlockBand`, se llama `setActiveBlock(block)`. Se renderiza una
  segunda instancia de `BlockTimeModal` con `editingBlock={activeBlock}`,
  `open={!!activeBlock}` y `onOpenChange` que limpia el estado al cerrar.
- Cuando `editingBlock` está presente: los campos (`date`, `startTime`, `endTime`,
  `reason`) se precargan desde el bloqueo; el selector de "Tipo de bloqueo" (presets)
  se oculta o se fija en "Personalizado" (no tiene sentido re-aplicar un preset sobre
  un bloqueo existente); el botón de submit dice "Guardar cambios" y llama a
  `updateTimeBlock(editingBlock.id, data)` en vez de `createTimeBlock`; se agrega un
  botón **Eliminar** en el footer del formulario, a la izquierda de Cancelar/Guardar.
- **Confirmación al eliminar:** al presionar Eliminar, el formulario cambia a un
  estado de confirmación dentro del mismo `Dialog` (no existe un componente
  `AlertDialog` en `src/components/ui/`, solo `Dialog` genérico — se reutiliza ese,
  sin agregar una dependencia nueva): se ocultan los campos y se muestra un mensaje
  "¿Eliminar este bloqueo? Esta acción no se puede deshacer" con botones
  Cancelar/Eliminar definitivamente. Solo al confirmar se llama a `deleteTimeBlock`.
  Esto es más estricto que el patrón actual en `/dashboard/availability` (que borra
  sin confirmar) porque desde el calendario es más fácil tocar por accidente.

**Nueva acción de servidor `updateTimeBlock`** en `src/server/actions/time-blocks.ts`,
junto a las existentes:

- Firma: `updateTimeBlock(id: string, data: { startDateTime: Date; endDateTime: Date; reason: string | null; confirmOverlap?: boolean })`.
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
  revalidaciones (`/dashboard/availability`, `/dashboard/calendar`,
  `revalidateBusinessPublicPaths`).

### Parte 2 — Reservas en vista de mes

**La celda de día deja de ser un único `<Link>`.** Se reemplaza por un `<div>`
clicable (usando `useRouter().push(hrefFor('day', day))` de `next/navigation`, ya
usado en otros client components de este árbol) para el número del día y el espacio
vacío de la celda — preservando la navegación actual a la vista de día.

**Cada fila de reserva se convierte en su propio `<button>`** con
`onClick={(e) => { e.stopPropagation(); onBookingClick(b) }}`, que abre el mismo
`BookingDrawer` que ya usan día/semana. Esto evita el problema de anidar un elemento
interactivo dentro de un `<a>`.

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
  (como hoy).
- Tocar una reserva específica → abre su drawer de detalle/acciones (Reprogramar
  enlaza afuera, Cancelar actúa en el sitio), sin salir de la vista de mes.

## Archivos afectados

- `src/server/actions/time-blocks.ts` — nueva función `updateTimeBlock`.
- `src/components/dashboard/block-time-modal.tsx` — `BlockTimeModal` gana modo
  edición (props opcionales, precarga, botón Eliminar con confirmación). Sin cambios
  en `DeleteBlockButton` (se mantiene para `/dashboard/availability`).
- `src/components/dashboard/calendar-views.tsx`:
  - `CalendarViews` (líneas 78–176): nuevo estado `activeBlock`; renderiza una segunda
    instancia de `BlockTimeModal` en modo edición; pasa `onBookingClick` a `MonthView`.
  - `MonthView` (líneas 203–296): nueva prop `onBookingClick`; celda de día pasa de
    `<Link>` a `<div>` navegable; filas de reserva pasan a `<button>` con
    `stopPropagation`.
  - `BlockBand` (líneas 448–460): pasa de `<div>` a `<button>` con `onClick` y
    `aria-label`.

## Sin cambios

- Base de datos / Prisma: no se agrega ninguna migración (`updateTimeBlock` usa el
  modelo `TimeBlock` existente).
- `BookingDrawer`, `CancelBookingButton`, el flujo de reagendar (página existente):
  se reutilizan tal cual.
- Vista de mes para bloqueos: sigue sin mostrarlos (fuera de alcance).
- `DeleteBlockButton` / `/dashboard/availability`: sin cambios.

## Verificación

- Tocar un bloqueo en día/semana abre el modal precargado con sus datos; guardar
  cambios los persiste; el chequeo de solape con reservas sigue funcionando al editar
  (excluyendo el propio bloqueo).
- Eliminar un bloqueo desde el calendario pide confirmación antes de borrar.
- Tocar una reserva en la vista de mes abre el mismo drawer que día/semana, con
  Reprogramar/Cancelar funcionando igual.
- Tocar el número de día o el espacio vacío de una celda de mes sigue navegando a la
  vista de día.
- `updateTimeBlock` tiene tests unitarios: valida fin > inicio, límite de 32 días,
  detecta solape con reservas cuando el horario cambia, **no** vuelve a pedir
  confirmación cuando solo cambia el motivo (mismo horario), respeta el guard de rol
  (`owner`/`admin`), y devuelve `ForbiddenError` si el bloqueo no existe o pertenece a
  otro negocio.
