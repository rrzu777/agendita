'use client'

import { createContext, useContext } from 'react'
import { getVocabulary, type Vocabulary } from '@/lib/vocabulary'

// El default es el léxico neutro y no null: así un componente cliente montado
// fuera del dashboard (un test de render suelto, una superficie pública que
// reuse el componente) no revienta — muestra la forma neutra, que es la que
// menos molesta si se escapa.
const VocabularyContext = createContext<Vocabulary>(getVocabulary('other'))

export function VocabularyProvider({
  value,
  children,
}: {
  value: Vocabulary
  children: React.ReactNode
}) {
  return <VocabularyContext.Provider value={value}>{children}</VocabularyContext.Provider>
}

export function useVocabulary(): Vocabulary {
  return useContext(VocabularyContext)
}
