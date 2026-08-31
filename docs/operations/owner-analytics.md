# Owner analytics: handoff operativo

Estado vigente, 2026-08-31: **implementación todavía incompleta**. La auditoría posterior al cierre de review detectó dos requisitos omitidos. G1, editar etiquetas de campañas, ya está implementado y revisado en `6b07579`. Quedan G2, desgloses propios de profesional/pago/errores, y la validación conjunta final. N1 ya fue corregido en `a3a9737`. Ver `owner-analytics-completion-audit.md` para el seguimiento actual; los checkpoints inferiores son evidencia histórica, no una declaración de cumplimiento integral. Captura y mantenimiento productivos **no activados**. Este documento no autoriza migración, deploy, push, PR, cron, comunicaciones ni pruebas con cuentas/datos reales. Retención de 13 meses e IA semanal requieren decisiones separadas; no están implementadas.

## Qué mide y qué no

Sesiones e intentos seudónimos opt-in, no personas únicas ni leads. Las entradas completas y parciales son poblaciones separadas. Conversión significa Booking creada dentro de `[attemptStartedAt, conversionDeadlineAt)` de 24 horas; no pago, asistencia ni evento visual. Los estados transaccionales/canjes se consultan por separado. Los numeradores son subconjuntos de sus denominadores; sumar contadores compatibles y dividir, nunca promediar porcentajes diarios. Los granos total/canal/enlace/servicio son independientes; no sumar servicios ni reconstruir cruces históricos ausentes.

La recuperación de un bootstrap de intento comprometido puede usar su padre vencido sólo con el binding original y dentro del límite adicional autorizado (sexta Ruling); no crea intentos nuevos ni modifica permisos de eventos/Booking. El cliente persiste contador de envíos y backoff **antes** de POST, por lo que un crash antes del catch no reinicia el máximo inicial+2. El campo opcional mantiene compatibilidad con estado v1; sin persistencia no envía. Una credencial Booking aún válida se conserva mediante el fallback existente si falla storage.

La fuente conserva zona de negocio congelada por cohorte. Un cambio de zona no mueve la historia; la madurez requiere fin del día local +24 horas +1 hora de conciliación, respetando DST. Recientes son provisionales: sus intentos aún en curso no entran en denominadores maduros y sus resultados no se mezclan con la serie cerrada. Error/no disponible/captura deshabilitada no equivalen a cero observado. Sólo owner/admin pueden leer y mutar, con controles independientes en página, DAL y acción y negocio derivado de sesión.

## Gates antes de cualquier piloto

1. Autorización explícita para el entorno y el SHA exacto; aprobación scoped de los hallazgos de la revisión de rama ya realizada, CI real y revisión de migración sobre copia representativa.
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

## Ocho decisiones históricas registradas (orden real)

La octava decisión de aplazar N1 quedó superada por su corrección en `a3a9737`;
se conserva aquí para no borrar la justificación y el riesgo aceptados entonces.

