# Web Push para aviso de cancelación — Diseño

**Estado:** aprobado en conversación el 2026-08-09.

## Objetivo

Avisar a la clienta, sin exigirle una cuenta, antes de que cierre la ventana en
la que puede cancelar o reprogramar su cita. El mensaje explica de forma
consistente que una cancelación con menos anticipación no devuelve el abono.

La entrega conserva email y pantalla como canales durables. Web Push es un
recordatorio adicional sujeto al consentimiento del navegador; no reemplaza
ningún canal y no agrega navegación offline.

## Decisiones de producto

- `Business.selfServiceCutoffHours` es la única fuente de las **X horas**. No se
  crea otra configuración capaz de contradecir la regla que ya aplica el
  servidor al cancelar y reprogramar.
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
  pagado (`depositPaid > 0`). `selfServiceCutoffHours === 0` no genera este
  recordatorio porque no existe una ventana de pérdida del abono.
- No se implementa devolución automática. El copy no la promete: “Podés
  cancelar o reprogramar hasta X horas antes. Con menos anticipación, el abono
  no es reembolsable. Para gestionar una devolución anterior al límite,
  contactá al negocio.”

## Experiencia de la clienta

### Al reservar

El checkout sigue mostrando la política antes de aceptar. La pantalla final y
el email de reserva recibida/confirmada agregan el aviso estándar cuando la
reserva requiere o ya recibió un abono. La política libre del negocio permanece
como texto complementario, no como fuente del número de horas.

La pantalla final ofrece un botón explícito **“Activar recordatorios”**. El
permiso del navegador sólo se solicita después de ese gesto; nunca al cargar la
página. Los estados visibles son: disponible, activando, activo, rechazado/no
disponible y error recuperable.

En iOS se explica que Web Push requiere instalar Agendita en la pantalla de
inicio. No se promete soporte cuando el navegador no expone `PushManager`.

### En `/mi`

Una clienta autenticada puede activar o desactivar recordatorios desde su
superficie de reservas. Desactivar revoca la suscripción local y marca las
filas correspondientes como revocadas en el servidor.

### Al recibir el push

El título identifica al negocio. El cuerpo recuerda las X horas y la regla del
abono. Al tocarlo se abre la URL de confirmación de esa reserva. El service
worker sólo implementa `push` y `notificationclick`; no registra un handler de
`fetch`, cachés ni una página offline.

## Autorización para invitadas

`createBooking` y cada transición server-side que devuelve una confirmación al
navegador emiten un grant firmado con `bookingId`, `customerId`, `businessId` y
expiración de 24 horas. El endpoint de alta valida firma, expiración y que esos
tres valores sigan perteneciendo a la misma reserva. Un `bookingId` aislado
nunca autoriza una suscripción.

El grant se conserva sólo en memoria/sessionStorage hasta completar el alta; no
se agrega a URLs, emails, logs ni a la base. Si una invitada recarga o abre luego
el link del email, deberá iniciar sesión para activar push. Esta limitación es
preferible a convertir la URL pública de confirmación en autorización de una
capability de notificaciones.

Las clientas autenticadas usan su sesión y ownership de `Customer.userId`; no
necesitan el grant de invitada.

## Persistencia y secretos

Se agrega `PushSubscription` con:

- `id`, `businessId`, `customerId` y `userId?`;
- `endpointHash` para búsqueda/deduplicación sin exponer la capability URL;
- payload de suscripción cifrado (`endpoint`, `p256dh`, `auth`);
- `createdAt`, `updatedAt`, `lastSuccessAt`, `revokedAt` y `failureCount`;
- unicidad por `(customerId, endpointHash)`.

El cifrado reutiliza la infraestructura de `ENCRYPTION_KEY`. Las claves VAPID
entran por `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y
`VAPID_SUBJECT`; ningún secreto se devuelve al cliente ni se registra en logs.
Los endpoints validan tamaños y forma del payload y aplican rate limiting.

Una respuesta Web Push `404` o `410` revoca la suscripción. Los demás fallos
incrementan `failureCount`; después de fallos permanentes consecutivos se deja
de intentar hasta una nueva suscripción.

## Programación e idempotencia

Se agrega `Booking.cancellationReminderSentAt DateTime?`. Un core separado
`sendCancellationWarnings` busca en lotes reservas que cumplan:

- `status === confirmed`;
- `depositPaid > 0`;
- negocio con recordatorio habilitado y cutoff mayor que cero;
- `cancellationReminderSentAt IS NULL`;
- `now >= startDateTime - cutoffHours - 2h`;
- `now < startDateTime - cutoffHours`.

Antes de tocar Web Push, un `updateMany` condicionado por
`cancellationReminderSentAt: null` reclama atómicamente la reserva. Si no hay
ninguna suscripción activa, o todos los envíos fallan, el claim se libera para
permitir retry. Un éxito en al menos un dispositivo conserva el timestamp y
evita duplicados del cron at-least-once.

El endpoint `/api/cron/cancellation-warnings` usa el mismo bearer
`CRON_SECRET`. `.github/workflows/cron.yml` lo invoca cada hora y valida tanto
el HTTP como el JSON: cualquier `errors > 0` falla el step. La misma validación
se aplica a los cuatro crons existentes, cerrando el gap operativo ya detectado.

## Cambios de horario y estado

- Reprogramar una reserva limpia `cancellationReminderSentAt`; el nuevo horario
  genera un recordatorio nuevo si corresponde.
- Cancelar, completar, expirar o marcar no-show la vuelve inelegible por status.
- Cambiar el cutoff o apagar el toggle afecta ejecuciones futuras; no intenta
  retirar pushes ya entregados.
- Confirmaciones que ocurren después del objetivo son elegibles sólo si aún no
  cerró la ventana.

## Pruebas

- Unitarias del cálculo de objetivo, límites estrictos y copy en 0/1/N horas.
- Unitarias de pantalla final, email y estados del botón de suscripción.
- Unitarias de grant: firma, expiración, reserva/customer/business cruzados y
  sesión autenticada.
- Unitarias del cifrado, deduplicación, revocación `404/410` y retry.
- Unitarias del cron: elegibilidad, claim atómico, concurrencia, éxito parcial,
  liberación del claim y reprogramación.
- Test del service worker para payload y URL permitida; la URL se construye en
  servidor y el worker sólo acepta rutas same-origin.
- Test del workflow para asegurar que un JSON con `errors > 0` devuelve exit no
  cero.
- Verificación final: suite focalizada, suite completa, ESLint, `tsc --noEmit`,
  build y prueba manual real en Chromium y una PWA instalada en iOS 16.4+.

## Fuera de alcance

- Navegación offline, cache-first, background sync y precache.
- Reembolso automático de abonos por Mercado Pago o transferencia.
- Campañas promocionales por push.
- Push a dueñas/administradoras; esta entrega es para clientas.

## Despliegue

La migración y el código pueden desplegarse con las claves VAPID ausentes: la
UI debe declarar push no disponible y el cron omitir envíos sin fallar reservas.
La activación real requiere configurar VAPID en Vercel, ejecutar la migración,
probar subscribe/unsubscribe y verificar un push real antes y después del cutoff
con una reserva de prueba. El rollout empieza con un negocio y se amplía después
de confirmar entrega y ausencia de duplicados.
