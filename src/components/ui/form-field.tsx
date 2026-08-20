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
  children: (a11y: FormFieldA11yProps) => ReactNode
}

export function FormField({
  id,
  label,
  help,
  error,
  required = false,
  children,
}: FormFieldProps) {
  const helpId = help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div data-slot="form-field" className="min-w-0 space-y-2">
      <Label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </Label>
      {children({
        'aria-describedby': describedBy,
        'aria-invalid': Boolean(error),
      })}
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
