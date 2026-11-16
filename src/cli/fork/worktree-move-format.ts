// SLRM-2265: the text `orca worktree move` prints.
import type { WorktreeMoveRunResult } from '../../shared/fork/worktree-move/worktree-move-runner'

export function formatWorktreeMoveResult(result: WorktreeMoveRunResult): string {
  if (result.kind === 'refuse' || result.kind === 'ask') {
    return result.plan.message
  }
  const { plan, source } = result
  const lines: string[] = []
  if (result.kind === 'dry-run') {
    lines.push(`Would move ${source.path} (${plan.branch}) to ${result.targetRepo.repo}.`)
    lines.push(`Steps: ${plan.steps.join(', ')}`)
    for (const chat of plan.chats) {
      lines.push(`  carry chat: ${chat.name} (${chat.agent})`)
    }
  } else {
    lines.push(
      `Moved ${source.path} to ${result.target.path} (${result.target.branch ?? plan.branch}).`
    )
    lines.push(`Pushed: ${result.pushed ? 'yes' : 'no'}`)
    if (result.patch.kind === 'applied') {
      lines.push('Uncommitted changes: applied on the target (still on the source too)')
    }
    for (const chat of result.chats) {
      lines.push(
        chat.targetSessionId
          ? `  chat reopened: ${chat.name} -> ${chat.targetSessionId}`
          : `  chat left behind: ${chat.name} (${chat.reason ?? 'not carried'})`
      )
    }
    lines.push(
      result.marked
        ? 'The source workspace is marked as moved. It was not deleted.'
        : 'The source workspace was left as it was.'
    )
  }
  for (const { chat, reason } of result.kind === 'dry-run' ? plan.skippedChats : []) {
    lines.push(`  chat stays: ${chat.name} (${reason})`)
  }
  for (const warning of result.kind === 'moved' ? result.warnings : plan.warnings) {
    lines.push(`Note: ${warning}`)
  }
  return lines.join('\n')
}
