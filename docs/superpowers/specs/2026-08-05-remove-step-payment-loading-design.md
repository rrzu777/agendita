# Eliminar el estado redundante de carga en StepPayment

## Objetivo

Eliminar `loading` y las ramas visuales que dependen de él en `StepPayment`, sin cambiar el flujo de creación de reservas ni pagos.

## Decisión

Se elimina el estado en vez de derivarlo desde `paso`. Los tres handlers que lo activan también cambian inmediatamente `paso` a `processing`; esa rama reemplaza el formulario completo por el spinner antes de que cualquier botón pueda mostrar el texto de carga. Derivar `loading` conservaría condiciones inalcanzables y no aportaría protección adicional.

Los botones visibles en las pantallas de revisión seguirán bloqueados por `acceptedTerms`. La protección durante el envío seguirá siendo la transición exhaustiva a `{ k: 'processing' }`, que desmonta los controles de envío.

## Alcance

- Quitar `useState(false)` para `loading`.
- Quitar los tres pares `setLoading(true)` / `setLoading(false)`.
- Quitar `loading` de los `disabled` de botones que sólo se renderizan en pantallas de revisión.
- Reemplazar los cinco textos ternarios por su texto alcanzable.
- Quitar `loading` del botón para eliminar una promoción.
- No modificar handlers, payloads, pasos, reglas de pago ni mensajes de las pantallas de procesamiento y error.

## Validación

No se agrega un test que inspeccione el símbolo `loading`: sería un detector de implementación, no de comportamiento. Los tests existentes de `StepPayment` verifican la transición real a procesamiento, la creación única de la reserva y el avance por transferencia. Se ejecutarán focalizados, seguidos de la suite completa, lint, typecheck/build y revisión independiente.
