-- Multi-profesional (Track 5). Todo aditivo y nullable: ninguna fila existente se
-- reescribe, y `professionalId IS NULL` significa exactamente lo que hay hoy.
--
-- El nombre de la tabla de join (`_ProfessionalServices`, columnas A/B) y sus
-- índices son la forma que Prisma le da a un muchos-a-muchos implícito. Mismo
-- molde que `_PromotionServices` y `_PackageProductServices`.

-- CreateTable
CREATE TABLE "Professional" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "modalities" "ServiceModality"[] DEFAULT ARRAY['on_site']::"ServiceModality"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Professional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProfessionalServices" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- AlterTable: las cuatro columnas nullable. Sin backfill, y no es un olvido:
-- NULL ya es el valor correcto para todo lo que existe.
ALTER TABLE "AvailabilityRule" ADD COLUMN "professionalId" TEXT;
ALTER TABLE "TimeBlock" ADD COLUMN "professionalId" TEXT;
ALTER TABLE "TimeBlockSeries" ADD COLUMN "professionalId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "professionalId" TEXT;

-- CreateIndex
CREATE INDEX "Professional_businessId_isActive_idx" ON "Professional"("businessId", "isActive");
CREATE UNIQUE INDEX "_ProfessionalServices_AB_unique" ON "_ProfessionalServices"("A", "B");
CREATE INDEX "_ProfessionalServices_B_index" ON "_ProfessionalServices"("B");
CREATE INDEX "AvailabilityRule_professionalId_idx" ON "AvailabilityRule"("professionalId");
CREATE INDEX "TimeBlock_professionalId_idx" ON "TimeBlock"("professionalId");
CREATE INDEX "TimeBlockSeries_professionalId_idx" ON "TimeBlockSeries"("professionalId");
CREATE INDEX "Booking_professionalId_idx" ON "Booking"("professionalId");

-- AddForeignKey
ALTER TABLE "Professional" ADD CONSTRAINT "Professional_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ProfessionalServices" ADD CONSTRAINT "_ProfessionalServices_A_fkey" FOREIGN KEY ("A") REFERENCES "Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ProfessionalServices" ADD CONSTRAINT "_ProfessionalServices_B_fkey" FOREIGN KEY ("B") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- El horario y los bloqueos de una persona no significan nada sin ella: CASCADE.
-- Ojo que el cascade sólo alcanza a las filas que TIENEN professionalId; las de
-- hoy están en NULL y no tienen FK que cascadear, así que borrar a alguien nunca
-- se lleva el horario del negocio.
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT "AvailabilityRule_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeBlockSeries" ADD CONSTRAINT "TimeBlockSeries_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Las reservas NO se cascadean ni se ponen en NULL. Un SET NULL las convertiría en
-- reservas sin persona, que por la semántica elegida chocan contra TODO EL EQUIPO —
-- un salón de 4 se queda sin agenda y nadie entiende por qué. Que la base se niegue
-- es el guard de verdad; el mensaje entendible lo pone la action.
--
-- NO ACTION y no RESTRICT, que es la diferencia sutil: los dos rechazan borrar a
-- alguien con citas, pero RESTRICT se chequea de INMEDIATO y NO ACTION al final del
-- statement. Al borrar un Business, Postgres cascadea a Booking y a Professional en
-- el mismo statement y sin orden garantizado: con RESTRICT, si le toca la persona
-- antes que sus reservas, el borrado del negocio explota.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
