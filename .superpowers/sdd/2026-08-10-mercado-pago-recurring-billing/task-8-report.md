# Task 8 report — Administración de facturación recurrente

## Implementado

- Acciones exclusivas de platform admin para configurar plan mensual, trial, gracia y rollout.
- Exenciones auditadas con fecha futura y motivo obligatorio; retiro local explícito sin cobro ni checkout.
- Reconciliación manual mediante el servicio autoritativo existente, sin aceptar estados arbitrarios del formulario.
- Actualizaciones locales y bitácora dentro de una misma transacción con CAS por `updatedAt`.
- Snapshot de `priceMonthly` al asignar plan y sincronización atómica de `Business.planId`.
- Guardas para no cambiar el plan detrás de una autorización externa ni simular una exención mientras esa autorización aún puede cobrar.
- Panel admin sanitario con estado, entorno, trial, exención, mora, próximo cobro, cancelación y última reconciliación; nunca muestra IDs externos.
- Confirmaciones explícitas para rollout, exención, retiro, reconciliación, suspensión, mora y cancelación.

## TDD

### RED

`npm test -- src/server/actions/admin-subscriptions.test.ts`

- 11/11 fallaron inicialmente porque `adminSetComplimentaryPeriod`, `adminClearComplimentaryPeriod`, `adminConfigureBilling` y `adminReconcileSubscription` aún no existían.

### GREEN

`npm test -- src/server/actions/admin-subscriptions.test.ts tests/unit/admin-actions.test.ts tests/unit/admin-business-detail-page.test.tsx`

- 32/32 pasaron.

## Verificación

- `npm run typecheck`: PASS.
- `npm run lint -- --quiet`: PASS.
- `npm run build` cargando las variables locales existentes sin imprimir valores: PASS; 48 páginas generadas y ruta admin compilada.
- `npm test -- --exclude '**/*.integration.test.ts'`: 2.861/2.862 pasaron; `tests/unit/billing-page.test.tsx` agotó 5 s sólo bajo la carga paralela completa.
- `npm test -- tests/unit/billing-page.test.tsx`: PASS 1/1 en 2.51 s, confirmando timeout de carga y no regresión.
- `npm test` también confirmó 319 archivos/2.860 pruebas antes de detenerse por tres suites PostgreSQL que exigen `TEST_DATABASE_URL`; no se usó una URL no local por seguridad.
- `git diff --check`: PASS.

Advertencias observadas y preexistentes: `DEP0205`, `localStorage` experimental y convención `middleware` deprecada en Next 16.

## Archivos

- `src/server/actions/admin.ts`
- `src/server/actions/admin-subscriptions.test.ts`
- `src/app/admin/businesses/[businessId]/page.tsx`
- `src/app/admin/businesses/[businessId]/admin-actions.tsx`
- `src/app/admin/businesses/[businessId]/admin-subscription-controls.tsx`
- `tests/unit/admin-actions.test.ts` (mocks actualizados para la cola de notificaciones introducida previamente)
- `tests/unit/admin-business-detail-page.test.tsx` (mock del nuevo control cliente)

## Autorevisión

- No se llama a Mercado Pago al habilitar rollout ni al retirar exención.
- Ninguna acción acepta estado, ID externo o monto desde el cliente.
- La reconciliación usa el ID local resuelto server-side y el mismo flujo autoritativo existente.
- Las acciones autorizan antes de leer o mutar datos.
- Sin gaps conocidos dentro del alcance de Task 8.

## Fix round 1

- Retirar una exención vigente ahora usa `admin_clear_complimentary` en la máquina transaccional: inicia el trial completo desde el instante de retiro, limpia mora/suspensión y sincroniza `Business.subscriptionStatus`/`trialEndsAt`. Rechaza retiros tardíos para no regalar un trial retroactivo. Exenciones cortas y largas tienen regresión unitaria y PostgreSQL.
- Asignar una exención también pasa por la máquina transaccional y recupera acceso inmediatamente; no espera al cron diario. Conserva la guarda que prohíbe eximir una autorización externa todavía cobrable.
- La reconciliación manual persiste primero un request auditado en una transacción corta, realiza la red fuera de transacción y persiste outcome success/failure enlazado por el ID del request. Un fallo del audit inicial impide cualquier llamada al proveedor; errores del proveedor dejan request y outcome sanitario atribuibles.
- La UI envía una fecha civil `YYYY-MM-DD`; el servidor valida fecha y zona IANA del negocio, exige un día local estrictamente futuro y calcula el fin del día como el siguiente midnight local menos 1 ms usando `date-fns-tz`. Regresiones Chile verifican UTC-3 de verano y UTC-4 de invierno.
- RED: 8 fallos focalizados antes de implementar (servicio de clear ausente, conversión UTC incorrecta y audit posterior a red).
- GREEN final: focalizados 74/74; PostgreSQL 16 temporal fresh con 45/45 migraciones y `transition.integration` 27/27; typecheck, eslint quiet, build Next 16 de 48 rutas y `git diff --check` pasan.
