import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

export type FormFieldA11yProps = {
  'aria-describedby': string | undefined
  'aria-invalid': boolean
}

type FormFieldProps = {
  id: string
  label: ReactNode
  help?: ReactNode
  error?: string
  required?: boolean
  layout?: 'stacked' | 'inline'
  children: (a11y: FormFieldA11yProps) => ReactNode
}

export function FormField({
  id,
  label,
  help,
  error,
  required = false,
  layout = 'stacked',
  children,
}: FormFieldProps) {
  const helpId = help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  const labelElement = (
    <Label htmlFor={id}>
      {label}
      {required && <span aria-hidden="true"> *</span>}
    </Label>
  )
  const control = children({
    'aria-describedby': describedBy,
    'aria-invalid': Boolean(error),
  })

  return (
    <div data-slot="form-field" data-layout={layout} className="min-w-0 space-y-2">
      {layout === 'inline' ? (
        <div className="flex items-center justify-between gap-4">
          {labelElement}
          {control}
        </div>
      ) : (
        <>
          {labelElement}
          {control}
        </>
      )}
      {help && (
        <p id={helpId} className="break-words text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
