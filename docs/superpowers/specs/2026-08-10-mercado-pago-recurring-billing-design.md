# Facturación recurrente y endurecimiento de Mercado Pago

**Estado:** aprobado para planificación.

## Contexto

Agendita tiene dos circuitos financieros distintos:

1. La dueña paga a Agendita una mensualidad SaaS.
2. La clienta paga una reserva o paquete directamente a la cuenta Mercado Pago
   conectada por la dueña.

El segundo circuito ya tiene Checkout Pro multi-tenant mediante OAuth, pero su
QA sandbox y la resolución inicial del webhook tienen gaps. El primer circuito
todavía es manual durante la beta: los modelos locales de suscripción existen,
pero no hay autorización recurrente, facturas automáticas ni sincronización con
Mercado Pago.

Este diseño implementa ambos circuitos sin mezclar credenciales, eventos ni
efectos contables.

## Objetivos

- Cobrar automáticamente una mensualidad a cada negocio mediante la API de
  Suscripciones de Mercado Pago y checkout alojado.
- Ofrecer 30 días de prueba por defecto, configurables por negocio.
- Permitir exenciones manuales de family & friends hasta una fecha, sin pedir ni
  cobrar una tarjeta de manera sorpresiva.
- Dar siete días de gracia configurables ante un cobro fallido y suspender sólo
  cuando el enforcement esté habilitado.
- Cancelar al final del periodo ya pagado, sin renovación ni reembolso
  automático.
- Mantener el plan asignado por un administrador; no ofrecer cambios autónomos
  ni prorrateos en esta entrega.
- Corregir y validar el flujo sandbox y el webhook multi-tenant de pagos de
  reservas y paquetes.
- Hacer todos los cambios financieros idempotentes, auditables y reconciliables.

## No objetivos

- Planes anuales.
- Selección o cambio autónomo de plan.
- Prorrateos, cupones, impuestos o emisión de documentos tributarios.
- Split payments o comisión de plataforma sobre servicios.
- Capturar o almacenar tarjetas dentro de Agendita.
- Reembolsos automáticos de mensualidades.
- Migrar suscripciones a otro proveedor.

## Separación de los circuitos

### Mensualidad dueña a Agendita

Usa exclusivamente la credencial vendedora de Agendita. Un módulo dedicado crea
y consulta planes, autorizaciones recurrentes y facturas de la API de
Suscripciones. Tendrá callback, webhook y referencias externas propias. Ningún
token de `PaymentAccount` participa en este circuito.

### Pago clienta a dueña

Conserva Checkout Pro con el token OAuth cifrado de la dueña correspondiente. El
Access Token de Agendita no puede utilizarse para consultar, aprobar ni aplicar
un pago perteneciente a otra cuenta vendedora.

La ruta actual no debe depender de consultar primero `/v1/payments/{id}` con el
token global. El negocio se resolverá desde una referencia local no secreta y
validada incluida en la notificación o mediante un índice local persistido al
crear la preferencia. Sólo entonces se consultará el pago con el token OAuth de
ese negocio y se validarán ID, vendedor, referencia, metadata, monto y moneda.

## Modelo de datos

### Plan

Mantiene el precio mensual autoritativo y suma la configuración necesaria para
la prueba predeterminada. La correspondencia externa no será un único campo
global en `Plan`: sandbox y producción deben poder tener IDs distintos. Se usará
una entidad de mapeo por `planId`, proveedor y entorno, con un ID externo único y
estado de sincronización.

### BusinessSubscription

Será la fuente de verdad para facturación y añadirá:

- proveedor y entorno (`sandbox` o `production`);
- ID externo de la autorización recurrente y del plan asociado;
- precio contratado y moneda, como snapshot independiente de futuros cambios;
- próxima fecha de cobro y fecha del último cobro aprobado;
- `pastDueAt`, `graceEndsAt` y días de gracia configurados;
- `cancelAtPeriodEnd` y fecha de solicitud;
- `complimentaryUntil` y motivo interno;
- versión de sincronización o fecha de última reconciliación.

El ID externo tendrá unicidad condicionada por proveedor y entorno. Sólo podrá
existir una suscripción facturable vigente por negocio.

`BusinessSubscription.status` será la fuente de verdad. El campo compatible
`Business.subscriptionStatus` se actualizará dentro de la misma transacción en
cada transición para que el enforcement actual no diverja.

### SubscriptionPayment

Cada factura o cobro recurrente persistirá:

- ID externo del pago y, cuando corresponda, ID de factura autorizada;
- monto y moneda recibidos;
- estado del proveedor normalizado;
- método de pago sanitario, sin datos de tarjeta;
- timestamps de aprobación y última actualización;
- payload reducido y sin secretos para diagnóstico.

