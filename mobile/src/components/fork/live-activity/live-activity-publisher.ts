// Blackfish (SLRM-2387): keeps the remembered rows and hands them to iOS only when they change.
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { BlackfishLiveActivityNative } from '../../../../modules/fork-live-activity/src/index'
import {
  EMPTY_LIVE_AGENT_MEMORY,
  liveAgentSnapshot,
  parseLiveAgentMemory,
  sameLiveAgentContent,
  type LiveAgentMemory,
  type LiveAgentSnapshot
} from './live-activity-model'
import type { LiveActivitySettings } from './live-activity-settings'

const MEMORY_KEY = 'blackfish:agentLiveActivityMemory'
/** The Lock Screen fits about four rows; more would also crowd ActivityKit's 4 KB state. */
export const LIVE_ACTIVITY_ROWS = 4
/** The large widget lists up to this many. */
export const WIDGET_ROWS = 8
/** Without an update for this long iOS marks the Live Activity out of date. */
export const LIVE_ACTIVITY_STALE_AFTER_SECONDS = 30 * 60

type Sent = LiveAgentSnapshot | 'off' | null

export type LiveAgentPublisher = Readonly<{
  load(): Promise<LiveAgentMemory>
  publish(memory: LiveAgentMemory, settings: LiveActivitySettings, now: number): Promise<void>
}>

/** One publisher per app run: what iOS was last given, so an unchanged list sends nothing. */
export function createLiveAgentPublisher(native: BlackfishLiveActivityNative): LiveAgentPublisher {
  let saved: string | null = null
  let activity: Sent = null
  let widget: Sent = null

  const save = async (memory: LiveAgentMemory) => {
    const raw = JSON.stringify(memory)
    if (raw !== saved) {
      saved = raw
      await AsyncStorage.setItem(MEMORY_KEY, raw).catch(() => undefined)
    }
  }

  const syncActivity = async (memory: LiveAgentMemory, on: boolean, now: number) => {
    if (!on) {
      if (activity !== 'off') {
        activity = 'off'
        await native.endActivity()
      }
      return
    }
    const next = liveAgentSnapshot(memory, LIVE_ACTIVITY_ROWS, now)
    if (activity !== 'off' && sameLiveAgentContent(activity, next)) {
      return
    }
    const result = await native.syncActivity(
      JSON.stringify(next),
      LIVE_ACTIVITY_STALE_AFTER_SECONDS
    )
    // A start refused in the background, or one the user dismissed, is tried again next change.
    activity = result === 'started' || result === 'updated' || result === 'ended' ? next : null
  }

  const syncWidget = (memory: LiveAgentMemory, on: boolean, now: number) => {
    if (!on) {
      if (widget !== 'off') {
        widget = 'off'
        native.writeWidget(null)
      }
      return
    }
    const next = liveAgentSnapshot(memory, WIDGET_ROWS, now)
    if (widget !== 'off' && sameLiveAgentContent(widget, next)) {
      return
    }
    widget = next
    native.writeWidget(JSON.stringify(next))
  }

  return {
    async load() {
      try {
        const raw = await AsyncStorage.getItem(MEMORY_KEY)
        saved = raw
        return parseLiveAgentMemory(raw)
      } catch {
        return EMPTY_LIVE_AGENT_MEMORY
      }
    },
    async publish(memory, settings, now) {
      await save(memory)
      try {
        await syncActivity(memory, settings.liveActivity, now)
        syncWidget(memory, settings.widget, now)
      } catch {
        // A native failure leaves the Lock Screen as it was; the next change tries again.
        activity = null
        widget = null
      }
    }
  }
}
