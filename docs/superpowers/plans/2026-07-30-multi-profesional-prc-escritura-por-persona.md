# Track 5 — PR C: el horario y los bloqueos se pueden guardar a nombre de una persona

**Qué entrega:** la ESCRITURA por persona. El horario propio (materializar, editar un
día, soltarlo) y el dueño en el alta de bloqueos sueltos y recurrentes. **Sin pantalla**:
ninguna superficie llama todavía a nada de esto con una persona, así que **desde la UI**
no hay estado nuevo alcanzable, igual que el PR B. Dicho con precisión: las actions
están exportadas y una dueña podría invocarlas con un id real, así que el sistema sí
admite el estado nuevo — lo que no existe es el camino de pantalla.

**Qué NO entrega:** el selector en Disponibilidad y el editor por persona. Van en el PR
siguiente, y por eso este PR no toca ni un texto de la UI — la regla del repo es que la
pantalla no prometa lo que habilita el PR de después.

---

## Por qué la escritura va antes que la pantalla

Mismo motivo que invertí B y C: si la pantalla llega primero, la dueña le da horario
propio a Juan y el funnel lo ignora. Con la escritura primero, no hay estado nuevo
alcanzable desde ninguna pantalla — nadie puede quedar a mitad de camino.

## La materialización es el único lugar peligroso

`resolveRuleScope` (PR B) decide la herencia con **una sola pregunta**: ¿esta persona
tiene alguna fila propia? Una sola alcanza para cortar la herencia, y la herencia es
**todo-o-nada, no por día**.

Eso convierte a la copia en el punto caro del PR: **materializar sólo el día que se está
editando deja a esa persona cerrada de martes a domingo**, sin error en ningún lado. Por
eso:

- `materializeProfessionalSchedule` copia **los 7 días en un solo `createMany`**;
- la copia pasa por `projectWeek`, la misma proyección que usa la lectura, así que las
  dos puntas no pueden discrepar sobre qué es "la semana";
- el test de regresión afirma `toHaveLength(7)` sobre el `createMany`, y el de
  integración afirma que el domingo que el salón no tiene queda **cerrado**, no abierto.

### Y por qué hay un advisory lock

Dos pestañas guardando dos días distintos leen las dos "no tiene horario propio" y
copian la semana dos veces. `AvailabilityRule` **no tiene unique** sobre
`(businessId, professionalId, dayOfWeek)` — sólo índices—, así que la base no lo
atajaría: quedan 14 filas, la mitad de los días con dos horarios, y ningún error. El
lock va keyed por `(negocio, persona)` y **antes** del `count`; hay un test del orden.

## El editor por persona escribe por `(persona, día)`, no por id de regla

Cuando alguien hereda no tiene ninguna fila propia, así que no hay id que mandar. Pero
el motivo de fondo es otro y es un guard: **`getProfessionalSchedule` no devuelve ids**.
Si los devolviera, la pantalla de Juan tendría en la mano exactamente lo que hace falta
para editar el horario del salón creyendo que edita el de Juan — las filas que se le
muestran mientras hereda *son* las del salón.

`inherited: true/false` viaja aparte para que la pantalla pueda decir de dónde salió lo
que está mostrando.

## Asimetría deliberada: crear lleva dueño, editar no

`createTimeBlock` y `createTimeBlockSeries` reciben `professionalId`. `updateTimeBlock`
**no**: editar hora y motivo no cambia de quién es el bloqueo, y reasignarlo es otra
operación con otra pregunta encima (qué pasa con las reservas que ese cambio deja
tapadas o destapadas). El split de series ya arrastraba el dueño desde el PR A.

`professionalId` es **obligatorio** en la entrada de las dos actions de alta, no
opcional con default: es lo que obliga a cada caller a decidir. Un `undefined` que se
cuele se normaliza a "del salón", que es el lado conservador — choca contra todo en vez
de contra nada.

## Tres cosas que ya estaban mal y este PR arregla

1. **`serviceFitAddendum` simulaba el fit con el horario del salón siempre.** Ahora toma
   `professionalId` y usa el mismo alcance en las dos puntas (reglas y bloqueos). El
   aviso sobre las vacaciones de Juan no puede contar el franco de Ana.
2. **Los tres contadores de onboarding** (`dashboard/page.tsx`,
   `dashboard/onboarding/page.tsx`, `onboarding.ts`) contaban las reglas de todo el
   mundo. Como booleano sobrevivía; como número mostrado, un salón de 4 personas dice
   28 días de atención. Van con `professionalId: null`.
3. **La siembra estaba escrita a mano en cuatro lugares.** Dos se unificaron en
   `DEFAULT_WEEKLY_SCHEDULE` (`create-for-user.ts`, `recover-business.ts`). Las otras
   dos —`prisma/seed.ts` y `src/lib/data/mock-store.ts`— **no pueden importarla**: el
   seed corre con `ts-node` en CommonJS sin resolución de alias. Queda documentado en la
   constante porque la del seed es la que muerde: mover el sábado acá y no allá rompe
   los e2e de disponibilidad por una diferencia que no aparece en ningún diff.

## Decisiones que el PR de la pantalla tiene que tomar

- **Hay dos modelos de "la semana" conviviendo.** El editor del salón escribe **por id
  de regla** y sólo ve las filas que existen (6 días); el editor por persona escribe por
  `(persona, día)` sobre una semana proyectada de 7. Consecuencia visible hoy: el salón
  **no puede abrir el domingo** —no hay fila, no hay id, no hay camino— y una persona sí.
  Lo correcto de fondo es una sola escritura `setWeekday({ businessId, professionalId,
  dayOfWeek, ... })` con `null` = salón, que jubila `updateAvailabilityRule` por id. Si
  la pantalla se construye sin unificar, los dos editores quedan para siempre.
- **La materialización es "si no tiene ninguna, copiar 7" y debería ser "asegurar que
  existan los 7".** Una fila propia parcial —hoy ningún camino la crea, pero un backfill
  sí— deja a la persona con 1 día abierto y 6 cerrados, y la materialización **nunca** la
  arregla porque ya tiene filas propias.
- **El lock está compensando un unique que falta.** Con un unique sobre
  `(businessId, professionalId, dayOfWeek)` —y `NULLS NOT DISTINCT`, que es PG15+, o un
  unique parcial para las filas del salón— la doble copia sería imposible aunque un
  camino futuro se olvide del lock. Necesita migración y limpiar duplicados previos.
- **`isProfessionalOfBusiness` exige `isActive` en todas las superficies**, así que a
  alguien en pausa tampoco se le puede soltar el horario propio. Es prolijo pero traba
  la salida de emergencia; se decide cuando la pantalla defina si muestra a la gente
  pausada.

## Lo que queda para el PR siguiente

- Selector de persona en Disponibilidad + editor semanal por persona (`inherited` y el
  botón de soltar el horario propio).
- El diálogo de bloqueo preguntando de quién es.
- La lista de bloqueos diciendo de quién es cada uno: hoy `getTimeBlocks` los trae todos
  del negocio y la pantalla no distingue. Mientras nadie pueda crear un bloqueo de una
  persona, no hay estado en el que eso se vea; con la pantalla, sí.
