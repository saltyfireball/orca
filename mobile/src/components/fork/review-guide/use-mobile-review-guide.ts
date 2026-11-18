// Review guides (SLRM-2396, FORK.md): the phone's guide state for the open pull request. It reads
// once when the PR tab shows, again when the guide opens, and every few seconds while a write
// runs and the guide is open. Writing happens only on the user's tap.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ForkReviewGuideState } from '../../../../../src/shared/fork/review-guide-wire'
import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'
import type { ConnectionState } from '../../../transport/connection/connection-state'
import {
  cancelMobileReviewGuide,
  readMobileReviewGuide,
  writeMobileReviewGuide,
  type MobileReviewGuideTarget
} from './mobile-review-guide-operations'

const POLL_MS = 4000

export type MobileReviewGuide = {
  state: ForkReviewGuideState | null
  error: string | null
  busy: boolean
  refresh: () => void
  write: () => void
  cancel: () => void
}

export function useMobileReviewGuide(input: {
  client: RpcClient | null
  connState: ConnectionState
  target: MobileReviewGuideTarget
  headSha: string | null
  open: boolean
}): MobileReviewGuide {
  const { client, connState, target, headSha, open } = input
  const [state, setState] = useState<ForkReviewGuideState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const key = `${target.worktreeId}#${target.pr}#${target.prRepo?.owner ?? ''}/${target.prRepo?.repo ?? ''}`
  const latest = useRef({ key, target, headSha })
  // Set before the effects below read it; refs are not touched during render.
  useLayoutEffect(() => {
    latest.current = { key, target, headSha }
  })
  const connected = !!client && connState === 'connected'

  const run = useCallback(
    async (action: 'get' | 'write' | 'cancel'): Promise<void> => {
      if (!client) {
        return
      }
      const asked = latest.current
      try {
        const next =
          action === 'get'
            ? await readMobileReviewGuide(client, asked.target, asked.headSha)
            : action === 'write'
              ? await writeMobileReviewGuide(client, asked.target)
              : await cancelMobileReviewGuide(client, asked.target)
        if (latest.current.key === asked.key) {
          setState(action === 'get' ? next : { ...next, stale: null })
          setError(null)
        }
      } catch (failure) {
        if (latest.current.key === asked.key) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      }
    },
    [client]
  )

  useEffect(() => {
    setState(null)
    setError(null)
  }, [key])

  useEffect(() => {
    if (connected) {
      void run('get')
    }
  }, [connected, key, headSha, open, run])

  const running = state?.job?.state === 'running'
  useEffect(() => {
    if (!open || !running || !connected) {
      return
    }
    const timer = setInterval(() => void run('get'), POLL_MS)
    return () => clearInterval(timer)
  }, [open, running, connected, run])

  const act = useCallback(
    (action: 'write' | 'cancel') => {
      setBusy(true)
      void run(action).finally(() => setBusy(false))
    },
    [run]
  )

  return {
    state,
    error,
    busy,
    refresh: useCallback(() => void run('get'), [run]),
    write: useCallback(() => act('write'), [act]),
    cancel: useCallback(() => act('cancel'), [act])
  }
}
