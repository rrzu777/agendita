import { renderToStaticMarkup } from 'react-dom/server'
import type { BusinessCategory } from '@prisma/client'
import { VocabularyProvider } from '@/components/vocabulary-provider'
import { getVocabulary } from '@/lib/vocabulary'

/**
 * Renderiza un componente del dashboard con el vocabulario de un rubro.
 *
 * POR QUÉ EXISTE: los componentes del dashboard leen el léxico por contexto. Sin
 * el provider el render cae al léxico neutro por default, así que una aserción de
 * texto mediría ese default y no el rubro que el caso quiere probar — y peor, un
 * test escrito contra el neutro pasaría aunque el contexto no llegara nunca.
 *
 * Usar `'nails'` para el texto femenino (el que ven los negocios existentes) y
 * `'barber'` para el neutro.
 */
export function renderWithVocabulary(category: BusinessCategory, node: React.ReactElement): string {
  return renderToStaticMarkup(
    <VocabularyProvider value={getVocabulary(category)}>{node}</VocabularyProvider>,
  )
}
