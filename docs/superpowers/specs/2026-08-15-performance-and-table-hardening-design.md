# Rendimiento y tablas del dashboard — Diseño

**Fecha:** 2026-08-15  
**Estado:** implementado; validación operativa pendiente de despliegue

## Objetivo

Eliminar el solapamiento de acciones de Reservas y asegurar que todas las
tablas tengan un comportamiento consistente en escritorio y móvil; a la vez,
evitar que el dashboard descargue históricos completos o bloquee su render por
consultas seriales innecesarias.

## Alcance

### Tablas

- Corregir la tabla de Reservas de la captura: la columna de acciones debe
  reservar ancho suficiente y el menú debe abrir fuera del flujo de la fila,
  sin tapar pago ni acciones visibles.
- Auditar cada uso de `Table` y cada `<table>` cruda de la aplicación en los
  breakpoints 375, 768, 1024 y 1280 px.
- Aplicar el patrón ya existente: tabla sólo desde `lg`, cards en móvil,
  `Table fixed`, una columna flexible, anchos atómicos compartidos y acciones
  compactas. No se perderá información monetaria por truncado.
- Corregir sólo defectos observables de tablas; no se rediseñará la UI sana.

### Datos y rutas calientes

- Reemplazar lecturas de historial completo por APIs internas paginadas con
  cursor para Reservas, Movimientos y Clientes.
- El dashboard debe pedir únicamente KPIs agregados, transferencias pendientes
  y un número acotado de próximas reservas. Los conteos no se derivarán de
  arreglos enviados al servidor de render.
- La página de Pagos debe cargar sus fuentes independientes en paralelo y el
  resumen financiero debe reducir los viajes a base de datos sin cambiar sus
  reglas contables.
- Mantener compatibilidad de exportación: una exportación explícita puede leer
  el conjunto completo del lado servidor, pero la vista no.

### Cliente y conexión DB

- Unificar los dos módulos Prisma en una sola instancia canónica.
- Diferir pasos tardíos del wizard detrás de imports dinámicos, sin retrasar
  controles necesarios para la primera interacción. El calendario se conserva
  renderizado en servidor: diferirlo dejó sólo un skeleton en SSR y empeoraba
  la primera vista del panel.
- No se cambiarán contratos de reservas, pagos, ni la configuración de
  PgBouncer.

### Observabilidad

- Instrumentar duración de las rutas/acciones críticas y errores reales en un
  formato que no exponga IDs, teléfonos, URLs de comprobantes ni secretos.
- Evitar que `/api/metrics` haga varios `GROUP BY` de tablas completas por
  scrape. Las métricas de inventario que se mantengan serán de bajo costo y los
  contadores operativos tendrán una fuente real, no valores constantes.

## Diseño técnico

### Contratos de lectura

Las acciones de lista devolverán `{ items, nextCursor }`. El cursor será el
ID de la última fila junto a un orden estable; el cliente añade páginas bajo
demanda. Las páginas server iniciales reciben la primera página. Las consultas
de resumen serán funciones separadas que devuelven los conteos y montos ya
agregados.

Los filtros de Clientes que hoy se resuelven en el cliente se presentan como
filtros de la página visible, para no comunicar erróneamente un resultado
global después de paginar. Una búsqueda global futura deberá ser server-side,
reiniciar el cursor y paginar el conjunto filtrado.

El filtro de tenant (`businessId`) estará presente tanto al resolver el cursor
como al seleccionar la siguiente página. Ningún cursor de un negocio podrá
usarse para recorrer filas de otro.

### Tabla de Reservas

`BookingRowActions` conservará una acción primaria visible. El resto vive en
un menú portalizado. La celda tendrá el ancho de acciones canónico y no se
permitirá que su contenido participe en el cálculo de ancho de las columnas
de dinero. En móvil se muestra el mismo conjunto de acciones dentro de la
card, sin menú superpuesto.

La auditoría inventariará todas las tablas para verificar: `fixed`, min-width,
columnas atómicas, fallback móvil y acciones. Las tablas puramente de lectura
no ganan una columna de acciones artificial.

### Carga cliente

Los overlays poco frecuentes se cargarán por `next/dynamic` con un fallback
que conserva tamaño y accesibilidad. El wizard conserva el paso actual en el
bundle inicial; pago y confirmación se cargan únicamente al alcanzarlos.

### Métricas

Se registrarán tiempos agregados por nombre de operación y resultado, sin
labels de tenant. La ruta de métricas no hará scans globales durante un scrape;
las series disponibles se limitarán a salud de proceso, duración y resultados
de trabajos. Los datos de negocio detallados quedan en consultas internas de
administración, no Prometheus.

## Reglas de seguridad y compatibilidad

- Todo acceso sigue pasando por `requireBusiness`/`requireBusinessRole`.
- El cursor se valida y se aplica junto al `businessId`.
- No se agregan logs de PII, tokens, IDs de reserva ni comprobantes.
- Se preservan formatos y semántica de montos, fechas, estados y acciones.

## Verificación

- Tests RED/GREEN de cursores, aislamiento de tenant, límites, KPIs y acciones
  de tabla.
- Pruebas de componente para los breakpoints y el menú de Reservas.
- Playwright a 375, 768, 1024 y 1280 px sobre cada ruta con tabla, con datos
  largos y todas las acciones disponibles.
- `npm test`, tests de integración PostgreSQL, `npm run typecheck`, lint y
  build de producción. Se compararán los chunks antes/después para las rutas
  calendario y booking.

## Fuera de alcance

- Virtualización; se reconsidera sólo después de paginar y medir.
- Cambiar el diseño de producto o los procesos de pago.
- Migraciones de datos y nuevas dependencias de observabilidad externas.
