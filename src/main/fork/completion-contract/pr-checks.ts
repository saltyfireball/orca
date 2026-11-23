// Completion contract (BAD-676, FORK.md): `--require-pr-checks`. At the moment the worker reports
// done, the pull request of the workspace's branch must be open, at the commit the workspace has
// checked out (pushed, not just committed), and every required check on that commit green. A check
// still running is "pending", not a failure. Reads go through gh in the workspace; a push after the
// Task settled is judged by the later-push watch (later-push-watch.ts).
import type { ForkDoneCheckResult } from '../../../shared/fork/completion-contract'
import { tailLines } from '../../../shared/fork/completion-contract'

export const PR_CHECKS_LABEL = 'pr-checks'

/** gh and git in the worker's workspace; each resolves stdout and rejects when the command fails. */
export type PrChecksPort = {
  gh: (args: string[]) => Promise<string>
  git: (args: string[]) => Promise<string>
}

type CheckLine = { name: string; state: 'pass' | 'fail' | 'pending' }

const BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/u
const GREEN = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** The checks of `gh pr view --json statusCheckRollup`, each pass, fail or pending. */
export function rollupChecks(rollup: unknown): CheckLine[] {
  if (!Array.isArray(rollup)) {
    return []
  }
  return rollup.flatMap((item): CheckLine[] => {
    const row = asRecord(item)
    if (!row) {
      return []
    }
    const name = String(row.name ?? row.context ?? 'check')
    // A StatusContext has a state; a CheckRun has a status and, once completed, a conclusion.
    if (typeof row.state === 'string' && row.status === undefined) {
      const state = row.state.toUpperCase()
      return [
        { name, state: state === 'SUCCESS' ? 'pass' : state === 'PENDING' ? 'pending' : 'fail' }
      ]
    }
    if (String(row.status ?? '').toUpperCase() !== 'COMPLETED') {
      return [{ name, state: 'pending' }]
    }
    return [
      { name, state: GREEN.has(String(row.conclusion ?? '').toUpperCase()) ? 'pass' : 'fail' }
    ]
  })
}

/** `gh pr checks --required --json name,bucket`; null when gh gave nothing usable. */
export function requiredChecks(stdout: string): CheckLine[] | null {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(data)) {
    return null
  }
  return data.flatMap((item): CheckLine[] => {
    const row = asRecord(item)
    if (!row) {
      return []
    }
    const bucket = String(row.bucket ?? '').toLowerCase()
    return [
      {
        name: String(row.name ?? 'check'),
        state:
          bucket === 'pass' || bucket === 'skipping'
            ? 'pass'
            : bucket === 'pending'
              ? 'pending'
              : 'fail'
      }
    ]
  })
}

/** gh exits non-zero while checks fail or run; its JSON is still on stdout of the error. */
function stdoutOfFailure(error: unknown): string {
  const out = asRecord(error)?.stdout
  return typeof out === 'string' ? out : ''
}

function result(
  ok: boolean,
  output: string,
  pending = false,
  pr?: { headSha: string; prNumber: number }
): ForkDoneCheckResult {
  return {
    check: PR_CHECKS_LABEL,
    ok,
    exitCode: ok ? 0 : 1,
    output,
    durationMs: 0,
    ...(pending ? { pending: true } : {}),
    ...pr
  }
}

/** A pull request's head and the checks that judge it, as gh reports them now. */
export type PrHeadRead =
  | {
      kind: 'read'
      number: number
      /** OPEN, CLOSED or MERGED. */
      state: string
      head: string
      scope: 'required' | 'all'
      failed: string[]
      pending: string[]
      green: number
    }
  | { kind: 'unreadable'; reason: string }

/** `selector` is the branch name, or the pull request's number once it is known. */
export async function readPrHeadChecks(port: PrChecksPort, selector: string): Promise<PrHeadRead> {
  let view: Record<string, unknown> | null
  try {
    view = asRecord(
      JSON.parse(
        await port.gh([
          'pr',
          'view',
          selector,
          '--json',
          'number,state,isDraft,headRefOid,statusCheckRollup'
        ])
      )
    )
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { kind: 'unreadable', reason: `: ${tailLines(reason, 5)}` }
  }
  const head = typeof view?.headRefOid === 'string' ? view.headRefOid : ''
  if (!view || !head) {
    return { kind: 'unreadable', reason: '' }
  }
  const number = Number(view.number)
  const state = String(view.state).toUpperCase()
  if (state !== 'OPEN') {
    return { kind: 'read', number, state, head, scope: 'all', failed: [], pending: [], green: 0 }
  }
  let lines: CheckLine[] | null = null
  try {
    lines = requiredChecks(
      await port.gh(['pr', 'checks', selector, '--required', '--json', 'name,bucket'])
    )
  } catch (error) {
    lines = requiredChecks(stdoutOfFailure(error))
  }
  // A repository with no required checks (or an older gh) falls back to every check on the commit.
  const scope = lines && lines.length > 0 ? 'required' : 'all'
  const checks = lines && lines.length > 0 ? lines : rollupChecks(view.statusCheckRollup)
  const failed = checks.filter((check) => check.state === 'fail').map((check) => check.name)
  const pending = checks.filter((check) => check.state === 'pending').map((check) => check.name)
  return {
    kind: 'read',
    number,
    state,
    head,
    scope,
    failed,
    pending,
    green: checks.length - failed.length - pending.length
  }
}

/** The pull request check of one read, as a done-check result that names the head it judged. */
export function prReadResult(
  read: Extract<PrHeadRead, { kind: 'read' }>,
  outputLines: number
): ForkDoneCheckResult {
  const pr = { headSha: read.head, prNumber: read.number }
  const summary = `Pull request #${read.number} at ${read.head.slice(0, 10)}, ${read.scope} checks: ${read.green} green, ${read.failed.length} failed, ${read.pending.length} running.`
  if (read.failed.length > 0) {
    return result(
      false,
      tailLines(`${summary}\nFailed: ${read.failed.join(', ')}`, outputLines),
      false,
      pr
    )
  }
  if (read.pending.length > 0) {
    return result(
      false,
      tailLines(`${summary}\nRunning: ${read.pending.join(', ')}`, outputLines),
      true,
      pr
    )
  }
  return result(true, summary, false, pr)
}

export async function evaluatePrChecks(
  port: PrChecksPort,
  branch: string | null,
  outputLines: number
): Promise<ForkDoneCheckResult> {
  const started = Date.now()
  const done = (value: ForkDoneCheckResult): ForkDoneCheckResult => ({
    ...value,
    durationMs: Date.now() - started
  })
  if (!branch || !BRANCH.test(branch)) {
    return done(
      result(false, 'This workspace has no named branch, so there is no pull request to check.')
    )
  }
  const read = await readPrHeadChecks(port, branch)
  if (read.kind === 'unreadable') {
    return done(result(false, `No pull request could be read for branch ${branch}${read.reason}.`))
  }
  if (read.state !== 'OPEN') {
    return done(result(false, `Pull request #${read.number} is ${read.state}, not open.`))
  }
  let local = ''
  try {
    local = (await port.git(['rev-parse', 'HEAD'])).trim()
  } catch {
    local = ''
  }
  if (local && local !== read.head) {
    return done(
      result(
        false,
        `The workspace is at ${local.slice(0, 10)} but pull request #${read.number} is at ${read.head.slice(0, 10)}. Push your latest commit, then report done again.`
      )
    )
  }
  return done(prReadResult(read, outputLines))
}
