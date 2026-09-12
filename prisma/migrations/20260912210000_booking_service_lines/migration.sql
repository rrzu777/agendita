-- Expand-only: do not invent historical catalogue snapshots for existing bookings.
CREATE TABLE "BookingService" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "depositAmount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "finalAmount" INTEGER NOT NULL,
    CONSTRAINT "BookingService_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BookingService_position_check" CHECK ("position" >= 0 AND "position" < 10),
    CONSTRAINT "BookingService_duration_check" CHECK ("durationMinutes" > 0),
    CONSTRAINT "BookingService_amounts_check" CHECK (
      "price" >= 0 AND "discountAmount" >= 0 AND "discountAmount" <= "price"
      AND "finalAmount" = "price" - "discountAmount"
      AND "depositAmount" >= 0 AND "depositAmount" <= "finalAmount"
    )
);
CREATE UNIQUE INDEX "BookingService_bookingId_position_key" ON "BookingService"("bookingId", "position");
CREATE UNIQUE INDEX "BookingService_bookingId_serviceId_key" ON "BookingService"("bookingId", "serviceId");
CREATE INDEX "BookingService_serviceId_bookingId_idx" ON "BookingService"("serviceId", "bookingId");
ALTER TABLE "BookingService" ADD CONSTRAINT "BookingService_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A service is deactivated, not allowed to cascade-delete appointment/payment history.
-- NO ACTION still allows the existing Business cascade to remove both in one statement.
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_serviceId_fkey";
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
-- Only the server database role accesses snapshot lines. No public REST policies.
ALTER TABLE "BookingService" ENABLE ROW LEVEL SECURITY;
