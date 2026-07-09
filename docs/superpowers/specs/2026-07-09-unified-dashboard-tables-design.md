# Patrón unificado de tablas del dashboard — Diseño

**Fecha:** 2026-07-09
**Estado:** aprobado, listo para plan

## Problema

Las tablas del dashboard cortan/desbordan su contenido y se ven inconsistentes entre sí.

**Causa raíz del recorte.** Todas heredan el componente base [`src/components/ui/table.tsx`](../../../src/components/ui/table.tsx), que aplica `whitespace-nowrap` a cada celda con padding `p-2`. Ningún texto envuelve, así que cada columna crece hasta caber en una línea. Con tablas de 7 columnas (Reservas) más botones de acción anchos, el ancho intrínseco supera el área útil (~950px en un notebook de 1280px con sidebar) → aparece scroll horizontal dentro de la card y las columnas de la derecha ("Acciones") quedan cortadas hasta scrollear.

**Causa de la inconsistencia.** No hay una estrategia única. Conviven **7 formas distintas** de manejar el desborde en 14 tablas:

| Tabla | Manejo actual |
|---|---|
| Reservas | nada (solo `nowrap`) |
| Clientes | función `truncate()` JS + `max-w-[160px]` |
| Servicios | `max-w-md` sin truncar de verdad |
| Promociones | `line-clamp-1` |
| Reviews | `line-clamp-2` + `.slice(0,8)` |
| Billing | `max-w-[200px] truncate` |
| Ledger / Admin / Redemptions | nada |

Además, solo 3 de ~14 tablas tienen variante móvil (card); el resto son `<table>` que en pantallas angostas solo hacen scroll horizontal. Algunas ni usan el componente base (admin, billing usan `<table>` a mano). Los badges de estado hardcodean colores por tabla (`bg-orange-100 text-orange-800`, etc.), frágil en dark mode.

## Objetivo

Definir **un** patrón de tabla y aplicarlo a todas las tablas del dashboard: contenido que nunca se recorta, truncado consistente con acceso al texto completo, acciones compactas, y una variante móvil compartida.

## Decisiones tomadas

- **Enfoque:** convención + primitivas compartidas, **no** un `<DataTable columns={...}>` genérico. Las páginas son Server Components con server actions inline; un DataTable client-only rompería ese patrón y forzaría cada celda custom a un esquema rígido.
- **Acciones por fila:** 1 acción primaria visible + kebab `⋯` con el resto.
- **Alcance:** todas las tablas (~14), entregado en varios PRs revisables.
- **Breakpoint tabla→card:** `lg` (1024px). Tablets en vertical (768–1024) ven cards, no una tabla apretada.
- **`<StatusBadge>` compartido:** dentro del alcance.
- **Tooltip:** atributo `title` nativo del HTML (sin componente nuevo).

## Arquitectura

### Primitivas nuevas (`src/components/ui/`)

1. **`<Table fixed>`** — prop `fixed` en `table.tsx` que añade `table-layout: fixed`. Cambio aditivo: el default no cambia, las tablas actuales no se afectan. Se mantiene el wrapper `overflow-x-auto` existente como red de seguridad para que nunca haya recorte duro.

2. **`<TruncatedCell primary secondary?>`** — `<TableCell>` con `truncate` (`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`) sobre el texto principal, `title={primary}` para ver el completo al hover, y `secondary` opcional como segunda línea (`text-xs text-muted-foreground`). Función pura (sin `'use client'`) → usable dentro de Server Components.

3. **`<TableActions>`** — renderiza la acción primaria (slot `primary`, nodo arbitrario) inline + un kebab con [`DropdownMenu`](../../../src/components/ui/dropdown-menu.tsx) cuyos items son nodos arbitrarios (children). Acepta forms de server action, diálogos (`CancelBookingButton`, `ManualPaymentDialog`) y links sin forzar un modelo de item. Client component; en un Server Component la página le pasa los nodos ya renderizados como children (permitido). El botón kebab lleva `aria-label` ("Más acciones"). **Landmine Radix:** un trigger de `Dialog` dentro de un `DropdownMenuItem` hace que el menú se cierre y desmonte el diálogo antes de que abra. Se maneja con estado de apertura del diálogo controlado **fuera** del menú (o `onSelect={(e) => e.preventDefault()}` en el item que abre diálogo) — obligatorio para las acciones de Reservas.

4. **`<TableMobileCard>`** — representación en card para <1024px: título, subtítulo, filas label/valor, y zona de acciones. Calcada del `BookingCard` actual, para que las tablas sin variante móvil adopten una consistente.

5. **`<StatusBadge status label?>`** — badge con un mapa único `status → clase de color` (tokens que funcionan en dark mode), reemplaza los colores hardcodeados. Un mapa por dominio (reservas, pagos, reviews, promos) exportado desde el componente. Consolida duplicación real: hoy `statusLabels`/`statusColors` están copiados en al menos `booking-card.tsx` y `bookings/page.tsx`; el componente pasa a ser la fuente única y ambos lo consumen.

### Regla de columnas y truncado

