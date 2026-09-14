'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { addColorFavorite, removeColorFavorite } from '@/server/actions/color-favorites'

type FavoriteMutation = (color: string) => Promise<{ ok: true; data: string[] } | { ok: false; error: string }>
type EnqueueFavoriteMutation = (operation: 'add' | 'remove', mutation: FavoriteMutation, color: string) => Promise<boolean>

type ColorFavoritesContextValue = {
  favorites: string[]
  canManage: boolean
  pending: boolean
  error: { message: string; operation: 'add' | 'remove' } | null
  addFavorite: (color: string) => Promise<boolean>
  removeFavorite: (color: string) => Promise<boolean>
  retry: () => Promise<boolean>
}

const ColorFavoritesContext = createContext<ColorFavoritesContextValue | null>(null)

export function ColorFavoritesProvider({
  initialFavorites,
  canManage,
  children,
}: {
  initialFavorites: string[]
  canManage: boolean
  children: ReactNode
}) {
  const [favorites, setFavorites] = useState(initialFavorites)
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState<{ message: string; operation: 'add' | 'remove' } | null>(null)
  const queued = useRef<Promise<void>>(Promise.resolve())
  const retryMutation = useRef<(() => Promise<boolean>) | null>(null)
  const enqueueRef = useRef<EnqueueFavoriteMutation>(() => Promise.resolve(false))

  const enqueue = useCallback<EnqueueFavoriteMutation>((operation, mutation, color) => {
    const run = async (): Promise<boolean> => {
      setPendingCount((count) => count + 1)
      setError(null)
      try {
        const result = await mutation(color)
        if (!result.ok) {
          setError({ message: result.error, operation })
          retryMutation.current = () => enqueueRef.current(operation, mutation, color)
          return false
        }
        setFavorites(result.data)
        retryMutation.current = null
        return true
      } catch {
        setError({ message: operation === 'add' ? 'No se pudo guardar el favorito. Intenta nuevamente.' : 'No se pudo quitar el favorito. Intenta nuevamente.', operation })
        retryMutation.current = () => enqueueRef.current(operation, mutation, color)
        return false
      } finally {
        setPendingCount((count) => Math.max(0, count - 1))
      }
    }

    const result = queued.current.then(run, run)
    queued.current = result.then(() => undefined, () => undefined)
    return result
  }, [])

  useEffect(() => {
    enqueueRef.current = enqueue
  }, [enqueue])

  const addFavorite = useCallback((color: string) => canManage ? enqueue('add', addColorFavorite, color) : Promise.resolve(false), [canManage, enqueue])
  const removeFavorite = useCallback((color: string) => canManage ? enqueue('remove', removeColorFavorite, color) : Promise.resolve(false), [canManage, enqueue])
  const retry = useCallback(() => retryMutation.current?.() ?? Promise.resolve(false), [])

  return (
    <ColorFavoritesContext.Provider value={{
      favorites,
      canManage,
      pending: pendingCount > 0,
      error,
      addFavorite,
      removeFavorite,
      retry,
    }}>
      {children}
    </ColorFavoritesContext.Provider>
  )
}

export function useColorFavorites() {
  const context = useContext(ColorFavoritesContext)
  // El picker también se usa en previews y pruebas aisladas; sin provider sigue
  // siendo un control de color completo, sólo no expone mutaciones compartidas.
  return context ?? {
    favorites: [],
    canManage: false,
    pending: false,
    error: null,
    addFavorite: async () => false,
    removeFavorite: async () => false,
    retry: async () => false,
  }
}
