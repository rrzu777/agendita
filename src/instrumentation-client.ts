import { captureInstallPrompt, clearInstallPrompt } from '@/lib/pwa/install-prompt'

try {
  window.addEventListener('beforeinstallprompt', captureInstallPrompt)
  window.addEventListener('appinstalled', clearInstallPrompt)
} catch {
  // Client instrumentation must never prevent the application from loading.
}
