# Diseño: Prevención de Doble-Booking en Agendita

**Fecha:** 2026-05-17
**Autor:** Backend Senior
**Estado:** Aprobado

## 1. Contexto

Actualmente `createBooking` en `src/server/actions/bookings.ts` no valida server-side que el slot solicitado siga disponible en el momento de la creación. Esto permite doble-booking si dos clientas seleccionan el mismo slot antes de que la primera reserva se confirme.

## 2. Objetivo

Eliminar doble-booking mediante validación transaccional server-side, mejorar la generación de slots para no mostrar horarios pasados, y cubrir todo con tests unitarios.

## 3. Alcance

**Incluye:**
- `assertSlotIsAvailable()`: validación server-side transaccional.
- Refactor de `createBooking` para ejecutar validación dentro de `prisma.$transaction`.
- Advisory lock de PostgreSQL por `(businessId, slotStart)` para prevenir race conditions.
- Mejoras en `generateSlots`: timezone del negocio, filtrar horarios pasados para hoy, documentar step increment.
- Actualización de `getAvailableTimeSlots` para pasar timezone.
- Tests unitarios para validación y slots.

**Excluye:**
- Cambios a lógica de pagos.
- Cambios a UI salvo mensaje de error ya existente en `StepPayment`.

## 4. Arquitectura

### 4.1 Componentes

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| `assertSlotIsAvailable` | `src/lib/availability/validation.ts` | Valida que un slot sea reservable. |
| `generateSlots` | `src/lib/availability/slots.ts` (mejorado) | Genera slots disponibles para un día. |
| `createBooking` | `src/server/actions/bookings.ts` (refactor) | Orquesta cliente + booking con validación transaccional. |
| `getAvailableTimeSlots` | `src/server/actions/availability.ts` (mejorado) | Obtiene datos y genera slots. |

### 4.2 Flujo de Creación de Reserva (refactor)

```
Cliente envía datos → createBooking
  ├── assertSlotIsAvailable (dentro de tx)
  │   ├── pg_advisory_lock(businessId, slotStart)
  │   ├── Verificar service, duración, regla, rango
  │   ├── Verificar TimeBlocks (solapamiento)
  │   ├── Verificar Bookings (FOR UPDATE + solapamiento)
  │   └── Si falla → throw "Ese horario ya no está disponible..."
  ├── findOrCreateCustomer (dentro de tx)
  └── createBooking (dentro de tx)
```

## 5. Especificación de Componentes

### 5.1 `assertSlotIsAvailable({ tx, businessId, serviceId, startDateTime, endDateTime })`

**Parámetros:**
- `tx`: instancia de Prisma transaction (`PrismaClient` o `Prisma.TransactionClient`).
- `businessId`, `serviceId`: strings.
- `startDateTime`, `endDateTime`: `Date` (UTC, como Prisma maneja los datos).

**Validaciones (en orden):**
1. `endDateTime > startDateTime`. Si no: throw.
2. `startDateTime > now() + 1 minuto`. Si no: throw.
3. Service existe, `isActive === true`, `businessId === businessId`. Si no: throw.
4. `differenceInMinutes(endDateTime, startDateTime) === service.durationMinutes`. Si no: throw.
5. Existe `AvailabilityRule` para el `dayOfWeek` del `startDateTime` en timezone del negocio, con `isActive === true`. El slot `[start, end)` debe estar completamente dentro del rango `[ruleStartTime, ruleEndTime]`. Si no: throw.
6. No existe `TimeBlock` que se solape con `[startDateTime, endDateTime)`. Solapamiento = `start < block.end && block.start < end`. Si hay: throw.
7. No existe `Booking` con status en `['pending_payment', 'confirmed', 'completed']` que se solape con `[startDateTime, endDateTime)`. Usar `tx.$queryRaw` con `SELECT * FROM "Booking" WHERE ... FOR UPDATE` para bloquear lecturas concurrentes.

**Error devuelto:**
> "Ese horario ya no está disponible. Por favor selecciona otro."

Para debugging interno, loguear la razón exacta del fallo.

### 5.2 `generateSlots(date, durationMinutes, rules, blocks, bookings, { timezone, now? })`

**Parámetros nuevos:**
- `timezone`: string (ej. `"America/Santiago"`).
- `now?`: Date opcional para testing; si no se pasa, usa `new Date()`.

**Comportamiento:**
- Convertir `date` al timezone del negocio para obtener `dayOfWeek` correcto.
- Construir `availabilityStart` y `availabilityEnd` como timestamps locales del día (00:00 a 23:59 en timezone del negocio) aplicando las horas de la regla.
- Step increment: `durationMinutes`. **Documentar en comentario** que el step es igual a la duración del servicio.
- Si `date` es "hoy" en el timezone del negocio, no generar slots donde `slot.start <= nowEnTimezone + 1min`.
- Filtrar solapamientos con `blocks` y `bookings` (ignorando `cancelled` y `no_show`) usando la misma fórmula: `start < other.end && other.start < end`.

