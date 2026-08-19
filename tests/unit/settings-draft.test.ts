import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearSettingsDraft,
  readSettingsDraft,
  writeSettingsDraft,
} from '@/lib/business/settings-draft'

describe('settings drafts', () => {
  afterEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('restores only when the server baseline still matches', () => {
    const storage = window.sessionStorage
    storage.clear()

    writeSettingsDraft(storage, 'biz:profile', 1, { name: 'A' }, { name: 'B' })

    expect(readSettingsDraft(storage, 'biz:profile', 1, { name: 'A' })).toEqual({
      kind: 'restored',
      values: { name: 'B' },
    })
    expect(readSettingsDraft(storage, 'biz:profile', 1, { name: 'C' })).toEqual({ kind: 'conflict' })
    expect(storage.getItem('biz:profile')).toBeNull()
  })

  it('rejects malformed and wrong-version drafts', () => {
    const storage = window.sessionStorage
    const baseline = { name: 'A' }
    storage.clear()
    storage.setItem('biz:profile', '{bad')

    expect(readSettingsDraft(storage, 'biz:profile', 1, baseline)).toEqual({ kind: 'none' })
    expect(storage.getItem('biz:profile')).toBeNull()

    writeSettingsDraft(storage, 'biz:profile', 2, baseline, { name: 'B' })
    expect(readSettingsDraft(storage, 'biz:profile', 1, baseline)).toEqual({ kind: 'none' })
    expect(storage.getItem('biz:profile')).toBeNull()
  })

  it('degrades safely when browser storage is restricted', () => {
    const storage = {
      getItem: vi.fn(() => { throw new DOMException('Blocked', 'SecurityError') }),
      setItem: vi.fn(() => { throw new DOMException('Blocked', 'SecurityError') }),
      removeItem: vi.fn(() => { throw new DOMException('Blocked', 'SecurityError') }),
    } as unknown as Storage

    expect(readSettingsDraft(storage, 'biz:profile', 1, { name: 'A' })).toEqual({ kind: 'none' })
    expect(() => writeSettingsDraft(storage, 'biz:profile', 1, { name: 'A' }, { name: 'B' })).not.toThrow()
    expect(() => clearSettingsDraft(storage, 'biz:profile')).not.toThrow()
  })
})
