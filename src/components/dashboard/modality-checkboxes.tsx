'use client'

import { useId } from 'react'
import { MODALITY_LABELS, MODALITY_HINTS, MODALITY_ORDER } from '@/lib/services/modality'
import type { ServiceModality } from '@prisma/client'

/**
 * Los checkboxes de "¿dónde se atiende?".
 *
 * Existe porque el mismo control aparece en el formulario de servicios y en el de
 * equipo, y estaba copiado línea por línea — clases de Tailwind incluidas. Lo único
 * que cambia entre los dos usos es el título y la ayuda de abajo, así que son props.
 *
 * El vocabulario (orden, labels, ayudas) ya vivía centralizado en
 * `lib/services/modality.ts`; lo que faltaba era el componente.
 */
export function ModalityCheckboxes({
  selected,
  onToggle,
  label,
  hint,
}: {
  selected: ServiceModality[]
  onToggle: (modality: ServiceModality) => void
  label: string
  hint: string
}) {
  const hintId = useId()

  return (
    <fieldset aria-describedby={hintId}>
      <legend className="text-sm font-medium text-foreground">{label}</legend>
      <div className="mt-2 space-y-2">
        {MODALITY_ORDER.map((modality) => {
          const checked = selected.includes(modality)
          return (
            <label
              key={modality}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                checked ? 'border-primary bg-secondary/40' : 'border-border'
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-current"
                checked={checked}
                onChange={() => onToggle(modality)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-primary">{MODALITY_LABELS[modality]}</span>
                <span className="block text-xs text-muted-foreground">{MODALITY_HINTS[modality]}</span>
              </span>
            </label>
          )
        })}
      </div>
      <p id={hintId} className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </fieldset>
  )
}
