// Command guards (FORK.md, BAD-892): when a bot's agent may remove its own finished workspace with
// `orca worktree rm`. Pure: the host gathers the facts from Orca's own state and git, and this
// decides. Every condition must hold; the first one that does not names why the removal is refused.

export type OwnWorktreeRemovalFacts = {
  /** The bot the calling agent belongs to; null when it belongs to none. */
  callerBot: string | null
  /** The workspace the selector resolved to, or null when Orca could not resolve it. */
  target: { id: string; branch: string } | null
  /** The bot that owns the target workspace (under its home, or made by a worker it started). */
  targetBot: string | null
  /** The calling agent runs in the target workspace itself. */
  callerInsideTarget: boolean
  /** Agents open in the target workspace. */
  agentsRunning: number
  /** `git status --porcelain` printed something; null when git could not be asked. */
  dirty: boolean | null
  deleteBranch: boolean
  /** The branch is contained in the default branch; null when git could not say. */
  branchMerged: boolean | null
}

export type OwnWorktreeRemovalCondition =
  | 'caller-has-no-bot'
  | 'target-unresolved'
  | 'target-not-owned'
  | 'caller-inside-target'
  | 'agent-running'
  | 'uncommitted-changes'
  | 'branch-not-merged'
  | 'timed-out'

export type OwnWorktreeRemovalDecision =
  | { allowed: true; bot: string; reason: string }
  | { allowed: false; failed: OwnWorktreeRemovalCondition; reason: string }

const refuse = (
  failed: OwnWorktreeRemovalCondition,
  reason: string
): OwnWorktreeRemovalDecision => ({ allowed: false, failed, reason })

/** The refusal when the facts could not be gathered in time. */
export const OWN_WORKTREE_REMOVAL_TIMED_OUT: OwnWorktreeRemovalDecision = {
  allowed: false,
  failed: 'timed-out',
  reason:
    'Orca could not check the workspace in time, so it cannot tell the removal is safe. Try again.'
}

export function decideOwnWorktreeRemoval(
  facts: OwnWorktreeRemovalFacts
): OwnWorktreeRemovalDecision {
  const { callerBot, target, targetBot } = facts
  if (callerBot === null) {
    return refuse(
      'caller-has-no-bot',
      'orca worktree rm is allowed only for an agent that belongs to a bot, and this agent belongs to none.'
    )
  }
  if (target === null) {
    return refuse(
      'target-unresolved',
      'Orca could not resolve the workspace this command removes, so it cannot check who owns it.'
    )
  }
  if (targetBot !== callerBot) {
    return refuse(
      'target-not-owned',
      `The workspace is not owned by the bot this agent belongs to (${callerBot}); only a bot's own workspaces may be removed by its agents.`
    )
  }
  if (facts.callerInsideTarget) {
    return refuse(
      'caller-inside-target',
      'This agent runs inside the workspace it is removing. Run the removal from another workspace.'
    )
  }
  if (facts.agentsRunning > 0) {
    return refuse(
      'agent-running',
      `${facts.agentsRunning === 1 ? 'An agent is' : `${facts.agentsRunning} agents are`} still open in the workspace. Close ${facts.agentsRunning === 1 ? 'it' : 'them'} first.`
    )
  }
  if (facts.dirty !== false) {
    return refuse(
      'uncommitted-changes',
      facts.dirty === null
        ? "Orca could not read the workspace's git status, so it cannot tell that nothing is uncommitted."
        : 'The workspace has uncommitted changes (tracked or untracked). Commit or discard them first.'
    )
  }
  if (facts.deleteBranch && facts.branchMerged !== true) {
    return refuse(
      'branch-not-merged',
      `--delete-branch needs the branch ${target.branch} to be merged into the default branch${facts.branchMerged === null ? ', and Orca could not tell' : ', and it is not'}. Remove the workspace without --delete-branch to keep the branch.`
    )
  }
  return {
    allowed: true,
    bot: callerBot,
    reason: `bot ${callerBot} removed its own workspace: no agent running in it, nothing uncommitted${facts.deleteBranch ? ', branch merged into the default branch' : ', branch kept'}`
  }
}
