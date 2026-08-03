'use client'

import { Label } from '@/components/ui/label'
import { ANYONE_LABEL, type ProfessionalChoice, type ProfessionalPick } from '@/lib/professionals/eligible'

/**
 * El selector de quién atiende en el panel, con la MISMA regla del funnel
 * (`professionalChoice`): sin equipo elegible no aparece; con una sola persona
 * no pregunta pero la reserva igual queda a su nombre (eso lo colapsa
 * `professionalFields`, no esto); con dos o más pregunta, y "Cualquiera
 * disponible" va primera, como en el funnel.
 *
 * Componente propio del panel (no de una ruta). Reasignar NO pasa por acá a
 * propósito: este selector habla `ProfessionalChoice`/`ProfessionalPick` y
 * ofrece "Cualquiera disponible", y reasignar exige elegir a alguien concreto
 * sobre una lista que se trae bajo demanda (`ReassignControl`).
 */
export function ProfessionalField({
  choice,
  pick,
  onChange,
}: {
  choice: ProfessionalChoice
  pick: ProfessionalPick
  onChange: (pick: ProfessionalPick) => void
}) {
  if (choice.kind !== 'ask') return null
  return (
    <div className="space-y-2">
      <Label htmlFor="professional">¿Quién atiende? *</Label>
      <select
        id="professional"
        value={pick.kind === 'person' ? pick.id : 'anyone'}
        onChange={(e) =>
          onChange(e.target.value === 'anyone' ? { kind: 'anyone' } : { kind: 'person', id: e.target.value })
        }
        className="studio-input w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
      >
        <option value="anyone">{ANYONE_LABEL}</option>
        {choice.options.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </div>
  )
}