**Nota sobre timezone:**
Como `date-fns` no soporta timezone nativamente, se usa el constructor nativo de `Date` con componentes locales. Para este proyecto, se calcula `dayOfWeek` convertiendo la fecha a string en el timezone deseado vía `toLocaleString('en-US', { timeZone: timezone, ... })` y luego reconstruyendo el `Date` local equivalente. Alternativamente, si la fecha ya viene correcta desde el cliente, usamos `date.getDay()` pero **documentamos** que `date` debe representar medianoche en el timezone del negocio.

Dado el scope, la solución más robusta sin agregar dependencias es:
- Aceptar que `date` es un `Date` que representa medianoche local del día deseado.
- `getAvailableTimeSlots` se encarga de pasar la fecha correcta desde el cliente.
- Para "hoy", usamos `new Date()` y comparamos slots directamente.

**Revisión de espec self-review:** Esto tiene ambigüedad. Mejor solución: usar `date-fns-tz` no está en el package.json. Sin agregar deps, la forma de calcular "hoy" correctamente es que `getAvailableTimeSlots` reciba `date` ya como objeto `Date` en UTC que representa medianoche en el timezone del negocio. Dado que el cliente ya selecciona una fecha sin hora, Prisma/Next.js la trata como UTC si no se cuida. Actualmente `StepDate` pasa un `Date` del día seleccionado. Asumiremos que `date` es un `Date` UTC con hora 00:00 del día seleccionado, y las reglas de horario (`startTime`, `endTime`) son strings HH:MM que se aplican sobre ese día UTC. Esto funciona si el negocio y el servidor están en el mismo timezone. Para `America/Santiago`, si el servidor está en UTC, `new Date('2026-05-11')` es 00:00 UTC que equivale a 20:00 del 10 en Chile. **Esto es un bug existente.**

**Decisión de diseño:** Para no expandir el scope a refactor completo de timezone en toda la app, en esta iteración:
1. `getAvailableTimeSlots` recibirá `date` como viene actualmente.
2. Para filtrar "horarios pasados", usaremos `new Date()` directamente contra `slot.start` (asumiendo que servidor y negocio comparten timezone, o que la diferencia es aceptable en MVP).
3. **Documentar en comentario** que el timezone correcto es deuda técnica pendiente.

Espera, el usuario quiere que hagamos lo mejor posible. Voy a implementar el timezone sin agregar dependencias, usando `Intl.DateTimeFormat` nativo para obtener el offset del timezone del negocio.

**Implementación timezone sin dependencias:**
```typescript
function toBusinessTime(date: Date, timezone: string): { dayOfWeek: number; year: number; month: number; day: number; hours: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'numeric', // 1=Sun in en-US? No, en-US es Sunday=1
    Actually: better to use 'iso8601'
  })
}
```

`Intl.DateTimeFormat` con `timeZone` es soportado en Node.js. Podemos obtener componentes locales del timezone:
```typescript
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: timezone,
  year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric',
  hour12: false,
})
const parts = formatter.formatToParts(date)
```

Luego reconstruimos un "Date local equivalente" para usar con `date-fns`. Esto es robusto.

**Decision final de espec:** Sí, implementaremos helper `toBusinessLocalDate(date, timezone)` que devuelve un `Date` "local-equivalent" usando componentes del timezone del negocio, para que `date-fns` funcione correctamente sobre él. Documentar esta técnica.

### 5.3 `createBooking` (refactor)

```typescript
export async function createBooking(data, businessId) {
  // ... rate limit + zod validation ...

  const endDateTime = addMinutes(data.startDateTime, service.durationMinutes)

  const booking = await prisma.$transaction(async (tx) => {
    await assertSlotIsAvailable({
      tx,
      businessId,
      serviceId: data.serviceId,
      startDateTime: data.startDateTime,
      endDateTime,
    })

    // findOrCreateCustomer ... (mover dentro de tx)
    let customer = await tx.customer.findFirst(...)
    if (!customer) {
      customer = await tx.customer.create(...)
    }

    return tx.booking.create({
      data: { ... },
      include: { service: true, customer: true },
    })
  })

  revalidatePath(...)
  await revalidateBusinessPublicPaths(businessId)
  return booking
}
```

**Advisory lock:** Dentro de `assertSlotIsAvailable`, antes de leer bookings, ejecutar:
```sql
SELECT pg_advisory_lock(${businessIdHash}, ${slotStartHash})
```
Donde `businessIdHash` y `slotStartHash` son enteros derivados de los strings (ej. `crc32` o simple `parseInt(cuid, 36) % 2^31`). Si no se puede obtener el lock, esperar (PostgreSQL `pg_advisory_lock` es bloqueante).