| Ruling | Motivo | Coste si es incorrecta |
| --- | --- | --- |
| Control opcional `captureGap:true`, ack durable `captureGapRecorded`; conserva firma pero omite revisión local perdida | Un hueco final de secuencia es invisible; quitar credencial perdería conversiones válidas | Compatibilidad aditiva y pruebas adicionales de ingesta; gap-only consume presupuesto sin evento |
| Adapter typed mínimo para `anyone` en team-slots, razones mixtas `unknown`, legacy intacto | La unión del equipo usa otro seam y necesita diagnóstico comprobable | Regresión potencial en unión/disponibilidad; requiere cobertura legacy+anyone sin cambiar agenda |
| Tras Booking, no rearmar por retry/visibilidad; nueva selección explícita rearma intento parcial preservando stream previo | Guard hasta desmontar perdería otra reserva iniciada con Atrás; rearme pasivo inflaría intentos | Dividir o perder intentos en transiciones; exige pruebas de ambos lados sin tocar idempotencia |
| Prop UI opcional `periodMode` validado por página, sin cambiar DTO/DAL | DTO normaliza fechas y pierde preset/rango; inferirlo cambia recientes al paginar | Desincronización navegación/consulta o rehacer contrato UI; cobertura default28,7/28/90 y rango |
| `logging.serverFunctions:false` en configuración Next | Next16 imprime argumentos de Server Functions en desarrollo, incluido token analytics recibido por Booking | Se pierde el log automático de nombre/argumentos/duración de esas funciones en dev; requests/warnings/errores conservan sus defaults. No afecta producción ni la ejecución de acciones |
| Recuperar sólo intento ya existente con binding de padre vencido | Bootstrap del intento pudo hacer commit cerca del vencimiento de sesión y perder su respuesta | Si se implementa mal: reemisión indebida de credenciales y ampliación de autoridad temporal. Verificador dedicado exige firma/origen/negocio/claims DB, misma clave/sesión/entrada, inicio dentro de ventana original y deadline vivo; límite estricto `now < sessionExpiresAt+24h`. Mayor superficie de seguridad y regresiones necesarias. Nunca crea con padre vencido, amplía deadline ni relaja eventos/Booking; cliente conserva límites de retry/consentimiento |
| Opciones operativas owner/admin separadas de métricas y diagnóstico `not_queried` | Filtros/promoción necesitan opciones navegables, y no consultar crudo no demuestra purga | Si se implementa mal: consultas adicionales o desincronización UI/reporte/historia. Una consulta SQL de máximo101 filas sentinela (máximo100 identidades devueltas), sin lookup adicional de selección, por página/búsqueda; transacción read-only repeatable-read de5s. Fuera de página conserva ID actual con nombre no disponible explícito; carga/error propios y continuación/búsqueda. Sólo IDs/etiquetas tenant. Enlaces archivados/servicios históricos no implican elegibilidad de cupón; el nombre de promoción puede requerir cargar opciones. `not_queried` no reconstruye diagnósticos ausentes |
| Aplazar N1 explícitamente hasta antes del piloto, sin segunda fixwave | La re-review cerró todos los Important; el defecto restante sólo desincroniza una etiqueta y no altera ID enviado, cálculo ni autorización. No bloquea esta entrega local con captura apagada | Un nombre erróneo puede hacer interpretar mal el filtro o la promoción seleccionada y llevar a una asociación no pretendida. No se considera resuelto: requiere comprobar `selected.id === value` antes de usar la etiqueta y regresión con respuesta pendiente/cambio de selección |

## Superficie operativa disponible

En Métricas → Enlaces de adquisición, owner/admin puede editar la etiqueta actual
(1–80 caracteres) de un enlace propio, incluso archivado. Guardar conserva token,
canal, promoción, fechas, atribución y celdas históricas; no reactiva un archivado.
El registro y el reporte usan el nombre actual, sin versionado histórico de nombres.
Una escritura tenant+id y revalidación por guardado, límite de gestión30/min y
misma validación conservadora de texto que creación. Ediciones concurrentes:
último guardado exitoso, sin lock/versionado adicional.

En `/dashboard/metricas`, owner/admin dispone de presets7/28/90 y rango personalizado (inicio incluido, final excluido), un filtro a la vez (canal/enlace/servicio) y búsqueda/páginas de opciones. Cambiar filtro vuelve a página1; la navegación conserva modo/fechas y resincroniza los controles con la consulta del servidor. Las opciones no amplían el DTO estadístico: quedan separadas de los contadores. Una búsqueda fallida muestra error local, no ceros. Enlaces archivados y servicios eliminados con agregado aún retenido pueden seleccionarse para historia; las etiquetas eliminadas se indican explícitamente.

El bloque «Control de captura» opera `setAnalyticsCollectionEnabled`: «Cerrar captura» depende de `collectionOpen`, **no** de que `capture.enabled` sea true. Así puede cerrarse un período viejo con global apagado o Redis ausente antes de la reactivación descrita arriba. «Abrir captura» no evita ningún gate: con configuración inválida muestra rechazo y no crea un período. Esta UI no modifica variables de entorno ni autoriza un piloto.

