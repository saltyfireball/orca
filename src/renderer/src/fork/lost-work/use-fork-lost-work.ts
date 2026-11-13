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
import type { LostWorkRowAction } from './ForkLostWorkRow'

/** A delete waits here: stage 1 for every delete, stage 2 when any item would lose work. */
export type LostWorkPendingDelete = { items: LostWorkItem[]; stage: 1 | 2 }

let scanCounter = 0

function nextScanId(): string {
  scanCounter += 1
  return `lost-work-${Date.now()}-${scanCounter}`
}

/** Runs `run` on each item in turn; a rejected run counts as a failure, so this never throws. */
async function runItems(
  items: readonly LostWorkItem[],
  run: (item: LostWorkItem) => Promise<LostWorkActionResult>
): Promise<{ failures: string[]; files: string[] }> {
  const failures: string[] = []
  const files: string[] = []
  for (const item of items) {
    const outcome = await run(item).catch((error: unknown): LostWorkActionResult => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }))
    if (outcome.ok) {
      files.push(...(outcome.files ?? []))
    } else {
      failures.push(`${item.branch ?? item.path ?? item.repoName}: ${outcome.error}`)
    }
  }
  return { failures, files }
}

function toastOutcome(failures: readonly string[], files: readonly string[]): void {
  if (failures.length > 0) {
    toast.error(
      translate('fork.lostWork.someFailed', '{{count}} of the items failed', {
        count: failures.length
      }),
      { description: failures.slice(0, 5).join('\n') }
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
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<LostWorkPendingDelete | null>(null)
  const scanId = useRef<string | null>(null)

  const scan = useCallback(async () => {
    const lostWork = window.api.forkLostWork
    if (!lostWork) {
      return
    }
    const id = nextScanId()
    scanId.current = id
    setScanning(true)
    const next = await scanOnce(lostWork, id, () => scanId.current === id)
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
      rescan: boolean
    ) => {
      setBusy(true)
      const { failures, files } = await runItems(items, run)
      setBusy(false)
      toastOutcome(failures, files)
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
        await runEach(items, (item) => actOnLostWork(item, action, { folder }), false)
      }
    },
    [runEach]
  )

  const push = useCallback(
    (items: readonly LostWorkItem[]) => runEach(items, (item) => actOnLostWork(item, 'push'), true),
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

  /** First confirm passed: a would-lose-work item needs the second one. */
  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return
    }
    const losesWork = pendingDelete.items.some((item) => item.risk === 'would-lose-work')
    if (pendingDelete.stage === 1 && losesWork) {
      setPendingDelete({ items: pendingDelete.items, stage: 2 })
      return
    }
    const confirmedLoss = pendingDelete.stage === 2
    const items = pendingDelete.items
    setPendingDelete(null)
    await runEach(items, (item) => deleteLostWork(item, confirmedLoss), true)
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
          setPendingDelete({ items: [item], stage: 1 })
      }
    },
    [openPullRequest, push, save]
  )

  return {
    result,
    scanning,
    busy,
    selected,
    setSelected,
    pendingDelete,
    setPendingDelete,
    scan,
    cancel,
    save,
    push,
    confirmDelete,
    rowAction
  }
}
