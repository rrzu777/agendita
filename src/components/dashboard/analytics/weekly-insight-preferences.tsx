'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setWeeklyInsightPreferences } from '@/server/actions/weekly-insights'

export function WeeklyInsightPreferences({ preference }: { preference: { enabled: boolean; aiNarrativeEnabled: boolean; emailEnabled: boolean; privacyVersion: number | null } | null }) {
  const [state, setState] = useState({ enabled: preference?.enabled ?? false, aiNarrativeEnabled: preference?.aiNarrativeEnabled ?? false, emailEnabled: preference?.emailEnabled ?? false, privacyVersion: preference?.privacyVersion ?? null })
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  function change(field: 'enabled' | 'aiNarrativeEnabled' | 'emailEnabled', value: boolean) {
    const next = { ...state, [field]: value, ...(field === 'aiNarrativeEnabled' && value ? { privacyVersion: 2 } : {}) }
    setState(next)
    startTransition(async () => {
      const result = await setWeeklyInsightPreferences(next)
      setMessage(result.ok ? 'Preferencias guardadas.' : result.error)
      if (result.ok) router.refresh()
      else setState(state)
    })
  }
  return <div className="rounded-xl border border-border bg-card p-4 text-sm" aria-label="Preferencias de insights semanales">
    <p className="font-semibold text-primary">Preferencias de insights</p>
    <p className="mt-1 text-xs text-muted-foreground">El resumen determinístico y el análisis asistido son controles independientes. La IA sólo usa semanas con consentimiento v2 y no afecta reservas.</p>
    <div className="mt-3 flex flex-wrap gap-4">
      <label className="inline-flex items-center gap-2"><input type="checkbox" checked={state.enabled} disabled={pending} onChange={event => change('enabled', event.target.checked)} /> Mostrar resumen</label>
      <label className="inline-flex items-center gap-2"><input type="checkbox" checked={state.aiNarrativeEnabled} disabled={pending} onChange={event => change('aiNarrativeEnabled', event.target.checked)} /> Permitir análisis asistido (v2)</label>
      <label className="inline-flex items-center gap-2"><input type="checkbox" checked={state.emailEnabled} disabled={pending} onChange={event => change('emailEnabled', event.target.checked)} /> Recibir email semanal</label>
    </div>
    {message && <p className="mt-2 text-xs text-muted-foreground" role="status">{message}</p>}
  </div>
}
