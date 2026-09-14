'use client'

import { Heart, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useColorFavorites } from '@/components/dashboard/color-favorites-provider'
import type { Ref } from 'react'

const SAFE_COLOR = '#B64D68'
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/

function normalize(value: string): string | null {
  const trimmed = value.trim()
  return HEX_COLOR.test(trimmed) ? trimmed.toUpperCase() : null
}

export function ColorPicker({
  id,
  label,
  value,
  onChange,
  presets = [],
  required = false,
  disabled = false,
  error,
  describedBy,
  onClear,
  onBlur,
  inputRef,
  hideLabel = false,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  presets?: string[]
  required?: boolean
  disabled?: boolean
  error?: boolean
  describedBy?: string
  onClear?: () => void
  onBlur?: () => void
  inputRef?: Ref<HTMLInputElement>
  hideLabel?: boolean
}) {
  const { favorites, canManage, pending, error: favoriteError, addFavorite, removeFavorite, retry } = useColorFavorites()
  const validValue = normalize(value)
  const nativeValue = validValue ?? SAFE_COLOR
  const selectablePresets = presets.map(normalize).filter((color): color is string => Boolean(color))

  return (
    <fieldset aria-label={label} aria-describedby={describedBy} className="min-w-0 space-y-3" disabled={disabled}>
      {!hideLabel && <legend className="text-sm font-medium text-foreground">{label}{required && <span aria-hidden="true"> *</span>}</legend>}
      <div className="flex flex-wrap items-end gap-3">
        <input
          aria-label="Selector de color"
          className="size-11 shrink-0 cursor-pointer rounded-lg border border-border bg-card p-1"
          type="color"
          value={nativeValue}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
        <div className="min-w-0 flex-1 sm:max-w-48">
          <label htmlFor={id} className="mb-2 block text-sm font-medium text-foreground">Código hexadecimal</label>
          <Input
            id={id}
            ref={inputRef}
            density="form"
            value={value}
            onChange={(event) => {
              const rawValue = event.target.value
              onChange(normalize(rawValue) ?? rawValue)
            }}
            placeholder="#RRGGBB"
            maxLength={7}
            autoCapitalize="characters"
            aria-invalid={error || undefined}
            aria-describedby={describedBy}
            onBlur={onBlur}
          />
        </div>
        <span aria-label={validValue ? `Vista previa ${validValue}` : 'Vista previa predeterminada'} className="size-11 shrink-0 rounded-lg border border-border" style={{ backgroundColor: nativeValue }} />
        {onClear && (
          <Button type="button" variant="outline" size="form" className="min-h-11" onClick={onClear} aria-label="Restablecer color de marca">
            <RotateCcw className="size-4" />Usar color predeterminado
          </Button>
        )}
      </div>

      {selectablePresets.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Sugerencias</p>
          <div className="flex flex-wrap gap-2">
            {selectablePresets.map((color) => (
              <button key={color} type="button" aria-label={`Seleccionar color ${color}`} aria-pressed={validValue === color} onClick={() => onChange(color)} className={cn('size-11 rounded-lg border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', validValue === color ? 'border-primary' : 'border-transparent')} style={{ backgroundColor: color }} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2" aria-label="Favoritos de color">
        <p className="text-sm font-medium text-foreground">Favoritos de color</p>
        {favorites.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {favorites.map((color) => (
              <li key={color} className="flex items-center gap-1">
                <button type="button" aria-label={`Seleccionar favorito ${color}`} aria-pressed={validValue === color} onClick={() => onChange(color)} className={cn('size-11 rounded-lg border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', validValue === color ? 'border-primary' : 'border-border')} style={{ backgroundColor: color }} />
                {canManage && <Button type="button" variant="ghost" size="icon" className="size-11" disabled={pending} aria-label={`Quitar favorito ${color}`} onClick={() => void removeFavorite(color)}><X className="size-4" /></Button>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Aún no has guardado colores favoritos.</p>}
        {canManage && (
          <Button type="button" variant="outline" size="form" className="min-h-11" disabled={!validValue || pending || favorites.includes(validValue)} aria-label={`Guardar ${validValue ?? 'color'} en favoritos`} onClick={() => validValue && void addFavorite(validValue)}>
            <Heart className="size-4" />Guardar en favoritos
          </Button>
        )}
        {favoriteError && <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{favoriteError.message}</span><Button type="button" variant="outline" size="form" className="min-h-11" onClick={() => void retry()} aria-label={favoriteError.operation === 'add' ? 'Reintentar guardar favorito' : 'Reintentar quitar favorito'}>Reintentar</Button></p>}
      </div>
    </fieldset>
  )
}