«Crear enlace» permite una promoción propia opcional, con asociación inmutable; no aplica código, modifica precio ni autoriza canje. Se muestra el nombre cuando está disponible en las opciones, o «nombre no disponible» junto al ID histórico. Sólo archivar/copiar siguen permitidos sobre enlaces existentes. La selección de promoción sigue la elegibilidad de asociación de la acción existente (pertenencia al negocio), no la elegibilidad económica de redención.

La pantalla presenta por separado conversión completa/parcial y particiones convertido/interrupción conocida/medición incompleta. El embudo termina en reserva verificada con recorrido completo, sin ocultar reservas de recorrido incompleto. Gráfico y tabla distinguen intentos completos de sus reservas creadas; atendidas y canjes son estado al consultar de todas las reservas/redenciones creadas en período y no responden al filtro histórico. Las atendidas repetidas en filas de poblaciones del mismo servicio no deben sumarse. Disponibilidad vacía y errores también se muestran sin exigir umbral de oportunidad. Diagnóstico `not_queried` significa no consultado para ese rango/filtro, no purgado; sólo se presenta detalle cuando la consulta acotada lo demuestra.

## Checkpoints y evidencia

### Continuación de cumplimiento: N1 y G1

Continuación posterior: `175179d` + `c6c2daf` amplían únicamente tests. Se verifica
Booking guardada sinmetadatosanalytics al no responder, rechazar o retirar permiso,
y se alinea el reloj del fixture dearchivo con captureNow tras un fallo23514 real.
Resultado:53/53integración seleccionada,8/8E2E públicos,typecheck/lint0 yre-review
focal PASS. Matriz, RED y comandos en `owner-analytics-completion-audit.md`.
No equivale a cierre global ni implementa G2; el contrato adicional sigue pendiente
de aprobación y la validación conjunta debe hacerse tras completar ese requisito.

N1 `a3a9737223d304b844d2a68ed214c24bdbe1375d`: corregida etiqueta asíncrona
fuera de identidad. G1 `6b07579576cbc95d0cc41e0eb3c8bfa05eb9e7d9`: siete
archivos, edición de etiqueta con acción protegida y pruebas UI/DB/E2E.
Revisión independiente exacta `a3a9737..6b07579`: PASS spec/calidad, sin hallazgos
accionables. No es un PASS global del MVP: G2 permanece sin implementar.

G1 RED: controles/acción2fallos15pass3.54s; DBexport ausente1fallo18filtrados1.43s.
Iteraciones de tests: helper de botón-icono y selector E2E parcial ambiguo se
corrigieron localmente; no se ocultaron fallos ni cambiaron guards globales.
Final implementer:45/45unit6archivos23.88s,19/19DB7.14s,4/4E2E26.0s,
lint7archivos exit0/5.64s. Verificación propia del controller:24/24unit7.98s,
19/19DB4.16s,typecheck exit0. Sin nueva fullsuite ni build; se reservan para
cerrar G2 y verificar todo el código final conjuntamente.

Typecheck inicialmente falló por una cola duplicada inválida en
`.next/dev/types/routes.d.ts`; se reprodujo con Next ya detenido. Se conservó
únicamente ese directorio generado en `/tmp/agendita-label-types-TUdovo/types`,
y `next typegen` oficial produjo `.next/types`; typecheck posterior exit0/24.35s,
confirmado también por el controller. Causa específica de escritura no demostrada;
no se editó código de aplicación ni se borró `.next` entero para resolverlo.

Reproducir G1 con el prefijo limpio de la sección de reproducción:
`npm run test:unit -- tests/unit/analytics-controls.test.tsx tests/unit/analytics-actions.test.ts tests/unit/analytics-links.test.tsx tests/unit/server-actions-auth.test.ts tests/unit/legacy-form-style-guard.test.ts tests/unit/analytics-dashboard.test.tsx --maxWorkers=1`,
`npm run test:integration -- tests/integration/analytics-link-label.test.ts --maxWorkers=1`,
`npx playwright test --config=playwright.owner-analytics.config.ts`,
`npm run typecheck`. Logs y reporte completos en
`.superpowers/sdd/2026-08-31-owner-analytics-goal-completion/label-report.md`
y archivos `label-*.log` del mismo directorio, excluidos de Git.

