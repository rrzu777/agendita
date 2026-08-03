-- `pending_confirmation` entra al EXCLUDE `Booking_no_overlap`. Era el único estado
-- que ocupa cupo para la app y no tenía red en la base: una solicitud esperando el
-- visto bueno del negocio podía solapar cualquier cosa, y el 23P01 aparecía recién al
-- APROBARLA —ahí el status pasa a `confirmed`, que sí estaba cubierto—, o sea adentro
-- de la action de aprobación y con un error que no explica nada.
--
-- A diferencia de `booking_overlap_por_persona`, que sólo RELAJABA y sobre los datos
-- existentes era un no-op exacto, este cambio APRIETA: agrega un status al WHERE, así
-- que puede fallar sobre filas que ya existen. De ahí el mensaje traducido de abajo.
--
-- **Va pegado a un cambio de comportamiento en la app** (`occupiesSlot`, en
-- src/lib/bookings/approval.ts): hasta hoy una solicitud con el hold vencido liberaba
-- el horario al instante, y eso era legal PORQUE `pending_confirmation` no estaba en
-- esta lista. Con el status adentro, la app tiene que seguir viéndola ocupada hasta
-- que el cron la expire; si no, la pantalla ofrece una hora que el insert rechaza.
-- Los dos cambios son inseparables: no revertir uno sin el otro.
--
-- Invisible en schema.prisma: el lenguaje de Prisma no expresa un EXCLUDE. Este
-- archivo es la única definición, y su única red es
-- tests/integration/booking-overlap-constraint.test.ts.

ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_no_overlap";

-- El ADD va envuelto para poder traducir el error, NO para pre-chequear. Un
-- pre-chequeo con su propio self-join tendría que repetir el predicado de acá abajo
-- —COALESCE, tsrange y la lista de estados— y dos copias que se pueden separar en
-- silencio es exactamente el modo de falla que ya nos pasó con este constraint: si
-- divergen, el guard dice "cero conflictos" y el ALTER revienta igual. Dejamos que
-- Postgres evalúe el predicado UNA vez y sólo le ponemos un mensaje útil encima.
--
-- Por qué no reparamos los datos desde el SQL: expirar una reserva también libera sus
-- canjes de promoción (`releaseRedemptionsOfExpiredBookings`), y esa lógica —grants,
-- forfeitOnNoShow, contadores de la promo— vive en TypeScript. Media expiración hecha
-- a mano en SQL deja una promo contada de más y nadie se entera nunca.
--
-- Las únicas filas que pueden hacer fallar esto son solicitudes con el hold ya vencido
-- que el cron todavía no barrió (con el hold vivo, la capa lógica ya impide el
-- solape). Verificado contra producción antes de escribir la migración: cero.
DO $$
BEGIN
  ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist (
    "businessId" WITH =,
    (COALESCE("professionalId", '')) WITH =,
    tsrange("startDateTime", "endDateTime", '[)') WITH &&
  )
  WHERE (
    status IN ('pending_payment', 'pending_confirmation', 'confirmed', 'completed')
  );
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'No se puede crear Booking_no_overlap con pending_confirmation adentro: hay reservas activas encimadas (%)', SQLERRM
    USING HINT = 'Son solicitudes vencidas que el cron todavía no barrió. 1) Corré /api/cron/expire-holds para que se expiren por la app y liberen sus canjes. 2) Destrabá el pipeline con `prisma migrate resolve --rolled-back 20260803210000_booking_overlap_solicitudes` — sin eso Prisma deja la migración marcada como fallida y TODO migrate deploy posterior aborta con P3009. 3) Reintentá el deploy.';
END $$;
