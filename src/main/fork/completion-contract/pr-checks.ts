// Completion contract (BAD-676, FORK.md): `--require-pr-checks`. At the moment the worker reports
// done, the pull request of the workspace's branch must be open, at the commit the workspace has
// checked out (pushed, not just committed), and every required check on that commit green. A check
// still running is "pending", not a failure. Reads go through gh in the workspace, so a push after
// this read is judged by the next report.
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

function result(ok: boolean, output: string, pending = false): ForkDoneCheckResult {
  return {
    check: PR_CHECKS_LABEL,
    ok,
    exitCode: ok ? 0 : 1,
    output,
    durationMs: 0,
    ...(pending ? { pending: true } : {})
  }
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
  let view: Record<string, unknown> | null
  try {
    view = asRecord(
      JSON.parse(
        await port.gh([
          'pr',
          'view',
          branch,
          '--json',
          'number,state,isDraft,headRefOid,statusCheckRollup'
        ])
      )
    )
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return done(
      result(false, `No pull request could be read for branch ${branch}: ${tailLines(reason, 5)}`)
    )
  }
  const head = typeof view?.headRefOid === 'string' ? view.headRefOid : ''
  if (!view || !head) {
    return done(result(false, `No pull request could be read for branch ${branch}.`))
  }
  if (String(view.state).toUpperCase() !== 'OPEN') {
    return done(
      result(false, `Pull request #${String(view.number)} is ${String(view.state)}, not open.`)
    )
  }
  let local = ''
  try {
    local = (await port.git(['rev-parse', 'HEAD'])).trim()
  } catch {
    local = ''
  }
  if (local && local !== head) {
    return done(
      result(
        false,
        `The workspace is at ${local.slice(0, 10)} but pull request #${String(view.number)} is at ${head.slice(0, 10)}. Push your latest commit, then report done again.`
      )
    )
  }
  let lines: CheckLine[] | null = null
  try {
    lines = requiredChecks(
      await port.gh(['pr', 'checks', branch, '--required', '--json', 'name,bucket'])
    )
  } catch (error) {
    lines = requiredChecks(stdoutOfFailure(error))
  }
  // A repository with no required checks (or an older gh) falls back to every check on the commit.
  const scope = lines && lines.length > 0 ? 'required' : 'all'
  const checks = lines && lines.length > 0 ? lines : rollupChecks(view.statusCheckRollup)
  const failed = checks.filter((check) => check.state === 'fail')
  const pending = checks.filter((check) => check.state === 'pending')
  const summary = `Pull request #${String(view.number)} at ${head.slice(0, 10)}, ${scope} checks: ${checks.length - failed.length - pending.length} green, ${failed.length} failed, ${pending.length} running.`
  if (failed.length > 0) {
    return done(
      result(
        false,
        tailLines(`${summary}\nFailed: ${failed.map((c) => c.name).join(', ')}`, outputLines)
      )
    )
  }
  if (pending.length > 0) {
    return done(
      result(
        false,
        tailLines(`${summary}\nRunning: ${pending.map((c) => c.name).join(', ')}`, outputLines),
        true
      )
    )
  }
  return done(result(true, summary))
}
