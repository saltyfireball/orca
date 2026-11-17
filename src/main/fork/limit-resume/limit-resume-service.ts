// Limit resume (FORK.md, SLRM-2309): the service, wired to this process. `startForkLimitResume`
// is called once the runtime settles, by the desktop app and by the headless server alike. It
// hands the native-chat hooks their settings and runs the terminal sweep on a backoff timer:
// every 30 s while some agent is parked, backing off to 2 min while none is or the feature is off.
// Keep electron out of this file.
import {
  readLimitResumeSettings,
  type LimitResumeEntry,
  type LimitResumeSettingsSource
} from '../../../shared/fork/limit-resume'
import type { ForkLimitsActionResult } from '../../../shared/fork/limit-resume-wire'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import { idleRecoveryChatPort } from '../idle-recovery/idle-recovery-ports'
import {
  limitResumeMemosPath,
  readLimitResumeMemos,
  writeLimitResumeMemos
} from './limit-resume-memos'
import {
  cancelLimitResumeNative,
  limitResumeNativeEntries,
  resumeLimitResumeNativeNow,
  setForkLimitResumeSettingsReader
} from './limit-resume-native'
import {
  liveLimitResumePorts,
  readLimitResumeRows,
  type LimitResumeRows,
  type LimitResumeRuntime
} from './limit-resume-host'
import { LimitResumeSweep } from './limit-resume-sweep'

export const FORK_LIMIT_RESUME_SWEEP_MS = 30_000
export const FORK_LIMIT_RESUME_IDLE_SWEEP_MS = 2 * 60_000

export type LimitResumeServiceRuntime = LimitResumeRuntime & {
  requireStore: () => {
    getSettings: () => unknown
    onSettingsChanged?: (listener: (updates: Partial<ForkGlobalSettings>) => void) => unknown
  }
}

type Listener = (entries: LimitResumeEntry[]) => void

let runtime: LimitResumeServiceRuntime | null = null
let sweep: LimitResumeSweep | null = null
let lastRows: LimitResumeRows = { terminals: [], chats: new Map() }
let lastSent = '[]'
const listeners = new Set<Listener>()

function settingsSource(): LimitResumeSettingsSource {
  try {
    return (runtime?.requireStore().getSettings() ?? null) as LimitResumeSettingsSource
  } catch {
    return null
  }
}

/** Every parked chat and terminal agent on this host, soonest first. */
export function forkLimitResumeEntries(): LimitResumeEntry[] {
  const settings = readLimitResumeSettings(settingsSource())
  const terminals = settings.enabled ? (sweep?.entries(settings) ?? []) : []
  const chats = limitResumeNativeEntries(getStructuredAgentSessionHost(), lastRows.chats)
  return [...terminals, ...chats].sort((a, b) => a.resumeAt - b.resumeAt)
}

export function onForkLimitResumeChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(): void {
  const entries = forkLimitResumeEntries()
  const next = JSON.stringify(entries)
  if (next === lastSent) {
    return
  }
  lastSent = next
  for (const listener of listeners) {
    listener(entries)
  }
}

async function pass(): Promise<boolean> {
  const live = runtime
  const settings = readLimitResumeSettings(settingsSource())
  if (!live || !sweep) {
    return false
  }
  if (!settings.enabled) {
    // Off: no agent row or screen is read; only the setting is, as the timer backs off.
    sweep.clear()
    lastRows = { terminals: [], chats: new Map() }
    publish()
    return false
  }
  lastRows = await readLimitResumeRows(live)
  let busy = false
  if (settings.terminals) {
    busy = await sweep.pass(settings)
  } else {
    sweep.clear()
  }
  publish()
  // Native chats the stock continue parked keep the label fresh at the base cadence.
  return busy || forkLimitResumeEntries().length > 0
}

/** Idempotent. Runtime tests reach the start-up hook too; the sweep stays off there. */
export function startForkLimitResume(next: LimitResumeServiceRuntime): void {
  runtime = next
  setForkLimitResumeSettingsReader(settingsSource)
  if (sweep || process.env.VITEST) {
    return
  }
  void startSweep().catch((error: unknown) => {
    console.warn('[fork-limit-resume] could not start', error)
  })
}

async function startSweep(): Promise<void> {
  const { getProfileUserDataPath } = await import('../../orca-profiles/profile-storage-paths')
  const path = limitResumeMemosPath(getProfileUserDataPath())
  const memos = await readLimitResumeMemos(path)
  sweep = new LimitResumeSweep({
    ports: liveLimitResumePorts(
      () => runtime,
      async () => lastRows.terminals
    ),
    memos,
    saveMemos: () => writeLimitResumeMemos(path, memos),
    now: Date.now
  })
  let stop: (() => void) | null = null
  const arm = (): void => {
    stop?.()
    stop = startForkBackoffTimer({
      run: pass,
      baseMs: FORK_LIMIT_RESUME_SWEEP_MS,
      maxMs: FORK_LIMIT_RESUME_IDLE_SWEEP_MS,
      onError: (error) => console.warn('[fork-limit-resume] sweep failed', error)
    })
  }
  arm()
  runtime?.requireStore().onSettingsChanged?.((updates) => {
    // A changed setting is seen at once instead of after the backed-off wait.
    if (Object.keys(updates).some((key) => key.startsWith('forkLimitResume'))) {
      arm()
    }
  })
}

function matchEntry(query: string): LimitResumeEntry {
  const entries = forkLimitResumeEntries()
  const exact = entries.filter((entry) => entry.id === query || entry.sessionId === query)
  const matches =
    exact.length > 0
      ? exact
      : query.length >= 4
        ? entries.filter((entry) => entry.id.startsWith(query))
        : []
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Nothing parked matches "${query}". Run "orca limits list" for ids.`
        : `"${query}" matches more than one; use more of its id.`
    )
  }
  return matches[0]
}

/** `orca limits resume-now <id>`: tell it to go on now; a draft or a busy agent refuses it. */
export async function forkLimitResumeNow(query: string): Promise<ForkLimitsActionResult> {
  const entry = matchEntry(query)
  const settings = readLimitResumeSettings(settingsSource())
  const outcome =
    entry.kind === 'chat' && entry.sessionId
      ? await resumeLimitResumeNativeNow(idleRecoveryChatPort(), entry.sessionId)
      : ((await sweep?.resumeNow(entry.paneKey, settings)) ?? 'refused')
  publish()
  return { entry, outcome }
}

/** `orca limits cancel <id>`: leave this stop to the user. */
export async function forkLimitResumeCancel(query: string): Promise<ForkLimitsActionResult> {
  const entry = matchEntry(query)
  const done =
    entry.kind === 'chat' && entry.sessionId
      ? await cancelLimitResumeNative(getStructuredAgentSessionHost(), entry.sessionId)
      : ((await sweep?.cancel(entry.paneKey)) ?? false)
  publish()
  return {
    entry: { ...entry, ...(done ? { state: 'cancelled' as const } : {}) },
    outcome: done ? 'cancelled' : 'refused'
  }
}
