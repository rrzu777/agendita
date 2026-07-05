-- Tolerancia de solape: minutos que una cita puede invadir por cada borde de
-- un bloqueo (0 = el bloqueo es estricto, comportamiento previo).
ALTER TABLE "TimeBlock" ADD COLUMN "overlapToleranceMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TimeBlockSeries" ADD COLUMN "overlapToleranceMinutes" INTEGER NOT NULL DEFAULT 0;
