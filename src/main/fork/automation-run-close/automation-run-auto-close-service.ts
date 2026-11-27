// Auto-close finished automation run chats (FORK.md, BAD-848): the pass wired to this process's
// runtime and its timer. One hook inside installForkWorkerArchive starts it, beside the bot chat
// auto-close. The first pass is the sweep of runs from before the update: it judges them by the
// same rule, from times the run store and the chat record already hold.
import type { WorkspaceSessionState } from '../../../shared/workspace-session/workspace-session-state-types'
import type { Store } from '../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { AgentSessionRecordStore } from '../../runtime/agent-session/records/agent-session-record-store'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import {
  isAutoClosedChat,
  rememberAutoClosedChat
} from '../bot-chat-close/bot-chat-auto-closed-registry'
import { runtimeFinishedChatCloseDeps } from './finished-chat-close'
import { recordAutomationRunCloseDecisions } from './automation-run-close-decisions'
import {
  runAutomationRunAutoClosePass,
  type AutomationRunAutoCloseDeps,
  type AutomationRunAutoCloseRow,
  type RunChat
} from './automation-run-auto-close'

export const FORK_AUTOMATION_RUN_AUTO_CLOSE_SWEEP_MS = 2 * 60_000
export const FORK_AUTOMATION_RUN_AUTO_CLOSE_IDLE_SWEEP_MS = 10 * 60_000

type Runtime = Pick<OrcaRuntimeService, 'requireStore' | 'bots' | 'openAgentSessionRecordStore'> &
  Parameters<typeof runtimeFinishedChatCloseDeps>[1]

/** A registry key no session id or recipient can name. */
function closedRunKey(run: Pick<RunChat, 'id'>): string {
  return `automation-run:${run.id}`
}

/** The chat's tab is pinned in any window's saved session. */
export function chatTabPinned(
  sessions: readonly (WorkspaceSessionState | null | undefined)[],
  run: Pick<RunChat, 'workspaceId' | 'chatSessionId'>
): boolean {
  return sessions.some((session) =>
    Object.entries(session?.unifiedTabs ?? {}).some(
      ([workspaceId, tabs]) =>
        (run.workspaceId === null || workspaceId === run.workspaceId) &&
        tabs.some(
          (tab) =>
            tab.contentType === 'agent-session' &&
            tab.entityId === run.chatSessionId &&
            tab.isPinned === true
        )
    )
  )
}

export function automationRunAutoCloseDeps(
  store: Partial<
    Pick<
      Store,
      | 'listAutomationRuns'
      | 'listAutomations'
      | 'getWorkspaceSession'
      | 'getWorkspaceSessionHostIds'
    >
  > & { getSettings: () => unknown },
  records: AgentSessionRecordStore,
  homeChatIds: () => ReadonlySet<string>,
  surfaceRuntime?: Parameters<typeof runtimeFinishedChatCloseDeps>[1]
): AutomationRunAutoCloseDeps {
  return {
    ...runtimeFinishedChatCloseDeps(records, surfaceRuntime),
    records,
    now: () => Date.now(),
    settings: store.getSettings(),
    runs: () => store.listAutomationRuns?.() ?? [],
    automations: () => store.listAutomations?.() ?? [],
    homeChatIds,
    pinned: (run) =>
      chatTabPinned(
        (store.getWorkspaceSessionHostIds?.() ?? []).map((hostId) =>
          store.getWorkspaceSession?.(hostId)
        ),
        run
      ),
    wasAutoClosed: (run) => isAutoClosedChat(closedRunKey(run)),
    // The chat id lets mail reopen it (and is forgotten then); the run's key is never forgotten,
    // so a chat someone opened again is not closed a second time.
    remember: async (run) => {
      await rememberAutoClosedChat(run.chatSessionId, `automation:${run.automationId}`)
      await rememberAutoClosedChat(closedRunKey(run), `automation:${run.automationId}`)
    }
  }
}

async function runtimeDeps(runtime: Runtime): Promise<AutomationRunAutoCloseDeps> {
  const store = runtime.requireStore()
  const records = await runtime.openAgentSessionRecordStore()
  return automationRunAutoCloseDeps(
    store,
    records,
    () =>
      new Set(runtime.bots.list().flatMap((bot) => (bot.chatSessionId ? [bot.chatSessionId] : []))),
    runtime
  )
}

function isRuntime(runtime: unknown): runtime is Runtime {
  return (
    typeof runtime === 'object' &&
    runtime !== null &&
    'requireStore' in runtime &&
    'bots' in runtime &&
    'openAgentSessionRecordStore' in runtime
  )
}

let installed: { runtime: Runtime; running: boolean } | null = null
let stopTimer: (() => void) | null = null

/** Hook (from installForkWorkerArchive): starts the run chat auto-close timer for this runtime. */
export function installForkAutomationRunAutoClose(runtime: unknown): void {
  if (!isRuntime(runtime) || installed?.runtime === runtime) {
    return
  }
  installed = { runtime, running: false }
  stopTimer ??= startForkBackoffTimer({
    run: sweepForkAutomationRunAutoClose,
    baseMs: FORK_AUTOMATION_RUN_AUTO_CLOSE_SWEEP_MS,
    maxMs: FORK_AUTOMATION_RUN_AUTO_CLOSE_IDLE_SWEEP_MS
  })
}

/** One sweep with these deps: close what the rule ends and record every decision for the run list. */
export async function sweepAutomationRunAutoCloseWith(
  deps: AutomationRunAutoCloseDeps
): Promise<boolean> {
  const rows: AutomationRunAutoCloseRow[] = await runAutomationRunAutoClosePass(deps, {
    dryRun: false,
    includeKept: true
  })
  recordAutomationRunCloseDecisions(rows, deps.now())
  const failed = rows.filter((row) => row.outcome === 'failed')
  if (failed.length > 0) {
    console.warn(
      '[fork automation run auto-close] could not close',
      failed.map((row) => `${row.runId}:${row.error ?? ''}`).join(', ')
    )
  }
  return rows.some((row) => row.outcome === 'closed')
}

/** One timer tick; false while the setting is off or nothing closed, so the timer backs off. */
export async function sweepForkAutomationRunAutoClose(): Promise<boolean> {
  const state = installed
  if (!state || state.running) {
    return true
  }
  state.running = true
  try {
    return await sweepAutomationRunAutoCloseWith(await runtimeDeps(state.runtime))
  } catch (error) {
    console.warn('[fork automation run auto-close] pass failed', error)
    return false
  } finally {
    state.running = false
  }
}
