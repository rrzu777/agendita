-- Índices de performance (auditoría 2026-07-18). Sólo agrega índices, no toca datos.
-- Cada uno respalda una query verificada en el código:
--   BusinessUser(userId)                 → getUser en cada navegación autenticada + memberBusinessIds
--   Booking(businessId, startDateTime)   → agenda por rango sin filtro de status (getBookingsInRange)
--   Booking(customerId)                  → historial en el detalle de la clienta + cascade delete
--   Booking(status, holdExpiresAt)       → sweep cross-business de holds vencidos (expire-holds / transfer-reminders)
--   Booking(status, startDateTime)       → sweep cross-business de recordatorios (send-reminders)
--   Payment(customerId)                  → pagos en el detalle de la clienta + cascade delete
--   PackagePurchase(status, holdExpiresAt) → sweep cross-business de compras pending vencidas (expire-holds)

-- CreateIndex
CREATE INDEX "BusinessUser_userId_idx" ON "BusinessUser"("userId");

-- CreateIndex
CREATE INDEX "Booking_businessId_startDateTime_idx" ON "Booking"("businessId", "startDateTime");

-- CreateIndex
CREATE INDEX "Booking_customerId_idx" ON "Booking"("customerId");

-- CreateIndex
CREATE INDEX "Booking_status_holdExpiresAt_idx" ON "Booking"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "Booking_status_startDateTime_idx" ON "Booking"("status", "startDateTime");

-- CreateIndex
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

-- CreateIndex
CREATE INDEX "PackagePurchase_status_holdExpiresAt_idx" ON "PackagePurchase"("status", "holdExpiresAt");
