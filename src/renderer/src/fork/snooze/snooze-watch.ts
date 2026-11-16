// Snooze (FORK.md, SLRM-2269): what the window knows about each snoozed workspace or chat, read
// from the store at one look: did it just get opened, is one of its agents waiting on an approval
// or a question, did one fail, is its pull request merged, when was it last active.
import type { AppState } from '@/store/types'
import { findWorktreeById } from '@/store/github/refresh/worktree-refresh'
import { getFocusedAgentPaneKeyForWorktree } from '@/components/sidebar/workspace-card/activity/focused-agent-row-highlight'
import { createWorktreeAgentRowsSelector } from '@/components/sidebar/workspace-card/activity/worktree-agent-rows-projection'
import {
  deriveWorktreeCardPrDisplay,
  getWorktreeReviewCacheKeys
} from '@/components/sidebar/workspace-card/review/worktree-card-pr-derivation'
import { agentVerdictDisplayMark } from '../../../../shared/agent-status/lifecycle/agent-main-agent-verdict'
import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/worktree/types'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { ForkSnoozeEntry, ForkSnoozeFacts } from '../../../../shared/fork/snooze'

/** Where the user is now: the active workspace and its focused agent pane. */
export type ForkSnoozeFocus = { worktreeId: string | null; paneKey: string | null }

export function readForkSnoozeFocus(state: AppState): ForkSnoozeFocus {
  const worktreeId = state.activeWorktreeId ?? null
  return {
    worktreeId,
    paneKey: worktreeId ? getFocusedAgentPaneKeyForWorktree(state, worktreeId) : null
  }
}

function hostOf(hostId: string): ExecutionHostId | undefined {
  const parsed = parseExecutionHostId(hostId)
  return parsed && parsed.kind !== 'local' ? (hostId as ExecutionHostId) : undefined
}

/** The snooze's workspace, if the window knows it. */
export function forkSnoozeWorktree(state: AppState, entry: ForkSnoozeEntry): Worktree | null {
  const id = entry.target.worktreeId
  return id ? findWorktreeById(state, id, hostOf(entry.target.hostId)) : null
}

export function forkSnoozeRepo(state: AppState, worktree: Worktree | null): Repo | undefined {
  return worktree ? state.repos.find((repo) => repo.id === worktree.repoId) : undefined
}

function needsInput(entry: AgentStatusEntry): boolean {
  return (
    entry.state === 'blocked' ||
    entry.state === 'waiting' ||
    entry.programStatus?.state === 'blocked'
  )
}

/** The status rows the snooze covers: one chat's, or every agent's in the workspace. */
function statuses(state: AppState, entry: ForkSnoozeEntry): AgentStatusEntry[] {
  if (entry.target.kind === 'chat') {
    const status = state.agentStatusByPaneKey.get(entry.target.paneKey)
    return status ? [status] : []
  }
  const rows = createWorktreeAgentRowsSelector(
    entry.target.worktreeId,
    hostOf(entry.target.hostId)
  )(state)
  return rows.map((row) => row.entry)
}

export function isForkSnoozeWorktreeMerged(state: AppState, worktree: Worktree | null): boolean {
  if (!worktree) {
    return false
  }
  const repo = forkSnoozeRepo(state, worktree)
  const { hostedReviewCacheKey, prCacheKey } = getWorktreeReviewCacheKeys(
    worktree,
    repo,
    state.settings
  )
  const { prDisplay } = deriveWorktreeCardPrDisplay(
    worktree,
    hostedReviewCacheKey ? state.hostedReviewCache[hostedReviewCacheKey] : undefined,
    prCacheKey ? state.prCache?.[prCacheKey] : undefined
  )
  return prDisplay?.state === 'merged'
}

/** Ask the host for the branch's review again, so a merge shows while the card is hidden. */
export function refreshForkSnoozeReview(state: AppState, worktree: Worktree | null): void {
  const repo = forkSnoozeRepo(state, worktree)
  const { branch } = worktree
    ? getWorktreeReviewCacheKeys(worktree, repo, state.settings)
    : { branch: '' }
  if (!worktree || !repo || !branch) {
    return
  }
  void state
    .fetchHostedReviewForBranch(repo.path, branch, {
      force: true,
      repoId: repo.id,
      admissionTier: 'background',
      repoOwnerExecutionHostId: getRepoExecutionHostId(repo),
      linkedGitHubPR: worktree.linkedPR ?? null
    })
    .catch(() => undefined)
}

export function readForkSnoozeFacts(
  state: AppState,
  entry: ForkSnoozeEntry,
  context: { now: number; previous: ForkSnoozeFocus; current: ForkSnoozeFocus }
): ForkSnoozeFacts {
  const { target } = entry
  const { previous, current } = context
  const opened =
    target.kind === 'workspace'
      ? current.worktreeId === target.worktreeId && previous.worktreeId !== target.worktreeId
      : current.paneKey === target.paneKey && previous.paneKey !== target.paneKey
  const rows = statuses(state, entry)
  let attentionSince = 0
  let failedAt = 0
  let lastActivityAt = 0
  for (const row of rows) {
    lastActivityAt = Math.max(lastActivityAt, row.updatedAt)
    if (needsInput(row)) {
      attentionSince = Math.max(attentionSince, row.stateStartedAt)
    }
    if (agentVerdictDisplayMark(row) === 'failed') {
      failedAt = Math.max(failedAt, row.stateStartedAt || row.updatedAt)
    }
  }
  const worktree =
    entry.until.kind === 'merge' || target.kind === 'workspace'
      ? forkSnoozeWorktree(state, entry)
      : null
  if (target.kind === 'workspace' && worktree) {
    lastActivityAt = Math.max(lastActivityAt, worktree.lastActivityAt ?? 0)
  }
  return {
    now: context.now,
    opened,
    attentionSince,
    failedAt,
    merged: entry.until.kind === 'merge' && isForkSnoozeWorktreeMerged(state, worktree),
    lastActivityAt
  }
}
