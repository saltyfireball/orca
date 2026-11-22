// BAD-678 (FORK.md "Turn checkpoints"): the live wiring of the checkpoint service on this host.
// `installForkTurnCheckpoints` points it at the host's settings (the desktop app, `orca serve` and
// orcad each call it); `startForkTurnCheckpoints` follows the agent status feed, which carries the
// turn boundaries of terminal agents (hooks, OSC 7501) and native chats alike, so one subscription
// covers every harness. A process that never installs it checkpoints nothing.
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import {
  forkTurnCheckpointAgentBusy,
  readForkTurnCheckpointSettings,
  type ForkTurnCheckpointConfig
} from '../../../shared/fork/turn-checkpoints'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import { normalizeRuntimePathForComparison } from '../../../shared/file-access/cross-platform-path'
import { agentHookServer } from '../../agent-hooks/server/agent-hook-server'
import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { getCanonicalUserDataPath } from '../../persistence/loading-store/user-data-path'
import type { CheckpointGit } from './turn-checkpoint-shadow'
import { createTurnCheckpointService, type TurnCheckpointService } from './turn-checkpoint-service'

const GIT_TIMEOUT_MS = 5 * 60_000
const FOLDER = 'fork-turn-checkpoints'

let readSettings: (() => unknown) | null = null
let service: TurnCheckpointService | null = null
let started = false

/** Points the feature at this host's settings. Reads nothing yet. */
export function installForkTurnCheckpoints(store: { getSettings: () => unknown }): void {
  readSettings = () => store.getSettings()
}

function config(): ForkTurnCheckpointConfig {
  return readSettings
    ? readForkTurnCheckpointSettings(readSettings())
    : { ...readForkTurnCheckpointSettings(null), enabled: false }
}

const appGit: CheckpointGit = async (args, options) =>
  (
    await gitExecFileAsync(args, {
      cwd: options.cwd,
      timeout: GIT_TIMEOUT_MS,
      ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
      ...(options.env ? { env: { ...process.env, ...options.env } } : {})
    })
  ).stdout

/** Agents of this host that are busy in the workspace's folder right now. */
function busyAgentsIn(workspacePath: string): string[] {
  const wanted = normalizeRuntimePathForComparison(workspacePath)
  const busy: string[] = []
  for (const row of agentHookServer.getStatusSnapshot()) {
    const path = splitWorktreeIdForFilesystem(row.worktreeId ?? '')?.worktreePath
    if (
      path &&
      normalizeRuntimePathForComparison(path) === wanted &&
      forkTurnCheckpointAgentBusy(row.state)
    ) {
      busy.push(row.agentType ? `${row.agentType} ${row.paneKey}` : row.paneKey)
    }
  }
  return busy
}

/** The service of this host; null until its settings are installed. */
export function forkTurnCheckpointService(): TurnCheckpointService | null {
  if (!readSettings) {
    return null
  }
  service ??= createTurnCheckpointService({
    git: appGit,
    root: join(getCanonicalUserDataPath(), FOLDER),
    config,
    now: Date.now,
    busyAgents: busyAgentsIn
  })
  return service
}

/** The settings as this host reads them (for `orca checkpoint list`). */
export function forkTurnCheckpointConfig(): ForkTurnCheckpointConfig {
  return config()
}

function workspacePathOf(worktreeId: string | undefined): string | null {
  const path = worktreeId ? splitWorktreeIdForFilesystem(worktreeId)?.worktreePath : undefined
  return path && path.length > 0 ? path : null
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const lastState = new Map<string, string>()
const MAX_TRACKED_PANES = 2000

function onStatus(event: EnrichedAgentHookEventPayload): void {
  if (event.providerSessionOnly || event.restoredUnconfirmed || event.isReplay) {
    return
  }
  const state = event.payload.state
  const previous = lastState.get(event.paneKey)
  lastState.delete(event.paneKey)
  lastState.set(event.paneKey, state)
  while (lastState.size > MAX_TRACKED_PANES) {
    const oldest = lastState.keys().next().value
    if (typeof oldest !== 'string') {
      break
    }
    lastState.delete(oldest)
  }
  const current = service
  const path = workspacePathOf(event.worktreeId)
  if (!current || !path || previous === state || !config().enabled) {
    return
  }
  const origin = {
    sessionId: event.paneKey,
    agent: event.payload.agentType ?? null,
    prompt: event.payload.prompt || null
  }
  if (state === 'working') {
    void current.captureForTurn(path, 'baseline', origin)
  } else if (state === 'done') {
    void current.captureForTurn(path, 'turn', origin)
  }
}

/**
 * Follows agent turns on this host: a first turn in a workspace takes a baseline, each turn's end
 * takes a checkpoint when the files changed. Capture runs after the turn ended, off its path.
 */
export function startForkTurnCheckpoints(): void {
  const current = forkTurnCheckpointService()
  if (!current || started) {
    return
  }
  started = true
  agentHookServer.subscribeEnrichedStatus(onStatus)
  void exists(join(getCanonicalUserDataPath(), FOLDER))
    .then((there) => (there ? current.sweepStores() : 0))
    .catch((error: unknown) => {
      console.warn('[fork-turn-checkpoints] Could not sweep old checkpoint stores', error)
    })
}
