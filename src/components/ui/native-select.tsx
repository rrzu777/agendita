import * as React from 'react'
import { cn } from '@/lib/utils'
import { inputDensityClasses, type ControlDensity } from '@/components/ui/input'

function NativeSelect({
  className,
  density,
  ...props
}: React.ComponentProps<'select'> & { density?: ControlDensity }) {
  const resolvedDensity = density ?? 'compact'

  return (
    <select
      data-slot="native-select"
      data-density={density}
      className={cn(
        'w-full min-w-0 rounded-lg border border-input bg-transparent transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        inputDensityClasses[resolvedDensity],
        className,
      )}
      {...props}
    />
  )
}

export { NativeSelect }
