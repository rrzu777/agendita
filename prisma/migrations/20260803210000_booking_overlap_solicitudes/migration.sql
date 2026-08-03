-- `pending_confirmation` entra al EXCLUDE `Booking_no_overlap`. Era el único estado
-- que ocupa cupo para la app y no tenía red en la base: una solicitud esperando el
-- visto bueno del negocio podía solapar cualquier cosa, y el 23P01 aparecía recién al
-- APROBARLA —ahí el status pasa a `confirmed`, que sí estaba cubierto—, o sea adentro
-- de la action de aprobación y con un error que no explica nada.
--
-- A diferencia de `booking_overlap_por_persona`, que sólo RELAJABA y sobre los datos
-- existentes era un no-op exacto, este cambio APRIETA: agrega un status al WHERE, así
-- que puede fallar sobre filas que ya existen. De ahí el guard de más abajo.
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

-- Guard. Si hay solicitudes vencidas solapando una reserva activa, el ADD CONSTRAINT
-- de abajo falla con un mensaje de Postgres que no dice qué hacer ni con cuál fila.
-- Preferimos frenar acá y decirlo.
--
-- No las expiramos desde el SQL a propósito: expirar una reserva también libera sus
-- canjes de promoción (`releaseRedemptionsOfExpiredBookings`), y esa lógica —grants,
-- forfeitOnNoShow, contadores de la promo— vive en TypeScript. Media expiración hecha
-- a mano en SQL deja una promo contada de más y nadie se entera nunca.
--
-- Es auto-reparable: las filas que pueden estar acá son exactamente las que el cron
-- `expire-holds` barre cada hora (una solicitud con el hold vivo no puede solapar
-- nada, la capa lógica ya lo impide). Si esto llega a frenar un deploy, el deploy
-- siguiente pasa solo.
DO $$
DECLARE
  conflictivas int;
BEGIN
  SELECT count(*) INTO conflictivas
  FROM "Booking" a
  JOIN "Booking" b
    ON a."businessId" = b."businessId"
   AND a.id <> b.id
   AND COALESCE(a."professionalId", '') = COALESCE(b."professionalId", '')
   AND tsrange(a."startDateTime", a."endDateTime", '[)')
       && tsrange(b."startDateTime", b."endDateTime", '[)')
  WHERE a.status = 'pending_confirmation'
    AND b.status IN ('pending_payment', 'pending_confirmation', 'confirmed', 'completed');

  IF conflictivas > 0 THEN
    RAISE EXCEPTION
      'Hay % solicitudes (pending_confirmation) solapando otra reserva activa; el EXCLUDE no se puede crear', conflictivas
      USING HINT = 'Corré el cron de expiracion (/api/cron/expire-holds) para que las solicitudes vencidas se expiren por la app —liberando sus canjes— y reintentá el deploy.';
  END IF;
END $$;

ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_no_overlap";

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
