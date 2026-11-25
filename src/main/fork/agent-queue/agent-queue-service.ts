// SLRM-2098 (FORK.md "Agent launch queue"): the app's one launch gate, its settings, what counts
// as running, and the hooks upstream code calls. Off unless the setting is on; then nothing here
// runs on a launch beyond one settings read.
import { randomUUID } from 'node:crypto'
import {
  forkAgentQueueConfigOf,
  type ForkAgentQueueConfig,
  type ForkAgentQueueKind,
  type ForkAgentQueueSnapshot,
  type ForkAgentQueueStatus
} from '../../../shared/fork/agent-queue'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import { parseOrcaSessionAddress } from '../../../shared/agent-session/identity/orca-session-address'
import { structuredAgentSessionIdFromTabId } from '../../../shared/agent-session/view/structured-agent-session-tab-id'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { AgentLaunchGate } from './agent-launch-gate'
import * as heldLaunches from '../pause-all/pause-all-held-launches'
import type { ForkAgentQueueTerminals } from './agent-queue-runtime'
import { recordedWorkerOf, recordedWorkerState } from './agent-queue-runtime'
import { claimThroughGate, type QueueClaimInput } from './agent-queue-claim'
import { isForkPauseAllEngaged, onForkPauseAllChanged } from '../pause-all/pause-all-state'
import { onLaunchHoldChanged, shouldHoldLaunches } from './launch-hold'
import { readLiveAgents, type LiveAgentSources } from './live-agents'

type WorkerNote = { dispatchId: string; parentKey?: string }

/** BAD-766: what a Run's spend index needs of a worker: who started it, chat or terminal. */
export type ForkAgentQueueRunParent = { chat: string } | { handle: string }

let readSettings: () => ForkGlobalSettings | undefined = () => undefined
let terminals: ForkAgentQueueTerminals = {
  ptys: () => undefined,
  ptyIdOfHandle: () => undefined
}
let gate: AgentLaunchGate | null = null
const changeListeners = new Set<() => void>()
const workers = new Map<string, WorkerNote>()
/** Worker handles, so a worker that coordinates workers of its own is found as a parent. */
const workerHandles = new Map<string, string>()
/** BAD-766: a terminal worker's handle to whoever started it (a chat session or a terminal handle). */
const terminalWorkerParents = new Map<string, ForkAgentQueueRunParent>()
/** BAD-766: a chat worker's starter when that is a terminal (its handle), for the Run index. */
const chatWorkerTerminalParents = new Map<string, string>()
const MAX_TERMINAL_WORKERS = 2000
/** Chats whose start went through the gate lately, so a status question about them ends at once. */
const passed = new Map<string, number>()
const PASSED_TTL_MS = 60_000

function notePassed(sessionId: string): void {
  const now = Date.now()
  for (const [key, at] of passed) {
    if (now - at > PASSED_TTL_MS) {
      passed.delete(key)
    }
  }
  passed.set(sessionId, now)
  heldLaunches.forgetForkPauseAllHeldLaunch(sessionId)
}

function config(): ForkAgentQueueConfig {
  return forkAgentQueueConfigOf(readSettings() ?? {})
}

function sources(): LiveAgentSources {
  return {
    host: getStructuredAgentSessionHost(),
    ptys: terminals.ptys(),
    workerKind: (sessionId) => (workers.has(sessionId) ? 'worker' : 'interactive')
  }
}

export function agentQueueGate(): AgentLaunchGate {
  if (!gate) {
    gate = new AgentLaunchGate({
      readConfig: config,
      readLive: () => readLiveAgents(sources()),
      shouldHold: shouldHoldLaunches,
      paused: isForkPauseAllEngaged,
      now: Date.now,
      schedule: (run, ms) => {
        const timer = setTimeout(run, ms)
        timer.unref?.()
        return () => clearTimeout(timer)
      },
      newId: () => randomUUID().slice(0, 8)
    })
    onLaunchHoldChanged(() => gate?.notify())
    // Pause all (BAD-685, FORK.md): resuming lets the waiting worker launches start.
    onForkPauseAllChanged(() => gate?.notify())
    gate.onChange(() => {
      for (const listener of changeListeners) {
        listener()
      }
    })
  }
  return gate
}

/** The queue or its counts changed (the window's queued banners and badges follow it). */
export function onForkAgentQueueChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

