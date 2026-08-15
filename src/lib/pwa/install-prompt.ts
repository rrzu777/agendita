export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let currentPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function emitChange() {
  for (const listener of listeners) listener()
}

export function captureInstallPrompt(event: Event) {
  event.preventDefault()
  currentPrompt = event as BeforeInstallPromptEvent
  emitChange()
}

export function clearInstallPrompt() {
  if (!currentPrompt) return
  currentPrompt = null
  emitChange()
}

export function getInstallPrompt() {
  return currentPrompt
}

export function subscribeToInstallPrompt(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
