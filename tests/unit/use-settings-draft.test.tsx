import { act, StrictMode, useCallback, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import { writeSettingsDraft } from '@/lib/business/settings-draft'
import { useSettingsDraft } from '@/components/dashboard/settings/use-settings-draft'
import { GuardedLink, UnsavedChangesProvider, useUnsavedChangesRegistration } from '@/components/dashboard/unsaved-changes-provider'

const { mockPush, mockVerifySettingsDraftBaseline } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockVerifySettingsDraftBaseline: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: vi.fn() }) }))
vi.mock('@/server/actions/settings-draft-verifier', () => ({
  verifySettingsDraftBaseline: mockVerifySettingsDraftBaseline,
}))

function DraftHarness({
  isDirty,
  reset,
  replaceBaseline,
  onDiscardReady,
  onActionsReady,
  baselineName = 'A',
  valueName,
}: {
  isDirty: boolean
  reset: (values: { name: string }) => void
  replaceBaseline?: (values: { name: string }) => void
  onDiscardReady?: (discard: () => void) => void
  onActionsReady?: (actions: { discard: () => void; clearDraft: () => void }) => void
  baselineName?: string
  valueName?: string
}) {
  const draft = useSettingsDraft({
    scope: 'profile',
    key: 'biz:profile',
    version: 1,
    baseline: { name: baselineName },
    values: { name: valueName ?? (isDirty ? 'B' : baselineName) },
    isDirty,
    reset,
    replaceBaseline: replaceBaseline ?? reset,
  })

  onDiscardReady?.(draft.discard)
  onActionsReady?.({ discard: draft.discard, clearDraft: draft.clearDraft })
  return <output>{draft.recovery}</output>
}

type StatefulHarnessApi = {
  form: UseFormReturn<{ name: string }>
  discard: () => void
  clearDraft: () => void
  recovery: string
}

function StatefulFormDraftHarness({
  initialName = 'A',
  onReady,
}: {
  initialName?: string
  onReady: (api: StatefulHarnessApi) => void
}) {
  const [baseline, setBaseline] = useState({ name: initialName })
  const form = useForm<{ name: string }>({ defaultValues: { name: initialName } })
  const name = useWatch({ control: form.control, name: 'name' })
  const replaceBaseline = useCallback((next: { name: string }) => {
    form.reset(next)
    setBaseline(next)
  }, [form])
  const draft = useSettingsDraft({
    scope: 'profile',
    key: 'biz:profile',
    version: 1,
    baseline,
    values: { name },
    isDirty: form.formState.isDirty,
    reset: form.reset,
    replaceBaseline,
  })

  onReady({ form, discard: draft.discard, clearDraft: draft.clearDraft, recovery: draft.recovery })
  return <output>{draft.recovery}</output>
}

function ReactHookFormDraftHarness({
  onReady,
}: {
  onReady: (form: UseFormReturn<{ name: string }>, discard: () => void) => void
}) {
  const form = useForm<{ name: string }>({ defaultValues: { name: 'A' } })
  const values = form.getValues()
  const draft = useSettingsDraft({
    scope: 'profile',
    key: 'biz:profile',
    version: 1,
    baseline: { name: 'A' },
    values,
    isDirty: form.formState.isDirty,
    reset: form.reset,
    replaceBaseline: (values) => form.reset(values),
  })
  useUnsavedChangesRegistration({ scope: 'profile', isDirty: form.formState.isDirty, discard: draft.discard })
  onReady(form, draft.discard)

  return <GuardedLink href="/dashboard/bookings">Reservas</GuardedLink>
}

