type WaitForTourTargetOptions = {
  targetId: string
  fallbackTargetId?: string
  waitMs: number
  signal?: AbortSignal
}

function findTourTarget(targetId: string, fallbackTargetId?: string): HTMLElement | null {
  const targets = document.querySelectorAll<HTMLElement>('[data-tour-id]')
  const primary = Array.from(targets).find((target) => target.dataset.tourId === targetId)
  if (primary) return primary
  if (!fallbackTargetId) return null
  return Array.from(targets).find((target) => target.dataset.tourId === fallbackTargetId) ?? null
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
