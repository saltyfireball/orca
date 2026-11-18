// Review guides (SLRM-2396, FORK.md): the Guide tab's state. It reads the kept guide when the tab
// opens, polls while a write runs, and writes on its own only when the user turned on automatic
// guides (each one costs agent usage).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { readForkReviewGuideSettings } from '../../../../shared/fork/review-guide'
import type {
  ForkReviewGuideState,
  ForkReviewGuideWindowRequest
} from '../../../../shared/fork/review-guide-wire'
import type { GitHubRepositoryIdentity } from '../../../../shared/github/repositories/repository-identity'
import { useAppStore } from '@/store'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'

const POLL_MS = 3000
/** Pull requests this window already auto-wrote a guide for, so a failure is not retried in a loop. */
const autoWritten = new Set<string>()

export type ForkReviewGuideInput = {
  repoId: string | null
  pr: number
  prRepo: GitHubRepositoryIdentity | null
  headSha: string | null | undefined
  /** False until the tab is opened, so a closed tab costs no reads. */
  active: boolean
}

export type ForkReviewGuideView = {
  state: ForkReviewGuideState | null
  error: string | null
  busy: boolean
  write: () => void
  cancel: () => void
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // Electron prefixes errors from main with the channel; the reason is what follows.
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export function forkReviewGuidesAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.api?.forkReviewGuide
}

export function useForkReviewGuide(input: ForkReviewGuideInput): ForkReviewGuideView {
  const autoWrite = useAppStore((s) => readForkReviewGuideSettings(s.settings).autoWrite)
  const [state, setState] = useState<ForkReviewGuideState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { repoId, pr, prRepo, headSha, active } = input
  const request = useRef<ForkReviewGuideWindowRequest | null>(null)
  // Set before the effects below read it; refs are not touched during render.
  useLayoutEffect(() => {
    request.current = repoId
      ? { repoId, pr, prRepo: prRepo ?? null, ...(headSha ? { headSha } : {}) }
      : null
  })
  const key = repoId ? `${repoId}#${pr}` : null

  const call = useCallback(async (method: 'get' | 'write' | 'cancel'): Promise<void> => {
    const api = window.api?.forkReviewGuide
    const current = request.current
    if (!api || !current) {
      return
    }
    try {
      const next = await api[method](current)
      if (request.current?.repoId === current.repoId && request.current.pr === current.pr) {
        setState(method === 'get' ? next : { ...next, stale: null })
        setError(null)
        if (method !== 'get') {
          void api.get(current).then(setState, () => undefined)
        }
      }
    } catch (failure) {
      setError(errorText(failure))
    }
  }, [])

  useEffect(() => {
    setState(null)
    setError(null)
    if (active && key) {
      void call('get')
    }
  }, [active, key, headSha, call])

  const running = state?.job?.state === 'running'
  useEffect(() => {
    if (!active || !running) {
      return
    }
    return installWindowVisibilityInterval({ run: () => void call('get'), intervalMs: POLL_MS })
  }, [active, running, call])

  const write = useCallback(() => {
    setBusy(true)
    void call('write').finally(() => setBusy(false))
  }, [call])
  const cancel = useCallback(() => {
    setBusy(true)
    void call('cancel').finally(() => setBusy(false))
  }, [call])

  useEffect(() => {
    if (
      active &&
      autoWrite &&
      key &&
      state?.enabled &&
      !state.guide &&
      !state.job &&
      !autoWritten.has(key)
    ) {
      autoWritten.add(key)
      write()
    }
  }, [active, autoWrite, key, state, write])

  return { state, error, busy, write, cancel }
}
