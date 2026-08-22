'use client'

import { FormField } from '@/components/ui/form-field'
import { NativeSelect } from '@/components/ui/native-select'
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
    <FormField id="professional" label="¿Quién atiende?" required>
      {(a11y) => (
        <NativeSelect
          {...a11y}
          id="professional"
          density="form"
          value={pick.kind === 'person' ? pick.id : 'anyone'}
          onChange={(e) =>
            onChange(e.target.value === 'anyone' ? { kind: 'anyone' } : { kind: 'person', id: e.target.value })
          }
        >
          <option value="anyone">{ANYONE_LABEL}</option>
          {choice.options.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
}
