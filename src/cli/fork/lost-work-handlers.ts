// SLRM-2096 (FORK.md "Lost work"): `orca lost-work`, through the desktop's fork.lostWork.scan RPC.
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  LOST_WORK_RISK_ORDER,
  type LostWorkItem,
  type LostWorkKind,
  type LostWorkNote,
  type LostWorkRisk,
  type LostWorkScanResult
} from '../../shared/fork/lost-work'
import type { LostWorkUse } from '../../shared/fork/lost-work-use'

// BAD-542: a scan of every project takes more than the stock 60 second RPC limit.
const LOST_WORK_SCAN_TIMEOUT_MS = 10 * 60_000

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
  'no-default-branch': 'no default branch found; set one in Settings > Blackfish > Projects',
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

/** SLRM-2230: what holds the workspace open, such as "agent running, 2 chats open". */
export function lostWorkUseText(use: LostWorkUse): string {
  const plural = (count: number, one: string, many: string) =>
    count === 1 ? `1 ${one}` : `${count} ${many}`
  return [
    use.agentRunning ? 'agent running' : '',
    use.openChats ? plural(use.openChats, 'chat open', 'chats open') : '',
    use.sleepingChats ? plural(use.sleepingChats, 'chat asleep', 'chats asleep') : '',
    use.liveTerminals ? plural(use.liveTerminals, 'live terminal', 'live terminals') : '',
    use.active ? 'open now' : ''
  ]
    .filter(Boolean)
    .join(', ')
}

function where(item: LostWorkItem): string {
  if (item.kind === 'stash') {
    return `stash@{${item.stash?.index ?? '?'}} ${item.stash?.message ?? ''}`.trim()
  }
  const branch = item.branch ?? (item.kind === 'branch' ? '' : '(detached)')
  const place = item.path ? `${branch}  ${item.path}` : branch
  return item.inUse ? `${place}  [in use: ${lostWorkUseText(item.inUse)}]` : place
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
      .call<LostWorkScanResult>('fork.lostWork.scan', repo ? { repo } : {}, {
        timeoutMs: LOST_WORK_SCAN_TIMEOUT_MS
      })
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
