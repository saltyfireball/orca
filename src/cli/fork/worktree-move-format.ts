// SLRM-2265: the text `orca worktree move` prints.
import { stripWorktreeMoveControlChars as clean } from '../../shared/fork/worktree-move/worktree-move-ref'
import {
  WORKTREE_MOVE_TRANSCRIPTS_NOTICE,
  WORKTREE_MOVE_UNTRACKED_NOTICE,
  worktreeMoveUntrackedNames
} from '../../shared/fork/worktree-move/worktree-move-notice'
import type { WorktreeMoveInspectResult } from '../../shared/fork/worktree-move/worktree-move-wire'
import type { WorktreeMoveRunResult } from '../../shared/fork/worktree-move/worktree-move-runner'

function copyNoticeLines(
  source: Pick<WorktreeMoveInspectResult, 'untracked' | 'untrackedCount'>,
  carryPatch: boolean
): string[] {
  const lines = [WORKTREE_MOVE_TRANSCRIPTS_NOTICE]
  if (carryPatch) {
    lines.push(WORKTREE_MOVE_UNTRACKED_NOTICE)
    const { names, more } = worktreeMoveUntrackedNames(source)
    lines.push(...names.map((name) => `  untracked: ${name}`))
    if (more > 0) {
      lines.push(`  ...and ${more} more untracked file(s)`)
    }
  }
  return lines
}

export function formatWorktreeMoveResult(result: WorktreeMoveRunResult): string {
  if (result.kind === 'refuse' || result.kind === 'ask') {
    return clean(result.plan.message)
  }
  const { plan, source } = result
  const lines: string[] = []
  if (result.kind === 'dry-run') {
    lines.push(clean(`Would move ${source.path} (${plan.branch}) to ${result.targetRepo.repo}.`))
    lines.push(`Steps: ${plan.steps.join(', ')}`)
    for (const chat of plan.chats) {
      lines.push(clean(`  carry chat: ${chat.name} (${chat.agent})`))
    }
    lines.push(...copyNoticeLines(source, plan.carryPatch))
  } else {
    lines.push(
      clean(
        `Moved ${source.path} to ${result.target.path} (${result.target.branch ?? plan.branch}).`
      )
    )
    lines.push(`Pushed: ${result.pushed ? 'yes' : 'no'}`)
    if (result.patch.kind === 'applied') {
      lines.push('Uncommitted changes: applied on the target (still on the source too)')
    }
    for (const chat of result.chats) {
      lines.push(
        clean(
          chat.targetSessionId
            ? `  chat reopened: ${chat.name} -> ${chat.targetSessionId}`
            : `  chat left behind: ${chat.name} (${chat.reason ?? 'not carried'})`
        )
      )
    }
    lines.push(
      result.marked
        ? 'The source workspace is marked as moved. It was not deleted.'
        : 'The source workspace was left as it was.'
    )
  }
  for (const { chat, reason } of result.kind === 'dry-run' ? plan.skippedChats : []) {
    lines.push(clean(`  chat stays: ${chat.name} (${reason})`))
  }
  for (const warning of result.kind === 'moved' ? result.warnings : plan.warnings) {
    lines.push(clean(`Note: ${warning}`))
  }
  return lines.join('\n')
}