Los IDs externos tendrán índices únicos. Un reintento del mismo evento devolverá
éxito sin duplicar el pago, extender el periodo ni repetir efectos.

### Auditoría

Toda asignación, extensión o retiro de exención; activación; mora; recuperación;
suspensión; solicitud de cancelación y reconciliación manual se registrará en
`SubscriptionLog`, incluyendo actor administrativo cuando aplique. Nunca se
guardarán credenciales ni cuerpos crudos del proveedor.

## Ciclo de vida

### Trial

El trial dura 30 días por defecto y puede configurarse por negocio. La dueña
puede registrar su medio de pago antes del vencimiento mediante el checkout
alojado; Mercado Pago queda autorizado para cobrar cuando termine la prueba.
Agendita envía avisos 7, 3 y 1 día antes.

Si termina el trial sin autorización de pago, la suscripción pasa a `past_due` y
comienza la gracia. No se inventa un pago ni se marca `active` por el redirect.

### Exención family & friends

Un administrador puede definir `complimentaryUntil` y un motivo. Mientras la
fecha esté vigente:

- no se solicita tarjeta;
- no se crea autorización recurrente;
- no se consume el trial;
- no se generan cobros;
- el negocio mantiene acceso.

Se notificará 7, 3 y 1 día antes. Al vencer, la dueña deberá iniciar la
suscripción; no habrá cargo retroactivo ni automático sin consentimiento. Si no
lo hace, pasa a `past_due` con la misma gracia configurada.

### Cobro aprobado

Un cobro sólo se aplica después de consultar el objeto en Mercado Pago con la
credencial correcta y validar cuenta vendedora, suscripción, referencia, monto y
moneda. La transacción local crea o actualiza `SubscriptionPayment`, avanza el
periodo una sola vez, limpia mora y sincroniza ambos campos de estado a `active`.

### Cobro fallido

El primer fallo terminal o vencimiento sin autorización establece `past_due`,
`pastDueAt` y `graceEndsAt` con siete días por defecto. Mercado Pago puede
reintentar. Un cobro aprobado dentro de la gracia recupera `active`.

Al vencer la gracia, el cron marca `suspended` sólo si
`SUBSCRIPTION_ENFORCEMENT_ENABLED=true`. Con el flag apagado registra el caso y
alerta, pero no bloquea el negocio. La suspensión impide nuevas reservas y
conserva datos, acceso administrativo e historial.

### Cancelación

La dueña solicita cancelación desde Facturación. La autorización externa se
configura para no renovar y localmente se marca `cancelAtPeriodEnd`. El negocio
mantiene acceso hasta `currentPeriodEnd`; luego pasa a `cancelled`. No hay
reembolso automático. Una cancelación o pausa externa inesperada se reconcilia y
notifica, sin asumir que equivale a pago aprobado.

## Integración con Mercado Pago

### Checkout y retorno

La pantalla de Facturación inicia la creación de la suscripción y redirige al
checkout alojado. El retorno sólo muestra un estado provisional y dispara una
consulta sanitaria; nunca confirma dinero. Webhook o reconciliación verificable
son las únicas entradas que aplican cambios financieros.

### Webhook de suscripciones

Se implementará una ruta independiente de la de reservas. La ruta:

1. conserva el body necesario y valida la firma con comparación constante;
2. rechaza timestamps fuera de tolerancia cuando esté configurada;
3. identifica el tipo de evento y su ID;
4. consulta el recurso real con la credencial de Agendita;
5. resuelve la suscripción local por ID externo o referencia firmada;
6. valida vendedor, monto, moneda y relación con el plan;
7. aplica una transición idempotente en transacción;
8. responde 2xx a duplicados ya procesados.

Los eventos desconocidos se registran de forma sanitaria y responden sin aplicar
efectos. Los errores transitorios devuelven un código reintentable; las
inconsistencias de seguridad no modifican estado.

### OAuth multi-tenant

El modo sandbox debe estar explícito en configuración server-only. El intercambio
OAuth sandbox incluirá `test_token: true`; producción nunca lo incluirá. Los IDs
y tokens de ambos ambientes no pueden compartir filas ni configuración.

Los refresh tokens se usarán mediante una operación atómica: cifrar el nuevo par,
actualizar expiración y conservar la conexión sólo tras una respuesta válida. Un
fallo definitivo marca la cuenta `expired` y pide reconexión; no cae al token
global.

## Configuración y rollout

- `MP_SUBSCRIPTIONS_ENABLED` habilita creación y gestión de mensualidades.
- `SUBSCRIPTION_ENFORCEMENT_ENABLED` habilita suspensión automática.
- El modo Mercado Pago será explícito y fail-closed; sandbox y producción usarán
  credenciales y recursos externos diferentes.
