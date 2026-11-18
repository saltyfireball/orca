// Agent guards (FORK.md, SLRM-2385): what a native chat's newest journal rows say. Its finished tool
// calls feed the loop rule, and the newest user message says who started the turn a paused chat is
// in. Pure: the rows come from `readChatJournalTail`.
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import type { AgentGuardToolCall } from '../../../shared/fork/agent-guards'

/** Most item ids remembered per chat; older ones have left the tail page anyway. */
const MAX_SEEN = 1000

function order(a: AgentJournalRenderItem, b: AgentJournalRenderItem): number {
  return a.sequence - b.sequence || (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0)
}

/**
 * Tool calls that finished on their own and were not handed over yet, oldest first. A call cut by
 * a stop or a lost session (`endedAs`) is no failing step. Rows observed before `notBefore` are
 * marked seen without being returned, so a restart never replays a chat's history.
 */
export function takeChatToolCalls(
  items: readonly AgentJournalRenderItem[],
  seen: Set<string>,
  notBefore: number
): AgentGuardToolCall[] {
  const calls: AgentGuardToolCall[] = []
  for (const item of [...items].sort(order)) {
    const body = item.body
    if (body.kind !== 'tool-call' || body.state === 'running' || seen.has(item.itemId)) {
      continue
    }
    seen.add(item.itemId)
    if (item.observedAt < notBefore || body.endedAs !== undefined || item.recovered) {
      continue
    }
    calls.push({
      tool: body.name,
      input: body.input,
      failed: body.state === 'failed',
      error: body.state === 'failed' ? (body.output?.head ?? '') : '',
      at: item.observedAt
    })
  }
  while (seen.size > MAX_SEEN) {
    const oldest = seen.values().next().value
    if (oldest === undefined) {
      break
    }
    seen.delete(oldest)
  }
  return calls
}

/**
 * Who wrote the newest user message: `person` (no sender: typed, or the inbox's answer), `agent`
 * (orchestration mail or another agent), `command` (a conversation command such as an automatic
 * `/compact`), or null when the page holds none.
 */
export function newestUserMessageSource(
  items: readonly AgentJournalRenderItem[]
): 'person' | 'agent' | 'command' | null {
  const sorted = [...items].sort(order)
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const body = sorted[index].body
    if (body.kind === 'message' && body.role === 'user') {
      if (body.command) {
        return 'command'
      }
      return body.from ? 'agent' : 'person'
    }
  }
  return null
}
