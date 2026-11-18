import { requireOptionalNativeModule } from 'expo-modules-core'

/** What `syncActivity` did; anything but started, updated or ended is retried on the next sync. */
export type BlackfishActivitySyncResult =
  | 'started'
  | 'updated'
  | 'ended'
  | 'disabled'
  | 'dismissed'
  | 'invalid'
  | 'failed'

export type BlackfishLiveActivityNative = {
  /** True when this iPhone allows Live Activities for the app (Settings > the app > Live Activities). */
  areActivitiesEnabled(): boolean
  /** Starts, updates or ends the one agents Live Activity from a snapshot's JSON. */
  syncActivity(json: string, staleAfterSeconds: number): Promise<BlackfishActivitySyncResult>
  /** Ends the agents Live Activity at once. */
  endActivity(): Promise<void>
  /** Hands the widget a snapshot's JSON, or null to clear it, and reloads its timelines. */
  writeWidget(json: string | null): void
}

/** Null on Android, the web and in a binary built without the module (SLRM-2387). */
export const BlackfishLiveActivity =
  requireOptionalNativeModule<BlackfishLiveActivityNative>('BlackfishLiveActivity')
