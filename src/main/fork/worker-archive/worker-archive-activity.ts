// Worker archive (FORK.md, BAD-669): which workspaces a window shows right now. A client reports
// its open workspace now and then (fork.workerCleanup.focus); a report that stops coming (a closed
// window, a lost connection) lapses, so a vanished client never holds a workspace for good.

/** A report is good for this long; clients repeat it about every minute. */
export const WORKSPACE_FOCUS_TTL_MS = 3 * 60_000

const focusByClient = new Map<string, { worktreeId: string; atMs: number }>()

/** `worktreeId` null: the client shows no workspace now. */
export function noteForkWorkspaceFocus(
  clientId: string,
  worktreeId: string | null,
  nowMs = Date.now()
): void {
  if (worktreeId === null) {
    focusByClient.delete(clientId)
  } else {
    focusByClient.set(clientId, { worktreeId, atMs: nowMs })
  }
  for (const [id, entry] of focusByClient) {
    if (nowMs - entry.atMs > WORKSPACE_FOCUS_TTL_MS) {
      focusByClient.delete(id)
    }
  }
}

export function forkFocusedWorkspaces(nowMs = Date.now()): Set<string> {
  const focused = new Set<string>()
  for (const entry of focusByClient.values()) {
    if (nowMs - entry.atMs <= WORKSPACE_FOCUS_TTL_MS) {
      focused.add(entry.worktreeId)
    }
  }
  return focused
}

/** Test seam. */
export function resetForkWorkspaceFocus(): void {
  focusByClient.clear()
}
