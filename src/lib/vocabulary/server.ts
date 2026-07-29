import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getVocabulary, type Vocabulary } from './index'

/**
 * Vocabulario del negocio en sesión, para server components y server actions.
 *
 * No agrega ninguna query: getCurrentUserWithBusiness está envuelto en
 * React.cache y el layout del dashboard ya la llamó en el mismo request.
 *
 * Cae al léxico neutro si no hay negocio (superficies públicas,
 * /recover-business). Los emails NO pueden usar esto — salen de crons y
 * webhooks, sin sesión; ahí el caller resuelve el léxico desde el
 * `business.category` del registro que ya trae.
 */
export async function getBusinessVocabulary(): Promise<Vocabulary> {
  const userData = await getCurrentUserWithBusiness()
  return getVocabulary(userData?.business?.category ?? 'other')
}
