-- Distingue un chargeback (status 'refunded' + chargebackAt set) de un refund
-- voluntario (status 'refunded', chargebackAt null).
ALTER TABLE "PackagePurchase" ADD COLUMN "chargebackAt" TIMESTAMP(3);
