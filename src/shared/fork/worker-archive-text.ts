// Worker archive (FORK.md, BAD-669): the plain-English reason a finished worker's workspace is
// still there, shared by the CLI table. The app words the same reasons through its own i18n.
import type { ForkWorkerArchiveReason, ForkWorkerCleanupRow } from './worker-archive'

export function workerArchiveReasonText(
  reason: ForkWorkerArchiveReason | string,
  row: Pick<ForkWorkerCleanupRow, 'dirtyFiles' | 'unlandedCommits'> = {}
): string {
  switch (reason) {
    case 'running':
      return 'the worker is still running'
    case 'stopped':
      return 'the worker was stopped'
    case 'kept-open':
      return 'kept open'
    case 'taken-over':
      return 'you took the terminal over'
    case 'pinned':
      return 'pinned'
    case 'used-after-done':
      return 'used after the worker finished'
    case 'focused':
      return 'open in a window now'
    case 'not-due':
      return 'waiting for the archive delay'
    case 'uncommitted-changes':
      return row.dirtyFiles
        ? `uncommitted changes (${row.dirtyFiles} files)`
        : 'uncommitted changes'
    case 'unmerged-commits':
      return row.unlandedCommits
        ? `unmerged commits (${row.unlandedCommits} not on a base branch)`
        : 'unmerged commits'
    case 'git-unknown':
      return 'git could not be read'
    case 'remote-project':
      return 'its project runs on another host'
    case 'not-a-git-workspace':
      return 'not a git workspace'
    default:
      return reason
  }
}
