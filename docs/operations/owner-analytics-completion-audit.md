# Auditoría de cumplimiento — goal activo

2026-08-31. Baseline inspeccionado: `602009e69a67ba969d125df52311682662aa4bbe`;
N1 corregido en `a3a9737223d304b844d2a68ed214c24bdbe1375d`. Objetivo completo:
implementar el MVP aprobado del spec/plan, no sólo cerrar una lista de review.
La lectura íntegra del spec830líneas y plan287líneas contradice el cierre previo
porque faltaban G1/G2. G1 ya se cerró como se detalla abajo; G2 sigue pendiente.
No se marca el goal logrado.

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

### Continuación siguiente: consentimiento, captura y aislamiento

Baseline `f9eca68`, pruebas ampliadas en
`175179da4d3330cf55264a4437731ec6e22397be`. La continuación anterior fue progreso:
implementó G1 y corrigió el estado documental. La aprobación de G2 no ha llegado;
este trabajo completa evidencia existente sin introducir su contrato pendiente.

| Contrato | Fuente/aserciones inspeccionadas | Evidencia y límites |
| --- | --- | --- |
| Ausencia/rechazo/retirada del consentimiento | `unit/analytics-client-store.test.ts`: cero UUID/storage antesopt-in, scope negocio/origen, preferencia180d, retirada y falloatómico; `e2e/owner-analytics-public.spec.ts`: guest rechazado sinrequests y tres nuevos casos que completan Booking sinrespuesta/rechazo/retirada | Nuevos casos observan requests desdeantesclic, 1Booking guardada con los10camposanalyticsnull, precio10000/abono0 y sinidentidadsessionStorage. No implica borrar eventos legítimos previos a retirada |
| Transporte durable | `unit/analytics-client-transport.test.ts`: clavesreusadas,3envíosmáximos, reciboparcial,20eventos/16KiB, gap tras5min, noresurrección trasstop/retirada; reintento deparentvencido acotado | Store/transporte reales; fetch simulado en unit. PostgreSQL/HTTP se prueban porseparado, no atribuir a mocks prueba de entrega real |
| Payload cerrado y origen | `unit/analytics-ingest.test.ts`, `analytics-contracts.test.ts`, `analytics-public-context.test.ts`: bytesreales/chunkcancel,camposdesconocidos/PII,eventosautoritativosinventados,origencanónico,headersforjados,bot/member/config/12hbacklog | Unitfocal ejecutada; endpointsPOST reales en integración comprueban400/403/429/no-store y recibos |
| Ingesta serializada y límites | `integration/analytics-ingest.test.ts`: ID/sequenceconflict,200eventos bajo lotesconcurrentes, replayenlímite, IDsajenos, kill-switch, presupuesto y coberturacerrada; `analytics-schema.test.ts`: FKsesión/intento, all-or-none Booking, scope/replay/grainchecks | Cinco suites de integración finales53/53, no fullintegration global |
| Presupuesto distribuido | `unit/analytics-budget.test.ts` y `integration/analytics-budget.test.ts`: configcompleta, límitesfinitos, presupuesto<drenaje; EVALreal acepta5de20reservasconcurrentes sin cobrar rechazo, bootstrap10/batch30 | Redispropio porsocket sinTCP/persistencia; transporteUpstashunit simulado, no servicio real |
| Snapshot e idempotencia | `booking-snapshot.ts` verifica firma local fail-open; `bookings.ts` copia sólo enprimerinsert yreplayretornaantesheaders; tests snapshot y `booking-retry.integration.test.ts` | Primera atribución/revisión conservada anteotra credencial; metadatos inválidos no impidenBooking real; no nuevas sesionesanalytics ni modificación de importes |
| Navegación y estados visibles | `analytics-navigation.test.ts/.tsx`, `analytics-dashboard.test.tsx`; DAL `reports.ts:192–216` consulta Booking/PromotionRedemption separados | Roles/Más, acq/ref, ausencia≠cero, tablaequivalente, cortesypoblaciones inspeccionados. Estados/canjesactuales derivanDB, noelecciónvisual. No prueba nueva de todos los escenarios financieros ni QAvisualcompleta |

