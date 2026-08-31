# Métricas para dueños — MVP de adquisición y conversión

**Fecha:** 2026-08-30

**Estado:** alcance de producto aprobado; diseño técnico para revisión.

**Implementación:** no iniciada. No incluye activación en producción.

**Revisión de gaps:** separar poblaciones completas/parciales, invalidar selecciones
obsoletas, registrar interés previo a modalidad, distinguir restricciones de
agenda de falta de capacidad y conservar histórico agregado con plazo explícito.

**Decisión de almacenamiento propuesta:** seis tablas nuevas en la misma PostgreSQL,
no una tabla por KPI, campaña o servicio. Reservas, pagos y canjes siguen siendo
las fuentes transaccionales existentes. Retención cruda de 90 días; histórico
agregado de 13 meses sujeto a aprobación de finalidad, privacidad y borrado.

## 1. Objetivo y límites

Ayudar al dueño a responder de dónde viene el interés, dónde se interrumpen las
reservas y qué demanda no encuentra horarios. Los datos deben conducir a una
decisión concreta, sin atribuir motivos o ingresos que no podemos demostrar.

El MVP comprende:

- Visitas medibles, origen y enlaces identificables por campaña/promoción.
- Embudo de reserva pública y último paso observado, por servicio.
- Búsquedas sin horarios, separadas de errores y solicitudes obsoletas.
- Reservas vinculadas, su estado actual y promociones efectivamente aplicadas.
- Dashboard con comparación temporal y hasta tres oportunidades basadas en reglas.
- Consentimiento opcional, aislamiento por negocio y controles de calidad.
- Histórico diario de cohortes cerradas, con definiciones y cobertura versionadas.

Quedan fuera: IA semanal, mensajes de recuperación, cambios automáticos de
precios/agenda, integración con anuncios o DMs, identificación entre dispositivos,
grabaciones de sesión, A/B testing, ROI/margen, retención/LTV y analítica de compra
de paquetes. Un abono de paquete usado al reservar sí debe respetarse como rama
del funnel, pero no se contabiliza otra vez como venta del paquete.

No llamar **leads** a visitas ni a intentos: no equivalen a contactos comerciales
identificados. Capturar datos de quien no termina y recuperarlo comercialmente
sería otra funcionalidad, con finalidad y autorización propias.

## 2. Base verificada y alternativas

Inspección local: `216f47e345b585ffa0dd6603af8b327e5698533a`.
La referencia local `origin/main` apunta a
`c5ea7146e936ab41a8df60e79c3fbd34a84cdf1a`; incorpora el registro de navegación y
menú móvil de tours. Antes de implementar se revalidará la base actual. Estos
SHAs son referencias de código, no evidencia de despliegue.

Existen reservas, pagos, libro de movimientos, canjes, referidos y campañas. No
se encontró instrumentación de navegación del funnel. Los contadores de
`src/lib/metrics/operational.ts` miden salud técnica por proceso: no sirven como
histórico de conversión ni se les añadirán identidades de negocio o cliente.

El wizard tiene pasos dinámicos. La creación de una reserva, su confirmación,
el pago y la atención son resultados distintos. Las campañas de WhatsApp marcan
`sentAt` al preparar un enlace: eso no prueba envío, recepción o lectura.

Alternativas consideradas:

1. **Eventos propios tipados + agregados diarios en PostgreSQL — propuesta.**
   Reutiliza Prisma, autorización y dominio financiero; permite un dashboard
   embebido sin un proveedor adicional. Exige mantener captación, límites y borrado.
2. **Proveedor externo de product analytics.** Acelera exploraciones internas,
   pero añade contratación, tratamiento de datos y una integración multiempresa
   para mostrar resultados a los dueños. No se introduce en este MVP.
3. **Sólo ampliar reportes transaccionales.** Menor esfuerzo, pero no explica
   navegación, origen ni interrupciones previas a crear una reserva.

## 3. Unidades de medición

### Visita e intento

- Una **visita medible** es una sesión seudónima de un negocio en una pestaña,
  iniciada en perfil público o `/book`, después de aceptar medición. Dura como
  máximo 24 horas. Recargar o ir del perfil al wizard conserva la sesión.
- No representa una persona única. Otra pestaña, navegador o dispositivo puede
  generar otra visita. No se ofrecerá un KPI de "personas únicas".
- Un **intento** empieza al abrir el wizard. Se conserva entre pasos, recargas,
  reintentos y el viaje a login. Una reserva terminada y un nuevo flujo generan
  otro intento; la sesión puede contener varios.
- La ventana de conversión es de **24 horas desde el inicio del intento**. La
  expiración de la sesión no invalida un intento todavía vigente. Cada uno tiene
  su propia credencial y plazo; no se usa la clave de idempotencia de pagos como
  identidad de analytics.
- No se reconstruyen eventos anteriores al consentimiento. Si se acepta a mitad
  del flujo, se registra una entrada parcial: queda fuera del embudo completo y
  se informa por separado. Los datos transaccionales siguen existiendo sin permiso
  de analytics, pero no se inventa su recorrido ni su origen.

Una entrada completa exige captación desde el inicio, antes de interactuar con
los pasos. Aceptar tarde, recuperar un wizard prellenado sin contexto analítico
válido o empezar desde un paso posterior produce una entrada parcial. Su reloj
empieza al crear ese intento medible, no al supuesto inicio anterior.

### Fechas y población

Por defecto se muestran los últimos 28 días completos en la zona horaria del
negocio y los 28 anteriores. Detalle: selector de 7, 28 o 90 días y rango
personalizado de hasta 90 días, dentro de la retención cruda. Tendencia histórica:
hasta 13 meses sobre agregados cerrados, sólo si esa retención fue aprobada.
No ofrecer detalle ni filtros no conservados para períodos históricos. "Hoy" es
provisional.

El funnel selecciona intentos por `startedAt` en `[desde, hasta)`. Numerador y
denominador pertenecen a esa misma cohorte; la reserva puede producirse después
del final del período, siempre dentro de las 24 horas del intento.

Los intentos con ventana abierta se muestran como "en curso". La tasa definitiva
usa sólo intentos con 24 horas cumplidas, tanto convertidos como no convertidos.
Al vencer un intento, un nuevo flujo inicia otro. No se ofrece atribución de
reservas posteriores al vencimiento: si un submit conserva una credencial vencida,
la reserva se crea sin ese snapshot. "No completó en 24 h" nunca significa que
esa persona no haya vuelto o reservado posteriormente.

La adquisición selecciona visitas por su propio `startedAt`. No se divide una
cohorte de reservas por otra población de visitas. Si se muestra visita → inicio,
se cuenta si cada visita originó al menos un intento durante sus 24 horas.

