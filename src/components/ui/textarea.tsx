import * as React from "react"

import { cn } from "@/lib/utils"
import type { ControlDensity } from "@/components/ui/input"

const textareaDensityClasses: Record<ControlDensity, string> = {
  compact: "min-h-16 px-2.5 py-2 text-base md:text-sm",
  form: "min-h-24 bg-card px-3 py-2.5 text-base md:text-sm",
  touch: "min-h-28 bg-card px-4 py-3 text-base",
}

function Textarea({
  className,
  density,
  ...props
}: React.ComponentProps<"textarea"> & { density?: ControlDensity }) {
  const resolvedDensity = density ?? "compact"

  return (
    <textarea
      data-slot="textarea"
      data-density={density}
      className={cn(
        "flex field-sizing-content w-full rounded-lg border border-input bg-transparent transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        textareaDensityClasses[resolvedDensity],
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
