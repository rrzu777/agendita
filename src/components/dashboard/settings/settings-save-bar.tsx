import { Button } from '@/components/ui/button'

type SettingsSaveBarProps = {
  isDirty: boolean
  isSubmitting: boolean
  status: 'idle' | 'saved' | 'error'
  error?: string | null
}

function getStatusMessage({ isDirty, isSubmitting, status, error }: SettingsSaveBarProps) {
  if (isSubmitting) return 'Guardando cambios…'
  if (status === 'error') return error || 'No se pudieron guardar los cambios'
  if (isDirty) return 'Cambios sin guardar'
  if (status === 'saved') return 'Cambios guardados'
  return 'Sin cambios pendientes'
}

export function SettingsSaveBar(props: SettingsSaveBarProps) {
  const { isDirty, isSubmitting } = props

  return (
    <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 -mx-5 mt-8 border-y border-border/60 bg-card/95 px-5 py-3 backdrop-blur md:bottom-0 md:-mx-10 md:px-10 lg:mx-0 lg:px-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {getStatusMessage(props)}
        </p>
        <Button type="submit" size="lg" disabled={!isDirty || isSubmitting} className="h-11 px-4">
          {isSubmitting ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </div>
  )
}
