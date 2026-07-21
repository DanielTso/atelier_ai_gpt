'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// In-tab sync channel: the browser's `storage` event only fires in OTHER tabs, so
// instances sharing a key in the same tab broadcast their writes with this event
// (e.g. usePersonas' custom-personas in Settings AND the composer's PersonaSelector).
const LOCAL_SYNC_EVENT = 'local-storage'

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  // Optional shape guard. A stale/hand-edited entry (old format, wrong type) that
  // fails it is ignored in favour of initialValue — otherwise typed consumers can
  // crash on a malformed object (e.g. spreading a non-object).
  validate?: (value: unknown) => boolean,
): [T, (value: T | ((prev: T) => T)) => void] {
  // Always initialize with defaultValue to match server render and avoid hydration mismatch
  const [storedValue, setStoredValue] = useState<T>(initialValue)
  const hasHydrated = useRef(false)
  // The JSON string this instance last read/wrote for the key. Breaks echo loops:
  // adopting a broadcast value would otherwise re-trigger the write effect, whose
  // re-broadcast would bounce between instances forever on non-primitive values.
  const rawRef = useRef<string | null>(null)

  // Hydrate from localStorage after mount (client-only). Re-runs on a KEY change
  // (dynamic keys, e.g. project-doc-scope-<id>).
  useEffect(() => {
    let adopted = false
    try {
      const item = window.localStorage.getItem(key)
      if (item !== null) {
        const parsed = JSON.parse(item)
        if (!validate || validate(parsed)) {
          rawRef.current = item
          setStoredValue(parsed as T)
          adopted = true
        }
      }
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error)
    }
    // No (valid) entry under this key: prime rawRef with the serialized initial
    // so the write effect doesn't persist the untouched initial value as a
    // phantom entry. On a KEY CHANGE (already hydrated) also reset the state —
    // otherwise the previous key's value leaks into the new key (dynamic keys,
    // e.g. project-doc-scope-<id>); on first mount the state already holds it.
    if (!adopted) {
      try {
        rawRef.current = JSON.stringify(initialValue)
      } catch {
        rawRef.current = null
      }
      if (hasHydrated.current) setStoredValue(initialValue)
    }
    hasHydrated.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Keep instances in sync: adopt a write for the same key from another tab
  // (`storage`) or another hook instance in THIS tab (LOCAL_SYNC_EVENT).
  useEffect(() => {
    const adopt = (raw: string | null) => {
      if (raw === null || raw === rawRef.current) return
      try {
        const parsed = JSON.parse(raw)
        if (!validate || validate(parsed)) {
          rawRef.current = raw
          setStoredValue(parsed as T)
        }
      } catch {
        // ignore malformed payloads
      }
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) adopt(e.newValue)
    }
    const onLocalSync = (e: Event) => {
      if ((e as CustomEvent<{ key?: string }>).detail?.key !== key) return
      adopt(window.localStorage.getItem(key))
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(LOCAL_SYNC_EVENT, onLocalSync)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(LOCAL_SYNC_EVENT, onLocalSync)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Sync state to localStorage whenever it changes (skip initial write). A value we
  // just adopted from a broadcast serializes to rawRef.current — skip the re-write
  // and re-broadcast (loop terminator). A KEY change is owned by the hydrate effect
  // above (re-read or reset) — this effect fires for it with the OLD key's state
  // still in place, which must never be written under the new key.
  const writeKeyRef = useRef(key)
  useEffect(() => {
    if (!hasHydrated.current) return
    if (writeKeyRef.current !== key) {
      writeKeyRef.current = key
      return
    }
    try {
      const raw = JSON.stringify(storedValue)
      if (raw === rawRef.current) return
      rawRef.current = raw
      window.localStorage.setItem(key, raw)
      window.dispatchEvent(new CustomEvent(LOCAL_SYNC_EVENT, { detail: { key } }))
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error)
    }
  }, [key, storedValue])

  // Wrapper to handle both direct values and updater functions
  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setStoredValue(prev => {
      const newValue = value instanceof Function ? value(prev) : value
      return newValue
    })
  }, [])

  return [storedValue, setValue]
}