Contrato de los indicadores principales:

| Indicador | Población y cálculo |
| --- | --- |
| Visitas medibles | Sesiones consentidas iniciadas en el período; no personas únicas ni tráfico total. |
| Intentos completos / parciales | Conteos separados por tipo de entrada y fecha de inicio; mostrar también cuántos siguen en curso. |
| Conversión principal en 24 h | Intentos **completos y maduros** con al menos una Booking creada dentro de su ventana / intentos completos y maduros. Incluye conversiones con recorrido observado incompleto. |
| Conversión de entradas parciales | Misma fórmula en otra población, explícitamente separada; nunca mezclar su numerador con el denominador principal. |
| Interés por servicio | Pares distintos intento-servicio considerados; selección con modalidad resuelta y conversión del servicio son hitos posteriores. |
| Conversión sobre interés del servicio | Intentos maduros con interés observado en ese servicio y reserva de ese servicio dentro de ventana / intentos maduros con ese interés observado, separados por entrada. Las conversiones sin evento de interés se muestran aparte, no entran en ese numerador. |
| Sin horarios ofrecidos | Intentos con al menos un resultado vacío vigente / intentos con al menos un resultado vigente no erróneo; completos/parciales por separado. |
| Promoción aplicada | Hechos de Booking/canjes del dominio, no eventos de validación del cupón ni la campaña de llegada. |

Cada indicador tiene clave y `definitionVersion`, unidad, población, fecha de
cohorte, ventana, dimensiones permitidas y origen de verdad. Las consultas y reglas
consumen ese registro compartido; la IA futura no redefine las fórmulas.

Congelar `businessTimeZone`, `cohortLocalDate` y versión al iniciar la sesión/intento.
Un cambio de zona no reclasifica el pasado. La UI debe advertir rangos con distintas
definiciones/zonas y no compararlos silenciosamente. Las horas se almacenan en UTC;
los días se agrupan con la zona congelada, incluyendo cambios de horario de verano.

## 4. Contrato de eventos y resultados

Cada evento de navegador usa una unión discriminada por tipo, con campos comunes
de versión, ID aleatorio, sesión/intento, secuencia y `selectionRevision` cuando
aplica. El contexto se habilita por
evento, no mediante un JSON libre. ID de servicio, modalidad y elección de
profesional (`none`, `anyone`, `person`) se validan; el ID de profesional sólo
existe para `person`. Pasos y resultados son enums cerrados.

`date_selected` admite `localDate` (fecha ISO real en la zona del negocio).
`time_selected` admite esa fecha y `timeBucket` (`00_06`, `06_12`, `12_18`,
`18_24`), nunca la hora exacta. `availability_result` admite el contexto de
selección, `localDate`, `queryId` UUID, `requestGeneration` entero positivo de
hasta 100.000 y `result` (`available`, `empty`, `error`). El servidor deriva la
clave de contexto; no se acepta un `contextKey` de texto libre. Admitir fechas ISO
reales en el rango técnico cerrado 2000–2100, también fuera de la ventana de
reserva: consultar demasiado lejos es una observación válida, no un dato a borrar.
Ese límite es del contrato de telemetría, no cambia qué fechas se pueden reservar.
Los campos desconocidos se rechazan. Nunca se registra un formulario o respuesta
completos, ni se habilitan estos campos para tipos de evento no relacionados.

Eventos mínimos:

| Evento | Significado y fuente |
| --- | --- |
| `public_profile_viewed` / `booking_entry_viewed` | Superficie visible después de hidratar y consentir; no prefetch ni render del servidor. |
| `funnel_started` | Primer inicio completo del wizard; idempotente por intento. |
| `step_viewed` | Paso efectivamente mostrado; claves de `wizard-steps.ts`, no índices numéricos. |
| `service_considered` | Apertura de una tarjeta de servicio, incluso si todavía falta elegir modalidad. En selección directa puede coincidir con `service_selected`, pero conserva su unidad propia. |
| `service_selected` | Servicio y modalidad resueltos; snapshot del contexto elegido. |
| `professional_selected` | Selección explícita cuando el paso existe; `anyone` no se transforma en una persona inventada. |
| `date_selected` / `time_selected` | Elección explícita; sólo fecha local y franja amplia para analítica, no hora exacta de cita. |
| `availability_result` | Respuesta vigente: `available`, `empty` o `error`; nunca un resultado cancelado/obsoleto. |
| `customer_step_completed` | Validación y avance, sin nombres, teléfono, correo, dirección ni notas. |
| `promotion_result` | `accepted`, `rejected` o `error`; ID validado de promoción en éxito, nunca código crudo. |
| `payment_branch_viewed` / `payment_method_selected` | Pantalla de revisión realmente mostrada y método elegido explícitamente cuando aplica, según el contrato inferior; no acredita pago. |
| `booking_submit_result` | Intento de envío o categoría de fallo. El navegador no acredita una reserva creada. |
| `selection_context_changed` | Cambio o restauración que invalida hitos posteriores; razón cerrada y nueva revisión, sin copiar datos personales. |
| `checkout_redirected` | Salida al proveedor: no acredita pago ni abandono. |

La reserva creada se obtiene de `Booking`, vinculada en servidor. Sus estados de
confirmación, pago y atención se leen del dominio existente. El colector público
no acepta eventos que afirmen pago aprobado, reserva confirmada o cita atendida.
Una transferencia declarada tampoco equivale a dinero verificado.

La pantalla de pago sigue el discriminante actual de `pantallaDeDatos`:
`sin-abono`, `verificando`, `sin-pago-online` o `cobrar`. Separar ese enum de la
condición económica visible (`package`, `promotion_zero`, `free_service`,
`no_deposit`, `deposit_required`) y de métodos ofrecidos/elegidos (`online`,
`transfer`, `manual`). No confundir no tener pago online con no ofrecer transferencia.
Un método preseleccionado no es una elección explícita. Paquete y promoción pueden
cambiar la pantalla durante el mismo paso; registrar sólo el contexto vigente.
Ninguno de estos campos acredita el estado financiero final.

Validaciones de promoción y errores deben entregar IDs/categorías públicas cerradas
desde su resultado real. Si el contrato actual sólo devuelve texto, ampliarlo de
forma compatible o usar `unknown`; no analizar textos para deducir códigos ni
copiar mensajes, cupones, teléfonos o respuestas completas. Descartar también las
validaciones asíncronas obsoletas de promoción/paquete, no sólo de disponibilidad.

