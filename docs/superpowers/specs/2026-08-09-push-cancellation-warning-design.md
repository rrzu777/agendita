# Web Push para aviso de cancelación — Diseño

**Estado:** aprobado en conversación y corregido tras gap review el 2026-08-09.

## Objetivo

Avisar a la clienta, sin exigirle una cuenta, antes de que cierre la ventana en
la que puede cancelar o reprogramar su cita. El mensaje explica de forma
consistente que una cancelación con menos anticipación no devuelve el abono.

La entrega conserva email y pantalla como canales durables. Web Push es un
recordatorio adicional sujeto al consentimiento del navegador; no reemplaza
ningún canal y no agrega navegación offline.

## Decisiones de producto

- `Business.selfServiceCutoffHours` es la única configuración de las **X horas**.
  Al crear la reserva se copia a `Booking.cancellationCutoffHours`; ese snapshot
  es la fuente contractual para cancelar, reprogramar, renderizar y notificar
  esa reserva. Cambiar la configuración sólo afecta reservas nuevas.
- `Business.cancellationPolicy` se copia a
  `Booking.cancellationPolicySnapshot`. Las superficies posteriores muestran el
  texto aceptado, no una política editada después. En Settings se relabela como
  “Condiciones adicionales” y se aclara que no debe repetir ni contradecir el
  plazo estructurado; el aviso generado por el sistema aparece primero y manda
  sobre texto histórico contradictorio.
- La página server-rendered calcula una revisión SHA-256 domain-separated del
  `businessId`, cutoff y condiciones adicionales que mostró. El wizard la envía
  al crear; después de resolver un eventual reintento idempotente y antes del
  insert, el servidor exige que coincida con la política vigente. Una revisión
  ausente, alterada o vieja pide recargar y no crea ni inicia pagos. Un reintento
  de una reserva ya existente devuelve sus snapshots aunque la configuración
  haya cambiado después. Las creaciones internas del dashboard están exentas.
- Se agrega `Business.cancellationReminderEnabled Boolean @default(true)` para
  que cada negocio pueda apagar únicamente el push. La política visible en
  checkout, confirmación y email no se oculta con este toggle.
- El recordatorio se programa dos horas antes del cierre de la ventana. Para una
  cita a las 15:00 y un cutoff de 24 horas, el objetivo es el día anterior a las
  13:00.
- Si la clienta activa push después del objetivo, pero todavía está antes del
  cierre, el próximo cron envía el aviso. Si el cierre ya pasó, no se envía un
  mensaje que sugiera que todavía puede cancelar.
- Sólo son elegibles reservas confirmadas, futuras y con un abono efectivamente
  pagado (`depositPaid > 0`). Un snapshot de cero horas no genera recordatorio
  porque no existe una ventana de pérdida del abono.
- La elegibilidad para **activar** Web Push es deliberadamente un poco más
  amplia que la entrega: requiere configuración VAPID/cifrado completa, toggle
  del negocio activo, reserva futura y no terminal, cutoff efectivo mayor que
  cero, y abono requerido **o** pagado. Esto permite activar antes de completar
  el checkout; el scheduler sigue enviando sólo con `depositPaid > 0` y estado
  confirmado.
- No se implementa devolución automática. El copy no la promete: “Podés
  cancelar o reprogramar hasta X horas antes. Con menos anticipación, el abono
  no se devuelve. Para cancelaciones anteriores aplica la política del
  negocio.”

## Experiencia de la clienta

### Al reservar

El checkout muestra la política vigente antes de aceptar. La pantalla final y
el email de reserva recibida/confirmada agregan el aviso estándar cuando la
reserva requiere o ya recibió un abono. La política libre permanece como texto
complementario, no como fuente del número de horas.

La pantalla final ofrece **“Activar recordatorios”**. El botón lleva a la página
canónica `https://www.agendita.cl/notificaciones` —o al host de `getAppUrl`— con
el grant en `#grant=...`. El fragmento no llega al servidor, logs ni `Referer`;
la página lo lee, ejecuta `history.replaceState` para retirarlo de la barra y
recién muestra el segundo botón que dispara el permiso del navegador. El permiso
nunca se pide al cargar una página.