Nueva PostgreSQL de pruebas retenida para continuar: container
`agendita-owner-analytics-goal-01a055ad`, ID
`7a4bd7873b37268337d08f8836295b429931c5197ea73c167d7afa88e58a5344`,
label `codex.task=owner-analytics-goal`, localhost55439, DB
`agendita_owner_analytics_test`, 1CPU/512MiB/tmpfs256MiB sin binds de host.
Sólo esa DB recibió las55migraciones y fixtures sintéticos; Next propio terminó.
El container antiguo mencionado abajo fue eliminado en el checkpoint anterior.

### Checkpoints históricos de Tasks1–6

Base de rama: `c5ea7146e936ab41a8df60e79c3fbd34a84cdf1a`; planificación `5dddecc`. T1 `1b9cc04`→`1a8920b`; T2 `f62132e`→`4e9b47e`; T3 `afcf728`→`5ef75b6`; T4 `2e433af`→`94d85fc`; T5 `5d8182d`→`e39ecfe`→`3516dd1`→`8280aee`→`fb8eb82`. Task6 parte del SHA completo `fb8eb828eac4d76af2b2833d8ec83cd39b58a09e`.

Checkpoints finales completos: T1 `1a8920bedf9df02ae7d7a6cf8606419d2bb2b20f`; T2 `4e9b47ea0fc3b4011c447694b3c3e6d9f88dab59`; T3 `5ef75b6560c496e16025f7752904505bf1a9e534`; T4 `94d85fc3e6b7588dae56b499c608ff0fce59b1ac`; T5 `fb8eb828eac4d76af2b2833d8ec83cd39b58a09e`.

Task6 código, tests y handoff verificados: `579ddd502e1e6f317d433d5741b7d4b3aa3b9ff3`. El commit posterior `696359dac1b283bcbbd568bede707113fe7b9647` sólo registra este checkpoint documental. En ese momento seguían pendientes revisión Task6 y revisión de rama; es estado histórico, no el gate actual. Ningún push/PR/deploy realizado.

Revisión Task6 round1 sobre `696359dac1b283bcbbd568bede707113fe7b9647`: el cierre del harness podía esperar un segundo `exit` imposible cuando Next ya había terminado por señal (`exitCode=null`, `signalCode=SIGTERM`). Corrección sólo en soporte de tests: comprobar ambos campos, suscribir antes de señalizar y acotar espera por hijo a1s SIGTERM+1s SIGKILL; si no llega salida, devolver fallo, marcar exit1 y continuar limpieza posterior. No se modificó código productivo ni gates. Prueba `tests/unit/analytics-public-harness.test.ts`: Node22, RED3fail/1pass3.78s antes del fix; GREEN4/4pass476ms. Tres casos usan hijos Node reales (ya señalizado, cierre normal, SIGTERM ignorado); un EventEmitter modela ausencia excepcional de `exit` incluso trasSIGKILL y comprueba liberación de listeners/retorno acotado. Smoke `qa npx playwright test --config playwright.owner-analytics-public.config.ts -g 'guest can decline'`:1/1pass8.7s; fixture pública0 y sin listeners3555/3556 al terminar. No se repitieron suites completas. Reproducir focal con `qa npm run test:unit -- tests/unit/analytics-public-harness.test.ts --maxWorkers=1 --testTimeout=10000`. Sin nueva Ruling; cierre de contrato de cleanup ya existente.

Checkpoint del fix round1: `90b48b65ae214b846b1b75210a85469a6166b4ca`; typecheck posterior exit0,4.28s y lint de los tres archivos de código del fix sin warnings. El commit documental siguiente `37ad3473a6788f5c48561985dc09f47d7d206a9c` registra este SHA/evidencia. Task6 y su re-review fueron aprobadas; la revisión de toda la rama `c5ea7146e936ab41a8df60e79c3fbd34a84cdf1a..37ad3473a6788f5c48561985dc09f47d7d206a9c` originó I1–I7. En ese checkpoint quedaba pendiente la aprobación scoped de la fixwave final, cerrada más abajo.

