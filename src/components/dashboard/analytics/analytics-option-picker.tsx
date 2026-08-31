'use client'

import { useEffect, useRef, useState } from 'react'
import { getOwnerAnalyticsOptions } from '@/server/actions/analytics'
import type { AnalyticsOptionKind, AnalyticsOptionPage } from '@/server/analytics/options'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'

export function AnalyticsOptionPicker({ kind, label, value, onChange, name, onOptions }: { kind: AnalyticsOptionKind; label: string; value: string; onChange: (value: string) => void; name?: string; onOptions?: (options: AnalyticsOptionPage) => void }) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState({ search: '', page: 1 })
  const [result, setResult] = useState<AnalyticsOptionPage | null>(null)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const selectedId = useRef(value)
  useEffect(() => { selectedId.current = value }, [value])
  useEffect(() => {
    let stale = false
    async function load() {
      setPending(true); setError(null)
      try {
        const response = await getOwnerAnalyticsOptions({ kind, ...query, ...(selectedId.current ? { selectedId: selectedId.current } : {}) })
        if (stale) return
        if (response.ok) { setResult(response.data); onOptions?.(response.data) }
        else { setResult(null); setError(response.error) }
      } catch { if (!stale) { setResult(null); setError('No se pudieron cargar las opciones. Reintenta la búsqueda.') } }
      finally { if (!stale) setPending(false) }
    }
    void load()
    return () => { stale = true }
  }, [kind, query, onOptions])
  const rows = result?.rows ?? []
  const selected = result?.selected?.id === value ? result.selected : null
  return <div className="min-w-0 space-y-2">
    <label className="block text-sm font-medium" htmlFor={`analytics-option-${kind}`}>{label}</label>
    <NativeSelect id={`analytics-option-${kind}`} name={name} aria-label={label} value={value} onChange={event => onChange(event.target.value)} className="h-10 bg-background">
      <option value="">Sin selección</option>
      {value && !rows.some(row => row.id === value) && <option value={value}>{selected?.label ?? `Selección actual · nombre no disponible en esta página · ${value}`}</option>}
      {rows.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
    </NativeSelect>
    <div className="flex gap-2"><Input aria-label={`Buscar ${label.toLowerCase()}`} value={search} maxLength={80} onChange={event => setSearch(event.target.value)} /><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setQuery({ search, page: 1 })}>Buscar</Button></div>
    {pending && <p role="status" className="text-xs text-muted-foreground">Cargando opciones…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!pending && !error && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>Página {query.page} · hasta 100 opciones</span>{query.page > 1 && <Button type="button" variant="outline" size="sm" onClick={() => setQuery({ ...query, page: query.page - 1 })}>Opciones anteriores</Button>}{result?.hasMore && <Button type="button" variant="outline" size="sm" onClick={() => setQuery({ ...query, page: query.page + 1 })}>Más opciones</Button>}</div>}
  </div>
}
