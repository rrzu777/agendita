CREATE TABLE "CustomerPhoto" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bookingId" TEXT,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerPhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerPhoto_key_key" ON "CustomerPhoto"("key");
CREATE INDEX "CustomerPhoto_customerId_createdAt_idx" ON "CustomerPhoto"("customerId", "createdAt");
CREATE INDEX "CustomerPhoto_bookingId_idx" ON "CustomerPhoto"("bookingId");
CREATE INDEX "CustomerPhoto_businessId_idx" ON "CustomerPhoto"("businessId");

ALTER TABLE "CustomerPhoto" ADD CONSTRAINT "CustomerPhoto_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerPhoto" ADD CONSTRAINT "CustomerPhoto_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerPhoto" ADD CONSTRAINT "CustomerPhoto_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
