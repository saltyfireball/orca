import { describe, expect, it } from 'vitest'
import { CHAT_HANDOFF_MARKER } from '../../../shared/fork/chat-handoff-select'
import {
  chatHandoffEntriesOf,
  chatHandoffEntryOf,
  readChatHandoffRows
} from './chat-handoff-entries'
import { readChatHistoryPage } from './chat-handoff-history'
import { ChatHandoffLinks, parseChatHandoffLinks } from './chat-handoff-links'
import { fakeHistoryHost, row, said } from './chat-handoff-test-fixtures'

const SOURCE = 'chat-source-0001'

describe('chatHandoffEntryOf', () => {
  it('keeps requests and answers of the chat itself', () => {
    expect(chatHandoffEntryOf(said(4, 'user', 'water the ferns'))).toEqual({
      seq: 4,
      role: 'user',
      text: 'water the ferns'
    })
    expect(chatHandoffEntryOf(said(5, 'assistant', 'done'))?.role).toBe('assistant')
    expect(chatHandoffEntryOf(said(6, 'reasoning', 'hmm'))).toBeNull()
    expect(chatHandoffEntryOf(said(7, 'assistant', 'child', { agentId: 'sub-1' }))).toBeNull()
  })

  it('leaves out conversation commands and marks earlier handoffs', () => {
    const command = row(8, {
      kind: 'message',
      role: 'user',
      blocks: [{ type: 'text', text: '/compact' }],
      command: { name: 'compact' }
    })
    expect(chatHandoffEntryOf(command)).toBeNull()
    expect(chatHandoffEntryOf(said(9, 'user', `${CHAT_HANDOFF_MARKER} earlier`))?.role).toBe(
      'handoff'
    )
  })

  it('turns tool calls and edits into one activity line', () => {
    const tool = row(10, {
      kind: 'tool-call',
      name: 'Bash',
      input: { command: 'pnpm test' },
      state: 'completed',
      exitCode: 1
    })
    expect(chatHandoffEntryOf(tool)?.text).toBe('Bash pnpm test -> exit 1')
    expect(chatHandoffEntryOf(row(11, { kind: 'diff', path: 'src/a.ts' }))?.text).toBe(
      'edited src/a.ts'
    )
    expect(chatHandoffEntryOf(row(12, { kind: 'status' }))).toBeNull()
  })

  it('says how to read a message the page shortened', () => {
    const [entry] = chatHandoffEntriesOf(
      [said(20, 'assistant', 'long', { shortened: true })],
      SOURCE
    )
    expect(entry.text).toContain(`orca chat history ${SOURCE} --before 21 --limit 1`)
  })
})

describe('readChatHandoffRows', () => {
  const items = Array.from({ length: 450 }, (_, index) =>
    said(index + 1, index % 2 === 0 ? 'user' : 'assistant', `m${index + 1}`)
  )

  it('pages back to the start of the chat', async () => {
    const read = await readChatHandoffRows(fakeHistoryHost(items), SOURCE)
    expect(read.complete).toBe(true)
    expect(read.items.map((item) => item.sequence)).toEqual(items.map((item) => item.sequence))
  })

  it('stops at its page budget and says it did not reach the start', async () => {
    const read = await readChatHandoffRows(fakeHistoryHost(items), SOURCE, { maxPages: 1 })
    expect(read.complete).toBe(false)
    expect(read.items).toHaveLength(200)
  })

  it('reads only what came after a handoff, and stops at a /clear', async () => {
    const after = await readChatHandoffRows(fakeHistoryHost(items), SOURCE, { after: 440 })
    expect(after.items.map((item) => item.sequence)).toEqual([
      441, 442, 443, 444, 445, 446, 447, 448, 449, 450
    ])
    const cleared = [
      said(1, 'user', 'old'),
      row(2, {
        kind: 'status',
        contextClear: { operationId: 'op-1', afterFence: 1, clearedAt: 1 }
      }),
      said(3, 'user', 'new')
    ]
    const read = await readChatHandoffRows(fakeHistoryHost(cleared), SOURCE)
    expect(read.complete).toBe(true)
    expect(read.items.map((item) => item.sequence)).toEqual([3])
  })
})

describe('readChatHistoryPage', () => {
  const items = Array.from({ length: 120 }, (_, index) =>
    said(index + 1, index % 2 === 0 ? 'user' : 'assistant', `m${index + 1}`)
  )

  it('returns the newest entries, oldest first, and the number to page back from', async () => {
    const page = await readChatHistoryPage(fakeHistoryHost(items), SOURCE, { limit: 5 })
    expect(page.entries.map((entry) => entry.seq)).toEqual([116, 117, 118, 119, 120])
    expect(page.nextBefore).toBe(116)
  })

  it('reads before a number and ends at the start', async () => {
    const page = await readChatHistoryPage(fakeHistoryHost(items), SOURCE, { before: 4 })
    expect(page.entries.map((entry) => entry.seq)).toEqual([1, 2, 3])
    expect(page.nextBefore).toBeNull()
  })

  it('reads a shortened message whole from the journal', async () => {
    const short = said(1, 'assistant', 'start', { shortened: true })
    const whole = new Map([['item-1', said(1, 'assistant', 'start and the rest')]])
    const page = await readChatHistoryPage(fakeHistoryHost([short], whole), SOURCE, {})
    expect(page.entries[0].text).toBe('start and the rest')
  })
})

describe('ChatHandoffLinks', () => {
  it('finds the chat on the other side and how far it has seen', async () => {
    const links = new ChatHandoffLinks(null)
    await links.add({
      from: 'chat-aaaa-1111',
      fromAgent: 'claude',
      to: 'chat-bbbb-2222',
      toAgent: 'codex',
      throughSeq: 40,
      at: 1
    })
    expect(links.partner('chat-aaaa-1111', 'codex')).toEqual({
      id: 'chat-bbbb-2222',
      seenThrough: 40
    })
    // The codex chat hands back: claude's chat has seen none of the codex chat yet.
    expect(links.partner('chat-bbbb-2222', 'claude')).toEqual({
      id: 'chat-aaaa-1111',
      seenThrough: 0
    })
    expect(links.partner('chat-aaaa-1111', 'claude')).toBeNull()
  })

  it('drops malformed links from the file', () => {
    const text = JSON.stringify({
      links: [
        { from: 'x', to: 'chat-bbbb-2222' },
        {
          from: 'chat-aaaa-1111',
          fromAgent: 'claude',
          to: 'chat-bbbb-2222',
          toAgent: 'codex',
          throughSeq: 3,
          at: 5
        }
      ]
    })
    expect(parseChatHandoffLinks(text)).toHaveLength(1)
  })
})
