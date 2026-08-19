import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPush, discard } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  discard: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

import {
  GuardedLink,
  UnsavedChangesProvider,
  useUnsavedChangesRegistration,
} from '@/components/dashboard/unsaved-changes-provider'

function DirtyRegistration({ dirty }: { dirty: boolean }) {
  useUnsavedChangesRegistration({ scope: 'profile', isDirty: dirty, discard })
  return <GuardedLink href="/dashboard/bookings">Reservas</GuardedLink>
}

function GuardHarness({ dirty }: { dirty: boolean }) {
  return (
    <StrictMode>
      <UnsavedChangesProvider>
        <DirtyRegistration dirty={dirty} />
      </UnsavedChangesProvider>
    </StrictMode>
  )
}

describe('UnsavedChangesProvider', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  async function renderGuard(dirty: boolean) {
    await act(async () => root.render(<GuardHarness dirty={dirty} />))
  }

  async function clickLink(options: MouseEventInit = {}) {
    const link = [...container.querySelectorAll('a')].find((candidate) => candidate.textContent === 'Reservas')
    if (!link) throw new Error('Guarded link not found')

    await act(async () => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options }))
    })
  }

  it('blocks owned navigation while dirty and proceeds after discard', async () => {
    await renderGuard(true)

    await clickLink()

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Cambios sin guardar')
    expect(mockPush).not.toHaveBeenCalled()

    const discardButton = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Descartar cambios')
    if (!discardButton) throw new Error('Discard button not found')
    await act(async () => discardButton.click())

    expect(discard).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith('/dashboard/bookings')
  })

  it('does not block modifier clicks', async () => {
    await renderGuard(true)
    let providerPreventedNavigation = true
    const preventJSDOMNavigation = (event: MouseEvent) => {
      if (!event.ctrlKey) return
      providerPreventedNavigation = event.defaultPrevented
      event.preventDefault()
    }
    window.addEventListener('click', preventJSDOMNavigation)

    await clickLink({ ctrlKey: true })

    window.removeEventListener('click', preventJSDOMNavigation)

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mockPush).not.toHaveBeenCalled()
    expect(providerPreventedNavigation).toBe(false)
  })

  it('registers beforeunload only while dirty and cleans it up', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    await renderGuard(false)
    expect(add).not.toHaveBeenCalledWith('beforeunload', expect.any(Function))

    await renderGuard(true)
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function))

    await act(async () => root.unmount())
    expect(remove).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  })
})
