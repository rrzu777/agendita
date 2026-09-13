import type { BusinessCategory } from '@prisma/client'

export const BUSINESS_VISUAL_STYLES = ['soft', 'balanced', 'contrast'] as const
export type BusinessVisualStyleValue = typeof BUSINESS_VISUAL_STYLES[number]

export type BusinessThemeInput = {
  brandColor?: string | null
  visualStyle?: BusinessVisualStyleValue | null
  category?: BusinessCategory | null
}

export type BusinessTheme = {
  brand: string
  brandStrong: string
  brandSoft: string
  onBrand: '#FFFFFF' | '#20231F'
  panelRadius: string
  visualStyle: BusinessVisualStyleValue
}

const CATEGORY_BRAND: Record<BusinessCategory, string> = {
  nails: '#B64D68', beauty: '#B64D68', hair_salon: '#785A6F', barber: '#35524A',
  massage: '#557568', therapy: '#52657A', other: '#4F5D54',
}

const STYLE_RADIUS: Record<BusinessVisualStyleValue, string> = {
  soft: '1rem', balanced: '0.875rem', contrast: '0.625rem',
}

export function defaultVisualStyleForCategory(category: BusinessCategory): BusinessVisualStyleValue {
  if (category === 'nails' || category === 'beauty') return 'soft'
  if (category === 'barber') return 'contrast'
  return 'balanced'
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function normalizeHex(value: string | null | undefined): string | null {
  const candidate = value?.trim()
  return candidate && HEX_COLOR.test(candidate) ? candidate.toUpperCase() : null
}

function hexToRgb(hex: string) {
  return { r: Number.parseInt(hex.slice(1, 3), 16), g: Number.parseInt(hex.slice(3, 5), 16), b: Number.parseInt(hex.slice(5, 7), 16) }
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function mix(hex: string, target: '#FFFFFF' | '#20231F', amount: number) {
  const color = hexToRgb(hex)
  const destination = hexToRgb(target)
  return rgbToHex({
    r: color.r + (destination.r - color.r) * amount,
    g: color.g + (destination.g - color.g) * amount,
    b: color.b + (destination.b - color.b) * amount,
  })
}

function relativeLuminance(hex: string) {
  const { r, g, b } = hexToRgb(hex)
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(a: string, b: string) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

function readableText(background: string): BusinessTheme['onBrand'] {
  return contrastRatio(background, '#FFFFFF') >= contrastRatio(background, '#20231F') ? '#FFFFFF' : '#20231F'
}

function strongBrand(brand: string) {
  let candidate = brand
  for (let index = 0; index < 8 && contrastRatio(candidate, '#FFFFFF') < 4.5; index += 1) {
    candidate = mix(candidate, '#20231F', 0.12)
  }
  return candidate
}

export function resolveBusinessTheme(input: BusinessThemeInput): BusinessTheme {
  const visualStyle = BUSINESS_VISUAL_STYLES.includes(input.visualStyle as BusinessVisualStyleValue)
    ? input.visualStyle as BusinessVisualStyleValue
    : 'balanced'
  const brand = normalizeHex(input.brandColor) ?? CATEGORY_BRAND[input.category ?? 'other']
  const brandStrong = strongBrand(brand)
  const softMix = visualStyle === 'contrast' ? 0.84 : visualStyle === 'soft' ? 0.9 : 0.87

  return {
    brand,
    brandStrong,
    brandSoft: mix(brand, '#FFFFFF', softMix),
    onBrand: readableText(brandStrong),
    panelRadius: STYLE_RADIUS[visualStyle],
    visualStyle,
  }
}

export type BusinessThemeCssVariables = Record<
  | '--tenant-brand'
  | '--tenant-brand-strong'
  | '--tenant-brand-soft'
  | '--tenant-on-brand'
  | '--primary'
  | '--primary-foreground'
  | '--secondary'
  | '--secondary-foreground'
  | '--accent'
  | '--accent-foreground'
  | '--ring'
  | '--sidebar-primary'
  | '--sidebar-primary-foreground'
  | '--sidebar-accent'
  | '--sidebar-accent-foreground'
  | '--radius',
  string
>

export function businessThemeCssVariables(input: BusinessThemeInput): BusinessThemeCssVariables {
  const theme = resolveBusinessTheme(input)

  return {
    '--tenant-brand': theme.brand,
    '--tenant-brand-strong': theme.brandStrong,
    '--tenant-brand-soft': theme.brandSoft,
    '--tenant-on-brand': theme.onBrand,
    '--primary': theme.brandStrong,
    '--primary-foreground': theme.onBrand,
    '--secondary': theme.brandSoft,
    '--secondary-foreground': theme.brandStrong,
    '--accent': theme.brandSoft,
    '--accent-foreground': theme.brandStrong,
    '--ring': theme.brandStrong,
    '--sidebar-primary': theme.brandStrong,
    '--sidebar-primary-foreground': theme.onBrand,
    '--sidebar-accent': theme.brandSoft,
    '--sidebar-accent-foreground': theme.brandStrong,
    '--radius': theme.panelRadius,
  }
}
