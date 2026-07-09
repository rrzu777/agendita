"use client"

import * as React from 'react'
import { MoreVertical } from 'lucide-react'
import { Button } from './button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from './dropdown-menu'

export function TableActions({
  primary,
  children,
  align = 'end',
}: {
  primary?: React.ReactNode
  children?: React.ReactNode
  align?: 'start' | 'end'
}) {
  const hasMenu = React.Children.count(children) > 0
  return (
    <div className="flex items-center justify-end gap-1">
      {primary}
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Más acciones">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={align} className="w-auto min-w-44">
            {children}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