La secuencia resuelve el orden de eventos del mismo intento incluso si llegan en
lotes fuera de orden. `receivedAt` es del servidor y se usa como tiempo de
observación; no se acepta un timestamp de ocurrencia aportado por el cliente.
Los eventos recibidos tras el vencimiento del intento no cambian su funnel de
24 horas. La cola local descarta eventos con más de cinco minutos sin enviar;
no hay sincronización offline prolongada ni reconstrucción de tiempos pasados.
El timestamp autoritativo `Booking.createdAt` determina la conversión aunque el navegador
haya dejado de enviar eventos.

La revisión y secuencia se conservan al recargar. La evidencia se reduce con una
máquina de estados determinista y versionada: no basta con buscar si cada tipo de
evento apareció alguna vez. Un nuevo intento no es la solución a cada cambio de
selección, porque inflaría artificialmente el denominador.

### Disponibilidad y cambios de selección

Cada búsqueda tiene una clave de contexto (intento, servicio, modalidad, elección
de profesional y fecha local) y una generación de petición. Sólo se registra la
respuesta vigente que la UI realmente presenta. Reintentar la misma consulta no
multiplica el conteo de intentos afectados.

La métrica inicial es **intentos con al menos una búsqueda válida sin horarios**,
no "personas perdidas" ni "agenda llena". La falta de horarios corresponde a la
fecha y combinación consultadas; no demuestra ausencia de alternativas en todo
el negocio. Los errores quedan en una serie separada.

Hoy el generador devuelve una lista vacía tanto por capacidad como por reglas de
atención, anticipación mínima o ventana de reserva; el calendario permite navegar
a meses futuros. No traducir `[]` a "agenda llena". Ampliar el resultado público
con un diagnóstico cerrado proveniente del **mismo cálculo** de disponibilidad,
manteniendo compatibilidad de sus consumidores: `outside_booking_window`,
`lead_time_restricted`, `not_offered`, `no_capacity` o `unknown` para resultados
vacíos. Asignar una causa sólo si ese cálculo la demuestra; combinaciones ambiguas
quedan como `unknown`. No duplicar estas reglas en el colector ni en el navegador.
La respuesta no debe exponer detalles de otras reservas. Un evento del navegador
sigue siendo observación no confiable, incluso si reproduce ese diagnóstico.

Sin ese diagnóstico, el MVP puede mostrar "sin horarios ofrecidos", pero no
recomendar abrir más cupos. Un error de red no es un resultado vacío. Una petición
vieja de un contexto que vuelve a seleccionarse tampoco es vigente: validar tanto
`selectionRevision` como generación de petición y registrar sólo la respuesta
que la interfaz presentó.

Reglas mínimas del reductor, contrastadas con el estado real del wizard:

- Servicio o modalidad distintos invalidan profesional, fecha, hora y preparación
  de envío posteriores que ya no sean válidos; nunca unir hora del servicio A con
  envío del servicio B.
- Cambiar profesional invalida la hora; cambiar fecha invalida hora y resultado de
  disponibilidad anterior. Revalidar campos conservados no implica inventar una
  nueva interacción explícita del usuario.
- Cambiar hora o condiciones de pago invalida la preparación del envío afectada.
  Ir atrás sin cambiar selección no invalida hitos válidos ni los vuelve a contar.
- Restaurar tras login conserva la revisión sólo si el contexto coincide y sigue
  vigente. Si se perdió, se muestra recorrido incompleto. Cargar PII del wizard no
  la incorpora a eventos.
- El envío identifica la revisión que lo produjo. Booking verifica la conversión
  del intento; el embudo sólo la asocia a una trayectoria compatible con el servicio
  real y con la revisión enviada. Si esa evidencia falta, conversión sí, recorrido
  completo no.

Conservar por separado el avance máximo coherente observado y el último contexto
vigente. El primero alimenta hitos; el segundo, el último paso observado. Un intento
con conversión y camino incompleto no se clasifica como abandono de otro servicio.
La tabla por servicio cuenta una vez cada par `(intento, servicio)` y
atribuye la reserva sólo al servicio real de `Booking`. Sus filas no son aditivas:
un intento puede explorar varios servicios. La interfaz lo explica. Para un servicio
distinto al reservado usar "sin reserva de este servicio", no "cliente perdido".

## 5. Persistencia y fronteras

Usar la PostgreSQL existente para el piloto, con módulo y tablas propios. No
añadir contadores mutables a `Business` ni crear una tabla por KPI, servicio o
campaña. Tampoco introducir otra base/warehouse antes de medir carga real.

Entidades propuestas, todas con negocio explícito:

| Entidad | Responsabilidad |
| --- | --- |
| `AnalyticsSession` | Visita consentida, origen inicial inmutable, versión de consentimiento, inicio y vencimiento. Sin identidad de cliente. |
| `BookingFunnelAttempt` | Inicio, sesión de origen, ventana de conversión, entrada completa/parcial y calidad conocida de captura. |
| `BookingFunnelEvent` | Eventos tipados y acotados del intento o superficie pública, deduplicados por ID; secuencia y revisión de selección. |
| `AcquisitionLink` | Enlace público opaco con canal, nombre de campaña y promoción opcional, gestionado por el negocio. |
| `AnalyticsCollectionPeriod` | Intervalo de habilitación por negocio y versión, con inicio y cierre registrados por la operación autorizada de activación/desactivación. |
| `AnalyticsDailyMetric` | Contadores y denominadores de cohortes cerradas, versión, zona y cobertura; histórico sin conservar IDs de sesiones, intentos o reservas. |

Campos consultados frecuentemente en columnas tipadas e indexadas; sólo extras
pequeños por tipo de evento en un payload validado y cerrado. No un JSON libre
con datos arbitrarios del wizard. Las tablas diarias contienen números, no una
copia comprimida de eventos.

### Integridad e índices

- Intento → sesión mediante FK `(businessId, sessionId)`; evento → sesión con
  esa misma pareja; evento → intento mediante FK **`(businessId, sessionId,
  attemptId)`**, con las claves únicas correspondientes en los padres. Validar
  sólo que dos entidades pertenecen al mismo negocio no evita mezclar sesiones.
- `CHECK` de alcance/tipo: eventos de superficie sin intento; eventos del wizard
  con intento. La FK del intento puede omitirse para una superficie, no la de sesión.
- Unicidad de evento por `(businessId, eventId)`. El servidor deriva `streamKey`
  de sesión o intento según alcance; unicidad por `(businessId, streamKey, sequence)`.
  No aceptar un stream independiente que contradiga las relaciones anteriores.
