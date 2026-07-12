ALTER TABLE "Business" ADD COLUMN "requireTransferProof" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN "proofKey" TEXT;
ALTER TABLE "Payment" ADD COLUMN "proofContentType" TEXT;
