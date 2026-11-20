// Worker archive (FORK.md, BAD-669): "Clean up finished workers". Shows what a cleanup would
// remove and what it leaves with the reason, on this machine and every paired server, then runs
// it. A row it leaves for unmerged or uncommitted work offers "Remove anyway", which asks first.
// Mounted once at the app root through ForkRootHosts.
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type {
  ForkWorkerCleanupResult,
  ForkWorkerCleanupRow
} from '../../../../shared/fork/worker-archive'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { runForkWorkerCleanup } from './worker-archive-client'
import { workerArchiveReasonSentence, workerArchiveShortLabel } from './worker-archive-labels'
import {
  openWorkerCleanup,
  readWorkerCleanupRequest,
  subscribeWorkerArchive,
  type WorkerCleanupRequest
} from './worker-archive-store'

type Place = { row: ForkWorkerCleanupRow; target: RuntimeClientTarget }

/** Every row of a result with the host that owns it, so "Remove anyway" reaches that host. */
export function cleanupPlaces(result: ForkWorkerCleanupResult): Place[] {
  return [
    ...result.rows.map((row) => ({ row, target: { kind: 'local' } as RuntimeClientTarget })),
    ...result.servers.flatMap((server) =>
      server.rows.map((row) => ({
        row,
        target: server.environmentId
          ? ({ kind: 'environment', environmentId: server.environmentId } as RuntimeClientTarget)
          : ({ kind: 'local' } as RuntimeClientTarget)
      }))
    )
  ]
}

function titleOf(request: WorkerCleanupRequest, t: Translate): string {
  return request.kind === 'bot'
    ? t('fork.workerArchive.dialog.titleBot', 'Clean up {{name}} finished workers', {
        name: request.botName
      })
    : t('fork.workerArchive.dialog.title', 'Clean up finished workers')
}

function RowLine({ place, children }: { place: Place; children?: React.ReactNode }) {
  const { row } = place
  return (
    <li className="flex min-w-0 items-start gap-2 py-1 text-xs" data-fork-worker-cleanup-row="">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {row.name}
          {row.server ? <span className="text-muted-foreground"> · {row.server}</span> : null}
          {row.botName ? <span className="text-muted-foreground"> · {row.botName}</span> : null}
        </div>
        <div className="truncate text-muted-foreground">{row.branch ?? row.path}</div>
      </div>
      {children}
    </li>
  )
}

