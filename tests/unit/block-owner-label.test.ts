import { describe, it, expect } from 'vitest'
import { blockOwnerLabel, WHOLE_BUSINESS_LABEL } from '@/lib/professionals/scope-label'

/**
 * Equivocar esta etiqueta no rompe nada visible: dibuja un nombre plausible sobre el
 * bloqueo equivocado. Y lo que la dueña hace con esa lectura sí es destructivo —
 * borrar lo que cree "su" almuerzo puede estar abriéndole el horario a todo el equipo.
 */
describe('blockOwnerLabel', () => {
  it('mirando el negocio no etiqueta nada: todos los bloqueos de la lista son suyos', () => {
    expect(blockOwnerLabel(null, null)).toBeNull()
  })

  it('mirando a una persona, los suyos llevan su nombre', () => {
    expect(blockOwnerLabel('ana', 'Ana')).toBe('Ana')
  })

  /**
   * Ésta es la fila peligrosa: aparece en la lista de Ana porque también le cierra la
   * agenda, pero no es suya. Sin etiqueta se lee como propia.
   */
  it('mirando a una persona, los del negocio se dicen', () => {
    expect(blockOwnerLabel('ana', null)).toBe(WHOLE_BUSINESS_LABEL)
  })

  /**
   * El nombre sale de la fila y no de la lista de gente activa: los bloqueos de alguien
   * en pausa siguen existiendo, y son justo los que la dueña no puede explicarse si
   * aparecen sin nombre.
   */
  it('nombra también a quien ya no atiende', () => {
    expect(blockOwnerLabel('ana', 'Ex-empleado')).toBe('Ex-empleado')
  })
})
