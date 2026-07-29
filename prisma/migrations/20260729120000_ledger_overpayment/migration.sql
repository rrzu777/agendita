-- Asiento para plata que entró sobre una reserva ya saldada. Se separa de
-- `manual_income` a propósito: ese tipo lo usa la dueña para cargar plata a mano
-- y sí es facturación, así que no se puede excluir de los KPI sin envenenarlo.
-- (ADD VALUE es idempotente-seguro con IF NOT EXISTS)
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'overpayment';