Se añadió una prueba de resultado que faltaba: los casos anteriores de opt-out
llegaban a selección/datos, pero no demostraban que la reserva terminase guardada.
Los dos E2E nuevos pasaron en su primera ejecución (2/2,13.1s): caracterización
del producto existente, no RED inventado ni fix de producto. Se reforzó la
observación de requests para incluir el propio clic de retirada; la suite pública
completa sobre esa versión pasó7/7 en25.6s, exit0, sin cambiar src/config/migraciones.

La integración encontró un defecto real del fixture de archivo de enlaces:
`createdAt` usaba NOW dePostgreSQL pero `archivedAt` era captureNow fijo12:00UTC.
A las12:01:06 UTC,53tests dieron52pass/1fail(8.63s), SQL23514 por creación posterior
aarchivo; reproducción focal12:02:26→1fail/33filtrados(1.36s). El test ahora crea
el enlace en captureNow−1s. Se mantienen CHECK y todas las aserciones de replay/
atribución; la suite seleccionada posterior pasó53/53(9.55s). No se cambia lógica
productiva para acomodar el test ni se llama «ruido» a ese fallo reproducible.

Comandos ejecutados con el prefijo limpio y DB exclusiva del runbook:

```sh
npm run test:unit -- tests/unit/analytics-client-store.test.ts tests/unit/analytics-client-transport.test.ts tests/unit/analytics-booking-snapshot.test.ts tests/unit/analytics-ingest.test.ts tests/unit/analytics-contracts.test.ts tests/unit/analytics-budget.test.ts tests/unit/analytics-public-context.test.ts tests/unit/analytics-navigation.test.ts tests/unit/analytics-navigation.test.tsx tests/unit/bookings-idempotency.test.ts --maxWorkers=1
npm run test:integration -- tests/integration/analytics-ingest.test.ts --maxWorkers=1 -t 'archiving a link' --silent
npm run test:integration -- tests/integration/analytics-schema.test.ts tests/integration/analytics-ingest.test.ts tests/integration/analytics-booking-snapshot.test.ts tests/integration/analytics-budget.test.ts tests/integration/booking-retry.integration.test.ts --maxWorkers=1 --testTimeout=60000 --silent
npx playwright test --config=playwright.owner-analytics-public.config.ts
npm run typecheck
npx eslint tests/e2e/owner-analytics-public.spec.ts tests/integration/analytics-ingest.test.ts
git diff --check
```

Unitfocal10archivos exit0; typecheck/lint/diffcheck finales exit0. La ejecución
focal `archiving a link` anterior al fix es RED, no un check verde. Los tests usan
authfixture/sandboxlocal; correos y proveedores reales siguen deshabilitados.
La revisión inicial de los dos archivos se realizó sobre ese checkpoint.

Review sobre `175179d`: los dos casos y el fixture son correctos, pero la matriz
requería además completar Booking sin responder al consentimiento y afirmar cero
requests antes del grant, no sólo después de vaciar el registro previo al retiro.
Se añadió `absent` (1/1 en8.2s) y la aserción previa al grant. Suite pública final
sobre ambas mejoras:8/8 en28.2s, exit0. No se modificó código productivo.
Commit final de las mejoras: `c6c2daf2a9dd7f021213c8880b6e14a1e9604665`.
Re-review `175179d..c6c2daf`: ambas observaciones ADDRESSED, PASS focal sin nueva
rotura identificada. Typecheck/lint de ambos archivos/diffcheck posteriores exit0.
La fixture pública quedó eliminada (count0) y sin listeners locales3555/3556;
la PostgreSQL exclusiva se conserva para continuar G2.

El cierre integral aún exige G2 y su validación end-to-end, la matriz final
conjunta y los límites operativos ya documentados. No repetir suites sin cambios
como sustituto de aprobar/implementar ese requisito pendiente.

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

Las dos continuaciones produjeron avances concretos: N1/G1 primero; después,
pruebas de Booking sin consentimiento, corrección del reloj del fixture y matriz
de evidencia ampliada. La misma aprobación pendiente de G2 se ha mantenido en
ambas. Sigue siendo un requisito sin implementar, no una exclusión nueva del MVP.
El goal permanece activo; no se declara logrado ni se reinician tareas cerradas.
