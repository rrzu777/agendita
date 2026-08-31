# Owner analytics: handoff operativo

Estado: implementación local, captura y mantenimiento productivos **no activados**. Este documento no autoriza migración, deploy, push, PR, cron, comunicaciones ni pruebas con cuentas/datos reales. Retención de 13 meses e IA semanal requieren decisiones separadas; no están implementadas. La revisión independiente final de rama pertenece al controller y permanece pendiente hasta su cierre explícito.

## Qué mide y qué no

Sesiones e intentos seudónimos opt-in, no personas únicas ni leads. Las entradas completas y parciales son poblaciones separadas. Conversión significa Booking creada dentro de `[attemptStartedAt, conversionDeadlineAt)` de 24 horas; no pago, asistencia ni evento visual. Los estados transaccionales/canjes se consultan por separado. Los numeradores son subconjuntos de sus denominadores; sumar contadores compatibles y dividir, nunca promediar porcentajes diarios. Los granos total/canal/enlace/servicio son independientes; no sumar servicios ni reconstruir cruces históricos ausentes.

La fuente conserva zona de negocio congelada por cohorte. Un cambio de zona no mueve la historia; la madurez requiere fin del día local +24 horas +1 hora de conciliación, respetando DST. Recientes son provisionales y no entran en el denominador maduro. Error/no disponible/captura deshabilitada no equivalen a cero observado. Sólo owner/admin pueden leer y mutar, con controles independientes en página, DAL y acción y negocio derivado de sesión.

## Gates antes de cualquier piloto

1. Autorización explícita para el entorno y el SHA exacto; revisión final de toda la rama, CI real y revisión de migración sobre copia representativa.
2. Decisión de privacidad: datos seudónimos vinculables a Booking, consentimiento opcional no preseleccionado y no condicionado a reservar; aviso de 90 días más tolerancia de borrado; política de eliminación/small cells. Este MVP owner-only no aplica supresión de celdas pequeñas y no promete anonimización.
3. Redis distribuido real, TLS/proxy/orígenes configurados verificados y presupuestos positivos medidos. Verificar en el despliegue que Origin, Host y `request.url` canónico coinciden; localhost E2E no prueba esta compatibilidad en producción. Con mismatch, conservar rechazo fail-closed, no habilitar `trustHostHeader` ni falsificar headers para hacer pasar QA. Sin fallback en memoria, incluso en desarrollo/E2E. HMAC específico de analytics de al menos 32 bytes, distinto de las credenciales de otros sistemas, almacenado como secreto server-only.
4. Demostrar drenaje sostenible en infraestructura representativa con datos retenidos, contención y carga Booking concurrente; alertas operadas, backlog controlado y continuaciones. El microbenchmark local inferior no certifica capacidad diaria.
5. Validación browser/device y del flujo autenticado real por responsable autorizado. Las pruebas de este handoff usan identidades sintéticas mediante bypass E2E existente, nunca Supabase real, OTP, cobros, R2, email ni push. Los gates previos de esos productos no cambian.

## Orden de despliegue propuesto (no ejecutado)

