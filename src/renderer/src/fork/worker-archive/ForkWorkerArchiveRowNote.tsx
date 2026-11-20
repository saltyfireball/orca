// Worker archive (FORK.md, BAD-669): the mark on a finished worker's workspace row that says why
// it is still there, with "Remove anyway" behind a confirm for work removal would lose.
import React, { useSyncExternalStore } from 'react'
import { ArchiveX } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { workerArchiveReasonSentence, workerArchiveShortLabel } from './worker-archive-labels'
import {
  openWorkerCleanup,
  subscribeWorkerArchive,
  workerArchiveStatusOf
} from './worker-archive-store'

/** Reasons worth a mark: waiting out the delay is the normal state and shows nothing. */
const QUIET = new Set(['not-due', 'running', 'remote-project', 'not-a-git-workspace'])

export function ForkWorkerArchiveRowNote({
  worktreeId,
  name
}: {
  worktreeId: string
  name: string
}): React.JSX.Element | null {
  const t = useTranslate()
  const status = useSyncExternalStore(subscribeWorkerArchive, () =>
    workerArchiveStatusOf(worktreeId)
  )
  if (!status || QUIET.has(status.reason)) {
    return null
  }
  const sentence = workerArchiveReasonSentence(status, t)
  const label = t('fork.workerArchive.row', 'Finished, kept: {{reason}}', {
    reason: workerArchiveShortLabel(status.reason, t)
  })
  const body = (
    <>
      <ArchiveX className="size-3" aria-hidden />
      <span className="truncate">{workerArchiveShortLabel(status.reason, t)}</span>
    </>
  )
  const className =
    'inline-flex max-w-28 shrink-0 items-center gap-0.5 rounded px-1 text-[10px] leading-4 text-amber-600'
  return status.canForce ? (
    <button
      type="button"
      className={`${className} hover:bg-amber-500/10`}
      title={`${label}. ${sentence} ${t('fork.workerArchive.row.click', 'Click to remove anyway.')}`}
      data-fork-worker-archive-note=""
      onClick={(event) => {
        event.stopPropagation()
        openWorkerCleanup({ kind: 'workspace', worktreeId, name, status })
      }}
    >
      {body}
    </button>
  ) : (
    <span className={className} title={`${label}. ${sentence}`} data-fork-worker-archive-note="">
      {body}
    </span>
  )
}
