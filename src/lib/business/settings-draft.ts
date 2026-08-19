export type FlatSettings = Record<string, unknown>

export async function settingsFingerprint(values: FlatSettings) {
  const canonical = Object.keys(values)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(values[key])}`)
    .join('|')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

type DraftEnvelope<T extends FlatSettings> = {
  version: number
  baseline: T
  values: T
}

export type DraftRecovery<T extends FlatSettings> =
  | { kind: 'none' }
  | { kind: 'restored'; values: T }
  | { kind: 'conflict' }

export type DraftCandidate<T extends FlatSettings> =
  | { kind: 'none' }
  | { kind: 'candidate'; baseline: T; values: T }

function isFlatSettings(value: unknown): value is FlatSettings {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameFlatValues(a: FlatSettings, b: FlatSettings): boolean {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  return keys.every((key) => Object.is(a[key], b[key]))
}

export function clearSettingsDraft(storage: Storage, key: string) {
  try {
    storage.removeItem(key)
  } catch {
    // El navegador puede bloquear sessionStorage en contextos restringidos.
  }
}

export function writeSettingsDraft<T extends FlatSettings>(
  storage: Storage,
  key: string,
  version: number,
  baseline: T,
  values: T,
) {
  try {
    const envelope: DraftEnvelope<T> = { version, baseline, values }
    storage.setItem(key, JSON.stringify(envelope))
  } catch {
    // Un draft local es una mejora de recuperación, nunca una causa de fallo del formulario.
  }
}

export function readSettingsDraftCandidate<T extends FlatSettings>(
  storage: Storage,
  key: string,
  version: number,
): DraftCandidate<T> {
  try {
    const raw = storage.getItem(key)
    if (!raw) return { kind: 'none' }

    const parsed: unknown = JSON.parse(raw)
    if (
      !isFlatSettings(parsed)
      || typeof parsed.version !== 'number'
      || !isFlatSettings(parsed.baseline)
      || !isFlatSettings(parsed.values)
      || parsed.version !== version
    ) {
      clearSettingsDraft(storage, key)
      return { kind: 'none' }
    }

    return {
      kind: 'candidate',
      baseline: parsed.baseline as T,
      values: parsed.values as T,
    }
  } catch {
    clearSettingsDraft(storage, key)
    return { kind: 'none' }
  }
}

export function readSettingsDraft<T extends FlatSettings>(
  storage: Storage,
  key: string,
  version: number,
  currentBaseline: T,
): DraftRecovery<T> {
  const candidate = readSettingsDraftCandidate<T>(storage, key, version)
  if (candidate.kind === 'none') return candidate
  if (!sameFlatValues(candidate.baseline, currentBaseline)) {
    clearSettingsDraft(storage, key)
    return { kind: 'conflict' }
  }
  return { kind: 'restored', values: candidate.values }
}
