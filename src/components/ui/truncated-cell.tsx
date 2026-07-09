import * as React from 'react'
import { TableCell } from './table'
import { cn } from '@/lib/utils'

export function TruncatedCell({
  primary,
  secondary,
  title,
  className,
  ...props
}: {
  primary: React.ReactNode
  secondary?: React.ReactNode
  title?: string
} & Omit<React.ComponentProps<'td'>, 'title'>) {
  const resolvedTitle = title ?? (typeof primary === 'string' ? primary : undefined)
  return (
    <TableCell className={cn('overflow-hidden whitespace-normal', className)} {...props}>
      <div className="truncate" title={resolvedTitle}>{primary}</div>
      {secondary != null && (
        <div className="truncate text-xs text-muted-foreground">{secondary}</div>
      )}
    </TableCell>
  )
}
