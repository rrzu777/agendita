import { z } from 'zod'

/**
 * Reordenar una lista arrastrable del panel: pares (id, posición).
 *
 * No tiene nada de dominio —son un id y un entero— así que vive suelto y lo
 * comparten los CRUD que ordenan a mano (servicios, equipo, y lo que venga).
 * Estaba duplicado byte a byte en dos lugares y a la tercera copia nadie iba a
 * saber cuál era la canónica.
 *
 * La pertenencia de los ids al negocio NO se valida acá: es de la action, que es
 * la que tiene la sesión.
 */
export const reorderSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    sortOrder: z.number().int().nonnegative(),
  })),
}).strip()
