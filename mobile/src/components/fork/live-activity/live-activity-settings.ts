// Blackfish (SLRM-2387): the phone's own Live Activity and widget settings. They live on this
// phone, not on a server, since only this phone draws them.
import AsyncStorage from '@react-native-async-storage/async-storage'

export const LIVE_ACTIVITY_KEEP_FINISHED_CHOICES = [5, 15, 30, 60] as const
export type LiveActivityKeepFinishedMinutes = (typeof LIVE_ACTIVITY_KEEP_FINISHED_CHOICES)[number]

export type LiveActivitySettings = Readonly<{
  /** Running agents as a Live Activity on the Lock Screen and in the Dynamic Island. */
  liveActivity: boolean
  /** Running agents in the home and Lock Screen widget. */
  widget: boolean
  /** How long a finished agent stays listed. */
  keepFinishedMinutes: LiveActivityKeepFinishedMinutes
}>

export const DEFAULT_LIVE_ACTIVITY_SETTINGS: LiveActivitySettings = {
  liveActivity: true,
  widget: true,
  keepFinishedMinutes: 15
}

const KEY = 'blackfish:agentLiveActivitySettings'
const listeners = new Set<(settings: LiveActivitySettings) => void>()

export function parseLiveActivitySettings(raw: string | null): LiveActivitySettings {
  if (!raw) {
    return DEFAULT_LIVE_ACTIVITY_SETTINGS
  }
  try {
    const stored: unknown = JSON.parse(raw)
    if (!stored || typeof stored !== 'object') {
      return DEFAULT_LIVE_ACTIVITY_SETTINGS
    }
    const record = stored as Record<string, unknown>
    const keep = LIVE_ACTIVITY_KEEP_FINISHED_CHOICES.find(
      (choice) => choice === record.keepFinishedMinutes
    )
    return {
      liveActivity:
        typeof record.liveActivity === 'boolean'
          ? record.liveActivity
          : DEFAULT_LIVE_ACTIVITY_SETTINGS.liveActivity,
      widget:
        typeof record.widget === 'boolean' ? record.widget : DEFAULT_LIVE_ACTIVITY_SETTINGS.widget,
      keepFinishedMinutes: keep ?? DEFAULT_LIVE_ACTIVITY_SETTINGS.keepFinishedMinutes
    }
  } catch {
    return DEFAULT_LIVE_ACTIVITY_SETTINGS
  }
}

export async function loadLiveActivitySettings(): Promise<LiveActivitySettings> {
  try {
    return parseLiveActivitySettings(await AsyncStorage.getItem(KEY))
  } catch {
    return DEFAULT_LIVE_ACTIVITY_SETTINGS
  }
}

export async function saveLiveActivitySettings(settings: LiveActivitySettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings))
  for (const listener of listeners) {
    listener(settings)
  }
}

/** Calls `listener` after every save, so a change takes effect without a relaunch. */
export function subscribeLiveActivitySettings(
  listener: (settings: LiveActivitySettings) => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
