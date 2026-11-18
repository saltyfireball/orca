// Chat handoff tests: invented journal rows and a fake host `history` that pages them the way the
// real reader does (newest page first, `before` a cursor, `hasOlder` when rows remain).
import type { AgentSessionHistoryResult } from '../../../shared/agent-session/agent-session-wire'
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import type { ChatHistoryHost } from './chat-handoff-entries'

const NOW = 1_800_000_000_000

export function row(
  sequence: number,
  body: Record<string, unknown>,
  overrides: Partial<AgentJournalRenderItem> = {}
): AgentJournalRenderItem {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test row with only the fields the readers look at.
  return {
    itemId: `item-${sequence}`,
    revision: 1,
    sequence,
    observedAt: NOW,
    body,
    ...overrides
  } as AgentJournalRenderItem
}

export function said(
  sequence: number,
  role: 'user' | 'assistant' | 'reasoning',
  text: string,
  overrides: Partial<AgentJournalRenderItem> = {}
): AgentJournalRenderItem {
  return row(sequence, { kind: 'message', role, blocks: [{ type: 'text', text }] }, overrides)
}

/** A fake of the host's paged `history` and `historyItem` over `items` (sorted by sequence). */
export function fakeHistoryHost(
  items: readonly AgentJournalRenderItem[],
  whole: ReadonlyMap<string, AgentJournalRenderItem> = new Map()
): ChatHistoryHost & { reads: number } {
  const fake = {
    reads: 0,
    history: async (request: {
      direction: 'tail' | 'before' | 'after'
      cursor?: { epoch: string; sequence: number }
      limit?: number
    }): Promise<AgentSessionHistoryResult> => {
      fake.reads += 1
      const limit = request.limit ?? 40
      const older =
        request.direction === 'before' && request.cursor
          ? items.filter((item) => item.sequence < request.cursor!.sequence)
          : items
      const page = older.slice(Math.max(0, older.length - limit))
      const oldest = page[0]
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the page fields the readers use.
      return {
        ok: true,
        page: {
          sessionId: 's',
          epoch: 'e1',
          direction: request.direction,
          items: page,
          removedItemIds: [],
          submissions: [],
          window: {
            oldest: oldest ? { epoch: 'e1', sequence: oldest.sequence } : null,
            newest: null,
            nextCursor: { epoch: 'e1', sequence: oldest?.sequence ?? 0 }
          },
          hasOlder: older.length > page.length,
          hasNewer: false
        }
      } as unknown as AgentSessionHistoryResult
    },
    historyItem: async (_sessionId: string, itemId: string) => whole.get(itemId) ?? null
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the two reads the handoff makes.
  return fake as unknown as ChatHistoryHost & { reads: number }
}
