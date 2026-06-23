-- DropForeignKey
ALTER TABLE "BusinessUser" DROP CONSTRAINT "BusinessUser_businessId_fkey";

-- DropForeignKey
ALTER TABLE "BusinessUser" DROP CONSTRAINT "BusinessUser_userId_fkey";

-- DropForeignKey
ALTER TABLE "Service" DROP CONSTRAINT "Service_businessId_fkey";

-- DropForeignKey
ALTER TABLE "AvailabilityRule" DROP CONSTRAINT "AvailabilityRule_businessId_fkey";

-- DropForeignKey
ALTER TABLE "TimeBlock" DROP CONSTRAINT "TimeBlock_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_customerId_fkey";

-- DropForeignKey
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_businessId_fkey";

-- DropForeignKey
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_paymentId_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_customerId_fkey";

-- DropForeignKey
ALTER TABLE "GalleryImage" DROP CONSTRAINT "GalleryImage_businessId_fkey";

-- CreateIndex
CREATE INDEX "Service_businessId_isActive_idx" ON "Service"("businessId", "isActive");

-- CreateIndex
CREATE INDEX "AvailabilityRule_businessId_idx" ON "AvailabilityRule"("businessId");

-- CreateIndex
CREATE INDEX "Customer_businessId_idx" ON "Customer"("businessId");

-- CreateIndex
CREATE INDEX "Customer_businessId_phone_idx" ON "Customer"("businessId", "phone");

-- CreateIndex
CREATE INDEX "Payment_businessId_status_idx" ON "Payment"("businessId", "status");

-- CreateIndex
CREATE INDEX "LedgerEntry_businessId_occurredAt_idx" ON "LedgerEntry"("businessId", "occurredAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_bookingId_idx" ON "LedgerEntry"("bookingId");

-- CreateIndex
CREATE INDEX "Review_businessId_isApproved_isHidden_idx" ON "Review"("businessId", "isApproved", "isHidden");

-- CreateIndex
CREATE INDEX "GalleryImage_businessId_idx" ON "GalleryImage"("businessId");

-- AddForeignKey
ALTER TABLE "BusinessUser" ADD CONSTRAINT "BusinessUser_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessUser" ADD CONSTRAINT "BusinessUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT "AvailabilityRule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryImage" ADD CONSTRAINT "GalleryImage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