/** Start-up (desktop and orcad): settings, runtime, and Pause all's held launches (BAD-818). */
export function installForkAgentQueue(
  read: () => ForkGlobalSettings | undefined,
  runtimeTerminals: ForkAgentQueueTerminals
): void {
  readSettings = read
  terminals = runtimeTerminals
  heldLaunches.installForkPauseAllHeldLaunches((id) => recordedWorkerState(terminals, id))
}

/** The live key of whoever started a worker: a chat's session id, or a terminal's pty. */
function parentKeyOf(from: string | undefined): string | undefined {
  if (!from) {
    return undefined
  }
  // BAD-524: a chat coordinator passes its `orca_session_id:<id>` mail address as `from`; without
  // parsing it no worker ever linked to its coordinator and the usage rollup stayed flat.
  const chat =
    structuredAgentSessionIdFromTabId(from) ??
    parseOrcaSessionAddress(from) ??
    workerHandles.get(from)
  if (chat) {
    return chat
  }
  try {
    const ptyId = terminals.ptyIdOfHandle(from)
    return ptyId ? `pty:${ptyId}` : undefined
  } catch {
    return undefined
  }
}

/** Hook (worker start): this chat is an orchestration worker started by `from`. */
export function forkAgentQueueNoteWorker(worker: {
  session: { sessionId: string; handle: string } | null
  from: string | undefined
  dispatchId: string
  /** BAD-766: the terminal the worker runs in; a terminal worker has no chat session. */
  terminalHandle?: string
}): void {
  if (!worker.session) {
    // BAD-766: a terminal worker joins its coordinator's Run, so its spend is in the Run's sum.
    const parent = runParentOfFrom(worker.from)
    if (worker.terminalHandle && parent) {
      if (terminalWorkerParents.size >= MAX_TERMINAL_WORKERS) {
        terminalWorkerParents.delete(terminalWorkerParents.keys().next().value as string)
      }
      terminalWorkerParents.set(worker.terminalHandle, parent)
    }
    return
  }
  const parent = runParentOfFrom(worker.from)
  if (parent && 'handle' in parent) {
    chatWorkerTerminalParents.set(worker.session.sessionId, parent.handle)
  }
  const parentKey = parentKeyOf(worker.from)
  workers.set(worker.session.sessionId, {
    dispatchId: worker.dispatchId,
    ...(parentKey ? { parentKey } : {})
  })
  workerHandles.set(worker.session.handle, worker.session.sessionId)
}

function runParentOfFrom(from: string | undefined): ForkAgentQueueRunParent | undefined {
  if (!from) {
    return undefined
  }
  const chat =
    structuredAgentSessionIdFromTabId(from) ??
    parseOrcaSessionAddress(from) ??
    workerHandles.get(from)
  return chat ? { chat } : { handle: from }
}

/**
 * BAD-766: who started a worker for the Run index: a chat worker by its session id, a terminal
 * worker by the handle of its terminal. A chat parent is a session id; a terminal parent a handle.
 */
export function forkAgentQueueRunParent(
  worker: { sessionId: string } | { terminalHandle: string }
): ForkAgentQueueRunParent | undefined {
  if ('terminalHandle' in worker) {
    return terminalWorkerParents.get(worker.terminalHandle)
  }
  const chat = forkAgentQueueWorkerParent(worker.sessionId)
  if (chat) {
    return { chat }
  }
  const handle = chatWorkerTerminalParents.get(worker.sessionId)
  return handle ? { handle } : undefined
}

/** The chat that dispatched this worker, when a chat (not a terminal) did; for the usage rollup. */
export function forkAgentQueueWorkerParent(sessionId: string): string | undefined {
  const parentKey = workers.get(sessionId)?.parentKey
  return parentKey && !parentKey.startsWith('pty:') ? parentKey : undefined
}

function labelOf(sessionId: string): string {
  const summary = getStructuredAgentSessionHost()?.readStatusSummary(sessionId)
  const text = (summary?.conversationName?.trim() || summary?.latestPrompt || '')
    .replace(/\s+/g, ' ')
    .trim()
  const name = text.length > 60 ? `${text.slice(0, 57)}...` : text
  return name || `${summary?.agent ?? 'agent'} chat`
}

