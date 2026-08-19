import { useId, type ReactNode } from 'react'

type SettingsFormSectionProps = {
  title: string
  description?: string
  children: ReactNode
}

export function SettingsFormSection({ title, description, children }: SettingsFormSectionProps) {
  const titleId = useId()

  return (
    <section aria-labelledby={titleId} className="space-y-5">
      <div className="space-y-1">
        <h2 id={titleId} className="font-heading text-xl font-semibold tracking-tight text-primary">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
