-- AlterTable: add optional birth date for customers (used for birthday handling)
ALTER TABLE "Customer" ADD COLUMN "birthDate" DATE;