Checkpoint de código de la fixwave final: `d8f38f8229c153c6838f00789dd36f09fdaa903d` (32archivos, incluye enmiendas sexta/séptima de spec/plan). Fullunit, integración, E2E afectados, tipado, lint y build de cierre abajo se ejecutaron sobre ese código antes de commitear. El commit documental siguiente sólo registra este SHA y aclara estado de revisión; no implica aprobación scoped ni activación.

**Gate final, 2026-08-31:** revisión scoped independiente de `37ad3473a6788f5c48561985dc09f47d7d206a9c..41eb7460fdfd8eacbece37507050222faa15e7c6`: I1–I7 y M1–M5 ADDRESSED; Spec PASS y calidad PASS con Minor N1. Sin nueva Critical/Important. Se contrastaron código y logs; no se repitieron suites. El controller adjudicó N1 mediante la octava Ruling. La documentación posterior no cambia el código verificado. Rama `feature/owner-analytics` y worktree aislado conservados; sin merge/push/PR/deploy.

**N1, hallazgo histórico ya corregido:** el selector podía mostrar nombre A con valor B si cambiaba la selección durante una respuesta pendiente. `a3a9737` exige `selected.id === value` antes de usar la etiqueta auxiliar. Las regresiones ejercitan los consumidores reales de servicio y promoción: RED2fallos antes del fix; GREEN30/30 en controles/dashboard/enlaces, typecheck y lint exit0. Revisión independiente del diff: PASS. Esta verificación focal no sustituye la matriz final pendiente tras G1/G2.

**Limpieza final:** se validaron ID, nombre, etiqueta `codex.task=owner-analytics`, ausencia de mounts y tmpfs del contenedor exclusivo `agendita-owner-analytics-test-01a055ad` (`69feae899b17c1f7d4a89c48b71d04c351e14e2d22c48d99d76c761f5d2c692e`) y se detuvo/eliminó sólo ese contenedor. Su base sintética efímera no es recuperable; se reproduce con migraciones/fixtures, sin pérdida de datos reales. Para volver a ejecutar la receta inferior hay que recrear primero una base exclusiva equivalente. Los logs/reportes/ledger de este plan se movieron, sin borrado irreversible, a `/Users/robertozamorautrera/.Trash/agendita-owner-analytics-sdd-20260831-41eb746`; el handoff mínimo queda versionado aquí. Las capturas `test-results/owner-analytics*`, dependencias propias, rama y worktree se conservan. No se tocaron otros contenedores ni el checkout principal.

Proceso: Tasks1–4 y fix T5 round1 tienen RED/GREEN registrado. T5 rounds2/3 **no tienen RED funcional antes de implementación**; typecheck fallido no sustituye TDD. Se añadieron luego regresiones funcionales y E2E verdes. Task6 reproduce primero la fuga del stub `scrollIntoView` y restaura descriptor en `finally`, con comprobación después de cada test. No reconstruir evidencia RED retrospectiva.

### Verificación local Task6

Corrida **original de Task6** de2026-08-31, Node22, un worker. Resultados históricos exactos, sin reconstruir una «suite global verde» que no ocurrió en esa fase:

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

### Fixwave final: fronteras y evidencia durable

Base exacta `37ad3473a6788f5c48561985dc09f47d7d206a9c`. I1 separa precio válido de observación vigente (identidad de intento+revisión); I2 preserva rango desde página real hasta paginación. I3 recupera sólo intento existente con firma/binding original; DB commit seguido de respuesta perdida o crash antes del catch recupera la misma credencial, sin extender deadline. I4 presenta cada población/partición y alcance operativo explícitamente. I5 añade controles accesibles y opciones acotadas; I6 asociación opcional de promoción sin aplicación económica; I7 conecta apertura/cierre con todos los gates. Minor: diagnóstico no consultado veraz, etiquetas españolas, helper Redis de cierre acotado y mock local `replace` corregido. La brecha T5 histórica permanece.

RED observado **antes** de cada corrección: los comandos siguientes usan `qa` de la sección de reproducción y `--maxWorkers=1`; se indican filtros sólo para volver a ejecutar la frontera. No dependen de conservar el scratch:

