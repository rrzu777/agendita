# Desgloses del flujo — contrato propuesto para completar §7.3

Estado: propuesta pendiente de aprobación; no implementada. Es una precisión de
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

## Aprobación pendiente

Se pidió al usuario confirmar esta semántica de último contexto observado,
poblaciones separadas y detalle sólo desde crudo retenido. No se considera aprobado
por la existencia del documento. La edición de etiquetas G1 avanza por separado,
porque ya estaba definida en el diseño original.
