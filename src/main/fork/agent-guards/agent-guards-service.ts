// Agent guards (FORK.md, SLRM-2385): the engine wired to this process. `startForkAgentGuards` is
// called once the runtime settles, by the desktop app and the headless server alike. It loads the
// saved pauses and caps, listens to the usage ledger's turn starts and ends, takes terminal
// agents' tool calls from the hook server (`forkAgentGuardsObserveHook`) and sweeps native chats
// on a backoff timer: every 15 s while a chat works or something is paused or capped, backing off
// to 2 min otherwise. With both guards off nothing is read and no agent is touched.
// Keep electron out of this file.
import type { AgentHookSource } from '../../../shared/agent-hook-listener/transport/agent-hook-relay'
import {
  agentGuardAnyCapSet,
  readAgentGuardSettings,
  type AgentGuardEntry,
  type AgentGuardSettingsSource
} from '../../../shared/fork/agent-guards'
import type {
  ForkGuardsCapResult,
  ForkGuardsListResult,
  ForkGuardsResumeResult
} from '../../../shared/fork/agent-guards-wire'
import type { Automation } from '../../../shared/automations/automation-definition'
import type { AutomationRun } from '../../../shared/automations/history/automation-run'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import type { IdleRecoverySettingsSource } from '../../../shared/fork/idle-recovery-settings'
import { sleeperChatSessionId } from '../../../shared/fork/sleepers-ps-sources'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { AgentToolCallOwner } from '../../agent-hooks/tool-events/agent-tool-call-reader'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import { forkGoalBudgetWatched } from '../goal-loop/goal-budget-watch'
import type { LimitResumeRuntime } from '../limit-resume/limit-resume-host'
import { onForkUsageLedgerTurn } from '../usage-ledger/usage-ledger-service'
import { liveAgentGuardActPorts } from './agent-guards-act'
import { AgentGuardEngine } from './agent-guards-engine'
import {
  agentGuardAutomationLimits,
  agentGuardList,
  agentGuardRunOf,
  agentGuardSpendOf,
  configureAgentGuardScopes,
  loadAgentGuardScopeState,
  noteAgentGuardAutomationLaunch,
  setAgentGuardLiveIds
} from './agent-guards-scopes'
import { automationCapsPath } from './automation-caps-state'
import { installAgentGuardRunLinks } from './agent-guards-run-links'
import { matchAgentGuardEntry } from './agent-guards-match'
import { AgentGuardTerminals } from './agent-guards-terminals'
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
  /** BAD-766: the orchestration database, for who started a worker. */
  getExistingOrchestrationDb?: () => OrchestrationDb | null
  requireStore: () => {
    getSettings: () => unknown
    onSettingsChanged?: (listener: (updates: Partial<ForkGlobalSettings>) => void) => unknown
    /** BAD-679: the automation caps read the runs and names of automations. */
    listAutomationRuns?: (automationId: string) => AutomationRun[]
    listAutomations?: () => Automation[]
  }
}

type Listener = (entries: AgentGuardEntry[]) => void

let runtime: AgentGuardsServiceRuntime | null = null
let engine: AgentGuardEngine | null = null
let starting = false
let lastSent = '[]'
const terminals = new AgentGuardTerminals()
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

/**
 * True when some spend cap may cover an agent, or a goal has a budget (BAD-766), so a terminal
 * agent's transcript is worth reading.
 */
function anySpendCapOn(): boolean {
  return (
    agentGuardAnyCapSet(guardSettings()) ||
    (engine?.hasOwnCaps() ?? false) ||
    forkGoalBudgetWatched()
  )
}

function anyGuardOn(): boolean {
  return guardSettings().loop || anySpendCapOn()
}

/** Every guarded agent on this host: paused, warned, then capped. */
export function forkAgentGuardEntries(): AgentGuardEntry[] {
  return engine?.entries() ?? []
}

export const forkAgentGuardList = (): ForkGuardsListResult => agentGuardList(engine)

/** Hook (automation launch): the agent a run started, so its automation's caps cover it. */
export const forkAutomationNoteLaunch = (
  automationId: string,
  launched: Parameters<typeof noteAgentGuardAutomationLaunch>[2]
): void => noteAgentGuardAutomationLaunch(engine, automationId, launched)

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
  terminals.titles = rows.terminals
  setAgentGuardLiveIds(rows.live)
  let busy = paused
  for (const row of rows.chats) {
    busy ||= row.working
    await engine.sweepChat(row)
  }
  await terminals.sweep(engine, rows.live, anySpendCapOn())
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
  configureAgentGuardScopes({
    settings: guardSettings,
    store: () => runtime?.requireStore() ?? null
  })
  installAgentGuardRunLinks(terminals, () => runtime?.getExistingOrchestrationDb?.() ?? null)
  await loadAgentGuardScopeState(automationCapsPath(getProfileUserDataPath()))
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
    spend: agentGuardSpendOf,
    run: agentGuardRunOf,
    automationLimits: agentGuardAutomationLimits,
    refreshSpend: (id) => terminals.read(id),
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
    const loop = guardSettings().loop
    if (!engine || !owner || !(loop || anySpendCapOn()) || sleeperChatSessionId(owner.paneKey)) {
      return
    }
    const read = readAgentGuardHookCall(source, body, owner, Date.now())
    if (!read) {
      return
    }
    terminals.note(read)
    terminals.noteHandle(read.paneKey, runtime?.getTerminalHandleForPaneKey(read.paneKey))
    if (anySpendCapOn()) {
      // BAD-679: the agent's transcript is where its spend is; read it and stop it past a cap.
      void engine.observeTerminalSpend(read.paneKey, terminals.meta(read.paneKey)).then(publish)
    }
    if (loop) {
      void engine.observe(read.paneKey, terminals.meta(read.paneKey), read.call).then(publish)
    }
  } catch (error) {
    console.warn('[fork-agent-guards] could not read a hook post', error)
  }
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
  const id = engine.isPaused(query)
    ? query
    : matchAgentGuardEntry(forkAgentGuardEntries(), query).id
  const outcome = await engine.resume(id)
  publish()
  return { id, outcome }
}

/**
 * `orca guards cap <id> <usd>`: a chat's own cap, or with `run` the cap of the whole Run the chat
 * belongs to (kept on its coordinator); 0 goes back to the default.
 */
export async function forkAgentGuardSetCap(
  query: string,
  usd: number,
  run = false
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
  if (run) {
    const result = await engine.caps.setRunCap(sessionId, usd)
    publish()
    return {
      id: result.rootId,
      scope: 'run',
      capUsd: result.capUsd,
      spentUsd: result.spentUsd
    }
  }
  const result = await engine.setCap(sessionId, usd)
  publish()
  return { id: sessionId, scope: 'chat', ...result }
}

/** `orca guards automation-cap <automation id> ...`: one automation's own caps. */
export { setAgentGuardAutomationCap as forkAgentGuardSetAutomationCap } from './agent-guards-scopes'
