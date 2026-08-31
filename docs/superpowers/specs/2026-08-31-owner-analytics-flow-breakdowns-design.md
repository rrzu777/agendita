# Desgloses del flujo — contrato propuesto para completar §7.3

Estado: aprobado por el usuario («ok dale ejecuta»); implementación en curso. Es una precisión de
un requisito omitido del MVP aprobado, no IA, analítica financiera ni otro cubo.
Fuente: `2026-08-30-owner-analytics-design.md` §4, §5, §7.3 y §10.

## Resultado visible propuesto

En Métricas, una sección «Detalle del flujo observado» muestra conteos de intentos
por tipo de elección profesional, pantalla/condición de pago, métodos ofrecidos
y elegidos, y categorías cerradas de error. Completo/parcial separados, con corte
y ventana visibles. Un intento en curso se separa de los maduros; no se compara
con cohortes que ya tuvieron24h ni se interpreta un método elegido como cobrado.

La unidad es intento, no evento, persona ni profesional atendiendo una reserva.
Los estados de elección/preparación describen el último contexto observado válido
del intento. `none`, `anyone` y `person` no se intercambian; el nombre de una persona
no se infiere de `anyone`. La elección explícita se distingue de configuración
automática/paso no requerido; no habrá ranking nominal por profesional en este
contrato, que no lo exige. Sin evidencia se muestra «no observado», no «no eligió».

Separar pantalla (`sin-abono`, `verificando`, `sin-pago-online`, `cobrar`), condición
económica (`package`, `promotion_zero`, `free_service`, `no_deposit`,
`deposit_required`) y método (`online`, `transfer`, `manual`). Los métodos ofrecidos
pueden ser varios en el mismo intento: filas no aditivas. El método elegido exige
evento explícito válido dentro de los ofrecidos del contexto vigente.

Errores: disponibilidad, validación de promoción y envío de reserva, por enums
cerrados ya capturados; nunca textos libres ni códigos promocionales. Contar una
vez cada intento/categoría en el contexto válido correspondiente. Mostrar que
un error observado no prueba abandono, pérdida comercial ni estado financiero.

## Fuente, consistencia y límites

Usar sólo crudo todavía retenido en la ventana seleccionada, máximo90d. No añadir
nuevas tablas, dimensiones históricas ni extender retención. Los granos diarios
existentes no contienen estas distribuciones: no reconstruirlas de hitos ni
convertir ausencia de detalle histórico en cero. La UI debe declarar expresamente
cuando sólo existe agregado y no se puede producir detalle verificable.

Reutilizar la validación/autorización y el reductor compartido de secuencia,
revisión y contexto. No crear otro algoritmo que una evidencia obsoleta con una
selección nueva. Preservar el contrato de conversión existente sin modificar
contadores publicados, estado Booking ni reglas de disponibilidad/pago.

El contrato técnico debe distinguir lectura correcta, sin intentos observados,
fuente incompleta/no retenida, límite excedido y error de consulta. Una lectura
incompleta no entrega contadores parciales como si fueran el total; el resumen
principal existente permanece operativo. No enviar eventos, IDs de intentos,
credenciales o datos personales al navegador del dueño.

Fijar explícitamente antes de implementación los límites de lectura de este DAL,
su relación con el tope existente10000fuentes/cohorte y la aplicación de filtros
canal/enlace/servicio sobre el crudo. No ampliar la superficie a intersecciones
históricas que el selector prohíbe. Fecha de cohorte y zona congelada se conservan.

## Validación exigida

- Una selección A→B no conserva nombre, preparación o método obsoleto de A.
- Método preseleccionado sin evento no cuenta como elección explícita.
- Cambio de paquete/promoción invalida preparación anterior; condición cero no
  acredita pago, ni checkout_redirected confirma Booking.
- Replays/secuencias desordenadas no duplican intentos/categorías.
- Contexto perdido y entrada parcial no rellenan pasos previos al consentimiento.
- Desgloses maduros/en curso y completos/parciales nunca mezclan denominadores.
- Errores/no disponible/límite/fuente retirada no se muestran como cero.
- Tenant/rol verificados y payload público mínimo; no crudo/PII/secretos.
- Evidencia funcional RED/GREEN en reductor→DAL→UI, integración con PostgreSQL
  exclusiva y prueba desktop/móvil de alcance/etiquetas.

## Precisión técnica para ejecución

La sección usa exactamente `[report.period.from, report.period.to)`, por fecha de
cohorte y zona congeladas de cada fuente. No amplía un preset para incluir hoy;
el bloque reciente existente conserva su período propio. Se publican las zonas
presentes y el corte; sin zona presente se explica la zona actual del selector.

