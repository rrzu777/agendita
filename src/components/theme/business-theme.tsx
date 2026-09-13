'use client'

import { useLayoutEffect, useMemo, type CSSProperties, type ReactNode } from 'react'
import type { BusinessCategory, BusinessVisualStyle } from '@prisma/client'
import { businessThemeCssVariables } from '@/lib/theme/business-theme'

type BusinessThemeProps = {
  children: ReactNode
  business: {
    brandColor: string | null
    visualStyle: BusinessVisualStyle
    category: BusinessCategory
  }
}

export function BusinessTheme({ children, business }: BusinessThemeProps) {
  const { brandColor, category, visualStyle } = business
  const variables = useMemo(
    () => businessThemeCssVariables({ brandColor, category, visualStyle }),
    [brandColor, category, visualStyle],
  )
  const style = variables as CSSProperties

  useLayoutEffect(() => {
    const root = document.documentElement
    const previous = Object.entries(variables).map(([property]) => ({
      property,
      value: root.style.getPropertyValue(property),
      priority: root.style.getPropertyPriority(property),
    }))

    for (const [property, value] of Object.entries(variables)) {
      root.style.setProperty(property, value)
    }

    return () => {
      for (const { property, value, priority } of previous) {
        if (value) root.style.setProperty(property, value, priority)
        else root.style.removeProperty(property)
      }
    }
  }, [variables])

  return (
    <div data-business-theme="" data-visual-style={visualStyle} style={style}>
      {children}
    </div>
  )
}
