// Quick task (SLRM-2428, FORK.md): the phone's own switch for the Feed's Quick task button. It
// lives on this phone, since only this phone draws the button.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useState } from 'react'

export type QuickTaskSettings = Readonly<{
  /** The Quick task button in the Feed tab's header. */
  showEntry: boolean
}>

export const DEFAULT_QUICK_TASK_SETTINGS: QuickTaskSettings = { showEntry: true }

const KEY = 'blackfish:quickTaskSettings'
const listeners = new Set<(settings: QuickTaskSettings) => void>()

export function parseQuickTaskSettings(raw: string | null): QuickTaskSettings {
  if (!raw) {
    return DEFAULT_QUICK_TASK_SETTINGS
  }
  try {
    const stored: unknown = JSON.parse(raw)
    if (!stored || typeof stored !== 'object') {
      return DEFAULT_QUICK_TASK_SETTINGS
    }
    const showEntry = (stored as Record<string, unknown>).showEntry
    return {
      showEntry: typeof showEntry === 'boolean' ? showEntry : DEFAULT_QUICK_TASK_SETTINGS.showEntry
    }
  } catch {
    return DEFAULT_QUICK_TASK_SETTINGS
  }
}

export async function loadQuickTaskSettings(): Promise<QuickTaskSettings> {
  try {
    return parseQuickTaskSettings(await AsyncStorage.getItem(KEY))
  } catch {
    return DEFAULT_QUICK_TASK_SETTINGS
  }
}

export async function saveQuickTaskSettings(settings: QuickTaskSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings))
  for (const listener of listeners) {
    listener(settings)
  }
}

/** Calls `listener` after every save, so the Feed follows a change without a relaunch. */
export function subscribeQuickTaskSettings(
  listener: (settings: QuickTaskSettings) => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The saved settings, starting from the defaults until storage answers. */
export function useQuickTaskSettings(): QuickTaskSettings {
  const [settings, setSettings] = useState<QuickTaskSettings>(DEFAULT_QUICK_TASK_SETTINGS)
  useEffect(() => {
    let alive = true
    void loadQuickTaskSettings().then((loaded) => {
      if (alive) {
        setSettings(loaded)
      }
    })
    const unsubscribe = subscribeQuickTaskSettings(setSettings)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  return settings
}