Centralizar el alta evita una suscripción y un permiso distintos por cada
`negocio.agendita.cl`. `sw.js`, `PushManager` y la administración en `/mi`
viven siempre en el origen canónico. Los estados visibles son: disponible,
activando, activo, rechazado/no disponible y error recuperable.

En iOS se explica que Web Push requiere instalar Agendita en la pantalla de
inicio. No se promete soporte cuando el navegador no expone `PushManager`.

### En `/mi`

Una clienta autenticada activa o desactiva recordatorios desde su superficie de
reservas, navegando al mismo origen canónico. El enlace sólo aparece si al menos
una reserva cumple la elegibilidad completa de activación. Desactivar llama
`PushSubscription.unsubscribe()` y envía el endpoint al servidor, que lo
normaliza y hashea. Con sesión se elimina únicamente la autorización explícita
de esa cuenta en las generaciones del endpoint; con grant de invitada, sólo el
entitlement de la reserva firmada. Una fila se revoca únicamente si ya no
conserva autorización de cuenta ni entitlements de reservas.

### Al recibir el push

El título identifica al negocio. El cuerpo recuerda las X horas y la regla del
abono, pero no expone nombre de la clienta, servicio, monto ni notas en la
pantalla bloqueada. Al tocarlo se abre una URL canónica `/mi/<slug>` para una
clienta autenticada o la confirmación pública del tenant para una invitada. La
URL viene construida por el servidor; el worker rechaza destinos que no sean
HTTPS y que no pertenezcan al apex configurado o sus subdominios.

El service worker sólo implementa `push` y `notificationclick`; no registra un
handler de `fetch`, cachés ni una página offline. Se sirve con
`Cache-Control: no-cache` para recibir actualizaciones sin fijar una versión
vieja en CDN.

## Autorización para invitadas

`createBooking` emite un grant firmado y domain-separated con `bookingId`,
`customerId`, `businessId` y expiración de 24 horas. El endpoint de alta
valida firma, expiración y que esos tres valores sigan perteneciendo a la misma
reserva. Un `bookingId` aislado nunca autoriza una suscripción. Reintentar
idempotentemente la misma creación puede emitir un grant nuevo sin crear otra
reserva.

El wizard guarda el grant en `sessionStorage` del tenant antes de cualquier
redirect a Mercado Pago. Al volver a `/book/confirmation`, un componente cliente
lo recupera y arma el enlace canónico con `#grant=...`. El grant sólo aparece en
ese fragmento transitorio; no entra en query strings, emails, logs ni base. Si
una invitada recarga sin ese estado o abre luego el link del email, deberá
iniciar sesión para activar push. Esta limitación evita convertir la URL pública
de confirmación en autorización de notificaciones.

Las clientas autenticadas no necesitan ni usan el grant de invitada: en
subscribe, status y unsubscribe una sesión explícita tiene precedencia sobre un
grant recibido. La sesión permite
seleccionar Customers cuyo `userId` coincide en ese momento, pero cada alta
persiste además `PushSubscription.authorizedUserId` como scope explícito. El
cron revalida el `Customer.userId` actual y exige que coincida con ese valor; la
relación de Customer por sí sola nunca autoriza una entrega.

Las respuestas de creación y las dos confirmaciones usan un modo explícito:
`account` sólo para una Customer elegible vinculada a la sesión, `guest` sólo
cuando no existe sesión, y `null` cuando no hay autorización elegible. Nunca se
emite ni conserva un grant guest para una sesión autenticada. El status de
cuenta recalcula el set completo de Customers elegibles: el endpoint se declara
asociado sólo si cubre cada uno; un subset o un set vacío exige actualización y
no declara activación. Subscribe vuelve a asociar todo ese set actual.

## Persistencia y secretos

Se agrega `PushSubscription` con:

- `id`, `businessId` y `customerId` como relaciones de pertenencia, no como
  autorización de entrega;
- `authorizedUserId` nullable como autorización explícita de cuenta;
- `endpointHash` para localizar todas las generaciones de una capability sin
  guardar el endpoint en claro;
