-- El EXCLUDE que impide dos citas encimadas era por NEGOCIO. Con varias personas
-- atendiendo eso rechaza justamente lo que hay que permitir: Ana a las 10:00 y Juan a
-- las 10:00. La capa lógica ya sabía separarlas (`bookingBlocksProfessional`), pero el
-- insert moría igual con un 23P01 sobre un horario que la pantalla acababa de ofrecer
-- como libre. Se recrea el constraint con la persona adentro.
--
-- COALESCE y no la columna cruda, y es lo único que hace que esto sea seguro: adentro
-- de un EXCLUDE dos NULL NUNCA chocan, porque `NULL = NULL` es unknown. Con
-- "professionalId" WITH = a secas, las reservas SIN persona —o sea TODAS las de hoy, y
-- todas las de un negocio de una sola persona para siempre— dejarían de chocar entre
-- sí: la protección contra la doble reserva se apagaría en silencio, que es la peor
-- forma en que puede fallar esta tabla.
--
-- Sobre los datos que ya existen es un no-op EXACTO: hoy todas las filas tienen
-- professionalId NULL, así que COALESCE devuelve '' para todas y el constraint se
-- comporta igual que el viejo. Por eso el ALTER no puede fallar por datos, y por eso
-- no hace falta chequear producción antes (a diferencia de meter
-- `pending_confirmation` en el WHERE, que sí TIGHTENS y sigue pendiente).
--
-- `btree_gist` ya está instalada desde la migración `init` — la necesita el
-- "businessId" WITH = que ya estaba.
--
-- Invisible en schema.prisma: el lenguaje de Prisma no expresa un EXCLUDE. Este
-- archivo es la única definición.

ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_no_overlap";

ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_no_overlap"
EXCLUDE USING gist (
  "businessId" WITH =,
  (COALESCE("professionalId", '')) WITH =,
  tsrange("startDateTime", "endDateTime", '[)') WITH &&
)
WHERE (
  status IN ('pending_payment', 'confirmed', 'completed')
);
