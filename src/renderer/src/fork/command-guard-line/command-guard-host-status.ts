// Command guards (FORK.md, BAD-686): each host's `fork.commandGuards.status`, read once per host and
// shared by every agent row's guard mark. No polling: a host is read when a row first needs it, again
// when a mark mounts and the answer is over a minute old, and when a mark's tooltip opens.
import { useEffect, useSyncExternalStore } from 'react'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { ForkCommandGuardsStatusResult } from '../../../../shared/fork/command-guards-wire'

const STALE_MS = 60_000

type Reader = (target: RuntimeClientTarget) => Promise<ForkCommandGuardsStatusResult>

const defaultReader: Reader = (target) =>
  callRuntimeRpc<ForkCommandGuardsStatusResult>(
    target,
    'fork.commandGuards.status',
    {},
    {
      background: true
    }
  )

let reader = defaultReader
const statuses = new Map<string, { status: ForkCommandGuardsStatusResult; at: number }>()
const reads = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let version = 0

export function commandGuardHostKey(target: RuntimeClientTarget): string {
  return target.kind === 'local' ? 'local' : `environment:${target.environmentId}`
}

function notify(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

/** Reads the host's status unless a fresh answer is cached; `force` reads it again anyway. */
export function loadCommandGuardHostStatus(
  target: RuntimeClientTarget,
  force = false
): Promise<void> {
  const key = commandGuardHostKey(target)
  const cached = statuses.get(key)
  const pending = reads.get(key)
  if (pending || (!force && cached && Date.now() - cached.at < STALE_MS)) {
    return pending ?? Promise.resolve()
  }
  const read = reader(target)
    .then(
      (status) => {
        statuses.set(key, { status, at: Date.now() })
        notify()
      },
      // An older host without command guards, or one that cannot answer now: no mark.
      () => undefined
    )
    .finally(() => reads.delete(key))
  reads.set(key, read)
  return read
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The host's last status; undefined until one answer has come back. */
export function useCommandGuardHostStatus(
  target: RuntimeClientTarget | null
): ForkCommandGuardsStatusResult | undefined {
  useSyncExternalStore(subscribe, () => version)
  const key = target ? commandGuardHostKey(target) : null
  useEffect(() => {
    if (target) {
      void loadCommandGuardHostStatus(target)
    }
    // The key names the host; the target object may be new each render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return key ? statuses.get(key)?.status : undefined
}

/** Tests only: swap the host read and drop every cached answer. */
export function resetCommandGuardHostStatusForTests(next: Reader = defaultReader): void {
  reader = next
  statuses.clear()
  reads.clear()
  notify()
}
