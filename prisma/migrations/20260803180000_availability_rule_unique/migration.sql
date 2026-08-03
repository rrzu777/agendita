-- Una sola regla de horario por (negocio, alcance, día).
--
-- Van DOS índices parciales y no un unique plano sobre las tres columnas: en
-- Postgres dos NULL nunca son iguales dentro de un unique, así que el plano
-- dejaría pasar filas duplicadas del horario DEL NEGOCIO (`professionalId`
-- NULL), que son justamente todas las que existen hoy. `NULLS NOT DISTINCT`
-- resolvería lo mismo en una línea pero pide Postgres 15+ y Prisma 5 no lo sabe
-- escribir; los parciales funcionan en cualquier versión.
--
-- Prisma no expresa índices parciales, así que —igual que el EXCLUDE
-- `Booking_no_overlap`— estos viven sólo en este .sql y su única red es el test
-- de integración `availability-rule-unique`, que verifica que existan y muerdan.
--
-- Verificado contra producción antes de aplicarlo: cero grupos duplicados.
CREATE UNIQUE INDEX "AvailabilityRule_business_day_key"
  ON "AvailabilityRule" ("businessId", "dayOfWeek")
  WHERE "professionalId" IS NULL;

CREATE UNIQUE INDEX "AvailabilityRule_professional_day_key"
  ON "AvailabilityRule" ("businessId", "professionalId", "dayOfWeek")
  WHERE "professionalId" IS NOT NULL;
