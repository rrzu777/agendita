'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createProfessional, updateProfessional } from '@/server/actions/professionals'
import { useVocabulary } from '@/components/vocabulary-provider'
import { deriveModalities } from '@/lib/professionals/modalities'
import { sortModalities, toggleModalityIn } from '@/lib/services/modality'
import { ModalityCheckboxes } from './modality-checkboxes'
import type { ServiceModality } from '@prisma/client'
import { Pencil, Plus } from 'lucide-react'

export type AssignableService = {
  id: string
  name: string
  modalities: ServiceModality[]
}

export type FormProfessional = {
  id: string
  name: string
  bio: string | null
  modalities: ServiceModality[]
  serviceIds: string[]
}

export function ProfessionalForm({
  professional,
  services,
  onSuccess,
}: {
  professional?: FormProfessional | null
  services: AssignableService[]
  onSuccess?: () => void
}) {
  const v = useVocabulary()
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // En el alta arrancan todos los servicios activos tildados: un servicio que
  // nadie hace no se puede reservar, y ese estado tiene que ser raro, no el
  // default.
  const [serviceIds, setServiceIds] = useState<string[]>(
    professional ? professional.serviceIds : services.map((s) => s.id),
  )
  const [modalities, setModalities] = useState<ServiceModality[]>(
    professional?.modalities?.length
      ? sortModalities(professional.modalities)
      : deriveModalities(services),
  )

  // Las modalidades se derivan de los servicios SÓLO hasta que alguien las toca a
  // mano. Después son una decisión ("Juan no viaja") y recalcularlas se la
  // pisaría en silencio. En la edición arranca en true porque lo guardado YA es
  // esa decisión.
  const [modalitiesTouched, setModalitiesTouched] = useState(Boolean(professional))

  function toggleService(serviceId: string) {
    const next = serviceIds.includes(serviceId)
      ? serviceIds.filter((id) => id !== serviceId)
      : [...serviceIds, serviceId]
    setServiceIds(next)
    if (!modalitiesTouched) {
      setModalities(deriveModalities(services.filter((s) => next.includes(s.id))))
    }
  }

  function toggleModality(modality: ServiceModality) {
    setModalitiesTouched(true)
    setModalities((prev) => toggleModalityIn(prev, modality))
  }

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)

    const data: Record<string, unknown> = {
      name: (formData.get('name') as string).trim(),
      bio: (formData.get('bio') as string).trim() || null,
      modalities,
      serviceIds,
    }

    try {
      const res = professional
        ? await updateProfessional(professional.id, data)
        : await createProfessional(data)
      if (!res.ok) { setError(res.error); return }
      setOpen(false)
      onSuccess?.()
    } catch {
      setError('Error al guardar')
    } finally {
      setLoading(false)
    }
  }

  // "Agregar" y no "Nuevo/Nueva": el sustantivo del oficio cambia de género según
  // el rubro ("Nuevo barbero" pero "Nueva manicurista") y el léxico no guarda esa
  // forma. Un verbo invariable no tiene el problema.
  const title = professional ? `Editar ${v.professional}` : `Agregar ${v.professional}`

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null) }}>
      <DialogTrigger asChild>
        <Button
          variant={professional ? 'outline' : 'default'}
          size={professional ? 'sm' : 'default'}
          className="font-semibold"
        >
          {professional ? <Pencil className="mr-2 size-4" /> : <Plus className="mr-2 size-4" />}
          {professional ? 'Editar' : title}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-semibold tracking-tight text-primary">
            {title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Nombre, presentación, servicios que hace y dónde atiende.
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-5">
          <FormField id={`${formId}-name`} label="Nombre" required>
            {(a11y) => (
              <Input
                {...a11y}
                id={`${formId}-name`}
                density="form"
                name="name"
                defaultValue={professional?.name}
                required
              />
            )}
          </FormField>

          <FormField id={`${formId}-bio`} label="Presentación">
            {(a11y) => (
              <Textarea
                {...a11y}
                id={`${formId}-bio`}
                density="form"
                name="bio"
                defaultValue={professional?.bio ?? ''}
                placeholder="Una línea que tus clientas van a leer al elegir."
              />
            )}
          </FormField>

          <fieldset aria-describedby={serviceIds.length === 0 ? `${formId}-services-help` : undefined}>
            <legend className="text-sm font-medium text-foreground">¿Qué servicios hace?</legend>
            {services.length === 0 ? (
              <p id={`${formId}-services-help`} className="mt-2 text-sm text-muted-foreground">
                Todavía no tenés servicios activos. Creá uno y volvé para asignarlo.
              </p>
            ) : (
              <>
                <div className="mt-2 space-y-2">
                  {services.map((service) => {
                    const checked = serviceIds.includes(service.id)
                    return (
                      <label
                        key={service.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                          checked ? 'border-primary bg-secondary/40' : 'border-border'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="size-4 accent-current"
                          checked={checked}
                          onChange={() => toggleService(service.id)}
                        />
                        <span className="text-sm font-semibold text-primary">{service.name}</span>
                      </label>
                    )
                  })}
                </div>
                {serviceIds.length === 0 && (
                  <p id={`${formId}-services-help`} className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    Sin ningún servicio asignado no va a aparecer al reservar.
                  </p>
                )}
              </>
            )}
          </fieldset>

          <ModalityCheckboxes
            selected={modalities}
            onToggle={toggleModality}
            label="¿Dónde atiende?"
            hint="Sale de los servicios asignados. Destildá lo que no haga — por ejemplo, si no va a domicilio."
          />

          {error && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button type="submit" size="form" className="w-full font-semibold" disabled={loading}>
            {loading ? 'Guardando…' : 'Guardar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
