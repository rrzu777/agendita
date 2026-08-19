import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeSettingsDraft } from '@/lib/business/settings-draft'
import { useSettingsDraft } from '@/components/dashboard/settings/use-settings-draft'

function DraftHarness({
  isDirty,
  reset,
  onDiscardReady,
}: {
  isDirty: boolean
  reset: (values: { name: string }) => void
  onDiscardReady?: (discard: () => void) => void
}) {
  const draft = useSettingsDraft({
    key: 'biz:profile',
    version: 1,
    baseline: { name: 'A' },
    values: isDirty ? { name: 'B' } : { name: 'A' },
    isDirty,
    reset,
  })

  onDiscardReady?.(draft.discard)
  return <output>{draft.recovery}</output>
}

describe('useSettingsDraft', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    sessionStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('restores a matching draft once and exposes recovery state', async () => {
    writeSettingsDraft(sessionStorage, 'biz:profile', 1, { name: 'A' }, { name: 'B' })
    const reset = vi.fn()

    await act(async () => root.render(<DraftHarness isDirty={false} reset={reset} />))

    expect(reset).toHaveBeenCalledWith({ name: 'B' })
    expect(container.textContent).toBe('restored')
  })

  it('writes dirty values and clears the local draft on explicit discard', async () => {
    const reset = vi.fn()
    let discard: (() => void) | undefined

    await act(async () => root.render(
      <DraftHarness isDirty reset={reset} onDiscardReady={(nextDiscard) => { discard = nextDiscard }} />,
    ))
    expect(sessionStorage.getItem('biz:profile')).not.toBeNull()

    await act(async () => discard?.())

    expect(sessionStorage.getItem('biz:profile')).toBeNull()
    expect(reset).toHaveBeenCalledWith({ name: 'A' })
  })
})
