-- Ventana del hold cuando el negocio coordina el abono a mano (sin pago online
-- ni transferencia configurados). Antes esas reservas heredaban los 15 minutos
-- del funnel con checkout y el cron las expiraba sin que nadie pudiera pagar.
ALTER TABLE "Business" ADD COLUMN "manualHoldHours" INTEGER NOT NULL DEFAULT 24;
