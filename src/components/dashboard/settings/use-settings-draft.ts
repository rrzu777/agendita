'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearSettingsDraft,
  readSettingsDraft,
  writeSettingsDraft,
  type FlatSettings,
} from '@/lib/business/settings-draft'

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function flatFingerprint(values: FlatSettings) {
  return Object.keys(values)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(values[key])}`)
    .join('|')
}

export function useSettingsDraft<T extends FlatSettings>({
  key,
  version,
  baseline,
  values,
  isDirty,
  reset,
}: {
  key: string
  version: number
  baseline: T
  values: T
  isDirty: boolean
  reset: (values: T, options?: { keepDefaultValues?: boolean }) => void
}) {
  const [recovery, setRecovery] = useState<'none' | 'restored' | 'conflict'>('none')
  const baselineFingerprint = useMemo(() => flatFingerprint(baseline), [baseline])
  const recoveredSignature = useRef<string | null>(null)
  const initialized = useRef(false)
  const wasDirty = useRef(false)

  const clearDraft = useCallback(() => {
    const storage = getSessionStorage()
    if (storage) clearSettingsDraft(storage, key)
  }, [key])

  useEffect(() => {
    const signature = `${key}:${version}:${baselineFingerprint}`
    if (recoveredSignature.current === signature) return
    recoveredSignature.current = signature

    const storage = getSessionStorage()
    if (!storage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser-only storage read is the external recovery source.
      setRecovery('none')
      initialized.current = true
      return
    }

    const nextRecovery = readSettingsDraft(storage, key, version, baseline)
    if (nextRecovery.kind === 'restored') reset(nextRecovery.values, { keepDefaultValues: true })
    setRecovery(nextRecovery.kind)
    initialized.current = true
  }, [baseline, baselineFingerprint, key, reset, version])

  useEffect(() => {
    if (!initialized.current) return

    const storage = getSessionStorage()
    if (!storage) return

    if (isDirty) {
      writeSettingsDraft(storage, key, version, baseline, values)
      wasDirty.current = true
      return
    }

    if (wasDirty.current) {
      clearSettingsDraft(storage, key)
      wasDirty.current = false
    }
  }, [baseline, isDirty, key, values, version])

  const discard = useCallback(() => {
    clearDraft()
    wasDirty.current = false
    reset(baseline)
  }, [baseline, clearDraft, reset])

  return { recovery, discard, clearDraft }
}