- `subscriptionFingerprint`, SHA-256 de la forma canónica completa
  `endpoint + p256dh + auth`, para distinguir rotaciones de claves;
- payload cifrado (`endpoint`, `p256dh`, `auth`);
- `createdAt`, `updatedAt`, `lastSuccessAt`, `revokedAt`, `failureCount` y
  `lastFailureAt`;
- unicidad por `(customerId, subscriptionFingerprint)`.

`PushSubscriptionBooking` relaciona una suscripción con cada `bookingId`
autorizado por un grant invitado. Una fila es entregable sólo si conserva el
entitlement de la reserva exacta o si su `authorizedUserId` coincide con el
usuario actual de la Customer. En particular, dos valores null nunca equivalen
a autorización.

El alta serializa por Customer para mantener exacto el máximo de cinco
dispositivos activos por scope. Las altas autenticadas usan además un lock
determinístico por `authorizedUserId + endpointHash`, resuelven de nuevo todo el
set elegible dentro de una sola transacción y toman los locks de Customer
ordenados. La baja autenticada comparte el mismo lock, por lo que no puede
intercalarse con una escritura parcial del set.

Cuando el navegador rota claves manteniendo el endpoint, el alta quita sólo el
scope actual de generaciones anteriores, conserva scopes ajenos y revoca sólo
las filas que queden huérfanas antes de contar el límite. Así una quinta o
posterior rotación repara la generación vigente en vez de quedar bloqueada por
filas obsoletas.

Cuando cambia la clave VAPID configurada, el navegador intenta primero una baja
server-side por posesión explícita del endpoint viejo y luego la baja local,
antes de crear la nueva suscripción. Ambos pasos son best effort: sus fallos no
bloquean el intento de reemplazo ni dejan las filas viejas consumiendo el cupo
cuando el servidor está disponible.

