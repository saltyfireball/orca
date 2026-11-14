// SLRM-2096 (FORK.md "Lost work"): `orca lost-work`, through the desktop's fork.lostWork.scan RPC.
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  LOST_WORK_RISK_ORDER,
  type LostWorkItem,
  type LostWorkKind,
  type LostWorkNote,
  type LostWorkRisk,
  type LostWorkScanResult
} from '../../shared/fork/lost-work'

const RISK: Record<LostWorkRisk, string> = {
  'would-lose-work': 'would lose work',
  'needs-look': 'needs a look',
  safe: 'safe to remove'
}

const KIND: Record<LostWorkKind, string> = {
  worktree: 'worktree',
  'untracked-worktree': 'untracked worktree',
  'missing-folder': 'missing folder',
  branch: 'branch',
  stash: 'stash'
}

const NOTE: Record<LostWorkNote['code'], string> = {
  'remote-project': 'skipped: runs on another host',
  'folder-project': 'skipped: not a git project',
  'no-default-branch': 'no default branch found; set one in Settings > Advanced > Lost work',
  'git-error': 'git failed',
  'pull-requests-unavailable':
    'pull requests not read (GitHub CLI missing, signed out or out of time)',
  'shared-repository': 'same repository, listed under'
}

function count(value: number | null): string {
  return value === null ? '?' : String(value)
}

function day(ms: number | null): string {
  return ms === null ? '-' : new Date(ms).toISOString().slice(0, 10)
}

function where(item: LostWorkItem): string {
  if (item.kind === 'stash') {
    return `stash@{${item.stash?.index ?? '?'}} ${item.stash?.message ?? ''}`.trim()
  }
  const branch = item.branch ?? (item.kind === 'branch' ? '' : '(detached)')
  return item.path ? `${branch}  ${item.path}` : branch
}

function commits(item: LostWorkItem): string {
  if (item.kind === 'stash') {
    return '-'
  }
  const unpushed = item.unpushedCommits ? ` (${item.unpushedCommits} unpushed)` : ''
  return `${count(item.unmergedCommits)}${unpushed}`
}

function pullRequest(item: LostWorkItem): string {
  return item.pullRequest ? `#${item.pullRequest.number} ${item.pullRequest.state}` : '-'
}

export function sortLostWork(items: readonly LostWorkItem[]): LostWorkItem[] {
  return [...items].sort(
    (a, b) =>
      LOST_WORK_RISK_ORDER.indexOf(a.risk) - LOST_WORK_RISK_ORDER.indexOf(b.risk) ||
      a.repoName.localeCompare(b.repoName) ||
      (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0)
  )
}

export function formatLostWork(result: LostWorkScanResult): string {
  const lines: string[] = []
  if (result.items.length === 0) {
    lines.push('No lost work found.')
  } else {
    const rows = [
      ['RISK', 'KIND', 'PROJECT', 'COMMITS', 'DIRTY', 'LAST COMMIT', 'PR', 'BRANCH / PATH'],
      ...sortLostWork(result.items).map((item) => [
        RISK[item.risk],
        KIND[item.kind],
        item.repoName,
        commits(item),
        item.kind === 'branch' || item.kind === 'stash' ? '-' : count(item.dirtyFiles),
        day(item.lastCommitAt),
        pullRequest(item),
        where(item)
      ])
    ]
    const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => row[col].length)))
    for (const row of rows) {
      lines.push(
        row
          .map((cell, col) => (col === row.length - 1 ? cell : cell.padEnd(widths[col])))
          .join('  ')
      )
    }
  }
  for (const note of result.notes) {
    const detail = note.detail ? `: ${note.detail}` : ''
    lines.push(`Note: ${note.repoName}: ${NOTE[note.code]}${detail}`)
  }
  return lines.join('\n')
}

export const FORK_LOST_WORK_HANDLERS: Record<string, CommandHandler> = {
  'lost-work': async (ctx) => {
    const repo = getOptionalStringFlag(ctx.flags, 'repo')
    const result = await ctx.client
      .call<LostWorkScanResult>('fork.lostWork.scan', repo ? { repo } : {})
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host has no lost work scan. Update the desktop app and try again.'
          )
        }
        throw error
      })
    printResult(result, ctx.json, formatLostWork)
  }
}
