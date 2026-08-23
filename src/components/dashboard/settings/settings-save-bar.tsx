import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
  const shouldDock = isDirty || isSubmitting || props.status !== 'idle'

  return (
    <div
      data-tour-id="settings-save"
      className={cn(
        'pointer-events-none z-30 -mx-5 mt-8 px-5 pb-2 pt-5 md:-mx-4 md:px-4 lg:mx-0 lg:px-0',
        shouldDock &&
          'sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-background via-background/95 to-transparent md:bottom-4',
      )}
    >
      <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-[0_12px_40px_-18px_rgba(44,32,24,0.4)]">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {getStatusMessage(props)}
        </p>
        <Button type="submit" size="form" disabled={!isDirty || isSubmitting}>
          {isSubmitting ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </div>
  )
}
