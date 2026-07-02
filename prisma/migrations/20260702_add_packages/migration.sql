-- AlterTable
ALTER TABLE "PromotionGrant" ADD COLUMN     "packagePurchaseId" TEXT;

-- CreateTable
CREATE TABLE "PackageProduct" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "bonusQuantity" INTEGER NOT NULL DEFAULT 0,
    "price" INTEGER NOT NULL,
    "expiryDays" INTEGER,
    "appliesToAll" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagePurchase" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "packageProductId" TEXT NOT NULL,
    "pricePaid" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "bonusQuantity" INTEGER NOT NULL DEFAULT 0,
    "coversAll" BOOLEAN NOT NULL DEFAULT true,
    "coveredServiceIds" TEXT[],
    "source" TEXT NOT NULL,
    "paymentMethod" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundedAmount" INTEGER,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackagePurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PackageProductServices" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "PackageProduct_businessId_isActive_idx" ON "PackageProduct"("businessId", "isActive");

-- CreateIndex
CREATE INDEX "PackagePurchase_businessId_status_idx" ON "PackagePurchase"("businessId", "status");

-- CreateIndex
CREATE INDEX "PackagePurchase_customerId_status_idx" ON "PackagePurchase"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "_PackageProductServices_AB_unique" ON "_PackageProductServices"("A", "B");

-- CreateIndex
CREATE INDEX "_PackageProductServices_B_index" ON "_PackageProductServices"("B");

-- CreateIndex
CREATE INDEX "PromotionGrant_packagePurchaseId_idx" ON "PromotionGrant"("packagePurchaseId");

-- AddForeignKey
ALTER TABLE "PromotionGrant" ADD CONSTRAINT "PromotionGrant_packagePurchaseId_fkey" FOREIGN KEY ("packagePurchaseId") REFERENCES "PackagePurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageProduct" ADD CONSTRAINT "PackageProduct_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagePurchase" ADD CONSTRAINT "PackagePurchase_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagePurchase" ADD CONSTRAINT "PackagePurchase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagePurchase" ADD CONSTRAINT "PackagePurchase_packageProductId_fkey" FOREIGN KEY ("packageProductId") REFERENCES "PackageProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PackageProductServices" ADD CONSTRAINT "_PackageProductServices_A_fkey" FOREIGN KEY ("A") REFERENCES "PackageProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PackageProductServices" ADD CONSTRAINT "_PackageProductServices_B_fkey" FOREIGN KEY ("B") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

