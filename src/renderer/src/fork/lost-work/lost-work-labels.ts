// SLRM-2096 (FORK.md "Lost work"): the words the Lost work dialog shows for risks, kinds, reasons
// and per-project notes.
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import type {
  LostWorkItem,
  LostWorkKind,
  LostWorkNote,
  LostWorkReason,
  LostWorkRisk
} from '../../../../shared/fork/lost-work'
import type { LostWorkUse } from '../../../../shared/fork/lost-work-use'

export function lostWorkRiskLabel(risk: LostWorkRisk, t: Translate = translate): string {
  switch (risk) {
    case 'would-lose-work':
      return t('fork.lostWork.risk.wouldLose', 'Would lose work')
    case 'needs-look':
      return t('fork.lostWork.risk.needsLook', 'Needs a look')
    case 'safe':
      return t('fork.lostWork.risk.safe', 'Safe to remove')
  }
}

export function lostWorkKindLabel(kind: LostWorkKind): string {
  switch (kind) {
    case 'worktree':
      return translate('fork.lostWork.kind.worktree', 'Workspace')
    case 'untracked-worktree':
      return translate('fork.lostWork.kind.untracked', 'Worktree Orca does not track')
    case 'missing-folder':
      return translate('fork.lostWork.kind.missing', 'Folder is gone')
    case 'branch':
      return translate('fork.lostWork.kind.branch', 'Branch without a worktree')
    case 'stash':
      return translate('fork.lostWork.kind.stash', 'Stash')
  }
}

function reasonLabel(reason: LostWorkReason, item: LostWorkItem): string | null {
  switch (reason) {
    case 'unmerged-commits':
      return translate('fork.lostWork.reason.unmerged', '{{count}} unmerged commits', {
        count: item.unmergedCommits ?? 0
      })
    case 'unpushed-commits':
      return translate('fork.lostWork.reason.unpushed', '{{count}} commits on no remote', {
        count: item.unpushedCommits ?? 0
      })
    case 'dirty-files':
      return translate('fork.lostWork.reason.dirty', '{{count}} uncommitted files', {
        count: item.dirtyFiles ?? 0
      })
    case 'merged':
      return translate('fork.lostWork.reason.merged', 'Merged')
    case 'squash-merged':
      return translate('fork.lostWork.reason.squashMerged', 'Squash-merged')
    case 'pr-merged':
      return translate('fork.lostWork.reason.prMerged', 'Pull request merged')
    case 'pr-closed':
      return translate('fork.lostWork.reason.prClosed', 'Pull request closed')
    case 'pr-open':
      return translate('fork.lostWork.reason.prOpen', 'Pull request open')
    case 'not-tracked':
      return translate('fork.lostWork.reason.notTracked', 'Not in Orca')
    case 'folder-missing':
      return translate('fork.lostWork.reason.folderMissing', 'Folder missing')
    case 'detached-head':
      return translate('fork.lostWork.reason.detached', 'Detached HEAD')
    case 'stash':
      return null
    case 'unknown-base':
      return translate('fork.lostWork.reason.unknownBase', 'No default branch to compare with')
  }
}

export function lostWorkReasons(item: LostWorkItem): string[] {
  return item.reasons
    .map((reason) => reasonLabel(reason, item))
    .filter((label): label is string => label !== null)
}

export function lostWorkNoteLabel(note: LostWorkNote, t: Translate = translate): string {
  switch (note.code) {
    case 'remote-project':
      return t('fork.lostWork.note.remote', 'Skipped: runs on another host.')
    case 'folder-project':
      return t('fork.lostWork.note.folder', 'Skipped: not a git project.')
    case 'no-default-branch':
      return t(
        'fork.lostWork.note.noBase',
        'No default branch found. Set one in Settings > Blackfish > Projects.'
      )
    case 'git-error':
      return t('fork.lostWork.note.gitError', 'Git failed: {{detail}}', {
        detail: note.detail ?? ''
      })
    case 'pull-requests-unavailable':
      return t(
        'fork.lostWork.note.noPullRequests',
        'Pull requests not read: the GitHub CLI is missing or signed out.'
      )
    case 'shared-repository':
      return t(
        'fork.lostWork.note.sharedRepository',
        'Same repository as {{name}}: its branches and stashes are listed there.',
        { name: note.detail ?? '' }
      )
  }
}

export function lostWorkTitle(item: LostWorkItem, t: Translate = translate): string {
  if (item.kind === 'stash') {
    return item.stash?.message || t('fork.lostWork.stashTitle', 'Stash')
  }
  return item.branch || t('fork.lostWork.detachedTitle', 'Detached HEAD')
}

/** SLRM-2230: what holds a workspace open, such as "In use: agent running, 2 chats open". */
export function lostWorkUseLabel(use: LostWorkUse, t: Translate = translate): string {
  const parts: string[] = []
  if (use.agentRunning) {
    parts.push(t('fork.lostWork.use.agent', 'agent running'))
  }
  if (use.openChats === 1) {
    parts.push(t('fork.lostWork.use.chat', '1 chat open'))
  } else if (use.openChats > 1) {
    parts.push(t('fork.lostWork.use.chats', '{{count}} chats open', { count: use.openChats }))
  }
  if (use.sleepingChats === 1) {
    parts.push(t('fork.lostWork.use.sleeping', '1 chat asleep'))
  } else if (use.sleepingChats > 1) {
    parts.push(
      t('fork.lostWork.use.sleepingMany', '{{count}} chats asleep', { count: use.sleepingChats })
    )
  }
  if (use.liveTerminals === 1) {
    parts.push(t('fork.lostWork.use.terminal', '1 live terminal'))
  } else if (use.liveTerminals > 1) {
    parts.push(
      t('fork.lostWork.use.terminals', '{{count}} live terminals', { count: use.liveTerminals })
    )
  }
  if (parts.length === 0) {
    return t('fork.lostWork.use.openNow', 'Open now')
  }
  if (use.active) {
    parts.push(t('fork.lostWork.use.onScreen', 'open now'))
  }
  return t('fork.lostWork.use.inUse', 'In use: {{what}}', { what: parts.join(', ') })
}

/** SLRM-2230: one line saying what a filter's rows are and what to do with them. */
export function lostWorkFilterHint(filter: 'all' | LostWorkRisk, t: Translate = translate): string {
  switch (filter) {
    case 'all':
      return t(
        'fork.lostWork.hint.all',
        'Each row leads with its suggested next step. Tick rows, a project or everything shown to act on many at once; rows in use are ticked only by hand.'
      )
    case 'safe':
      return t(
        'fork.lostWork.hint.safe',
        'Merged, or the folder is already gone: nothing here exists only on this machine. These can be deleted.'
      )
    case 'needs-look':
      return t(
        'fork.lostWork.hint.needsLook',
        'Commits that are not merged but are on a remote, an open pull request, or a workspace in use. Open the pull request or the workspace and decide.'
      )
    case 'would-lose-work':
      return t(
        'fork.lostWork.hint.wouldLose',
        'Commits on no remote, uncommitted files, or a stash. Push or save these before you delete anything.'
      )
  }
}
