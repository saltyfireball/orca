// Digest (SLRM-2388, FORK.md): the dialog's open state and its data, read from this desktop's own
// runtime (fork.digest.collect), which asks every paired server for its part.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import {
  FORK_DIGEST_CALL_TIMEOUT_MS,
  FORK_DIGEST_COLLECT_METHOD,
  type ForkDigest
} from '../../../../shared/fork/digest'

let open = false
const listeners = new Set<() => void>()

function setOpen(next: boolean): void {
  open = next
  for (const listener of listeners) {
    listener()
  }
}

/** Shows the digest; the dialog is mounted once at the app root. */
export function openForkDigest(): void {
  setOpen(true)
}

export function closeForkDigest(): void {
  setOpen(false)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useForkDigestOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open)
}

/** Window choices in hours back from now; null is since the last daily digest. */
export const FORK_DIGEST_WINDOWS = [null, 12, 24, 72, 168] as const
export type ForkDigestWindow = (typeof FORK_DIGEST_WINDOWS)[number]

type Setters = {
  setDigest: (digest: ForkDigest) => void
  setError: (error: string | null) => void
  setLoading: (loading: boolean) => void
}

async function loadForkDigest(
  hours: ForkDigestWindow,
  { setDigest, setError, setLoading }: Setters
): Promise<void> {
  setLoading(true)
  try {
    const params = hours === null ? {} : { since: Date.now() - hours * 3_600_000 }
    setDigest(
      await callRuntimeRpc<ForkDigest>({ kind: 'local' }, FORK_DIGEST_COLLECT_METHOD, params, {
        timeoutMs: FORK_DIGEST_CALL_TIMEOUT_MS
      })
    )
    setError(null)
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : String(caught))
  } finally {
    setLoading(false)
  }
}

export function useForkDigest(hours: ForkDigestWindow) {
  const [digest, setDigest] = useState<ForkDigest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(
    () => loadForkDigest(hours, { setDigest, setError, setLoading }),
    [hours]
  )
  useEffect(() => {
    void load()
  }, [load])
  return { digest, error, loading, reload: load }
}
