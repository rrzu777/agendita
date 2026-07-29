-- Modalidad de atención por servicio (Track 3 de verticalización por rubro).
--
-- El tipo se crea y se usa en la MISMA migración, y eso está bien: la
-- restricción de Postgres es sobre `ALTER TYPE ... ADD VALUE` en un enum que ya
-- existía, no sobre un `CREATE TYPE` nuevo.

-- CreateEnum
CREATE TYPE "ServiceModality" AS ENUM ('on_site', 'at_home', 'online');

-- AlterTable: los servicios existentes se atienden en el local.
ALTER TABLE "Service" ADD COLUMN "modalities" "ServiceModality"[] DEFAULT ARRAY['on_site']::"ServiceModality"[];

-- AlterTable: idem para las reservas ya tomadas. NOT NULL con default → el
-- backfill de las filas viejas lo hace el propio DEFAULT.
ALTER TABLE "Booking" ADD COLUMN "modality" "ServiceModality" NOT NULL DEFAULT 'on_site';
ALTER TABLE "Booking" ADD COLUMN "serviceAddress" TEXT;
ALTER TABLE "Booking" ADD COLUMN "meetingUrl" TEXT;

-- AlterTable
ALTER TABLE "Business" ADD COLUMN "defaultMeetingUrl" TEXT;
