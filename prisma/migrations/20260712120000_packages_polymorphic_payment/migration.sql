-- Payment: bookingId nullable + packagePurchaseId polimórfico
ALTER TABLE "Payment" ALTER COLUMN "bookingId" DROP NOT NULL;
ALTER TABLE "Payment" ADD COLUMN "packagePurchaseId" TEXT;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_packagePurchaseId_fkey" FOREIGN KEY ("packagePurchaseId") REFERENCES "PackagePurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Payment_packagePurchaseId_idx" ON "Payment"("packagePurchaseId");

-- LedgerEntry: packagePurchaseId (para netear reembolsos de paquete en getPackageSalesTotal)
ALTER TABLE "LedgerEntry" ADD COLUMN "packagePurchaseId" TEXT;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_packagePurchaseId_fkey" FOREIGN KEY ("packagePurchaseId") REFERENCES "PackagePurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "LedgerEntry_packagePurchaseId_idx" ON "LedgerEntry"("packagePurchaseId");

-- PackagePurchase: hold para transferencias (usado recién en B4b-3, columna aditiva ahora)
ALTER TABLE "PackagePurchase" ADD COLUMN "holdExpiresAt" TIMESTAMP(3);

-- Enums (ADD VALUE es idempotente-seguro con IF NOT EXISTS)
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'package_purchase';
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'package_sale';