1. Mantener `OWNER_ANALYTICS_ENABLED=false` y scheduler sin activar. Respaldar/verificar restauración y revisar locks/duración de la migración aditiva `20260831000000_owner_analytics`: seis tablas, enums/índices/CHECK/FK y columnas snapshot nullable en Booking. No reescribir ni borrar datos transaccionales.
2. Aplicar la migración con autorización al destino comprobado y generar el cliente Prisma correspondiente; desplegar aplicación con captura apagada. `npm run build` genera cliente y compila; **no usar `vercel-build` como QA**, pues ejecuta migraciones.
3. Verificar mantenimiento autenticado independiente, planes/índices reales, retención y alertas antes de habilitar captura. Históricos deben seguir disponibles con captura apagada.
4. Configurar allowlist exacta `OWNER_ANALYTICS_BUSINESS_IDS` (sin wildcard), secreto, presupuesto global/tenant/drain y Redis HTTPS; sólo tras aprobación específica poner `OWNER_ANALYTICS_PRIVACY_APPROVED` y `OWNER_ANALYTICS_PILOT_APPROVED` a `true`. Son attestations, no evidencia.
5. Antes de reactivar el gate global, inventariar y cerrar períodos previamente abiertos: con configuración válida pueden reanudar captura inmediatamente al reactivar el gate. Dentro de la ventana autorizada, verificar todos los períodos cerrados, habilitar `OWNER_ANALYTICS_ENABLED=true` con allowlist/configuración válidas y entonces abrir sólo los períodos previstos mediante acción owner/admin. Este orden es obligatorio: `setAnalyticsCollectionEnabled(true)` llama a `getAnalyticsCaptureConfig`, que exige el gate global encendido (`src/server/actions/analytics.ts`, `src/lib/analytics/budget.ts`). La apertura reserva una unidad y falla cerrada si Redis falla. Registrar SHA, configuración sin valores secretos, hora y responsable; revisar tasas/errores/antigüedad del vencido y impacto Booking antes de ampliar.

Configuración válida exige `tenant <= global < verified drain`, enteros positivos <= int32. Los presupuestos Redis usan **día UTC**, no día local del negocio. Session/attempt bootstrap nuevo cuesta una unidad cada uno; replay de bootstrap no reserva de nuevo. Cada lote reserva por eventos y los replays también gastan conservadoramente; gap-only cuesta mínimo una unidad sin fila de evento. Reservas gastadas sin escritura no se recuperan automáticamente. El presupuesto no mide únicamente filas.

## Captura y consentimiento

Antes de aceptar no se crea identificador, bootstrap, evento ni cola analytics. La preferencia versionada por negocio/origen dura 180 días. Web Locks controla un escritor; sin API/lock o ante fallos de almacenamiento se deja de capturar sin bloquear Booking. Retirar consentimiento borra identificadores locales y cancela envíos; no borra retroactivamente lo ya recibido. Pérdida local conserva sólo token firmado en memoria mientras sea válido y consentido, sin revisión inventada.

Máximos: sesión 24h; intento 24h desde su propio inicio, independiente del vencimiento posterior de la sesión; 20 eventos/16 KiB por lote, 200 por stream; 10 bootstraps/min/IP+negocio y 30 lotes/min/stream firmado. Cola 100, flush 5s/cambio visibilidad, dos reintentos con backoff, descarte tras 5 minutos. IDs/secuencias se mantienen tras respuesta perdida. Tokens no son permisos para reservar/leer; Booking valida firma localmente y conserva el snapshot del primer create, sin locks/consultas/red analytics en su transacción.

No persistir en analytics/logs nombres, email, teléfono, dirección, notas, customerId, IP, UA completo, URL/referrer completos, errores libres, códigos promocionales crudos ni credenciales. UA bot/probe y miembros del negocio objetivo se excluyen; headers internos o forwarded-host no sustituyen el origen canónico. El dashboard sólo recibe booleanos/DTO permitido, no secretos ni eventos crudos.

## Retención y operación con captura apagada

Raw expira 90 días desde inicio de sesión; el vencimiento se copia a hijos/snapshot, nunca se recalcula desde el evento. Agregados expiran fin real del día local +90 días. Antes de borrar fuente se congela publicación cerrada válida o se registra marcador fallido congelado; un fallo de agregación no extiende retención. Publicación atómica/repeatable-read con revisión y lock por tenant no reemplaza historia válida por un cero de recalculo parcial.

`POST /api/cron/owner-analytics` requiere Bearer del `CRON_SECRET` existente, `Cache-Control: no-store`; sólo admite cursor acotado generado por el job. No confundir el HMAC de analytics con el secreto de cron. El workflow separado `.github/workflows/owner-analytics.yml` sólo corre si la **variable de repositorio** `OWNER_ANALYTICS_MAINTENANCE_ENABLED == 'true'`. URL en variable de repositorio `OWNER_ANALYTICS_CRON_URL` (HTTPS, sin query/hash); añadir variables de app no crea/activa scheduler. Horario configurado `17 * * * *`, pero no activado por esta entrega.

