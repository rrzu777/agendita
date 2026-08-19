export type FlatSettings = Record<string, unknown>

type DraftEnvelope<T extends FlatSettings> = {
  version: number
  baseline: T
  values: T
}

export type DraftRecovery<T extends FlatSettings> =
  | { kind: 'none' }
  | { kind: 'restored'; values: T }
  | { kind: 'conflict' }

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

export function readSettingsDraft<T extends FlatSettings>(
  storage: Storage,
  key: string,
  version: number,
  currentBaseline: T,
): DraftRecovery<T> {
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

    if (!sameFlatValues(parsed.baseline, currentBaseline)) {
      clearSettingsDraft(storage, key)
      return { kind: 'conflict' }
    }

    return { kind: 'restored', values: parsed.values as T }
  } catch {
    clearSettingsDraft(storage, key)
    return { kind: 'none' }
  }
}
