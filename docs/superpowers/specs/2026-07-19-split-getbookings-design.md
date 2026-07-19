# Split de `getBookings` — recorte de columnas + resumen de dashboard

**Fecha:** 2026-07-19
**Ítem del backlog:** auditoría arch/perf 2026-07-18, latencia #4 ("`getBookings()` sin take/select trae TODO el historial con 3 includes; usada en /dashboard, /dashboard/bookings y /dashboard/payments").
**Alcance elegido por el usuario:** B (recorte + query de resumen dedicada para el dashboard).

## Problema

`getBookings()` (`src/server/actions/bookings.ts:185`) hace `include: { service: true, customer: true, payments: {…} }` **sin `select` en los escalares** → trae todas las columnas de `Booking` (incluye `internalNotes`, `customerNotes`, `idempotencyKey`, `reviewToken`, timestamps de recordatorios…) y **todas** las de `Service` y `Customer`, para **todo el historial**, en 3 páginas con necesidades muy distintas:

- **dashboard** (home, la landing más caliente): solo necesita `id`, `startDateTime`, `status`, `customer.name`, `service.name` y los flags de transferencia. Cuenta hoy/próximas/total y muestra 5.
- **payments**: subset `ManualPaymentBooking` para el diálogo de pago manual.
- **bookings**: el set pesado real (columnas de plata, `paymentMethod`, `customer.{name,phone,email}`, `payments.{…}`) — lista el historial completo.

## Fuera de alcance (explícito)

- **`take`/paginación**: la página de reservas muestra "Total" = conteo completo y lista todo → no se puede acotar sin construir paginación (feature aparte + behavior change).
- **Cluster TZ**: el cómputo de "hoy" del dashboard usa TZ del server (bug latente, ítem TZ del backlog). Este PR **preserva** esa semántica (sigue contando en JS sobre todas las filas); no la toca.
- **getUser JWT local**: lo lleva la sesión paralela (`claude/auth-local-jwt`).

## Diseño

Dos funciones en `src/server/actions/bookings.ts`, cada una con `select` explícito. `where`/`orderBy` idénticos a hoy (`{ businessId }`, `orderBy: { startDateTime: 'desc' }`) — se preserva orden y conjunto de filas.

### `getBookings()` (reusada por bookings + payments) — recorte de columnas

```ts
select: {
  id: true,
  bookingNumber: true,
  startDateTime: true,
  status: true,
  depositPaid: true,
  depositRequired: true,
  finalAmount: true,
  paymentStatus: true,
  totalPrice: true,
  remainingBalance: true,
  paymentMethod: true,
  service: { select: { name: true } },
  customer: { select: { name: true, phone: true, email: true } },
  payments: {
    where: anyDeclaredTransferWhere,
    select: { id: true, amount: true, createdAt: true, providerPaymentId: true, proofKey: true, proofContentType: true },
  },
}
```

Es la **unión** de lo que consumen la página de reservas (set pesado) y `ManualPaymentBooking` (subset). Payments sobre-selecciona `customer.phone/email` (negligible) a cambio de reusar una sola función (DRY).

### `getBookingsSummary()` (nueva, solo dashboard)

```ts
select: {
  id: true,
  startDateTime: true,
  status: true,
  service: { select: { name: true } },
  customer: { select: { name: true } },
  payments: {
    where: anyDeclaredTransferWhere,
    select: { providerPaymentId: true },
  },
}
```

Cubre exactamente lo que el home usa: conteos (total/hoy/próximas via `.length` y `.filter`), las 5 próximas (`customer.name`, `service.name`, `startDateTime`, `status`) y los predicados `hasPendingDeclaredTransfer`/`hasPendingBalanceTransfer` (que tipan sobre `{ status; payments: Array<{ providerPaymentId? }> }`).

## Cambios en call sites

- `src/app/dashboard/page.tsx`: `getBookings()` → `getBookingsSummary()` en el `Promise.all`.
- `src/app/dashboard/payments/page.tsx`: sin cambio de llamada (reusa `getBookings()`); el `select` más angosto satisface `ManualPaymentBooking`.
- `src/app/dashboard/bookings/page.tsx`: sin cambio de llamada; el `select` satisface el set pesado.

## Guardrail

`tsc --noEmit` es la red de seguridad: las páginas son server components que pasan el resultado de Prisma directo a props tipados (`ManualPaymentBooking`, `RowBooking`, el type inline de `BookingCard`, los predicados). Si algún `select` sub-selecciona, el build rompe. Verificación: `tsc` limpio (salvo baseline r2) + suite completa + `next build`.

## Riesgo

~nulo: recorte de columnas + una query nueva con la misma forma de datos que la vieja para su consumidor. No toca semántica, TZ, orden ni conjunto de filas.