- **Una sola columna flexible** (la principal: servicio/cliente/descripción según la tabla) sin ancho explícito → bajo `table-layout: fixed` absorbe el espacio sobrante y trunca bajo presión. Las **demás** columnas de texto llevan un `max-width` px (si fueran también flexibles, `table-layout: fixed` repartiría el ancho 50/50 y la principal perdería prioridad).
- **Atómicas** (fecha, badge de estado, iconos, acciones) → ancho px fijo, `whitespace-nowrap`. Estos anchos se definen como **constantes compartidas** (un módulo `table-widths` con `date`, `status`, `actions`, etc.) para que la misma columna mida igual en todas las tablas y no se reintroduzca inconsistencia.
- **Montos** → ancho suficiente + `nowrap`, **nunca** `truncate` (ellipsis escondería dígitos). Si aprieta, se baja el `font-size` o se apila; no se corta.
- **Piso de ancho.** La tabla lleva un `min-width` (suma de columnas atómicas + un mínimo razonable para la flex). Bajo ese ancho, el wrapper `overflow-x-auto` scrollea en vez de aplastar la columna flexible a "M…". El scroll es el fallback, no el modo normal.
- **El truncado es CSS, nunca JS.** El truncado por CSS (`text-overflow: ellipsis`) deja el texto completo en el DOM → lo lee el screen reader y se puede copiar/pegar. Se elimina todo el truncado ad-hoc que **borra** texto: funciones `truncate()` JS (28/32/60 chars), `.slice(0,8)`, más los `max-w-[Npx]` sueltos y `line-clamp-*` dispersos. Todo pasa por `TruncatedCell`.

### Regla de acciones

- Con primaria y secundarias → botón visible + kebab.
- Con primaria sin secundarias → solo el botón (nada de kebab vacío).
- Sin primaria → solo kebab.
- Read-only (Ledger, Billing, Admin) → sin columna de acciones.
- La acción primaria puede depender del estado de la fila (ej. Reservas: `Completar` si `confirmed`, `Cobrar` si `pending_payment`, ninguna si terminal).

### Responsive

Patrón único en todas: `hidden lg:block` (tabla) + `lg:hidden` (lista de `<TableMobileCard>`). Se borran las variantes móviles duplicadas de Reservas/Clientes y se reusa la primitiva. El `title`/tooltip no aparece en touch, pero en <1024px se muestran cards con el texto completo, así que no se pierde nada.

## Mapa de acciones primarias por tabla

| Tabla | Archivo | Primaria | Kebab |
|---|---|---|---|
| Reservas | `src/app/dashboard/bookings/page.tsx` | `Completar`/`Cobrar` (según estado) | Reprogramar, Cancelar, Pago manual, WhatsApp |
| Servicios | `src/components/dashboard/service-table.tsx` | `Editar` | Activar/desactivar, Eliminar |
| Clientes | `src/app/dashboard/customers/customer-list.tsx` | `Ver` | WhatsApp, Email |
| Promociones | `src/app/dashboard/promociones/page.tsx` | `Editar` | Ver canjes, Activar/desactivar, Eliminar |
| Reviews | `src/app/dashboard/reviews/reviews-client.tsx` | `Aprobar`/`Ocultar` | resto |
| Detalle cliente (reservas + pagos) | `src/app/dashboard/customers/[id]/page.tsx` | — (read-only) | — |
| Ledger | `src/components/dashboard/ledger-table.tsx` | — (read-only) | — |
| Redemptions (modal) | `src/app/dashboard/promociones/redemptions-button.tsx` | — (read-only) | — |
| Billing | `src/app/dashboard/billing/page.tsx` | — (read-only, migrar `<table>` cruda al componente base) | — |
| Admin negocios | `src/app/admin/page.tsx` | según fila | migrar `<table>` cruda al componente base |
| Admin detalle negocio (bookings + payments) | `src/app/admin/businesses/[businessId]/page.tsx` | — (read-only) | migrar `<table>` cruda |

## Entrega (PRs)

Mismo alcance (todas), entregado revisable:

- **PR 1 — Primitivas + piloto:** `<Table fixed>`, `<TruncatedCell>`, `<TableActions>`, `<TableMobileCard>`, `<StatusBadge>` con tests de componente + migrar **Reservas** como piloto (valida las 4 piezas juntas contra el caso más complejo).
- **PR 2 — Tablas dueña-facing:** Servicios, Clientes, Promociones, Reviews, detalle de cliente, Ledger.
- **PR 3 — Tablas internas / `<table>` crudas:** Billing, Admin (2 páginas), Redemptions.

## Testing

- **Unit/componente** (`createRoot` + `act`, mock de `next/navigation`):
  - `TruncatedCell`: renderiza texto principal + secundario, aplica clase de truncado, expone `title` con el texto completo.
  - `TableActions`: primaria visible; con secundarias renderiza el trigger del kebab; sin secundarias no lo renderiza; sin primaria solo kebab. Nota: abrir el menú de Radix (portal + pointer events) es flaky en jsdom, así que el test se acota a la presencia del trigger y al estado controlado, no a interactuar con el contenido del menú desplegado.
  - `TableMobileCard`: renderiza título/subtítulo/filas/acciones.
  - `StatusBadge`: mapea cada estado a su clase; label por defecto y override.
- **Verificación visual/manual** (jsdom no calcula layout): ninguna tabla desborda horizontalmente a ≤768px, ≤1024px y ≤1280px; el switch tabla↔card ocurre en 1024px.

## Riesgos

- Tocar 14 archivos arriesga regresiones visuales → mitigado con la entrega en PRs y verificación visual por tabla.
- El límite Server/Client Component: `TruncatedCell` y `StatusBadge` deben ser puros (usables en SC); `TableActions` y `TableMobileCard` son client y reciben nodos ya renderizados como children.

## Fuera de alcance (YAGNI)

- Ordenamiento/sorting de columnas, resize manual, virtualización.
- Componente de tooltip dedicado (basta `title`).
- Cambios de datos o de lógica de negocio; esto es puramente presentación.
