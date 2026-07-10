-- CreateTable
CREATE TABLE "BankTransferAccount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "rut" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "email" TEXT,
    "instructions" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "holdHours" INTEGER NOT NULL DEFAULT 24,
    "verifyHours" INTEGER DEFAULT 48,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransferAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankTransferAccount_businessId_key" ON "BankTransferAccount"("businessId");

-- AddForeignKey
ALTER TABLE "BankTransferAccount" ADD CONSTRAINT "BankTransferAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "paymentMethod" TEXT;
