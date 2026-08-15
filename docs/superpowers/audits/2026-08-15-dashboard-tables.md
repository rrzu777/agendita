# Auditoría de tablas del dashboard — 2026-08-15

## Hallazgos corregidos

**Reservas:** `BookingRowActions` colocaba los botones de contacto
(confirmación, recordatorio y copiar) en el slot `primary` de una columna de
acciones de 120 px. Al hacer wrap, el contenido invadía las celdas de pago y
estado, tal como en la captura recibida. Los controles ahora son items de
Radix dentro del menú portalizado; la fila mantiene sólo su acción primaria y
el trigger kebab. Los estados sin menú (expirada/terminal) usan controles
compactos inline, sin montar items de menú fuera de su contexto.

**Reservas móvil:** cuatro acciones de una reserva confirmada podían exceder
el ancho de 375 px. La card usa una grilla de dos columnas y el CTA de pago se
llama “Cobrar”, manteniendo el mismo flujo sin scroll horizontal.

**Reseñas móvil:** los filtros de estado y calificación usaban filas flex con
un ancho mínimo mayor al viewport. Ahora son grillas de 4 y 6 columnas, con
tipografía compacta sólo bajo `sm`.

## Inventario revisado

Las siguientes vistas usan el patrón desktop `hidden lg:block` + cards
`lg:hidden`, `Table fixed` y `TABLE_MIN_WIDTH`:

- Reservas, Clientes, detalle de cliente, Pagos/Ledger, Servicios,
  Profesionales, Promociones, Canjes, Reseñas, Campañas y destinatarios.
- Billing, Admin de negocios y detalle Admin.

Las tablas de acciones de Servicios, Profesionales, Promociones y Reseñas usan
una primaria acotada más `TableActions`; no introducen controles compuestos en
la celda. Clientes/Admin tienen una única acción de ancho acotado. Ledger,
detalle de cliente, canjes y billing son de sólo lectura.

## Criterios

- Las cantidades monetarias no se truncan.
- Las columnas de estado, fecha y acciones usan anchos compartidos.
- Los textos variables pasan por `TruncatedCell` o se muestran completos en la
  card móvil.
- El fallback bajo `lg` no depende de scroll horizontal.

## Validación de navegador

Con datos seed y autenticación E2E se recorrieron Reservas, Clientes, Pagos,
Servicios, Equipo, Promociones, Reseñas y Campañas en 375, 768, 1024 y 1280
px (32 combinaciones). Todas respondieron 200 y terminaron con
`scrollWidth === clientWidth`. La comprobación detectó los dos hallazgos móvil
de arriba antes de su corrección y pasó tras ella.

Billing requiere rol owner para renderizar su tabla; su estructura quedó
cubierta por el inventario estático y su flujo se valida con la suite de
permisos, no con la sesión staff usada en esta matriz.

## Límites y operación

Clientes, Reservas y Movimientos usan cursores tenant-scoped y páginas de 50.
La búsqueda y filtros existentes de Clientes se declaran explícitamente como
filtros de la página visible; no prometen una búsqueda global parcial. Las dos
colas independientes de Reservas preservan el cursor de la otra al avanzar.

La migración incorpora índices normales de PostgreSQL, compatibles con el
runner transaccional de Prisma. Si producción acumula un historial grande, el
runbook de despliegue debe crear esos índices con `CREATE INDEX CONCURRENTLY`
fuera de transacción, con los mismos nombres y verificando su existencia antes
de ejecutar Prisma. Así el `CREATE INDEX IF NOT EXISTS` posterior no los
reconstruye ni bloquea escrituras; no conviene introducir una pausa operativa
para ganar rendimiento de lectura.
