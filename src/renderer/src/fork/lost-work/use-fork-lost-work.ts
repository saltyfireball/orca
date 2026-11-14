// SLRM-2096 (FORK.md "Lost work"): the Lost work dialog's state. A scan runs only when asked; each
// action runs item by item and the list is scanned again after anything that changes git.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
import type {
  LostWorkActionResult,
  LostWorkItem,
  LostWorkScanResult
} from '../../../../shared/fork/lost-work'
import {
  actOnLostWork,
  chooseArchiveFolder,
  deleteLostWork,
  openLostWorkWorkspace
} from './lost-work-actions'
import type { LostWorkRowAction } from './lost-work-row-actions'
import {
  nextLostWorkDeleteStage,
  type LostWorkBulkAction,
  type LostWorkBulkSummary,
  type LostWorkDeleteStage
} from './lost-work-bulk'
import { lostWorkTitle, lostWorkUseLabel } from './lost-work-labels'
import { withLostWorkUseNow } from './use-lost-work-use'
import { mergeLostWorkProgress, type LostWorkProgressLine } from './lost-work-progress'

/**
 * A delete waits here: `confirm` for every delete, `in-use` when a workspace has chats, agents or
 * terminals (SLRM-2230), `loss` when any item would lose work.
 */
export type LostWorkPendingDelete = { items: LostWorkItem[]; stage: LostWorkDeleteStage }

let scanCounter = 0

function nextScanId(): string {
  scanCounter += 1
  return `lost-work-${Date.now()}-${scanCounter}`
}

/** Runs `run` on each item in turn; a rejected run counts as a failure, so this never throws. */
async function runItems(
  items: readonly LostWorkItem[],
  run: (item: LostWorkItem) => Promise<LostWorkActionResult>
): Promise<{ failures: { name: string; reason: string }[]; files: string[] }> {
  const failures: { name: string; reason: string }[] = []
  const files: string[] = []
  for (const item of items) {
    const outcome = await run(item).catch((error: unknown): LostWorkActionResult => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }))
    if (outcome.ok) {
      files.push(...(outcome.files ?? []))
    } else {
      failures.push({ name: `${item.repoName}: ${lostWorkTitle(item)}`, reason: outcome.error })
    }
  }
  return { failures, files }
}

function toastOutcome(
  failures: readonly { name: string; reason: string }[],
  files: readonly string[]
): void {
  if (failures.length > 0) {
    toast.error(
      translate('fork.lostWork.someFailed', '{{count}} of the items failed', {
        count: failures.length
      }),
      { description: failures.map(({ name, reason }) => `${name}: ${reason}`).join('\n') }
    )
  } else if (files.length > 0) {
    toast.success(
      translate('fork.lostWork.saved', 'Saved {{count}} files', { count: files.length }),
      { description: files.slice(0, 5).join('\n') }
    )
  } else {
    toast.success(translate('fork.lostWork.done', 'Done'))
  }
}

/** Scans once. Resolves with the result, or null after a failure (toasted unless a cancel). */
async function scanOnce(
  lostWork: NonNullable<typeof window.api.forkLostWork>,
  id: string,
  isCurrent: () => boolean
): Promise<LostWorkScanResult | null> {
  try {
    return await lostWork.scan({ scanId: id })
  } catch (error) {
    if (isCurrent()) {
      // A cancel rejects the scan; only a real failure is worth a toast.
      const message = error instanceof Error ? error.message : String(error)
      if (!/cancel/i.test(message)) {
        toast.error(translate('fork.lostWork.scanFailed', 'Lost work scan failed'), {
          description: message
        })
      }
    }
    return null
  }
}

