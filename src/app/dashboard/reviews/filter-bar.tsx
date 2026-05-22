'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useState, useRef } from 'react'
import { Search, X } from 'lucide-react'

const statusOptions = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'approved', label: 'Aprobadas' },
  { value: 'hidden', label: 'Ocultas' },
] as const

const ratingOptions = [
  { value: '', label: 'Todas' },
  { value: '1', label: '★ 1' },
  { value: '2', label: '★ 2' },
  { value: '3', label: '★ 3' },
  { value: '4', label: '★ 4' },
  { value: '5', label: '★ 5' },
] as const

export function ReviewFilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentStatus = searchParams.get('status') || 'all'
  const currentRating = searchParams.get('rating') || ''
  const currentSearch = searchParams.get('search') || ''

  const [searchValue, setSearchValue] = useState(currentSearch)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value && value !== 'all') {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value)
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
      searchTimeoutRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString())
        const trimmed = value.trim()
        if (trimmed) {
          params.set('search', trimmed)
        } else {
          params.delete('search')
        }
        router.push(`${pathname}?${params.toString()}`)
      }, 300)
    },
    [router, pathname, searchParams],
  )

  const clearSearch = useCallback(() => {
    setSearchValue('')
    const params = new URLSearchParams(searchParams.toString())
    params.delete('search')
    router.push(`${pathname}?${params.toString()}`)
  }, [router, pathname, searchParams])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
          {statusOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateFilter('status', opt.value)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                currentStatus === opt.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
          {ratingOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateFilter('rating', opt.value)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                currentRating === opt.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Buscar por cliente, comentario o servicio..."
          className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {searchValue && (
          <button
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
