import { describe, expect, it } from 'vitest'
import { businessThemeCssVariables, resolveBusinessTheme } from '@/lib/theme/business-theme'

describe('resolveBusinessTheme', () => {
  it('derives an accessible tenant palette from a valid custom color', () => {
    const theme = resolveBusinessTheme({
      brandColor: '#B64D68',
      visualStyle: 'soft',
      category: 'nails',
    })

    expect(theme.brand).toBe('#B64D68')
    expect(theme.onBrand).toBe('#FFFFFF')
    expect(theme.brandStrong).toMatch(/^#[0-9A-F]{6}$/)
    expect(theme.brandSoft).toMatch(/^#[0-9A-F]{6}$/)
    expect(theme.panelRadius).toBe('1rem')
  })

  it('uses category presets only as safe fallbacks', () => {
    expect(resolveBusinessTheme({ brandColor: null, visualStyle: 'soft', category: 'beauty' }).brand)
      .toBe('#B64D68')
    expect(resolveBusinessTheme({ brandColor: null, visualStyle: 'contrast', category: 'barber' }).brand)
      .toBe('#35524A')
  })

  it('rejects malformed custom colors instead of injecting them into CSS', () => {
    const theme = resolveBusinessTheme({
      brandColor: 'red; background:url(javascript:alert(1))',
      visualStyle: 'balanced',
      category: 'other',
    })

    expect(theme.brand).toBe('#4F5D54')
    expect(JSON.stringify(theme)).not.toContain('javascript')
  })

  it('keeps visual styles non-gendered and changes geometry deliberately', () => {
    const input = { brandColor: '#3C4D67', category: 'barber' as const }

    expect(resolveBusinessTheme({ ...input, visualStyle: 'soft' }).panelRadius).toBe('1rem')
    expect(resolveBusinessTheme({ ...input, visualStyle: 'balanced' }).panelRadius).toBe('0.875rem')
    expect(resolveBusinessTheme({ ...input, visualStyle: 'contrast' }).panelRadius).toBe('0.625rem')
  })

  it('maps the resolved palette into the shared semantic CSS contract', () => {
    const variables = businessThemeCssVariables({
      brandColor: '#35524A',
      visualStyle: 'contrast',
      category: 'barber',
    })

    expect(variables).toMatchObject({
      '--tenant-brand': '#35524A',
      '--primary': '#35524A',
      '--primary-foreground': '#FFFFFF',
      '--sidebar-primary': '#35524A',
      '--radius': '0.625rem',
    })
  })
})
