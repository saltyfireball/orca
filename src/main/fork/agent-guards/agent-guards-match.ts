// Agent guards (FORK.md, SLRM-2385): which guarded agent an id or a unique prefix names.
import type { AgentGuardEntry } from '../../../shared/fork/agent-guards'

export function matchAgentGuardEntry(entries: AgentGuardEntry[], query: string): AgentGuardEntry {
  const exact = entries.filter((entry) => entry.id === query)
  const matches =
    exact.length > 0
      ? exact
      : query.length >= 4
        ? entries.filter((entry) => entry.id.startsWith(query))
        : []
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `No guarded agent matches "${query}". Run "orca guards list" for ids.`
        : `"${query}" matches more than one; use more of its id.`
    )
  }
  return matches[0]
}