| Frontera / comando | RED real | GREEN focal posterior |
| --- | --- | --- |
| `npm run test:unit -- tests/unit/step-payment-pantalla-por-step.test.tsx tests/unit/analytics-dashboard.test.tsx` | 3fail/17pass,4.68s: retiro descarta precio, intento nuevo recibe observación vieja, rango se pierde | Filtro `economic preview\|obsolete promotion\|actual async page`:5pass/18filtrados,3.91s |
| `npm run test:integration -- tests/integration/analytics-ingest.test.ts -t 'recovers the committed attempt'` | 1fail/18filtrados,1.80s: commit con respuesta perdida cruza vencimiento de padre | Archivo33/33pass,7.16s, incluidas14negativas binding/firma/tenant/tiempo/período/config |
| Mismo archivo `-t 'crash before catch'` | 1fail/33filtrados,1.40s: persistido retries0, fetch pendiente tras commit; store nuevo sin credencial | Archivo34/34pass,4.78s, misma fila/deadline y retirada sin resurrección |
| `npm run test:unit -- tests/unit/analytics-client-transport.test.ts -t 'pre-catch crashes\|preflight state'` | 2fail/12filtrados,1.01s: envíos no acotados entre crashes y POST sin persistencia | Transport/store/credential/Booking39/39pass,3.23s; presupuesto+backoff durable, storage failure conserva Booking válida |
| `npm run test:unit -- tests/unit/analytics-dashboard.test.tsx -t 'required separate\|path-incomplete\|operable capture'` | 3fail/11filtrados,2.52s: métricas/superficies omitidas | Consumidores completos incluidos en focal12archivos86/86pass,23.93s |
| `npm run test:unit -- tests/unit/analytics-links.test.tsx -t 'optional promotion'` | 1fail/4filtrados,2.89s | Selector, asociación enviada y fallo explícito en consumidores finales |
| `npm run test:integration -- tests/integration/analytics-report-isolation.test.ts -t 'does not claim retained'` | 2fail/15filtrados,2.07s: había raw retenido pero decía no retenido | Archivo17/17pass; discriminador `not_queried`, no inferencia de purga |
| `npm run test:unit -- tests/unit/legacy-form-style-guard.test.ts tests/unit/analytics-controls.test.tsx` | 2fail/9pass,3.44s: selects fuera de primitivo y fallback fuera de página no explícito | Primitivo compartido sin excepción; controles preservan filtro al buscar/paginar/aplicar |
| `npm run test:integration -- tests/integration/analytics-options.test.ts` | Primero módulo nuevo ausente (RED estructural, no SQL funcional). Más tarde1fail1.98s: selección extra sobre100 identidades | DB1/1pass2.40s:102enlaces100+2, búsqueda, archivo/historia, autorización,100identidades máximo y selección en página |

También hubo RED funcional de dos series/nombre promoción (2fail3.46s), fechas invertidas (1fail1.83s), sincronización de controles tras navegación real (1fail2.07s) y audit de autorización en acción (1fail/2pass1.44s). Greens:2pass3.42s; controls7/7pass2.64s antes del caso adicional de fallback; audit+acciones8/8pass2.38s. No se silenció ningún audit ni warning global.

Primera fullunit de esta ola:426archivos,425pass/1fail;3890pass/1fail/1skip,707.52s. Fallo propio confirmado: los dos nuevos selectores omitían `NativeSelect`; no preexistente. Se corrigió tras RED focal y se añadió límite estricto de opciones. Esta corrida fallida se conserva, separada del cierre posterior.

**Fullunit de cierre**, después del último fix write-ahead I3 y E2E público: `qa npm run test:unit -- --maxWorkers=1 --testTimeout=60000`,426/426archivos aprobados,3895pass/1skip/0fail,446.99s (real447.78s). Entorno limpio sin APP_DOMAIN overrides, mismo código congelado. El skip es la prueba opt-in de red real `payment-qa-network-deny`, no fue activada. No reinterpreta las full fallidas anteriores como verdes.