- Replay idéntico = éxito sin nueva fila. Mismo ID con payload diferente, o misma
  secuencia con otro ID = conflicto, rechazo del elemento y marca de medición
  incompleta. No ocultarlo con un `skipDuplicates` indiscriminado. El fingerprint
  incluye sólo campos canónicos del evento, nunca `receivedAt` o el orden del JSON.
- Índices de cohortes `(businessId, startedAt, id)`, ingesta
  `(businessId, receivedAt)` y recorrido `(businessId, attemptId, sequence)`.
  Booking necesita acceso por `(businessId, analyticsAttemptId, createdAt)` para
  reconciliar sin escanear todo su histórico.
- Limpieza global con `(retentionExpiresAt, id)` en entidades crudas y snapshot
  de Booking; un índice que empieza por negocio no basta para encontrar todos los
  vencidos globales. Verificar índices y planes con datos sintéticos representativos.
- IDs históricos de servicio/profesional son escalares validados en ingesta, no
  FKs que impidan eliminar un profesional o borren en cascada el recorrido. El
  reporte resuelve etiquetas actuales con filtro de negocio o muestra "eliminado";
  no copia nombres de profesionales en eventos. Archivar una dimensión no convierte
  sus hechos previos en cero. Las entidades analíticas propias sí tienen relaciones
  consistentes y borrado por negocio.

`Booking` recibe un snapshot opcional de analítica: versión, identificador de
intento, inicio, límite de conversión, expiración de retención y origen normalizado.
La credencial firma esos valores, negocio, sesión/intento, origen web, versión de
normalización y enlace de adquisición cuando existe. Se copian **sólo sus claims
verificados**, nunca el origen/campaña de campos libres del submit. La revisión de
selección enviada es evidencia no autoritativa para enlazar un camino, no un hecho
financiero ni una autorización.

El snapshot tiene campos obligatorios todos presentes o todos ausentes mediante
`CHECK`; campaña/enlace pueden ser legítimamente nulos. Es información escalar nullable,
no una FK cuyo borrado pueda bloquear una reserva. No afecta precio, solapes,
descuentos, autorización, notificaciones ni equivalencia de reintentos.

Un reintento idempotente conserva el snapshot original. No se sobrescribe una
reserva existente con otro origen aportado por un cliente. Dos reservas asociadas
al mismo intento, si llegaran a existir, representan una sola conversión del
intento y dos reservas transaccionales; analytics no añade una restricción que
pueda rechazar una reserva válida.

Esta regla se aplica tanto al retorno rápido de idempotencia como a la recuperación
de conflicto de unicidad. Se cuenta sólo si `attemptStartedAt <= Booking.createdAt
< conversionDeadlineAt`. No sustituir ese timestamp por el del evento visual ni por
el instante en que la consulta pudo ver la fila. En PostgreSQL `now()`/CURRENT_TIMESTAMP
representan el inicio de la transacción; `createdAt @default(now())` no promete ser
la hora exacta del commit. Se conserva la semántica existente del dominio.
Si `createdAt` está fuera, el reporte excluye esa asociación sin fallar la reserva;
si está dentro pero el commit se hizo visible después, sí cuenta tras reconciliar.

Los reportes enlazan sólo por negocio e intento coincidentes y toman los hechos de
`Booking`. La pérdida de un evento visual de confirmación no pierde la conversión.
Si faltó tracking, la reserva aparece como "sin recorrido medido", no como cero
abandono. No se genera histórico sintético de visitas o pasos.

La conversión autoritativa y el recorrido observado se calculan por separado.
El embudo visual usa el prefijo de hitos observados en orden y su último paso
incluye sólo reservas verificadas cuyo recorrido anterior fue observado. Una
reserva vinculada con hitos faltantes sigue contando en el KPI de conversión
general, pero se presenta aparte como "reserva con recorrido incompleto". No se
rellenan hitos ni se registra una caída ficticia. El gráfico explica por qué su
último valor puede ser inferior al total de reservas verificadas.

Reducir primero cada relación de muchos elementos a su unidad: una fila por intento
o por par intento-servicio y otra agregación para sus reservas. Un join directo de
30 eventos y 2 reservas genera 60 filas, no 60 conversiones. Diferenciar siempre
`convertedAttempts` de `bookingsCreated`; los servicios no se suman para obtener el
total de intentos. Los reportes agregan en servidor, sin enviar eventos crudos al
navegador del dueño.

### Histórico diario: contrato y límites

La sexta tabla se justifica por conservación histórica, no por una optimización
prematura. Una vista materializada refrescada desde eventos ya borrados no puede
reconstruir ese histórico. `AnalyticsDailyMetric` persiste resultados explícitos.

- Registro cerrado de métricas: visitas/inicios y sus conversiones de ventana fija;
  hitos y últimos pasos de intentos maduros; interés/selección/conversión por servicio;
  búsquedas vacías y errores. Cada una declara si la cohorte es de **sesiones** o
  **intentos** y si la entrada es completa/parcial. No sumar poblaciones distintas.
- Granos permitidos: total, canal, enlace de adquisición o servicio **por separado**.
  No un cubo de todas las combinaciones ni dimensiones arbitrarias. La UI deshabilita
  filtros históricos que no pueden responderse; no cruza totales independientes
  para fingir "servicio X de campaña Y". El detalle reciente sí puede calcular
  intersecciones autorizadas desde el crudo.
- Clave única lógica: `(businessId, cohortLocalDate, businessTimeZone,
  definitionVersion, population, grain, dimensionKey, metricKey)`. Usar claves
  no nulas explícitas como `total`, `unknown` o IDs estables para dimensiones;
  `CHECK` de combinaciones válidas. No depender de cómo una restricción UNIQUE
  trate múltiples valores NULL.
- Guardar enteros de numerador y denominador, no porcentajes precalculados.
  Para un rango, sumar contadores compatibles y dividir al final. Las métricas
  que no son aditivas entre servicios sólo se suman **en el mismo servicio entre
  cohortes disjuntas**, nunca entre distintas dimensiones para reconstruir el total.
- Publicar sólo cuando todas las ventanas de la cohorte estén cerradas, con margen
  de reconciliación inicial de una hora y lectura consistente de eventos + Booking.
  El margen no amplía la ventana de conversión. Reservas creadas antes del vencimiento
  que se hicieron visibles tras él siguen perteneciendo a su cohorte.
- La publicación es atómica por negocio/día/zona/versión: reemplazar **todas** las
  celdas, también las que desaparecieron. Un marcador reservado en esta misma tabla
  registra publicación, revisión, corte, población, cobertura y estado
  (`provisional`, `closed`, `failed`), incluso para una cohorte vacía. Serializar
  escritores por cohorte y rechazar revisiones viejas. Un fallo de recálculo no
  transforma datos previos en ceros ni mezcla revisiones en una consulta.