describe('useSettingsDraft', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    sessionStorage.clear()
    mockVerifySettingsDraftBaseline.mockReset()
    mockVerifySettingsDraftBaseline.mockResolvedValue({ matches: true, current: { name: 'A' } })
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
    await act(async () => {
      await vi.waitFor(() => expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(1))
    })

    expect(reset).toHaveBeenCalledWith({ name: 'B' }, { keepDefaultValues: true })
    expect(container.textContent).toBe('restored')
    expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledWith('profile', expect.any(String))
  })

  it('fails closed without applying or deleting a draft when server verification fails', async () => {
    writeSettingsDraft(sessionStorage, 'biz:profile', 1, { name: 'A' }, { name: 'B' })
    mockVerifySettingsDraftBaseline.mockRejectedValue(new Error('offline'))
    const reset = vi.fn()

    await act(async () => root.render(
      <StrictMode><DraftHarness isDirty={false} reset={reset} /></StrictMode>,
    ))
    await act(async () => {
      await vi.waitFor(() => expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(container.textContent).toBe('verification-failed'))
    })

    expect(reset).not.toHaveBeenCalled()
    expect(container.textContent).toBe('verification-failed')
    expect(sessionStorage.getItem('biz:profile')).not.toBeNull()
    expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(1)
  })

  it('keeps fresh server values and the stored draft when verification finds a conflict', async () => {
    writeSettingsDraft(sessionStorage, 'biz:profile', 1, { name: 'A' }, { name: 'B' })
    mockVerifySettingsDraftBaseline.mockResolvedValue({ matches: false, current: { name: 'C' } })
    const reset = vi.fn()
    const replaceBaseline = vi.fn()

    await act(async () => root.render(
      <DraftHarness isDirty={false} reset={reset} replaceBaseline={replaceBaseline} />,
    ))
    await act(async () => {
      await vi.waitFor(() => expect(replaceBaseline).toHaveBeenCalledWith({ name: 'C' }))
    })

    expect(reset).not.toHaveBeenCalledWith({ name: 'B' }, expect.anything())
    expect(replaceBaseline).toHaveBeenCalledWith({ name: 'C' })
    expect(container.textContent).toBe('conflict')
    expect(sessionStorage.getItem('biz:profile')).not.toBeNull()
  })

  it('re-verifies once per real popstate and persisted pageshow under StrictMode', async () => {
    writeSettingsDraft(sessionStorage, 'biz:profile', 1, { name: 'A' }, { name: 'B' })
    const reset = vi.fn()
    await act(async () => root.render(
      <StrictMode><DraftHarness isDirty={false} reset={reset} /></StrictMode>,
    ))
    await act(async () => {
      await vi.waitFor(() => expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(1))
    })
    expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(1)

    reset.mockClear()
    writeSettingsDraft(sessionStorage, 'biz:profile', 1, { name: 'A' }, { name: 'B2' })
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'))
      await vi.waitFor(() => expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(2))
    })
    expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(2)
    expect(reset).toHaveBeenCalledWith({ name: 'B2' }, { keepDefaultValues: true })

    reset.mockClear()
    writeSettingsDraft(sessionStorage, 'biz:profile', 1, { name: 'A' }, { name: 'B3' })
    await act(async () => {
      const pageshow = new Event('pageshow')
      Object.defineProperty(pageshow, 'persisted', { value: true })
      window.dispatchEvent(pageshow)
      await vi.waitFor(() => expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(3))
    })
    expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(3)
    expect(reset).toHaveBeenCalledWith({ name: 'B3' }, { keepDefaultValues: true })
  })

  it('does not apply a verifier response after the user edits while it is pending', async () => {
    writeSettingsDraft(sessionStorage, 'biz:profile', 1, { name: 'A' }, { name: 'B' })
    const verification = deferred<{ matches: boolean; current: { name: string } }>()
    mockVerifySettingsDraftBaseline.mockReturnValueOnce(verification.promise)
    let api: StatefulHarnessApi | undefined

    await act(async () => root.render(
      <StatefulFormDraftHarness onReady={(next) => { api = next }} />,
    ))
    await vi.waitFor(() => expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(1))

    await act(async () => api?.form.setValue('name', 'X', { shouldDirty: true }))
    expect(api?.form.getValues()).toEqual({ name: 'X' })

    await act(async () => verification.resolve({ matches: true, current: { name: 'A' } }))

    expect(api?.form.getValues()).toEqual({ name: 'X' })
    expect(api?.recovery).toBe('none')
  })

  it('applies only the latest verification when two responses resolve in reverse order', async () => {
    writeSettingsDraft(sessionStorage, 'biz:profile', 1, { name: 'A' }, { name: 'B1' })
    const first = deferred<{ matches: boolean; current: { name: string } }>()
    const second = deferred<{ matches: boolean; current: { name: string } }>()
    mockVerifySettingsDraftBaseline
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const reset = vi.fn()

    await act(async () => root.render(<DraftHarness isDirty={false} reset={reset} />))
    await vi.waitFor(() => expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(1))

    writeSettingsDraft(sessionStorage, 'biz:profile', 1, { name: 'A' }, { name: 'B2' })
    await act(async () => window.dispatchEvent(new PopStateEvent('popstate')))
    await vi.waitFor(() => expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(2))

    await act(async () => second.resolve({ matches: true, current: { name: 'A' } }))
    await vi.waitFor(() => expect(reset).toHaveBeenCalledWith({ name: 'B2' }, { keepDefaultValues: true }))
    await act(async () => first.resolve({ matches: true, current: { name: 'A' } }))

    expect(reset).not.toHaveBeenCalledWith({ name: 'B1' }, { keepDefaultValues: true })
    expect(reset).toHaveBeenLastCalledWith({ name: 'B2' }, { keepDefaultValues: true })
  })

  it.each([
    ['save clear', (actions: { clearDraft: () => void; discard: () => void }) => actions.clearDraft()],
    ['discard', (actions: { clearDraft: () => void; discard: () => void }) => actions.discard()],
  ])('invalidates a pending verification after %s', async (_label, invalidate) => {
    writeSettingsDraft(sessionStorage, 'biz:profile', 1, { name: 'A' }, { name: 'B' })
    const verification = deferred<{ matches: boolean; current: { name: string } }>()
    mockVerifySettingsDraftBaseline.mockReturnValueOnce(verification.promise)
    const reset = vi.fn()
    let actions: { clearDraft: () => void; discard: () => void } | undefined

    await act(async () => root.render(
      <DraftHarness
        isDirty={false}
        reset={reset}
        onActionsReady={(next) => { actions = next }}
      />,
    ))
    await vi.waitFor(() => expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(1))

    await act(async () => {
      if (actions) invalidate(actions)
    })
    await act(async () => verification.resolve({ matches: true, current: { name: 'A' } }))

    expect(reset).not.toHaveBeenCalledWith({ name: 'B' }, { keepDefaultValues: true })
    expect(sessionStorage.getItem('biz:profile')).toBeNull()
  })

  it('does not apply a verifier response after unmount', async () => {
    writeSettingsDraft(sessionStorage, 'biz:profile', 1, { name: 'A' }, { name: 'B' })
    const verification = deferred<{ matches: boolean; current: { name: string } }>()
    mockVerifySettingsDraftBaseline.mockReturnValueOnce(verification.promise)
    const reset = vi.fn()

    await act(async () => root.render(<DraftHarness isDirty={false} reset={reset} />))
    await vi.waitFor(() => expect(mockVerifySettingsDraftBaseline).toHaveBeenCalledTimes(1))
    await act(async () => root.unmount())
    await act(async () => verification.resolve({ matches: true, current: { name: 'A' } }))

    expect(reset).not.toHaveBeenCalled()
  })

  it('preserves the exact dirty candidate when a persisted pageshow finds a conflict', async () => {
    let api: StatefulHarnessApi | undefined
    await act(async () => root.render(
      <StatefulFormDraftHarness onReady={(next) => { api = next }} />,
    ))
    await act(async () => api?.form.setValue('name', 'B', { shouldDirty: true }))
    await vi.waitFor(() => expect(sessionStorage.getItem('biz:profile')).not.toBeNull())
    const storedCandidate = sessionStorage.getItem('biz:profile')
    mockVerifySettingsDraftBaseline.mockResolvedValueOnce({ matches: false, current: { name: 'C' } })

    await act(async () => {
      const pageshow = new Event('pageshow')
      Object.defineProperty(pageshow, 'persisted', { value: true })
      window.dispatchEvent(pageshow)
    })
    await vi.waitFor(() => expect(api?.recovery).toBe('conflict'))
    await vi.waitFor(() => expect(api?.form.getValues()).toEqual({ name: 'C' }))

    expect(sessionStorage.getItem('biz:profile')).toBe(storedCandidate)
  })

  it('restores against authenticated current values rather than cached client defaults', async () => {
    writeSettingsDraft(sessionStorage, 'biz:profile', 1, { name: 'A' }, { name: 'B' })
    const storedCandidate = sessionStorage.getItem('biz:profile')
    mockVerifySettingsDraftBaseline.mockResolvedValueOnce({ matches: true, current: { name: 'A' } })
    let api: StatefulHarnessApi | undefined

    await act(async () => root.render(
      <StatefulFormDraftHarness initialName="C" onReady={(next) => { api = next }} />,
    ))
    await vi.waitFor(() => expect(api?.recovery).toBe('restored'))

    expect(api?.form.getValues()).toEqual({ name: 'B' })
    expect(api?.form.formState.defaultValues).toEqual({ name: 'A' })
    expect(api?.form.formState.isDirty).toBe(true)
    expect(sessionStorage.getItem('biz:profile')).toBe(storedCandidate)

    await act(async () => api?.discard())
    expect(api?.form.getValues()).toEqual({ name: 'A' })
    expect(sessionStorage.getItem('biz:profile')).toBeNull()
  })

  it('writes dirty values and clears the local draft on explicit discard', async () => {
    const reset = vi.fn()
    let discard: (() => void) | undefined

    await act(async () => root.render(
      <DraftHarness isDirty reset={reset} onDiscardReady={(nextDiscard) => { discard = nextDiscard }} />,
    ))
    await vi.waitFor(() => expect(sessionStorage.getItem('biz:profile')).not.toBeNull())
    expect(sessionStorage.getItem('biz:profile')).not.toBeNull()

    await act(async () => discard?.())

    expect(sessionStorage.getItem('biz:profile')).toBeNull()
    expect(reset).toHaveBeenCalledWith({ name: 'A' })
  })

  it('restores React Hook Form values as dirty against the server baseline and discards cleanly', async () => {
    writeSettingsDraft(sessionStorage, 'biz:profile', 1, { name: 'A' }, { name: 'B' })
    let form: UseFormReturn<{ name: string }> | undefined
    let discard: (() => void) | undefined

    await act(async () => root.render(
      <UnsavedChangesProvider>
        <ReactHookFormDraftHarness onReady={(nextForm, nextDiscard) => {
          form = nextForm
          discard = nextDiscard
        }} />
      </UnsavedChangesProvider>,
    ))
    await vi.waitFor(() => expect(form?.getValues()).toEqual({ name: 'B' }))

    expect(form?.getValues()).toEqual({ name: 'B' })
    expect(form?.formState.defaultValues).toEqual({ name: 'A' })
    expect(form?.formState.isDirty).toBe(true)

    const link = container.querySelector('a')
    if (!link) throw new Error('Guarded link not found')
    await act(async () => link.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => discard?.())
    expect(form?.getValues()).toEqual({ name: 'A' })
    expect(form?.formState.defaultValues).toEqual({ name: 'A' })
    expect(form?.formState.isDirty).toBe(false)
  })
})
