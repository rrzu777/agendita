-- Tenant-controlled appearance. Category seeds a useful default but never locks it.
CREATE TYPE "BusinessVisualStyle" AS ENUM ('soft', 'balanced', 'contrast');

ALTER TABLE "Business"
ADD COLUMN "brandColor" TEXT,
ADD COLUMN "visualStyle" "BusinessVisualStyle" NOT NULL DEFAULT 'balanced';

UPDATE "Business"
SET "visualStyle" = CASE
  WHEN "category" IN ('nails', 'beauty') THEN 'soft'::"BusinessVisualStyle"
  WHEN "category" = 'barber' THEN 'contrast'::"BusinessVisualStyle"
  ELSE 'balanced'::"BusinessVisualStyle"
END;
