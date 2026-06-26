'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

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

  // Hydrate from localStorage after mount (client-only)
  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key)
      if (item !== null) {
        const parsed = JSON.parse(item)
        if (!validate || validate(parsed)) setStoredValue(parsed as T)
      }
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error)
    }
    hasHydrated.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Keep tabs in sync: adopt another tab's write for the same key (validated).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || e.newValue === null) return
      try {
        const parsed = JSON.parse(e.newValue)
        if (!validate || validate(parsed)) setStoredValue(parsed as T)
      } catch {
        // ignore malformed cross-tab payloads
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Sync state to localStorage whenever it changes (skip initial write)
  useEffect(() => {
    if (!hasHydrated.current) return
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue))
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
