import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForTourTarget } from '@/components/dashboard/tours/tour-target'

describe('waitForTourTarget', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(20, 30, 100, 40))
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns a target that is already present without installing an observer', async () => {
    const target = document.createElement('button')
    target.dataset.tourId = 'booking-row'
    document.body.appendChild(target)
    const observer = vi.fn()
    vi.stubGlobal('MutationObserver', observer)

    await expect(waitForTourTarget({ targetId: 'booking-row', waitMs: 50 })).resolves.toBe(target)
    expect(observer).not.toHaveBeenCalled()
  })

  it('resolves when the target appears after a DOM mutation', async () => {
    const pending = waitForTourTarget({ targetId: 'booking-row', waitMs: 100 })
    const target = document.createElement('button')
    target.dataset.tourId = 'booking-row'
    document.body.appendChild(target)

    await expect(pending).resolves.toBe(target)
  })

  it('uses the declared fallback when the data target is absent', async () => {
    const fallback = document.createElement('div')
    fallback.dataset.tourId = 'bookings-empty'
    document.body.appendChild(fallback)

    const target = await waitForTourTarget({
      targetId: 'booking-row',
      fallbackTargetId: 'bookings-empty',
      waitMs: 50,
    })

    expect(target?.dataset.tourId).toBe('bookings-empty')
  })

  it('skips a hidden desktop target and resolves the visible tablet target', async () => {
    const desktopShell = document.createElement('div')
    desktopShell.style.display = 'none'
    const desktopTarget = document.createElement('div')
    desktopTarget.dataset.tourId = 'payments-history'
    desktopShell.appendChild(desktopTarget)
    document.body.appendChild(desktopShell)

    const tabletTarget = document.createElement('div')
    tabletTarget.dataset.tourId = 'payments-history'
    document.body.appendChild(tabletTarget)

    await expect(waitForTourTarget({ targetId: 'payments-history', waitMs: 50 }))
      .resolves.toBe(tabletTarget)
  })

  it('skips a zero-rect target and uses the visible fallback', async () => {
    const collapsedTarget = document.createElement('div')
    collapsedTarget.dataset.tourId = 'bookings-actions'
    Object.defineProperty(collapsedTarget, 'getBoundingClientRect', {
      value: () => new DOMRect(0, 0, 0, 0),
    })
    document.body.appendChild(collapsedTarget)

    const fallback = document.createElement('div')
    fallback.dataset.tourId = 'bookings-search'
    Object.defineProperty(fallback, 'getBoundingClientRect', {
      value: () => new DOMRect(20, 30, 100, 40),
    })
    document.body.appendChild(fallback)

    await expect(waitForTourTarget({
      targetId: 'bookings-actions',
      fallbackTargetId: 'bookings-search',
      waitMs: 50,
    })).resolves.toBe(fallback)
  })

  it('fails open to the fallback when a target cannot be measured', async () => {
    const unavailableTarget = document.createElement('div')
    unavailableTarget.dataset.tourId = 'bookings-actions'
    Object.defineProperty(unavailableTarget, 'getBoundingClientRect', {
      value: () => { throw new Error('layout unavailable') },
    })
    document.body.appendChild(unavailableTarget)

    const fallback = document.createElement('div')
    fallback.dataset.tourId = 'bookings-search'
    Object.defineProperty(fallback, 'getBoundingClientRect', {
      value: () => new DOMRect(20, 30, 100, 40),
    })
    document.body.appendChild(fallback)

    await expect(waitForTourTarget({
      targetId: 'bookings-actions',
      fallbackTargetId: 'bookings-search',
      waitMs: 50,
    })).resolves.toBe(fallback)
  })

  it('returns null after the bounded wait and disconnects the observer', async () => {
    vi.useFakeTimers()
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal('MutationObserver', vi.fn(function MutationObserverMock() {
      return { disconnect, observe }
    }))

    const pending = waitForTourTarget({ targetId: 'missing', waitMs: 50 })
    await vi.advanceTimersByTimeAsync(50)

    await expect(pending).resolves.toBeNull()
    expect(observe).toHaveBeenCalledWith(document.documentElement, { childList: true, subtree: true })
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('resolves null on abort and removes every owned resource', async () => {
    vi.useFakeTimers()
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal('MutationObserver', vi.fn(function MutationObserverMock() {
      return { disconnect, observe }
    }))
    const controller = new AbortController()
    const removeAbortListener = vi.spyOn(controller.signal, 'removeEventListener')
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    const pending = waitForTourTarget({
      targetId: 'booking-row',
      waitMs: 500,
      signal: controller.signal,
    })
    controller.abort()

    await expect(pending).resolves.toBeNull()
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(clearTimeoutSpy).toHaveBeenCalled()
    expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('fails open when a DOM observer cannot be installed', async () => {
    vi.stubGlobal('MutationObserver', vi.fn(function BrokenMutationObserver() {
      throw new Error('observer unavailable')
    }))

    await expect(waitForTourTarget({ targetId: 'booking-row', waitMs: 50 }))
      .resolves.toBeNull()
  })
})
