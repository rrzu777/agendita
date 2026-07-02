'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { applyLoyaltyPreset } from '@/server/actions/loyalty'
import type { ApplyPresetSummary } from '@/lib/loyalty/presets'

type PresetCard = {
  id: string
  kind: 'base' | 'addon' | 'combo'
  name: string
  recommended?: boolean
  describe: string[]
}

export function PresetPicker({ presets, hasActiveProgram }: { presets: PresetCard[]; hasActiveProgram: boolean }) {
  const combo = presets.filter((p) => p.kind === 'combo')
  const bases = presets.filter((p) => p.kind === 'base')
  const addons = presets.filter((p) => p.kind === 'addon')

  return (
    <section className="studio-card mb-6 p-4">
      <h3 className="text-lg font-semibold text-primary">Programas recomendados</h3>
      <p className="text-sm text-muted-foreground">
        Encendé un programa completo en un clic y ajustalo abajo. No se borra lo que ya configuraste.
      </p>

      {combo.length > 0 && (
        <div className="mt-4 grid gap-3">
          {combo.map((p) => <Card key={p.id} preset={p} hasActiveProgram={hasActiveProgram} />)}
        </div>
      )}

      <h4 className="mt-6 text-sm font-semibold text-foreground">Elegí cómo ganan (programa base)</h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {bases.map((p) => <Card key={p.id} preset={p} hasActiveProgram={hasActiveProgram} />)}
      </div>

      <h4 className="mt-6 text-sm font-semibold text-foreground">Sumá recompensas automáticas</h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {addons.map((p) => <Card key={p.id} preset={p} hasActiveProgram={hasActiveProgram} />)}
      </div>
    </section>
  )
}

function Card({ preset, hasActiveProgram }: { preset: PresetCard; hasActiveProgram: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [isPending, start] = useTransition()
  const [summary, setSummary] = useState<ApplyPresetSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isBaseLike = preset.kind === 'base' || preset.kind === 'combo'

  function apply() {
    setError(null)
    start(async () => {
      try {
        const res = await applyLoyaltyPreset(preset.id)
        setSummary(res)
        setConfirming(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al aplicar')
      }
    })
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <h5 className="font-medium text-foreground">{preset.name}</h5>
        {preset.recommended && (
          <Badge className="bg-primary/10 text-primary">Recomendado</Badge>
        )}
      </div>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {preset.describe.map((line, i) => <li key={i}>{line}</li>)}
      </ul>

      {!confirming && !summary && (
        <Button type="button" size="sm" className="mt-3" disabled={isPending} onClick={() => setConfirming(true)}>
          Aplicar
        </Button>
      )}

      {confirming && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Se aplicará sobre tu programa actual sin borrar lo que ya configuraste.
          </p>
          {isBaseLike && hasActiveProgram && (
            <p className="text-xs text-amber-600">
              Ya tenés un programa activo. Esto cambiará cómo se acumula y sumará una recompensa nueva;
              tus puntos acumulados no se pierden.
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={isPending} onClick={apply}>
              {isPending ? 'Aplicando…' : 'Confirmar'}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {summary && (
        <div className="mt-3 text-xs text-green-600">
          {summary.applied.length > 0 && <p>Se encendió: {summary.applied.join(', ')}.</p>}
          {summary.skipped.length > 0 && <p className="text-muted-foreground">Ya tenías: {summary.skipped.join(', ')}.</p>}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