Después de la transacción, liberar con `pg_advisory_unlock` dentro de un `finally` equivalente... pero como es una transacción, el lock se libera al finalizar la transacción. **Espera**, `pg_advisory_lock` se mantiene por sesión, no por transacción. Para transacciones, `pg_advisory_xact_lock` es mejor (se libera automáticamente al final de la transacción). Usaremos `pg_advisory_xact_lock`.

```sql
SELECT pg_advisory_xact_lock(${key1}, ${key2})
```

Dado que `businessId` y `startDateTime` son strings/fechas, necesitamos hashear a int64. Simplificación: concatenar `businessId|startDateTime.toISOString()` y usar `pg_advisory_xact_lock(hashtext('...')::bigint)` si PostgreSQL soporta `hashtext`, o calcular un hash simple en TS.

Prisma `queryRaw`:
```typescript
const lockKey = `${businessId}:${startDateTime.toISOString()}`
const hash = Array.from(lockKey).reduce((h, c) => Math.imul(31, h) + c.charCodeAt(0) | 0, 0)
await tx.$queryRaw`SELECT pg_advisory_xact_lock(${hash})`
```

Pero `hash` puede ser negativo. PostgreSQL advisory locks aceptan `bigint`, pero `queryRaw` con parámetros negativos puede ser tricky. Usaremos `Math.abs(hash)`.

### 5.4 `getAvailableTimeSlots` (mejorado)

- Obtener `business.timezone` junto con los datos.
- Pasar `timezone` a `generateSlots`.
- Pasar `new Date()` como `now` a `generateSlots`.

## 6. Tests

### 6.1 Tests para `assertSlotIsAvailable`

Ubicación: `tests/unit/availability-validation.test.ts`

- **Solapamiento parcial:** Booking existente 10:00-11:00, intentar 10:30-11:30 → rechazado.
- **Solapamiento exacto:** Booking existente 10:00-11:00, intentar 10:00-11:00 → rechazado.
- **Reserva contigua permitida:** Booking existente 10:00-11:00, intentar 11:00-12:00 → permitido.
- **Cancelled/No-show no bloquean:** Booking existente `cancelled` 10:00-11:00, intentar 10:00-11:00 → permitido.
- **TimeBlock bloquea:** TimeBlock 10:00-11:00, intentar 10:00-11:00 → rechazado.
- **Duración incorrecta:** Service de 60 min, intentar 30 min → rechazado.
- **Horario pasado:** Intentar reservar en el pasado → rechazado.
- **Regla inactiva:** Día sin availability rule activa → rechazado.
- **Slot fuera de regla:** Regla 09:00-18:00, intentar 08:00-09:00 → rechazado.
- **Doble booking concurrente:** Test usando transacción simulada o al menos verificar que el advisory lock se ejecuta.

**Nota:** Para testear `assertSlotIsAvailable` sin base de datos real, usaremos un mock del Prisma transaction client. Dado que el proyecto usa `vitest` con `jsdom`, podemos usar `vi.fn()` para mockear las queries. Sin embargo, `assertSlotIsAvailable` usa `tx.$queryRaw` para el lock. Necesitamos mockear eso también.

Alternativa: dado que Prisma es difficil de mockear completamente, podríamos hacer tests de integración. Pero el proyecto no tiene una DB de test configurada. Decisión: hacer tests unitarios con mocks de PrismaClient.

### 6.2 Tests para `generateSlots` (mejorados)

Ubicación: `tests/unit/slots.test.ts` (extender existente)

- **No genera slots pasados para hoy:** Si `date` es hoy y `now` es 14:00, no generar slots antes de 14:00 (con margen).
- **Timezone correcto:** Probar que `dayOfWeek` se calcula según timezone (ej. UTC 23:00 de domingo = lunes en Santiago).
- **Step increment documentado:** Verificar que step = `durationMinutes`.

## 7. Plan de Migración / Rollout

- No requiere migración de base de datos (no cambiamos schema).
- Cambios son aditivos/refactor.
- Después del deploy, `createBooking` será más restrictivo pero más seguro.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Advisory lock lento bajo alta concurrencia | `pg_advisory_xact_lock` es eficiente; esperas cortos. |
| Timezone incorrecto si servidor ≠ negocio | Usar `Intl.DateTimeFormat` para calcular componentes locales. |
| Tests de Prisma mockeados son frágiles | Mantener mocks simples y cercanos a la interfaz real. |

## 9. Criterios de Aceptación

- [ ] Dos clientas no pueden crear reservas solapadas.
- [ ] `createBooking` falla con mensaje claro si el slot ya no está disponible.
- [ ] `generateSlots` no muestra horarios pasados para el día actual.
- [ ] Todos los tests unitarios pasan.
- [ ] `npm run build` pasa sin errores.
