// Idle recovery (FORK.md), item B: which chats the sweep looks at.
// Contract: list this host's native chats and terminal agents whose turn has ended and that
// have been idle for at least `settings.idleSeconds`, with the facts the wake rules need. Skip
// sub-agents, chats in a turn, and workers unless `settings.workers` is 'include'. Read only:
// never send to, wake or stop a chat from here.
// The rows come from the Sleepers list's own builders (`sleeperSourcesFromPs`,
// `buildSleeperRows`), so "idle" means here what it means there. One listing is one read of
// the runtime's agent rows and, only when some chat is idle, one read of the dispatch table.
import { isForkAgentGuardHeld } from '../agent-guards/agent-guards-holds'
import { isForkBackgroundRun } from '../background-runs/background-run-status'
import { mainAgentState } from '../../../shared/agent-status/lifecycle/main-agent-status'
import { isOrcaDispatchPrompt } from '../../../shared/agent-status/presentation/agent-row-primary-text'
import { isWakePrompt, type IdleRecoveryRequestSource } from '../../../shared/fork/idle-recovery'
import type { IdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import { buildSleeperRows, filterSleepers } from '../../../shared/fork/sleepers'
import {
  sleeperChatSessionId,
  sleeperSourcesFromPs
} from '../../../shared/fork/sleepers-ps-sources'
import type { RuntimeWorktreeAgentRow } from '../../../shared/worktree/catalog/runtime-worktree-contracts'
import { keepIdleRecoveryEndings, readIdleRecoveryChatEnding } from './idle-recovery-ending'
import {
  liveIdleRecoveryHost,
  type IdleRecoveryHost,
  type IdleRecoveryPsWorktree
} from './idle-recovery-host'
import { buildIdleRecoveryRoleIndex } from './idle-recovery-roles'
import type { IdleRecoveryCandidate } from './idle-recovery-types'

type RowFacts = {
  row: RuntimeWorktreeAgentRow
  worktree: IdleRecoveryPsWorktree
  /** The row has an orchestration parent: it is a dispatched worker. */
  parented: boolean
  /** The agent's own turn is over while the row is held working by background work. */
  heldByBackground: boolean
}

/** A turn the user stopped (or that a newer send replaced) is not an ending to recover. */
function endedByUser(row: RuntimeWorktreeAgentRow): boolean {
  const outcome = row.mainAgent?.outcome
  return row.interrupted || outcome === 'cancellation' || outcome === 'superseded'
}

/**
 * The row as the Sleepers builders should see it. A row whose own agent is done but which is
 * held working by a background job or a scheduled wake-up is dated by the agent's own turn
 * end, so it lists as idle with `backgroundPending` set. A worker's parent is dropped when
 * workers are included, because the builders skip every row with a parent.
 */
function rowForSleepers(row: RuntimeWorktreeAgentRow, includeWorkers: boolean): RowFacts['row'] {
  const held = row.state === 'working' && mainAgentState(row) === 'done' && row.mainAgent
  const next = held ? { ...row, state: 'done' as const, stateStartedAt: held.stateStartedAt } : row
  return includeWorkers && next.parentPaneKey ? { ...next, parentPaneKey: null } : next
}

const MAIL_POINTER = /^\s*You have (?:\d+ (?:new )?|new )orchestration messages?\b/

/** A prompt Orca itself typed for another agent: a dispatch brief or a mailbox pointer. */
export function isOrchestrationPrompt(prompt: string): boolean {
  return isOrcaDispatchPrompt(prompt) || MAIL_POINTER.test(prompt)
}

function requestSourceOf(
  prompt: string,
  fromAgent: boolean,
  worktree: IdleRecoveryPsWorktree
): IdleRecoveryRequestSource {
  if (isWakePrompt(prompt)) {
    return 'wake'
  }
  if (fromAgent || isOrchestrationPrompt(prompt)) {
    return 'orchestration'
  }
  // A workspace an automation made runs the automation's prompt. A later turn the user typed
  // there cannot be told apart, and reading it as the automation's only ever withholds a wake.
  return worktree.automationCreated ? 'automation' : 'user'
}

export async function listIdleRecoveryCandidatesWith(
  host: IdleRecoveryHost,
  settings: IdleRecoverySettings,
  nowMs: number
): Promise<IdleRecoveryCandidate[]> {
  if (settings.mode === 'off') {
    return []
  }
  const includeWorkers = settings.workers === 'include'
  const facts = new Map<string, RowFacts>()
  const busyParents = new Set<string>()
  const worktrees = (await host.worktreePs()).map((worktree) => ({
    ...worktree,
    agents: (worktree.agents ?? []).flatMap((row) => {
      if (row.parentPaneKey && mainAgentState(row) !== 'done') {
        busyParents.add(row.parentPaneKey)
      }
      if (endedByUser(row)) {
        return []
      }
      const shaped = rowForSleepers(row, includeWorkers)
      facts.set(row.paneKey, {
        row,
        worktree,
        parented: Boolean(row.parentPaneKey),
        heldByBackground: shaped.state !== row.state
      })
      return [shaped]
    })
  }))
  const rows = buildSleeperRows(sleeperSourcesFromPs(worktrees, host.chatFacts()), {
    now: nowMs,
    pinned: new Set(),
    onScreen: new Set(),
    ...host.lifecycle()
  })
  const paused = new Set(settings.paused)
  // 'awake-idle' leaves out a turn in progress, a question to the user, a stalled or queued
  // chat, and everything asleep or hibernated.
  const idle = filterSleepers(rows, {
    states: ['awake-idle'],
    minIdleMs: Math.max(1, settings.idleSeconds * 1000)
  }).filter((row) => row.local && !paused.has(row.id) && !isForkAgentGuardHeld(row.id))
  keepIdleRecoveryEndings(new Set(idle.map((row) => row.id)))
  if (idle.length === 0) {
    return []
  }
  const roleOf = buildIdleRecoveryRoleIndex(await host.dispatchRows())
  const candidates: IdleRecoveryCandidate[] = []
  for (const row of idle) {
    const fact = facts.get(row.paneKey)
    if (!fact) {
      continue
    }
    const sessionId = row.kind === 'chat' ? sleeperChatSessionId(row.paneKey) : null
    // A hidden look-around or tidy-up has no owner to wait on, whatever its last words read like.
    if (sessionId && isForkBackgroundRun(sessionId)) {
      continue
    }
    const orchestration = roleOf({ paneKey: row.paneKey, sessionId })
    const role = fact.parented ? 'worker' : orchestration.role
    if (role === 'worker' && !includeWorkers) {
      continue
    }
    const summary = sessionId ? host.chatSummary(sessionId) : null
    const lastPrompt = fact.row.prompt
    const chat = { chatId: row.id, kind: row.kind, lastPrompt, idleSince: row.stateStartedAt }
    // Only a native chat's journal says who sent a message; it is read once per ending.
    const ending = row.kind === 'chat' ? await readIdleRecoveryChatEnding(host, chat) : null
    candidates.push({
      ...chat,
      agent: row.agent ?? '',
      cwd: summary?.launchDirectory || fact.worktree.path,
      title: row.title,
      workspace: row.workspace,
      worktreeId: row.worktreeId,
      role,
      requestSource: requestSourceOf(lastPrompt, ending?.fromAgent === true, fact.worktree),
      backgroundPending: fact.heldByBackground || summary?.backgroundRunning === true,
      // A terminal agent's scheduled wake-up holds its row working like a background job does,
      // so it arrives as `backgroundPending`. A native chat's is not visible to this process.
      scheduledWake: false,
      coordinatorBusy: orchestration.openDispatches || busyParents.has(row.paneKey)
    })
  }
  return candidates
}

export async function listIdleRecoveryCandidates(
  settings: IdleRecoverySettings,
  nowMs: number
): Promise<IdleRecoveryCandidate[]> {
  if (settings.mode === 'off') {
    return []
  }
  return listIdleRecoveryCandidatesWith(liveIdleRecoveryHost(), settings, nowMs)
}
