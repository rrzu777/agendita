-- Tenant-scoped saved colours. Existing service and brand colours remain untouched.
CREATE TABLE "BusinessColorFavorite" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessColorFavorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessColorFavorite_businessId_color_key"
  ON "BusinessColorFavorite"("businessId", "color");
CREATE INDEX "BusinessColorFavorite_businessId_createdAt_idx"
  ON "BusinessColorFavorite"("businessId", "createdAt");

ALTER TABLE "BusinessColorFavorite"
  ADD CONSTRAINT "BusinessColorFavorite_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only the server database role accesses saved colours; no anonymous browser policy.
ALTER TABLE "BusinessColorFavorite" ENABLE ROW LEVEL SECURITY;
