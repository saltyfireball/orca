// Worker archive (FORK.md, BAD-669): the words for why a finished worker's workspace is still there.
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import type {
  ForkWorkerArchiveReason,
  ForkWorkerCleanupRow
} from '../../../../shared/fork/worker-archive'

/** A few words for the sidebar row. */
export function workerArchiveShortLabel(
  reason: ForkWorkerArchiveReason | string,
  t: Translate = translate
): string {
  switch (reason) {
    case 'unmerged-commits':
      return t('fork.workerArchive.short.unmerged', 'unmerged commits')
    case 'uncommitted-changes':
      return t('fork.workerArchive.short.uncommitted', 'uncommitted changes')
    case 'git-unknown':
      return t('fork.workerArchive.short.gitUnknown', 'git unreadable')
    case 'kept-open':
      return t('fork.workerArchive.short.kept', 'kept open')
    case 'pinned':
      return t('fork.workerArchive.short.pinned', 'pinned')
    case 'focused':
      return t('fork.workerArchive.short.focused', 'in use')
    case 'used-after-done':
      return t('fork.workerArchive.short.used', 'used after done')
    case 'taken-over':
      return t('fork.workerArchive.short.takenOver', 'taken over')
    case 'not-due':
      return t('fork.workerArchive.short.notDue', 'waiting')
    case 'running':
      return t('fork.workerArchive.short.running', 'running')
    case 'stopped':
      return t('fork.workerArchive.short.stopped', 'stopped')
    case 'remote-project':
      return t('fork.workerArchive.short.remote', 'other host')
    case 'not-a-git-workspace':
      return t('fork.workerArchive.short.notGit', 'not git')
    default:
      return String(reason)
  }
}

/** A sentence for the dialog and the tooltip. */
export function workerArchiveReasonSentence(
  row: Pick<ForkWorkerCleanupRow, 'reason' | 'dirtyFiles' | 'unlandedCommits'>,
  t: Translate = translate
): string {
  switch (row.reason) {
    case 'unmerged-commits':
      return t(
        'fork.workerArchive.reason.unmerged',
        '{{count}} commits are on no base branch yet. Removing the folder keeps the branch.',
        { count: row.unlandedCommits ?? 0 }
      )
    case 'uncommitted-changes':
      return t(
        'fork.workerArchive.reason.uncommitted',
        '{{count}} files have uncommitted or untracked changes that removing the folder would lose.',
        { count: row.dirtyFiles ?? 0 }
      )
    case 'git-unknown':
      return t('fork.workerArchive.reason.gitUnknown', 'Git could not be read in this folder.')
    case 'kept-open':
      return t('fork.workerArchive.reason.kept', 'You kept this worker open.')
    case 'pinned':
      return t('fork.workerArchive.reason.pinned', 'The workspace is pinned.')
    case 'focused':
      return t('fork.workerArchive.reason.focused', 'The workspace is open in a window.')
    case 'used-after-done':
      return t(
        'fork.workerArchive.reason.used',
        'It was used after the worker finished, so it stays for you.'
      )
    case 'taken-over':
      return t('fork.workerArchive.reason.takenOver', 'You took its terminal over.')
    case 'not-due':
      return t(
        'fork.workerArchive.reason.notDue',
        'It is archived on its own once the archive delay has passed.'
      )
    case 'running':
      return t('fork.workerArchive.reason.running', 'The worker is still running.')
    case 'stopped':
      return t('fork.workerArchive.reason.stopped', 'The worker was stopped.')
    case 'remote-project':
      return t('fork.workerArchive.reason.remote', 'Its project runs on another host.')
    case 'not-a-git-workspace':
      return t('fork.workerArchive.reason.notGit', 'It is not a git workspace.')
    default:
      return ''
  }
}
