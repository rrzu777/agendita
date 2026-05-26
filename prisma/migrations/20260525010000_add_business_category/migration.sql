CREATE TYPE "BusinessCategory" AS ENUM ('nails', 'barber', 'hair_salon', 'beauty', 'massage', 'therapy', 'other');

ALTER TABLE "Business" ADD COLUMN "category" "BusinessCategory" NOT NULL DEFAULT 'other';
