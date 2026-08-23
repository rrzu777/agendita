type WaitForTourTargetOptions = {
  targetId: string
  fallbackTargetId?: string
  waitMs: number
  signal?: AbortSignal
}

function isVisibleTourTarget(target: HTMLElement): boolean {
  try {
    if (!target.isConnected) return false

    for (let current: HTMLElement | null = target; current; current = current.parentElement) {
      const style = window.getComputedStyle(current)
      if (style.display === 'none' || style.visibility === 'hidden') return false
    }

    const rect = target.getBoundingClientRect()
    return Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0
  } catch {
    return false
  }
}

function findTourTarget(targetId: string, fallbackTargetId?: string): HTMLElement | null {
  const targets = document.querySelectorAll<HTMLElement>('[data-tour-id]')
  const primary = Array.from(targets).find((target) => (
    target.dataset.tourId === targetId && isVisibleTourTarget(target)
  ))
  if (primary) return primary
  if (!fallbackTargetId) return null
  return Array.from(targets).find((target) => (
    target.dataset.tourId === fallbackTargetId && isVisibleTourTarget(target)
  )) ?? null
}

export async function waitForTourTarget({
  targetId,
  fallbackTargetId,
  waitMs,
  signal,
}: WaitForTourTargetOptions): Promise<HTMLElement | null> {
  if (signal?.aborted) return null

  const immediate = findTourTarget(targetId, fallbackTargetId)
  if (immediate || waitMs <= 0) return immediate

  return new Promise((resolve) => {
    let settled = false
    let observer: MutationObserver | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    const finish = (target: HTMLElement | null) => {
      if (settled) return
      settled = true
      observer?.disconnect()
      if (timeout !== null) clearTimeout(timeout)
      signal?.removeEventListener('abort', handleAbort)
      resolve(target)
    }
    const handleAbort = () => finish(null)

    try {
      observer = new MutationObserver(() => {
        const target = findTourTarget(targetId, fallbackTargetId)
        if (target) finish(target)
      })
      signal?.addEventListener('abort', handleAbort, { once: true })
      timeout = setTimeout(() => finish(null), waitMs)
      observer.observe(document.documentElement, { childList: true, subtree: true })
    } catch {
      finish(null)
    }
  })
}