function SkippedRow({
  place,
  onRemoved
}: {
  place: Place
  onRemoved: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { row, target } = place
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const remove = (): void => {
    setBusy(true)
    void runForkWorkerCleanup({ only: [row.worktreeId], force: [row.worktreeId] }, target)
      .then((result) => {
        const failed = result.rows.find((entry) => entry.outcome === 'failed')
        if (failed) {
          toast.error(failed.error ?? t('fork.workerArchive.removeFailed', 'Could not remove it.'))
        }
        onRemoved()
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error))
      )
      .finally(() => setBusy(false))
  }
  return (
    <RowLine place={place}>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-muted-foreground" title={workerArchiveReasonSentence(row, t)}>
          {workerArchiveShortLabel(row.reason ?? '', t)}
        </span>
        {row.canForce && !asking ? (
          <Button variant="outline" size="xs" onClick={() => setAsking(true)}>
            {t('fork.workerArchive.removeAnyway', 'Remove anyway')}
          </Button>
        ) : null}
        {asking ? (
          <div className="max-w-64 space-y-1 text-right">
            <p className="text-amber-600">{workerArchiveReasonSentence(row, t)}</p>
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="xs" disabled={busy} onClick={() => setAsking(false)}>
                {t('fork.workerArchive.cancel', 'Cancel')}
              </Button>
              <Button variant="destructive" size="xs" disabled={busy} onClick={remove}>
                {t('fork.workerArchive.confirmRemove', 'Remove workspace')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </RowLine>
  )
}

function Plan({ request }: { request: WorkerCleanupRequest }): React.JSX.Element {
  const t = useTranslate()
  const bot = request.kind === 'bot' ? request.botName : undefined
  const [result, setResult] = useState<ForkWorkerCleanupResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const load = useCallback((): void => {
    setError(null)
    void runForkWorkerCleanup({ dryRun: true, includeRemote: true, ...(bot ? { bot } : {}) })
      .then(setResult)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [bot])
  useEffect(load, [load])
  const places = result ? cleanupPlaces(result) : []
  const removing = places.filter(({ row }) => row.outcome === 'remove')
  const skipped = places.filter(({ row }) => row.outcome !== 'remove')
  const run = (): void => {
    setRunning(true)
    void runForkWorkerCleanup({ dryRun: false, includeRemote: true, ...(bot ? { bot } : {}) })
      .then((done) => {
        const all = cleanupPlaces(done)
        const gone = all.filter(({ row }) => row.outcome === 'remove').length
        const failed = all.filter(({ row }) => row.outcome === 'failed').length
        toast(
          failed > 0
            ? t(
                'fork.workerArchive.doneFailed',
                '{{gone}} removed, {{failed}} failed. Branches were kept.',
                { gone, failed }
              )
            : t('fork.workerArchive.done', '{{count}} removed. Branches were kept.', {
                count: gone
              })
        )
        load()
      })
      .catch((cause: unknown) =>
        toast.error(cause instanceof Error ? cause.message : String(cause))
      )
      .finally(() => setRunning(false))
  }
  return (
    <>
      <div className="scrollbar-sleek max-h-[50vh] space-y-3 overflow-y-auto">
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {!result && !error ? (
          <p className="text-xs text-muted-foreground">
            {t('fork.workerArchive.dialog.loading', 'Checking finished workers…')}
          </p>
        ) : null}
        {result && places.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('fork.workerArchive.dialog.none', 'No finished worker workspaces.')}
          </p>
        ) : null}
        {removing.length > 0 ? (
          <section>
            <h3 className="text-xs font-medium">
              {t('fork.workerArchive.dialog.willRemove', 'Will remove ({{count}})', {
                count: removing.length
              })}
            </h3>
            <ul className="divide-y divide-border/60">
              {removing.map((place) => (
                <RowLine key={`${place.row.server ?? ''}${place.row.worktreeId}`} place={place} />
              ))}
            </ul>
          </section>
        ) : null}
        {skipped.length > 0 ? (
          <section>
            <h3 className="text-xs font-medium">
              {t('fork.workerArchive.dialog.leftAlone', 'Left alone ({{count}})', {
                count: skipped.length
              })}
            </h3>
            <ul className="divide-y divide-border/60">
              {skipped.map((place) => (
                <SkippedRow
                  key={`${place.row.server ?? ''}${place.row.worktreeId}`}
                  place={place}
                  onRemoved={load}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {result?.servers
          .filter((server) => !server.ok)
          .map((server) => (
            <p key={server.name} className="text-xs text-muted-foreground">
              {t('fork.workerArchive.dialog.serverDown', '{{name}} did not answer: {{error}}', {
                name: server.name,
                error: server.error ?? ''
              })}
            </p>
          ))}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => openWorkerCleanup(null)}>
          {t('fork.workerArchive.close', 'Close')}
        </Button>
        <Button disabled={removing.length === 0 || running} onClick={run}>
          {t('fork.workerArchive.dialog.run', 'Remove {{count}} workspaces', {
            count: removing.length
          })}
        </Button>
      </DialogFooter>
    </>
  )
}

/** One workspace's "Remove anyway": the reason in full, then a confirm. */
function Single({
  request
}: {
  request: Extract<WorkerCleanupRequest, { kind: 'workspace' }>
}): React.JSX.Element {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const status = request.status
  const remove = (): void => {
    setBusy(true)
    void runForkWorkerCleanup({ only: [request.worktreeId], force: [request.worktreeId] })
      .then((result) => {
        const failed = result.rows.find((row) => row.outcome === 'failed')
        if (failed) {
          toast.error(failed.error ?? t('fork.workerArchive.removeFailed', 'Could not remove it.'))
        }
        openWorkerCleanup(null)
      })
      .catch((cause: unknown) =>
        toast.error(cause instanceof Error ? cause.message : String(cause))
      )
      .finally(() => setBusy(false))
  }
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {workerArchiveReasonSentence(status, t)}{' '}
        {t('fork.workerArchive.single.branch', 'The git branch is kept.')}
      </p>
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={() => openWorkerCleanup(null)}>
          {t('fork.workerArchive.cancel', 'Cancel')}
        </Button>
        <Button variant="destructive" disabled={busy} onClick={remove}>
          {t('fork.workerArchive.confirmRemove', 'Remove workspace')}
        </Button>
      </DialogFooter>
    </>
  )
}

export function ForkWorkerCleanupDialogHost(): React.JSX.Element | null {
  const t = useTranslate()
  const request = useSyncExternalStore(subscribeWorkerArchive, readWorkerCleanupRequest)
  if (!request) {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : openWorkerCleanup(null))}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {request.kind === 'workspace'
              ? t('fork.workerArchive.single.title', 'Remove {{name}}?', { name: request.name })
              : titleOf(request, t)}
          </DialogTitle>
          <DialogDescription>
            {request.kind === 'workspace'
              ? t(
                  'fork.workerArchive.single.description',
                  'This worker finished, but its workspace holds work that is not on a base branch.'
                )
              : t(
                  'fork.workerArchive.dialog.description',
                  'Removes the workspace of each finished worker like worktree rm: terminals stopped, folder removed, git branch kept. Workspaces with unmerged or uncommitted work, kept open, pinned or in use are left alone.'
                )}
          </DialogDescription>
        </DialogHeader>
        {request.kind === 'workspace' ? <Single request={request} /> : <Plan request={request} />}
      </DialogContent>
    </Dialog>
  )
}
