# Auditoría de cumplimiento — goal activo

2026-08-31. Baseline inspeccionado: `602009e69a67ba969d125df52311682662aa4bbe`;
N1 corregido en `a3a9737223d304b844d2a68ed214c24bdbe1375d`. Objetivo completo:
implementar el MVP aprobado del spec/plan, no sólo cerrar una lista de review.
La lectura íntegra del spec830líneas y plan287líneas contradice el cierre previo
porque faltan G1/G2. No se marca el goal logrado.

## Hallazgos actuales y evidencia

| Requisito | Fuente y evidencia actual | Estado |
| --- | --- | --- |
| N1: identidad de etiqueta durante respuesta pendiente | `analytics-option-picker.tsx:34`; consumidores reales en `analytics-controls.test.tsx` service/promotion; RED2fallos4.75s por NombreA conIDB, GREEN30/30controles/dashboard/links8.48s; typecheck/lint0; reviewer4 PASS | Corregido |
| G1: editar etiqueta visible actual de enlace | Spec§6/planTask2; commit `6b07579576cbc95d0cc41e0eb3c8bfa05eb9e7d9` agrega acción protegida owner/admin y edición inline, incluida etiqueta de enlace archivado. Verificación propia controles/acciones/enlaces24/24 en7.98s, DB19/19 en4.16s ytypecheck0; snapshots de enlaces/sesiones/intentos/eventos/Booking/agregados sólo cambian `campaignName`. Review independiente exacta del diff7archivos: PASS spec/calidad, sin hallazgos accionables | Implementado y revisado |
| G2: desgloses de profesional/pago/errores | Spec§7.3 y§4; `report-types.ts`/`funnel.ts`/`reports.ts`/dashboard no exponen distribuciones propias. Eventos capturados e hitos genéricos no cumplen la presentación | Falta implementación; precisión de contrato propuesta |
| No IA,13meses,recuperación comercial ni activación productiva en el MVP | Spec§1/§11 y GlobalConstraints del plan los excluyen explícitamente; no son funcionalidades implícitas de esta continuación | Exclusión aprobada preservada |

## Evidencia existente que no se convierte en una prueba de completitud

El checkpoint de código `d8f38f8229c153c6838f00789dd36f09fdaa903d` tiene fullunit
3895pass+1skip,477integración y9E2E sintéticos, además de build/typecheck/lint;
comandos/salidas exactas están en `owner-analytics.md` y logs archivados. Las
revisiones sobre esa rama no detectaron G1/G2. Por tanto ni los checks verdes ni
los checkboxes del plan prueban por sí solos que todos los requisitos existan.

En esta auditoría se inspeccionaron además las aserciones actuales de
`analytics-funnel.test.ts` y `analytics-daily-metrics.test.ts`: los seis ejemplos
numéricos obligatorios están cubiertos (4/10vs2/3;4+4+2;10/92;1conversión/2Bookings;
sininterés no1/0; A→B sin unirtrayectorias). `policy.ts` conserva límites exactos
24h/90d/180d,20eventos16KiB,200/stream,10/30por minuto,100cola,5sflush,2retries,
5minTTL,1000lote/10000invocación/12hbacklog. El workflow de mantenimiento continúa
opt-in, y el test del contrato CI ejecuta su provisionamiento aislado de Redis.
Esto acredita esos contratos inspeccionados, no una nueva corrida full ni CI
remoto, producción, privacidad legal o capacidad diaria real.

## Matriz de evidencia inspeccionada en esta continuación

Esta matriz distingue aserciones leídas de ejecución nueva. No asigna PASS global
a un requisito porque el nombre de un test lo mencione. Los archivos están bajo
`tests/`; la matriz final deberá incluir la verificación de G1/G2 y el resto de
fronteras antes de cerrar el goal.

