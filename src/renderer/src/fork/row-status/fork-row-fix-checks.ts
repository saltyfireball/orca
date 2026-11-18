// SLRM-2390 (FORK.md "Row status"): "Ask agent to fix" on an agent row. It builds the stock
// fix-checks prompt (the one the Checks panel's fix action sends, with the failed jobs' log tails)
// and sends it to this row's own agent through the stock agent message send, instead of starting
// a new agent. Everything is read at click time, so rows carry no extra subscriptions for it.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { findWorktreeReviewOwner } from '@/store/github/refresh/worktree-refresh'
import {
  deriveRunningAgentSendTargets,
  runningAgentMessageTarget,
  type RunningAgentSendTarget
} from '@/lib/agent-session/messaging/running-agent-targets'
import { sendMessageToAgent } from '@/lib/agent-session/messaging/agent-message-send'
import type { ActiveAgentNotesSendResult } from '@/lib/agent-session/messaging/terminal/active-agent-note-send-result'
import {
  deriveWorktreeCardPrDisplay,
  getWorktreeReviewCacheKeys
} from '@/components/sidebar/workspace-card/review/worktree-card-pr-derivation'
import {
  buildFixBrokenChecksPrompt,
  collectFixChecksPromptDetails,
  getBrokenChecks,
  hasGitHubCheckHandle
} from '../../../../shared/source-control/checks/pr-checks-fix-prompt'
import { getRepoExecutionHostId } from '../../../../shared/execution-host/execution-host'
import { resolveSourceControlAiEnabled } from '../../../../shared/source-control/ai/source-control-ai-operation-policy'

export type ForkFixRow = { paneKey: string; tab: { worktreeId: string } }

/** The row's own running agent, when it can take a message now. */
export function forkFixTarget(
  state: Parameters<typeof deriveRunningAgentSendTargets>[0],
  row: ForkFixRow
): RunningAgentSendTarget | { refused: string } {
  const target = deriveRunningAgentSendTargets(state, row.tab.worktreeId).find(
    (candidate) => candidate.paneKey === row.paneKey
  )
  if (!target) {
    return {
      refused: translate(
        'fork.rowStatus.fix.noAgent',
        'This agent is not running, so it cannot take a message.'
      )
    }
  }
  if (target.status !== 'eligible') {
    return {
      refused:
        target.disabledReason ??
        translate('fork.rowStatus.fix.notEligible', 'This agent cannot take a message right now.')
    }
  }
  return target
}

export function forkFixSendNotice(result: ActiveAgentNotesSendResult): {
  ok: boolean
  message: string
} {
  if (result.status === 'sent') {
    return {
      ok: true,
      message: translate('fork.rowStatus.fix.sent', 'Asked the agent to fix the failing checks.')
    }
  }
  if (result.status === 'unconfirmed') {
    return {
      ok: true,
      message: translate(
        'fork.rowStatus.fix.unconfirmed',
        'Sent the failing checks; the agent has not confirmed it yet.'
      )
    }
  }
  if (result.status === 'not-ready') {
    return {
      ok: false,
      message: translate(
        'fork.rowStatus.fix.notReady',
        'The agent is not ready for a message yet. Try again in a moment.'
      )
    }
  }
  return {
    ok: false,
    message: translate(
      'fork.rowStatus.fix.failed',
      'Could not send the failing checks to this agent.'
    )
  }
}

/** The prompt for the workspace's GitHub pull request, or a reason there is none to send. */
async function fixPrompt(
  state: AppState,
  worktreeId: string
): Promise<string | { refused: string }> {
  const owner = findWorktreeReviewOwner(state, worktreeId)
  const none = {
    refused: translate(
      'fork.rowStatus.fix.noPr',
      'This workspace has no GitHub pull request to fix.'
    )
  }
  if (!owner) {
    return none
  }
  const { worktree, repo } = owner
  const { branch, hostedReviewCacheKey, prCacheKey } = getWorktreeReviewCacheKeys(
    worktree,
    repo,
    state.settings
  )
  const { prDisplay } = deriveWorktreeCardPrDisplay(
    worktree,
    hostedReviewCacheKey ? state.hostedReviewCache[hostedReviewCacheKey] : undefined,
    prCacheKey ? state.prCache?.[prCacheKey] : undefined
  )
  if (!prDisplay || prDisplay.provider !== 'github' || !prDisplay.url) {
    return none
  }
  const prRepo = 'githubRepository' in prDisplay ? (prDisplay.githubRepository ?? null) : null
  const headSha = 'headSha' in prDisplay ? prDisplay.headSha : undefined
  const scope = { repoId: repo.id, repoOwnerExecutionHostId: getRepoExecutionHostId(repo) }
  const checks = await state.fetchPRChecks(
    repo.path,
    prDisplay.number,
    branch,
    headSha,
    prRepo,
    scope
  )
  if (getBrokenChecks(checks).length === 0) {
    return {
      refused: translate('fork.rowStatus.fix.noneBroken', 'No broken checks to fix.')
    }
  }
  const details = await collectFixChecksPromptDetails(checks, (check) =>
    hasGitHubCheckHandle(check)
      ? state.fetchPRCheckDetails(
          repo.path,
          {
            checkRunId: check.checkRunId,
            workflowRunId: check.workflowRunId,
            checkName: check.name,
            url: check.url,
            prRepo
          },
          scope
        )
      : Promise.resolve(null)
  )
  return buildFixBrokenChecksPrompt({
    reviewKind: 'PR',
    reviewNumber: prDisplay.number,
    reviewTitle: prDisplay.title,
    reviewUrl: prDisplay.url,
    checks,
    checkRunDetailsByCheckKey: details
  })
}

/** The stock switch that hides the Checks panel's AI actions, read now rather than at render. */
function aiActionsOn(state: AppState, worktreeId: string): boolean {
  const owner = findWorktreeReviewOwner(state, worktreeId)
  return resolveSourceControlAiEnabled({ settings: state.settings, repo: owner?.repo ?? null })
}

/** Click handler: send the stock fix-checks prompt to the row's agent and say how it went. */
export async function forkAskAgentToFixChecks(row: ForkFixRow): Promise<boolean> {
  if (!aiActionsOn(useAppStore.getState(), row.tab.worktreeId)) {
    return false
  }
  const before = forkFixTarget(useAppStore.getState(), row)
  if ('refused' in before) {
    toast.error(before.refused)
    return false
  }
  const prompt = await fixPrompt(useAppStore.getState(), row.tab.worktreeId).catch(() => ({
    refused: translate('fork.rowStatus.fix.checksFailed', 'Could not load the pull request checks.')
  }))
  if (typeof prompt !== 'string') {
    toast.error(prompt.refused)
    return false
  }
  // The checks took a moment to load; the agent may have stopped, or the switch gone off.
  if (!aiActionsOn(useAppStore.getState(), row.tab.worktreeId)) {
    return false
  }
  const target = forkFixTarget(useAppStore.getState(), row)
  if ('refused' in target) {
    toast.error(target.refused)
    return false
  }
  const result = await sendMessageToAgent({
    worktreeId: row.tab.worktreeId,
    target: runningAgentMessageTarget(target),
    prompt
  }).catch((): ActiveAgentNotesSendResult => ({ status: 'not-writable' }))
  const notice = forkFixSendNotice(result)
  if (notice.ok) {
    toast.success(notice.message)
  } else {
    toast.error(notice.message)
  }
  return notice.ok
}