El cifrado reutiliza la infraestructura de `ENCRYPTION_KEY`. Las claves VAPID
entran por `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y
`VAPID_SUBJECT` (`mailto:soporte@agendita.cl` en producción); ningún secreto se
devuelve al cliente ni se registra. La validación de entorno exige las tres
variables VAPID juntas y exige `ENCRYPTION_KEY` cuando push está configurado,
aunque Mercado Pago esté apagado. Los endpoints validan tamaños y forma del
payload, verifican `Origin` canónico y aplican rate limiting.
Cada ruta aplica primero un bucket por IP y después un bucket global por scope;
el segundo excluye la IP y usa sólo un SHA-256 del identificador de cuenta o del
trío guest business/customer/booking, sin PII cruda en la clave Redis.

El hardening se aplica con una migración nueva y forward-only. Las filas legacy
reciben un fingerprint estable para mantener el esquema válido, pero no heredan
`authorizedUserId` ni entitlements: fallan cerrado hasta una nueva alta.

Una respuesta Web Push `404` o `410` revoca inmediatamente. `400`, `401` o `403`
incrementan `failureCount` y revocan al tercer fallo consecutivo. `429`, `5xx` y
errores de red son transitorios: registran el fallo pero no revocan. Un envío
exitoso reinicia `failureCount`.

## Programación e idempotencia

Se agregan `Booking.cancellationReminderClaimedAt DateTime?` y
`Booking.cancellationReminderSentAt DateTime?`. `sendCancellationWarnings`
busca en lotes reservas que cumplan:

- `status === confirmed`;
- `depositPaid > 0`;
- negocio con recordatorio habilitado y snapshot de cutoff mayor que cero;
- `cancellationReminderSentAt IS NULL`;
- claim nulo o anterior a `now - 10 minutos`;
- `now >= startDateTime - cancellationCutoffHours - 2h`;
- `now < startDateTime - cancellationCutoffHours`.

Antes de tocar Web Push, un `updateMany` condicionado por `SentAt: null` y claim
nulo/vencido escribe `ClaimedAt = now`. Si el proceso muere, otro run recupera
el lease después de diez minutos. Si no hay suscripción activa o todos los
envíos fallan, el claim se libera. Un éxito en al menos un dispositivo escribe
`SentAt = now` y limpia `ClaimedAt`; ese criterio deliberado evita repetir el
aviso a dispositivos que ya lo recibieron.

Para cada candidata, el cron selecciona como máximo cinco filas activas que
tengan el entitlement del `bookingId` exacto o `authorizedUserId` igual al
`Customer.userId` revalidado. Una invitada sin cuenta usa sólo entitlements; no
existe comparación `null === null`. Como la rotación retira el scope de
generaciones anteriores, sólo la generación vigente sigue siendo elegible.
Después de que el proveedor acepta el push, la escritura de éxito repite esa
misma autorización como CAS junto con id, fingerprint y `revokedAt: null`. Si
el entitlement exacto o la cuenta revalidada fueron retirados durante el envío,
el éxito stale no cuenta ni marca la reserva enviada; se reintenta contra la
generación/autorización actualmente vigente sin revocar scopes ajenos.

`/api/cron/cancellation-warnings` usa el mismo bearer `CRON_SECRET`. Un workflow
propio lo invoca cada 15 minutos; la entrega esperada queda entre 1 h 45 min y
2 h antes del cierre, más cualquier retraso de GitHub Actions. El workflow
valida HTTP y JSON: cualquier `errors > 0` falla. El mismo helper de shell se
aplica a los cuatro crons existentes, cerrando el gap operativo sin ejecutarlos
todos cada 15 minutos.

## Cambios de horario, estado y configuración

- Reprogramar limpia ambos timestamps; conserva los snapshots contractuales y
  el cron reevalúa el nuevo horario con las mismas condiciones de elegibilidad;
  si ya pasó el objetivo pero el cutoff sigue abierto, el próximo run lo envía.
- Cancelar, completar, expirar o marcar no-show vuelve la reserva inelegible.
- Cambiar el cutoff sólo afecta reservas nuevas. Apagar el toggle detiene
  ejecuciones futuras del negocio; ninguna opción retira pushes ya entregados.
- Confirmaciones que ocurren después del objetivo son elegibles sólo si aún no
  cerró la ventana.
- Reservas anteriores a la migración usan el cutoff y política actuales como
  fallback, sin intentar reconstruir históricamente algo que no fue guardado.

## Pruebas

- Unitarias del snapshot contractual, cálculo de objetivo, límites estrictos y
  copy en 0/1/N horas.
- Unitarias de pantalla final, email y estados del botón de suscripción.
- Unitarias de la revisión de política: render→action, manipulación/obsolescencia,
  reintentos idempotentes tras cambios y los caminos normal, P2002 y Mercado Pago.
- Unitarias del grant: domain separation, firma, expiración,
  reserva/customer/business cruzados, fragment cleanup y sesión autenticada.
- Unitarias del cifrado, deduplicación, revocación por código HTTP, fallos
  transitorios, cobertura completa de cuenta, precedencia auth, rotación VAPID
  con cleanup best effort y unsubscribe multi-negocio.
- Unitarias del cron: elegibilidad, claim atómico, recuperación del lease,
  concurrencia, éxito parcial, liberación del claim y reprogramación.
- Test del service worker para payload privado, cache headers y allowlist de URL.
- Test de los workflows para `errors > 0` y cadencia de 15 minutos.
- Verificación final: suite focalizada, suite completa, ESLint, `tsc --noEmit`,
  build y prueba manual real en Chromium y una PWA instalada en iOS 16.4+.

## Fuera de alcance

- Navegación offline, cache-first, background sync y precache.
- Reembolso automático de abonos por Mercado Pago o transferencia.
- Campañas promocionales por push.
- Push a dueñas/administradoras; esta entrega es para clientas.
- Corrección de los errores TypeScript preexistentes: se entrega en un PR previo
  separado para no contaminar la revisión de Web Push.

## Despliegue

La migración y el código pueden desplegarse con las claves VAPID totalmente
ausentes: la UI declara push no disponible y el cron omite envíos sin fallar
reservas. Una configuración VAPID parcial impide el build/deploy. La activación
real exige configurar VAPID en Vercel, ejecutar la migración, probar
subscribe/unsubscribe y verificar un push real antes y después del cutoff con
una reserva de prueba. El rollout empieza con un negocio y se amplía después de
confirmar entrega y ausencia de duplicados.
