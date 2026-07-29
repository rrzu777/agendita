-- Confirmación manual de reservas (Track 2 de verticalización por rubro).
--
-- ADD VALUE va suelto y no se usa en esta misma migración: Postgres no deja
-- referenciar un valor de enum recién agregado dentro de la transacción que lo
-- crea, y `migrate deploy` corre cada migración en una.

-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'pending_confirmation' AFTER 'pending_payment';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN "requireBookingApproval" BOOLEAN NOT NULL DEFAULT false;