- La configuración se validará al arrancar y en el health profundo sin exponer
  valores.
- La primera activación productiva se limitará a negocios seleccionados mediante
  una allowlist persistida o flag por negocio, no por lógica basada en nombres o
  emails.

Orden de rollout:

1. tests locales y de integración simulada;
2. migración forward-only;
3. ciclo completo sandbox de mensualidad;
4. ciclo completo sandbox de pago clienta a dueña;
5. producción para negocios seleccionados con enforcement apagado;
6. observación y reconciliación;
7. activación explícita del enforcement.

## Procesos programados

Un cron diario enviará avisos de trial/exención a 7, 3 y 1 día, sin repetir el
mismo aviso. Otro cron reconciliará suscripciones externas y aplicará vencimientos
de gracia y cancelaciones al cierre. Ambos usarán bloqueo/idempotencia para que
ejecuciones concurrentes no dupliquen efectos.

La reconciliación no reemplaza webhooks: repara eventos perdidos y detecta drift.
Nunca debe degradar un estado local ante una respuesta incompleta o un timeout.

## Administración y UI

Facturación mostrará plan, trial o exención, próxima fecha, estado, gracia,
historial, CTA de activación y cancelación al cierre. No mostrará IDs externos ni
secretos.

El panel administrativo permitirá:

- asignar el plan mensual;
- configurar trial y gracia;
- asignar, extender o retirar una exención con motivo;
- habilitar un negocio para el rollout;
- consultar estado local y externo sanitario;
- solicitar reconciliación;
- solicitar cancelación al cierre.

Una reconciliación manual consulta al proveedor y aplica la misma máquina de
estados; no ofrece botones para marcar arbitrariamente un pago como aprobado.

## Notificaciones

Se enviarán correos ante:

- vencimiento próximo de trial o exención: 7, 3 y 1 día;
- suscripción activada;
- cobro aprobado;
- cobro fallido e inicio de gracia;
- recuperación después de reintento;
- suspensión;
- cancelación solicitada y cancelación efectiva;
- token OAuth de negocio expirado o conexión perdida.

Los fallos de notificación no revierten transacciones financieras. Se registran
para reintento y observabilidad.

## Seguridad y observabilidad

- No se almacenan datos de tarjeta.
- Todos los tokens permanecen cifrados y server-only.
- Ningún log contiene tokens, secretos, contraseñas, payloads crudos, URLs de
  checkout ni datos personales innecesarios.
- Webhooks validan firma y consultan la fuente autoritativa antes de aplicar.
- Monto, moneda, vendedor, referencia y tenant deben coincidir.
- Métricas sanitarias separan mensualidades de pagos de servicios: recibidos,
  duplicados, rechazados, reconciliados, en mora y suspendidos.

## Estrategia de pruebas

### Unitarias

- Máquina de estados, trial, exención, gracia y cancelación al cierre.
- Normalización de estados externos.
- Validación de monto, moneda, vendedor y referencias.
- Selección sandbox/producción y presencia de `test_token` sólo en sandbox.
- Idempotencia de pagos, eventos y notificaciones.

### Integración

- Webhook duplicado y eventos fuera de orden.
- Cobro aprobado concurrente con cron de suspensión.
- Cobro aprobado concurrente con cancelación.
- Reconciliación después de webhook perdido.
- Refresh OAuth concurrente y fallo definitivo.
- Atomicidad entre `BusinessSubscription.status` y
  `Business.subscriptionStatus`.

### Sandbox

- Dueña de prueba autoriza mensualidad a Agendita y se registra el cobro.
- Fallo/reintento observable y recuperación.
- Cancelación conserva acceso hasta el cierre.
- Negocio exento no crea autorización ni recibe cobros.
- Dueña vendedora conecta OAuth sandbox.
- Cliente comprador paga reserva y paquete a esa dueña.
- El dinero de prueba y el pago quedan asociados al vendedor correcto.

El paso del tiempo de 30 días y siete días se validará con reloj inyectable y
tests; el sandbox valida contratos externos, no sustituye esas pruebas
temporales.

## Criterios de aceptación

- Una dueña puede autorizar una mensualidad una vez y los cobros posteriores se
  registran automáticamente.
- Ningún redirect confirma dinero.
- Reenvíos y concurrencia no duplican pagos, periodos ni notificaciones.
- Trial, exención, gracia, suspensión y cancelación siguen las reglas aprobadas.
- Con enforcement apagado no se suspende ningún negocio automáticamente.
- Un pago de una clienta se verifica únicamente con el token OAuth de su dueña.
- Sandbox nunca mezcla IDs o tokens con producción.
- La pérdida de un webhook se corrige mediante reconciliación.
- Los dos circuitos completan QA sandbox independiente antes del rollout
  productivo.
