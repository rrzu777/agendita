-- Backstop de unicidad para pagos de paquete (bookingId null), simétrico al de
-- reserva. Evita que dos webhooks concurrentes con el mismo providerPaymentId
-- creen dos Payments para la misma compra. Múltiples NULLs (venta manual sin
-- providerPaymentId) siguen permitidos en Postgres.
CREATE UNIQUE INDEX "Payment_packagePurchaseId_provider_providerPaymentId_key" ON "Payment"("packagePurchaseId", "provider", "providerPaymentId");
