// PR babysitter (FORK.md, SLRM-2386): what it asks of GitHub, through stock Orca's own readers and
// its gh runner, in the chat's checkout (so SSH, WSL and per-project gh accounts work as for every
// other PR read). It reads only when a CI line arrived for a babysat pull request, so it adds no
// polling. The one write is `gh pr merge` with the head pinned, never with --admin or --auto.
import type { PRWatchWorkspace } from '../../github/pr-watch/pr-watch-types'
import type { PRCheckDetail, PRCheckRunDetails } from '../../../shared/github/checks/check-types'
import type { GitHubPRMergeMethod } from '../../../shared/github/pull-requests/pull-request-types'
import {
  normalizeGitHubPRMergeMethodSettings,
  resolveGitHubPRMergeMethods
} from '../../../shared/github/pull-requests/merge/pull-request-merge-methods'
import { collectFixChecksPromptDetails } from '../../../shared/source-control/checks/pr-checks-fix-prompt'
import type {
  ForkPrBabysitMergeMethod,
  PrBabysitPr,
  PrBabysitPrFacts
} from '../../../shared/fork/pr-babysit'

export type PrBabysitChecks = {
  checks: PRCheckDetail[]
  details: Record<string, PRCheckRunDetails>
}

export type PrBabysitMergeOutcome = { ok: true } | { ok: false; error: string }

/** The ports the service uses; tests pass fakes, `livePrBabysitGitHub` reaches GitHub. */
export type PrBabysitGitHub = {
  /** The PR's checks at `headSha` and the failed jobs' log tails (stock fix-checks reads). */
  checks: (ws: PRWatchWorkspace, pr: PrBabysitPr, headSha: string) => Promise<PrBabysitChecks>
  facts: (ws: PRWatchWorkspace, pr: PrBabysitPr) => Promise<PrBabysitPrFacts | null>
  merge: (
    ws: PRWatchWorkspace,
    pr: PrBabysitPr,
    method: ForkPrBabysitMergeMethod,
    headSha: string
  ) => Promise<PrBabysitMergeOutcome>
}

/** Runs gh with argv only (no shell) in the chat's checkout; resolves stdout. */
export type PrBabysitGh = (ws: PRWatchWorkspace, pr: PrBabysitPr, args: string[]) => Promise<string>

function repoArg(pr: PrBabysitPr): string {
  return pr.host === 'github.com' ? `${pr.owner}/${pr.repo}` : `${pr.host}/${pr.owner}/${pr.repo}`
}

export const PR_BABYSIT_FACT_FIELDS =
  'state,isDraft,headRefOid,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup'

const GREEN_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

function checkGreen(item: unknown): boolean {
  if (typeof item !== 'object' || item === null) {
    return false
  }
  const row = item as Record<string, unknown>
  // A StatusContext has a state; a CheckRun has a status and, once completed, a conclusion.
  if (typeof row.state === 'string' && row.status === undefined) {
    return row.state.toUpperCase() === 'SUCCESS'
  }
  return (
    String(row.status ?? '').toUpperCase() === 'COMPLETED' &&
    GREEN_CONCLUSIONS.has(String(row.conclusion ?? '').toUpperCase())
  )
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** gh's JSON for one pull request, as merge facts; null when it is not that shape. */
export function parsePrBabysitFacts(stdout: string): PrBabysitPrFacts | null {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const row = data as Record<string, unknown>
  if (typeof row.state !== 'string' || typeof row.headRefOid !== 'string') {
    return null
  }
  return {
    state: row.state,
    isDraft: row.isDraft === true,
    headSha: row.headRefOid,
    reviewDecision: textOrNull(row.reviewDecision),
    mergeable: textOrNull(row.mergeable),
    mergeStateStatus: textOrNull(row.mergeStateStatus),
    checksGreen: Array.isArray(row.statusCheckRollup) ? row.statusCheckRollup.map(checkGreen) : []
  }
}

/** The repository's default method among those it allows (stock's own rule). */
export function parsePrBabysitRepoMethod(stdout: string): GitHubPRMergeMethod {
  let data: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(stdout)
    data = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    data = {}
  }
  const settings = normalizeGitHubPRMergeMethodSettings({
    defaultMethod: data.viewerDefaultMergeMethod,
    mergeCommitAllowed: data.mergeCommitAllowed,
    rebaseMergeAllowed: data.rebaseMergeAllowed,
    squashMergeAllowed: data.squashMergeAllowed
  })
  return resolveGitHubPRMergeMethods(settings).defaultMethod
}

