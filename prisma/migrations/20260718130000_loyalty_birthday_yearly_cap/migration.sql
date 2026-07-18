-- Fix de fidelización (auditoría 2026-07-18): las reglas automáticas anuales
-- (cumpleaños/aniversario) se topean por OCASIÓN-AÑO vía la occasionKey del cron,
-- no por un cap de por-vida. Con maxPerCustomer=1 (el default viejo del preset de
-- cumpleaños) la recompensa se emitía UNA SOLA VEZ EN LA VIDA en vez de cada año.
--
-- Anula ese cap sólo donde vale exactamente 1 (el sembrado por el preset); un valor
-- custom distinto de 1 se respeta. Sólo toca datos, es idempotente.
UPDATE "Promotion"
SET "maxPerCustomer" = NULL
WHERE "triggerType" = 'automatic'
  AND "conditions"->>'kind' IN ('birthday', 'anniversary')
  AND "maxPerCustomer" = 1;