- Reconciliar idempotentemente mientras exista todo el crudo necesario, incluyendo
  borrados de privacidad. Coordinar con purga: registrar el punto de congelación
  antes de la **primera** eliminación por retención de una fuente de esa cohorte.
  No consolidar desde un conjunto parcialmente eliminado. Una falla de rollup
  **no extiende** el plazo de retención.
- Si ya existe una revisión cerrada válida, congelarla y seguir sirviéndola hasta
  su vencimiento; un recálculo imposible no la elimina ni la oculta. Declarar el
  intervalo no disponible sólo si nunca se consolidó correctamente o una corrección
  necesaria invalida su exactitud y no puede ejecutarse. Nunca fabricar el agregado
  ausente ni presentarlo como recalculado desde fuentes que ya no existen.
- Cobertura, versión, supresión de celdas y fecha de cálculo acompañan el resultado.
  Un período deshabilitado no es una cohorte vacía observada. Tras borrar crudo no
  se promete recalcular con una definición nueva ni reparar detalles perdidos.
- Excluir estados mutables actuales (`confirmed`, `attended`, etc.), canjes vigentes
  y dinero de este rollup. Un estado de reserva observado hoy no es el estado de
  esa reserva al cerrar una cohorte anterior.

Plazo propuesto: 13 meses desde el cierre de la cohorte, para comparación anual.
No es almacenamiento indefinido ni anonimización garantizada: celdas pequeñas
pueden ser identificables. Antes de habilitar más de 90 días se debe aprobar una
política específica de finalidad, acceso, detalle mínimo y borrado. Hasta entonces,
el histórico agregado también caduca a los 90 días; no se publicitan 13 meses.
No se necesitan IDs de personas o sesiones para consultar esta tabla.

### Ingesta pública

- Route Handlers POST separados para iniciar sesión/intento y recibir lotes.
  No se crean sesiones como efecto de un GET, prefetch o render de página.
- Los dos bootstraps son idempotentes: después de consentir se generan y guardan
  claves UUID distintas para sesión e intento, con unicidad por negocio y tipo de
  operación. Si se pierde la respuesta después del commit, el retry devuelve la
  misma entidad y credencial vigente. Una clave vencida no crea otra entidad bajo
  la misma identidad; el cliente inicia otra con una nueva clave. La recuperación
  exige también el mismo origen web; las claves no se publican ni se registran.
  Sin storage disponible se omite la captura, sin afectar el wizard.
- El bootstrap valida negocio activo, URL pública canónica y consentimiento. El
  negocio se resuelve mediante host/slug verificados, no confiando en `businessId`
  o headers de tenant aportados libremente por el navegador.
- La credencial de escritura firmada vincula versión, negocio, sesión/intento,
  origen web exacto y vencimiento. Los claims para asociación con Booking incluyen
  además inicio, fin de ventana, retención y origen normalizado descritos arriba.
  No permite leer datos ni autorizar reservas.
  No se coloca en URLs, logs, propiedades analíticas o enlaces compartidos.
- El colector verifica firma, expiración, origen, esquema y pertenencia de IDs de
  servicio/profesional/promoción. El despliegue debe limpiar headers internos de
  tenant en el proxy; no se amplía la confianza existente por conveniencia.
- Límites iniciales: 20 eventos y 16 KiB por lote, 200 eventos por intento y por
  stream de superficie de sesión,
  10 bootstraps/minuto por IP y negocio y 30 lotes/minuto por intento. Contadores
  de rate limit aislados de los de reserva/pago. Sin rate limit distribuido en
  producción, la captura queda deshabilitada.
- IDs/secuencias se conservan al reintentar. Cola de cliente de máximo 100 eventos,
  envío cada 5 segundos o al cambiar visibilidad; dos reintentos transitorios con
  backoff. No se garantiza la entrega del último evento al cerrar la pestaña.
- Persistir evento, secuencia siguiente y revisión **atómicamente antes** de enviar;
  un único escritor por stream. La respuesta confirma cada elemento (nuevo, replay
  idéntico, rechazado); sólo se retiran los confirmados o descartes terminales. Una
  recarga o crash entre envío y respuesta no reutiliza una secuencia con otro ID.
  Detectar storage clonado al duplicar pestaña y resolver su propiedad antes de
  capturar; si no se puede garantizar escritor único, omitir captura en la copia.
  La restauración de login del wizard no sustituye este protocolo de analytics.
- Registrar huecos/descartes conocidos sin copiar el payload rechazado. Estos
  diagnósticos no detectan eventos que el navegador nunca consiguió generar; por
  eso "último observado" no se presenta como conocimiento del abandono real.
- Fallos y límites de analytics no bloquean navegación o reserva. El navegador no
  muestra errores de analytics al cliente; el panel de dueños sí diferencia falta
  de datos, captura desactivada y fallo del reporte de un resultado cero.

Los clientes pueden fabricar interacciones dentro de su propia sesión; una firma
no demuestra presencia humana. Se excluyen probes, bots conocidos y visitas
autenticadas de miembros del negocio, sin prometer detección perfecta.

La validación del snapshot opcional de Booking no exige escribir eventos ni
actualizar un intento. Si falta la credencial, es inválida o su comprobación
falla, la reserva continúa sin analítica. No se esperan llamadas externas ni se
añaden locks de analytics dentro de su transacción. Las excepciones de analítica
se manejan por separado de los errores reales de negocio; no se ocultan estos
últimos para fingir una reserva exitosa.

## 6. Origen y promociones

El dueño puede crear un enlace desde Métricas indicando canal, campaña y promoción
opcional. El enlace usa `acq=<token-opaco>` y apunta a una URL pública del propio
negocio; no ofrece redirecciones arbitrarias. La promoción referenciada debe ser
del negocio y el enlace no la aplica automáticamente.

Se guarda el primer origen de la sesión y se copia al intento. Un enlace posterior
o un cupón escrito al pagar no reemplaza esa atribución. Nombre de campaña máximo
80 caracteres, texto plano y sin datos personales. Canal mediante enum acotado.

Canal, campaña de atribución y promoción objetivo de un enlace son inmutables:
para cambiarlos se crea otro enlace. Desactivar un enlace impide nuevas atribuciones,
pero no cambia el histórico ni reemplaza el origen de sesiones vigentes. Puede
editarse la etiqueta visible, presentada como nombre actual. No borrar dimensiones
referenciadas antes de vencer el histórico; no reclasificar retroactivamente días
cerrados al renombrar una campaña o cambiar su configuración.

