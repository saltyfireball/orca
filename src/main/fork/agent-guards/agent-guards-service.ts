// Agent guards (FORK.md, SLRM-2385): the engine wired to this process. `startForkAgentGuards` is
// called once the runtime settles, by the desktop app and the headless server alike. It loads the
// saved pauses and caps, listens to the usage ledger's turn starts and ends, takes terminal
// agents' tool calls from the hook server (`forkAgentGuardsObserveHook`) and sweeps native chats
// on a backoff timer: every 15 s while a chat works or something is paused or capped, backing off
// to 2 min otherwise. With both guards off nothing is read and no agent is touched.
// Keep electron out of this file.
import type { AgentHookSource } from '../../../shared/agent-hook-listener/transport/agent-hook-relay'
import {
  readAgentGuardSettings,
  type AgentGuardEntry,
  type AgentGuardSettingsSource
} from '../../../shared/fork/agent-guards'
import type {
  ForkGuardsCapResult,
  ForkGuardsResumeResult
} from '../../../shared/fork/agent-guards-wire'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import type { IdleRecoverySettingsSource } from '../../../shared/fork/idle-recovery-settings'
import { sleeperChatSessionId } from '../../../shared/fork/sleepers-ps-sources'
import type { AgentToolCallOwner } from '../../agent-hooks/tool-events/agent-tool-call-reader'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { forkAgentQueueWorkerParent } from '../agent-queue/agent-queue-service'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import type { LimitResumeRuntime } from '../limit-resume/limit-resume-host'
import {
  forkUsageLedgerData,
  forkUsageLedgerSettings,
  onForkUsageLedgerTurn
} from '../usage-ledger/usage-ledger-service'
import { cleanUsagePrices, estimateChatCostUsd, usagePricer } from '../usage-ledger/usage-report'
import { liveAgentGuardActPorts } from './agent-guards-act'
import { AgentGuardEngine, type AgentGuardSpend } from './agent-guards-engine'
import { readAgentGuardHookCall } from './agent-guards-hook-call'
import { setForkAgentGuardHeld } from './agent-guards-holds'
import { notifyAgentGuardPaused, readAgentGuardRows } from './agent-guards-host'
import {
  agentGuardsPath,
  pruneAgentGuardRecords,
  readAgentGuardRecords,
  writeAgentGuardRecords
} from './agent-guards-state'

export const FORK_AGENT_GUARDS_SWEEP_MS = 15_000
export const FORK_AGENT_GUARDS_IDLE_SWEEP_MS = 2 * 60_000

export type AgentGuardsServiceRuntime = LimitResumeRuntime & {
  requireStore: () => {
    getSettings: () => unknown
    onSettingsChanged?: (listener: (updates: Partial<ForkGlobalSettings>) => void) => unknown
  }
}

type Listener = (entries: AgentGuardEntry[]) => void

let runtime: AgentGuardsServiceRuntime | null = null
let engine: AgentGuardEngine | null = null
let starting = false
let lastSent = '[]'
const listeners = new Set<Listener>()
const changeListeners = new Set<() => void>()

function settingsObject(): unknown {
  try {
    return runtime?.requireStore().getSettings() ?? null
  } catch {
    return null
  }
}

function guardSettings() {
  return readAgentGuardSettings(settingsObject() as AgentGuardSettingsSource)
}

function anyGuardOn(): boolean {
  const settings = guardSettings()
  return settings.loop || settings.capUsd > 0 || (engine?.hasOwnCaps() ?? false)
}

/** Estimated spend from the usage ledger, priced as the usage report prices it. */
function spendOf(sessionId: string): AgentGuardSpend {
  const chat = forkUsageLedgerData()?.chats[sessionId]
  const isWorker = Boolean(chat?.parentSessionId ?? forkAgentQueueWorkerParent(sessionId))
  if (!chat) {
    return { totalUsd: null, isWorker }
  }
  const pricer = usagePricer(cleanUsagePrices(forkUsageLedgerSettings()?.forkUsagePrices))
  return { totalUsd: estimateChatCostUsd(chat, pricer), isWorker }
}

/** Every guarded agent on this host: paused, warned, then capped. */
export function forkAgentGuardEntries(): AgentGuardEntry[] {
  return engine?.entries() ?? []
}

export function onForkAgentGuardsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** For the Decision inbox: told whenever a pause starts or ends. */
export function onForkAgentGuardPausesChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

let lastHeld = '[]'

function publish(): void {
  const held = engine?.heldIds() ?? []
  setForkAgentGuardHeld(held)
  const heldText = JSON.stringify(held.sort())
  if (heldText !== lastHeld) {
    lastHeld = heldText
    for (const listener of changeListeners) {
      try {
        listener()
      } catch {
        // A listener's failure is its own.
      }
    }
  }
  const entries = forkAgentGuardEntries()
  const next = JSON.stringify(entries)
  if (next === lastSent) {
    return
  }
  lastSent = next
  for (const listener of listeners) {
    listener(entries)
  }
}

let terminalTitles = new Map<string, string>()

async function pass(): Promise<boolean> {
  const live = runtime
  if (!live || !engine) {
    return false
  }
  const paused = engine.heldIds().length > 0
  if (!anyGuardOn() && !paused) {
    // Off: no agent row or chat is read; only the settings are, as the timer backs off.
    publish()
    return false
  }
  const rows = await readAgentGuardRows(live)
  terminalTitles = rows.terminals
  let busy = paused
  for (const row of rows.chats) {
    busy ||= row.working
    await engine.sweepChat(row)
  }
  engine.forgetMissing(rows.live)
  publish()
  return busy || forkAgentGuardEntries().length > 0
}

