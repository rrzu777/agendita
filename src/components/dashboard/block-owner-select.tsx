'use client'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WHOLE_BUSINESS_LABEL } from '@/lib/professionals/scope-label'

/**
 * El valor que representa "sin persona" adentro del `<Select>`.
 *
 * Existe porque el alcance del negocio es `null` en todo el resto del sistema pero un
 * `<Select>` no puede tener un item con valor vacío, y porque un `''` que se escapara
 * hacia el servidor sería peor que un error: `normalizeProfessionalId` lo trata como
 * "sin persona", así que un bug de mapeo se guardaría como un bloqueo del negocio
 * entero sin quejarse. La conversión pasa por acá y por ningún otro lado.
 */
const WHOLE_BUSINESS_VALUE = 'negocio'

interface BlockOwnerSelectProps {
  /** Sólo gente que atiende. Vacío = negocio sin equipo: el selector no se dibuja. */
  professionals: { id: string; name: string }[]
  value: string | null
  onChange: (professionalId: string | null) => void
}

/**
 * De quién es el bloqueo que se está creando.
 *
 * No se dibuja en un negocio sin equipo, que es el caso de casi todas hoy: ahí no hay
 * nada que elegir y el diálogo tiene que quedar exactamente como estaba.
 *
 * La ayuda de abajo no es decoración. Los dos alcances **no** son simétricos —el del
 * negocio cierra la agenda de todo el mundo, el de una persona sólo la suya— y esa
 * asimetría no se deduce de leer dos opciones en una lista. Equivocarse hacia el
 * negocio le cierra el día a gente que sí podía atender.
 */
export function BlockOwnerSelect({ professionals, value, onChange }: BlockOwnerSelectProps) {
  if (professionals.length === 0) return null

  return (
    <div>
      <Label htmlFor="block-owner">¿Para quién es el bloqueo?</Label>
      <Select
        value={value ?? WHOLE_BUSINESS_VALUE}
        onValueChange={(v) => onChange(v === WHOLE_BUSINESS_VALUE ? null : v)}
      >
        <SelectTrigger id="block-owner">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={WHOLE_BUSINESS_VALUE}>{WHOLE_BUSINESS_LABEL}</SelectItem>
          {professionals.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1 text-xs text-muted-foreground">
        {value === null
          ? 'Cierra la agenda de todo el equipo.'
          : 'Sólo cierra su agenda: el resto del equipo sigue disponible.'}
      </p>
    </div>
  )
}
