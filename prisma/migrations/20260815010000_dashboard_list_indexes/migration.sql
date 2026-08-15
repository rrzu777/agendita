-- Cursor pagination uses a deterministic timestamp + id order. Keep the
-- shorter range indexes for existing calendar/report queries and add these
-- forward-only indexes for the dashboard paths.
CREATE INDEX IF NOT EXISTS "Booking_businessId_startDateTime_id_idx"
  ON "Booking"("businessId", "startDateTime", "id");

CREATE INDEX IF NOT EXISTS "LedgerEntry_businessId_occurredAt_id_idx"
  ON "LedgerEntry"("businessId", "occurredAt", "id");

CREATE INDEX IF NOT EXISTS "Customer_businessId_createdAt_id_idx"
  ON "Customer"("businessId", "createdAt", "id");
