// Best of N (FORK.md, SLRM-2393): the text views of `orca best-of`.
import {
  forkBestOfAgentLabel,
  type ForkBestOfCheckState,
  type ForkBestOfRun
} from '../../shared/fork/best-of/best-of'
import type { ForkBestOfDiffResult } from '../../shared/fork/best-of/best-of-compare'
import type { ForkBestOfAttemptFacts } from '../../shared/fork/best-of/best-of-wire'
import { formatForkTokens } from '../../shared/fork/usage-ledger'
import { formatForkUsd } from '../../shared/fork/usage-report'

function table(rows: string[][]): string {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((cells) => cells[col].length)))
  return rows
    .map((cells) =>
      cells
        .map((cell, col) => cell.padEnd(widths[col]))
        .join('  ')
        .trimEnd()
    )
    .join('\n')
}

function pickedText(run: ForkBestOfRun): string {
  return run.winner === undefined ? 'open' : `picked ${run.winner}`
}

export function formatForkBestOfList(runs: readonly ForkBestOfRun[]): string {
  if (runs.length === 0) {
    return 'No best-of runs yet. Start one with orca best-of <n> --prompt <text>.'
  }
  return table([
    ['ID', 'ATTEMPTS', 'STATE', 'STARTED', 'TASK'],
    ...runs.map((run) => [
      run.id,
      String(run.attempts.length),
      pickedText(run),
      new Date(run.createdAt).toISOString().slice(0, 16).replace('T', ' '),
      run.title
    ])
  ])
}

export function formatForkBestOfStarted(run: ForkBestOfRun): string {
  const failed = run.attempts.filter((attempt) => attempt.startError).length
  return [
    `Best of ${run.attempts.length} started: ${run.id}${failed > 0 ? ` (${failed} did not start)` : ''}`,
    `Compare: orca best-of show ${run.id}, or Best of N in the app's command palette.`
  ].join('\n')
}

const CHECK_WORDS: Record<ForkBestOfCheckState, string> = {
  pass: 'pass',
  fail: 'FAIL',
  'not-run': 'not run',
  unknown: 'not reported'
}

function diffText(result: ForkBestOfDiffResult | undefined): string {
  if (!result || 'pending' in result) {
    return 'no worktree yet'
  }
  if ('error' in result) {
    return `unavailable (${result.error})`
  }
  const { diff } = result
  const uncommitted = diff.uncommitted === null ? '' : `, ${diff.uncommitted} uncommitted file(s)`
  return `${diff.files} file(s) +${diff.added} -${diff.removed} vs ${diff.baseRef}${uncommitted}`
}

function costText(facts: ForkBestOfAttemptFacts): string {
  if (!facts.cost) {
    return 'not counted'
  }
  if (facts.cost.costUsd === null && facts.cost.subscriptionTokens > 0) {
    return `subscription, ${formatForkTokens(facts.cost.totalTokens)} tokens`
  }
  return `${formatForkUsd(facts.cost.costUsd)}${facts.cost.unpricedTokens > 0 ? ' +?' : ''} (estimate), ${formatForkTokens(facts.cost.totalTokens)} tokens`
}

function reportLines(report: string | null): string[] {
  if (!report) {
    return ['   report: none yet']
  }
  const lines = report.trim().split('\n').slice(0, 8)
  return ['   report:', ...lines.map((line) => `     ${line}`)]
}

export function formatForkBestOfShow(
  run: ForkBestOfRun,
  facts: readonly ForkBestOfAttemptFacts[],
  diffs: ReadonlyMap<number, ForkBestOfDiffResult>
): string {
  const lines = [`Best of ${run.attempts.length}: ${run.title} (${run.id})`]
  lines.push(
    run.winner === undefined
      ? `Not picked yet: orca best-of pick ${run.id} --attempt <n>`
      : `Picked attempt ${run.winner}; the others: ${run.loserAction ?? 'archive'}`
  )
  for (const attempt of run.attempts) {
    const fact = facts.find((entry) => entry.index === attempt.index)
    const host = fact?.hostLabel ?? (attempt.host === 'here' ? 'this machine' : attempt.host)
    const state = fact?.taskStatus ?? fact?.workerState ?? (attempt.startError ? 'failed' : '?')
    const outcome = attempt.outcome
      ? ` -> ${attempt.outcome.kind}${attempt.outcome.message ? ` (${attempt.outcome.message})` : ''}`
      : ''
    lines.push('')
    lines.push(`#${attempt.index} ${forkBestOfAgentLabel(attempt)} on ${host} [${state}]${outcome}`)
    if (fact?.workerError) {
      lines.push(`   error: ${fact.workerError}`)
    }
    lines.push(`   diff: ${diffText(diffs.get(attempt.index))}`)
    if (fact) {
      lines.push(
        `   tests ${CHECK_WORDS[fact.checks.tests]}, checks ${CHECK_WORDS[fact.checks.checks]}; cost ${costText(fact)}`
      )
      lines.push(...reportLines(fact.report))
    }
  }
  return lines.join('\n')
}