Para enlaces externos con UTMs: normalizar `utm_source`/`utm_medium` a canales
permitidos. `utm_campaign` sólo se vincula si contiene un ID público válido de
`AcquisitionLink` del negocio; el resto es campaña desconocida. No se persisten
URLs completas, query strings ni valores UTM arbitrarios.

Sin enlace ni UTM reconocido, el referrer se reduce a un canal por una lista de
hosts conocidos; lo demás es "directo/desconocido". Se preservan los parámetros
permitidos en perfil → reservar y redirects de alias, sin perder `ref` del sistema
de referidos ni mezclar ambos mecanismos. Un cambio de origen web no activa
fingerprinting ni vinculación entre dominios.

El reporte diferencia **campaña de llegada** de **promoción aplicada**. Los canjes
liberados/revertidos se presentan aparte de los vigentes. Nunca se usa
`redemptionCount` o `sentAt` como prueba de visitas, pagos, mensajes recibidos o ROI.

## 7. Dashboard y definiciones visibles

Ruta `/dashboard/metricas`, accesible a `owner` y `admin`; `staff` no accede a
reportes ni a gestión de enlaces. Autorización en página, DAL y cada mutación, no
sólo en navegación. Toda consulta deriva `businessId` de la sesión autenticada.

Integrar el destino en `src/lib/dashboard/navigation.ts` de la base actualizada,
incluyendo “Más” en móvil. Reutilizar componentes y vocabulario del dashboard.
No duplicar el antiguo array privado del sidebar ni reconstruir tours.

Contenido:

1. **Resumen:** visitas medibles, intentos, conversión en 24 h y reservas vinculadas.
   Separar entradas completas/parciales y ventanas abiertas. Mostrar fecha de
   activación, período, cobertura parcial y última consulta.
2. **Tendencia:** intentos y reservas de esas cohortes por día. Comparación contra
   período equivalente sólo si ambos tienen datos, ventanas maduras, definiciones
   compatibles e intervalos **conocidos** de captura comparables. Si un rango de
   28 días sólo tuvo dos días habilitados, no compararlo con otro de 28 días activos:
   suprimir el delta y mostrar "cobertura no comparable". Igual para pausas, límites
   o fallos conocidos. Esto no promete detectar toda pérdida de eventos.
3. **Embudo observado:** inicio → servicio/modalidad elegidos → fecha → hora → datos
   → envío → reserva creada. Cada hito cuenta una vez por intento, respetando su
   orden. Mostrar aparte las reservas verificadas con recorrido incompleto; no
   excluirlas del KPI general de conversión ni inventar sus hitos ausentes.
   Profesional, ramas de pago y errores tienen desgloses propios; no se obliga a
   todos a completar pasos que su flujo no presenta.
4. **Interrupciones:** último paso observado de intentos maduros sin reserva dentro
   de plazo. No garantiza ser el último paso real. Si hay huecos de secuencia o
   descartes conocidos, clasificar “medición incompleta” sin atribuir una caída a
   ese paso. Etiqueta “no completaron en 24 h”, no “abandonaron por…”.
5. **Servicios y demanda:** interés antes de resolver modalidad, selecciones,
   búsquedas sin horarios con diagnóstico cuando existe, errores, intentos con
   reserva del servicio y reservas atendidas al momento de consulta.
6. **Origen y promociones:** visitas/inicios/conversiones de la población correcta,
   campaña de llegada y canjes aplicados separados. Tablas paginadas de 25 filas,
   máximo 100 por petición, orden estable y filtros autorizados.
7. **Oportunidades:** como máximo tres señales con conteos, período, interpretación
   prudente y enlace al área que el dueño puede revisar.

Los estados actuales de reservas se etiquetan “estado al consultar”. Sin un
historial de transiciones no se promete cuándo se confirmó/atendió cada reserva
ni una reconstrucción de estados a una fecha pasada.

No mostrar un delta de "atendidas" o "confirmadas" entre cohortes recientes y
antiguas: las antiguas han tenido más tiempo para alcanzar esos estados. La madurez
de 24 h habilita la comparación de **creación** de reservas, no de atención o cobro.
Los estados actuales van en un bloque operativo separado. Comparar esos resultados
en el futuro exige ventanas de seguimiento equivalentes y timestamps autoritativos.

**Dinero:** el MVP mantiene el resumen financiero y Pagos como superficies
separadas; Métricas enlaza a ellas. No introduce cobros segmentados por servicio,
cohorte o campaña. Es posible construirlos, pero primero hay que acordar cómo
atribuir ventas de paquetes, reembolsos y contracargos entre períodos. No se usa
`finalAmount` como efectivo cobrado ni se suman nuevamente las redenciones de un
paquete. Los reportes monetarios existentes no se modifican en este alcance.

Cada porcentaje muestra numerador y denominador. Denominador cero = “sin datos”,
no 0 %. Diferencias de tasas en puntos porcentuales. Una base comparativa cero no
produce aumentos infinitos. No se estima el tráfico no consentido ni se afirma
que el funnel representa a todos los clientes.

Las series tienen tabla/texto accesible equivalente, etiquetas y contraste;
no dependen sólo del color o hover. Respeto de reduced motion, navegación por
teclado y estados vacíos/error/carga. No se incluye session replay ni lista de
identidades de quienes no reservaron.

## 8. Oportunidades sin IA

Primera regla: al menos 20 intentos completos y maduros con resultados de
disponibilidad no erróneos, al menos 5 afectados y un 30 % con alguna búsqueda
vacía en el período. Mostrar “se encontraron búsquedas sin horarios; revisa fechas,
plazos permitidos y profesionales solicitados”. Desglosar causas demostradas:
fuera de ventana, anticipación mínima, no ofrecido, sin capacidad y desconocido.
No sugerir ampliar capacidad a partir de vacíos por restricciones de fechas.
Estos umbrales son heurísticas de producto, no significancia estadística ni prueba
de ventas perdidas. Separar errores de carga y señalar si esos intentos crearon
una reserva dentro de su ventana de conversión.

Segunda regla: solicitudes con plazo de respuesta del negocio vencido. Usar
`approvalExpiresAt` y la semántica de `isDoomedHold` vigente; no mezclar con
`holdExpiresAt` de pago. Es una cola operativa al momento de consulta, no un motivo
inferido del funnel. Enlazar a Reservas.

No recomendar bajar precios, lanzar descuentos o aumentar gasto publicitario a
partir de un abandono. Sin datos suficientes, la sección explica qué falta.

## 9. Privacidad, retención y operación

