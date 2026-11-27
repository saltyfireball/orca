// Auto-close finished automation run chats (FORK.md, BAD-848): one pass over the run store. For each
// chat a run opened, gather the facts the rule needs and close the ones it ends, through the same
// close `orca agent close` uses. Each chat is judged by the newest run naming it.
import {
  isFinalAutomationRunStatus,
  type AutomationRun
} from '../../../shared/automations/history/automation-run'
import { automationRunRecency } from '../../../shared/automations/history/automation-session-reuse'
import type { Automation } from '../../../shared/automations/automation-definition'
import {
  forkAutomationRunAutoCloseEnabled,
  forkAutomationRunAutoCloseGraceMs,
  forkAutomationRunCloseVerdict,
  FORK_AUTOMATION_RUN_TURN_SLACK_MS,
  type ForkAutomationRunCloseFacts,
  type ForkAutomationRunKeepReason
} from '../../../shared/fork/automation-run-auto-close'
import type { AgentSessionRecordStore } from '../../runtime/agent-session/records/agent-session-record-store'
import {
  closeFinishedChat,
  type FinishedChatCloseDeps,
  type FinishedChatCloseResult
} from './finished-chat-close'

export type RunChat = AutomationRun & { chatSessionId: string }

export type AutomationRunAutoCloseDeps = FinishedChatCloseDeps & {
  records: FinishedChatCloseDeps['records'] &
    Pick<AgentSessionRecordStore, 'firstSubmittedUserPrompt'>
  now: () => number
  settings: unknown
  runs: () => readonly AutomationRun[]
  automations: () => readonly Pick<Automation, 'id' | 'reuseSession'>[]
  homeChatIds: () => ReadonlySet<string>
  pinned: (run: RunChat) => boolean
  /** Orca closed this run's chat before (and it is open again now). */
  wasAutoClosed: (run: RunChat) => Promise<boolean>
  /** After a close: remember it, so mail for the chat reopens it. */
  remember: (run: RunChat) => Promise<void>
}

export type AutomationRunAutoCloseRow = {
  runId: string
  automationId: string
  chatSessionId: string
  outcome: 'closed' | 'would-close' | 'kept' | 'failed'
  keep?: ForkAutomationRunKeepReason
  error?: string
}

function ownChats(runs: readonly AutomationRun[]): { run: RunChat; shared: boolean }[] {
  const byChat = new Map<string, RunChat[]>()
  for (const run of runs) {
    if (run.sessionKind === 'chat' && run.chatSessionId) {
      const list = byChat.get(run.chatSessionId) ?? []
      list.push(run as RunChat)
      byChat.set(run.chatSessionId, list)
    }
  }
  return [...byChat.values()].map((list) => ({
    run: list.toSorted((a, b) => automationRunRecency(b) - automationRunRecency(a))[0]!,
    shared: list.length > 1
  }))
}

/** A person's (or anyone's) message after the run ended; the chat's last turn is not proof of one,
 *  since a background task can wake the agent into a turn of its own. */
async function sentAfter(
  deps: AutomationRunAutoCloseDeps,
  chatSessionId: string,
  endedAt: number
): Promise<boolean | null> {
  try {
    const first = await deps.records.firstSubmittedUserPrompt(
      chatSessionId,
      endedAt + FORK_AUTOMATION_RUN_TURN_SLACK_MS
    )
    return first.kind !== 'none'
  } catch {
    return null
  }
}

export async function runAutomationRunAutoClosePass(
  deps: AutomationRunAutoCloseDeps,
  options: { dryRun: boolean; includeKept?: boolean }
): Promise<AutomationRunAutoCloseRow[]> {
  if (!forkAutomationRunAutoCloseEnabled(deps.settings)) {
    return []
  }
  const now = deps.now()
  const graceMs = forkAutomationRunAutoCloseGraceMs(deps.settings)
  const reuse = new Map(deps.automations().map((entry) => [entry.id, entry.reuseSession === true]))
  const homes = deps.homeChatIds()
  const rows: AutomationRunAutoCloseRow[] = []
  for (const { run, shared } of ownChats(deps.runs())) {
    const record = deps.records.getRecord(run.chatSessionId)
    const chat = record
      ? {
          createdAt: record.createdAt,
          tabOpen: deps.records.isSessionTabVisible(run.chatSessionId),
          ...(record.lastTurn ? { lastTurn: record.lastTurn } : {})
        }
      : null
    const facts: Omit<
      ForkAutomationRunCloseFacts,
      'pinned' | 'reopened' | 'working' | 'sentAfterEnd'
    > = {
      finished: isFinalAutomationRunStatus(run.status),
      reuseSession: reuse.get(run.automationId) ?? false,
      homeChat: homes.has(run.chatSessionId),
      sharedChat: shared,
      chat,
      runCreatedAt: run.createdAt,
      endedAt: run.outputSnapshot?.capturedAt ?? run.dispatchedAt ?? run.createdAt,
      endKnown: run.outputSnapshot !== null && run.outputSnapshot !== undefined
    }
    // The cheap facts first: most runs are kept before any chat host is asked.
    let verdict = forkAutomationRunCloseVerdict(
      { ...facts, pinned: false, reopened: false, working: false, sentAfterEnd: false },
      { now, graceMs }
    )
    if (verdict.close) {
      verdict = forkAutomationRunCloseVerdict(
        {
          ...facts,
          pinned: deps.pinned(run),
          reopened: await deps.wasAutoClosed(run),
          working: await deps.working(run.chatSessionId),
          sentAfterEnd: facts.endKnown
            ? await sentAfter(deps, run.chatSessionId, facts.endedAt)
            : false
        },
        { now, graceMs }
      )
    }
    const base = { runId: run.id, automationId: run.automationId, chatSessionId: run.chatSessionId }
    if (!verdict.close) {
      if (options.includeKept) {
        rows.push({ ...base, outcome: 'kept', keep: verdict.keep })
      }
      continue
    }
    if (options.dryRun) {
      rows.push({ ...base, outcome: 'would-close' })
      continue
    }
    const result: FinishedChatCloseResult = await closeFinishedChat(deps, run.chatSessionId).catch(
      (error: unknown) => ({
        closed: false as const,
        reason: 'failed' as const,
        detail: error instanceof Error ? error.message : String(error)
      })
    )
    if (!result.closed) {
      rows.push({ ...base, outcome: 'failed', error: result.detail ?? result.reason })
      continue
    }
    await deps.remember(run)
    rows.push({ ...base, outcome: 'closed' })
  }
  return rows
}