Lotes 1.000; máximo 10.000 **filas reales** por invocación, incluyendo snapshots, hijos y daily rows. Reserva primer lote para limpiar snapshots; luego eventos→intentos→sesiones sin cascadas ocultas. Sólo se anulan conjuntamente columnas analytics del Booking, jamás se borra Booking/pagos/ledger. Deadline cooperativo 40s entre unidades de trabajo; transacción ya en vuelo puede tardar hasta 15s más espera de 5s. Hasta 10 cohortes por llamada; el cursor continúa idempotentemente. Driver con máximo 120 solicitudes/480s por defecto (600s máximo), curl 10s conexión/60s total y workflow 10min; no SLA de tiempo real.

Observar `errors`, `deleted`, `published`, `hasMore`, `nextCursor`, `backlog.overdueMs`, `dangerous`, `beyondTolerance`, duración y estado driver. A 12h del vencido más antiguo se cierran períodos (`backlog`), se alerta por categoría cerrada y se continúa drenando; a 24h se excede la tolerancia. No reapertura automática. Configurar receptor/on-call y probar alertas antes del piloto; su entrega real no está verificada. `hasMore` o error no significa éxito; continuar bajo límites y escalar si el driver no drena.

Límites de lectura: páginas raw de 50; 201 eventos/1001 Bookings sentinela por intento; >10.000 fuentes/cohorte o >20.000 celdas aborta proyección. Informe >20.000 celdas exige período menor; discovery reciente máximo 100 grupos por entidad. Cola aprobación top1001 es cota inferior. Estos límites y el lock de escritura por negocio son costes conservadores del piloto; medir contención y candidate discovery con volumen retenido real.

## Kill switch y rollback

`OWNER_ANALYTICS_ENABLED=false` o configuración inválida frena bootstrap/eventos **y nuevos snapshots**, incluso con intento firmado en vuelo; Booking continúa. Cerrar período owner/admin frena nueva captura del negocio pero un token ya emitido puede seguir atribuyendo Booking mientras la configuración global sea válida: la validación local no consulta período. Rotar el secreto invalida inmediatamente firmas antiguas: una sola clave vigente, sin gracia; se pierde atribución en vuelo, no la reserva.

Rollback conservador: desactivar captura, cerrar períodos, mantener mantenimiento/alertas activo hasta cumplir retención, restaurar versión de app compatible con migración aditiva si procede. No revertir migration a ciegas, no borrar hechos de Booking/pagos/canjes ni reinterpretar adquisiciones previas; archivar enlaces, no editarlos retroactivamente. Mantener agregados ya publicados hasta su vencimiento. Si rollback elimina el ejecutable de mantenimiento, acordar un proceso compatible que siga purgando: apagar captura no suspende obligaciones de retención.

## Cinco decisiones registradas (orden real)

| Ruling | Motivo | Coste si es incorrecta |
| --- | --- | --- |
| Control opcional `captureGap:true`, ack durable `captureGapRecorded`; conserva firma pero omite revisión local perdida | Un hueco final de secuencia es invisible; quitar credencial perdería conversiones válidas | Compatibilidad aditiva y pruebas adicionales de ingesta; gap-only consume presupuesto sin evento |
| Adapter typed mínimo para `anyone` en team-slots, razones mixtas `unknown`, legacy intacto | La unión del equipo usa otro seam y necesita diagnóstico comprobable | Regresión potencial en unión/disponibilidad; requiere cobertura legacy+anyone sin cambiar agenda |
| Tras Booking, no rearmar por retry/visibilidad; nueva selección explícita rearma intento parcial preservando stream previo | Guard hasta desmontar perdería otra reserva iniciada con Atrás; rearme pasivo inflaría intentos | Dividir o perder intentos en transiciones; exige pruebas de ambos lados sin tocar idempotencia |
| Prop UI opcional `periodMode` validado por página, sin cambiar DTO/DAL | DTO normaliza fechas y pierde preset/rango; inferirlo cambia recientes al paginar | Desincronización navegación/consulta o rehacer contrato UI; cobertura default28,7/28/90 y rango |
| `logging.serverFunctions:false` en configuración Next | Next16 imprime argumentos de Server Functions en desarrollo, incluido token analytics recibido por Booking | Se pierde el log automático de nombre/argumentos/duración de esas funciones en dev; requests/warnings/errores conservan sus defaults. No afecta producción ni la ejecución de acciones |