/** Hook (chat provider start): passes the start through the gate. */
export function forkAgentQueueStart<O>(input: {
  sessionId: string
  /** The chat ran a provider before (it has a provider conversation or an ended child). */
  resume: () => boolean
  start: QueueClaimInput<O>['start']
  reclaim: QueueClaimInput<O>['reclaim']
  cancelled: QueueClaimInput<O>['cancelled']
}): Promise<O> {
  // Off and nothing waiting: the start runs exactly as upstream's.
  if (!config().enabled && (gate?.entries().length ?? 0) === 0 && !isForkPauseAllEngaged()) {
    heldLaunches.forgetForkPauseAllHeldLaunch(input.sessionId)
    return input.start()
  }
  const { sessionId } = input
  return claimThroughGate(agentQueueGate(), {
    key: sessionId,
    request: () => {
      const worker = workers.get(sessionId) ?? recordedWorkerOf(terminals, sessionId)
      const kind: ForkAgentQueueKind = worker ? 'worker' : 'interactive'
      if (worker && isForkPauseAllEngaged()) {
        heldLaunches.noteForkPauseAllHeldLaunch(sessionId)
      }
      return {
        key: sessionId,
        kind,
        label: labelOf(sessionId),
        resume: input.resume(),
        ...(worker?.parentKey ? { parentKey: worker.parentKey } : {}),
        ...(worker ? { dispatchId: worker.dispatchId } : {})
      }
    },
    start: (refused) => {
      notePassed(sessionId)
      return input.start(refused)
    },
    reclaim: input.reclaim,
    cancelled: input.cancelled
  })
}

export function forkAgentQueueSnapshot(): ForkAgentQueueSnapshot {
  const current = config()
  const hold = shouldHoldLaunches()
  const active = gate
  return {
    enabled: current.enabled,
    live: active ? active.liveCounts() : { interactive: 0, worker: 0 },
    limits: {
      separate: current.separate,
      maxLive: current.maxLive,
      maxWorkers: current.maxWorkers
    },
    ...(hold.hold ? { heldReason: hold.reason ?? 'held' } : {}),
    entries: active ? active.entries() : []
  }
}

function sessionOfDispatch(dispatchId: string): string | undefined {
  for (const [sessionId, note] of workers) {
    if (note.dispatchId === dispatchId) {
      return sessionId
    }
  }
  return undefined
}

function findStatus(params: { sessionId?: string; dispatchId?: string }): ForkAgentQueueStatus {
  const entry = gate
    ?.entries()
    .find((candidate) =>
      params.sessionId
        ? candidate.sessionId === params.sessionId
        : candidate.dispatchId === params.dispatchId
    )
  return entry ? { state: 'queued', entry } : { state: 'not-queued' }
}

/** Where one launch stands. A launch call returns before its start reaches the gate, so wait a moment for it. */
export async function forkAgentQueueStatus(params: {
  sessionId?: string
  dispatchId?: string
  waitMs?: number
}): Promise<ForkAgentQueueStatus> {
  const deadline = Date.now() + (params.waitMs ?? 0)
  const sessionId =
    params.sessionId ?? (params.dispatchId ? sessionOfDispatch(params.dispatchId) : undefined)
  // Settled already: the queue is off, or this start went through the gate.
  const settled = (): boolean =>
    (!config().enabled && (gate?.entries().length ?? 0) === 0) ||
    (sessionId !== undefined && passed.has(sessionId))
  let status = findStatus(params)
  while (status.state !== 'queued' && !settled() && Date.now() < deadline && gate) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    status = findStatus(params)
  }
  return status
}

/**
 * Hook (orchestration send): a settlement wait on a chat that is queued ends at once, with no
 * settlement, so the worker start reports instead of holding its caller until a slot frees.
 */
export function forkAgentQueueRaceSettlement<T>(
  sessionId: string,
  settlement: Promise<T>
): Promise<T | undefined> {
  if (!gate) {
    return settlement
  }
  const active = gate
  const isQueued = (): boolean => active.entries().some((entry) => entry.sessionId === sessionId)
  if (isQueued()) {
    void settlement.catch(() => {})
    return Promise.resolve(undefined)
  }
  return new Promise<T | undefined>((resolve, reject) => {
    const stop = active.onChange(() => {
      if (isQueued()) {
        stop()
        resolve(undefined)
      }
    })
    settlement.then(
      (value) => {
        stop()
        resolve(value)
      },
      (error: unknown) => {
        stop()
        reject(error)
      }
    )
  })
}

/** Skip the queue for one launch. */
export function forkAgentQueueStartNow(id: string): boolean {
  return gate?.startNow(id) ?? false
}

export function forkAgentQueueCancel(id: string): boolean {
  return gate?.cancel(id) ?? false
}
