// Worker archive (FORK.md, BAD-669): what the renderer knows of it. The held reasons per workspace
// (read from the local host about every minute) and the cleanup dialog's request.
import type { ForkWorkerArchiveStatus } from '../../../../shared/fork/worker-archive'

const listeners = new Set<() => void>()
let statusById = new Map<string, ForkWorkerArchiveStatus>()

export type WorkerCleanupRequest =
  | { kind: 'all' }
  | { kind: 'bot'; botName: string }
  | { kind: 'workspace'; worktreeId: string; name: string; status: ForkWorkerArchiveStatus }

let request: WorkerCleanupRequest | null = null

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeWorkerArchive(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setWorkerArchiveStatus(list: readonly ForkWorkerArchiveStatus[]): void {
  statusById = new Map(list.map((entry) => [entry.worktreeId, entry]))
  emit()
}

export function workerArchiveStatusOf(worktreeId: string): ForkWorkerArchiveStatus | undefined {
  return statusById.get(worktreeId)
}

export function readWorkerCleanupRequest(): WorkerCleanupRequest | null {
  return request
}

export function openWorkerCleanup(next: WorkerCleanupRequest | null): void {
  request = next
  emit()
}
