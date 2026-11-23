// Agent guards (FORK.md, BAD-679, BAD-766): a Run (a coordinator and its workers) as the usage
// ledger and the worker start notes see it. Keep electron out of this file.
import type { UsageLedgerData } from '../usage-ledger/usage-ledger-model'
import { cleanUsagePrices, estimateChatCostUsd, usagePricer } from '../usage-ledger/usage-report'
import { forkUsageLedgerSettings } from '../usage-ledger/usage-ledger-service'
import { forkAgentQueueRunParent } from '../agent-queue/agent-queue-service'
import type { AgentGuardRun } from './agent-guards-types'

export type RunIndex = Map<string, AgentGuardRun & { title: string }>

function pricer() {
  return usagePricer(cleanUsagePrices(forkUsageLedgerSettings()?.forkUsagePrices))
}

/** BAD-766: how a terminal agent's pane key and its orchestration handle map to each other. */
export type AgentGuardTerminalLinks = {
  handleOf: (paneKey: string) => string | undefined
  paneOf: (handle: string) => string | undefined
}

let terminalLinks: AgentGuardTerminalLinks = {
  handleOf: () => undefined,
  paneOf: () => undefined
}

export function setAgentGuardTerminalLinks(next: AgentGuardTerminalLinks): void {
  terminalLinks = next
}

/**
 * Who started this agent, as the id of another agent in the ledger's terms: a chat session id or a
 * terminal pane key; `handle:<h>` names a coordinating terminal whose own pane is not known.
 * BAD-766: terminal workers, and chat workers started from a terminal, are linked too.
 */
function runParentOf(data: UsageLedgerData, id: string): string | undefined {
  const own = data.chats[id]?.parentSessionId
  if (own) {
    return own
  }
  const handle = terminalLinks.handleOf(id)
  const ref = handle
    ? forkAgentQueueRunParent({ terminalHandle: handle })
    : forkAgentQueueRunParent({ sessionId: id })
  if (!ref) {
    return undefined
  }
  return 'chat' in ref ? ref.chat : (terminalLinks.paneOf(ref.handle) ?? `handle:${ref.handle}`)
}

/**
 * The coordinator at the top of each agent's dispatch chain, and the agents under each. An agent
 * with no usage record (OpenCode, ACP, Pi, a terminal on an SSH host) is a member too but counts
 * $0: `uncounted` says how many, so the cap's view is honest about what it cannot see.
 */
export function buildRunIndex(
  data: UsageLedgerData,
  live: ReadonlySet<string>,
  parentOf: (id: string) => string | undefined = (id) => runParentOf(data, id)
): RunIndex {
  const price = pricer()
  const rootOf = (id: string): string => {
    let root = id
    const seen = new Set([id])
    for (let parent = parentOf(root); parent && !seen.has(parent); parent = parentOf(root)) {
      seen.add(parent)
      root = parent
    }
    return root
  }
  const groups = new Map<string, { total: number; members: Set<string>; uncounted: number }>()
  const groupOf = (root: string) => {
    const group = groups.get(root) ?? {
      total: 0,
      members: new Set<string>(),
      uncounted: 0
    }
    groups.set(root, group)
    return group
  }
  for (const chat of Object.values(data.chats)) {
    const group = groupOf(rootOf(chat.sessionId))
    group.total += estimateChatCostUsd(chat, price)
    group.members.add(chat.sessionId)
  }
  for (const id of live) {
    const root = rootOf(id)
    if (!data.chats[id] && root !== id) {
      const group = groupOf(root)
      group.members.add(id)
      group.uncounted += 1
    }
  }
  const index: RunIndex = new Map()
  for (const [rootId, group] of groups) {
    if (group.members.size < 2) {
      continue
    }
    const run = {
      rootId,
      // Only agents still running can be paused; finished ones count toward the total only.
      memberIds: [...group.members].filter((id) => live.has(id)),
      totalUsd: group.total,
      uncounted: group.uncounted,
      title:
        data.chats[rootId]?.title ||
        (rootId.startsWith('handle:') ? 'Terminal coordinator' : `Chat ${rootId.slice(0, 8)}`)
    }
    for (const id of group.members) {
      index.set(id, run)
    }
  }
  return index
}
