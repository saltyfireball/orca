// Worker cleanup (FORK.md) in the renderer: the Undo notice for each sweep, and the mark on a
// finished worker held open by work not yet committed or pushed. Renders nothing while off.
import React, { useEffect, useSyncExternalStore } from 'react'
import { GitCommitHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  ForkWorkerCleanupHeld,
  ForkWorkerCleanupItem,
  ForkWorkerCleanupNotice
} from '../../../../shared/fork/worker-cleanup'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { noticeText } from './worker-cleanup-labels'

let held: ForkWorkerCleanupHeld[] = []
const listeners = new Set<() => void>()

function setHeld(next: ForkWorkerCleanupHeld[]): void {
  held = Array.isArray(next) ? next : []
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function reopenChat(item: ForkWorkerCleanupItem): void {
  if (item.kind !== 'chat-closed') {
    return
  }
  void import('@/lib/agent-session/launch/structured-agent-session-launch-surface').then(
    ({ openStructuredAgentSessionProvisionalTab }) =>
      openStructuredAgentSessionProvisionalTab({
        worktreeId: item.worktreeId,
        executionHostId: LOCAL_EXECUTION_HOST_ID,
        sessionId: item.sessionId,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: main read this from the chat's own record, which only holds TUI agents.
        agent: item.agent as TuiAgent,
        activate: false
      })
  )
}

function showNotice(notice: ForkWorkerCleanupNotice): void {
  const api = window.api.forkWorkerCleanup
  toast(noticeText(notice.items), {
    duration: 15_000,
    action: {
      label: translate('fork.workerCleanup.undo', 'Undo'),
      onClick: () => {
        void api
          ?.undo(notice.id)
          .then((result) => result.reopenChats.forEach(reopenChat))
          .catch(() => undefined)
      }
    }
  })
}

/** Mounted once at the app root: listens for notices and the held list. */
export function ForkWorkerCleanupReporter(): null {
  useEffect(() => {
    const api = window.api.forkWorkerCleanup
    if (!api) {
      return
    }
    const stopNotice = api.onNotice(showNotice)
    const stopHeld = api.onHeld(setHeld)
    void api.readHeld().then(setHeld, () => undefined)
    return () => {
      stopNotice()
      stopHeld()
    }
  }, [])
  return null
}

function heldLabel(reason: ForkWorkerCleanupHeld['reason']): string {
  return reason === 'uncommitted'
    ? translate(
        'fork.workerCleanup.heldUncommitted',
        'Finished, kept open: its worktree has uncommitted changes.'
      )
    : translate(
        'fork.workerCleanup.heldUnpushed',
        'Finished, kept open: its worktree has commits on no remote.'
      )
}

function useHeld(match: (entry: ForkWorkerCleanupHeld) => boolean): ForkWorkerCleanupHeld | null {
  const list = useSyncExternalStore(subscribe, () => held)
  return list.find(match) ?? null
}

function Mark({ entry, size }: { entry: ForkWorkerCleanupHeld; size: string }): React.JSX.Element {
  const label = heldLabel(entry.reason)
  return (
    <span className="mr-1 inline-flex shrink-0" title={label} data-fork-worker-held="">
      <GitCommitHorizontal className={`${size} text-amber-500`} aria-label={label} />
    </span>
  )
}

/** A chat tab's mark, after its title. */
export function ForkWorkerCleanupTabMark({
  sessionId
}: {
  sessionId: string | undefined
}): React.JSX.Element | null {
  const entry = useHeld((item) => sessionId !== undefined && item.sessionId === sessionId)
  return entry ? <Mark entry={entry} size="size-3" /> : null
}

/** A dashboard or worktree card agent row's mark. */
export function ForkWorkerCleanupRowMark({
  agent
}: {
  agent: { paneKey: string }
}): React.JSX.Element | null {
  const entry = useHeld((item) => item.paneKey === agent.paneKey)
  return entry ? <Mark entry={entry} size="size-[13px]" /> : null
}
