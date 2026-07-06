-- Cada cuántos minutos ofrecer horas de inicio en la página pública de reservas;
-- NULL = según la duración del servicio (comportamiento anterior, agenda compacta).
ALTER TABLE "Business" ADD COLUMN "slotStepMinutes" INTEGER DEFAULT 30;
