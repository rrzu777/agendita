// Compatibilidad para imports históricos. El cliente se instancia una sola vez
// en `@/lib/db`; duplicar este módulo podía abrir dos pools en un warm runtime.
export { prisma } from '@/lib/db'
