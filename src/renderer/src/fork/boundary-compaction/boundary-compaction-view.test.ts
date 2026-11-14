import { describe, expect, it } from 'vitest'
import type { Tab } from '../../../../shared/tab-types'
import { isTypedDraft, nativeChatSessionIds, typedChatSessionIds } from './boundary-compaction-view'

function tab(id: string, contentType: string, entityId: string): Tab {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields the reader looks at.
  return { id, contentType, entityId } as unknown as Tab
}

describe('nativeChatSessionIds', () => {
  it('lists every native chat tab once, in every workspace, sorted', () => {
    expect(
      nativeChatSessionIds({
        one: [tab('t1', 'agent-session', 'chat-b'), tab('t2', 'terminal', 'term-1')],
        two: [tab('t3', 'agent-session', 'chat-a'), tab('t4', 'agent-session', 'chat-b')],
        three: undefined
      })
    ).toEqual(['chat-a', 'chat-b'])
    expect(nativeChatSessionIds(undefined)).toEqual([])
  })
})

describe('typed drafts', () => {
  it('counts text and images, not blank space', () => {
    expect(isTypedDraft({ text: '', images: [] })).toBe(false)
    expect(isTypedDraft({ text: '  \n', images: undefined })).toBe(false)
    expect(isTypedDraft({ text: ' hi', images: [] })).toBe(true)
    expect(isTypedDraft({ text: '', images: [{}] })).toBe(true)
  })

  it('keeps the chats whose draft is not empty', () => {
    const drafts: Record<string, string> = { 'chat-a': 'half a thought', 'chat-b': '' }
    expect(
      typedChatSessionIds(['chat-a', 'chat-b', 'chat-c'], (id) => ({
        text: drafts[id] ?? '',
        images: []
      }))
    ).toEqual(['chat-a'])
  })
})