## Checkpoints y evidencia

Base de rama: `c5ea7146e936ab41a8df60e79c3fbd34a84cdf1a`; planificación `5dddecc`. T1 `1b9cc04`→`1a8920b`; T2 `f62132e`→`4e9b47e`; T3 `afcf728`→`5ef75b6`; T4 `2e433af`→`94d85fc`; T5 `5d8182d`→`e39ecfe`→`3516dd1`→`8280aee`→`fb8eb82`. Task6 parte del SHA completo `fb8eb828eac4d76af2b2833d8ec83cd39b58a09e`.

Checkpoints finales completos: T1 `1a8920bedf9df02ae7d7a6cf8606419d2bb2b20f`; T2 `4e9b47ea0fc3b4011c447694b3c3e6d9f88dab59`; T3 `5ef75b6560c496e16025f7752904505bf1a9e534`; T4 `94d85fc3e6b7588dae56b499c608ff0fce59b1ac`; T5 `fb8eb828eac4d76af2b2833d8ec83cd39b58a09e`.

Proceso: Tasks1–4 y fix T5 round1 tienen RED/GREEN registrado. T5 rounds2/3 **no tienen RED funcional antes de implementación**; typecheck fallido no sustituye TDD. Se añadieron luego regresiones funcionales y E2E verdes. Task6 reproduce primero la fuga del stub `scrollIntoView` y restaura descriptor en `finally`, con comprobación después de cada test. No reconstruir evidencia RED retrospectiva.

### Verificación local Task6

Corrida de2026-08-31, Node22, un worker. Resultados exactos, sin reconstruir una «suite global verde» que no ocurrió:

| Verificación | Resultado observado |
| --- | --- |
| Unit completa, ejecutada una vez | 424archivos:420pass/4fail;3860pass/9fail/1skip,686.61s |
| Reproducción focal de los9fallos | 4archivos,26pass/9fail,3.89s |
| Misma focal en base original, mismo env3555 | 28pass/7fail,4.22s; con dominios omitidos35/35pass,3.12s |
| Focal final corregida | 7archivos43/43pass,8.04s |
| Integración completa PostgreSQL | 70archivos:69pass/1fail;457pass/1fail,132.81s |
| Focal final retención+rollups | 2archivos14/14pass,11.77s |
| E2E collector/booking público | 5/5pass,23.5s; luego2reservas para capturas corregidas2/2pass,15.6s |
| E2E dashboard owner/staff/móvil+teclado | 3/3pass,12.4s |
| Build sintético, captura apagada | exit0; cliente Prisma5.22 generado909ms; compilación10.7s, TypeScript22.2s,59/59páginas354ms (sin cron/migrate deploy) |
| Typecheck separado | exit0,25.43s |
| Lint focal de toda rama | 101archivos tracked TS/TSX/JS/MJS +4nuevos harness/config/spec, sin errores/warnings |
| Prisma validate/status | válido;55migraciones,DB al día; cliente físico en este worktree |
| Shell/diff | `bash -n` del driver y `git diff --check`, exit0 |

