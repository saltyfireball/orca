// SLRM-2127: where upstream's killProviderWriter finds the conversation writer under a
// chat-survive broker. Without a broker the app's provider root is the supervisor and the writer
// is its child in a group of its own. A broker adds a level, and runs the supervisor in the
// broker's own group (chat-survive-broker-entry.ts spawns it with `detached: false`):
//
//   app -> broker (root) -> supervisor (root's group) -> writer (its own group)
//
// so a search one level under the root finds no group leader and the writer is never signalled.
import type { DescendantSnapshot } from '../../pty/process-retirement/pty-descendant-termination'

/**
 * The pids whose group-leading children are writers: the root, plus any direct child of the root
 * that shares the root's group (a supervisor under a broker). Without a broker the supervisor's
 * only child leads its own group, so the set is just the root.
 */
export function forkProviderWriterParents(
  rootPid: number | undefined,
  snapshot: DescendantSnapshot | null
): ReadonlySet<number> {
  const parents = new Set<number>()
  if (rootPid === undefined) {
    return parents
  }
  parents.add(rootPid)
  const rootPgid = snapshot?.rootPgid ?? null
  if (rootPgid === null) {
    return parents
  }
  for (const row of snapshot?.descendants ?? []) {
    if (row.ppid === rootPid && row.pgid === rootPgid && row.pid !== row.pgid) {
      parents.add(row.pid)
    }
  }
  return parents
}
