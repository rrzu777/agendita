/**
 * Anticipación mínima (en minutos) para reservar en el flujo público.
 * Compartida entre generación de slots (slots.ts), validación (validation.ts)
 * y la UI (step-time.tsx) para que nunca se ofrezca un horario que la
 * validación rechazaría — y para que el copy de la UI no se desincronice.
 */
export const LEAD_TIME_MINUTES = 120
