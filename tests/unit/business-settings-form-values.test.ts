import { describe, expect, it } from 'vitest'
import { toProfileSettingsFormValues } from '@/lib/business/settings-form-values'

describe('toProfileSettingsFormValues', () => {
  it('maps persisted tenant appearance into the editable profile values', () => {
    expect(toProfileSettingsFormValues({
      name: 'Mimos Nails',
      bio: null,
      profileImageUrl: null,
      logoUrl: null,
      whatsapp: null,
      instagram: null,
      addressText: null,
      city: 'Santiago',
      subdomain: 'mimosnails',
      brandColor: '#B64D68',
      visualStyle: 'soft',
    })).toMatchObject({
      brandColor: '#B64D68',
      visualStyle: 'soft',
    })
  })

  it('uses safe editable defaults for rows created before appearance settings', () => {
    expect(toProfileSettingsFormValues({
      name: 'Negocio',
      bio: null,
      profileImageUrl: null,
      logoUrl: null,
      whatsapp: null,
      instagram: null,
      addressText: null,
      city: 'Santiago',
      subdomain: 'negocio',
      brandColor: null,
      visualStyle: 'balanced',
    })).toMatchObject({
      brandColor: '',
      visualStyle: 'balanced',
    })
  })
})
