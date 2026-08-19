import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { writeSettingsDraft } from '@/lib/business/settings-draft'
import { useSettingsDraft } from '@/components/dashboard/settings/use-settings-draft'
import { GuardedLink, UnsavedChangesProvider, useUnsavedChangesRegistration } from '@/components/dashboard/unsaved-changes-provider'

const mockPush = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: vi.fn() }) }))

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

function ReactHookFormDraftHarness({
  onReady,
}: {
  onReady: (form: UseFormReturn<{ name: string }>, discard: () => void) => void
}) {
  const form = useForm<{ name: string }>({ defaultValues: { name: 'A' } })
  const values = form.getValues()
  const draft = useSettingsDraft({
    key: 'biz:profile',
    version: 1,
    baseline: { name: 'A' },
    values,
    isDirty: form.formState.isDirty,
    reset: form.reset,
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

    expect(reset).toHaveBeenCalledWith({ name: 'B' }, { keepDefaultValues: true })
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