La política actual está marcada como borrador legal. Este diseño no certifica
cumplimiento normativo. La activación requiere revisar aviso, finalidad, retención
y experiencia de consentimiento antes de tratar navegación real.

- Captura opt-in, no preseleccionada, sin bloquear ni condicionar la reserva.
  “Permitir métricas” y “Continuar sin métricas” con visibilidad equivalente.
- Sin identificador, bootstrap, eventos ni cola de analytics antes de aceptar.
  Sólo se conserva la preferencia de consentimiento, versionada por negocio y
  origen web durante 180 días. No usar cookies de dominio compartido.
- Retirar consentimiento detiene la captura y elimina cola/identificadores locales.
  Las solicitudes de borrado de datos ya enviados siguen el procedimiento de
  privacidad; retirar permiso no se presenta como borrado retroactivo ejecutado.
- Datos seudónimos, no “anónimos”: el enlace transaccional puede permitir relación
  indirecta. Sin nombre, teléfono, email, dirección, notas, textos de errores,
  payload de pago, identificador de cliente, IP persistida en analytics ni user
  agent completo. Las claves firmadas tampoco se registran como datos.
- Retención cruda objetivo: hasta 90 días desde el inicio de la sesión, con tolerancia
  operativa de borrado de hasta 24 horas adicionales, declarada en el aviso.
  `retentionExpiresAt` se copia desde la sesión a intentos, eventos y snapshots
  analíticos de Booking; ninguno extiende el plazo al padre. Job
  cada hora, lotes de 1.000 y máximo 10.000 filas por invocación, con continuaciones
  idempotentes hasta drenar vencidos y borrado de hijos antes que padres. Los
  snapshots de Booking tienen presupuesto de limpieza reservado; no se eliminan
  reservas, pagos ni libro contable.
- Medir backlog y antigüedad máxima de vencidos. Si la fila pendiente más antigua
  lleva 12 horas vencida, pausar nueva captura y alertar; seguir drenando y escalar
  antes de cumplir 24 horas de retraso. Un fallo de limpieza no puede quedar
  oculto por el límite por invocación. La activación exige verificar capacidad de
  drenaje mayor que la ingesta máxima permitida del piloto.
- El piloto requiere presupuestos agregados finitos de ingesta por negocio y
  global, con reserva atómica en el rate limiter distribuido. Incluyen bootstraps
  y eventos, y se dimensionan por debajo de la capacidad de drenaje verificada.
  Sin presupuestos configurados no se activa captura. Alcanzarlos pausa sólo
  analytics, registra el intervalo de cobertura parcial y deja operativa la reserva.
- Agregados diarios: por defecto 90 días; 13 meses sólo con política específica
  aprobada, según la sección 5. Conservar sus metadatos de cobertura/versión por el
  mismo plazo. No hay benchmarks entre negocios ni histórico de retención indefinida.
  Al eliminar un negocio se eliminan también sus datos analíticos y agregados.
- No equiparar ausencia de identificadores con anonimización. Definir supresión o
  agrupación de celdas pequeñas y proteger también sus desgloses complementarios;
  reducir granularidad no es por sí solo garantía de anonimato. Mientras hay crudo,
  un borrado selectivo permite recomputar las cohortes afectadas. Después no es
  posible restar la contribución de una persona sin conservar el vínculo que
  precisamente se eliminó. La política de histórico debe resolver ese caso antes
  de activarse; no prometer un borrado selectivo que el modelo no permite.
- Feature flag `OWNER_ANALYTICS_ENABLED=false` por defecto y lista explícita de
  negocios habilitados. Falta de configuración, firma o rate limit distribuido
  implica no capturar; la reserva sigue operativa.
- Guardar inicio y períodos de activación por negocio. No confundir una pausa de
  captura con ausencia de demanda. Mostrar límites históricos y días parciales.
  El kill switch global puede cortar la captura antes de cerrar todos los períodos;
  el panel debe indicarlo. Un intervalo configurado como activo no demuestra
  entrega completa de eventos: no se promete una cobertura porcentual universal.
- Consultas agregadas en servidor: detalle de hasta 90 días y tendencia histórica
  dentro de la retención aprobada. Sin lecturas abiertas de eventos crudos para el
  dueño ni cache compartida entre tenants. Índices y consultas acotadas; el rollup
  diario preserva historia, no autoriza cubos o consultas sin límite. Invalidar
  caches ante nuevas revisiones, borrados y cambios de permisos.
- Observabilidad del colector con categorías y contadores agregados. Sin campos
  libres de eventos, tokens, IDs de clientes o etiquetas de negocio en Prometheus.

## 10. Criterios de aceptación y validación

La implementación usará TDD para contratos puros y tests de integración con una
base de pruebas aislada. No ejecutar migraciones, semillas o canarios contra
producción, ni usar cuentas, cobros o mensajes reales para completar pruebas.

- Consentimiento ausente/rechazado/retirado: cero captura, reserva funcional.
- Duplicados, reload, doble submit, lotes fuera de orden y reintentos: conteos
  estables, snapshot original y ninguna alteración de la idempotencia de Booking.
- Mismo ID/payload es replay; mismo ID/datos diferentes o secuencia/ID diferentes
  es conflicto visible de captura. Crash tras commit, respuestas parciales de lote
  y pestaña con storage clonado no producen dos escritores del mismo stream.
- Commit de bootstrap exitoso seguido de respuesta perdida: reintentar devuelve
  la misma sesión/intento, sin inflar visitas o inicios. La conversión existe aunque
  se pierdan eventos intermedios: KPI correcto y recorrido incompleto explícito.
- Step opcional, `anyone`, varias modalidades, cambio de servicio, ida y vuelta
  de login: denominadores correctos y ninguna duplicación por remount.
- Abrir un servicio multimodal y salir antes de elegir modalidad deja interés,
  no selección. Secuencia servicio A → hora A → servicio B → envío B nunca acredita
  una trayectoria completa de B usando hitos de A.
- Cohortes completas/parciales, ramas de pago mostradas/elegidas y elección
  automática frente a explícita: poblaciones separadas y sin pasos inventados.
- Error de disponibilidad, resultado vacío y respuesta obsoleta: categorías
  distintas; sólo la respuesta presentada produce el dato analítico.
- Fechas fuera de ventana, anticipación mínima, día no ofrecido, capacidad agotada
  y causas mixtas: diagnóstico correcto o desconocido. La telemetría acepta la
  consulta fuera del plazo de reserva sin convertirla en falta de capacidad.
- Pago rechazado, redirect sin retorno, transferencia declarada/verificada,
  reserva sin abono, promo 100 %, paquete y confirmación manual: resultado
  tomado del servidor, no del evento visual.
