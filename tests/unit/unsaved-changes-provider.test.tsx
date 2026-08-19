import { act, StrictMode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPush, mockReplace, discard } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
  discard: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }) }))

import {
  GuardedLink,
  UnsavedChangesProvider,
  useUnsavedChanges,
  useUnsavedChangesRegistration,
} from '@/components/dashboard/unsaved-changes-provider'

type GuardLinkOptions = {
  href?: string
  target?: string
  download?: string | boolean
  replace?: boolean
  scroll?: boolean
}

function DirtyRegistration({ dirty, ...linkOptions }: { dirty: boolean } & GuardLinkOptions) {
  useUnsavedChangesRegistration({ scope: 'profile', isDirty: dirty, discard })
  return <GuardedLink href="/dashboard/bookings" {...linkOptions}>Reservas</GuardedLink>
}

function DirtyButtonRegistration() {
  useUnsavedChangesRegistration({ scope: 'profile', isDirty: true, discard })
  const { requestNavigation } = useUnsavedChanges()
  return (
    <button type="button" onClick={(event) => requestNavigation(() => mockPush('/dashboard/bookings'), event.currentTarget)}>
      Navegar
    </button>
  )
}

function RemovingButtonRegistration({ proceed }: { proceed: () => void }) {
  useUnsavedChangesRegistration({ scope: 'profile', isDirty: true, discard })
  const { requestNavigation } = useUnsavedChanges()
  return (
    <button type="button" onClick={(event) => requestNavigation(proceed, event.currentTarget)}>
      Navegar y quitar
    </button>
  )
}

function RemovingButtonHarness() {
  const [showInitiator, setShowInitiator] = useState(true)
  return (
    <UnsavedChangesProvider>
      {showInitiator
        ? <RemovingButtonRegistration proceed={() => setShowInitiator(false)} />
        : <p>Navegación completada</p>}
    </UnsavedChangesProvider>
  )
}

function GuardHarness({ dirty, ...linkOptions }: { dirty: boolean } & GuardLinkOptions) {
  return (
    <StrictMode>
      <UnsavedChangesProvider>
        <DirtyRegistration dirty={dirty} {...linkOptions} />
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

  async function renderGuard(dirty: boolean, linkOptions: GuardLinkOptions = {}) {
    await act(async () => root.render(<GuardHarness dirty={dirty} {...linkOptions} />))
  }

  async function clickLink(options: MouseEventInit = {}) {
    const link = [...container.querySelectorAll('a')].find((candidate) => candidate.textContent === 'Reservas')
    if (!link) throw new Error('Guarded link not found')

    await act(async () => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options }))
    })
  }

  async function waitForDialogClose() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
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

  it.each([
    ['middle clicks', { button: 1 }, {}],
    ['new-tab targets', {}, { target: '_blank' }],
    ['external URLs', {}, { href: 'https://example.com' }],
    ['empty download attributes', {}, { download: '' }],
  ])('preserves native behavior for %s', async (_label, options, linkOptions) => {
    await renderGuard(true, linkOptions)
    let providerPreventedNavigation = true
    const preventJSDOMNavigation = (event: MouseEvent) => {
      providerPreventedNavigation = event.defaultPrevented
      event.preventDefault()
    }
    window.addEventListener('click', preventJSDOMNavigation)

    await clickLink(options)

    window.removeEventListener('click', preventJSDOMNavigation)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
    expect(providerPreventedNavigation).toBe(false)
  })

  it('replays replace navigation with its scroll option after discard', async () => {
    await renderGuard(true, { replace: true, scroll: false })

    await clickLink()
    const discardButton = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Descartar cambios')
    if (!discardButton) throw new Error('Discard button not found')
    await act(async () => discardButton.click())

    expect(mockReplace).toHaveBeenCalledWith('/dashboard/bookings', { scroll: false })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('restores focus to the link when continuing to edit', async () => {
    await renderGuard(true)
    const link = container.querySelector('a')
    if (!link) throw new Error('Guarded link not found')
    link.focus()

    await clickLink()
    const continueButton = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Seguir editando')
    if (!continueButton) throw new Error('Continue button not found')
    await act(async () => continueButton.click())
    await waitForDialogClose()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(link)
  })

  it('restores focus to a button initiator after Escape', async () => {
    await act(async () => root.render(
      <StrictMode>
        <UnsavedChangesProvider>
          <DirtyButtonRegistration />
        </UnsavedChangesProvider>
      </StrictMode>,
    ))
    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Navegar')
    if (!button) throw new Error('Navigation button not found')
    button.focus()
    await act(async () => button.click())
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await waitForDialogClose()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('does not restore focus to an initiator removed by the confirmed navigation', async () => {
    await act(async () => root.render(<RemovingButtonHarness />))
    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Navegar y quitar')
    if (!button) throw new Error('Removing navigation button not found')
    button.focus()
    const focus = vi.spyOn(button, 'focus')

    await act(async () => button.click())
    focus.mockClear()
    const discardButton = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Descartar cambios')
    if (!discardButton) throw new Error('Discard button not found')
    await act(async () => discardButton.click())
    await waitForDialogClose()

    expect(container.textContent).toContain('Navegación completada')
    expect(focus).not.toHaveBeenCalled()
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
