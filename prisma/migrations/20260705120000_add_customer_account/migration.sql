-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "selfServiceCutoffHours" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "Customer_userId_idx" ON "Customer"("userId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