- Ventanas de 24 h, entrega tardía, cambio de día/DST y conversiones fuera del
  período: cohortes y etiquetas correctas con reloj controlado.
- `createdAt` dentro de ventana con commit visible después sí cuenta; `createdAt`
  fuera no cuenta. El instante del commit no reemplaza el criterio autoritativo.
  Cambiar zona del negocio o versión no mueve cohortes ya registradas. No comparar
  estados actuales de reservas como si tuvieran el mismo seguimiento.
- Token falsificado/expirado, otro origen, IDs de otro negocio, payload excesivo,
  campos desconocidos y rate limit: rechazo sin afectar reserva/pagos.
- Sesión e intento distintos del mismo negocio: FK compuesta rechaza el cruce.
  Snapshot incompleto o origen alterado en submit: sin asociación analítica nueva.
  Eliminar profesional o archivar enlace no bloquea operaciones ni borra hechos.
- Staff, usuario sin sesión y filtros/cursors de otro negocio: sin datos ni
  mutaciones permitidas. PII o payload libre en un evento: rechazado.
- Desactivación, colector caído, reporte caído, ausencia de datos y captura parcial:
  estados distintos; nunca reemplazar un error por números cero.
- Limpieza repetida y borrado de negocio: sin huérfanos, bloqueos de reservas ni
  conservación accidental de snapshots expirados. Un backlog mayor de 10.000
  filas se drena por continuaciones; la alerta/pausa y el presupuesto separado de
  snapshots se verifican con reloj controlado.
- Rollups: maduración, sumas ponderadas, cohortes vacías/deshabilitadas, revisiones
  concurrentes, celdas que desaparecen, fallo de publicación, borrado selectivo y
  carrera entre consolidación/purga. Nunca perder retención para salvar un agregado.
  Tras vencer crudo, la tendencia publicada persiste sólo por su plazo aprobado y
  no ofrece filtros/recomputaciones imposibles. Congelación antes de la primera
  purga de fuentes; un recálculo rechazado no elimina una revisión válida publicada.
- Un rango de 28 días con dos días activos frente a 28 días activos no produce un
  delta comparativo, aun cuando todos los intentos registrados estén maduros.
- QA de escritorio y móvil, teclado, contraste y gráficos con alternativa textual.
  CI, typecheck y lint de archivos afectados; integración y E2E sintéticos antes
de declarar validada la funcionalidad.

### Ejemplos sintéticos obligatorios

Son fixtures de diseño, no pruebas ejecutadas de una implementación:

1. Diez intentos completos maduros, cuatro con reserva, de los que tres tienen
   recorrido completo y uno no: conversión principal **4/10 = 40 %**; último hito
   observado verificado = 3 y una reserva con recorrido incompleto por separado.
   Añadir tres entradas parciales con dos reservas no cambia ese 40 %: su tasa
   separada es 2/3, no se publica 6/13 como tasa del embudo completo.
2. De los diez intentos completos anteriores, cuatro convertidos, cuatro sin
   reserva con último paso conocido y dos sin reserva con huecos conocidos:
   **4 + 4 + 2 = 10**. Los dos incompletos no se asignan a una caída concreta.
3. Dos días con conversiones 1/2 y 9/90: tasa del rango **10/92 ≈ 10,87 %**, no
   el promedio simple 30 % de sus porcentajes diarios.
4. Un intento, treinta eventos y dos reservas creadas válidas: una conversión,
   dos reservas, nunca sesenta. Un intento que considera tres servicios cuenta una
   vez en el total y hasta una vez en cada fila de servicio.
5. Servicio con cero eventos de interés y una reserva verificada: una conversión
   del servicio con interés no observado; tasa sobre interés = "sin datos", nunca
   1/0 ni 100 %. La tasa general del intento conserva esa conversión.
6. A llega a hora → cambia a B → se pierde el evento de hora B → envío B → Booking B:
   conversión principal sí; máximo coherente observado hasta hora A; camino de
   conversión incompleto. Ninguna interrupción atribuida a A ni trayectoria completa
   de B construida con la hora A.

Bases de pruebas existentes a extender: `wizard-storage.test.ts`,
`funnel-session-prefill.test.ts`, `step-time-professional.test.tsx`,
`bookings-idempotency.test.ts`, `booking-retry.integration.test.ts` y suites de
pagos, promociones, autorización y navegación. Antes de escribir código se deben
releer las guías pertinentes de `node_modules/next/dist/docs/` de la base usada.

## 11. Entregas y siguiente gate

Dividir la implementación en bloques verificables: contratos/privacidad/almacenado;
captación/enlaces e integración del wizard; consultas/dashboard; QA y controles
de rollout. No activar una etapa de captura real sin los controles de retención,
consentimiento y seguridad de la misma versión.

Gates pendientes de producto/operación: aprobar la política y procedimiento de
borrado del histórico de 13 meses (si no, mantener 90 días), fijar presupuestos del
piloto mediante medición sintética de capacidad y validar consentimiento. No son
motivo para implementar recuperación de leads, IA o seguimiento comercial dentro
de este MVP. No hay migraciones ni captación real autorizadas por este documento.

Revisar este documento antes de crear el plan de implementación. La IA semanal
necesita un diseño posterior: snapshot agregado reproducible, evidencia por
recomendación, límites por volumen y autorización independiente para cualquier
acción. Esta especificación no crea una automatización semanal.

Una futura tabla `AnalyticsInsightReport` guardaría período, versión/snapshot de
métricas, recomendaciones con evidencia y estado de revisión. No se crea ahora.
El modelo recibiría agregados mínimos, nunca la cola de eventos ni datos personales;
sus textos distinguirían observación, hipótesis y acción sugerida, sin ejecutar cambios.

## 12. Referencias técnicas

- PostgreSQL: [restricciones, unicidad y relaciones compuestas](https://www.postgresql.org/docs/current/ddl-constraints.html).
- PostgreSQL: [vistas materializadas y actualización desde sus fuentes](https://www.postgresql.org/docs/current/rules-materializedviews.html).
- PostgreSQL: [semántica transaccional de los timestamps](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).
- PostHog: [definición de funnels, orden y pasos opcionales](https://posthog.com/docs/product-analytics/funnels), como contraste conceptual, no dependencia del MVP.

Contraste local principal: `prisma/schema.prisma`, `src/components/booking/wizard.tsx`,
`step-service.tsx`, `step-date.tsx`, `step-time.tsx`, `step-payment.tsx`,
`src/lib/availability/slots.ts`, `src/server/actions/bookings.ts`,
`src/server/actions/professionals.ts`, `src/lib/rate-limit.ts` y reportes de ledger.
