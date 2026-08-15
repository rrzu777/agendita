# Auditoría de tablas del dashboard — 2026-08-15

## Hallazgo corregido

**Reservas:** `BookingRowActions` colocaba los botones de contacto
(confirmación, recordatorio y copiar) en el slot `primary` de una columna de
acciones de 120 px. Al hacer wrap, el contenido invadía las celdas de pago y
estado, tal como en la captura recibida. Los controles ahora viven bajo el
menú portalizado; la fila mantiene sólo su acción primaria y el trigger kebab.

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

## Pendiente de validación final

La matriz Playwright a 375, 768, 1024 y 1280 px se ejecutará al terminar los
tracks de datos, para probar el mismo build final y no repetir servidores.
