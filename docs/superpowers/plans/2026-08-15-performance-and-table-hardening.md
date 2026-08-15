# Rendimiento y tablas del dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer escalables las rutas de dashboard, reducir JS inicial y garantizar que ninguna tabla se rompa o pierda acciones en desktop/móvil.

**Architecture:** Las vistas de lista consumen primeras páginas acotadas y totales agregados; las acciones que necesitan el histórico completo mantienen endpoints explícitos. La presentación reutiliza las primitivas de tabla, mientras overlays/client code poco frecuente se divide por ruta. Métricas operativas evitan scans globales en cada scrape.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma/PostgreSQL, Vitest, Playwright, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-15-performance-and-table-hardening-design.md`

## Global Constraints

- Filtrar cualquier cursor y consulta por `businessId`.
- No modificar semántica contable, estados de reserva, PII ni contratos externos.
- Mantener un solo reloj server-rendered para decisiones de plazo.
- Probar RED antes de cada cambio de producción y revisar cada entregable.

---

### Task 1: Corregir Reservas y establecer auditoría de tablas

**Files:**
- Modify: `src/components/ui/table-actions.tsx`, `src/components/ui/table-widths.ts`, `src/app/dashboard/bookings/page.tsx`, `src/components/dashboard/booking-row-actions.tsx`
- Modify as needed: cada ruta de `rg -l '<Table|<table' src`
- Test: `tests/components/table-actions.test.tsx`, `tests/e2e/dashboard-tables.spec.ts`

- [ ] Escribir tests que demuestren que la fila de Reservas reserva una columna de acciones y que el menú no ocupa el flujo de la fila.
- [ ] Ejecutar esos tests y confirmar RED por el ancho insuficiente/overlay actual.
- [ ] Separar contacto, primaria y menú en `BookingRowActions`; definir un ancho de acciones que soporte los controles visibles y usar portal de Radix.
- [ ] Inventariar cada tabla y aplicar sólo los fixes necesarios para `fixed`, min-width, cards `<lg>`, montos no truncados y acciones sin superposición.
- [ ] Añadir Playwright con contenido largo en 375, 768, 1024 y 1280 px para todas las rutas inventariadas.
- [ ] Ejecutar las pruebas de componente/E2E y registrar auditoría por ruta.
- [ ] Commit: `fix: harden dashboard table layouts`

### Task 2: Paginar las lecturas de dashboard

**Files:**
- Modify: `src/server/actions/bookings.ts`, `src/server/actions/ledger.ts`, `src/server/actions/customers.ts`
- Modify: `src/app/dashboard/bookings/page.tsx`, `src/app/dashboard/payments/page.tsx`, `src/app/dashboard/customers/page.tsx`, `src/app/dashboard/page.tsx`
- Test: `tests/unit/get-bookings-by-range.test.ts`, `tests/unit/customers-actions.test.ts`, new focused action tests

- [ ] Escribir tests para primera página, cursor siguiente, cursor ajeno a tenant, límite y resumen agregado de reservas/ledger/clientes.
- [ ] Confirmar RED contra las acciones de historial completo actuales.
- [ ] Implementar contratos `{ items, nextCursor }` con orden estable y consultas de KPI en DB; preservar `getBookings` sólo si queda un consumidor servidor que explícitamente pide todo.
- [ ] Hacer que dashboard use estadísticas agregadas y próximas reservas acotadas; Pagos carga summary/ledger/booking selector en paralelo; Clientes deja de transferir 500 filas como techo fijo.
- [ ] Ejecutar unit e integración PostgreSQL de aislamiento, límites y totales.
- [ ] Commit: `perf: paginate dashboard data reads`

### Task 3: Reducir bundle y unificar Prisma

**Files:**
- Modify: `src/lib/db.ts`, `src/lib/db/prisma.ts` y el import aislado que use el alias viejo
- Modify: `src/components/dashboard/calendar-views.tsx`, `src/components/booking/wizard.tsx`
- Test: pruebas de importación/componentes existentes y análisis de build

- [ ] Escribir pruebas/import checks que fallen si existe más de un módulo Prisma exportando cliente o si un paso diferido rompe la navegación.
- [ ] Unificar a `@/lib/db` y eliminar/reexportar el duplicado sin crear dos instancias.
- [ ] Cargar dinámicamente los diálogos de calendario y los pasos tardíos de pago/confirmación, con fallback estable.
- [ ] Ejecutar tests, typecheck y build; comparar los chunks de `/dashboard/calendar` y `/book/[slug]` antes/después.
- [ ] Commit: `perf: split deferred dashboard and booking UI`

### Task 4: Reemplazar métricas costosas por señales operativas

**Files:**
- Modify: `src/app/api/metrics/route.ts`
- Create/Modify: helper de métricas server-only y tests de ruta

- [ ] Escribir tests que rechacen métricas hardcodeadas y que garanticen ausencia de scans por negocio durante un scrape.
- [ ] Confirmar RED con el endpoint actual.
- [ ] Implementar contadores/duraciones agregadas por operación y resultado, sin labels de negocio ni PII; retornar health de métricas cuando aún no hay muestras.
- [ ] Ejecutar tests de endpoint y revisar que autenticación fail-closed siga intacta.
- [ ] Commit: `perf: make operational metrics cheap and useful`

### Task 5: Validación integrada y revisión

**Files:**
- Modify: documentación de auditoría/decisiones si cambian rutas o contratos

- [ ] Ejecutar toda la suite unitaria, integración PostgreSQL, lint, typecheck, build y Playwright de tablas.
- [ ] Revisar diff contra `origin/main` por PII, aislamiento tenant, cambios contables, hydration y regresiones móviles.
- [ ] Solicitar revisión independiente, corregir findings Important/Critical y repetir gates afectados.
- [ ] Commit final sólo si todos los requisitos del spec tienen evidencia actual.
