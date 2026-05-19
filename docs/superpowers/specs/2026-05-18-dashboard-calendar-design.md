# Design: Dashboard Calendar Real

Date: 2026-05-18
Status: Draft

## Overview
Convertir `/dashboard/calendar` de un picker de fechas vacío en una herramienta operativa que muestre reservas reales del business autenticado, permita ver la agenda diaria y ejecutar acciones rápidas.

## Goals
1. Calendario mensual que carga reservas reales del business autenticado.
2. Indicadores por día: conteo de reservas + colores suaves por estado.
3. Al seleccionar día, mostrar lista cronológica con: hora, servicio, clienta, estado, pago (depositPaid/finalAmount), saldo pendiente.
4. Acciones rápidas desde la lista del día: Completar, Cancelar, No asistió, Registrar pago final si hay saldo, Ver detalle.
5. Mostrar TimeBlocks del día en la misma lista del día.
6. Seguridad: solo business autenticado; nunca aceptar businessId del cliente.
7. UX mobile: calendario compacto, lista del día debajo, cards legibles.

## Non-Goals
- Drag and drop.
- Vista semana compleja.
- Multi-profesional.
- Slots de hora fijos tipo timeline (usamos lista cronológica simple).

## Architecture

```
CalendarPage (Server Component, async)
├── DashboardHeader
├── CalendarGrid (Server Component)
│   └── Recibe bookingsByDay (serializado) y renderiza grid mensual.
└── DayPanel (Client Component)
    ├── Lee ?date de la URL.
    ├── Filtra bookings y timeBlocks del día seleccionado.
    ├── Renderiza lista cronológica (BookingCard + TimeBlockCard).
    └── BookingDrawer (Client Component, Sheet side=bottom/right)
        └── Detalle completo + formulario registrar pago.
```

## Data Flow
1. Usuario entra a `/dashboard/calendar`.
2. `CalendarPage` llama `getBookingsByRange(startOfMonth, endOfMonth)` en el servidor.
3. Agrupa por día (considerando timezone del negocio) y pasa como prop serializada.
4. `CalendarGrid` renderiza dots de estado + conteo.
5. Click en día → navega a `?date=YYYY-MM-DD`.
6. `DayPanel` recibe las reservas del mes completo como prop, filtra por día seleccionado y renderiza cards ordenadas por `startDateTime`.
7. Acción (ej. Completar) → Server Action → `revalidatePath('/dashboard/calendar')` → página se re-renderiza manteniendo el query param.

## API / Server Actions

### `getBookingsByRange(start: Date, end: Date)`
- Requiere `requireBusiness()`.
- Devuelve bookings del `businessId` autenticado donde `startDateTime` esté dentro del rango.
- Incluye `service`, `customer`.
- Filtro de fechas en la timezone del negocio para evitar off-by-one al agrupar por día.

### `getTimeBlocksByRange(start: Date, end: Date)`
- Requiere `requireBusiness()`.
- Devuelve timeBlocks del `businessId` autenticado donde haya solapamiento con el rango.

### `updateBookingStatus(id: string, status: BookingStatus)`
- Ya existe. Verificar que revalida `/dashboard/calendar` también.

### `registerManualPayment(bookingId: string, amount: number, paymentMethod: string)`
- Requiere `requireBusinessRole(['owner', 'admin'])`.
- Crea un `Payment` con `provider: manual`, `paymentType: final_payment` (o `full_payment` si el depositPaid es 0), `status: approved`.
- Crea `LedgerEntry` correspondiente vía `applyApprovedPayment` o equivalente.
- Actualiza `booking.paymentStatus`, `depositPaid`, `remainingBalance`.
- Revalida `/dashboard/calendar` y `/dashboard/bookings`.

## Components

### CalendarGrid
- Props: `bookingsByDay: Record<YYYY-MM-DD, Booking[]>`, `currentMonth: Date`, `selectedDate: string | null`.
- Renderiza grid de 7 columnas.
- Por celda:
  - Número del día.
  - Hasta 3 dots de color (uno por cada estado presente ese día).
  - Si hay más de 3 reservas, muestra "+N" en pequeño.
- Días fuera del mes: opacos.
- Día seleccionado: fondo primary.

### DayPanel
- Props: `bookings: Booking[]`, `timeBlocks: TimeBlock[]`, `selectedDate: string`.
- Combina bookings + timeBlocks, ordena por `startDateTime`.
- Renderiza:
  - `BookingCard`: hora, servicio, clienta, badge de estado, monto pagado / final, saldo pendiente.
  - `TimeBlockCard`: fondo distintivo (gris/bloqueado), razón, hora.
- Acciones rápidas en cada `BookingCard` (botones pequeños).

### BookingDrawer
- Usa `Sheet` de shadcn (`side="bottom"` en mobile, `"right"` en desktop).
- Muestra detalle completo de la reserva.
- Formulario inline para registrar pago final (monto + método).

## UX Mobile
- Grid compacto: días `aspect-square` ligeramente menor, padding reducido.
- Dots pequeños (4px) con `gap-0.5`.
- DayPanel ocupa todo el ancho debajo del grid, sin bordes laterales excesivos.
- Cards con padding `p-3`, fuente `text-sm`.
- Drawer desde abajo ocupa `h-auto` con `max-h-[85vh]`.

## Security
- `getBookingsByRange`, `getTimeBlocksByRange`, `registerManualPayment` usan `requireBusiness()` / `requireBusinessRole()`.
- Ninguna acción acepta `businessId` del cliente.
- Todas las queries Prisma incluyen `businessId` en el `where`.

## Colors & Visuals
Los dots del calendario usan el color del **estado** (no del servicio), porque en un dashboard operativo lo más importante es ver urgencias de un vistazo.

| Estado | Color (dot) | Badge |
|--------|-------------|-------|
| pending_payment | naranja (#fdba74) | bg-orange-100 text-orange-800 |
| confirmed | verde (#86efac) | bg-green-100 text-green-800 |
| completed | gris neutro (#e5e7eb) | bg-secondary text-secondary-foreground |
| cancelled | gris apagado (#d1d5db) | bg-muted text-muted-foreground |
| no_show | rojo suave (#fca5a5) | bg-destructive/10 text-destructive |

## Decisions (respuestas a gaps)
1. **Timezone**: `getBookingsByRange` filtra y agrupa considerando `business.timezone` para evitar off-by-one.
2. **TimeBlocks**: se muestran como cards "bloqueadas" dentro de la lista del día, ordenadas cronológicamente junto a las reservas.
3. **Precarga**: solo mes visible. Aceptamos recarga al cambiar de mes por simplicidad.
4. **Vista diaria**: lista vertical simple (feed cronológico), no slots fijos.
5. **Registrar pago**: método manual (efectivo/transferencia/etc.), requiere owner/admin, crea `Payment(provider: manual, status: approved)` y LedgerEntry.
6. **Preservación de `?date`**: si el día no existe en el mes nuevo (ej. 31 → Feb), se elimina el query param (panel vacío).
7. **Colores**: dots por estado, no por servicio.
8. **Degradación sin JS**: aceptable para dashboard interno.
