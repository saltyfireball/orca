// Worker cleanup (FORK.md): when each worker's agent last started a turn, fed by one hook line in
// the stock WorkerAutoReleaseActivity. A turn that starts after a worker reported done means
// someone used it again (the user typed into it, or it was sent more work), and worker cleanup
// then leaves it open for good. Kept in memory: the sweep only judges reports made in this run.

const turnStartedAt = new Map<string, number>()
const working = new Map<string, boolean>()

/** Most panes remembered; the oldest are dropped past it. */
const MAX_PANES = 2048

/** Hook: the agent in `paneKey` started (`true`) or ended (`false`) a turn. */
export function noteForkWorkerTurn(paneKey: string, inTurn: boolean, nowMs = Date.now()): void {
  const was = working.get(paneKey)
  working.delete(paneKey)
  working.set(paneKey, inTurn)
  if (inTurn && was !== true) {
    turnStartedAt.delete(paneKey)
    turnStartedAt.set(paneKey, nowMs)
  }
  for (const map of [working, turnStartedAt]) {
    while (map.size > MAX_PANES) {
      const oldest = map.keys().next().value
      if (oldest === undefined) {
        break
      }
      map.delete(oldest)
    }
  }
}

/** When the agent in `paneKey` last started a turn in this run, if it has. */
export function forkWorkerTurnStartedAt(paneKey: string): number | undefined {
  return turnStartedAt.get(paneKey)
}

/** Test seam. */
export function resetForkWorkerTurns(): void {
  turnStartedAt.clear()
  working.clear()
}
