// Best of N (FORK.md, SLRM-2393): the compare view's open state and data. Loads the runs, then the
// chosen run's facts from main and each attempt's diff from the host that owns its worktree.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ForkBestOfRun } from '../../../../shared/fork/best-of/best-of'
import {
  readForkBestOfDiff,
  type ForkBestOfDiffResult
} from '../../../../shared/fork/best-of/best-of-compare'
import type { ForkBestOfShowResult } from '../../../../shared/fork/best-of/best-of-wire'
import { forkBestOfCall, listForkBestOfRuns, showForkBestOfRun } from './best-of-client'

let open = false
const listeners = new Set<() => void>()

function setOpen(next: boolean): void {
  open = next
  for (const listener of listeners) {
    listener()
  }
}

/** Shows the compare view; the dialog is mounted once at the app root. */
export function openForkBestOf(): void {
  setOpen(true)
}

export function closeForkBestOf(): void {
  setOpen(false)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useForkBestOfOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open)
}

export type ForkBestOfDiffs = Record<number, ForkBestOfDiffResult>

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A call's value or its error text; kept out of the hook so the compiler can compile it. */
async function attempt<T>(run: () => Promise<T>): Promise<{ value: T } | { error: string }> {
  try {
    return { value: await run() }
  } catch (caught) {
    return { error: message(caught) }
  }
}

/** Each attempt's diff, filled in as each host answers. */
async function loadDiffs(
  shown: ForkBestOfShowResult,
  setDiffs: (update: (current: ForkBestOfDiffs) => ForkBestOfDiffs) => void
): Promise<void> {
  await Promise.all(
    shown.facts.map(async (facts) => {
      const result = await readForkBestOfDiff(forkBestOfCall, facts, shown.run)
      setDiffs((current) => ({ ...current, [facts.index]: result }))
    })
  )
}

export function useForkBestOf() {
  const [runs, setRuns] = useState<ForkBestOfRun[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [shown, setShown] = useState<ForkBestOfShowResult | null>(null)
  const [diffs, setDiffs] = useState<ForkBestOfDiffs>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadRuns = useCallback(async () => {
    setLoading(true)
    const result = await attempt(listForkBestOfRuns)
    setLoading(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    const { runs: listed } = result.value
    setRuns(listed)
    setError(null)
    setSelected((current) =>
      current && listed.some((run) => run.id === current) ? current : (listed[0]?.id ?? null)
    )
  }, [])

  const loadRun = useCallback(async (id: string) => {
    setLoading(true)
    setDiffs({})
    const result = await attempt(() => showForkBestOfRun(id))
    if ('error' in result) {
      setShown(null)
      setError(result.error)
      setLoading(false)
      return
    }
    setShown(result.value)
    setError(null)
    await loadDiffs(result.value, setDiffs)
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  useEffect(() => {
    if (selected) {
      void loadRun(selected)
    } else {
      setShown(null)
    }
  }, [selected, loadRun])

  const reload = useCallback(async () => {
    await loadRuns()
    if (selected) {
      await loadRun(selected)
    }
  }, [loadRuns, loadRun, selected])

  return { runs, selected, setSelected, shown, diffs, error, loading, reload }
}