/** The merge argv: a plain `gh pr merge` pinned to the head that was green. */
export function prBabysitMergeArgs(
  pr: PrBabysitPr,
  method: GitHubPRMergeMethod,
  headSha: string
): string[] {
  if (!/^[0-9a-f]{7,64}$/iu.test(headSha)) {
    throw new Error('invalid head commit')
  }
  return [
    'pr',
    'merge',
    String(pr.number),
    '--repo',
    repoArg(pr),
    `--${method}`,
    '--match-head-commit',
    headSha
  ]
}

function failure(error: unknown): string {
  const text =
    typeof error === 'object' && error !== null && 'stderr' in error
      ? String((error as { stderr: unknown }).stderr)
      : error instanceof Error
        ? error.message
        : String(error)
  return text || 'gh failed'
}

/** The GitHub port over a gh runner; stock readers for checks and logs. */
export function prBabysitGitHub(
  gh: PrBabysitGh,
  readChecks: PrBabysitGitHub['checks']
): PrBabysitGitHub {
  return {
    checks: readChecks,
    facts: async (ws, pr) =>
      parsePrBabysitFacts(
        await gh(ws, pr, [
          'pr',
          'view',
          String(pr.number),
          '--repo',
          repoArg(pr),
          '--json',
          PR_BABYSIT_FACT_FIELDS
        ])
      ),
    merge: async (ws, pr, method, headSha) => {
      try {
        const resolved =
          method === 'repo'
            ? parsePrBabysitRepoMethod(
                await gh(ws, pr, [
                  'repo',
                  'view',
                  '--json',
                  'viewerDefaultMergeMethod,mergeCommitAllowed,rebaseMergeAllowed,squashMergeAllowed',
                  '--',
                  repoArg(pr)
                ])
              )
            : method
        await gh(ws, pr, prBabysitMergeArgs(pr, resolved, headSha))
        return { ok: true }
      } catch (error) {
        return { ok: false, error: failure(error) }
      }
    }
  }
}

function localOptions(ws: PRWatchWorkspace): { wslDistro?: string } {
  return ws.wslDistro ? { wslDistro: ws.wslDistro } : {}
}

const livePrRepo = (pr: PrBabysitPr) => ({ owner: pr.owner, repo: pr.repo, host: pr.host })

/** The live gh runner (also the PR nudges'): the chat's checkout, argv only, never prompting. */
export async function livePrGhRunner(): Promise<PrBabysitGh> {
  const [{ ghExecFileAsync }, { resolveGitHubRepoExecution }] = await Promise.all([
    import('../../git/command-runner/hosted-cli/gh-exec-file'),
    import('../../github/repositories/github-api-repository')
  ])
  const prRepo = livePrRepo
  return async (ws, pr, args) => {
    const { ghOptions } = await resolveGitHubRepoExecution(
      ws.repoPath,
      prRepo(pr),
      ws.connectionId,
      localOptions(ws)
    )
    const merge = args[0] === 'pr' && args[1] === 'merge'
    const { stdout } = await ghExecFileAsync(args, {
      ...ghOptions,
      // A merge is never retried: a failed reply can follow a merge that went through.
      ...(merge ? { idempotent: false } : {}),
      env: { ...(ghOptions.env ?? process.env), GH_PROMPT_DISABLED: '1' }
    })
    return stdout
  }
}

/** The live port. Imported lazily by the service so tests never load stock's GitHub client. */
export async function livePrBabysitGitHub(): Promise<PrBabysitGitHub> {
  const [gh, { getPRChecks }, details] = await Promise.all([
    livePrGhRunner(),
    import('../../github/client/check/get-pr-checks'),
    import('../../github/client/check/get-pr-check-details')
  ])
  const prRepo = livePrRepo
  const readChecks: PrBabysitGitHub['checks'] = async (ws, pr, headSha) => {
    const checks = await getPRChecks(
      ws.repoPath,
      pr.number,
      headSha,
      prRepo(pr),
      { noCache: true },
      ws.connectionId,
      localOptions(ws)
    )
    const detailsByKey = await collectFixChecksPromptDetails(checks, (check) =>
      details.getPRCheckDetails(
        ws.repoPath,
        {
          checkRunId: check.checkRunId,
          workflowRunId: check.workflowRunId,
          checkName: check.name,
          url: check.url,
          prRepo: prRepo(pr)
        },
        ws.connectionId,
        localOptions(ws)
      )
    )
    return { checks, details: detailsByKey }
  }
  return prBabysitGitHub(gh, readChecks)
}
