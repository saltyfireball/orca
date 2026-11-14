// Idle recovery (FORK.md), item B: what the candidate list and the ending reader ask of this
// process. Everything is a read of state Orca already holds (the runtime's agent rows, the chat
// host's loaded sessions, the orchestration database), so tests pass a fake and nothing here
// starts a process. `liveIdleRecoveryHost` is the one wired to the running app.
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import type { SleeperOverlay } from '../../../shared/fork/sleepers'
import type { SleeperChatHostFact } from '../../../shared/fork/sleepers-ps-sources'
import type {
  RuntimeWorktreeAgentRow,
  RuntimeWorktreePsSummary
} from '../../../shared/runtime-worktree-contracts'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { forkSleeperChatFacts } from '../sleepers/sleepers-host'
import { forkSleeperLifecycleOverlay } from '../sleepers/sleepers-lifecycle'
import { readIdleRecoveryDispatchRows, type IdleRecoveryDispatchRow } from './idle-recovery-roles'

export type IdleRecoveryPsWorktree = Pick<
  RuntimeWorktreePsSummary,
  'worktreeId' | 'displayName' | 'repo' | 'hostId' | 'path' | 'automationCreated'
> & {
  agents?: readonly RuntimeWorktreeAgentRow[]
}

/** What the chat host says of one loaded native chat. */
export type IdleRecoveryChatSummary = {
  launchDirectory: string | null
  /** A background task of the chat (a command, a monitor, a sub-agent) has not finished. */
  backgroundRunning: boolean
}

/** What the agent status store holds for one terminal agent pane. */
export type IdleRecoveryTerminalStatus = {
  prompt: string
  lastAssistantMessage: string | null
  /** The agent's own transcript file, when its hooks reported one. */
  transcriptPath: string | null
}

export type IdleRecoveryHost = {
  /** The same agent rows the Sleepers list is built from. */
  worktreePs: () => Promise<readonly IdleRecoveryPsWorktree[]>
  chatFacts: () => ReadonlyMap<string, SleeperChatHostFact>
  lifecycle: () => Pick<SleeperOverlay, 'stalled' | 'queued'>
  /** Null for a chat this host has not loaded. Never loads one. */
  chatSummary: (sessionId: string) => IdleRecoveryChatSummary | null
  /** The journal rows of a loaded chat, from memory; null for a chat that is not loaded. */
  chatJournal: (sessionId: string) => Promise<readonly AgentJournalRenderItem[] | null>
  terminalStatus: (paneKey: string) => Promise<IdleRecoveryTerminalStatus | null>
  /** Every dispatch with its two ends; empty when no orchestration has run on this host. */
  dispatchRows: () => Promise<readonly IdleRecoveryDispatchRow[]>
}

type IdleRecoveryRuntime = Pick<
  OrcaRuntimeService,
  'getWorktreePs' | 'getExistingOrchestrationDb' | 'getAgentStatusSnapshotFn'
>

let runtimeSlot: IdleRecoveryRuntime | null = null

/** Hands the sweep this process's runtime. Without it the start-up state is asked instead. */
export function setIdleRecoveryRuntime(runtime: IdleRecoveryRuntime | null): void {
  runtimeSlot = runtime
}

async function currentRuntime(): Promise<IdleRecoveryRuntime | null> {
  if (runtimeSlot) {
    return runtimeSlot
  }
  try {
    // Lazy: the start-up state imports electron, which this folder's sweep must not load at
    // import time (and never loads at all while the mode is off).
    const { mainProcessState } = await import('../../startup/main-process-state')
    return mainProcessState.runtime
  } catch {
    return null
  }
}

// A task with no state (an older host) is unknown, and is not counted as running.
const BACKGROUND_RUNNING: readonly string[] = ['working', 'monitoring', 'waiting', 'blocked']

export function liveIdleRecoveryHost(): IdleRecoveryHost {
  return {
    worktreePs: async () => {
      const runtime = await currentRuntime()
      return runtime ? (await runtime.getWorktreePs()).worktrees : []
    },
    chatFacts: forkSleeperChatFacts,
    lifecycle: forkSleeperLifecycleOverlay,
    chatSummary: (sessionId) => {
      const host = getStructuredAgentSessionHost()
      if (!host || !host.loadedSessionIds().includes(sessionId)) {
        return null
      }
      const summary = host.readStatusSummary(sessionId)
      return {
        launchDirectory: summary?.launchDirectory ?? null,
        backgroundRunning: (summary?.backgroundTasks ?? []).some(
          (task) => task.state !== undefined && BACKGROUND_RUNNING.includes(task.state)
        )
      }
    },
    chatJournal: async (sessionId) => {
      const host = getStructuredAgentSessionHost()
      // A journal read loads the conversation, so only chats already in memory are read.
      if (!host || !host.loadedSessionIds().includes(sessionId)) {
        return null
      }
      return (await host.journalCurrentRead(sessionId)).items
    },
    terminalStatus: async (paneKey) => {
      const runtime = await currentRuntime()
      const entry = runtime?.getAgentStatusSnapshotFn?.().find((row) => row.paneKey === paneKey)
      if (!entry) {
        return null
      }
      return {
        prompt: entry.prompt ?? '',
        lastAssistantMessage: entry.lastAssistantMessage ?? null,
        transcriptPath: entry.providerSession?.transcriptPath?.trim() || null
      }
    },
    dispatchRows: async () => {
      const db = (await currentRuntime())?.getExistingOrchestrationDb() ?? null
      return db ? readIdleRecoveryDispatchRows(db) : []
    }
  }
}
