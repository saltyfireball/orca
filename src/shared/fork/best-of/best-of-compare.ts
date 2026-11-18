// Best of N (FORK.md, SLRM-2393): the diff of each attempt and the pick, run from the CLI or the
// window over the stock RPC of the host that owns each worktree (git.branchCompare, git.status,
// worktree.archive, worktree.rm). Nothing here reaches a host by itself: `call` does.
import type {
  GitBranchChangeEntry,
  GitBranchCompareResult,
  GitBranchCompareSummary
} from '../../git/diff/git-diff-compare-types'
import type { ForkBestOfAttemptOutcome, ForkBestOfLoserAction, ForkBestOfRun } from './best-of'
import type { ForkBestOfAttemptFacts, ForkBestOfShowResult } from './best-of-wire'

/** One RPC call: environmentId null is this machine's Orca, else that paired server. */
export type ForkBestOfCall = (
  environmentId: string | null,
  method: string,
  params: Record<string, unknown>
) => Promise<unknown>

export type ForkBestOfDiff = {
  baseRef: string
  files: number
  added: number
  removed: number
  entries: GitBranchChangeEntry[]
  summary: GitBranchCompareSummary
  /** Changed files not yet committed; null when status could not be read. */
  uncommitted: number | null
}

export type ForkBestOfDiffResult = { diff: ForkBestOfDiff } | { error: string } | { pending: true }

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function worktreeSelector(worktreeId: string): string {
  return `id:${worktreeId}`
}

/** The worktree's create base, then the run's --base-branch, then origin/HEAD. */
async function baseRefOf(
  call: ForkBestOfCall,
  facts: ForkBestOfAttemptFacts,
  run: Pick<ForkBestOfRun, 'baseBranch'>
): Promise<string> {
  try {
    const shown = (await call(facts.environmentId, 'worktree.show', {
      worktree: worktreeSelector(facts.worktreeId ?? '')
    })) as { worktree?: { baseRef?: unknown } }
    const baseRef = shown.worktree?.baseRef
    if (typeof baseRef === 'string' && baseRef.length > 0) {
      return baseRef
    }
  } catch {
    // An older host or a gone worktree: the compare below says what is wrong.
  }
  return run.baseBranch ?? 'origin/HEAD'
}

/** The committed changes of one attempt against its base, plus its uncommitted file count. */
export async function readForkBestOfDiff(
  call: ForkBestOfCall,
  facts: ForkBestOfAttemptFacts,
  run: Pick<ForkBestOfRun, 'baseBranch'>
): Promise<ForkBestOfDiffResult> {
  if (!facts.worktreeId) {
    return { pending: true }
  }
  const worktree = worktreeSelector(facts.worktreeId)
  try {
    const baseRef = await baseRefOf(call, facts, run)
    const compare = (await call(facts.environmentId, 'git.branchCompare', {
      worktree,
      baseRef
    })) as GitBranchCompareResult
    if (compare.summary.status !== 'ready') {
      return { error: compare.summary.errorMessage ?? `Compare against ${baseRef} failed.` }
    }
    let uncommitted: number | null = null
    try {
      const status = (await call(facts.environmentId, 'git.status', { worktree })) as {
        entries?: unknown[]
      }
      uncommitted = Array.isArray(status.entries) ? status.entries.length : null
    } catch {
      uncommitted = null
    }
    return {
      diff: {
        baseRef,
        files: compare.entries.length,
        added: compare.entries.reduce((sum, entry) => sum + (entry.added ?? 0), 0),
        removed: compare.entries.reduce((sum, entry) => sum + (entry.removed ?? 0), 0),
        entries: compare.entries,
        summary: compare.summary,
        uncommitted
      }
    }
  } catch (error) {
    return { error: message(error) }
  }
}

export type ForkBestOfSettleResult = {
  outcomes: { index: number; outcome: ForkBestOfAttemptOutcome }[]
}

async function settleLoser(
  call: ForkBestOfCall,
  facts: ForkBestOfAttemptFacts | undefined,
  action: ForkBestOfLoserAction
): Promise<ForkBestOfAttemptOutcome> {
  if (!facts?.worktreeId) {
    return { kind: 'left', message: 'It has no worktree.' }
  }
  if (action === 'keep') {
    return { kind: 'left' }
  }
  const worktree = worktreeSelector(facts.worktreeId)
  try {
    if (action === 'archive') {
      await call(facts.environmentId, 'worktree.archive', { worktree })
      return { kind: 'archived' }
    }
    // Never forced and the branch stays: Git's own dirty-checkout refusal is the last guard.
    await call(facts.environmentId, 'worktree.rm', { worktree, deleteBranch: false })
    return { kind: 'removed' }
  } catch (error) {
    return { kind: 'failed', message: message(error) }
  }
}

/**
 * Keeps the winner and archives (or removes, or leaves) every other attempt's worktree, each on
 * the host that owns it, then records the outcome on this machine's Orca. One loser failing does
 * not stop the others; its failure is recorded with it.
 */
export async function settleForkBestOf(args: {
  call: ForkBestOfCall
  shown: ForkBestOfShowResult
  winner: number
  loserAction: ForkBestOfLoserAction
}): Promise<ForkBestOfSettleResult> {
  const { call, shown, winner, loserAction } = args
  if (!shown.run.attempts.some((attempt) => attempt.index === winner)) {
    throw new Error(`Attempt ${winner} is not in this run (1 to ${shown.run.attempts.length}).`)
  }
  if (shown.run.winner !== undefined) {
    throw new Error(`Attempt ${shown.run.winner} was already picked for this run.`)
  }
  const outcomes: ForkBestOfSettleResult['outcomes'] = []
  for (const attempt of shown.run.attempts) {
    const facts = shown.facts.find((entry) => entry.index === attempt.index)
    outcomes.push({
      index: attempt.index,
      outcome:
        attempt.index === winner ? { kind: 'kept' } : await settleLoser(call, facts, loserAction)
    })
  }
  await call(null, 'fork.bestOf.settle', {
    id: shown.run.id,
    winner,
    loserAction,
    outcomes
  })
  return { outcomes }
}
