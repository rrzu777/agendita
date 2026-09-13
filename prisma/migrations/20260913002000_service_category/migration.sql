-- Optional owner-managed grouping; existing catalogue order and rows stay intact.
ALTER TABLE "Service" ADD COLUMN "category" VARCHAR(60);