**Integración completa de cierre** serial: `qa env OWNER_ANALYTICS_MEASURE_LOCAL=true npm run test:integration -- --maxWorkers=1 --testTimeout=60000`,71/71archivos y477/477tests,0fallos,111.86s (real112.59s). Incluye las ocho suites analytics —schema,ingest,budget,booking-snapshot,rollups,retention,report-isolation,options— y todas las regresiones Booking/pagos/promociones del repositorio, usando dependencias externas simuladas y DB exclusiva. Typecheck separado exit0,8.02s. Lint focal de todos los115archivos TS/TSX/JS/MJS de la rama contra base original, incluidos nuevos archivos:0errores/0warnings,5.95s.

Build sintético de cierre con el comando seguro de abajo: exit0,17.33s; Prisma5.22 generado528ms, Next16.3.2 compiló3.0s, TypeScript8.7s,59/59páginas441ms. No `vercel-build`, migración ni cron ejecutados. `git diff --check` exit0. Al terminar, puertos3555/3556 sin listeners y ningún launcher/Next/Redis temporal propio activo; PostgreSQL exclusivo permanece running (1CPU/512MiB) para revisión. Sólo hay `.env.example` y `.env.test.example`, no archivos de entorno activos.

E2E de cierre: dashboard4/4pass17.3s; público5/5pass23.6s después del último cambio I3. Owner/staff, teclado375px y ausencia de overflow global; fecha/filtro→página2; promoción por nombre; cerrar con globaloff/Redis ausente; reabrir con config inválida no crea período. Público valida deny/bot/member, Booking sintética desktop/móvil, transporte fallido y hora estable con grant/withdraw. Root inspeccionó PNG frías en scrollTop. No auth/login/servicios externos reales.

Un rerun intermedio de capturas falló4casos antes de llegar a la página por panic Rust al restaurar caché Turbopack (`Restore of All ... restoring failed`). Con Next propio detenido se movió sólo `.next/dev/cache/turbopack` a `.next/dev/cache/turbopack-final-qa-panic-20260831`, recuperable; rerun frío4/4pass. Causa específica no demostrada: no se afirma preexistencia, ni SIGKILL, ni build/dev simultáneo (no se había ejecutado build). No se cambió configuración de caché ni se tocaron otras apps.

### Mediciones locales y coste de transporte

Collector real:2bootstraprows en1034.244ms;3lotes de20eventos aceptados en841.417ms (compilación fría),251.732ms y251.235ms;60filas comprobadas en PostgreSQL. Control gap-only101.246ms (respuesta+consulta de verificación),0eventrows.63unidades reservadas=60eventos+2bootstraps+1gap, excluyendo apertura de período fixture. Transporte: Next→HTTPSloopback3556→adapter REST de prueba→`redis-cli`→Redis7.0.11 Unix efímero/Lua real→PostgreSQL. El subprocess síncrono añade coste artificial; no es Upstash hospedado. Certificado temporal confiado sólo por proceso Next, sin desactivar TLS ni alterar trust global. Los tests Redis de integración ejercitan Lua real pero mockean REST, frontera distinta.

Drenaje real PostgreSQL:12064unidades fuente={61sessions,1attempt,12001events,1snapshotBooking};10000limpiadas/borradas en472.468ms y2064en314.789ms, Booking preservada. Otra muestra limpia1snapshot y congela44celdas en142.436ms. Daily:30celdas antes,6elegibles/6borradas/cero vencidas restantes;10cohortes publicadas,30celdas después,138.286ms. La llamada incluye publicación/reemplazo de celdas, no sólo DELETE; `published` cuenta cohortes, no filas. Los días de período sin tráfico también consumen almacenamiento. Límites de recursos declarados son configuración del entorno, no perfil continuo de CPU/RSS ni medición de picos.

Muestras nuevas de la fixwave, misma frontera/recursos: collector2bootstraprows918.197ms;3lotes20eventos900.416/171.446/178.113ms (60filas), gap98.074ms sin filas,63unidades reservadas. Drenaje fuente12064:10000en369.243ms+2064en203.960ms, Booking conservada; snapshot1+freeze44celdas35.733ms. Daily30antes/6elegibles/6borradas/0vencidas/10cohortespublicadas/30después132.676ms. Incluyen transporte/consultas o mantenimiento completo según la frontera anterior; no multiplicar estas muestras por un día para certificar cuota/throughput productivos.

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