/** Idempotent. Runtime tests reach the start-up hook too; the sweep stays off there. */
export function startForkAgentGuards(next: AgentGuardsServiceRuntime): void {
  runtime = next
  if (engine || starting || process.env.VITEST) {
    return
  }
  starting = true
  void startEngine()
    .catch((error: unknown) => {
      console.warn('[fork-agent-guards] could not start', error)
    })
    .finally(() => {
      starting = false
    })
}

async function startEngine(): Promise<void> {
  const { getProfileUserDataPath } = await import('../../orca-profiles/profile-storage-paths')
  const path = agentGuardsPath(getProfileUserDataPath())
  const records = await readAgentGuardRecords(path)
  pruneAgentGuardRecords(records, Date.now())
  let saving: Promise<void> = Promise.resolve()
  engine = new AgentGuardEngine({
    ports: liveAgentGuardActPorts(() => runtime),
    records,
    save: () => {
      saving = saving
        .then(() => writeAgentGuardRecords(path, records))
        .catch((error: unknown) => console.warn('[fork-agent-guards] could not save', error))
      return saving
    },
    now: Date.now,
    settings: guardSettings,
    spend: spendOf,
    notify: (entry) =>
      notifyAgentGuardPaused(entry, settingsObject() as IdleRecoverySettingsSource),
    changed: publish,
    startedAt: Date.now()
  })
  publish()
  onForkUsageLedgerTurn((sessionId, phase) => {
    if (engine && (anyGuardOn() || engine.isPaused(sessionId))) {
      void engine.onTurn(sessionId, phase).then(publish)
    }
  })
  let stop: (() => void) | null = null
  const arm = (): void => {
    stop?.()
    stop = startForkBackoffTimer({
      run: pass,
      baseMs: FORK_AGENT_GUARDS_SWEEP_MS,
      maxMs: FORK_AGENT_GUARDS_IDLE_SWEEP_MS,
      onError: (error) => console.warn('[fork-agent-guards] sweep failed', error)
    })
  }
  arm()
  runtime?.requireStore().onSettingsChanged?.((updates) => {
    // A changed setting is seen at once instead of after the backed-off wait.
    if (Object.keys(updates).some((key) => key.startsWith('forkAgentGuard'))) {
      arm()
    }
  })
}

/**
 * Hook (the agent hook server's answer to every accepted post): a terminal agent finished a tool
 * call. Cheap and synchronous: with the loop guard off it reads only the setting. Never throws.
 */
export function forkAgentGuardsObserveHook(
  source: AgentHookSource,
  body: unknown,
  owner: AgentToolCallOwner | null
): void {
  try {
    if (!engine || !owner || !guardSettings().loop || sleeperChatSessionId(owner.paneKey)) {
      return
    }
    const read = readAgentGuardHookCall(source, body, owner, Date.now())
    if (!read) {
      return
    }
    void engine
      .observe(
        read.paneKey,
        {
          kind: 'terminal',
          agent: read.agent,
          title: terminalTitles.get(read.paneKey) ?? read.paneKey,
          worktreeId: read.worktreeId
        },
        read.call
      )
      .then(publish)
  } catch (error) {
    console.warn('[fork-agent-guards] could not read a hook post', error)
  }
}

function match(query: string): AgentGuardEntry {
  const entries = forkAgentGuardEntries()
  const exact = entries.filter((entry) => entry.id === query)
  const matches =
    exact.length > 0
      ? exact
      : query.length >= 4
        ? entries.filter((entry) => entry.id.startsWith(query))
        : []
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `No guarded agent matches "${query}". Run "orca guards list" for ids.`
        : `"${query}" matches more than one; use more of its id.`
    )
  }
  return matches[0]
}

export function forkAgentGuardIsPaused(id: string): boolean {
  return engine?.isPaused(id) ?? false
}

/** Lift a pause of this exact id; false when it was not paused. */
export async function forkAgentGuardResumeIfPaused(id: string): Promise<boolean> {
  if (!engine?.isPaused(id)) {
    return false
  }
  await engine.resume(id)
  publish()
  return true
}

/** `orca guards resume <id>`: lift a pause. */
export async function forkAgentGuardResume(query: string): Promise<ForkGuardsResumeResult> {
  if (!engine) {
    throw new Error('Agent guards are not running on this host yet; try again in a moment.')
  }
  const id = engine.isPaused(query) ? query : match(query).id
  const outcome = await engine.resume(id)
  publish()
  return { id, outcome }
}

/** `orca guards cap <session id> <usd>`: a chat's own cap; 0 goes back to the default. */
export async function forkAgentGuardSetCap(
  query: string,
  usd: number
): Promise<ForkGuardsCapResult> {
  if (!engine) {
    throw new Error('Agent guards are not running on this host yet; try again in a moment.')
  }
  const listed = forkAgentGuardEntries().filter(
    (entry) =>
      entry.kind === 'chat' &&
      (entry.id === query || (query.length >= 4 && entry.id.startsWith(query)))
  )
  const sessionId = listed.length === 1 ? listed[0].id : query
  if (!getStructuredAgentSessionHost()?.deps.store.getRecord(sessionId)) {
    throw new Error(`No chat "${query.slice(0, 80)}" on this host. Name a chat by its session id.`)
  }
  const result = await engine.setCap(sessionId, usd)
  publish()
  return { id: sessionId, ...result }
}