| Contrato del spec | Aserciones inspeccionadas | Alcance/límite |
| --- | --- | --- |
| §10, fixtures1–3: poblaciones y proporciones | `unit/analytics-daily-metrics.test.ts`: 4/10,2/3,3/10 y partición4+4+2; `ratio(10,92)` y denominador0→null | Contratos puros; no acredita UI G2 |
| §10, fixtures4–6: eventos/reservas/servicios | `unit/analytics-funnel.test.ts`: 30eventos+2Bookings→1conversión/2reservas; sininterés conserva conversión; A→B conserva máximo de A pero no camino completo de B | Aserciones sobre proyección, sin multiplicación por join |
| Ventana, pasos opcionales y contexto | `unit/analytics-funnel.test.ts`: borde inferior inclusivo/deadline exclusivo/tenant ajeno; falta de profesional; cambios de fecha/profesional/pago; promoción rechazada no invalida economía sin cambio | La exposición de elección explícita/pantalla/método sigue siendo G2 |
| Consentimiento tardío, modalidad y login | `unit/analytics-wizard.test.tsx`: opt-in tras abrir tarjeta→partial sin interés reconstruido; anyone sólo tras clic; restore conserva intento/revisión sin eventos duplicados; selección B con hora perdida mantiene Booking y camino incompleto | Wizard/store/reductor reales; pasos fecha/hora/customer y pago mockeados; no sustituye E2E público |
| DAL autorizado, alcance y datos mínimos | `integration/analytics-report-isolation.test.ts`: rechaza tenant cliente/filtro ajeno/intersección/rolstaff/sinusuario; excluye IDs/secretos del DTO; separa completos/parciales maduros/en curso bajo canal/enlace | Prueba PostgreSQL existente; rerun integrado final pendiente |
| Corte, zonas y comparación | Mismo archivo: fuentes futuras excluidas; cohortes UTC/Santiago permanecen congeladas; 28d frente2d→delta null, coberturas iguales→delta50pp | No representa seguimiento equivalente de estados actuales de Booking |
| Publicación atómica | `integration/analytics-rollups.test.ts`: 3marcadores; revisiones concurrentes homogéneas; fallo inyectado trasdelete restaura publicación; claves desaparecidas eliminadas; DST sin duplicar/omitir | Prueba con PostgreSQL y fallos sintéticos, no producción |
| Retención y continuidad | `integration/analytics-retention.test.ts`: 10000filas máximo y continuación idempotente; alerta/pausa12h; snapshot reservado/Booking conservada; freeze antespurga; fallo de agregado no prolonga crudo; borrado tenant sin huérfanos | Capacidad productiva y alertas externas siguen siendo gate operativo |

Pendiente de completar en el cierre: matriz detallada de consentimiento/transportes,
ingesta/orígenes/rate limits, snapshot/idempotencia, pagos autoritativos, navegación,
estados de error y QA visual/accesible. Existe evidencia histórica para esas áreas;
no se declara nueva verificación aquí sin leer y ejecutar las fronteras pertinentes.

## Trabajo para demostrar el final

1. G1 completado/revisado en `6b07579576cbc95d0cc41e0eb3c8bfa05eb9e7d9`, con
   UI+acción protegida y prueba DB de identidad/atribución/histórico intactos.
2. Aprobar la precisión de G2, implementar su reductor/lectura acotada/presentación
   y verificar las fronteras descritas en el documento de diseño adicional.
3. Reconciliar requisito por requisito §10 y las tareas contra artefactos y
   aserciones reales; ejecutar el cierre integrado sobre el código final, no
   reutilizar una corrida anterior como si incluyera cambios posteriores.
4. Actualizar spec/plan/runbook que aún dicen «no iniciada» o «todo completado»
   cuando esos estados son históricos. Conservar decisiones/evidencia anterior.
5. Mantener separados los gates de activación: CI remoto autorizado, migración,
   proxy/orígenes, política/smallcells, infraestructura/capacidad, alertas y piloto.
   Nada de ello se activa para fabricar checks verdes.

La continuación anterior fue progreso real, no un bloqueo repetido. Esta
continuación corrige N1 e implementa G1 con validación focal; G2 está pendiente de definición
aprobada. Goal activo; no hay condición para marcarlo completo ni blocked ahora.