export function useForkLostWork() {
  const [result, setResult] = useState<LostWorkScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<LostWorkProgressLine | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<LostWorkPendingDelete | null>(null)
  const [summary, setSummary] = useState<LostWorkBulkSummary | null>(null)
  const scanId = useRef<string | null>(null)

  const scan = useCallback(async () => {
    const lostWork = window.api.forkLostWork
    if (!lostWork) {
      return
    }
    const id = nextScanId()
    scanId.current = id
    setScanning(true)
    setProgress(null)
    // SLRM-2175: rows arrive as each repository finishes, not when the whole scan ends.
    const unsubscribe = lostWork.onScanProgress((event) => {
      if (event.scanId !== id || scanId.current !== id) {
        return
      }
      setProgress({ done: event.done, total: event.total, current: event.current })
      const { finished } = event
      if (finished) {
        setResult((current) => mergeLostWorkProgress(current, finished, Date.now()))
      }
    })
    const next = await scanOnce(lostWork, id, () => scanId.current === id)
    unsubscribe()
    if (scanId.current === id) {
      if (next) {
        setResult(next)
        setSelected(
          (current) => new Set(next.items.filter((i) => current.has(i.id)).map((i) => i.id))
        )
      }
      scanId.current = null
      setScanning(false)
    }
  }, [])

  const cancel = useCallback(() => {
    const id = scanId.current
    if (id) {
      scanId.current = null
      setScanning(false)
      void window.api.forkLostWork?.cancel(id)
    }
  }, [])

  // Closing the dialog stops a running scan.
  useEffect(() => cancel, [cancel])

  const runEach = useCallback(
    async (
      items: readonly LostWorkItem[],
      run: (item: LostWorkItem) => Promise<LostWorkActionResult>,
      rescan: boolean,
      action: LostWorkBulkAction
    ) => {
      setBusy(true)
      setSummary(null)
      const { failures, files } = await runItems(items, run)
      setBusy(false)
      if (items.length > 1) {
        // SLRM-2230: many rows report in the dialog, with the reason for each one refused.
        setSummary({ action, done: items.length - failures.length, files, refused: failures })
      } else {
        toastOutcome(failures, files)
      }
      if (rescan) {
        await scan()
      }
    },
    [scan]
  )

  const save = useCallback(
    async (items: readonly LostWorkItem[], action: 'save-bundle' | 'save-patch') => {
      const folder = await chooseArchiveFolder()
      if (folder) {
        await runEach(items, (item) => actOnLostWork(item, action, { folder }), false, 'save')
      }
    },
    [runEach]
  )

  const push = useCallback(
    (items: readonly LostWorkItem[]) =>
      runEach(items, (item) => actOnLostWork(item, 'push'), true, 'push'),
    [runEach]
  )

  const openPullRequest = useCallback(async (item: LostWorkItem) => {
    if (item.pullRequest) {
      openAppHttpLink(item.pullRequest.url)
      return
    }
    const outcome = await actOnLostWork(item, 'create-pull-request')
    if (outcome.ok && outcome.url) {
      openAppHttpLink(outcome.url)
    } else if (!outcome.ok) {
      toast.error(translate('fork.lostWork.pullRequestFailed', 'Could not open a pull request'), {
        description: outcome.error
      })
    }
  }, [])

  /** SLRM-2230: a delete starts from what is in use this moment, not at the last scan. */
  const requestDelete = useCallback((items: readonly LostWorkItem[]) => {
    if (items.length > 0) {
      setPendingDelete({ items: withLostWorkUseNow(items), stage: 'confirm' })
    }
  }, [])

  /** Moves to the next confirmation the items need, and deletes after the last one. */
  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return
    }
    const { items, stage } = pendingDelete
    const next = nextLostWorkDeleteStage(items, stage)
    if (next) {
      setPendingDelete({ items, stage: next })
      return
    }
    const confirmedLoss = stage === 'loss'
    setPendingDelete(null)
    await runEach(
      items,
      async (item) => {
        // A chat or agent that started after the confirmation was not agreed to.
        const [now] = withLostWorkUseNow([item])
        if (now.inUse && !item.inUse) {
          return {
            ok: false,
            error: translate(
              'fork.lostWork.nowInUse',
              'Not deleted: it came into use after you confirmed. {{use}}',
              { use: lostWorkUseLabel(now.inUse) }
            )
          }
        }
        return deleteLostWork(item, confirmedLoss)
      },
      true,
      'delete'
    )
  }, [pendingDelete, runEach])

  const rowAction = useCallback(
    (item: LostWorkItem, action: LostWorkRowAction) => {
      switch (action) {
        case 'open':
          openLostWorkWorkspace(item)
          return
        case 'push':
          void push([item])
          return
        case 'pull-request':
          void openPullRequest(item)
          return
        case 'bundle':
          void save([item], 'save-bundle')
          return
        case 'patch':
          void save([item], 'save-patch')
          return
        case 'delete':
          requestDelete([item])
      }
    },
    [openPullRequest, push, requestDelete, save]
  )

  return {
    result,
    scanning,
    progress,
    busy,
    selected,
    setSelected,
    pendingDelete,
    setPendingDelete,
    requestDelete,
    summary,
    setSummary,
    scan,
    cancel,
    save,
    push,
    confirmDelete,
    rowAction
  }
}
