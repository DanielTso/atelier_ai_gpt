'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  // Always initialize with defaultValue to match server render and avoid hydration mismatch
  const [storedValue, setStoredValue] = useState<T>(initialValue)
  const hasHydrated = useRef(false)

  // Hydrate from localStorage after mount (client-only)
  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key)
      if (item !== null) {
        setStoredValue(JSON.parse(item))
      }
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error)
    }
    hasHydrated.current = true
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