Unit:7fallos eran un error de entorno QA (APP_DOMAIN/NEXT_PUBLIC_APP_DOMAIN3555 frente a expectativas localhost3000); se reprodujeron también en código archivado de la base original y desaparecieron al omitir esos overrides. No se cambió calendario. Los otros2 eran registros de pruebas omitidos en Tasks4/5: navegación pasó de15a16 destinos y el nuevo adapter público de disponibilidad necesitaba su declaración explícita en el audit de acciones. Se verificó que comparte rate-limit y validación de negocio/servicio/profesional; se actualizaron sólo los tests sin debilitar el audit. La focal final incluye esos4archivos y analytics-navigation/availability. El skip preexistente es payment-qa-network-deny. Se conservaron logs de errores simulados y warning React `replace=false`; no apareció el warning experimental localStorage de Node26 bajo Node22.

Integración: el único fallo fue la aserción nueva de la medición Task6 que exigía tabla daily vacía cuando sólo6de30celdas vencían. Reproducción focal1fail/6filtrados,7.28s; corregida para exigir6borradas y cero vencidas restantes, conservando cohortes vigentes/publicación del mismo job. No se cambió mantenimiento. Toda la matriz original ejecutó las siete suites analytics (schema, ingest, budget, booking-snapshot, rollups, retention, report-isolation), carreras Booking/pagos/promociones y aislamiento. No quedan fallos conocidos tras correcciones focales; no se repitieron las matrices completas.

QA visual: dashboard desktop y375px revisados; público desktop/móvil confirma Booking y snapshot firmado, campaña preservada, guestdeny sin identificadores/requests, bot y miembro403, captura común200; móvil conserva draft offline y reserva tras recuperar conexión aunque fallen envíos de eventos. Root in-app comprobó selected09:00 estable al conceder/retirar consentimiento: denial0/0/0; grant1session/1partialattempt/3events; withdrawal estable y0Bookings (sin auth/contacto). La pérdida de hora sí tuvo RED funcional antes del fix StepTime; cambio de contexto y slot retirado siguen invalidando. El stub tuvo RED descriptor antes del restore. Logging tuvo RED del guard en salida real y GREEN después de `logging.serverFunctions:false`; warnings de email omitido por falta de clave y requests siguieron visibles. No probaron Supabase/login real ni servicios externos.

Dos problemas del fixture público se corrigieron sin cambiar producción: subdominio de IPv4 numérico no es URL válida; Next16dev canoniza request.url a localhost aunque escuche en127. El fixture usa path-hostedlocalhost3555; sólo DB/Redis/listener usan127. Se retiró instrumentación diagnóstica. Guard de salida del launcher aborta si reaparece registro automático de argumentos; trace público apagado para no persistir credenciales sintéticas. Capturas finales en `test-results/owner-analytics*`; reporte/logs detallados scratch se archivarán por controller. Esta sección conserva evidencia mínima sin depender de scratch.

Entorno medido: Node22.22.3; Next16.3.2; Prisma5.22.0; PostgreSQL16.14 aarch64 `postgres:16-alpine`, contenedor dedicado `agendita-owner-analytics-test-01a055ad`, puerto loopback55439, límite1CPU/512MiB, shared_buffers32MB, max_connections30. Host Apple M1 8CPU/16GiB compartido con otras cargas no interrumpidas. No extrapolar a hardware/latencia productivos.

### Mediciones locales y coste de transporte

Collector real:2bootstraprows en1034.244ms;3lotes de20eventos aceptados en841.417ms (compilación fría),251.732ms y251.235ms;60filas comprobadas en PostgreSQL. Control gap-only101.246ms (respuesta+consulta de verificación),0eventrows.63unidades reservadas=60eventos+2bootstraps+1gap, excluyendo apertura de período fixture. Transporte: Next→HTTPSloopback3556→adapter REST de prueba→`redis-cli`→Redis7.0.11 Unix efímero/Lua real→PostgreSQL. El subprocess síncrono añade coste artificial; no es Upstash hospedado. Certificado temporal confiado sólo por proceso Next, sin desactivar TLS ni alterar trust global. Los tests Redis de integración ejercitan Lua real pero mockean REST, frontera distinta.

