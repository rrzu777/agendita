-- `holdExpiresAt` mezclaba dos relojes distintos: el plazo de pago de una
-- `pending_payment` y la ventana del negocio para responder una
-- `pending_confirmation`. La segunda gana una columna propia.
ALTER TABLE "Booking" ADD COLUMN "approvalExpiresAt" TIMESTAMP(3);

-- Backfill sin heurísticas: el status es quien siempre decidió qué significado
-- tenía el valor. Después del movimiento, ninguna solicitud conserva un hold de
-- pago falso.
UPDATE "Booking"
SET
  "approvalExpiresAt" = "holdExpiresAt",
  "holdExpiresAt" = NULL
WHERE "status" = 'pending_confirmation';

CREATE INDEX "Booking_status_approvalExpiresAt_idx"
ON "Booking"("status", "approvalExpiresAt");