El DTO `flowBreakdowns` tiene `status` (`available`, `empty`, `not_retained`,
`incomplete_source`, `limit_exceeded`, `error`), `from`, `to`, `cutoffAt`,
`timezones`, `scope` (`all_attempts`, `channel`, `acquisition_link`,
`final_service`) y `groups`. Sólo available/empty llevan cuatro grupos:
completo/maduro, completo/en curso, parcial/maduro y parcial/en curso. Los demás
estados llevan `groups: null`, nunca una cuenta parcial ni ceros inventados.
Cada grupo contiene intentos y cuántos tienen captura incompleta; distribuciones
de profesional (tipo y modo: explícito, paso no requerido, no observado), pantalla,
condición, método elegido y métodos ofrecidos; categorías de error. Sin observación
de pantalla/método/profesional se cuenta `not_observed`, no un hecho negativo.
Los métodos ofrecidos y errores son no aditivos; no se calculan tasas nuevas.

La proyección agrega evidencia al reductor existente; no cambia sus hitos,
conversión, reservas ni disponibilidad histórica. `flow` conserva sólo enums,
sin ID profesional. Profesional automático requiere snapshot `service_selected`
con paso no requerido; explícito requiere `professional_selected` válido. Un
contexto restaurado sin ese snapshot sólo permite modo no observado. Los cambios
de servicio/modalidad/profesional invalidan esa elección según las mismas reglas
de contexto; cambios de fecha/hora/pago conservan la elección compatible.
Pantalla/condición/métodos se invalidan con la preparación de pago existente;
una entrada parcial puede observarlos sin rellenar hitos anteriores. Un salto de
revisión sin transición borra el detalle dependiente del contexto anterior.

Errores se acumulan como un conjunto por categoría en el contexto de selección
vigente. Toda transición de contexto/revisión vacía el conjunto; resultados
asíncronos de revisión/generación anterior se ignoran. Un resultado exitoso posterior
en el mismo contexto no borra el hecho de haber observado el error. Claves cerradas:
`availability:error`; `promotion:rejected:{invalid,expired,ineligible,limit_reached,unknown}`;
`promotion:error:{network,unavailable,unknown}`;
`submission:{rejected,error}:{validation,slot_unavailable,unauthorized,network,unknown}`.
La categoría opcional de envío ausente se normaliza a unknown.

El DAL server-only se invoca únicamente después de autorizar/validar los filtros
del reporte. Lee en una transacción RepeatableRead propia, con el mismo corte,
sin cache, maxWait5s/timeout15s. Así, una excepción real de consulta/timeout del
detalle no aborta la transacción del resumen ya calculado. No es un nuevo endpoint.
No necesita leer Booking: este bloque describe observaciones, no conversiones.

Límites por lectura: máximo10000fuentes (sesiones+intentos) en TODO el rango antes
de filtrar, nunca más que el tope existente10000fuentes/cohorte; máximo200eventos
por intento y50000eventos de intento en total. Leer fuentes con sentinela10001; eventos por
páginas de50intentos con sentinela10001. No truncar. El conteo de sesiones sólo
sirve de guardia de carga, no agrega visitas a los denominadores. No se leen sus
eventos de superficie: verificar acceptedEventCount se refiere a streams de intento.
Predicados por
negocio, rango elapsed acotado que cubre offsets y fecha de cohorte congelada.
No ampliar estos límites silenciosamente; el mensaje recomienda acortar el rango.

Antes de entregar grupos verificar toda fuente del rango, aun si un filtro la
excluiría. Marcadores frozen o fuentes vencidas significan not_retained. Discrepancia
acceptedEventCount/eventos, payload persistido inválido o versión no soportada
significan incomplete_source. Las marcas conocidas de captura/huecos de secuencia
sin pérdida de filas siguen como calidad de observación, no purga inventada.
Una lectura correcta sin intentos es empty (no afirma tráfico cero ni captura activa).
Todo fallo abandona el detalle completo, no publica el prefijo leído.

Canal/enlace usan la atribución inmutable del intento. Servicio selecciona sólo
el último contexto válido (`finalContext.serviceId`), no cualquier interés pasado;
la UI dice «servicio del último contexto observado». No cruza filtros ni cambia
las tablas históricas de interés/conversión. Conteos y DTO no incluyen identidades
de sesiones/intentos/eventos, tokens, datos personales ni IDs de profesional.

## Aprobación

El usuario confirmó la ejecución después de la solicitud de aprobación. La
precisión técnica anterior fija límites conservadores y contratos internos dentro
de esa semántica; no introduce nuevos fines, retención, IA ni activación productiva.