Drenaje real PostgreSQL:12064unidades fuente={61sessions,1attempt,12001events,1snapshotBooking};10000limpiadas/borradas en472.468ms y2064en314.789ms, Booking preservada. Otra muestra limpia1snapshot y congela44celdas en142.436ms. Daily:30celdas antes,6elegibles/6borradas/cero vencidas restantes;10cohortes publicadas,30celdas después,138.286ms. La llamada incluye publicación/reemplazo de celdas, no sólo DELETE; `published` cuenta cohortes, no filas. Los días de período sin tráfico también consumen almacenamiento. Límites de recursos declarados son configuración del entorno, no perfil continuo de CPU/RSS ni medición de picos.

### Reproducción segura local

Sólo dentro del worktree aislado sin archivos `.env*` activos; PostgreSQL exclusivo ya migrado y puertos3555/3556 libres. Requiere Node22, dependencias instaladas propias, Redis/redis-cli, openssl y Chromium Playwright. No usar el config Playwright general que reutiliza localhost3000. La función siguiente no hereda claves externas:

```sh
qa() {
  env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin HOME="$HOME" \
    DATABASE_URL=postgresql://analytics:analytics@127.0.0.1:55439/agendita_owner_analytics_test \
    DIRECT_URL=postgresql://analytics:analytics@127.0.0.1:55439/agendita_owner_analytics_test \
    NEXT_PUBLIC_SUPABASE_URL=https://analytics-e2e.invalid \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=analytics-e2e-anon-key \
    PAYMENT_PROVIDER=manual OWNER_ANALYTICS_ENABLED=false "$@"
}
qa env NODE_OPTIONS=--trace-warnings npm run test:unit -- --maxWorkers=1 --testTimeout=60000
qa env OWNER_ANALYTICS_MEASURE_LOCAL=true npm run test:integration -- --maxWorkers=1 --testTimeout=60000
qa npx playwright test --config playwright.owner-analytics-public.config.ts
qa npx playwright test --config playwright.owner-analytics.config.ts
qa npm run typecheck
qa npx prisma validate
qa npx prisma migrate status
qa env NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 APP_DOMAIN=localhost:3555 \
  NEXT_PUBLIC_APP_DOMAIN=localhost:3555 UPSTASH_REDIS_REST_URL=https://redis.invalid \
  UPSTASH_REDIS_REST_TOKEN=synthetic-build-only npm run build
```

Los comandos son receta de reproducción, no una nueva autorización para ejecutarlos fuera de esa base. La unit completa registrada añadió por error los dos dominios3555: su salida exacta figura arriba; la receta ya omite ese error. Lint se limita a TS/TSX/JS/MJS afectados desde la base original más nuevos harness/config; `git diff --check` y `bash -n scripts/run-owner-analytics-cron.sh` completan el chequeo estático, sin ejecutar cron real.

### Método de presupuesto del piloto

Medir requests recibidos/aceptados, sesiones+intentos, eventos reales, snapshots limpiados y celdas publicadas/purgadas; registrar tamaño de muestra, elapsed, replays/gap controls, latencia/red, memoria/CPU/locks y expiración oldest. Calcular demanda conservadora de filas por cohorte incluyendo cardinalidad de granos y publicación/reemplazos, no sólo eventos. Reservar holgura para reintentos, controles, bursts, otras tareas y caída/recovery del scheduler. Comparar drenaje sostenido y recuperación del backlog con carga Booking simultánea y volumen de 90 días. Sólo entonces fijar presupuesto global/negocio y `VERIFIED_DAILY_DRAIN`; no se recomienda ningún número diario certificado a partir de esta corrida local. Los valores 20000/10000/40000 del harness son únicamente gates sintéticos de pruebas, no aprobación ni capacidad recomendada.
