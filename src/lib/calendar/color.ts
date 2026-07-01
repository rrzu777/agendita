export const DEFAULT_SERVICE_COLOR = '#e5e7eb' // gris neutro de respaldo

export type RGB = { r: number; g: number; b: number }

export function parseHex(hex: string | undefined | null): RGB | null {
  if (!hex) return null
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const int = parseInt(m[1], 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

function channelLuminance(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex) ?? parseHex(DEFAULT_SERVICE_COLOR)!
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  )
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

const DARK_TEXT = '#1f2937' // gray-800
const LIGHT_TEXT = '#ffffff'

export function readableTextColor(bgHex: string): string {
  const darkRatio = contrastRatio(bgHex, DARK_TEXT)
  const lightRatio = contrastRatio(bgHex, LIGHT_TEXT)
  if (darkRatio >= 4.5) return DARK_TEXT
  if (lightRatio >= 4.5) return LIGHT_TEXT
  return darkRatio >= lightRatio ? DARK_TEXT : LIGHT_TEXT
}

export function deriveBorderColor(bgHex: string): string {
  const rgb = parseHex(bgHex) ?? parseHex(DEFAULT_SERVICE_COLOR)!
  const factor = 0.72 // ~28% más oscuro
  const toHex = (c: number) => Math.round(c * factor).toString(16).padStart(2, '0')
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}
