-- Una ficha por (negocio, teléfono).
--
-- El índice no-único que había cubre las mismas columnas en el mismo orden, así
-- que el único lo reemplaza sin perder ningún plan de query.
--
-- El teléfono se guarda ya normalizado (normalizePhone) en los tres sitios que
-- escriben Customer, que es también la clave con la que findOrCreateCustomerInTx
-- la resuelve: comparar la columna cruda equivale a comparar el normalizado.
--
-- Esto es defensa en profundidad detrás del advisory lock que ya serializa el
-- find-or-create; ataja cualquier camino futuro que se saltee esa función.

-- DropIndex
DROP INDEX "Customer_businessId_phone_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Customer_businessId_phone_key" ON "Customer"("businessId", "phone");
